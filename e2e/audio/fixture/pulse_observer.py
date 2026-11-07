"""Bounded evidence from QEMU's Pulse input boundary; never an audio pass gate."""
import hashlib
import json
import os
from pathlib import Path
import stat

MAX_ROWS = 1024
MAX_BYTES = MAX_ROWS * 2048


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def observer_provenance(shared_library):
    return {"sourceSha256": _sha(Path(__file__).with_suffix(".c")),
            "helperSha256": _sha(__file__), "sharedLibrarySha256": _sha(shared_library)}


def _overlap(row, start, end):
    if type(start) is not int or type(end) is not int or end <= start:
        return "unknown"
    if row["endMs"] <= start:
        return "before"
    if row["startMs"] >= end:
        return "after"
    if row["startMs"] >= start and row["endMs"] <= end:
        return "within"
    return "partial"


def parse_observation(raw, expected_qemu_pid, expected_source_id,
                      injection_started_at_ms=None, injection_finished_at_ms=None):
    """Validate identity/binding and retain complete interval evidence, not a score."""
    result = {"complete": False, "unknown": [], "rows": [],
              "completenessScope": "Validated observed intervals only; not full injection-window or tail coverage",
              "fullInjectionCoverage": "not evaluated",
              "scope": "Observed libpulse calls in QEMU; not guest capture or speech qualification"}
    unknown = result["unknown"]
    if not isinstance(expected_qemu_pid, int) or expected_qemu_pid <= 0:
        unknown.append("qemu-pid-unavailable")
    if len(raw) > MAX_BYTES:
        unknown.append("file-bound-exceeded")
        return result
    lines = raw.splitlines()
    if len(lines) > MAX_ROWS:
        unknown.append("row-bound-exceeded")
        return result
    if raw and not raw.endswith(b"\n"):
        unknown.append("partial-final-line")
        lines = lines[:-1]
    try:
        records = [json.loads(line) for line in lines]
        if any(not isinstance(r, dict) for r in records):
            raise ValueError("non-object row")
    except (ValueError, UnicodeDecodeError):
        unknown.append("invalid-json")
        return result
    headers = [r for r in records if r.get("kind") == "constructor"]
    if len(headers) != 1:
        unknown.append("constructor-unavailable-or-duplicate")
        return result
    header = headers[0]
    result["constructor"] = header
    if header.get("pid") != expected_qemu_pid:
        unknown.append("constructor-pid-mismatch")
    if header.get("bindingsVerified") is not True:
        unknown.append("next-libpulse-binding-unverified")
    if header.get("expectedSourceId") != expected_source_id:
        unknown.append("expected-source-mismatch")
    callbacks = 0
    expected_fields = ("peekCalls", "dataPeekCalls", "emptyPeekCalls", "holeCalls", "peekErrors",
                       "dropCalls", "dropErrors", "peekBytes", "dropBytes", "peekNonzeroSamples",
                       "dropNonzeroSamples", "peekPeak", "dropPeak", "oversizeFragments",
                       "uninspectedFragments", "unknownDrops")
    previous_end = {}
    for row in records:
        if row.get("kind") != "interval":
            continue
        fields = (*expected_fields, "startMs", "endMs", "streamId", "sourceId", "rate", "channels", "format")
        if any(type(row.get(k)) is not int or row[k] < 0 for k in fields):
            unknown.append("invalid-interval-fields")
            continue
        if row.get("pid") != expected_qemu_pid:
            unknown.append("callback-pid-mismatch")
            continue
        if (row["peekCalls"] != sum(row[k] for k in ("dataPeekCalls", "emptyPeekCalls", "holeCalls", "peekErrors")) or
                any(row[prefix + "NonzeroSamples"] > row[prefix + "Bytes"] // 2 or
                    row[prefix + "Peak"] > 32768 or
                    bool(row[prefix + "Peak"]) != bool(row[prefix + "NonzeroSamples"])
                    for prefix in ("peek", "drop"))):
            unknown.append("inconsistent-interval-statistics")
            continue
        if row["endMs"] < row["startMs"] or row["startMs"] < previous_end.get(row["streamId"], 0):
            unknown.append("invalid-interval-order")
            continue
        previous_end[row["streamId"]] = row["endMs"]
        row = dict(row, injectionOverlap=_overlap(row, injection_started_at_ms, injection_finished_at_ms))
        result["rows"].append(row)
        callbacks += row["peekCalls"] + row["dropCalls"] + row["dropErrors"]
        if (row.get("routeMatches") is not True or row["sourceId"] != expected_source_id or
                (row["rate"], row["channels"], row["format"]) != (44100, 2, 3)):
            unknown.append("source-or-format-mismatch")
        if (row.get("lostObservation") is not False or row["oversizeFragments"] or
                row["uninspectedFragments"] or row["unknownDrops"] or
                row.get("routeInvalidDuringInterval") is not False or
                row.get("routeChangedDuringInterval") is not False):
            unknown.append("incomplete-callback-observation")
    if not callbacks:
        unknown.append("callbacks-not-observed")
    result["callbackBindingVerified"] = bool(callbacks and header.get("bindingsVerified") is True
                                              and header.get("pid") == expected_qemu_pid)
    endings = [r for r in records if r.get("kind") == "end"]
    result["tailFlushed"] = bool(len(endings) == 1 and endings[0].get("pid") == expected_qemu_pid)
    if endings and any(r.get("boundReached") is not False or r.get("lostObservation") is not False for r in endings):
        unknown.append("observation-bound-or-loss")
    # SIGTERM can prevent destructors. Completed periodic rows remain evidence;
    # absence of the final row never turns the unflushed tail into observed silence.
    result["unflushedTailUnknown"] = not result["tailFlushed"]
    if injection_started_at_ms is not None or injection_finished_at_ms is not None:
        if (type(injection_started_at_ms) is not int or type(injection_finished_at_ms) is not int or
                injection_finished_at_ms <= injection_started_at_ms):
            unknown.append("injection-window-invalid")
        elif not any(r["injectionOverlap"] == "within" for r in result["rows"]):
            unknown.append("no-complete-injection-interval")
    result["unknown"] = sorted(set(unknown))
    result["complete"] = not result["unknown"]
    return result


