"""Conservative evidence of new received speech after a planned relay outage.

The timestamp is when a complete matching PCM window reached the lab. It is an
observation upper bound, not exact mouth-to-ear delay or a human speech score.
"""
import numpy as np
from scipy.signal import correlate
from pystoi import stoi


def match_window(window, reference, sample_rate=16000):
    if len(window) < sample_rate or len(reference) < len(window):
        return None
    signal = window - np.mean(window)
    energy = float(np.dot(signal, signal))
    if energy / len(window) < 0.0001 ** 2:
        return None
    n = len(window)
    sums = np.concatenate(([0.0], np.cumsum(reference)))
    squares = np.concatenate(([0.0], np.cumsum(reference ** 2)))
    ref_energy = squares[n:] - squares[:-n] - (sums[n:] - sums[:-n]) ** 2 / n
    correlations = correlate(reference, signal, mode="valid", method="fft")
    scores = correlations / np.sqrt(energy * np.maximum(ref_energy, 1e-20))
    scores[ref_energy / n < 0.0001 ** 2] = 0
    index = int(np.argmax(scores))
    return {"referenceSample": index, "correlation": float(scores[index])}


def speech_recovery(reference, received, capture_chunks, outage, sample_rate=16000):
    # A long, nonrepeating reference prevents pre-outage concealed/replayed
    # audio from being mistaken for newly delivered speech after restoration.
    threshold = 0.35
    window = 2 * sample_rate
    before_end = next((c["endSample"] for c in capture_chunks if c["at"] >= outage["blockedAt"]), 0)
    before = received[:max(0, before_end - window)]
    baseline = None
    for start in range(sample_rate, len(before) - window + 1, sample_rate // 2):
        found = match_window(before[start:start + window], reference[:12 * sample_rate], sample_rate)
        if found and found["correlation"] >= threshold:
            baseline = {**found, "receivedSample": start}
            break
    result = {"baselineSpeechVerified": baseline is not None, "baseline": baseline,
              "recoveredSpeech": False, "confirmationUpperBoundMs": None,
              "correlationThreshold": threshold, "windowSeconds": 2, "postRecoveryStoi": None}
    # Require a reference segment generated at least one second after link
    # restoration. Late packets from before the outage cannot satisfy this.
    source_floor = int((outage["restoredAt"] - outage["injectionStartedAt"]) / 1000 * sample_rate) + sample_rate
    capture_floor = next((c["endSample"] for c in capture_chunks if c["at"] >= outage["restoredAt"]), len(received))
    for start in range(capture_floor, len(received) - window + 1, sample_rate // 4):
        found = match_window(received[start:start + window], reference[source_floor:], sample_rate)
        if not found or found["correlation"] < threshold:
            continue
        source_start = source_floor + found["referenceSample"]
        observed = next((c["at"] for c in capture_chunks if c["endSample"] >= start + window), None)
        if observed is None:
            continue
        length = min(10 * sample_rate, len(received) - start, len(reference) - source_start)
        score = float(stoi(reference[source_start:source_start + length], received[start:start + length], sample_rate)) if length >= 3 * sample_rate else None
        result.update({"recoveredSpeech": True, "confirmationUpperBoundMs": observed - outage["restoredAt"],
                       "referenceSeconds": source_start / sample_rate, "receivedSeconds": start / sample_rate,
                       "correlation": found["correlation"], "postRecoveryStoi": score,
                       "postRecoveryComparedSeconds": length / sample_rate})
        break
    return result
