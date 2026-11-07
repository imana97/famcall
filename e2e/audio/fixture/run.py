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
INPUT_METHOD = os.environ.get("FAMCALL_FIXTURE_INPUT", "grpc")


def command(*args, check=True, binary=False, timeout=30, **kwargs):
    return subprocess.run([str(x) for x in args], check=check, capture_output=True,
                          text=not binary, timeout=timeout, **kwargs)


def adb(*args, **kwargs):
    return command(ADB, "-s", SERIAL, *args, **kwargs)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_virtual_audio(env):
    sources = json.loads(command("pactl", "-f", "json", "list", "sources", env=env).stdout)
    modules = json.loads(command("pactl", "-f", "json", "list", "modules", env=env).stdout)
    if {s["name"] for s in sources} != {"famcall_input.monitor", "famcall_output.monitor"}:
        raise RuntimeError("Refusing audio input from an unexpected host source")
    if any(s.get("driver") != "module-null-sink.c" for s in sources):
        raise RuntimeError("Host sources must be generated virtual monitors only")
    if sorted(m["name"] for m in modules) != ["module-native-protocol-unix", "module-null-sink", "module-null-sink"]:
        raise RuntimeError("Unexpected audio server modules")
    if command("pactl", "get-default-source", env=env).stdout.strip() != "famcall_input.monitor":
        raise RuntimeError("Generated source is not the default microphone")
    return {"sources": [s["name"] for s in sources], "modules": [m["name"] for m in modules]}


