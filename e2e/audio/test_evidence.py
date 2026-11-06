import unittest

from evidence import stable_profile, verified_path, planned_outage


class ExperimentEvidenceTests(unittest.TestCase):
    def test_outage_must_have_actual_drops_and_exact_profile_history(self):
        base = {"transport": "udp", "proxy": True, "loss": 0}
        changes = [{"at": 1000, "config": {**base, "loss": 1}}, {"at": 6000, "config": base}]
        outage = {"seconds": 5, "blockedAt": 1001, "restoredAt": 6001, "droppedPackets": 10}
        self.assertTrue(planned_outage(base, base, changes, outage))
        self.assertFalse(planned_outage(base, base, changes, {**outage, "droppedPackets": 0}))
        self.assertFalse(planned_outage(base, base, changes, {**outage, "seconds": 15}))
        self.assertFalse(planned_outage(base, base, changes + changes, outage))

    def test_outage_preserves_the_underlying_weak_link(self):
        weak = {"transport": "udp", "proxy": True, "loss": 0.0151,
                "kbps": 64, "delayMs": 75, "jitterMs": 25}
        changes = [{"at": 1000, "config": {**weak, "loss": 1}},
                   {"at": 3000, "config": weak}]
        outage = {"seconds": 2, "blockedAt": 1001, "restoredAt": 3001, "droppedPackets": 80}
        self.assertTrue(planned_outage(weak, weak, changes, outage))
        altered_drop = [{"at": 1000, "config": {**weak, "loss": 1, "delayMs": 0}}, changes[1]]
        self.assertFalse(planned_outage(weak, weak, altered_drop, outage))
        healthy = {**weak, "loss": 0, "kbps": 0, "delayMs": 0, "jitterMs": 0}
        self.assertFalse(planned_outage(weak, healthy,
            [changes[0], {"at": 3000, "config": healthy}], outage))

    def test_rejects_a_profile_changed_and_restored_during_capture(self):
        weak = {"transport": "udp", "loss": 0.03, "kbps": 64}
        healthy = {"transport": "udp", "loss": 0, "kbps": 0}
        self.assertFalse(stable_profile(weak, weak, [
            {"at": 1000, "config": healthy}, {"at": 2000, "config": weak},
        ]))
        self.assertFalse(stable_profile(weak, healthy, []))
        self.assertTrue(stable_profile(weak, weak, [{"at": 1000, "config": weak}]))

    def test_a_relay_alone_does_not_prove_the_requested_transport(self):
        udp = {"type": "relay", "relayProtocol": "udp"}
        tcp = {"type": "relay", "relayProtocol": "tcp"}
        self.assertFalse(verified_path([udp], "tcp"))
        self.assertFalse(verified_path([udp, tcp], "udp"))
        self.assertFalse(verified_path([udp], "direct"))
        self.assertFalse(verified_path([{"type": "relay"}], "tls"))
        self.assertFalse(verified_path([], "udp"))
        self.assertTrue(verified_path([udp, udp], "udp"))
        self.assertTrue(verified_path([{"type": "srflx"}], "direct"))


if __name__ == "__main__":
    unittest.main()
