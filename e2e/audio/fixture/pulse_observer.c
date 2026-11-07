/* Stats-only observation of the disposable QEMU process's libpulse input.
 * Never changes a Pulse argument, return value, PCM buffer, route or callback.
 * Build only for the isolated fixture; not linked into FamCall. */
#define _GNU_SOURCE
#include <pulse/pulseaudio.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

#define MAX_STREAMS 4
#define MAX_ROWS 1024
#define MAX_SECONDS 600
#define MAX_FRAGMENT (256 * 1024)

typedef int (*peek_fn)(pa_stream *, const void **, size_t *);
typedef int (*drop_fn)(pa_stream *);
static peek_fn real_peek;
static drop_fn real_drop;
static uint32_t (*stream_index)(const pa_stream *);
static uint32_t (*device_index)(const pa_stream *);
static const char *(*device_name)(const pa_stream *);
static const pa_sample_spec *(*sample_spec)(const pa_stream *);
static pthread_once_t symbols_once = PTHREAD_ONCE_INIT;
static pthread_once_t late_symbols_once = PTHREAD_ONCE_INIT;

typedef struct {
    uint64_t peeks, data_peeks, empty_peeks, holes, errors, drops, drop_errors;
    uint64_t peek_bytes, drop_bytes, peek_nonzero, drop_nonzero, too_large, uninspected, unknown_drops;
    int route_invalid, route_changed;
    int peek_peak, drop_peak;
} Counts;
typedef struct {
    pa_stream *stream;
    uint32_t index, source, rate;
    unsigned channels;
    int format, route_matches;
    Counts counts;
    const void *pending_ptr;
    size_t pending_bytes;
    uint64_t pending_nonzero;
    int pending_peak, pending_data, pending_known, pending_valid, route_seen;
} Stream;
static Stream streams[MAX_STREAMS];
static pthread_mutex_t stats_mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_t writer;
static _Atomic int enabled, stopped, lost;
static int fd = -1, writer_started, rows, expected_source;
static int64_t started_ms, window_ms;

static int64_t now_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_REALTIME, &t);
    return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static double monotonic_seconds(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (double)t.tv_sec + (double)t.tv_nsec / 1000000000;
}
static void resolve_symbols(void) {
    *(void **)(&real_peek) = dlsym(RTLD_NEXT, "pa_stream_peek");
    *(void **)(&real_drop) = dlsym(RTLD_NEXT, "pa_stream_drop");
    *(void **)(&stream_index) = dlsym(RTLD_NEXT, "pa_stream_get_index");
    *(void **)(&device_index) = dlsym(RTLD_NEXT, "pa_stream_get_device_index");
    *(void **)(&device_name) = dlsym(RTLD_NEXT, "pa_stream_get_device_name");
    *(void **)(&sample_spec) = dlsym(RTLD_NEXT, "pa_stream_get_sample_spec");
}
/* Missing next exports mean this is not the required dynamically-linked Pulse
 * process. Do not fabricate a Pulse success/error result in that invalid setup. */
