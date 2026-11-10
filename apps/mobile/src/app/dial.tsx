import { useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { Delete, Phone, X } from "lucide-react-native";
import { normalizePhone } from "@famcall/core";
import { Button, ErrorBanner, Label, useTheme } from "../components/ui";
import { HapticPressable as Pressable } from "../components/HapticPressable";
import { haptic } from "../services/haptics";
import { useSession } from "../state/Session";
import { errorMessage } from "../services/errors";
import { t } from "../i18n";

const keys = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["+", "0", "delete"]];

export default function Dial() {
  const c = useTheme();
  const { user } = useSession();
  const [draft, setDraft] = useState({ phone: "", selection: { start: 0, end: 0 } });
  const [error, setError] = useState<string | null>(null);
  const dialing = useRef(false);
  if (!user) return <Redirect href="/auth" />;

  function edit(key: string) {
    setError(null);
    setDraft(current => {
      const { phone, selection } = current;
      const start = Math.min(selection.start, phone.length);
      const end = Math.min(selection.end, phone.length);
      if (key === "delete") {
        const from = start === end ? Math.max(0, start - 1) : start;
        return { phone: phone.slice(0, from) + phone.slice(end), selection: { start: from, end: from } };
      }
      const next = phone.slice(0, start) + key + phone.slice(end);
      if (next.length > 32) return current;
      return { phone: next, selection: { start: start + 1, end: start + 1 } };
    });
  }

  function call() {
    if (dialing.current) return;
    try {
      const phone = normalizePhone(draft.phone);
      dialing.current = true;
      router.replace({ pathname: "/call/[id]", params: { id: "new", phone } });
    } catch (e) {
      dialing.current = false;
      setError(errorMessage(e));
    }
  }

  return <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: c.bg, direction: "ltr" }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <Label style={{ flex: 1, fontSize: 20, fontWeight: "600" }}>{t("dialPad")}</Label>
      <Pressable testID="close-dial-pad" accessibilityRole="button" accessibilityLabel={t("closeDialPad")} onPress={() => router.back()}
        style={({ pressed }) => ({ width: 48, height: 48, marginRight: -12, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
        <X size={24} color={c.text} />
      </Pressable>
    </View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16, gap: 20, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
    <View style={{ flexGrow: 1, justifyContent: "center", gap: 12 }}>
      <Label muted style={{ textAlign: "center" }}>{t("phone")}</Label>
      <TextInput
        testID="dial-number"
        accessibilityLabel={t("phone")}
        value={draft.phone}
        onChangeText={phone => { setError(null); setDraft(current => ({ ...current, phone })); }}
        selection={draft.selection}
        onSelectionChange={({ nativeEvent: { selection } }) => setDraft(current => ({ ...current, selection }))}
        showSoftInputOnFocus={false}
        keyboardType="phone-pad"
        autoCorrect={false}
        autoCapitalize="none"
        maxLength={32}
        placeholder={t("phonePlaceholder")}
        placeholderTextColor={c.muted}
        underlineColorAndroid="transparent"
        style={{ minHeight: 64, paddingHorizontal: 4, paddingVertical: 12, fontSize: 30, color: c.text, textAlign: "center", writingDirection: "ltr" }}
      />
      <Label muted style={{ textAlign: "center", fontSize: 14, lineHeight: 22 }}>{t("countryCodeHint")}</Label>
    </View>
    <ErrorBanner message={error} />
    <View style={{ width: "100%", maxWidth: 360, alignSelf: "center", gap: 12, direction: "ltr" }}>
      {keys.map((row, index) => <View key={index} style={{ flexDirection: "row", gap: 16 }}>
        {row.map(key => <Pressable
          key={key}
          haptic="key"
          testID={"dial-key-" + key}
          accessibilityRole="button"
          accessibilityLabel={key === "delete" ? t("dialDelete") : key === "+" ? t("dialPlus") : key}
          accessibilityActions={key === "delete" ? [{ name: "clear", label: t("dialClear") }] : undefined}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "clear") { haptic("key"); setDraft({ phone: "", selection: { start: 0, end: 0 } }); setError(null); }
          }}
          onPress={() => edit(key)}
          onLongPress={key === "delete" ? () => { setDraft({ phone: "", selection: { start: 0, end: 0 } }); setError(null); } : undefined}
          style={({ pressed }) => ({ flex: 1, minHeight: 64, borderRadius: 32, backgroundColor: pressed ? c.avatar : c.card, alignItems: "center", justifyContent: "center", paddingVertical: 12 })}
        >
          {key === "delete" ? <Delete size={28} color={c.text} /> : <Label style={{ fontSize: 30, lineHeight: 38 }}>{key}</Label>}
        </Pressable>)}
      </View>)}
      <Button testID="dial-call" title={t("dialCall")} icon={Phone} disabled={!draft.phone.trim()}
        style={{ minHeight: 60, borderRadius: 16, marginTop: 8 }} textStyle={{ fontSize: 20 }} onPress={call} />
    </View>
    </ScrollView>
  </SafeAreaView>;
}
