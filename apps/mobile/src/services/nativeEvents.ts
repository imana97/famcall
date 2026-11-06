import * as Calls from "expo-callkit-telecom";
type NativeEvent =
  | { kind: "answer"; event: Calls.CallAnsweredEvent }
  | { kind: "end"; event: Calls.CallEndedEvent }
  | { kind: "mute"; event: Calls.SetMutedActionEvent }
  | { kind: "session"; event: Calls.CallSessionAddedEvent };
let handler: ((event: NativeEvent) => void) | undefined;
const waiting: NativeEvent[] = [];
const send = (event: NativeEvent) => {
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
