import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  type MediaStream,
} from "react-native-webrtc";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
} from "@react-native-firebase/firestore";
import {
  AUDIO,
  audioInterval,
  tuneOpus,
  type AudioCounters,
  type CallRecord,
} from "@famcall/core";
import { api, database } from "./firebase";
import { MicrophonePermissionError } from "./errors";
import { assertMicrophonePermission } from "./callReadiness";
import {
  recordTestMetric,
  testTransport,
  type TestTransport,
} from "./e2eDiagnostics";
import {setTimeout, clearTimeout, setInterval, clearInterval} from "react-native-nitro-keepalive-timer";

type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};
type Signal = { type: "offer" | "answer"; sdp: string; generation: number };
type Candidate = {
  senderId: string;
  generation: number;
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
};
export type VoiceState = "connecting" | "connected" | "reconnecting" | "ended";

/** One deterministic offerer per call avoids offer collisions during network recovery. */
export class VoicePeer {
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private muted = false;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private remoteGeneration = 0;
  private localIceGenerations = new Map<string, number>();
  private candidates: Candidate[] = [];
  private subscriptions: (() => void)[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private statsTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private heartbeatPending = false;
  private pendingRestart = false;
  private pendingForcedRestart = false;
  private restartAttempts = 0;
  private previousCounters?: AudioCounters;
  private lastRestartAt = 0;
  private state: VoiceState = "connecting";
  private transport: TestTransport | null = null;
  private proxyHost: string | null = null;
  private readonly caller: boolean;
  constructor(
    readonly call: CallRecord,
    readonly uid: string,
    private onState: (state: VoiceState) => void,
    private onError: (error: unknown) => void,
    private onMetrics?: (metrics: ReturnType<typeof audioInterval>) => void,
  ) {
    this.caller = call.callerId === uid;
  }

  private serial(action: () => Promise<void>) {
    this.queue = this.queue
      .then(async () => {
        if (!this.closed) await action();
      })
      .catch((e) => {
        if (!this.closed) this.onError(e);
      });
    return this.queue;
  }
  async start() {
    // Incoming calls can arrive while locked. Never let capture become the
    // first permission prompt; onboarding owns all permission requests.
    await assertMicrophonePermission();
    if (this.closed) return;
    await this.heartbeat();
    if (this.closed) return;
    this.heartbeatTimer = setInterval(() => { void this.heartbeat(); }, 30_000);
    const testing = await testTransport();
    this.transport = testing?.transport ?? null;
    this.proxyHost =
      testing?.proxy && testing.transport === "udp" ? testing.host : null;
    const credentials = await api<{
      iceServers: IceServer[];
      refreshAfterMs: number;
    }>("getIceServers", { callId: this.call.id });
    if (this.closed) return;
    this.pc = new RTCPeerConnection({
      iceServers: this.filterServers(credentials.iceServers),
      bundlePolicy: "max-bundle",
      iceTransportPolicy:
        this.transport && this.transport !== "direct" ? "relay" : "all",
    });
    this.stream = await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    }).catch((error: unknown) => {
      // react-native-webrtc reports denied audio permission as SecurityError.
      // Scope this interpretation to capture, never to server authorization.
      const name = (error as { name?: unknown } | null)?.name;
      if (name === "SecurityError" || name === "NotAllowedError")
        throw new MicrophonePermissionError();
      throw error;
    });
    if (this.closed) {
      this.stream.getTracks().forEach((t) => t.stop());
      return;
    }
    // A mute requested while permission/capture setup was pending must apply
    // before any microphone track is attached to the connection.
    this.mute(this.muted);
    const pc = this.pc;
    for (const track of this.stream.getTracks()) {
      const sender = pc.addTrack(track, this.stream);
      const parameters = sender.getParameters();
      if (parameters.encodings.length) {
        parameters.encodings[0].maxBitrate = AUDIO.bitrate;
        await sender.setParameters(parameters);
      }
    }
    pc.addEventListener("icecandidate", (event) => {
      const candidate = event.candidate?.toJSON();
      if (!candidate?.candidate || !this.generation || this.closed) return;
      const fragment = candidate.candidate.match(/\bufrag\s+(\S+)/)?.[1];
      const generation = fragment ? this.localIceGenerations.get(fragment) : this.generation;
      if (!generation) return;
      // Firestore's offline queue preserves trickle candidates across brief signaling outages.
      void addDoc(collection(database, "calls", this.call.id, "candidates"), {
        senderId: this.uid,
        generation,
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? "0",
        sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
      }).catch((e) => {
        if (!this.closed) this.onError(e);
      });
    });
    pc.addEventListener("connectionstatechange", () => {
      if (this.closed) return;
      recordTestMetric({
        kind: "state",
        callId: this.call.id,
        uid: this.uid,
        state: pc.connectionState,
      });
      if (pc.connectionState === "connected") {
        this.restartAttempts = 0;
        this.state = "connected";
        this.onState("connected");
      } else if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed"
      ) {
        this.state = "reconnecting";
        this.onState("reconnecting");
        this.later(
          () => this.requestRestart(),
          pc.connectionState === "failed" ? 500 : 2000,
        );
      }
    });
    const remote = this.caller ? this.call.calleeId : this.call.callerId;
    this.subscriptions.push(
      onSnapshot(
        doc(database, "calls", this.call.id, "signals", remote),
        (snap) => {
          if (snap.exists())
            void this.serial(() => this.receiveSignal(snap.data() as Signal));
        },
        this.onError,
      ),
    );
    this.subscriptions.push(
      onSnapshot(
        query(
          collection(database, "calls", this.call.id, "candidates"),
          where("senderId", "==", remote),
        ),
        (snap) => {
          for (const change of snap.docChanges())
            if (change.type === "added") {
              const candidate = change.doc.data() as Candidate;
              if (candidate.generation >= this.remoteGeneration)
                this.candidates.push(candidate);
            }
          void this.serial(() => this.flushCandidates());
        },
        this.onError,
      ),
    );
    if (this.caller) {
      this.subscriptions.push(
        onSnapshot(
          doc(database, "calls", this.call.id, "restarts", remote),
          (snap) => {
            if (snap.exists()) void this.requestRestart(true);
          },
          this.onError,
        ),
      );
      await this.serial(() => this.offer(false));
    }
    this.scheduleRefresh(credentials.refreshAfterMs);
    this.statsTimer = setInterval(() => {
      void this.collectStats();
    }, 3000);
    // With no usable candidate, native ICE can remain "new" and never emit a
    // disconnected/failed event. Start the bounded retry policy in that case.
    this.later(() => {
      if (this.state === "connecting") return this.requestRestart();
    }, 15_000);
  }
  private async heartbeat() {
    if (this.closed || this.heartbeatPending) return;
    this.heartbeatPending = true;
    try {
      const result = await api<{active: boolean}>("heartbeatCall", {callId: this.call.id});
      if (!result.active && !this.closed) {
        this.close();
        this.onError(new Error("call-expired"));
      }
    } catch { /* A temporary signaling outage must not interrupt working audio. */ }
    finally { this.heartbeatPending = false; }
  }
  private later(action: () => void | Promise<void>, delay: number) {
    this.timers.push(
      setTimeout(() => {
        if (!this.closed) void action();
      }, delay),
    );
  }
  private scheduleRefresh(delay: number) {
    this.later(async () => {
      try {
        const next = await api<{
          iceServers: IceServer[];
          refreshAfterMs: number;
        }>("getIceServers", { callId: this.call.id });
        if (this.closed) return;
        this.pc?.setConfiguration({
          iceServers: this.filterServers(next.iceServers),
          bundlePolicy: "max-bundle",
          iceTransportPolicy:
            this.transport && this.transport !== "direct" ? "relay" : "all",
        });
        await this.requestRestart(true);
        this.scheduleRefresh(next.refreshAfterMs);
      } catch (e) {
        if (!this.closed) {
          this.onError(e);
          this.scheduleRefresh(15_000);
        }
      }
    }, delay);
  }
  private filterServers(servers: IceServer[]) {
    if (!this.transport || this.transport === "direct") return servers;
    const expected =
      this.transport === "tls"
        ? "turns:turn.cloudflare.com:443?transport=tcp"
        : "turn:turn.cloudflare.com:3478?transport=" + this.transport;
    return servers
      .map((server) => ({
        ...server,
        urls: (Array.isArray(server.urls) ? server.urls : [server.urls])
          .filter((url) => url === expected)
          .map((url) =>
            this.proxyHost
              ? "turn:" + this.proxyHost + ":3479?transport=udp"
              : url,
          ),
      }))
      .filter((server) => server.urls.length);
  }
  async requestRestart(force = false) {
    if (
      this.closed ||
      !this.pc ||
      (!force && this.pc.connectionState === "connected")
    )
      return;
    const cooldown = 2000 - (Date.now() - this.lastRestartAt);
    if (cooldown > 0) {
      // A credential refresh must eventually restart ICE with its new servers,
      // even if the other peer requested a restart moments earlier.
      if (force && !this.pendingForcedRestart) {
        this.pendingForcedRestart = true;
        this.later(() => {
          this.pendingForcedRestart = false;
          return this.requestRestart(true);
        }, cooldown);
      }
      return;
    }
    this.lastRestartAt = Date.now();
    if (this.caller) {
      await this.serial(() => this.offer(true));
    } else {
      await setDoc(doc(database, "calls", this.call.id, "restarts", this.uid), {
        nonce: String(Date.now()),
      }).catch(this.onError);
    }
    if (!force) {
      this.restartAttempts++;
      if (this.restartAttempts < 6)
        this.later(
          () => this.requestRestart(),
          Math.min(15_000, 2000 * 2 ** this.restartAttempts),
        );
      else this.onError(new Error("reconnection-exhausted"));
    }
  }
  private async offer(restart: boolean) {
    const pc = this.pc;
    if (!pc) return;
    if (pc.signalingState !== "stable") {
      this.pendingRestart = true;
      return;
    }
    this.generation++;
    const description = await pc.createOffer({ iceRestart: restart });
    const sdp = tuneOpus(description.sdp ?? "");
    this.rememberIceGeneration(sdp);
    await pc.setLocalDescription({ type: "offer", sdp });
    await setDoc(doc(database, "calls", this.call.id, "signals", this.uid), {
      type: "offer",
      sdp,
      generation: this.generation,
    });
  }
  private async receiveSignal(signal: Signal) {
    const pc = this.pc;
    if (!pc || signal.generation <= this.remoteGeneration) return;
    if (this.caller) {
      if (
        signal.type !== "answer" ||
        signal.generation !== this.generation ||
        pc.signalingState !== "have-local-offer"
      )
        return;
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp: signal.sdp }),
      );
      this.remoteGeneration = signal.generation;
      await this.flushCandidates();
      if (this.pendingRestart) {
        this.pendingRestart = false;
        await this.offer(true);
      }
    } else {
      if (signal.type !== "offer" || pc.signalingState !== "stable") return;
      this.generation = signal.generation;
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: "offer", sdp: signal.sdp }),
      );
      this.remoteGeneration = signal.generation;
      await this.flushCandidates();
      const answer = await pc.createAnswer();
      const sdp = tuneOpus(answer.sdp ?? "");
      this.rememberIceGeneration(sdp);
      await pc.setLocalDescription({ type: "answer", sdp });
      await setDoc(doc(database, "calls", this.call.id, "signals", this.uid), {
        type: "answer",
        sdp,
        generation: this.generation,
      });
    }
  }
  private async flushCandidates() {
    if (!this.pc?.remoteDescription) return;
    const current = this.candidates.filter(
      (c) => c.generation === this.remoteGeneration,
    );
    this.candidates = this.candidates.filter(
      (c) => c.generation > this.remoteGeneration,
    );
    for (const candidate of current)
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
  private rememberIceGeneration(sdp: string) {
    const fragment = sdp.match(/^a=ice-ufrag:(\S+)/m)?.[1];
    if (fragment) this.localIceGenerations.set(fragment, this.generation);
  }
  mute(muted: boolean) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    recordTestMetric({
      kind: "microphone-state",
      callId: this.call.id,
      uid: this.uid,
      muted,
      // JavaScript track state, not proof of recorded/transmitted silence.
      trackEnabled: this.stream?.getAudioTracks().map((track) => track.enabled) ?? [],
    });
  }
  private async collectStats() {
    if (!this.pc || this.closed) return;
    try {
      const reports = await this.pc.getStats();
      if (this.transport) {
        const rows: Record<string, unknown>[] = [];
        reports.forEach((r: Record<string, unknown>) => {
          if (
            [
              "inbound-rtp",
              "outbound-rtp",
              "candidate-pair",
              "local-candidate",
              "remote-candidate",
              "transport",
              "media-source",
            ].includes(String(r.type))
          ) {
            const keep = [
              "id",
              "type",
              "kind",
              "mediaType",
              "timestamp",
              "packetsReceived",
              "packetsSent",
              "packetsLost",
              "bytesReceived",
              "bytesSent",
              "jitter",
              "totalAudioEnergy",
              "totalSamplesDuration",
              "totalSamplesReceived",
              "concealedSamples",
              "silentConcealedSamples",
              "concealmentEvents",
              "insertedSamplesForDeceleration",
              "removedSamplesForAcceleration",
              "jitterBufferDelay",
              "jitterBufferTargetDelay",
              "jitterBufferEmittedCount",
              "jitterBufferMinimumDelay",
              "currentRoundTripTime",
              "availableOutgoingBitrate",
              "state",
              "nominated",
              "selectedCandidatePairId",
              "localCandidateId",
              "remoteCandidateId",
              "candidateType",
              "protocol",
              "relayProtocol",
              "audioLevel",
            ];
            rows.push(
              Object.fromEntries(
                keep.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]),
              ),
            );
          }
        });
        recordTestMetric({
          kind: "stats",
          callId: this.call.id,
          uid: this.uid,
          rows,
        });
      }
      reports.forEach(
        (report: {
          type?: string;
          kind?: string;
          mediaType?: string;
          timestamp: number;
          packetsReceived?: number;
          packetsLost?: number;
          bytesReceived?: number;
          totalAudioEnergy?: number;
          totalSamplesDuration?: number;
        }) => {
          if (
            report.type === "inbound-rtp" &&
            (report.kind === "audio" || report.mediaType === "audio")
          ) {
            const next: AudioCounters = {
              timestampMs: report.timestamp,
              packetsReceived: report.packetsReceived ?? 0,
              packetsLost: report.packetsLost ?? 0,
              bytesReceived: report.bytesReceived ?? 0,
              totalAudioEnergy: report.totalAudioEnergy,
              totalSamplesDuration: report.totalSamplesDuration,
            };
            if (this.previousCounters)
              this.onMetrics?.(audioInterval(this.previousCounters, next));
            this.previousCounters = next;
          }
        },
      );
    } catch {
      /* A stats read must never interrupt a call. */
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.subscriptions.forEach((u) => u());
    this.timers.forEach(clearTimeout);
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream?.release();
    this.pc?.close();
    this.pc = null;
    this.stream = null;
    this.state = "ended";
    this.onState("ended");
  }
}
