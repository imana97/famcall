"""Independent observations of the generated Pulse source; never an Android pass."""
import numpy as np
from scipy.signal import resample_poly

from fixture_analysis import analyze

OBSERVER_RATE = 44100
OBSERVER_CHANNELS = 2
OBSERVER_SPEC = "s16le 2ch 44100Hz"


def observer_route(routes, pid, source_id):
    """Return only the owned observer's verified source route, or reject it."""
    streams = [s for s in routes.get("source-outputs", [])
               if str(s.get("application", {}).get("application.process.id")) == str(pid)]
    if len(streams) != 1:
        raise ValueError("Expected exactly one owned observer stream")
    stream = streams[0]
    if stream.get("source") != source_id or stream.get("sample_specification") != OBSERVER_SPEC:
        raise ValueError("Observer source or format differs from the requested virtual input")
    return stream


def analyze_observer_pcm(reference, raw):
    """Compare each observed host channel independently at the existing 8 kHz gate."""
    frame_bytes = OBSERVER_CHANNELS * 2
    if not raw or len(raw) % frame_bytes:
        raise ValueError("Observer PCM is empty or ends with an incomplete stereo frame")
    samples = np.frombuffer(raw, dtype="<i2").reshape(-1, OBSERVER_CHANNELS)
    channels = []
    for index in range(OBSERVER_CHANNELS):
        pcm = samples[:, index].astype(float)
        content = analyze(reference, resample_poly(pcm / 32768.0, 80, 441))
        channels.append({"channel": index, "peakPcm16": int(np.max(np.abs(pcm))),
                         "zeroFraction": float(np.mean(pcm == 0)), "content": content})
    return {"rate": OBSERVER_RATE, "channels": OBSERVER_CHANNELS, "frameCount": len(samples),
            "capturedSeconds": len(samples) / OBSERVER_RATE, "channelResults": channels,
            "contentMatched": all(c["content"]["passed"] for c in channels),
            "scope": "Generated Pulse source only; does not establish Android or call success"}
