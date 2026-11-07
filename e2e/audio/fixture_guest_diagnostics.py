"""Read-only, allowlisted guest audio observations; never an audio pass criterion.

The adb callback has run.py's signature. No command changes log levels, services,
permissions, or audio settings. Do not persist command stdout/stderr: only the
returned parsed fields are intended for artifacts. A missing event is not proof
that the HAL did not insert silence (log filtering/buffer loss remain possible).
"""
from concurrent.futures import ThreadPoolExecutor
import re
import time

# Android16 goldfish Android.bp defines this exact tag; a vendor image may
# differ, so absence remains unknown instead of implying no driver zero-fill.
# https://android.googlesource.com/device/generic/goldfish/+/android16-release/hals/audio/
HAL_TAG = "android.hardware.audio@7.1-impl.ranchu"
MAX_TEXT = 1024 * 1024
MAX_ENDPOINTS = 4
MAX_EVENTS = 256


def _now():
    return int(time.time() * 1000)


def _read(adb, *args, deadline=None):
    started = _now()
    try:
        remaining = deadline - time.monotonic() if deadline is not None else 1.2
        if remaining <= 0.02:
            return {"known": False, "reason": "observation-deadline", "at": started}, ""
        result = adb(*args, check=False, timeout=min(1.2, remaining))
        text = result.stdout
        if result.returncode != 0:
            return {"known": False, "reason": "command-failed", "at": started}, ""
        if not isinstance(text, str) or len(text) > MAX_TEXT:
            return {"known": False, "reason": "output-limit", "at": started}, ""
        return {"known": True, "at": started}, text
    except Exception as error:
        # Do not serialize exception messages: they may include command output.
        reason = "timeout" if type(error).__name__ == "TimeoutExpired" else "command-exception"
        return {"known": False, "reason": reason, "at": started}, ""


def _batch(adb, commands, deadline):
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = {key: pool.submit(_read, adb, *args, deadline=deadline) for key, args in commands.items()}
        return {key: task.result() for key, task in tasks.items()}


def _field(result, value, *, recognized=True):
    meta, _ = result
    return {**meta, **({"value": value} if meta["known"] and recognized else
                      {"known": False, "reason": meta.get("reason", "unrecognized-output")})}


def _services(text):
    matches = re.findall(
        r"(?m)^\s*(android\.hardware\.audio@[0-9]+\.[0-9]+::"
        r"I(?:DevicesFactory|Device|PrimaryDevice)/[A-Za-z0-9_.-]+)\s+([0-9]+)\s*$", text)
    return [{"interface": interface, "pid": int(pid)} for interface, pid in matches][:16]


def _aidl_services(text):
    return sorted(set(re.findall(
        r"(?m)^\s*\d+:\s*(android\.hardware\.audio\.core\."
        r"I(?:Module|Config)/[A-Za-z0-9_.-]+):\s*\[", text)))[:16]


def _cards(text):
    return [{"card": int(card), "id": name.strip(), "driver": driver.strip(),
             "label": label.strip()} for card, name, driver, label in re.findall(
        r"(?m)^\s*(\d+)\s+\[([A-Za-z0-9_ -]{1,32})\]\s*:\s*"
        r"([A-Za-z0-9_ .-]{1,48})\s+-\s+([A-Za-z0-9_ .-]{1,96})\s*$", text)][:8]


def _endpoints(text):
    found = []
    for line in text.splitlines():
        match = re.fullmatch(r"\s*(\d{2})-(\d{2}): ([A-Za-z0-9_ .,:()-]{1,160})", line)
        if match and re.search(r"(?:^|:)\s*capture\s+[1-9][0-9]*\s*(?::|$)", match[3]):
            found.append({"card": int(match[1]), "device": int(match[2])})
    return found


def _pcm_fields(text, kind):
    if text.strip() == "closed":
        return {"closed": True}
    fields = {}
    for line in text.splitlines():
        key, separator, value = line.partition(":")
        if not separator:
            continue
        key, value = key.strip(), value.strip()
        if key in {"owner_pid", "delay", "avail", "avail_max", "hw_ptr", "appl_ptr",
                   "channels", "period_size", "buffer_size", "period_step"} and re.fullmatch(r"-?\d+", value):
            fields[key] = int(value)
        elif key == "state" and value in {"OPEN", "SETUP", "PREPARED", "RUNNING", "XRUN",
                                         "DRAINING", "PAUSED", "SUSPENDED", "DISCONNECTED"}:
            fields[key] = value
        elif key == "access" and value in {"MMAP_INTERLEAVED", "MMAP_NONINTERLEAVED", "MMAP_COMPLEX",
                                          "RW_INTERLEAVED", "RW_NONINTERLEAVED"}:
            fields[key] = value
        elif key in {"format", "subformat"} and re.fullmatch(r"(?:[SU](?:8|16|24|32)(?:_3)?_(?:LE|BE)|S8|U8|FLOAT(?:64)?_(?:LE|BE)|STD)", value):
            fields[key] = value
        elif key == "rate":
            match = re.fullmatch(r"(\d+)(?: \((\d+)/(\d+)\))?", value)
            if match:
                fields["rate"] = int(match[1])
        elif key in {"trigger_time", "tstamp"} and re.fullmatch(r"\d+\.\d+", value):
            fields[key] = value
    required = {"state"} if kind == "status" else {"format", "rate", "channels"}
    return fields if required <= fields.keys() else None


