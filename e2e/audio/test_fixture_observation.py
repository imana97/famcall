import unittest
import numpy as np
from scipy.signal import resample_poly

from fixture_observation import analyze_observer_pcm, observer_route


class FixtureObservationTests(unittest.TestCase):
    def test_route_requires_owned_pid_exact_source_and_format(self):
        stream = {"index": 4, "source": 0, "sample_specification": "s16le 2ch 44100Hz",
                  "application": {"application.process.id": "123"}}
        routes = {"source-outputs": [stream]}
        self.assertEqual(observer_route(routes, 123, 0)["index"], 4)
        for pid, source in ((124, 0), (123, 1)):
            with self.assertRaises(ValueError):
                observer_route(routes, pid, source)
        for changed in (dict(stream, sample_specification="s16le 1ch 48000Hz"), stream):
            bad = [changed] if changed != stream else [stream, stream]
            with self.assertRaises(ValueError):
                observer_route({"source-outputs": bad}, 123, 0)

    def test_host_channels_are_measured_independently(self):
        # Speech-band deterministic data avoids a pass from a single periodic tone.
        low_rate = np.random.default_rng(601).normal(0, 0.05, 6 * 2000)
        reference = resample_poly(low_rate, 4, 1)
        host = resample_poly(reference, 441, 80)
        pcm = np.rint(host * 32768).astype("<i2")
        paired = np.column_stack((pcm, pcm)).astype("<i2").tobytes()
        self.assertTrue(analyze_observer_pcm(reference, paired)["contentMatched"])
        one_silent = np.column_stack((pcm, np.zeros_like(pcm))).astype("<i2").tobytes()
        result = analyze_observer_pcm(reference, one_silent)
        self.assertFalse(result["contentMatched"])
        self.assertTrue(result["channelResults"][0]["content"]["passed"])
        self.assertFalse(result["channelResults"][1]["content"]["passed"])

    def test_empty_and_incomplete_host_frames_are_unknown(self):
        reference = np.ones(32000)
        for raw in (b"", b"\x00\x00\x00"):
            with self.assertRaises(ValueError):
                analyze_observer_pcm(reference, raw)


if __name__ == "__main__":
    unittest.main()
