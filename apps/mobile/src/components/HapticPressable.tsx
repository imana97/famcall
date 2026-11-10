import type { ComponentPropsWithRef } from "react";
import { Pressable } from "react-native";
import { haptic, type HapticFeedback } from "../services/haptics";

export function HapticPressable({ haptic: feedback = "selection", onPress, onLongPress, disabled, ...props }: ComponentPropsWithRef<typeof Pressable> & {
  haptic?: HapticFeedback;
}) {
  return <Pressable {...props} disabled={disabled}
    android_disableSound={props.android_disableSound ?? true}
    onPress={onPress ? event => { if (!disabled) { haptic(feedback); onPress(event); } } : undefined}
    onLongPress={onLongPress ? event => { if (!disabled) { haptic(feedback); onLongPress(event); } } : undefined}
  />;
}
