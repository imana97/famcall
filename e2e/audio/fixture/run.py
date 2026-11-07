"""Three fresh Linux AVD controls. No production services, phones or host microphone."""
from pathlib import Path
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import wave

import grpc
import numpy as np
from scipy.signal import resample_poly
from google.protobuf.empty_pb2 import Empty

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / ".local/linux-audio-fixture"
RESULTS = WORK / "results"
sys.path.insert(0, str(ROOT / "e2e/audio"))
sys.path.insert(0, str(WORK / "proto"))
from fixture_analysis import analyze
import emulator_controller_pb2 as pb
import emulator_controller_pb2_grpc as rpc

SDK = Path(os.environ["ANDROID_HOME"])
ADB = SDK / "platform-tools/adb"
EMULATOR = SDK / "emulator/emulator"
PACKAGE = "com.silvergridtech.famcall.audiofixture"
SERIAL = "emulator-5554"


def command(*args, check=True, binary=False, timeout=30, **kwargs):
    return subprocess.run([str(x) for x in args], check=check, capture_output=True,
                          text=not binary, timeout=timeout, **kwargs)


def adb(*args, **kwargs):
    return command(ADB, "-s", SERIAL, *args, **kwargs)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(name):
    result = adb("exec-out", "run-as", PACKAGE, "cat", "files/" + name, check=False)
    if result.returncode:
        return None
    return json.loads(result.stdout)


def grpc_client(log_path):
    # The emulator advertises its own discovery file; never print its bearer token.
    logs = log_path.read_text(errors="replace")
    files = [Path(p.strip()) for p in re.findall(r"Advertising in:\s*([^\r\n]+pid_\d+\.ini)", logs)]
    for folder in (Path(os.environ["XDG_RUNTIME_DIR"]) / "avd/running",
                   Path("/tmp/avd/running"), Path.home() / ".cache/avd/running"):
        files.extend(folder.glob("pid_*.ini"))
    for file in files:
        if not file.exists():
            continue
        values = dict(line.strip().split("=", 1) for line in file.read_text().splitlines() if "=" in line)
        if values.get("grpc.port") == "8554" and values.get("grpc.token"):
            channel = grpc.insecure_channel("127.0.0.1:8554")
            metadata = (("authorization", "Bearer " + values["grpc.token"]),)
            stub = rpc.EmulatorControllerStub(channel)
            status = stub.getStatus(Empty(), metadata=metadata, timeout=5)
            if not status.booted:
                channel.close()
                raise RuntimeError("Emulator gRPC reports incomplete boot")
            return channel, stub, metadata, status.version
    raise RuntimeError("Authenticated emulator discovery file missing")


