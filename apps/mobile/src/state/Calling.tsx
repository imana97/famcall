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

  function watch(id: string) {
    if (watchedId.current === id) return;
    callUnsubscribe.current?.();
    peer.current?.close();
    peer.current = null;
    update({ ...initial });
    watchedId.current = id;
    callUnsubscribe.current = onSnapshot(
      doc(database, "calls", id),
      (snap) => {
        if (!snap.exists()) return;
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
          }).catch(fail);
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
      fail,
    );
  }
  async function connect(call: CallRecord) {
    if (peer.current || !user || hasEndedLocally(call.id)) return;
    Calls.setRTCAudioSessionConfiguration(false);
    const connection = new VoicePeer(
      call,
      user.uid,
      (state) => {
        update({ voice: state });
        if (state === "connected") {
          update({
            connectedAt: current.current.connectedAt ?? Date.now(),
            error: null,
          });
          if (call.callerId === user.uid && nativeId.current)
            void Calls.reportOutgoingCallConnected(nativeId.current).catch(
              fail,
            );
          else if (answerRequest.current) {
            void Calls.fulfillIncomingCallConnected(
              answerRequest.current,
            ).catch(fail);
            answerRequest.current = null;
          }
        }
      },
      (error) => {
        fail(error);
        if (["reconnection-exhausted", "call-expired"].includes((error as Error)?.message)) void end();
      },
    );
    peer.current = connection;
    try {
      await connection.start();
    } catch (e) {
      connection.close();
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
    const outboxReady = restoreCallOutbox(uid).then(flush).catch(failEvent);
    const adopt = async (session: Calls.CallSession) => {
      const id = session.incomingCallEvent?.serverCallId;
      if (!id) return;
      await outboxReady;
      if (!mounted) return;
      if (hasEndedLocally(id)) {
        await Calls.reportCallEnded(session.id, "remoteEnded");
        return;
      }
      nativeId.current = session.id;
      watchEvent(id);
      if (AppState.currentState === "active")
        router.push({ pathname: "/call/[id]", params: { id } });
    };
    const detachEvents = consumeNativeEvents((event) => {
      if (event.kind === "session") void adopt(event.event.session);
      else if (event.kind === "mute") {
        peer.current?.mute(event.event.isMuted);
        update({ muted: event.event.isMuted });
      } else if (event.kind === "end") {
        if (event.event.id === nativeId.current) void endEvent();
        else {
          const id = event.event.session.incomingCallEvent?.serverCallId;
          if (id) void queueCallEnd(uid, id).then(flush).catch(failEvent);
        }
      } else if (event.kind === "answer") {
        answerRequest.current = event.event.requestId;
        nativeId.current = event.event.id;
        void Calls.getActiveCallSession()
          .then(async (session) => {
            if (!session) return;
            const id = session.incomingCallEvent?.serverCallId;
            if (!id) return;
            watchEvent(id);
            await api("updateCall", { callId: id, action: "accept" });
            router.push({ pathname: "/call/[id]", params: { id } });
          })
          .catch(failEvent);
      }
    });
    void Calls.getActiveCallSession()
      .then((session) => {
        if (session && mounted) void adopt(session);
      })
      .catch(failEvent);
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
    const active = onSnapshot(
      doc(database, "activeCalls", uid),
      (snap) => {
        const id = snap.data()?.callId as string | undefined;
        if (id)
          void outboxReady.then(() => {
            if (mounted && !hasEndedLocally(id)) watchEvent(id);
          });
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
      tokens.remove();
      active();
      callUnsubscribe.current?.();
      watchedId.current = null;
      peer.current?.close();
      peer.current = null;
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
