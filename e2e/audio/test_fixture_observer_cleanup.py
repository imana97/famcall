"""Exercise observer ownership/cleanup without an emulator, Pulse server or microphone."""
import importlib.util
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np
from scipy.signal import resample_poly


def load_controller():
    # Controller definitions have no import-time device work. These process/file
    # tests use only analysis-requirements.txt, without gRPC, protobuf or an SDK.
    # Keep every unused RPC import isolated; no runtime dependencies are added.
    stubs = {name: types.ModuleType(name) for name in
             ("grpc", "google", "google.protobuf", "google.protobuf.empty_pb2",
              "emulator_controller_pb2", "emulator_controller_pb2_grpc")}
    stubs["google"].__path__ = []
    stubs["google.protobuf"].__path__ = []
    stubs["google"].protobuf = stubs["google.protobuf"]
    stubs["google.protobuf"].empty_pb2 = stubs["google.protobuf.empty_pb2"]

    def unexpected_rpc(*args, **kwargs):
        raise AssertionError("RPC calls are outside these process/file tests")

    stubs["google.protobuf.empty_pb2"].Empty = unexpected_rpc
    source = Path(__file__).parent / "fixture/run.py"
    spec = importlib.util.spec_from_file_location("fixture_controller_test", source)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(os.environ, {"ANDROID_HOME": "/unused-test-sdk"}), patch.dict("sys.modules", stubs):
        spec.loader.exec_module(module)
    return module


class OwnedProcess:
    pid = 4321

    def __init__(self, returncode=None):
        self.returncode = returncode
        self.terminated = False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = -15

    def wait(self, timeout=None):
        return self.returncode


class FixtureObserverCleanupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.controller = load_controller()

    def test_existing_unowned_file_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(self.controller, "WORK", Path(directory)):
            folder = Path(directory) / "control-1"
            folder.mkdir()
            observer = self.controller.PulseObserver(folder, {}, 0)
            observer.raw_path.write_bytes(b"existing evidence")
            with patch.object(self.controller.subprocess, "Popen") as spawn:
                observer.start()
                report = observer.finish(np.ones(32000))
                spawn.assert_not_called()
            self.assertFalse(report["complete"])
            self.assertFalse(report["qualified"])
            self.assertEqual(observer.raw_path.read_bytes(), b"existing evidence")

    def test_owned_process_and_spool_are_cleaned_after_content_analysis(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(self.controller, "WORK", Path(directory)):
            folder = Path(directory) / "control-1"
            folder.mkdir()
            reference = resample_poly(np.random.default_rng(902).normal(0, 0.05, 12000), 4, 1)
            host = np.rint(resample_poly(reference, 441, 80) * 32768).astype("<i2")
            raw = np.column_stack((host, host)).astype("<i2").tobytes()
            process = OwnedProcess()
            routes = {"at": 1, "source-outputs": [{"source": 0,
                "sample_specification": "s16le 2ch 44100Hz",
                "application": {"application.process.id": str(process.pid)}}]}

            def spawn(*args, **kwargs):
                kwargs["stdout"].write(raw)
                return process

            observer = self.controller.PulseObserver(folder, {}, 0)
            with patch.object(self.controller.subprocess, "Popen", side_effect=spawn), \
                    patch.object(self.controller, "pulse_routes", return_value=routes):
                try:
                    observer.start()
                    observer.observe(routes)
                finally:
                    report = observer.finish(reference)
            self.assertTrue(process.terminated)
            self.assertFalse(observer.raw_path.exists())
            self.assertFalse(observer.timer.is_alive())
            self.assertTrue((folder / "pulse-source.wav").exists())
            self.assertTrue(report["qualified"])

    def test_early_process_exit_remains_unqualified_and_cleans_spool(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(self.controller, "WORK", Path(directory)):
            folder = Path(directory) / "control-1"
            folder.mkdir()
            observer = self.controller.PulseObserver(folder, {}, 0)
            with patch.object(self.controller.subprocess, "Popen", return_value=OwnedProcess(1)):
                observer.start()
                report = observer.finish(np.ones(32000))
            self.assertFalse(report["qualified"])
            self.assertTrue(report["unexpectedEarlyExit"])
            self.assertTrue(report["partialCaptureNotQualified"])
            self.assertFalse(observer.raw_path.exists())
            self.assertFalse(observer.timer.is_alive())


if __name__ == "__main__":
    unittest.main()
