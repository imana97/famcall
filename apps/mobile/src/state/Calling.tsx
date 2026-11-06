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
import * as Notifications from "expo-notifications";
import { randomUUID } from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { doc, onSnapshot } from "@react-native-firebase/firestore";
import { isTerminal, type CallRecord } from "@famcall/core";
import { api, database, isE2E } from "../services/firebase";
import { consumeNativeEvents } from "../services/nativeEvents";
import { NativeCallCoordinator } from "../services/NativeCallCoordinator";
import { VoicePeer, type VoiceState } from "../services/VoicePeer";
import { errorMessage } from "../services/errors";
import {
  flushCallOutbox,
  hasEndedLocally,
  queueCallEnd,
  restoreCallOutbox,
} from "../services/callOutbox";
import { useSession } from "./Session";

interface CallView {
  call: CallRecord | null;
  voice: VoiceState;
  muted: boolean;
  speaker: boolean;
  error: string | null;
  connectedAt: number | null;
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
  const [view, setView] = useState<CallView>(initial);
  const current = useRef(view);
  const peer = useRef<VoicePeer | null>(null);
  const nativeId = useRef<string | null>(null);
  const answerRequest = useRef<string | null>(null);
  const watchedId = useRef<string | null>(null);
  const callUnsubscribe = useRef<(() => void) | null>(null);
  const starting = useRef(false);
  const ending = useRef(false);
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

  function watch(id: string, initialMuted?: boolean) {
    if (watchedId.current === id) {
      if (initialMuted !== undefined) applyMute(initialMuted);
      return;
    }
    const muted = initialMuted ?? (current.current.call?.id === id ? current.current.muted : false);
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
        update({ call });
        if (
          call.status === "ringing" &&
          call.calleeId === user?.uid &&
          !nativeId.current &&
          reporting.current !== call.id &&
          Date.now() < call.ringExpiresAtMs
        ) {
          reporting.current = call.id;
          void Calls.reportIncomingCall({
            eventId: call.id,
            serverCallId: call.id,
            hasVideo: false,
            supportsDTMF: false,
            supportsHolding: false,
            startedAt: new Date(call.createdAtMs).toISOString(),
            caller: {
              id: call.callerId,
              phoneNumber: call.callerPhone,
              displayName: call.callerPhone,
            },
          }).catch(error => { if (watchedId.current === id) fail(error); });
        }
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
    if (starting.current || !user) return;
    if (current.current.call && !isTerminal(current.current.call.status))
      return;
    starting.current = true;
    update({ ...initial });
    let call: CallRecord | undefined;
    try {
      call = await api<CallRecord>("startCall", {
        phone,
        requestId: randomUUID(),
      });
      update({ call });
      nativeId.current = await Calls.startOutgoingCall(
        { id: call.calleeId, phoneNumber: phone, displayName: phone },
        { hasVideo: false, supportsDTMF: false, supportsHolding: false },
      );
      watch(call.id);
      if (current.current.call?.status === "accepted") void connect(current.current.call);
      router.replace({ pathname: "/call/[id]", params: { id: call.id } });
    } catch (e) {
      if (call)
        await api("updateCall", { callId: call.id, action: "cancel" }).catch(
          () => undefined,
        );
      fail(e);
      throw e;
    } finally {
      starting.current = false;
    }
  }
  async function answer() {
    if (nativeId.current) await Calls.answerCall(nativeId.current);
  }
  async function end() {
    if (ending.current) return;
    ending.current = true;
    const call = current.current.call;
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
        await queueCallEnd(user.uid, call.id);
        flushPending.current();
      }
    } catch (e) {
      fail(e);
    } finally {
      ending.current = false;
    }
  }
  const watchEvent = useEffectEvent(watch);
  const endEvent = useEffectEvent(end);
  const failEvent = useEffectEvent(fail);
  const muteEvent = useEffectEvent(applyMute);
  const connectEvent = useEffectEvent(connect);
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    let mounted = true;
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
      if (state.isConnected) flush();
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") flush();
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
        if (event.id === nativeId.current) void endEvent();
        // The native session can be known before Firestore supplies CallView.
        // Persist its server ID even when end() has no loaded call to enqueue.
        const id = event.session.incomingCallEvent?.serverCallId;
        if (id) void queueCallEnd(uid, id).then(flush).catch(error => { if (mounted) failEvent(error); });
      },
      answer: (session, requestId) => {
        const id = session.incomingCallEvent!.serverCallId;
        answerRequest.current = requestId;
        void api("updateCall", { callId: id, action: "accept" })
          .then(() => {
            if (mounted && nativeId.current === session.id && watchedId.current === id && !hasEndedLocally(id))
              router.replace({ pathname: "/call/[id]", params: { id } });
          }).catch(error => {
            if (mounted && nativeId.current === session.id && watchedId.current === id) failEvent(error);
          });
      },
      dismiss: (id) => { void Calls.reportCallEnded(id, "remoteEnded").catch(error => { if (mounted) failEvent(error); }); },
      error: failEvent,
    });
    const detachEvents = consumeNativeEvents(event => coordinator.handle(event));
    void coordinator.start();
    const register = async (token: Calls.VoIPPushToken | null) => {
      if (!token || !mounted) return;
      let installationId = await AsyncStorage.getItem("famcall-installation");
      if (!installationId) {
        installationId = randomUUID();
        await AsyncStorage.setItem("famcall-installation", installationId);
      }
      await api("registerDevice", { installationId, ...token });
    };
    const tokens = Calls.addVoIPPushTokenUpdatedListener((event) => {
      void register(
        event.token ? { token: event.token, type: event.type } : null,
      ).catch(failEvent);
    });
    if (!isE2E) {
      void Notifications.requestPermissionsAsync()
        .then(() => Calls.registerVoIPPush())
        .then(() => Calls.getVoIPPushToken())
        .then(register)
        .catch(failEvent);
    }
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
      flushPending.current = () => undefined;
      if (retryTimer) clearTimeout(retryTimer);
      detachNetwork();
      appState.remove();
      detachEvents();
      coordinator.dispose();
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
