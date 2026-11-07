import React, {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import * as Calls from "expo-callkit-telecom";
import { randomUUID } from "expo-crypto";
import NetInfo from "@react-native-community/netinfo";
import { doc, onSnapshot } from "@react-native-firebase/firestore";
import { isTerminal, type CallRecord } from "@famcall/core";
import { api, auth, database, isE2E } from "../services/firebase";
import { DeviceRegistration } from "../services/DeviceRegistration";
import { prepareDeviceRegistration } from "../services/deviceRegistrationStorage";
import { consumeNativeEvents } from "../services/nativeEvents";
import { NativeCallCoordinator } from "../services/NativeCallCoordinator";
import { OutgoingCallAttempt } from "../services/OutgoingCallAttempt";
import { recordTestMetric, waitForTestCallStart } from "../services/e2eDiagnostics";
import { VoicePeer, type VoiceState } from "../services/VoicePeer";
import { callStartError, errorMessage } from "../services/errors";
import { assertMicrophonePermission } from "../services/callReadiness";
import {
  flushCallOutbox,
  hasEndedLocally,
  queueCallEnd,
  restoreCallOutbox,
} from "../services/callOutbox";
import { useSession } from "./Session";
import { useCallReadiness } from "./CallReadiness";

interface CallView {
  call: CallRecord | null;
  voice: VoiceState;
  muted: boolean;
  speaker: boolean;
  error: string | null;
  connectedAt: number | null;
  cancelledBeforeStart: boolean;
}
interface Calling extends CallView {
  start: (phone: string) => Promise<void>;
  answer: () => Promise<void>;
  end: () => Promise<void>;
  toggleMute: () => void;
  toggleSpeaker: () => void;
}
const initial: CallView = {
  call: null,
  voice: "connecting",
  muted: false,
  speaker: false,
  error: null,
  connectedAt: null,
  cancelledBeforeStart: false,
};
const Context = createContext<Calling>({
  ...initial,
  async start() {},
  async answer() {},
  async end() {},
  toggleMute() {},
  toggleSpeaker() {},
});

export function CallingProvider({ children }: React.PropsWithChildren) {
  const { user } = useSession();
  const readiness = useCallReadiness();
  const permissionsReady = useRef(readiness.canCall);
  permissionsReady.current = readiness.canCall;
  const refreshRegistration = useRef<() => void>(() => undefined);
  const [view, setView] = useState<CallView>(initial);
  const current = useRef(view);
  const peer = useRef<VoicePeer | null>(null);
  const nativeId = useRef<string | null>(null);
  const answerRequest = useRef<string | null>(null);
  const watchedId = useRef<string | null>(null);
  const callUnsubscribe = useRef<(() => void) | null>(null);
  const outgoing = useRef<OutgoingCallAttempt | null>(null);
  const endedNativeIds = useRef(new Set<string>());
  const reporting = useRef<string | null>(null);
  const flushPending = useRef<() => void>(() => undefined);
  const update = (patch: Partial<CallView>) => {
    current.current = { ...current.current, ...patch };
    setView(current.current);
  };
  const fail = (e: unknown) => update({ error: errorMessage(e) });
  const applyMute = (muted: boolean) => {
    peer.current?.mute(muted);
    update({ muted });
  };

  function reportIncoming(call: CallRecord) {
    if (call.status !== "ringing" || call.calleeId !== user?.uid ||
        !permissionsReady.current || nativeId.current || reporting.current === call.id ||
        watchedId.current !== call.id || hasEndedLocally(call.id) || Date.now() >= call.ringExpiresAtMs) return;
    reporting.current = call.id;
    void Calls.reportIncomingCall({
      eventId: call.id,
      serverCallId: call.id,
      hasVideo: false,
      supportsDTMF: false,
      supportsHolding: false,
      startedAt: new Date(call.createdAtMs).toISOString(),
      caller: { id: call.callerId, phoneNumber: call.callerPhone, displayName: call.callerPhone },
    }).catch(error => { if (watchedId.current === call.id) fail(error); });
  }

  function watch(id: string, initialMuted?: boolean) {
    if (watchedId.current === id) {
      if (initialMuted !== undefined) applyMute(initialMuted);
      return;
    }
    const sameCall = current.current.call?.id === id || outgoing.current?.id === id;
    const muted = initialMuted ?? (sameCall ? current.current.muted : false);
    watchedId.current = id;
    callUnsubscribe.current?.();
    peer.current?.close();
    peer.current = null;
    update({ ...initial, muted });
    callUnsubscribe.current = onSnapshot(
      doc(database, "calls", id),
      (snap) => {
        if (watchedId.current !== id || !snap.exists()) return;
        const call = snap.data() as CallRecord;
        if (hasEndedLocally(call.id) && !isTerminal(call.status)) return;
        recordTestMetric({ kind: "call-record", callId: call.id, status: call.status, muted: current.current.muted });
        update({ call });
        reportIncoming(call);
        if (isTerminal(call.status)) {
          peer.current?.close();
          peer.current = null;
          if (nativeId.current)
            void Calls.reportCallEnded(
              nativeId.current,
              call.status === "missed" ? "unanswered" : "remoteEnded",
            ).catch(() => undefined);
          nativeId.current = null;
          answerRequest.current = null;
        } else if (call.status === "accepted") void connect(call);
      },
      error => { if (watchedId.current === id) fail(error); },
    );
  }
  async function connect(call: CallRecord) {
    if (peer.current || !user || !nativeId.current || hasEndedLocally(call.id)) return;
    Calls.setRTCAudioSessionConfiguration(false);
    const connection = new VoicePeer(
      call,
      user.uid,
      (state) => {
        if (peer.current !== connection || watchedId.current !== call.id) return;
        update({ voice: state });
        if (state === "connected") {
          update({
            connectedAt: current.current.connectedAt ?? Date.now(),
            error: null,
          });
          if (call.callerId === user.uid && nativeId.current)
            void Calls.reportOutgoingCallConnected(nativeId.current).catch(error => {
              if (peer.current === connection) fail(error);
            });
          else if (answerRequest.current) {
            void Calls.fulfillIncomingCallConnected(
              answerRequest.current,
            ).catch(error => { if (peer.current === connection) fail(error); });
            answerRequest.current = null;
          }
        }
      },
      (error) => {
        if (peer.current !== connection || watchedId.current !== call.id) return;
        fail(error);
        if (["reconnection-exhausted", "call-expired"].includes((error as Error)?.message)) void end();
      },
    );
    peer.current = connection;
    connection.mute(current.current.muted);
    try {
      await connection.start();
    } catch (e) {
      const ownsCall = peer.current === connection && watchedId.current === call.id;
      connection.close();
      if (!ownsCall) return;
      peer.current = null;
      fail(e);
      await end();
    }
  }
  async function start(phone: string) {
    if (outgoing.current?.active || !user) return;
    if (current.current.call && !isTerminal(current.current.call.status))
      return;
    const uid = user.uid;
    const id = randomUUID();
    const flush = flushPending.current;
    watchedId.current = null;
    callUnsubscribe.current?.();
    callUnsubscribe.current = null;
    update({ ...initial });
    const attempt: OutgoingCallAttempt = new OutgoingCallAttempt(id, {
      isCurrent: () => outgoing.current === attempt && (!watchedId.current || watchedId.current === id),
      hasEndedLocally: () => hasEndedLocally(id) ||
        (current.current.call?.id === id && isTerminal(current.current.call.status)),
      nativeEnded: systemId => endedNativeIds.current.has(systemId),
      preflight: async () => {
        // The attempt already owns cancellation while OS checks are pending.
        // Nothing rings and no server call exists until this check succeeds.
        const allowed = await readiness.preflight();
        if (!attempt.active || auth.currentUser?.uid !== uid) return false;
        if (!allowed && AppState.currentState === "active") router.push("/calling-setup");
        return allowed;
      },
      create: async () => {
        await waitForTestCallStart("before-request", id);
        const call = await api<CallRecord>("startCall", { phone, requestId: id })
          .catch(error => { throw callStartError(error); });
        await waitForTestCallStart("after-response", id);
        return call;
      },
      startNative: async call => {
        const systemId = await Calls.startOutgoingCall(
          { id: call.calleeId, phoneNumber: phone, displayName: phone },
          { hasVideo: false, supportsDTMF: false, supportsHolding: false },
        );
        try { await waitForTestCallStart("after-native", id); }
        catch (error) { await Calls.endCall(systemId); throw error; }
        return systemId;
      },
      endNative: Calls.endCall,
      persistEnd: () => queueCallEnd(uid, id).then(flush),
      record: call => {
        // Firestore can deliver an answer/terminal state before the callable
        // response. Do not replace that newer state with its ringing snapshot.
        if (current.current.call?.id !== id) update({ call });
      },
      ready: (call, systemId) => {
        recordTestMetric({ kind: "outgoing-bound", callId: id, status: current.current.call?.status, muted: current.current.muted });
        nativeId.current = systemId;
        watch(call.id);
        if (current.current.muted) void Calls.setMuted(systemId, true).catch(error => {
          if (nativeId.current === systemId) fail(error);
        });
        if (current.current.call?.status === "accepted") void connect(current.current.call);
        router.replace({ pathname: "/call/[id]", params: { id: call.id } });
      },
      cancelled: () => { void end(); },
      error: error => {
        const call = current.current.call;
        if (call?.id === id && !isTerminal(call.status))
          update({ call: { ...call, status: "failed", endedAtMs: Date.now() } });
        fail(error);
      },
    });
    outgoing.current = attempt;
    recordTestMetric({ kind: "outgoing-start", callId: id, uid });
    await attempt.run();
    if (outgoing.current === attempt) outgoing.current = null;
    if (isE2E) void Calls.getActiveCallSession().then(session => {
      recordTestMetric({ kind: "outgoing-finished", callId: id,
        nativeSession: session ? { id: session.id, status: session.status } : null });
    }).catch(() => undefined);
  }
  async function answer() {
    if (nativeId.current) await Calls.answerCall(nativeId.current);
  }
  async function end() {
    const call = current.current.call;
    const attempt = outgoing.current && (!call || call.id === outgoing.current.id)
      ? outgoing.current : null;
    const pendingEnd = attempt?.cancel();
    const flush = flushPending.current;
    const systemId = nativeId.current;
    nativeId.current = null;
    peer.current?.close();
    peer.current = null;
    try {
      if (systemId) void Calls.endCall(systemId).catch(() => undefined);
      if (call && user && !isTerminal(call.status)) {
        update({
          call: {
            ...call,
            status:
              call.status === "accepted"
                ? "ended"
                : call.callerId === user.uid
                  ? "cancelled"
                  : "declined",
            endedAtMs: Date.now(),
          },
        });
      } else if (!call && attempt) {
        update({ cancelledBeforeStart: true });
      }
      if (pendingEnd) await pendingEnd;
      else if (call && user && !isTerminal(call.status)) await queueCallEnd(user.uid, call.id);
      flush();
    } catch (e) {
      if ((call && current.current.call?.id === call.id) || (attempt && outgoing.current === attempt)) fail(e);
    }
  }
  const watchEvent = useEffectEvent(watch);
  const endEvent = useEffectEvent(end);
  const failEvent = useEffectEvent(fail);
  const muteEvent = useEffectEvent(applyMute);
  const connectEvent = useEffectEvent(connect);
  const reconcilePermissions = useEffectEvent(() => {
    if (current.current.call) reportIncoming(current.current.call);
  });
  const uid = user?.uid;
  useEffect(() => {
    if (readiness.canCall) {
      refreshRegistration.current();
      // Firestore can publish a ringing call before the first permission read.
      // It need not publish it again when setup finishes.
      reconcilePermissions();
    }
  }, [readiness.canCall]);
  useEffect(() => {
    if (!uid) return;
    let mounted = true;
    const registration = new DeviceRegistration(uid, {
      current: () => mounted && auth.currentUser?.uid === uid && permissionsReady.current,
      registerNative: Calls.registerVoIPPush,
      readToken: Calls.getVoIPPushToken,
      prepare: prepareDeviceRegistration,
      send: (data) => api("registerDevice", data),
      error: failEvent,
    });
    const register = () => {
      if (!isE2E && mounted && permissionsReady.current) {
        registration.start();
        registration.refresh();
      }
    };
    refreshRegistration.current = register;
    register();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (!mounted) return;
      if (retryTimer) clearTimeout(retryTimer);
      void flushCallOutbox(uid).catch(() => {
        if (mounted) retryTimer = setTimeout(flush, 15_000);
      });
    };
    flushPending.current = flush;
    const detachNetwork = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        flush();
        if (state.isInternetReachable !== false) registration.refresh();
      }
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        flush();
        registration.refresh();
      }
    });
    const outboxReady = restoreCallOutbox(uid).then(flush);
    const coordinator = new NativeCallCoordinator({
      ready: outboxReady,
      getActive: Calls.getActiveCallSession,
      getActiveId: () => nativeId.current,
      hasEndedLocally,
      adopt: (session) => {
        const id = session.incomingCallEvent!.serverCallId;
        const alreadyWatching = watchedId.current === id && nativeId.current === session.id;
        nativeId.current = session.id;
        watchEvent(id, session.isMuted);
        if (current.current.call?.status === "accepted") void connectEvent(current.current.call);
        if (!alreadyWatching && AppState.currentState === "active")
          router.push({ pathname: "/call/[id]", params: { id } });
      },
      mute: (event) => muteEvent(event.isMuted),
      end: (event) => {
        endedNativeIds.current.add(event.id);
        if (event.id === nativeId.current) void endEvent();
        // The native session can be known before Firestore supplies CallView.
        // Persist its server ID even when end() has no loaded call to enqueue.
        const id = event.session.incomingCallEvent?.serverCallId;
        if (id) void queueCallEnd(uid, id).then(flush).catch(error => { if (mounted) failEvent(error); });
      },
      answer: (session, requestId) => {
        const id = session.incomingCallEvent!.serverCallId;
        answerRequest.current = requestId;
        void assertMicrophonePermission()
          .then(() => {
            if (!mounted || nativeId.current !== session.id || hasEndedLocally(id)) return;
            return api("updateCall", { callId: id, action: "accept" });
          })
          .then(() => {
            if (mounted && nativeId.current === session.id && watchedId.current === id && !hasEndedLocally(id))
              router.replace({ pathname: "/call/[id]", params: { id } });
          }).catch(error => {
            if (!mounted || nativeId.current !== session.id || watchedId.current !== id) return;
            failEvent(error);
            answerRequest.current = null;
            // A revoked microphone must not open a prompt on the lock screen
            // or leave the native answer action waiting until it times out.
            void Calls.failIncomingCallConnected(session.id, requestId).catch(() => undefined);
            // Native answer can precede the first Firestore call snapshot.
            // Persist its known server ID even when end() has no CallView yet.
            void queueCallEnd(uid, id).then(flush).catch(error => { if (mounted) failEvent(error); });
            void endEvent();
          });
      },
      dismiss: (id) => { void Calls.reportCallEnded(id, "remoteEnded").catch(error => { if (mounted) failEvent(error); }); },
      error: failEvent,
    });
    const detachEvents = consumeNativeEvents(event => coordinator.handle(event));
    void coordinator.start();
    const tokens = Calls.addVoIPPushTokenUpdatedListener((event) => {
      registration.update(
        event.token ? { token: event.token, type: event.type } : null,
      );
    });
    let activeRevision = 0;
    const active = onSnapshot(
      doc(database, "activeCalls", uid),
      (snap) => {
        const revision = ++activeRevision;
        const id = snap.data()?.callId as string | undefined;
        if (id)
          void outboxReady.then(() => {
            if (mounted && revision === activeRevision && !hasEndedLocally(id)) watchEvent(id);
          }).catch(error => { if (mounted) failEvent(error); });
      },
      failEvent,
    );
    return () => {
      mounted = false;
      registration.dispose();
      refreshRegistration.current = () => undefined;
      flushPending.current = () => undefined;
      if (retryTimer) clearTimeout(retryTimer);
      detachNetwork();
      appState.remove();
      detachEvents();
      coordinator.dispose();
      void outgoing.current?.cancel().catch(() => undefined);
      outgoing.current = null;
      tokens.remove();
      active();
      callUnsubscribe.current?.();
      watchedId.current = null;
      peer.current?.close();
      peer.current = null;
      nativeId.current = null;
      answerRequest.current = null;
    };
  }, [uid]);
  return (
    <Context.Provider
      value={{
        ...view,
        start,
        answer,
        end,
        toggleMute: () => {
          const muted = !current.current.muted;
          peer.current?.mute(muted);
          if (nativeId.current)
            void Calls.setMuted(nativeId.current, muted).catch(fail);
          update({ muted });
        },
        toggleSpeaker: () => {
          const speaker = !current.current.speaker;
          Calls.setAudioSessionPortOverride(speaker);
          update({ speaker });
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useCalling = () => useContext(Context);
