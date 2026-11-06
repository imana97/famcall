import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./firebase";

type Intent = { callId: string; createdAt: number };
const key = (uid: string) => "famcall-call-outbox:" + uid;
let serial: Promise<unknown> = Promise.resolve();
const flights = new Map<string, Promise<void>>();
const locallyEnded = new Set<string>();

function locked<T>(work: () => Promise<T>): Promise<T> {
  const next = serial.then(work, work);
  serial = next.catch(() => undefined);
  return next;
}
async function read(uid: string): Promise<Intent[]> {
  const raw = await AsyncStorage.getItem(key(uid));
  return raw ? (JSON.parse(raw) as Intent[]) : [];
}
export function hasEndedLocally(id: string) {
  return locallyEnded.has(id);
}

/** Store the intent before retrying, so app restarts cannot lose an offline hangup. */
export async function queueCallEnd(uid: string, callId: string) {
  locallyEnded.add(callId);
  await locked(async () => {
    const items = await read(uid);
    if (!items.some((i) => i.callId === callId))
      await AsyncStorage.setItem(
        key(uid),
        JSON.stringify([...items, { callId, createdAt: Date.now() }]),
      );
  });
}
export async function restoreCallOutbox(uid: string) {
  (await read(uid)).forEach((i) => locallyEnded.add(i.callId));
}
export function flushCallOutbox(uid: string): Promise<void> {
  const existing = flights.get(uid);
  if (existing) return existing;
  const flight = (async () => {
    for (const intent of await read(uid)) {
      try {
        await api("updateCall", { callId: intent.callId, action: "end" });
      } catch (error) {
        const code = String((error as { code?: string }).code);
        if (!code.endsWith("not-found") && !code.endsWith("permission-denied"))
          throw error;
      }
      await locked(async () => {
        const remaining = (await read(uid)).filter(
          (i) => i.callId !== intent.callId,
        );
        await AsyncStorage.setItem(key(uid), JSON.stringify(remaining));
      });
    }
  })().finally(() => flights.delete(uid));
  flights.set(uid, flight);
  return flight;
}
