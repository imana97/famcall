import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=ice-ufrag:test\r\n";
  class Peer {
    connectionState = "new";
    signalingState = "stable";
    createOffer = vi.fn(async () => ({ sdp, type: "offer" }));
    setLocalDescription = vi.fn(async () => undefined);
    setConfiguration = vi.fn();
    addEventListener = vi.fn();
    addTrack = vi.fn(() => ({ getParameters: () => ({ encodings: [] }) }));
    getStats = vi.fn(async () => new Map());
    close = vi.fn();
  }
  return { Peer, api: vi.fn(), track: { stop: vi.fn() } };
});
vi.mock("react-native-webrtc", () => ({
  RTCPeerConnection: mocks.Peer,
  RTCIceCandidate: class {}, RTCSessionDescription: class {},
  mediaDevices: { getUserMedia: async () => ({ getTracks: () => [mocks.track], release: vi.fn() }) },
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
