import copy
import unittest

import numpy as np

from source_evidence import call_participants, source_activity


class SourceEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.participants = {"callId": "call", "senderUid": "sender", "receiverUid": "receiver"}
        self.reference = np.full(30 * 16000, 0.1)
        self.entries = [self.event(t, t * .01) for t in range(2, 30, 3)]

    def event(self, seconds, energy, peer="sender", stream="source", call="call"):
        return {"kind": "stats", "uid": peer, "callId": call, "receivedAt": seconds * 1000,
                "rows": [{"id": stream, "type": "media-source", "kind": "audio",
                          "totalAudioEnergy": energy, "totalSamplesDuration": seconds}]}

    def analyze(self, entries=None, reference=None):
        return source_activity(self.entries if entries is None else entries, self.participants, 0,
                               self.reference if reference is None else reference)

    def test_full_activity_passes_but_an_early_burst_followed_by_silence_fails(self):
        self.assertTrue(self.analyze()["verified"])
        stopped = [self.event(t, min(t, 5) * .01) for t in range(2, 30, 3)]
        result = self.analyze(stopped)
        self.assertFalse(result["verified"])
        self.assertIn("Microphone energy absent during generated sound", result["reasons"])
        self.assertEqual(result["coverageSeconds"], 27)

    def test_another_peer_call_or_stream_cannot_supply_missing_source_energy(self):
        silent = [self.event(t, 0) for t in range(2, 30, 3)]
        distractors = [self.event(t, t * .01, peer="receiver") for t in range(2, 30, 3)]
        distractors += [self.event(t, t * .01, call="other") for t in range(2, 30, 3)]
        self.assertFalse(self.analyze(silent + distractors)["verified"])
        self.assertFalse(self.analyze(self.entries[:5] + [self.event(t, t * .01, stream="replacement")
                                                        for t in range(17, 30, 3)])["verified"])

    def test_counter_resets_missing_values_and_observation_gaps_fail_closed(self):
        cases = []
        reset = copy.deepcopy(self.entries)
        reset[4]["rows"][0]["totalAudioEnergy"] = 0
        cases.append(reset)
        for value in [None, float("nan"), float("inf"), True]:
            missing = copy.deepcopy(self.entries)
            missing[4]["rows"][0]["totalSamplesDuration"] = value
            cases.append(missing)
        cases.append(self.entries[::3])
        cases.append(self.entries[:3])
        for entries in cases:
            with self.subTest(entries=entries):
                self.assertFalse(self.analyze(entries)["verified"])

    def test_intentional_reference_pause_does_not_require_source_energy(self):
        reference = self.reference.copy()
        reference[8 * 16000:14 * 16000] = 0
        entries = [self.event(t, (t - max(0, min(t, 14) - 8)) * .01) for t in range(2, 30, 3)]
        self.assertTrue(self.analyze(entries, reference)["verified"])
        self.assertFalse(self.analyze(entries, np.zeros_like(reference))["verified"])

    def test_participants_use_the_new_call_and_explicit_sender_role(self):
        entries = [{"kind": "outgoing-start", "receivedAt": 1000, "callId": "call", "uid": "sender"},
                   {"kind": "outgoing-start", "receivedAt": 100, "callId": "old", "uid": "old-peer"},
                   self.event(2, .1), self.event(2, 0, peer="receiver")]
        self.assertEqual(call_participants(entries, 900, 3000, True), self.participants)
        reverse = call_participants(entries, 900, 3000, False)
        self.assertEqual((reverse["senderUid"], reverse["receiverUid"]), ("receiver", "sender"))
        for bad in [entries[:2], entries + [self.event(2, .1, peer="third")],
                    entries + [{"kind": "outgoing-start", "receivedAt": 1500, "callId": "other", "uid": "other"}]]:
            with self.assertRaises(ValueError):
                call_participants(bad, 900, 3000, True)


if __name__ == "__main__":
    unittest.main()
