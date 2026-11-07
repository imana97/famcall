"""Inject generated speech into one emulator and measure the other emulator's output.

Uses the Android SDK's own emulator_controller.proto, generated into .local/audio-proto.
Never opens the host microphone. gRPC credentials stay in process memory.
"""
import argparse
import hashlib
import json
import os
import signal
import sys
import threading
import time
import wave
import urllib.request
from pathlib import Path

import grpc
import numpy as np
from scipy.signal import correlate, correlation_lags, resample_poly
from pystoi import stoi
from google.protobuf.empty_pb2 import Empty
from evidence import stable_profile, verified_path, planned_outage
from source_evidence import call_participants, source_activity
from recovery import speech_recovery

ROOT = Path(__file__).resolve().parents[2]
PROTO_DIR = Path(os.environ.get("FAMCALL_AUDIO_PROTO_DIR", str(ROOT / ".local/audio-proto"))).expanduser().resolve()
sys.path.insert(0, str(PROTO_DIR))
import emulator_controller_pb2 as pb
import emulator_controller_pb2_grpc as rpc


def client(port):
    directory = Path.home() / "Library/Caches/TemporaryItems/avd/running"
    for file in directory.glob("pid_*.ini"):
        pid = int(file.stem.removeprefix("pid_"))
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            continue
        values = dict(line.strip().split("=", 1) for line in file.read_text().splitlines() if "=" in line)
        if values.get("grpc.port") == str(port) and values.get("grpc.token"):
            channel = grpc.insecure_channel("127.0.0.1:" + str(port))
            metadata = (("authorization", "Bearer " + values["grpc.token"]),)
            stub = rpc.EmulatorControllerStub(channel)
            status = stub.getStatus(Empty(), metadata=metadata, timeout=5)
            if not status.booted:
                raise RuntimeError("Emulator has not booted")
            return channel, stub, metadata, {"pid": pid, "port": port, "discoveryStamp": file.stat().st_mtime_ns,
                                            "emulatorVersion": status.version}
    raise RuntimeError("No authenticated emulator gRPC service on requested port")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sender", type=int, default=8554)
    parser.add_argument("--receiver", type=int, default=8556)
    parser.add_argument("--caller", type=int, required=True, help="gRPC port of the phone that placed this call")
    parser.add_argument("--call-started-after", type=int, required=True, help="Host Unix milliseconds before dialing")
    parser.add_argument("--source", type=Path, default=ROOT / ".local/audio-source.wav")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=20)
    parser.add_argument("--buffered", action="store_true")
    parser.add_argument("--input-rate", type=int, choices=[8000,16000,48000], default=48000)
    parser.add_argument("--capture-rate", type=int, choices=[8000,16000,48000], default=48000)
    parser.add_argument("--outage-seconds", type=int, choices=[2, 5, 15, 30])
    args = parser.parse_args()
    if not 3 <= args.seconds <= 3600:
        parser.error("Use a measurement duration between 3 and 3600 seconds.")
    if args.sender == args.receiver:
        parser.error("Speech measurements require two different emulators.")
    if args.caller not in (args.sender, args.receiver):
        parser.error("The caller must be one of the two measured emulators.")
    if args.outage_seconds and args.seconds < args.outage_seconds + 32:
        parser.error("Outage runs need 12 seconds before and 20 seconds after the outage.")
    started_at = int(time.time() * 1000)
    measurement_sources = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                           for path in (Path(__file__).resolve(), ROOT / "e2e/audio/recovery.py", ROOT / "e2e/audio/evidence.py",
                                        ROOT / "e2e/audio/source_evidence.py")}
    metrics_path = ROOT / ".local/audio-lab/metrics.jsonl"
    before = [json.loads(line) for line in metrics_path.read_text().splitlines() if line.strip()]
    participants = call_participants(before, args.call_started_after, started_at, args.sender == args.caller)
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    with urllib.request.urlopen("http://127.0.0.1:8787/config", timeout=3) as response:
        network_at_start = json.load(response)
    if args.outage_seconds and (network_at_start["transport"] != "udp" or not network_at_start["proxy"]):
        raise RuntimeError("Outages require the isolated UDP proxy")
    with urllib.request.urlopen("http://127.0.0.1:8787/status", timeout=3) as response:
        lab_at_start = json.load(response)
    with wave.open(str(args.source), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 48000):
            raise RuntimeError("Source must be mono 16-bit PCM at 48 kHz")
        original = source.readframes(source.getnframes())
        if not original:
            raise RuntimeError("Source audio is empty")
        wanted = int(args.seconds * 48000) * 2
        if args.outage_seconds and len(original) < wanted:
            raise RuntimeError("Outage runs require a nonrepeating reference at least as long as the capture")
        pcm = (original * (wanted // len(original) + 1))[:wanted]
    duration = len(pcm) / (48000 * 2)
    input_pcm = pcm if args.input_rate == 48000 else resample_poly(np.frombuffer(pcm, dtype="<i2").astype(float), args.input_rate, 48000).astype("<i2").tobytes()
    sc, sender, sm, sender_process = client(args.sender)
    rc, receiver, rm, receiver_process = client(args.receiver)
    # Reopening injectAudio in the same emulator process can leave a silent
    # microphone or crash the emulator. Keep one injection per incarnation.
    # See the firsthand emulator investigation linked in e2e-test-plan.txt.
    history = ROOT / ".local/audio-lab/injections"
    history.mkdir(parents=True, exist_ok=True)
    marker = history / ("{port}-{pid}-{discoveryStamp}.json".format(**sender_process))
    try:
        with marker.open("x") as handle:
            json.dump({"startedAt": started_at, "sender": sender_process}, handle)
    except FileExistsError:
        sc.close()
        rc.close()
        raise RuntimeError("Restart the sending emulator before another audio injection.") from None
    fmt = pb.AudioFormat(samplingRate=args.capture_rate, channels=pb.AudioFormat.Mono,
                         format=pb.AudioFormat.AUD_FMT_S16, mode=pb.AudioFormat.MODE_UNSPECIFIED if args.buffered else pb.AudioFormat.MODE_REAL_TIME)
    input_fmt = pb.AudioFormat(samplingRate=args.input_rate, channels=pb.AudioFormat.Mono,
                         format=pb.AudioFormat.AUD_FMT_S16, mode=fmt.mode)
    captured = []
    capture_chunks = []
    captured_samples = 0
    injection_progress = []
    injection_finished_at = None
    formats = set()
    errors = []
    stream = receiver.streamAudio(fmt, metadata=rm, timeout=duration + 6)

    def capture():
        nonlocal captured_samples
        try:
            for packet in stream:
                captured.append(bytes(packet.audio))
                captured_samples += len(packet.audio) // 2
                capture_chunks.append({"at": int(time.time() * 1000), "emulatorTimestampUs": int(packet.timestamp), "endSample": captured_samples * 16000 // args.capture_rate})
                formats.add((packet.format.samplingRate, packet.format.channels, packet.format.format))
        except grpc.RpcError as error:
            if error.code() not in (grpc.StatusCode.CANCELLED, grpc.StatusCode.DEADLINE_EXCEEDED):
                errors.append("Audio capture failed: " + str(error.code()))

    thread = threading.Thread(target=capture, daemon=True)
    thread.start()
    time.sleep(1)
    started = time.monotonic()
    injection_started_at = int(time.time() * 1000)
    outage = {"seconds": args.outage_seconds, "injectionStartedAt": injection_started_at}
    cancelled = threading.Event()

    def configure(profile):
        request = urllib.request.Request("http://127.0.0.1:8787/config", data=json.dumps(profile).encode(),
                                         headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=5) as response:
            json.load(response)

    def interrupt_relay():
        if cancelled.wait(12):
            return
        try:
            with urllib.request.urlopen("http://127.0.0.1:8787/status", timeout=3) as response:
                drops_before = json.load(response)["traffic"]["dropped"]
            configure({**network_at_start, "loss": 1})
            outage["blockedAt"] = int(time.time() * 1000)
            cancelled.wait(args.outage_seconds)
        except Exception as error:
            errors.append("Outage control failed: " + type(error).__name__)
        finally:
            try:
                configure(network_at_start)
                outage["restoredAt"] = int(time.time() * 1000)
                with urllib.request.urlopen("http://127.0.0.1:8787/status", timeout=3) as response:
                    outage["droppedPackets"] = json.load(response)["traffic"]["dropped"] - drops_before
            except Exception as error:
                errors.append("Outage restoration failed: " + type(error).__name__)

    outage_thread = threading.Thread(target=interrupt_relay, daemon=True) if args.outage_seconds else None
    if outage_thread:
        outage_thread.start()

    def packets():
        size = args.input_rate // 50 * 2  # 20 ms of PCM.
        for offset in range(0, len(input_pcm), size):
            wait = started + offset / (args.input_rate * 2) - time.monotonic()
            if not args.buffered and wait > 0:
                time.sleep(wait)
            if offset % (args.input_rate * 2) == 0:
                injection_progress.append({"at": int(time.time() * 1000), "sourceSeconds": offset / (args.input_rate * 2)})
            yield pb.AudioPacket(format=input_fmt, timestamp=int(time.time() * 1_000_000), audio=input_pcm[offset:offset + size])

    def terminate(_signal, _frame):
        raise KeyboardInterrupt

    previous_term = signal.signal(signal.SIGTERM, terminate)
    try:
        sender.injectAudio(packets(), metadata=sm, timeout=duration + 8)
        injection_finished_at = int(time.time() * 1000)
        time.sleep(2)
    except grpc.RpcError as error:
        errors.append("Audio injection failed: " + str(error.code()))
    finally:
        cancelled.set()
        if outage_thread:
            outage_thread.join(timeout=15)
        stream.cancel()
        thread.join(timeout=5)
        sc.close()
        rc.close()
        signal.signal(signal.SIGTERM, previous_term)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    recording = args.output.with_suffix(".wav")
    with wave.open(str(recording), "wb") as destination:
        destination.setnchannels(1)
        destination.setsampwidth(2)
        destination.setframerate(args.capture_rate)
        destination.writeframes(b"".join(captured))
    reference = resample_poly(np.frombuffer(pcm, dtype="<i2").astype(float) / 32768, 1, 3)
    received = resample_poly(np.frombuffer(b"".join(captured), dtype="<i2").astype(float) / 32768, 16000, args.capture_rate) if captured else np.array([])
    result = {"source": "generated speech; no host microphone", "sourceSha256": source_hash, "sender": args.sender,
              "receiver": args.receiver, "referenceSeconds": duration, "receivedSeconds": len(received) / 16000,
              "rms": float(np.sqrt(np.mean(received ** 2))) if len(received) else 0,
              "errors": errors, "stoi": None,
              "captureFormats": sorted(formats), "capturePackets": len(captured), "buffered": args.buffered,
              "inputRate": args.input_rate, "captureRate": args.capture_rate,
              "participants": participants, "caller": args.caller, "callStartedAfter": args.call_started_after,
              "measurementSourceHashes": measurement_sources,
              "protoDescriptorSha256": hashlib.sha256(pb.DESCRIPTOR.serialized_pb).hexdigest(),
              "grpcVersion": grpc.__version__,
              "injectionStartedAt": injection_started_at,
              "injectionFinishedAt": injection_finished_at,
              "injectionProgress": injection_progress,
              "injectionTimingScope": "Generator handoff to gRPC, not proof of microphone consumption time.",
              "captureChunks": capture_chunks,
              "senderProcess": sender_process, "receiverProcess": receiver_process,
              "limitation": "STOI is a laboratory intelligibility estimate, not a MOS score or a physical-device listening test."}
    with urllib.request.urlopen("http://127.0.0.1:8787/config", timeout=3) as response:
        network_at_end = json.load(response)
    result.update({"startedAt": started_at, "finishedAt": int(time.time() * 1000),
                   "networkAtStart": network_at_start, "networkAtEnd": network_at_end,
                   "stableProfile": network_at_start == network_at_end})
    # Verify the actual selected path; a requested relay setting alone is not evidence.
    paths = []
    path_observations = []
    samples = []
    call_ids = set()
    rtt_ms = []
    jitter_ms = []
    configuration_changes = []
    entries = [json.loads(line) for line in metrics_path.read_text().splitlines() if line.strip()]
    result["sourceActivity"] = source_activity(entries, participants, injection_started_at, reference)
    for entry in entries:
        if entry.get("kind") == "configuration" and started_at <= entry.get("at", 0) <= result["finishedAt"]:
            configuration_changes.append({"at": entry["at"], "config": entry["config"]})
        if entry.get("kind") != "stats" or not started_at <= entry.get("receivedAt", 0) <= result["finishedAt"]:
            continue
        rows = {r["id"]: r for r in entry.get("rows", [])}
        call_ids.add(entry.get("callId"))
        transport = next((r for r in rows.values() if r["type"] == "transport"), {})
        pair = rows.get(transport.get("selectedCandidatePairId"), {})
        candidate = rows.get(pair.get("localCandidateId"), {})
        if "currentRoundTripTime" in pair:
            rtt_ms.append(pair["currentRoundTripTime"] * 1000)
        path = {"type": candidate.get("candidateType"), "relayProtocol": candidate.get("relayProtocol")}
        paths.append(path)
        path_observations.append({"peer": entry["uid"], "at": entry["receivedAt"], "path": path})
        for r in rows.values():
            if r["type"] == "inbound-rtp":
                samples.append({"peer": entry["uid"], "at": entry["receivedAt"], **r})
                if "jitter" in r:
                    jitter_ms.append(r["jitter"] * 1000)
    def distribution(values):
        return {"median": float(np.median(values)), "p95": float(np.percentile(values, 95)), "max": max(values)} if values else None
    result["callIds"] = sorted(call_id for call_id in call_ids if call_id)
    result["roundTripMs"] = distribution(rtt_ms)
    result["interarrivalJitterMs"] = distribution(jitter_ms)
    result["labShaper"] = lab_at_start.get("shaper", {"version": 1, "udpIpHeaderBytes": 0})
    result["configurationChanges"] = configuration_changes
    result["stableProfile"] = stable_profile(network_at_start, network_at_end, configuration_changes)
    result["selectedPaths"] = [dict(x) for x in {tuple(sorted(p.items())) for p in paths}]
    result["relayVerified"] = bool(paths) and all(p["type"] == "relay" for p in paths)
    result["requestedPathVerified"] = verified_path(paths, network_at_start["transport"])
    if args.outage_seconds:
        result["outage"] = outage
        result["plannedOutageVerified"] = planned_outage(network_at_start, network_at_end, configuration_changes, outage)
        # No selected candidate during an outage is expected. Require all known
        # candidates to match; the pre/post speech and packet checks remain mandatory.
        result["requestedPathVerified"] = verified_path([p for p in paths if p["type"]], "udp")
        if result["plannedOutageVerified"]:
            peers = {p["peer"] for p in path_observations}
            result["outagePathsVerified"] = len(peers) == 2 and all(
                verified_path([p["path"] for p in path_observations if p["peer"] == peer and p["path"]["type"]
                               and (p["at"] < outage["blockedAt"] if phase == "before" else p["at"] > outage["restoredAt"])], "udp")
                for peer in peers for phase in ("before", "after"))
            result["speechRecovery"] = speech_recovery(reference, received, capture_chunks, outage)
    result["packetWindows"] = []
    for peer in sorted({r["peer"] for r in samples}):
        rows = sorted((r for r in samples if r["peer"] == peer), key=lambda r: r["at"])
        first, last = rows[0], rows[-1]
        received_packets = last.get("packetsReceived", 0) - first.get("packetsReceived", 0)
        lost = max(0, last.get("packetsLost", 0) - first.get("packetsLost", 0))
        result["packetWindows"].append({"seconds": (last["at"] - first["at"]) / 1000,
          "packetsReceived": received_packets, "packetsLost": lost,
          "lossFraction": lost / (lost + received_packets) if lost + received_packets else None,
          "concealedSamples": last.get("concealedSamples", 0) - first.get("concealedSamples", 0)})
    if len(received) > 16000 and result["rms"] > 0.0001:
        alignment = correlate(received, reference, mode="full", method="fft")
        lags = correlation_lags(len(received), len(reference), mode="full")
        bounded = (lags >= -16000) & (lags <= 8 * 16000)
        lag = int(lags[bounded][np.argmax(alignment[bounded])])
        ref = reference[max(0, -lag):]
        deg = received[max(0, lag):]
        length = min(len(ref), len(deg))
        result["alignmentSeconds"] = lag / 16000
        result["comparedSeconds"] = length / 16000
        result["stoi"] = float(stoi(ref[:length], deg[:length], 16000, extended=False))
    reasons = list(errors)
    if formats != {(args.capture_rate, pb.AudioFormat.Mono, pb.AudioFormat.AUD_FMT_S16)}:
        reasons.append("Capture did not supply the requested PCM format")
    if result["stoi"] is None or not np.isfinite(result["stoi"]):
        reasons.append("No measurable received speech")
        result["stoi"] = None
    if len(call_ids) != 1 or None in call_ids:
        reasons.append("Measurement did not identify exactly one active call")
    if call_ids != {participants["callId"]}:
        reasons.append("Measured call differs from the identified experiment")
    if not result["sourceActivity"]["verified"]:
        reasons.append("Generated-input microphone activity was not sustained or could not be verified")
    if result["receivedSeconds"] < duration * 0.85:
        reasons.append("Too little captured audio for the requested interval")
    if result.get("comparedSeconds", 0) < duration * 0.85:
        reasons.append("Too little aligned speech for the requested interval")
    if args.outage_seconds and not result.get("plannedOutageVerified"):
        reasons.append("Planned outage was not verified")
    if args.outage_seconds and not result.get("outagePathsVerified"):
        reasons.append("Both peers' relay paths were not verified before and after the outage")
    if args.outage_seconds and not result.get("speechRecovery", {}).get("baselineSpeechVerified"):
        reasons.append("No matched generated speech before the outage")
    if not args.outage_seconds and not result["stableProfile"]:
        reasons.append("Network profile changed during measurement")
    if not result["requestedPathVerified"]:
        reasons.append("Requested transport path was not verified")
    if len(result["packetWindows"]) != 2 or any(w["seconds"] < duration * 0.5 for w in result["packetWindows"]):
        reasons.append("Missing packet evidence from both call participants")
    result["measurementValid"] = not reasons
    result["invalidReasons"] = reasons
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    if not result["measurementValid"] or (args.outage_seconds and not result.get("speechRecovery", {}).get("recoveredSpeech")):
        sys.exit(1)


if __name__ == "__main__":
    main()