def read_json(name):
    # exec-out does not reliably propagate the remote command's exit status.
    # The shell protocol does: a not-yet-created status file means keep waiting.
    result = adb("shell", "run-as", PACKAGE, "cat", "files/" + name, check=False)
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
    record["inputMethod"] = INPUT_METHOD
    log_path = WORK / (run_id + "-emulator.log")
    child = None
    channel = None
    try:
        args = [EMULATOR, "-avd", "famcall_fixture", "-port", "5554", "-grpc", "8554",
                "-grpc-use-token", "-no-window", "-no-snapshot", "-wipe-data",
                "-gpu", "swiftshader", "-memory", "2048", "-cores", "2"]
        if INPUT_METHOD == "pulse":
            record["virtualAudio"] = verify_virtual_audio(env)
            args.extend(["-audio", "pa"])
        else:
            args.append("-no-audio")
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
        # Allow first-boot Android services to settle before starting the recorder.
        time.sleep(10)
        record["stage"] = "install"
        adb("shell", "input", "keyevent", "82")
        adb("install", "-r", WORK / "build/fixture.apk", timeout=60)
        installed = adb("shell", "pm", "path", PACKAGE).stdout.strip().removeprefix("package:")
        record["installedApkSha256"] = adb("shell", "sha256sum", installed).stdout.split()[0]
        if record["installedApkSha256"] != build["apkSha256"]:
            raise RuntimeError("Installed fixture differs from build")
        adb("shell", "pm", "grant", PACKAGE, "android.permission.RECORD_AUDIO")
        record["activityLaunch"] = adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity", "--es", "runId", run_id).stdout
        record["stage"] = "wait-for-recorder"
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            started = read_json(run_id + "-started.json")
            if started:
                break
            early_result = read_json(run_id + "-result.json")
            if early_result:
                record["native"] = early_result
                raise RuntimeError("Android recorder exited before starting")
            time.sleep(0.3)
        else:
            raise RuntimeError("Android recorder did not start")
        if started.get("rate") != 8000 or started.get("source") != 7:
            raise RuntimeError("Unexpected Android recording format")
        record["stage"] = "inject"
        channel, stub, metadata, version = grpc_client(log_path)
        record["emulatorVersion"] = version
        record["protoDescriptorSha256"] = hashlib.sha256(pb.DESCRIPTOR.serialized_pb).hexdigest()
        if INPUT_METHOD == "pulse":
            # The private server has no hardware-detection module or real device.
            # Enable only its verified synthetic monitor as emulator host input.
            record["virtualAudio"] = verify_virtual_audio(env)
            stub.setMicrophoneState(pb.MicrophoneState(realAudioEnabled=True), metadata=metadata, timeout=5)
            if not stub.getMicrophoneState(Empty(), metadata=metadata, timeout=5).realAudioEnabled:
                raise RuntimeError("Emulator refused synthetic host input")
        fmt = pb.AudioFormat(samplingRate=48000, channels=pb.AudioFormat.Mono,
                             format=pb.AudioFormat.AUD_FMT_S16, mode=pb.AudioFormat.MODE_UNSPECIFIED)

        def packets():
            for offset in range(0, len(pcm), 1920):
                yield pb.AudioPacket(format=fmt, timestamp=int(time.time() * 1_000_000),
                                     audio=pcm[offset:offset + 1920])

        record["injectionStartedAt"] = int(time.time() * 1000)
        # One injection only per fresh process; failed samples remain failures.
        if INPUT_METHOD == "pulse":
            command("paplay", "--device=famcall_input", "--raw", "--format=s16le", "--rate=48000",
                    "--channels=1", "--latency-msec=20", input=pcm, binary=True, env=env, timeout=38)
        else:
            stub.injectAudio(packets(), metadata=metadata, timeout=38)
        record["injectionFinishedAt"] = int(time.time() * 1000)
        record["stage"] = "wait-for-completion"
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
        record["stage"] = "analyze"
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
        try:
            record["nativeAtFailure"] = read_json(run_id + "-result.json")
            record["pidAtFailure"] = adb("shell", "pidof", PACKAGE, check=False).stdout.strip()
        except Exception:
            pass
        # Preserve partial synthetic data for diagnosis, never as a passing sample.
        try:
            size = adb("shell", "run-as", PACKAGE, "wc", "-c", "files/" + run_id + ".pcm", check=False)
            if size.returncode == 0:
                expected = int(size.stdout.split()[0])
                partial = adb("exec-out", "run-as", PACKAGE, "cat", "files/" + run_id + ".pcm", binary=True).stdout
                if expected > 0 and len(partial) >= expected and expected % 2 == 0:
                    partial_path = folder / "partial-capture.wav"
                    with wave.open(str(partial_path), "wb") as wav:
                        wav.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
                        wav.writeframes(partial[:expected])
                    record["partialCaptureSha256"] = sha(partial_path)
                    record["partialCaptureNotQualified"] = True
        except Exception:
            record["partialCaptureUnavailable"] = True
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
    if INPUT_METHOD not in ("grpc", "pulse"):
        raise ValueError("Use grpc or pulse for fixture input")
    if "emulator-" in command(ADB, "devices").stdout:
        raise RuntimeError("Expected an empty disposable runner")
    env = dict(os.environ, ANDROID_AVD_HOME=str(WORK / "avd"), XDG_RUNTIME_DIR=str(WORK / "runtime"))
    for name in ("avd", "runtime"):
        (WORK / name).mkdir(mode=0o700)
    os.environ["XDG_RUNTIME_DIR"] = env["XDG_RUNTIME_DIR"]
    if INPUT_METHOD == "pulse":
        # This private Unix socket is inside a mode-0700 directory on the
        # disposable runner. No network listener or physical audio module loads.
        socket = WORK / "runtime/pulse-native"
        pulse_config = WORK / "pulse.pa"
        pulse_config.write_text(
            f"load-module module-native-protocol-unix socket={socket} auth-anonymous=1\n"
            "load-module module-null-sink sink_name=famcall_input rate=48000 channels=1\n"
            "load-module module-null-sink sink_name=famcall_output rate=48000 channels=1\n"
            "set-default-source famcall_input.monitor\nset-default-sink famcall_output\n")
        env.update(PULSE_SERVER="unix:" + str(socket), PULSE_SOURCE="famcall_input.monitor",
                   PULSE_SINK="famcall_output")
        command("pulseaudio", "-n", "--daemonize=yes", "--exit-idle-time=-1",
                "--file=" + str(pulse_config), "--log-target=file:" + str(WORK / "pulse.log"), env=env)
        verify_virtual_audio(env)
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
                  "inputMethod": INPUT_METHOD,
                  "scope": "Fixture qualification only; not FamCall, network impairment, or physical audio"}
    (RESULTS / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    try:
        records = [one_run(index, pcm, reference, env, build) for index in range(1, 4)]
    finally:
        if INPUT_METHOD == "pulse":
            command("pulseaudio", "--kill", env=env, check=False)
    passed = all(r["passed"] for r in records)
    summary = {"passed": passed, "attempts": 3, "passes": sum(r["passed"] for r in records),
               "reports": [r["runId"] + "/report.json" for r in records], "scope": provenance["scope"]}
    (RESULTS / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
