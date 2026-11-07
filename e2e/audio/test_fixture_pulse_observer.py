import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

FIXTURE = Path(__file__).parent / "fixture"
sys.path.insert(0, str(FIXTURE))
from pulse_observer import parse_observation, prepare_observer

HEADER = r'''
#include <stdint.h>
#include <stddef.h>
#define PA_INVALID_INDEX ((uint32_t)-1)
typedef struct pa_stream pa_stream;
typedef enum { PA_SAMPLE_S16LE=3 } pa_sample_format_t;
typedef struct { pa_sample_format_t format; uint32_t rate; uint8_t channels; } pa_sample_spec;
int pa_stream_peek(pa_stream *, const void **, size_t *);
int pa_stream_drop(pa_stream *);
'''
MOCK = r'''
#include <pulse/pulseaudio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
static int16_t data[] = {0, 1000, -2000, 0, 32767, -32768, 0, 0};
static pa_sample_spec spec = {PA_SAMPLE_S16LE, 44100, 2};
static int moved;
static int mode(const char *v) { const char *s=getenv("TEST_MODE"); return s && !strcmp(s,v); }
void move_source(void) { moved=1; }
int pa_stream_peek(pa_stream *s, const void **p, size_t *n) {
 (void)s;
 if(mode("error")) { errno=EBUSY; return -7; }
 *p=mode("hole") || mode("empty") ? NULL : data;
 *n=mode("empty") ? 0 : mode("odd") ? 3 : sizeof(data);
 return 0;
}
int pa_stream_drop(pa_stream *s) { (void)s; return mode("drop-error") ? -8 : 0; }
uint32_t pa_stream_get_index(const pa_stream *s) { (void)s; errno=ERANGE; return 2; }
uint32_t pa_stream_get_device_index(const pa_stream *s) { (void)s; errno=ERANGE; return moved || mode("source") ? 1 : 0; }
const char *pa_stream_get_device_name(const pa_stream *s) { (void)s; errno=ERANGE; return "famcall_input"; }
const pa_sample_spec *pa_stream_get_sample_spec(const pa_stream *s) { (void)s; errno=ERANGE; return &spec; }
'''
CLIENT = r'''
#include <pulse/pulseaudio.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
void move_source(void);
int main(void) {
 const char *mode=getenv("TEST_MODE");
 if(mode && !strcmp(mode,"none")) return 0;
 pa_stream *s=(pa_stream *)0x1234;
 const void *p=NULL; size_t n=0;
 errno=E2BIG; int r=pa_stream_peek(s,&p,&n); int e=errno;
 unsigned sum=0; if(p) for(size_t i=0;i<n;i++) sum+=((const unsigned char *)p)[i];
 printf("peek %d %d %zu %u\n",r,e,n,sum);
 if(mode && !strcmp(mode,"move")) move_source();
 if(mode && !strcmp(mode,"duplicate")) { errno=E2BIG; r=pa_stream_peek(s,&p,&n); printf("again %d %d %zu\n",r,errno,n); }
 if(mode && !strcmp(mode,"empty")) return 0;
 errno=E2BIG; r=pa_stream_drop(s); printf("drop %d %d\n",r,errno);
 if(mode && !strcmp(mode,"unknown-drop")) { errno=E2BIG; r=pa_stream_drop(s); printf("extra %d %d\n",r,errno); }
 return 0;
}
'''


class NativeObserverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("cc"):
            raise unittest.SkipTest("C compiler unavailable")
        cls.tmp = tempfile.TemporaryDirectory(prefix="famcall-pulse-test-")
        cls.root = Path(cls.tmp.name)
        (cls.root / "pulse").mkdir()
        (cls.root / "pulse/pulseaudio.h").write_text(HEADER)
        (cls.root / "mock.c").write_text(MOCK)
        (cls.root / "client.c").write_text(CLIENT)
        cls.apple = sys.platform == "darwin"
        shared = ["-dynamiclib"] if cls.apple else ["-shared", "-fPIC"]
        suffix = ".dylib" if cls.apple else ".so"
        cls.lib = cls.root / ("libpulse.0" + suffix)
        cls.shim = cls.root / ("libobserver" + suffix)
        cls.client = cls.root / "qemu-system-x86_64"
        compile_common = ["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-I", str(cls.root)]
        def build(args):
            subprocess.run(args, check=True, capture_output=True, text=True)
        build([*compile_common, *shared, str(cls.root / "mock.c"), "-o", str(cls.lib)])
        build([*compile_common, *shared, str(FIXTURE / "pulse_observer.c"), "-pthread",
               *([str(cls.lib)] if cls.apple else ["-ldl"]), "-o", str(cls.shim)])
        build([*compile_common, str(cls.root / "client.c"), str(cls.lib),
               *(["-Wl,-flat_namespace"] if cls.apple else []), "-o", str(cls.client)])

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_case(self, mode, source=0):
        with tempfile.TemporaryDirectory(dir=self.root) as name:
            folder = Path(name)
            observer = prepare_observer(folder, self.shim, source)
            base = dict(os.environ, TEST_MODE=mode)
            for key in ["LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "ANDROID_EMU_PRELOAD_LIBGCC"]:
                base.pop(key, None)
            baseline = subprocess.run([self.client], env=base, check=True, capture_output=True).stdout
            env = observer.emulator_env(base)
            if self.apple:
                env["DYLD_INSERT_LIBRARIES"] = env.pop("LD_PRELOAD")
                env["DYLD_FORCE_FLAT_NAMESPACE"] = "1"
            process = subprocess.Popen([self.client], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            out, error = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, error)
            self.assertEqual(out, baseline, "Observer changed PCM/return/errno output")
            result = observer.finish(process.pid)
            self.assertEqual(result["constructor"]["pid"], process.pid)
            self.assertTrue(result["constructor"]["bindingsVerified"])
            self.assertEqual(observer.path.stat().st_mode & 0o777, 0o600)
            self.assertLessEqual(len(observer.path.read_bytes().splitlines()), 1024)
            return result

    def test_real_calls_are_transparent_and_counted(self):
        result = self.run_case("duplicate")
        self.assertTrue(result["complete"], result)
        self.assertTrue(result["callbackBindingVerified"])
        rows = result["rows"]
        self.assertEqual(sum(r["peekCalls"] for r in rows), 2)
        self.assertEqual(sum(r["peekBytes"] for r in rows), 16)
        self.assertEqual(sum(r["dropBytes"] for r in rows), 16)
        self.assertEqual(sum(r["dropNonzeroSamples"] for r in rows), 4)
        self.assertEqual(max(r["dropPeak"] for r in rows), 32768)

    def test_empty_hole_and_failure_results_remain_unchanged(self):
        for mode, key in [("empty", "emptyPeekCalls"), ("hole", "holeCalls"),
                          ("error", "peekErrors"), ("drop-error", "dropErrors")]:
            with self.subTest(mode=mode):
                result = self.run_case(mode)
                self.assertGreater(sum(r[key] for r in result["rows"]), 0)

    def test_no_callbacks_is_unknown_not_silence(self):
        result = self.run_case("none")
        self.assertFalse(result["complete"])
        self.assertIn("callbacks-not-observed", result["unknown"])

    def test_wrong_source_and_changed_source_are_unknown(self):
        for mode in ["source", "move"]:
            with self.subTest(mode=mode):
                result = self.run_case(mode)
                self.assertFalse(result["complete"])
                self.assertIn("source-or-format-mismatch", result["unknown"])

    def test_uninspected_shape_and_unknown_drop_are_unknown(self):
        for mode in ["odd", "unknown-drop"]:
            with self.subTest(mode=mode):
                result = self.run_case(mode)
                self.assertFalse(result["complete"])
                self.assertIn("incomplete-callback-observation", result["unknown"])

    def test_env_is_copied_and_existing_preload_refused(self):
        with tempfile.TemporaryDirectory(dir=self.root) as name:
            observer = prepare_observer(name, self.shim, 0)
            base = {"PULSE_SOURCE": "famcall_input"}
            observer.emulator_env(base)
            self.assertNotIn("LD_PRELOAD", base)
            for collision in [{"LD_PRELOAD": "existing.so"}, {"ANDROID_EMU_PRELOAD_LIBGCC": "1"}]:
                with self.assertRaises(ValueError):
                    observer.emulator_env(collision)

    def test_constructor_without_pulse_exports_does_not_abort(self):
        with tempfile.TemporaryDirectory(dir=self.root) as name:
            folder = Path(name)
            source = folder / "empty.c"
            source.write_text("int main(void) { return 0; }\n")
            client = folder / "qemu-system-x86_64"
            shim = folder / ("unbound.dylib" if self.apple else "unbound.so")
            subprocess.run(["cc", str(source), "-o", str(client)], check=True, capture_output=True)
            subprocess.run(["cc", "-std=c11", "-I", str(self.root),
                            *(["-dynamiclib"] if self.apple else ["-shared", "-fPIC"]),
                            str(FIXTURE / "pulse_observer.c"), "-pthread",
                            *([] if self.apple else ["-ldl"]), "-o", str(shim)],
                           check=True, capture_output=True)
            observer = prepare_observer(folder, shim, 0)
            env = observer.emulator_env({"PATH": os.environ["PATH"]})
            if self.apple:
                env["DYLD_INSERT_LIBRARIES"] = env.pop("LD_PRELOAD")
            process = subprocess.Popen([client], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            _, error = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, error)
            result = observer.finish(process.pid)
            self.assertFalse(result["complete"])
            self.assertIn("next-libpulse-binding-unverified", result["unknown"])


class ParserTests(unittest.TestCase):
    def fixture(self):
        header = {"kind": "constructor", "pid": 42, "atMs": 1000,
                  "expectedSourceId": 0, "bindingsVerified": True}
        counters = {k: 0 for k in ["dataPeekCalls", "emptyPeekCalls", "holeCalls", "peekErrors",
                    "dropErrors", "peekBytes", "dropBytes", "peekNonzeroSamples", "dropNonzeroSamples",
                    "peekPeak", "dropPeak", "oversizeFragments", "uninspectedFragments", "unknownDrops"]}
        row = dict(counters, kind="interval", pid=42, startMs=1000, endMs=2000,
                   streamId=2, sourceId=0, rate=44100, channels=2, format=3,
                   routeMatches=True, peekCalls=1, dropCalls=1, lostObservation=False,
                   routeInvalidDuringInterval=False, routeChangedDuringInterval=False)
        row.update(dataPeekCalls=1, peekBytes=16, dropBytes=16)
        return header, row

    def encode(self, *rows):
        return ("\n".join(json.dumps(r) for r in rows) + "\n").encode()

    def test_missing_constructor_binding_pid_and_source_are_unknown(self):
        header, row = self.fixture()
        cases = [([], "constructor-unavailable-or-duplicate"),
                 ([dict(header, bindingsVerified=False), row], "next-libpulse-binding-unverified"),
                 ([dict(header, pid=7), row], "constructor-pid-mismatch"),
                 ([header, dict(row, sourceId=1)], "source-or-format-mismatch")]
        for records, reason in cases:
            result = parse_observation(self.encode(*records) if records else b"", 42, 0)
            self.assertFalse(result["complete"])
            self.assertIn(reason, result["unknown"])
        self.assertIn("qemu-pid-unavailable", parse_observation(self.encode(header, row), None, 0)["unknown"])

    def test_partial_buckets_and_unflushed_tail_remain_explicit(self):
        header, row = self.fixture()
        raw = self.encode(header, row, dict(row, startMs=2000, endMs=3000),
                          dict(row, startMs=3000, endMs=4000))
        result = parse_observation(raw, 42, 0, 1500, 3500)
        self.assertEqual([r["injectionOverlap"] for r in result["rows"]], ["partial", "within", "partial"])
        self.assertTrue(result["unflushedTailUnknown"])
        truncated = parse_observation(raw + b'{"kind":', 42, 0)
        self.assertIn("partial-final-line", truncated["unknown"])
        self.assertEqual(len(truncated["rows"]), 3)

    def test_bounds_reject_oversize_and_too_many_rows(self):
        self.assertIn("file-bound-exceeded", parse_observation(b" " * (1024 * 2048 + 1), 42, 0)["unknown"])
        self.assertIn("row-bound-exceeded", parse_observation(b"{}\n" * 1025, 42, 0)["unknown"])

    def test_invalid_injection_window_never_raises_or_becomes_silence(self):
        header, row = self.fixture()
        for start, end in [("bad", 3000), (1000, None), (3000, 1000), (True, 3000)]:
            result = parse_observation(self.encode(header, row), 42, 0, start, end)
            self.assertIn("injection-window-invalid", result["unknown"])
            self.assertEqual(result["rows"][0]["injectionOverlap"], "unknown")

    def test_impossible_statistics_are_unknown(self):
        header, row = self.fixture()
        for patch in [{"dropNonzeroSamples": 999999}, {"dropPeak": 40000},
                      {"peekPeak": 10}, {"dataPeekCalls": 0}]:
            result = parse_observation(self.encode(header, dict(row, **patch)), 42, 0)
            self.assertIn("inconsistent-interval-statistics", result["unknown"])

    def test_pending_fragment_may_cross_interval_boundary(self):
        header, row = self.fixture()
        row.update(peekCalls=0, dataPeekCalls=0, peekBytes=0, dropBytes=16,
                   dropNonzeroSamples=4, dropPeak=32768)
        self.assertTrue(parse_observation(self.encode(header, row), 42, 0)["complete"])


if __name__ == "__main__":
    unittest.main()
