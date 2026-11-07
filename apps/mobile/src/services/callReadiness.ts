import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Linking, NativeModules, PermissionsAndroid, Platform } from "react-native";
import { getPermissionsAsync, requestPermissionsAsync, IosAuthorizationStatus } from "expo-notifications";
import { permissions } from "react-native-webrtc";
import { MicrophonePermissionError } from "./errors";

export type PermissionState = "granted" | "undetermined" | "denied" | "unavailable";
export interface CallingPermission {
  status: PermissionState;
  canAskAgain: boolean;
}
export interface CallingPermissions {
  microphone: CallingPermission;
  notifications: CallingPermission;
  fullScreen: "granted" | "denied" | "unavailable" | "not-required";
}
export type CallingPermissionName = "microphone" | "notifications" | "fullScreen";

const microphoneKey = "famcall-microphone-request";
export const setupSeenKey = "famcall-calling-setup-seen";
const native = NativeModules.FamCallPermissions as {
  canUseFullScreenIntent: () => Promise<boolean>;
  openFullScreenIntentSettings: () => Promise<void>;
} | undefined;

export function isCallingReady(value: CallingPermissions): boolean {
  return value.microphone.status === "granted" &&
    value.notifications.status === "granted" &&
    (value.fullScreen === "granted" || value.fullScreen === "not-required");
}

/** Ordinary notification/full-screen permission is optional for voice calling. */
export function canUseVoiceCalls(value: CallingPermissions): boolean {
  return value.microphone.status === "granted";
}

/** Reading permission state never asks the user or starts audio capture. */
async function readMicrophone(): Promise<CallingPermission> {
  const status: unknown = await permissions.query({ name: "microphone" });
  if (status === "granted") return { status, canAskAgain: false };
  if (Platform.OS === "android" && status === "prompt") {
    // Android's check() cannot distinguish a fresh install from denial. Keep
    // only the previous request outcome; the OS remains the source of grants.
    const previous = await AsyncStorage.getItem(microphoneKey);
    return { status: previous ? "denied" : "undetermined", canAskAgain: previous !== "blocked" };
  }
  if (status === "prompt") return { status: "undetermined", canAskAgain: true };
  if (status === "denied") return { status, canAskAgain: false };
  return { status: "unavailable", canAskAgain: false };
}

export async function readCallingPermissions(): Promise<CallingPermissions> {
  const [microphone, notification, fullScreen] = await Promise.all([
    readMicrophone(),
    getPermissionsAsync().catch(() => null),
    Platform.OS === "android" && Number(Platform.Version) >= 34
      ? native?.canUseFullScreenIntent().then(granted => granted ? "granted" as const : "denied" as const)
        .catch(() => "unavailable" as const)
        ?? Promise.resolve("unavailable" as const)
      : Promise.resolve("not-required" as const),
  ]);
  // Provisional iOS authorization is quiet delivery, not permission to alert.
  const alertsGranted = notification?.granted && (!notification.ios ||
    (notification.ios.status === IosAuthorizationStatus.AUTHORIZED &&
      notification.ios.allowsAlert !== false && notification.ios.allowsSound !== false));
  return {
    microphone,
    notifications: {
      status: !notification ? "unavailable" : alertsGranted ? "granted" : notification.status === "undetermined" ? "undetermined" : "denied",
      canAskAgain: !!notification && notification.canAskAgain && (!notification.ios ||
        notification.ios.status === IosAuthorizationStatus.NOT_DETERMINED ||
        notification.ios.status === IosAuthorizationStatus.PROVISIONAL),
    },
    fullScreen,
  };
}

/** Called only from a setup button. Never call from a push or a call event. */
export async function requestCallingPermission(name: CallingPermissionName): Promise<void> {
  if (AppState.currentState !== "active") return;
  if (name === "fullScreen") {
    if (Platform.OS === "android" && Number(Platform.Version) >= 34) {
      if (!native) throw new Error("call-permissions-native-module-unavailable");
      await native.openFullScreenIntentSettings();
    }
    return;
  }
  const current = await readCallingPermissions();
  if (AppState.currentState !== "active" || current[name].status === "granted") return;
  if (!current[name].canAskAgain) {
    await Linking.openSettings();
    return;
  }
  if (name === "microphone") {
    if (Platform.OS === "android") {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      await AsyncStorage.setItem(microphoneKey,
        result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "blocked" : "requested");
    } else {
      await permissions.request({ name: "microphone" });
    }
  } else {
    await requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true } });
  }
}

/** A final, read-only guard also protects answers arriving while the app is locked. */
export async function assertMicrophonePermission(): Promise<void> {
  if (await permissions.query({ name: "microphone" }) !== "granted")
    throw new MicrophonePermissionError();
}
