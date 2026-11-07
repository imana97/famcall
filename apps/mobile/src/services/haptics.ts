import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export type HapticFeedback = "selection" | "light" | "medium" | "key" | false;
let driver: Promise<typeof import("expo-haptics")> | undefined;

/** Feedback must never delay an action or break an older development client. */
export function haptic(feedback: HapticFeedback = "selection"): void {
  if (!feedback || Platform.OS === "web") return;
  try {
    if (!requireOptionalNativeModule("ExpoHaptics")) return;
    driver ??= import("expo-haptics");
    void driver.then(module => {
      if (Platform.OS === "android") {
        const effect = feedback === "key" ? module.AndroidHaptics.Virtual_Key
          : feedback === "medium" ? module.AndroidHaptics.Long_Press
          : feedback === "light" ? module.AndroidHaptics.Context_Click
          : module.AndroidHaptics.Segment_Tick;
        return module.performAndroidHapticsAsync(effect);
      }
      return feedback === "light" || feedback === "medium"
        ? module.impactAsync(feedback === "medium" ? module.ImpactFeedbackStyle.Medium : module.ImpactFeedbackStyle.Light)
        : module.selectionAsync();
    }).catch(() => { /* Unavailable hardware or system settings can suppress feedback. */ });
  } catch { /* Native module availability must not affect button actions. */ }
}
