import unittest
import numpy as np
from fixture_analysis import analyze


class FixtureAnalysisTests(unittest.TestCase):
    def setUp(self):
        # Different content in each time window catches replay as well as silence.
        self.rate = 1000
        self.source = np.random.default_rng(197).normal(0, 0.1, 10 * self.rate)

    def test_known_content_survives_gain_and_capture_delay(self):
        captured = np.concatenate((np.zeros(777), self.source * 0.35, np.zeros(1000)))
        report = analyze(self.source, captured, self.rate)
        self.assertTrue(report["passed"])
        self.assertAlmostEqual(report["offsetSeconds"], 0.777)

    def test_silence_unrelated_audio_and_short_burst_fail(self):
        candidates = [np.zeros(12000), np.random.default_rng(198).normal(0, 0.1, 12000),
                      np.concatenate((self.source[:2000], np.zeros(10000)))]
        for captured in candidates:
            with self.subTest():
                self.assertFalse(analyze(self.source, captured, self.rate)["passed"])

    def test_replayed_early_content_and_missing_middle_fail(self):
        for captured in (np.tile(self.source[:2000], 6),
                         np.concatenate((self.source[:4000], np.zeros(4000), self.source[8000:]))):
            with self.subTest():
                self.assertFalse(analyze(self.source, captured, self.rate)["passed"])

    def test_silent_reference_and_truncated_capture_fail(self):
        self.assertFalse(analyze(np.zeros(10000), np.zeros(12000), self.rate)["passed"])
        self.assertFalse(analyze(self.source, self.source[:7000], self.rate)["passed"])

    def test_nonfinite_input_rejected(self):
        with self.assertRaises(ValueError):
            analyze(self.source, np.array([float("nan")]), self.rate)


if __name__ == "__main__":
    unittest.main()
