import unittest
import numpy as np
from recovery import speech_recovery


class SpeechRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.rate = 8000
        self.reference = np.random.default_rng(17).normal(0, 0.05, 18 * self.rate)
        self.chunks = [{"at": ms, "endSample": ms * self.rate // 1000} for ms in range(20, 18001, 20)]
        self.outage = {"blockedAt": 5000, "restoredAt": 7000, "injectionStartedAt": 0}

    def analyze(self, received):
        return speech_recovery(self.reference, received, self.chunks, self.outage, self.rate)

    def test_confirms_new_audio_after_gap_and_bounds_observation(self):
        received = self.reference.copy()
        received[5 * self.rate:8 * self.rate] = 0
        result = self.analyze(received)
        self.assertTrue(result["baselineSpeechVerified"])
        self.assertTrue(result["recoveredSpeech"])
        self.assertGreaterEqual(result["referenceSeconds"], 8)
        self.assertGreaterEqual(result["confirmationUpperBoundMs"], 3000)
        self.assertLess(result["confirmationUpperBoundMs"], 3400)

    def test_packets_with_silence_do_not_prove_speech_recovery(self):
        received = self.reference.copy()
        received[5 * self.rate:] = 0
        result = self.analyze(received)
        self.assertTrue(result["baselineSpeechVerified"])
        self.assertFalse(result["recoveredSpeech"])

    def test_replayed_pre_outage_audio_is_not_new_speech(self):
        received = self.reference.copy()
        received[5 * self.rate:] = np.resize(self.reference[:4 * self.rate], 13 * self.rate)
        result = self.analyze(received)
        self.assertTrue(result["baselineSpeechVerified"])
        self.assertFalse(result["recoveredSpeech"])


if __name__ == "__main__":
    unittest.main()