static void require_symbols(void) {
    pthread_once(&symbols_once, resolve_symbols);
    /* A non-Pulse launcher/backend may load the real library after construction. */
    if (!real_peek || !real_drop) pthread_once(&late_symbols_once, resolve_symbols);
    if (!real_peek || !real_drop) abort();
}
static int qemu_process(void) {
    char path[PATH_MAX];
#ifdef __APPLE__
    uint32_t size = sizeof(path);
    if (_NSGetExecutablePath(path, &size) != 0) return 0;
#else
    ssize_t n = readlink("/proc/self/exe", path, sizeof(path) - 1);
    if (n <= 0) return 0;
    path[n] = 0;
#endif
    const char *name = strrchr(path, '/');
    return strcmp(name ? name + 1 : path, "qemu-system-x86_64") == 0;
}
static int binding_name(void *symbol, char *name, size_t size) {
    Dl_info info;
    name[0] = 0;
    if (!symbol || !dladdr(symbol, &info) || !info.dli_fname) return 0;
    const char *base = strrchr(info.dli_fname, '/');
    base = base ? base + 1 : info.dli_fname;
    size_t n = strlen(base);
    if (n == 0 || n >= size) return 0;
    for (size_t i = 0; i < n; i++) {
        char c = base[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-')) return 0;
    }
    memcpy(name, base, n + 1);
    return strncmp(base, "libpulse.", 9) == 0;
}
static void emit(const char *line, size_t n) {
    if (fd < 0 || rows >= MAX_ROWS || n == 0 || n > 2048) return;
    ssize_t written = write(fd, line, n);
    if (written != (ssize_t)n) atomic_store(&lost, 1);
    rows++;
}
static void flush_counts(void) {
    char line[2048];
    int64_t end = now_ms();
    Stream snapshot[MAX_STREAMS];
    pthread_mutex_lock(&stats_mutex);
    memcpy(snapshot, streams, sizeof(snapshot));
    for (int i = 0; i < MAX_STREAMS; i++) memset(&streams[i].counts, 0, sizeof(Counts));
    int64_t start = window_ms;
    window_ms = end;
    pthread_mutex_unlock(&stats_mutex);
    for (int i = 0; i < MAX_STREAMS && rows < MAX_ROWS - 1; i++) {
        Stream *s = &snapshot[i];
        Counts *c = &s->counts;
        if (!s->stream) continue;
        int n = snprintf(line, sizeof(line),
            "{\"kind\":\"interval\",\"pid\":%ld,\"startMs\":%lld,\"endMs\":%lld,"
            "\"streamId\":%u,\"sourceId\":%u,\"rate\":%u,\"channels\":%u,\"format\":%d,"
            "\"routeMatches\":%s,\"peekCalls\":%llu,\"dataPeekCalls\":%llu,\"emptyPeekCalls\":%llu,"
            "\"holeCalls\":%llu,\"peekErrors\":%llu,\"dropCalls\":%llu,\"dropErrors\":%llu,"
            "\"peekBytes\":%llu,\"dropBytes\":%llu,\"peekNonzeroSamples\":%llu,"
            "\"dropNonzeroSamples\":%llu,\"peekPeak\":%d,\"dropPeak\":%d,"
            "\"oversizeFragments\":%llu,\"uninspectedFragments\":%llu,\"unknownDrops\":%llu,"
            "\"routeInvalidDuringInterval\":%s,\"routeChangedDuringInterval\":%s,\"lostObservation\":%s}\n",
            (long)getpid(), (long long)start, (long long)end,
            s->index, s->source, s->rate, s->channels, s->format,
            s->route_matches ? "true" : "false",
            (unsigned long long)c->peeks, (unsigned long long)c->data_peeks,
            (unsigned long long)c->empty_peeks, (unsigned long long)c->holes,
            (unsigned long long)c->errors, (unsigned long long)c->drops,
            (unsigned long long)c->drop_errors, (unsigned long long)c->peek_bytes,
            (unsigned long long)c->drop_bytes, (unsigned long long)c->peek_nonzero,
            (unsigned long long)c->drop_nonzero, c->peek_peak, c->drop_peak,
            (unsigned long long)c->too_large, (unsigned long long)c->uninspected,
            (unsigned long long)c->unknown_drops, c->route_invalid ? "true" : "false",
            c->route_changed ? "true" : "false", atomic_load(&lost) ? "true" : "false");
        if (n > 0 && (size_t)n < sizeof(line)) emit(line, (size_t)n);
        else atomic_store(&lost, 1);
    }
}
static void *write_intervals(void *unused) {
    (void)unused;
    double deadline = monotonic_seconds() + MAX_SECONDS;
    while (!atomic_load(&stopped) && monotonic_seconds() < deadline && rows < MAX_ROWS - 1) {
        struct timespec delay = {1, 0};
        nanosleep(&delay, NULL);
        flush_counts();
    }
    atomic_store(&enabled, 0);
    char line[256];
    int n = snprintf(line, sizeof(line),
        "{\"kind\":\"end\",\"pid\":%ld,\"atMs\":%lld,\"boundReached\":%s,\"lostObservation\":%s}\n",
        (long)getpid(), (long long)now_ms(), atomic_load(&stopped) ? "false" : "true",
        atomic_load(&lost) ? "true" : "false");
    emit(line, (size_t)n);
    return NULL;
}
static Stream *get_stream(pa_stream *stream) {
    for (int i = 0; i < MAX_STREAMS; i++) if (streams[i].stream == stream) return &streams[i];
    for (int i = 0; i < MAX_STREAMS; i++) if (!streams[i].stream) {
        streams[i].stream = stream;
        return &streams[i];
    }
    atomic_store(&lost, 1);
    return NULL;
}
static void route(Stream *s) {
    uint32_t index = stream_index ? stream_index(s->stream) : PA_INVALID_INDEX;
    uint32_t source = device_index ? device_index(s->stream) : PA_INVALID_INDEX;
    const char *name = device_name ? device_name(s->stream) : NULL;
    const pa_sample_spec *spec = sample_spec ? sample_spec(s->stream) : NULL;
    if (s->route_seen && (s->index != index || s->source != source || !spec ||
            s->rate != spec->rate || s->channels != spec->channels || s->format != (int)spec->format))
        s->counts.route_changed = 1;
    s->route_seen = 1;
    s->index = index; s->source = source;
    s->rate = spec ? spec->rate : 0;
    s->channels = spec ? spec->channels : 0;
    s->format = spec ? spec->format : -1;
    s->route_matches = s->index != PA_INVALID_INDEX && s->source == (uint32_t)expected_source &&
        name && strcmp(name, "famcall_input") == 0 && spec && spec->format == PA_SAMPLE_S16LE &&
        spec->rate == 44100 && spec->channels == 2;
    if (!s->route_matches) s->counts.route_invalid = 1;
}
int pa_stream_peek(pa_stream *stream, const void **data, size_t *bytes) {
    int entry_errno = errno;
    require_symbols();
    errno = entry_errno;
    int result = real_peek(stream, data, bytes);
    int saved_errno = errno;
    if (atomic_load(&enabled)) {
        if (pthread_mutex_trylock(&stats_mutex) == 0) {
            Stream *s = get_stream(stream);
            if (s) {
                route(s);
                Counts *c = &s->counts;
                c->peeks++;
                if (result < 0) c->errors++;
                else if (data && bytes) {
                    if (!*data && !*bytes) c->empty_peeks++;
                    else if (!*data) c->holes++;
                    else c->data_peeks++;
                    if (*bytes && (!s->pending_known || s->pending_ptr != *data || s->pending_bytes != *bytes)) {
                        if (s->pending_known) atomic_store(&lost, 1);
                        s->pending_known = 1; s->pending_ptr = *data; s->pending_bytes = *bytes;
                        s->pending_peak = 0; s->pending_nonzero = 0;
                        s->pending_data = *data != NULL;
                        s->pending_valid = 0;
                        if (*data) c->peek_bytes += *bytes;
                        if (*data && s->route_matches && *bytes <= MAX_FRAGMENT && *bytes % 4 == 0) {
                            s->pending_valid = 1;
                            const unsigned char *p = *data;
                            for (size_t i = 0; i < *bytes; i += 2) {
                                int value = (int16_t)((unsigned)p[i] | (unsigned)p[i + 1] << 8);
                                int absolute = value < 0 ? -value : value;
                                s->pending_nonzero += value != 0;
                                if (absolute > s->pending_peak) s->pending_peak = absolute;
                            }
                            c->peek_nonzero += s->pending_nonzero;
                            if (s->pending_peak > c->peek_peak) c->peek_peak = s->pending_peak;
                        } else if (*data) {
                            c->uninspected++;
                            if (*bytes > MAX_FRAGMENT) c->too_large++;
                        }
                    }
                }
            }
            pthread_mutex_unlock(&stats_mutex);
        } else atomic_store(&lost, 1);
    }
    errno = saved_errno;
    return result;
}
int pa_stream_drop(pa_stream *stream) {
    int entry_errno = errno;
    require_symbols();
    errno = entry_errno;
    int result = real_drop(stream);
    int saved_errno = errno;
    if (atomic_load(&enabled)) {
        if (pthread_mutex_trylock(&stats_mutex) == 0) {
            Stream *s = get_stream(stream);
            if (s) {
                route(s);
                if (result < 0) s->counts.drop_errors++;
                else {
                    s->counts.drops++;
                    if (s->pending_known && s->pending_data) {
                        s->counts.drop_bytes += s->pending_bytes;
                        if (s->pending_valid && s->route_matches) {
                            s->counts.drop_nonzero += s->pending_nonzero;
                            if (s->pending_peak > s->counts.drop_peak) s->counts.drop_peak = s->pending_peak;
                        } else s->counts.uninspected++;
                    } else if (!s->pending_known) s->counts.unknown_drops++;
                    s->pending_known = 0;
                }
            }
            pthread_mutex_unlock(&stats_mutex);
        } else atomic_store(&lost, 1);
    }
    errno = saved_errno;
    return result;
}
__attribute__((constructor)) static void start_observer(void) {
    if (!qemu_process()) return;
    const char *path = getenv("FAMCALL_PULSE_OBSERVER_PATH");
    const char *source = getenv("FAMCALL_PULSE_OBSERVER_SOURCE_ID");
    if (!path || path[0] != '/' || !source || !*source) return;
    char *end;
    long parsed = strtol(source, &end, 10);
    if (*end || parsed < 0 || parsed > INT_MAX) return;
    expected_source = (int)parsed;
    fd = open(path, O_WRONLY | O_APPEND | O_NOFOLLOW | O_CLOEXEC);
    struct stat info;
    if (fd < 0) return;
    if (fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) || (info.st_mode & 0777) != 0600 ||
        info.st_uid != geteuid() || info.st_nlink != 1 || info.st_size != 0) {
        close(fd); fd = -1; return;
    }
    /* Diagnostic initialization must not abort a process whose backend has not
     * loaded Pulse. Missing exports are unknown until an actual wrapped call. */
    pthread_once(&symbols_once, resolve_symbols);
    char peek_library[96], drop_library[96], line[768];
    int peek_ok = binding_name((void *)real_peek, peek_library, sizeof(peek_library));
    int drop_ok = binding_name((void *)real_drop, drop_library, sizeof(drop_library));
    started_ms = window_ms = now_ms();
    int n = snprintf(line, sizeof(line),
        "{\"kind\":\"constructor\",\"pid\":%ld,\"atMs\":%lld,\"expectedSourceId\":%d,"
        "\"realPeekLibrary\":\"%s\",\"realDropLibrary\":\"%s\",\"bindingsVerified\":%s,"
        "\"maxSeconds\":%d,\"maxRows\":%d}\n", (long)getpid(), (long long)started_ms,
        expected_source, peek_library, drop_library,
        peek_ok && drop_ok && stream_index && device_index && device_name && sample_spec ? "true" : "false",
        MAX_SECONDS, MAX_ROWS);
    emit(line, (size_t)n);
    atomic_store(&enabled, 1);
    if (pthread_create(&writer, NULL, write_intervals, NULL) == 0) writer_started = 1;
    else { atomic_store(&enabled, 0); atomic_store(&lost, 1); }
}
__attribute__((destructor)) static void stop_observer(void) {
    atomic_store(&stopped, 1);
    if (writer_started) pthread_join(writer, NULL);
    if (fd >= 0) close(fd);
}
