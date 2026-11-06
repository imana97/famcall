import unittest

from evidence import stable_profile, verified_path


class ExperimentEvidenceTests(unittest.TestCase):
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
