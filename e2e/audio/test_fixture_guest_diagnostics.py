import json
from types import SimpleNamespace
import subprocess
import unittest
from unittest.mock import patch

from fixture_guest_diagnostics import (HAL_TAG, _pcm_fields, guest_audio_logs,
                                       guest_audio_snapshot, parse_guest_audio_logs)


class GuestAudioDiagnosticsTests(unittest.TestCase):
    def test_logs_are_scoped_numeric_and_never_keep_messages(self):
        def line(at, message, tag=HAL_TAG):
            return f"{at} 505 560 D {tag}: {message}\n"
        secret = "PRIVATE_ACCOUNT_TOKEN"
        text = (line("99.999", "TinyalsaSource::read:146 pcm_readi was late delivering frames, inserting 16000 us of silence")
                + line("100.001", "TinyalsaSource::read:146 pcm_readi was late delivering frames, inserting 16000 us of silence")
                + line("100.002", f"pcmRead:220 pcm_readi failed with '{secret}' (-5)")
                + line("100.003", secret)
                + line("100.004", "TinyalsaSource::read:146 pcm_readi was late delivering frames, inserting 16000 us of silence", "OtherTag")
                + line("100.005", "pcmOpen:172 pcm_open failed for nChannels=1 sampleRateHz=8000 period_count=4 period_size=128 isOut=0 with " + secret)
                + line("101.001", "TinyalsaSource::read:146 pcm_readi was late delivering frames, inserting 16000 us of silence"))
        result = parse_guest_audio_logs(text, 100000, 101000)
        self.assertEqual(result["counts"], {"lateFrames": 1, "insertedSilenceUs": 16000,
                         "pcmReadErrors": 1, "pcmOpenErrors": 1, "pcmPrepareErrors": 0, "fallbackTone": 0})
        self.assertEqual(len(result["events"]), 3)
        self.assertNotIn(secret, json.dumps(result))
        self.assertTrue(result["absenceIsNotProofOfNoSilence"])
        self.assertNotIn("passed", result)

    def test_event_cap_does_not_lose_aggregate_counts(self):
        text = (f"100.100 1 2 D {HAL_TAG}: TinyalsaSource::read:146 pcm_readi was late delivering frames, inserting 16000 us of silence\n") * 300
        result = parse_guest_audio_logs(text, 100000, 101000)
        self.assertEqual(result["counts"]["lateFrames"], 300)
        self.assertEqual(len(result["events"]), 256)
        self.assertTrue(result["eventListTruncated"])

    def test_pcm_closed_and_unknown_are_distinct(self):
        self.assertEqual(_pcm_fields("closed\n", "status"), {"closed": True})
        self.assertIsNone(_pcm_fields("permission denied SECRET", "status"))
        self.assertEqual(_pcm_fields("state: RUNNING\nowner_pid: 505\nprivate: SECRET\n", "status"),
                         {"state": "RUNNING", "owner_pid": 505})

    def test_snapshot_links_registered_hal_to_pcm_and_mapped_module(self):
        calls = []
        outputs = {
            ("shell", "lshal", "--neat", "--types=b", "-i", "-p"):
                "android.hardware.audio@7.1::IDevicesFactory/default 505\nandroid.hardware.secret@1.0::Other/private 7\n",
            ("shell", "service", "list"):
                "21: android.hardware.audio.core.IModule/default: [android.hardware.audio.core.IModule]\n22: private-account: [SECRET]\n",
            ("shell", "cat", "/proc/asound/cards"):
                " 0 [VirtIO         ]: VirtIO - VirtIO SoundCard\n                      VirtIO SoundCard\n",
            ("shell", "cat", "/proc/asound/pcm"):
                "00-00: VirtIO PCM 0 : playback 1 : capture 1\n",
            ("shell", "getprop", "ro.boot.audio.tinyalsa.simulate_input"): "false\n",
            ("shell", "cat", "/proc/505/maps"):
                "100-200 r--p 0 00:00 1 /vendor/lib64/hw/android.hardware.audio@7.1-impl.ranchu.so\n200-300 rw-p 0 00:00 0 /private/SECRET\n",
            ("shell", "cat", "/proc/asound/card0/pcm0c/sub0/status"):
                "state: RUNNING\nowner_pid: 505\ndelay: 0\navail: 128\n",
            ("shell", "cat", "/proc/asound/card0/pcm0c/sub0/hw_params"):
                "access: RW_INTERLEAVED\nformat: S16_LE\nsubformat: STD\nchannels: 1\nrate: 8000 (8000/1)\nperiod_size: 128\nbuffer_size: 512\n",
        }
        def adb(*args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(returncode=0, stdout=outputs[args])
        result = guest_audio_snapshot(adb)
        self.assertEqual(result["unknown"], [])
        self.assertTrue(result["pcm"][0]["ownerMatchesHalPid"])
        self.assertEqual(result["pcm"][0]["hw_params"]["value"]["rate"], 8000)
        self.assertFalse(result["simulateInput"]["value"]["value"])
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertNotIn("passed", result)
        for args, kwargs in calls:
            self.assertFalse(kwargs["check"])
            self.assertLessEqual(kwargs["timeout"], 1.2)
            self.assertTrue(set(args).isdisjoint({"setprop", "root", "su", "start", "stop"}))

    def test_failed_snapshot_and_missing_property_are_explicit(self):
        def adb(*args, **kwargs):
            if "getprop" in args:
                return SimpleNamespace(returncode=0, stdout="")
            return SimpleNamespace(returncode=1, stdout="SECRET", stderr="SECRET")
        result = guest_audio_snapshot(adb)
        self.assertIn("hidlServices", result["unknown"])
        self.assertIn("captureEndpoints", result["unknown"])
        self.assertEqual(result["simulateInput"]["value"], {"state": "unset"})
        self.assertEqual(result["pcm"], [])
        self.assertNotIn("SECRET", json.dumps(result))

    def test_snapshot_deadline_prevents_later_commands(self):
        calls = []
        def adb(*args, **kwargs):
            calls.append(args)
            return SimpleNamespace(returncode=0, stdout="")
        with patch("fixture_guest_diagnostics.time.monotonic", side_effect=[0] + [10] * 20):
            result = guest_audio_snapshot(adb)
        self.assertEqual(calls, [])
        self.assertEqual(result["hidlServices"]["reason"], "observation-deadline")

    def test_log_failures_and_empty_logs_do_not_prove_no_silence(self):
        def timeout(*args, **kwargs):
            raise subprocess.TimeoutExpired("PRIVATE", 1)
        result = guest_audio_logs(timeout, 100000, 101000)
        self.assertFalse(result["known"])
        self.assertEqual(result["reason"], "timeout")
        self.assertNotIn("PRIVATE", json.dumps(result))
        def empty(*args, **kwargs):
            self.assertIn(HAL_TAG + ":D", args)
            self.assertIn("100.000", args)
            return SimpleNamespace(returncode=0, stdout="")
        result = guest_audio_logs(empty, 100000, 101000)
        self.assertTrue(result["known"])
        self.assertFalse(result["coverageKnown"])
        self.assertFalse(result["tagObservedDuringMeasurement"])
        with self.assertRaises(ValueError):
            guest_audio_logs(empty, 101000, 100000)


if __name__ == "__main__":
    unittest.main()