def _bool_property(text):
    value = text.strip().lower()
    if not value:
        return {"state": "unset"}
    if value in {"1", "true", "y", "yes", "on", "0", "false", "n", "no", "off"}:
        return {"state": "set", "value": value in {"1", "true", "y", "yes", "on"}}
    return None


def guest_audio_snapshot(adb):
    """Observe HAL registrations/mapped libraries and capture ALSA status.

    Call before recording and, asynchronously, during injection. Bounded command
    timeouts are at most 1.2s with a shared 4s deadline; parallel batches avoid
    adding serial waits to the PCM loop. The callback must honor its timeout.
    Neither service registration nor library presence alone proves a live route.
    `ownerMatchesHalPid` joins the running ALSA owner to observed HIDL services.
    """
    started = _now()
    deadline = time.monotonic() + 4
    results = _batch(adb, {
        "hidl": ("shell", "lshal", "--neat", "--types=b", "-i", "-p"),
        "aidl": ("shell", "service", "list"),
        "cards": ("shell", "cat", "/proc/asound/cards"),
        "pcm": ("shell", "cat", "/proc/asound/pcm"),
        "simulate": ("shell", "getprop", "ro.boot.audio.tinyalsa.simulate_input"),
    }, deadline)
    hidl = _services(results["hidl"][1])
    aidl = _aidl_services(results["aidl"][1])
    cards = _cards(results["cards"][1])
    endpoints = _endpoints(results["pcm"][1])
    prop = _bool_property(results["simulate"][1])
    output = {"startedAt": started,
              "scope": "Read-only guest audio boundary; not a waveform result",
              "hidlServices": _field(results["hidl"], hidl, recognized=bool(hidl)),
              "aidlServices": _field(results["aidl"], aidl, recognized=bool(aidl)),
              "cards": _field(results["cards"], cards, recognized=bool(cards)),
              "captureEndpoints": _field(results["pcm"], endpoints[:MAX_ENDPOINTS],
                                          recognized=bool(endpoints) and len(endpoints) <= MAX_ENDPOINTS),
              "simulateInput": _field(results["simulate"], prop, recognized=prop is not None)}
    pids = sorted({s["pid"] for s in hidl})[:4]
    commands = {f"module:{pid}": ("shell", "cat", f"/proc/{pid}/maps") for pid in pids}
    for endpoint in endpoints[:MAX_ENDPOINTS]:
        card, device = endpoint["card"], endpoint["device"]
        for kind in ("status", "hw_params"):
            commands[f"pcm:{card}:{device}:{kind}"] = (
                "shell", "cat", f"/proc/asound/card{card}/pcm{device}c/sub0/{kind}")
    details = _batch(adb, commands, deadline)
    output["mappedHalLibraries"] = []
    for pid in pids:
        result = details[f"module:{pid}"]
        libraries = sorted(set(re.findall(
            r"(?m)\s(/vendor/lib(?:64)?/hw/android\.hardware\.audio(?:\.legacy)?"
            r"@[0-9]+\.[0-9]+-impl\.ranchu\.so)\s*$", result[1])))
        output["mappedHalLibraries"].append({"pid": pid, **_field(result, libraries, recognized=bool(libraries))})
    output["pcm"] = []
    for endpoint in endpoints[:MAX_ENDPOINTS]:
        card, device = endpoint["card"], endpoint["device"]
        item = {**endpoint, "substream": 0,
                "path": f"/proc/asound/card{card}/pcm{device}c/sub0"}
        for kind in ("status", "hw_params"):
            result = details[f"pcm:{card}:{device}:{kind}"]
            parsed = _pcm_fields(result[1], kind)
            item[kind] = _field(result, parsed, recognized=parsed is not None)
        owner = item["status"].get("value", {}).get("owner_pid")
        item["ownerMatchesHalPid"] = owner in pids if owner is not None and pids else None
        output["pcm"].append(item)
    output["unknown"] = [key for key in ("hidlServices", "aidlServices", "cards", "captureEndpoints", "simulateInput")
                         if not output[key]["known"]]
    if not output["mappedHalLibraries"] or not all(x["known"] for x in output["mappedHalLibraries"]):
        output["unknown"].append("mappedHalLibraries")
    for item in output["pcm"]:
        for kind in ("status", "hw_params"):
            if not item[kind]["known"]:
                output["unknown"].append(f"pcm:{item['card']}:{item['device']}:{kind}")
    output["finishedAt"] = _now()
    return output


