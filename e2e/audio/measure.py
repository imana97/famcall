"""Inject generated speech into one emulator and measure the other emulator's output.

Uses the Android SDK's own emulator_controller.proto, generated into .local/audio-proto.
Never opens the host microphone. gRPC credentials stay in process memory.
"""
import argparse
import hashlib
import json
import os
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
from evidence import stable_profile, verified_path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".local/audio-proto"))
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
            return channel, stub, metadata, {"pid": pid, "port": port, "discoveryStamp": file.stat().st_mtime_ns}
    raise RuntimeError("No authenticated emulator gRPC service on requested port")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sender", type=int, default=8554)
    parser.add_argument("--receiver", type=int, default=8556)
    parser.add_argument("--source", type=Path, default=ROOT / ".local/audio-source.wav")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=20)
    parser.add_argument("--buffered", action="store_true")
    parser.add_argument("--input-rate", type=int, choices=[8000,16000,48000], default=48000)
    args = parser.parse_args()
    if not 3 <= args.seconds <= 3600:
        parser.error("Use a measurement duration between 3 and 3600 seconds.")
    if args.sender == args.receiver:
        parser.error("Speech measurements require two different emulators.")
    started_at = int(time.time() * 1000)
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    with urllib.request.urlopen("http://127.0.0.1:8787/config", timeout=3) as response:
        network_at_start = json.load(response)
    with urllib.request.urlopen("http://127.0.0.1:8787/status", timeout=3) as response:
        lab_at_start = json.load(response)
    with wave.open(str(args.source), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 48000):
            raise RuntimeError("Source must be mono 16-bit PCM at 48 kHz")
        original = source.readframes(source.getnframes())
        if not original:
            raise RuntimeError("Source audio is empty")
        wanted = int(args.seconds * 48000) * 2
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
    fmt = pb.AudioFormat(samplingRate=48000, channels=pb.AudioFormat.Mono,
                         format=pb.AudioFormat.AUD_FMT_S16, mode=pb.AudioFormat.MODE_UNSPECIFIED if args.buffered else pb.AudioFormat.MODE_REAL_TIME)
    input_fmt = pb.AudioFormat(samplingRate=args.input_rate, channels=pb.AudioFormat.Mono,
                         format=pb.AudioFormat.AUD_FMT_S16, mode=fmt.mode)
    captured = []
    formats = set()
    errors = []
    stream = receiver.streamAudio(fmt, metadata=rm, timeout=duration + 6)

    def capture():
        try:
            for packet in stream:
                captured.append(bytes(packet.audio))
                formats.add((packet.format.samplingRate, packet.format.channels, packet.format.format))
        except grpc.RpcError as error:
            if error.code() not in (grpc.StatusCode.CANCELLED, grpc.StatusCode.DEADLINE_EXCEEDED):
                errors.append("Audio capture failed: " + str(error.code()))

    thread = threading.Thread(target=capture, daemon=True)
    thread.start()
    time.sleep(1)
    started = time.monotonic()

    def packets():
        size = args.input_rate // 50 * 2  # 20 ms of PCM.
        for offset in range(0, len(input_pcm), size):
            wait = started + offset / (args.input_rate * 2) - time.monotonic()
            if not args.buffered and wait > 0:
                time.sleep(wait)
            yield pb.AudioPacket(format=input_fmt, timestamp=int(time.time() * 1_000_000), audio=input_pcm[offset:offset + size])

    try:
        sender.injectAudio(packets(), metadata=sm, timeout=duration + 8)
        time.sleep(2)
    except grpc.RpcError as error:
        errors.append("Audio injection failed: " + str(error.code()))
    finally:
        stream.cancel()
        thread.join(timeout=5)
        sc.close()
        rc.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    recording = args.output.with_suffix(".wav")
    with wave.open(str(recording), "wb") as destination:
        destination.setnchannels(1)
        destination.setsampwidth(2)
        destination.setframerate(48000)
        destination.writeframes(b"".join(captured))
    reference = resample_poly(np.frombuffer(pcm, dtype="<i2").astype(float) / 32768, 1, 3)
    received = resample_poly(np.frombuffer(b"".join(captured), dtype="<i2").astype(float) / 32768, 1, 3) if captured else np.array([])
    result = {"source": "generated speech; no host microphone", "sourceSha256": source_hash, "sender": args.sender,
              "receiver": args.receiver, "referenceSeconds": duration, "receivedSeconds": len(received) / 16000,
              "rms": float(np.sqrt(np.mean(received ** 2))) if len(received) else 0,
              "errors": errors, "stoi": None,
              "captureFormats": sorted(formats), "capturePackets": len(captured), "buffered": args.buffered,
              "inputRate": args.input_rate,
              "senderProcess": sender_process, "receiverProcess": receiver_process,
              "limitation": "STOI is a laboratory intelligibility estimate, not a MOS score or a physical-device listening test."}
    with urllib.request.urlopen("http://127.0.0.1:8787/config", timeout=3) as response:
        network_at_end = json.load(response)
    result.update({"startedAt": started_at, "finishedAt": int(time.time() * 1000),
                   "networkAtStart": network_at_start, "networkAtEnd": network_at_end,
                   "stableProfile": network_at_start == network_at_end})
    # Verify the actual selected path; a requested relay setting alone is not evidence.
    paths = []
    samples = []
    call_ids = set()
    rtt_ms = []
    jitter_ms = []
    configuration_changes = []
    metrics_path = ROOT / ".local/audio-lab/metrics.jsonl"
    for line in metrics_path.read_text().splitlines() if metrics_path.exists() else []:
        entry = json.loads(line)
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
        paths.append({"type": candidate.get("candidateType"), "relayProtocol": candidate.get("relayProtocol")})
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
    if formats != {(48000, pb.AudioFormat.Mono, pb.AudioFormat.AUD_FMT_S16)}:
        reasons.append("Capture did not supply the requested PCM format")
    if result["stoi"] is None or not np.isfinite(result["stoi"]):
        reasons.append("No measurable received speech")
        result["stoi"] = None
    if len(call_ids) != 1 or None in call_ids:
        reasons.append("Measurement did not identify exactly one active call")
    if result["receivedSeconds"] < duration * 0.85:
        reasons.append("Too little captured audio for the requested interval")
    if result.get("comparedSeconds", 0) < duration * 0.85:
        reasons.append("Too little aligned speech for the requested interval")
    if not result["stableProfile"]:
        reasons.append("Network profile changed during measurement")
    if not result["requestedPathVerified"]:
        reasons.append("Requested transport path was not verified")
    if len(result["packetWindows"]) != 2 or any(w["seconds"] < duration * 0.5 for w in result["packetWindows"]):
        reasons.append("Missing packet evidence from both call participants")
    result["measurementValid"] = not reasons
    result["invalidReasons"] = reasons
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    if not result["measurementValid"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
