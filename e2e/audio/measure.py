"""Inject generated speech into one emulator and measure the other emulator's output.

Uses the Android SDK's own emulator_controller.proto, generated into .local/audio-proto.
Never opens the host microphone. gRPC credentials stay in process memory.
"""
import argparse
import json
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

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".local/audio-proto"))
import emulator_controller_pb2 as pb
import emulator_controller_pb2_grpc as rpc


def client(port):
    directory = Path.home() / "Library/Caches/TemporaryItems/avd/running"
    for file in directory.glob("pid_*.ini"):
        values = dict(line.strip().split("=", 1) for line in file.read_text().splitlines() if "=" in line)
        if values.get("grpc.port") == str(port) and values.get("grpc.token"):
            channel = grpc.insecure_channel("127.0.0.1:" + str(port))
            metadata = (("authorization", "Bearer " + values["grpc.token"]),)
            stub = rpc.EmulatorControllerStub(channel)
            status = stub.getStatus(Empty(), metadata=metadata, timeout=5)
            if not status.booted:
                raise RuntimeError("Emulator has not booted")
            return channel, stub, metadata
    raise RuntimeError("No authenticated emulator gRPC service on requested port")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sender", type=int, default=8554)
    parser.add_argument("--receiver", type=int, default=8556)
    parser.add_argument("--source", type=Path, default=ROOT / ".local/audio-source.wav")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=20)
    parser.add_argument("--buffered", action="store_true")
    args = parser.parse_args()
    started_at = int(time.time() * 1000)
    with urllib.request.urlopen("http://127.0.0.1:8787/config", timeout=3) as response:
        network_at_start = json.load(response)
    with wave.open(str(args.source), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 48000):
            raise RuntimeError("Source must be mono 16-bit PCM at 48 kHz")
        original = source.readframes(source.getnframes())
        wanted = int(args.seconds * 48000) * 2
        pcm = (original * (wanted // len(original) + 1))[:wanted]
    duration = len(pcm) / (48000 * 2)
    sc, sender, sm = client(args.sender)
    rc, receiver, rm = client(args.receiver)
    fmt = pb.AudioFormat(samplingRate=48000, channels=pb.AudioFormat.Mono,
                         format=pb.AudioFormat.AUD_FMT_S16, mode=pb.AudioFormat.MODE_UNSPECIFIED if args.buffered else pb.AudioFormat.MODE_REAL_TIME)
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
        size = 960 * 2  # 20 ms of PCM.
        for offset in range(0, len(pcm), size):
            wait = started + offset / (48000 * 2) - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            yield pb.AudioPacket(format=fmt, timestamp=int(time.time() * 1_000_000), audio=pcm[offset:offset + size])

    try:
        sender.injectAudio(packets(), metadata=sm, timeout=duration + 8)
        time.sleep(2)
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
    result = {"source": "generated speech; no host microphone", "sender": args.sender,
              "receiver": args.receiver, "referenceSeconds": duration, "receivedSeconds": len(received) / 16000,
              "rms": float(np.sqrt(np.mean(received ** 2))) if len(received) else 0,
              "errors": errors, "stoi": None,
              "captureFormats": sorted(formats), "capturePackets": len(captured), "buffered": args.buffered,
              "limitation": "STOI is a laboratory intelligibility estimate, not a MOS score or a physical-device listening test."}
    with urllib.request.urlopen("http://127.0.0.1:8787/config", timeout=3) as response:
        network_at_end = json.load(response)
    result.update({"startedAt": started_at, "finishedAt": int(time.time() * 1000),
                   "networkAtStart": network_at_start, "networkAtEnd": network_at_end,
                   "stableProfile": network_at_start == network_at_end})
    # Verify the actual selected path; a requested relay setting alone is not evidence.
    paths = []
    samples = []
    for line in (ROOT / ".local/audio-lab/metrics.jsonl").read_text().splitlines():
        entry = json.loads(line)
        if entry.get("kind") != "stats" or not started_at <= entry.get("receivedAt", 0) <= result["finishedAt"]:
            continue
        rows = {r["id"]: r for r in entry.get("rows", [])}
        transport = next((r for r in rows.values() if r["type"] == "transport"), {})
        pair = rows.get(transport.get("selectedCandidatePairId"), {})
        candidate = rows.get(pair.get("localCandidateId"), {})
        paths.append({"type": candidate.get("candidateType"), "relayProtocol": candidate.get("relayProtocol")})
        for r in rows.values():
            if r["type"] == "inbound-rtp":
                samples.append({"peer": entry["uid"], "at": entry["receivedAt"], **r})
    result["selectedPaths"] = [dict(x) for x in {tuple(sorted(p.items())) for p in paths}]
    result["relayVerified"] = bool(paths) and all(p["type"] == "relay" for p in paths)
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
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    if result["stoi"] is None or errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
