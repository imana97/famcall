import { Platform } from "react-native";
import { getDevicePushTokenAsync } from "expo-notifications";

/** Give Firebase Auth a standard APNs token before it chooses app verification. */
export async function preparePhoneVerification(isE2E: boolean): Promise<void> {
  if (isE2E || Platform.OS !== "ios") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // This registers for silent APNs messages without requesting alert permission.
    // The native callback forwards the token to Auth before Expo resolves it.
    await Promise.race([
      getDevicePushTokenAsync(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
  } catch {
    // Firebase must retain its normal reCAPTCHA fallback if APNs is unavailable.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