def one_run(index, pcm, reference, env, build):
    run_id = "control-" + str(index)
    folder = RESULTS / run_id
    folder.mkdir()
    record = {"runId": run_id, "startedAt": int(time.time() * 1000),
              "scope": "Synthetic input to Android AudioRecord; no WebRTC or call quality claim",
              "apkSha256": build["apkSha256"], "passed": False}
    log_path = WORK / (run_id + "-emulator.log")
    child = None
    channel = None
    try:
        args = [EMULATOR, "-avd", "famcall_fixture", "-port", "5554", "-grpc", "8554",
                "-grpc-use-token", "-no-audio", "-no-window", "-no-snapshot", "-wipe-data",
                "-gpu", "swiftshader", "-memory", "2048", "-cores", "2"]
        with log_path.open("w") as log:
            child = subprocess.Popen([str(x) for x in args], env=env, stdout=log, stderr=log)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError("Emulator exited before boot")
            state = adb("shell", "getprop", "sys.boot_completed", check=False, timeout=10)
            if state.stdout.strip() == "1":
                break
            time.sleep(2)
        else:
            raise RuntimeError("Emulator boot timed out")
        if adb("emu", "avd", "name").stdout.splitlines()[0] != "famcall_fixture":
            raise RuntimeError("Unexpected AVD; refusing to use this device")
        if adb("shell", "getprop", "ro.kernel.qemu").stdout.strip() != "1":
            raise RuntimeError("Physical device refused")
        record["deviceFingerprint"] = adb("shell", "getprop", "ro.build.fingerprint").stdout.strip()
        adb("shell", "input", "keyevent", "82")
        adb("install", "-r", WORK / "build/fixture.apk", timeout=60)
        installed = adb("shell", "pm", "path", PACKAGE).stdout.strip().removeprefix("package:")
        record["installedApkSha256"] = adb("shell", "sha256sum", installed).stdout.split()[0]
        if record["installedApkSha256"] != build["apkSha256"]:
            raise RuntimeError("Installed fixture differs from build")
        adb("shell", "pm", "grant", PACKAGE, "android.permission.RECORD_AUDIO")
        adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity", "--es", "runId", run_id)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            started = read_json(run_id + "-started.json")
            if started:
                break
            time.sleep(0.3)
        else:
            raise RuntimeError("Android recorder did not start")
        if started.get("rate") != 8000 or started.get("source") != 7:
            raise RuntimeError("Unexpected Android recording format")
        channel, stub, metadata, version = grpc_client(log_path)
        record["emulatorVersion"] = version
        record["protoDescriptorSha256"] = hashlib.sha256(pb.DESCRIPTOR.serialized_pb).hexdigest()
        fmt = pb.AudioFormat(samplingRate=48000, channels=pb.AudioFormat.Mono,
                             format=pb.AudioFormat.AUD_FMT_S16, mode=pb.AudioFormat.MODE_UNSPECIFIED)

        def packets():
            for offset in range(0, len(pcm), 1920):
                yield pb.AudioPacket(format=fmt, timestamp=int(time.time() * 1_000_000),
                                     audio=pcm[offset:offset + 1920])

        record["injectionStartedAt"] = int(time.time() * 1000)
        # One injection only per fresh process; failed samples remain failures.
        stub.injectAudio(packets(), metadata=metadata, timeout=38)
        record["injectionFinishedAt"] = int(time.time() * 1000)
        deadline = time.monotonic() + 50
        while time.monotonic() < deadline:
            native = read_json(run_id + "-result.json")
            if native:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Android recorder did not finish")
        record["native"] = native
        if (native.get("error") or not native.get("completed") or native.get("microphoneMuted") or
                native.get("pid") != started["pid"] or native.get("runId") != run_id):
            raise RuntimeError("Native recorder did not complete cleanly")
        captured = adb("exec-out", "run-as", PACKAGE, "cat", "files/" + run_id + ".pcm", binary=True).stdout
        if len(captured) != native["sampleCount"] * 2:
            raise RuntimeError("Native sample count does not match recording")
        capture_path = folder / "capture.wav"
        with wave.open(str(capture_path), "wb") as wav:
            wav.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
            wav.writeframes(captured)
        record["captureSha256"] = sha(capture_path)
        record["content"] = analyze(reference, np.frombuffer(captured, dtype="<i2") / 32768.0)
        record["passed"] = record["content"]["passed"]
    except Exception as error:
        record["error"] = error.code().name if isinstance(error, grpc.RpcError) else type(error).__name__ + ": " + str(error)
    finally:
        if channel:
            channel.close()
        if child:
            # Only terminate the emulator process started here, never another device.
            child.terminate()
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=10)
        record["finishedAt"] = int(time.time() * 1000)
        (folder / "report.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record), flush=True)
    return record


def main():
    if platform.system() != "Linux" or os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("This control runs only on a disposable GitHub Linux runner")
    if RESULTS.exists():
        raise RuntimeError("Refusing to overwrite existing experiment evidence")
    RESULTS.mkdir(parents=True)
    if "emulator-" in command(ADB, "devices").stdout:
        raise RuntimeError("Expected an empty disposable runner")
    env = dict(os.environ, ANDROID_AVD_HOME=str(WORK / "avd"), XDG_RUNTIME_DIR=str(WORK / "runtime"))
    for name in ("avd", "runtime"):
        (WORK / name).mkdir(mode=0o700)
    os.environ["XDG_RUNTIME_DIR"] = env["XDG_RUNTIME_DIR"]
    command(SDK / "cmdline-tools/latest/bin/avdmanager", "create", "avd", "-n", "famcall_fixture",
            "-k", "system-images;android-36;google_apis;x86_64", "--device", "pixel_6",
            input="no\n", env=env, timeout=60)
    config = WORK / "avd/famcall_fixture.avd/config.ini"
    with config.open("a") as handle:
        handle.write("\nhw.audioInput=yes\nhw.audioOutput=yes\n")
    source_path = WORK / "reference.wav"
    with wave.open(str(source_path), "rb") as wav:
        if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (48000, 1, 2):
            raise RuntimeError("Expected mono 48 kHz 16-bit synthetic speech")
        pcm = wav.readframes(30 * 48000)
    if len(pcm) != 30 * 48000 * 2:
        raise RuntimeError("Need at least 30 seconds of nonrepeating synthetic speech")
    reference = resample_poly(np.frombuffer(pcm, dtype="<i2").astype(float) / 32768.0, 1, 6)
    shutil.copyfile(source_path, RESULTS / "reference.wav")
    build = json.loads((WORK / "build/provenance.json").read_text())
    if sha(WORK / "build/fixture.apk") != build["apkSha256"]:
        raise RuntimeError("Build artifact changed")
    shutil.copyfile(WORK / "build/provenance.json", RESULTS / "build-provenance.json")
    provenance = {"commit": os.environ.get("GITHUB_SHA"), "sourceSha256": sha(Path(__file__)),
                  "analysisSha256": sha(ROOT / "e2e/audio/fixture_analysis.py"),
                  "referenceSha256": sha(source_path), "grpcVersion": grpc.__version__,
                  "host": platform.platform(), "attemptCount": 3,
                  "scope": "Fixture qualification only; not FamCall, network impairment, or physical audio"}
    (RESULTS / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    records = [one_run(index, pcm, reference, env, build) for index in range(1, 4)]
    passed = all(r["passed"] for r in records)
    summary = {"passed": passed, "attempts": 3, "passes": sum(r["passed"] for r in records),
               "reports": [r["runId"] + "/report.json" for r in records], "scope": provenance["scope"]}
    (RESULTS / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
