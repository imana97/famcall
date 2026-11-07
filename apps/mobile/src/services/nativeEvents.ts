import * as Calls from "expo-callkit-telecom";
export type NativeEvent =
  | { kind: "answer"; event: Calls.CallAnsweredEvent }
  | { kind: "end"; event: Calls.CallEndedEvent }
  | { kind: "mute"; event: Calls.SetMutedActionEvent }
  | { kind: "session"; event: Calls.CallSessionAddedEvent };
let handler: ((event: NativeEvent) => void) | undefined;
const waiting: NativeEvent[] = [];
const send = (event: NativeEvent) => {
  if (__DEV__) console.info("[FamCall native]", JSON.stringify({
    kind: event.kind,
    id: event.kind === "session" ? event.event.session.id : event.event.id,
    status: event.kind === "session" || event.kind === "end" ? event.event.session.status : undefined,
    serverCallId: event.kind === "session" || event.kind === "end" ? event.event.session.incomingCallEvent?.serverCallId : undefined,
  }));
  if (handler) handler(event);
  else waiting.push(event);
};
// Installed before Expo Router mounts so cold-start native actions are retained.
Calls.addCallAnsweredListener((event) => send({ kind: "answer", event }));
Calls.addCallEndedListener((event) => send({ kind: "end", event }));
Calls.addSetMutedActionListener((event) => send({ kind: "mute", event }));
Calls.addCallSessionAddedListener((event) => send({ kind: "session", event }));
export function consumeNativeEvents(next: (event: NativeEvent) => void) {
  handler = next;
  waiting.splice(0).forEach(next);
  return () => {
    if (handler === next) handler = undefined;
  };
}
