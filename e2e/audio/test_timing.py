import unittest
from timing import counter_window, playout_timing


class PlayoutTimingTests(unittest.TestCase):
    def test_average_buffer_uses_counter_deltas(self):
        result = counter_window([
            {"at": 1000, "jitterBufferDelay": 10, "jitterBufferEmittedCount": 100},
            {"at": 4000, "jitterBufferDelay": 12, "jitterBufferEmittedCount": 110},
        ])
        self.assertEqual(result["meanBufferMs"]["jitterBufferDelay"], 200)
        self.assertIn("removedSamplesForAcceleration", result["missingCounters"])
        self.assertNotIn("removedSamplesForAcceleration", result["deltas"])

    def test_reset_then_recovery_does_not_masquerade_as_a_valid_delta(self):
        result = counter_window([{"at": 1000, "removedSamplesForAcceleration": 50},
                                 {"at": 2000, "removedSamplesForAcceleration": 0},
                                 {"at": 3000, "removedSamplesForAcceleration": 100}])
        self.assertIn("removedSamplesForAcceleration", result["resetCounters"])
        self.assertNotIn("removedSamplesForAcceleration", result["deltas"])
        self.assertFalse(counter_window([{"at": 1}])["available"])

    def test_call_and_stream_identity_are_preserved(self):
        report = {"callIds": ["selected"], "startedAt": 100, "finishedAt": 600,
                  "outage": {"blockedAt": 300, "restoredAt": 400}}
        def event(call, stream, at):
            return {"kind": "stats", "callId": call, "uid": "peer", "receivedAt": at,
                    "rows": [{"id": stream, "type": "inbound-rtp", "totalSamplesReceived": at}]}
        groups = playout_timing([event("selected", "a", 150), event("selected", "a", 250),
                                 event("unrelated", "a", 200), event("selected", "b", 500)], report)
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0]["deltas"]["totalSamplesReceived"], 100)
        self.assertFalse(groups[1]["available"])


if __name__ == "__main__":
    unittest.main()
