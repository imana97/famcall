import { HapticPressable as Pressable } from "./HapticPressable";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, PanResponder, View } from "react-native";
import { Pencil, Phone, Trash2 } from "lucide-react-native";
import { displayPhone } from "@famcall/core";
import type { Person } from "../state/Session";
import { t } from "../i18n";
import { Avatar, Label, useTheme } from "./ui";
import { haptic } from "../services/haptics";

const actionWidth = 168;

export function PersonRow({ person, open, busy, onOpenChange, onCall, onEdit, onRemove }: {
  person: Person;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCall: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const c = useTheme();
  const [translate] = useState(() => new Animated.Value(0));
  const origin = useRef(0);
  const dragged = useRef(false);
  useEffect(() => {
    const animation = Animated.spring(translate, {
      toValue: open ? -actionWidth : 0, useNativeDriver: true,
      speed: 24, bounciness: 0,
    });
    animation.start();
    return () => animation.stop();
  }, [open, translate]);
  // PanResponder stores these handlers; it does not execute them during render.
  // eslint-disable-next-line react-hooks/refs
  const gesture = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, state) => !busy &&
      Math.abs(state.dx) > 12 && Math.abs(state.dx) > Math.abs(state.dy) * 1.5 &&
      (open || state.dx < 0),
    onMoveShouldSetPanResponderCapture: (_, state) => !busy &&
      Math.abs(state.dx) > 12 && Math.abs(state.dx) > Math.abs(state.dy) * 1.5 &&
      (open || state.dx < 0),
    onPanResponderGrant: () => {
      origin.current = open ? -actionWidth : 0;
      translate.stopAnimation(value => { origin.current = value; });
    },
    onPanResponderMove: (_, state) => {
      dragged.current = true;
      translate.setValue(Math.max(-actionWidth, Math.min(0, origin.current + state.dx)));
    },
    onPanResponderRelease: (_, state) => {
      const next = state.vx < -0.4 || (state.vx <= 0.4 && origin.current + state.dx < -actionWidth / 3);
      Animated.spring(translate, { toValue: next ? -actionWidth : 0, useNativeDriver: true, speed: 24, bounciness: 0 }).start();
      onOpenChange(next);
    },
    onPanResponderTerminate: () => {
      Animated.spring(translate, { toValue: open ? -actionWidth : 0, useNativeDriver: true, speed: 24, bounciness: 0 }).start();
    },
    onPanResponderTerminationRequest: () => false,
  }), [busy, open, onOpenChange, translate]);
  return <View style={{ overflow: "hidden", borderBottomWidth: 1, borderBottomColor: c.line }}>
    <View
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: actionWidth, flexDirection: "row" }}
    >
      <Pressable testID={"edit-contact-" + person.phone} accessibilityRole="button" accessibilityLabel={t("editPerson")}
        disabled={busy} onPress={onEdit}
        style={({ pressed }) => ({ flex: 1, gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: c.avatar, opacity: pressed ? 0.7 : 1 })}>
        <Pencil size={20} color={c.text} /><Label style={{ fontSize: 15 }}>{t("edit")}</Label>
      </Pressable>
      <Pressable testID={"remove-contact-" + person.phone} accessibilityRole="button" accessibilityLabel={t("removePerson")}
        haptic="medium"
        disabled={busy} onPress={onRemove}
        style={({ pressed }) => ({ flex: 1, gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: c.danger, opacity: pressed ? 0.7 : 1 })}>
        <Trash2 size={20} color={c.bg} /><Label style={{ color: c.bg, fontSize: 15 }}>{t("remove")}</Label>
      </Pressable>
    </View>
    <Animated.View {...gesture.panHandlers} onTouchStart={() => { dragged.current = false; }}
      style={{ transform: [{ translateX: translate }], backgroundColor: c.bg }}>
      <Pressable testID={"contact-" + person.phone} accessibilityRole="button"
        haptic={false}
        accessibilityLabel={t("call", { name: person.name })} accessibilityState={{ busy, disabled: busy }}
        accessibilityActions={[{ name: "edit", label: t("editPerson") }, { name: "remove", label: t("removePerson") }]}
        onAccessibilityAction={event => {
          if (busy) return;
          if (event.nativeEvent.actionName === "edit") { haptic("selection"); onEdit(); }
          if (event.nativeEvent.actionName === "remove") { haptic("medium"); onRemove(); }
        }}
        disabled={busy}
        onPress={() => { if (dragged.current) return; haptic(open ? "selection" : "light"); if (open) onOpenChange(false); else onCall(); }}
        style={({ pressed }) => ({ flexDirection: "row", gap: 14, alignItems: "center", paddingVertical: 18, paddingHorizontal: 16, opacity: busy || pressed ? 0.6 : 1 })}>
        <Avatar name={person.name} />
        <View style={{ flex: 1, gap: 2 }}>
          <Label style={{ fontWeight: "500", fontSize: 18 }}>{person.name}</Label>
          <Label muted style={{ fontSize: 14 }}>{displayPhone(person.phone)}</Label>
        </View>
        {busy ? <ActivityIndicator color={c.primary} /> : <Phone size={20} color={c.primary} />}
      </Pressable>
    </Animated.View>
  </View>;
}
