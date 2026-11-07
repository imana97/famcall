import Constants from "expo-constants";
import { getApp } from "@react-native-firebase/app";
import { getAuth, connectAuthEmulator } from "@react-native-firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
} from "@react-native-firebase/firestore";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "@react-native-firebase/functions";
import {
  initializeAppCheck,
  ReactNativeFirebaseAppCheckProvider,
} from "@react-native-firebase/app-check";

export const auth = getAuth();
export const database = getFirestore();
export const functions = getFunctions(getApp(), "us-east1");
export const isE2E = Constants.expoConfig?.extra?.appMode === "e2e";
let initialized: Promise<void> | undefined;
export function initializeFirebase() {
  return (initialized ??= (async () => {
    if (isE2E) {
      if (getApp().options.projectId !== "demo-famcall")
        throw new Error("Test builds must use the demo project.");
      const host = String(
        Constants.expoConfig?.extra?.emulatorHost ?? "10.0.2.2",
      );
      connectAuthEmulator(auth, "http://" + host + ":9099");
      connectFirestoreEmulator(database, host, 8080);
      connectFunctionsEmulator(functions, host, 5001);
      return;
    }
    const provider = new ReactNativeFirebaseAppCheckProvider();
    provider.configure({
      android: { provider: "playIntegrity" },
      apple: { provider: "appAttestWithDeviceCheckFallback" },
    });
    await initializeAppCheck(getApp(), {
      provider,
      isTokenAutoRefreshEnabled: true,
    });
  })());
}
export async function api<T>(name: string, data: unknown = {}): Promise<T> {
  await initializeFirebase();
  return (await httpsCallable<unknown, T>(functions, name)(data)).data;
}
