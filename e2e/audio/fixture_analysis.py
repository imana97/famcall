"""Qualify known synthetic PCM input; no WebRTC or voice-quality conclusions."""
import numpy as np
from scipy.signal import correlate


def best_match(reference, captured):
    if len(captured) < len(reference) or not np.any(reference):
        return 0.0, 0
    dot = correlate(captured, reference, mode="valid", method="fft")
    energy = np.concatenate(([0.0], np.cumsum(captured * captured)))
    norm = np.sqrt(np.maximum(0, energy[len(reference):] - energy[:-len(reference)])
                   * np.dot(reference, reference))
    scores = np.divide(dot, norm, out=np.zeros_like(dot), where=norm > 1e-12)
    offset = int(np.argmax(scores))
    return float(np.clip(scores[offset], -1, 1)), offset


def analyze(reference, captured, rate=8000):
    reference = np.asarray(reference, dtype=float)
    captured = np.asarray(captured, dtype=float)
    if (len(reference) < 4 * rate or not np.all(np.isfinite(reference)) or
            not np.all(np.isfinite(captured))):
        raise ValueError("Need finite PCM and at least four seconds of reference")
    score, offset = best_match(reference, captured)
    windows = []
    for start in range(0, len(reference) - 2 * rate + 1, 2 * rate):
        source = reference[start:start + 2 * rate]
        if np.sqrt(np.mean(source * source)) < 0.001:
            continue
        begin = max(0, offset + start - rate // 4)
        end = min(len(captured), offset + start + 2 * rate + rate // 4)
        match, delta = best_match(source, captured[begin:end])
        windows.append({"sourceSeconds": start / rate, "correlation": match,
                        "capturedSeconds": (begin + delta) / rate})
    matched = sum(w["correlation"] >= 0.6 for w in windows)
    coverage = matched / len(windows) if windows else 0.0
    return {"passed": score >= 0.75 and coverage >= 0.9 and len(windows) >= 2,
            "correlation": score, "offsetSeconds": offset / rate,
            "activeWindowMatchFraction": coverage, "windows": windows,
            "referenceSeconds": len(reference) / rate, "capturedSeconds": len(captured) / rate,
            "thresholds": {"wholeClipCorrelation": 0.75, "windowCorrelation": 0.6,
                           "activeWindowMatchFraction": 0.9, "windowSeconds": 2,
                           "windowSearchRadiusSeconds": 0.25}}
