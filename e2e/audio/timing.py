"""Summarize native playout counters without treating missing data as zero."""
COUNTERS = (
    "totalSamplesReceived", "concealedSamples", "silentConcealedSamples",
    "concealmentEvents", "insertedSamplesForDeceleration", "removedSamplesForAcceleration",
    "jitterBufferDelay", "jitterBufferTargetDelay", "jitterBufferMinimumDelay",
    "jitterBufferEmittedCount", "totalAudioEnergy",
)


def counter_window(samples):
    if len(samples) < 2:
        return {"available": False, "reason": "Fewer than two observations"}
    rows = sorted(samples, key=lambda row: row["at"])
    first, last = rows[0], rows[-1]
    if last["at"] <= first["at"]:
        return {"available": False, "reason": "No elapsed observation interval"}
    deltas, missing, resets = {}, [], []
    for field in COUNTERS:
        if any(not isinstance(row.get(field), (int, float)) for row in rows):
            missing.append(field)
        elif any(b[field] < a[field] for a, b in zip(rows, rows[1:])):
            resets.append(field)
        else:
            deltas[field] = last[field] - first[field]
    emitted = deltas.get("jitterBufferEmittedCount", 0)
    averages = {field: 1000 * deltas[field] / emitted for field in
                ("jitterBufferDelay", "jitterBufferTargetDelay", "jitterBufferMinimumDelay")
                if field in deltas and emitted > 0}
    return {"available": True, "from": first["at"], "to": last["at"],
            "observedSeconds": (last["at"] - first["at"]) / 1000,
            "deltas": deltas, "missingCounters": missing, "resetCounters": resets,
            "meanBufferMs": averages}


def playout_timing(entries, report):
    outage = report["outage"]
    groups = {}
    for entry in entries:
        at = entry.get("receivedAt", 0)
        if entry.get("kind") != "stats" or entry.get("callId") not in report["callIds"] or not report["startedAt"] <= at <= report["finishedAt"]:
            continue
        phase = "before" if at < outage["blockedAt"] else "after" if at > outage["restoredAt"] else "during"
        for row in entry.get("rows", []):
            if row.get("type") == "inbound-rtp":
                groups.setdefault((entry["uid"], row["id"], phase), []).append({**row, "at": at})
    return [{"peer": peer, "stream": stream, "phase": phase, **counter_window(rows)}
            for (peer, stream, phase), rows in sorted(groups.items())]