class PulseInputObserver:
    def __init__(self, folder, shared_library, expected_source_id):
        if type(expected_source_id) is not int or expected_source_id < 0:
            raise ValueError("Invalid generated source identity")
        self.library = Path(shared_library).resolve(strict=True)
        self.path = Path(folder).resolve() / "qemu-pulse-observer.jsonl"
        self.source_id = expected_source_id
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        self.provenance = observer_provenance(self.library)

    def emulator_env(self, base_env):
        env = dict(base_env)
        # The launcher has a preloading workaround which overwrites LD_PRELOAD.
        # Do not silently change it, or replace other preloads: report unavailable.
        if env.get("LD_PRELOAD") or env.get("ANDROID_EMU_PRELOAD_LIBGCC") == "1":
            raise ValueError("Existing emulator preloading prevents isolated observation")
        env["LD_PRELOAD"] = str(self.library)
        env["FAMCALL_PULSE_OBSERVER_PATH"] = str(self.path)
        env["FAMCALL_PULSE_OBSERVER_SOURCE_ID"] = str(self.source_id)
        return env

    def finish(self, expected_qemu_pid, injection_started_at_ms=None, injection_finished_at_ms=None):
        try:
            info = self.path.lstat()
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
                raise ValueError("Observer evidence must remain a private regular file")
            if info.st_size > MAX_BYTES:
                raise ValueError("Observer exceeded file bound")
            raw = self.path.read_bytes()
            result = parse_observation(raw, expected_qemu_pid, self.source_id,
                                       injection_started_at_ms, injection_finished_at_ms)
            result.update(byteCount=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                          file=self.path.name, provenance=self.provenance)
            return result
        except (OSError, ValueError) as error:
            return {"complete": False, "unknown": ["observer-evidence-unavailable"],
                    "error": type(error).__name__, "rows": [], "provenance": self.provenance}


def prepare_observer(folder, shared_library, expected_source_id):
    return PulseInputObserver(folder, shared_library, expected_source_id)
