"""Verify microphone activity separately from network delivery and intelligibility."""
import math

import numpy as np


def call_participants(entries, since, until, sender_is_caller):
    recent = [e for e in entries if since <= e.get("receivedAt", 0) <= until]
    starts = {(e.get("callId"), e.get("uid")) for e in recent if e.get("kind") == "outgoing-start"}
    if len(starts) != 1:
        raise ValueError("Expected exactly one new outgoing call in this experiment")
    call_id, caller = starts.pop()
    peers = {e.get("uid") for e in recent if e.get("kind") == "stats" and e.get("callId") == call_id}
    if (not isinstance(call_id, str) or not call_id or len(peers) != 2 or caller not in peers
            or any(not isinstance(peer, str) or not peer for peer in peers)):
        raise ValueError("Expected statistics from both identified call participants")
    callee = (peers - {caller}).pop()
    return {"callId": call_id, "senderUid": caller if sender_is_caller else callee,
            "receiverUid": callee if sender_is_caller else caller}


def source_activity(entries, participants, injection_at, reference, sample_rate=16000):
    """Require sustained source energy when the generated reference has sound.

    RMS comes from energy/duration counter deltas, as defined by WebRTC Stats.
    This checks presence, not a content match or voice quality. One-second edge
    margins allow startup/drain timing; telemetry must cover 75% of the reference
    with intervals at most five seconds apart. No counters cross stream IDs.
    """
    duration = len(reference) / sample_rate
    groups = {}
    for entry in entries:
        at = entry.get("receivedAt", 0)
        if (entry.get("kind") != "stats" or entry.get("callId") != participants["callId"]
                or entry.get("uid") != participants["senderUid"]
                or not injection_at + 1000 <= at <= injection_at + (duration - 1) * 1000):
            continue
        for row in entry.get("rows", []):
            if row.get("type") == "media-source" and row.get("kind", row.get("mediaType")) == "audio":
                groups.setdefault(row.get("id"), []).append((at, row))
    result = {"verified": False, "senderUid": participants["senderUid"], "callId": participants["callId"],
              "scope": "Microphone activity only; not proof of generated content, network delivery or intelligibility.",
              "minimumRms": 0.0001, "referenceMinimumRms": 0.001,
              "minimumCoverageFraction": 0.75, "maximumObservationGapSeconds": 5,
              "windows": [], "reasons": []}
    if len(groups) != 1 or any(not isinstance(stream, str) or not stream for stream in groups):
        result["reasons"].append("Expected one identified microphone source stream")
        return result
    stream, rows = next(iter(groups.items()))
    result["stream"] = stream
    rows.sort(key=lambda pair: pair[0])
    coverage = 0
    expected_windows = 0
    for (at_a, a), (at_b, b) in zip(rows, rows[1:]):
        elapsed = (at_b - at_a) / 1000
        window = {"from": at_a, "to": at_b, "observedSeconds": elapsed}
        result["windows"].append(window)
        values = [r.get(k) for r in (a, b) for k in ("totalAudioEnergy", "totalSamplesDuration")]
        if (not 0 < elapsed <= 5 or any(isinstance(v, bool) or not isinstance(v, (int, float))
                                       or not math.isfinite(v) or v < 0 for v in values)):
            result["reasons"].append("Missing counters or discontinuous source observations")
            continue
        energy = b["totalAudioEnergy"] - a["totalAudioEnergy"]
        samples_duration = b["totalSamplesDuration"] - a["totalSamplesDuration"]
        if energy < 0 or not elapsed * 0.5 <= samples_duration <= elapsed * 1.5:
            result["reasons"].append("Source counters reset, stalled or advanced inconsistently")
            continue
        coverage += elapsed
        start = int((at_a - injection_at) * sample_rate / 1000)
        end = int((at_b - injection_at) * sample_rate / 1000)
        reference_rms = float(np.sqrt(np.mean(reference[start:end] ** 2)))
        rms = math.sqrt(energy / samples_duration)
        expected = reference_rms >= result["referenceMinimumRms"]
        window.update({"energyDelta": energy, "sampleSeconds": samples_duration, "rms": rms,
                       "referenceRms": reference_rms, "soundExpected": expected})
        if expected:
            expected_windows += 1
            if rms < result["minimumRms"]:
                result["reasons"].append("Microphone energy absent during generated sound")
    result["coverageSeconds"] = coverage
    result["expectedSoundWindows"] = expected_windows
    if coverage < duration * result["minimumCoverageFraction"] or not expected_windows:
        result["reasons"].append("Insufficient source/reference activity evidence")
    result["reasons"] = list(dict.fromkeys(result["reasons"]))
    result["verified"] = not result["reasons"]
    return result