def parse_guest_audio_logs(text, started_at_ms, finished_at_ms):
    """Keep only numeric evidence from the pinned ranchu implementation's messages."""
    events = []
    counts = {"lateFrames": 0, "insertedSilenceUs": 0, "pcmReadErrors": 0,
              "pcmOpenErrors": 0, "pcmPrepareErrors": 0, "fallbackTone": 0}
    tag_observed = False
    for line in text.splitlines():
        match = re.fullmatch(r"\s*(\d+\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+"
                             + re.escape(HAL_TAG) + r"\s*:\s*(.*)", line)
        if not match:
            continue
        timestamp = int(float(match[1]) * 1000)
        if not started_at_ms <= timestamp <= finished_at_ms:
            continue
        tag_observed = True
        message = match[5]
        event = None
        late = re.fullmatch(r"TinyalsaSource::read:\d+ pcm_readi was late delivering frames, inserting (\d+) us of silence", message)
        read_error = re.fullmatch(r"pcmRead:\d+ pcm_readi failed with '[^'\n]{0,160}' \((-?\d+)\)", message)
        open_error = re.fullmatch(r"pcmOpen:\d+ pcm_(open|prepare) (?:failed|returned nullptr) for nChannels=(\d+) sampleRateHz=(\d+) period_count=(\d+) period_size=(\d+) isOut=(\d+)(?: with [^\n]{0,160})?", message)
        if late:
            event = {"kind": "lateFrames", "insertedSilenceUs": int(late[1])}
            counts["lateFrames"] += 1
            counts["insertedSilenceUs"] += int(late[1])
        elif read_error:
            event = {"kind": "pcmReadError", "code": int(read_error[1])}
            counts["pcmReadErrors"] += 1
        elif open_error:
            event = {"kind": "pcmOpenError" if open_error[1] == "open" else "pcmPrepareError",
                     "channels": int(open_error[2]), "rate": int(open_error[3]),
                     "periodCount": int(open_error[4]), "periodSize": int(open_error[5]),
                     "isOut": bool(int(open_error[6]))}
            counts["pcmOpenErrors" if open_error[1] == "open" else "pcmPrepareErrors"] += 1
        elif re.fullmatch(r"create:\d+ failed to create alsa source for 'AUDIO_DEVICE_IN_(?:DEFAULT|BUILTIN_MIC)'; creating a tone source instead\.", message):
            event = {"kind": "fallbackTone"}
            counts["fallbackTone"] += 1
        if event is not None and len(events) < MAX_EVENTS:
            events.append({"at": timestamp, "pid": int(match[2]), "tid": int(match[3]), **event})
    return {"tagObservedDuringMeasurement": tag_observed, "counts": counts, "events": events,
            "eventListTruncated": sum(counts[k] for k in counts if k != "insertedSilenceUs") > MAX_EVENTS,
            "absenceIsNotProofOfNoSilence": True}


def guest_audio_logs(adb, started_at_ms, finished_at_ms):
    """Return numeric events only, bounded to the caller's measurement interval."""
    if not (isinstance(started_at_ms, int) and isinstance(finished_at_ms, int)
            and 0 <= started_at_ms <= finished_at_ms):
        raise ValueError("A bounded measurement interval is required")
    result = _read(adb, "logcat", "-b", "main", "-d", "-v", "epoch",
                   "-T", f"{started_at_ms / 1000:.3f}", HAL_TAG + ":D", "*:S")
    meta, text = result
    output = {**meta, "startedAt": started_at_ms, "finishedAt": finished_at_ms,
              "tag": HAL_TAG, "scope": "Allowlisted HAL messages only; not an audio pass criterion",
              "coverageKnown": False,
              "coverageLimit": "No log-level changes; filtering or ring-buffer loss cannot be excluded"}
    if meta["known"]:
        output.update(parse_guest_audio_logs(text, started_at_ms, finished_at_ms))
    return output
