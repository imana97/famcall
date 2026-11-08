import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft, Check } from "lucide-react-native";
import { HapticPressable as Pressable } from "../components/HapticPressable";
import { ErrorBanner, Label, Page, useTheme } from "../components/ui";
import { useLanguage } from "../state/Language";
import { errorMessage } from "../services/errors";
import { t } from "../i18n";
import { languages, type LanguagePreference } from "../i18n/languages";

export default function Language() {
  const c = useTheme();
  const { preference, setLanguage } = useLanguage();
  const choices = [{ code: "system" as const, name: t("systemLanguage") }, ...languages];
  const [pending, setPending] = useState<LanguagePreference | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function choose(next: LanguagePreference) {
    if (pending || next === preference) return;
    setPending(next);
    setError(null);
    try { await setLanguage(next); }
    catch (e) { setError(errorMessage(e)); }
    finally { setPending(null); }
  }
  return <Page contentStyle={{ paddingHorizontal: 0, paddingTop: 0, gap: 0 }} headerStyle={{ paddingHorizontal: 16 }} header={
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Pressable testID="language-back" accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()}
        style={({ pressed }) => ({ width: 48, height: 48, marginLeft: -12, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
        <ArrowLeft size={24} color={c.text} />
      </Pressable>
      <Label style={{ flex: 1, fontSize: 20, fontWeight: "600" }}>{t("language")}</Label>
    </View>
  }>
    {error && <View style={{ paddingHorizontal: 16, paddingTop: 16 }}><ErrorBanner message={error} /></View>}
    <View accessibilityRole="radiogroup" accessibilityLabel={t("language")}>
      {choices.map(choice => <Pressable key={choice.code} testID={"language-" + choice.code}
        accessibilityRole="radio" accessibilityLabel={choice.name}
        accessibilityState={{ checked: preference === choice.code, disabled: pending !== null, busy: pending === choice.code }}
        disabled={pending !== null} onPress={() => void choose(choice.code)}
        style={({ pressed }) => ({ minHeight: 68, paddingHorizontal: 16, paddingVertical: 18, flexDirection: "row", alignItems: "center", gap: 14, borderBottomWidth: 1, borderBottomColor: c.line, opacity: pressed ? 0.6 : 1 })}>
        <Label style={{ flex: 1, fontSize: 18, fontWeight: "500", writingDirection: "ltr" }}>{choice.name}</Label>
        {pending === choice.code ? <ActivityIndicator color={c.primary} /> : preference === choice.code && <Check size={24} color={c.primary} />}
      </Pressable>)}
    </View>
  </Page>;
}
