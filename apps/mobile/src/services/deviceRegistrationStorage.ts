import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";

const key = "famcall-device-registration";
let serial: Promise<unknown> = Promise.resolve();

/** Persist ordering before upload, including across account changes and restarts. */
export function prepareDeviceRegistration(): Promise<{ installationId: string; sequence: number }> {
  const next = serial.then(async () => {
    const stored = await AsyncStorage.getItem(key);
    const previous = stored ? JSON.parse(stored) : {
      installationId: await AsyncStorage.getItem("famcall-installation") ?? randomUUID(),
      sequence: 0,
    };
    if (typeof previous.installationId !== "string" || !Number.isSafeInteger(previous.sequence) ||
        previous.sequence < 0 || previous.sequence >= Number.MAX_SAFE_INTEGER)
      throw new Error("Invalid saved device registration.");
    const registration = { installationId: previous.installationId, sequence: previous.sequence + 1 };
    await AsyncStorage.setItem(key, JSON.stringify(registration));
    return registration;
  });
  serial = next.catch(() => undefined);
  return next;
}
