import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=ice-ufrag:test\r\n";
  class Peer {
    attachedTrackEnabled: boolean[] = [];
    connectionState = "new";
    signalingState = "stable";
    createOffer = vi.fn(async () => ({ sdp, type: "offer" }));
    setLocalDescription = vi.fn(async () => undefined);
    setConfiguration = vi.fn();
    addEventListener = vi.fn();
    addTrack = vi.fn((track: { enabled: boolean }) => {
      this.attachedTrackEnabled.push(track.enabled);
      return { getParameters: () => ({ encodings: [] }) };
    });
    getStats = vi.fn(async () => new Map());
    close = vi.fn();
  }
  return { Peer, api: vi.fn(), getUserMedia: vi.fn(), track: { enabled: true, stop: vi.fn() } };
});
vi.mock("react-native-webrtc", () => ({
  RTCPeerConnection: mocks.Peer,
  RTCIceCandidate: class {}, RTCSessionDescription: class {},
  mediaDevices: { getUserMedia: mocks.getUserMedia },
}));
vi.mock("@react-native-firebase/firestore", () => ({
  addDoc: vi.fn(async () => undefined), collection: vi.fn(), doc: vi.fn(),
  onSnapshot: vi.fn(() => () => undefined), query: vi.fn(),
  setDoc: vi.fn(async () => undefined), where: vi.fn(),
}));
vi.mock("../apps/mobile/src/services/firebase", () => ({ api: mocks.api, database: {} }));
vi.mock("../apps/mobile/src/services/e2eDiagnostics", () => ({
  testTransport: async () => null, recordTestMetric: vi.fn(),
}));
vi.mock("react-native-nitro-keepalive-timer", () => ({
  setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
  clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
  setInterval: (...args: Parameters<typeof setInterval>) => globalThis.setInterval(...args),
  clearInterval: (...args: Parameters<typeof clearInterval>) => globalThis.clearInterval(...args),
}));

import { VoicePeer } from "../apps/mobile/src/services/VoicePeer";
import { errorMessage, MicrophonePermissionError } from "../apps/mobile/src/services/errors";

const stream = () => ({
  getTracks: () => [mocks.track], getAudioTracks: () => [mocks.track], release: vi.fn(),
});
beforeEach(() => {
  mocks.track.enabled = true;
  mocks.getUserMedia.mockReset().mockResolvedValue(stream());
});

describe("native voice connection retry policy", () => {
  let voice: VoicePeer;
  let onError: ReturnType<typeof vi.fn>;
  let peer: InstanceType<typeof mocks.Peer>;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mocks.api.mockImplementation(async (method: string) => method === "heartbeatCall"
      ? { active: true } : { iceServers: [], refreshAfterMs: 420_000 });
    onError = vi.fn();
    voice = new VoicePeer({ id: "call", callerId: "alice", calleeId: "bob" } as ConstructorParameters<typeof VoicePeer>[0],
      "alice", vi.fn(), onError);
    await voice.start();
    peer = (voice as unknown as { pc: InstanceType<typeof mocks.Peer> }).pc;
  });
  afterEach(() => { voice.close(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("retries and terminates an initial ICE stall even without a failed event", async () => {
    await vi.advanceTimersByTimeAsync(14_999);
    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(65_001);
    expect(peer.createOffer).toHaveBeenCalledTimes(7);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "reconnection-exhausted" }));
  });

  it("coalesces a forced restart during cooldown instead of losing refreshed credentials", async () => {
    await voice.requestRestart(true);
    await voice.requestRestart(true);
    await voice.requestRestart(true);
    expect(peer.createOffer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(peer.createOffer).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not retry a connected or closed call at the setup deadline", async () => {
    peer.connectionState = "connected";
    await vi.advanceTimersByTimeAsync(20_000);
    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    voice.close();
    await vi.advanceTimersByTimeAsync(500_000);
    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("microphone mute during connection setup", () => {
  let voice: VoicePeer;
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.api.mockImplementation(async (method: string) => method === "heartbeatCall"
      ? { active: true } : { iceServers: [], refreshAfterMs: 420_000 });
    voice = new VoicePeer({ id: "call", callerId: "alice", calleeId: "bob" } as ConstructorParameters<typeof VoicePeer>[0],
      "alice", vi.fn(), vi.fn());
  });
  afterEach(() => { voice.close(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("attaches the microphone disabled when mute was requested before startup", async () => {
    voice.mute(true);
    await voice.start();
    const peer = (voice as unknown as { pc: InstanceType<typeof mocks.Peer> }).pc;
    expect(peer.attachedTrackEnabled).toEqual([false]);
    voice.mute(false);
    expect(mocks.track.enabled).toBe(true);
  });

  it.each([true, false])("keeps the latest mute intent (%s) while microphone permission is pending", async muted => {
    let provideMicrophone!: (value: ReturnType<typeof stream>) => void;
    mocks.getUserMedia.mockImplementation(() => new Promise(resolve => { provideMicrophone = resolve; }));
    const started = voice.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getUserMedia).toHaveBeenCalledOnce();
    voice.mute(!muted);
    voice.mute(muted);
    provideMicrophone(stream());
    await started;
    const peer = (voice as unknown as { pc: InstanceType<typeof mocks.Peer> }).pc;
    expect(peer.attachedTrackEnabled).toEqual([!muted]);
  });
});

describe("microphone failure guidance", () => {
  let voice: VoicePeer;
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.api.mockImplementation(async (method: string) => method === "heartbeatCall"
      ? { active: true } : { iceServers: [], refreshAfterMs: 420_000 });
    voice = new VoicePeer({ id: "call", callerId: "alice", calleeId: "bob" } as ConstructorParameters<typeof VoicePeer>[0],
      "alice", vi.fn(), vi.fn());
  });
  afterEach(() => { voice.close(); vi.useRealTimers(); vi.clearAllMocks(); });

  it.each(["SecurityError", "NotAllowedError"])(
    "recognizes a denied microphone only at capture: %s", async name => {
      mocks.getUserMedia.mockRejectedValue({ name, message: "Permission denied." });
      const error = await voice.start().catch(error => error);
      expect(error).toBeInstanceOf(MicrophonePermissionError);
      expect(errorMessage(error))
        .toBe("Please allow microphone access in your phone’s settings to make a call.");
    },
  );

  it("does not turn a relay authorization error into microphone guidance", async () => {
    const denied = { code: "functions/permission-denied" };
    mocks.api.mockImplementation(async (method: string) => {
      if (method === "getIceServers") throw denied;
      return { active: true };
    });
    const error = await voice.start().catch(error => error);
    expect(error).toBe(denied);
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
    expect(errorMessage(error)).toBe("Couldn’t finish that. Please try again.");
  });

  it("does not claim a permission problem for an unavailable audio device", async () => {
    const unavailable = { name: "NotReadableError", message: "Audio device unavailable" };
    mocks.getUserMedia.mockRejectedValue(unavailable);
    const error = await voice.start().catch(error => error);
    expect(error).toBe(unavailable);
    expect(errorMessage(error)).toBe("Couldn’t finish that. Please try again.");
  });
});
