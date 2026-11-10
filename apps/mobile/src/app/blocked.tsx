import { HapticPressable as Pressable } from "../components/HapticPressable";
import { useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { Redirect, router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { displayPhone } from "@famcall/core";
import { Avatar, ErrorBanner, Label, Page, useTheme } from "../components/ui";
import { useSession } from "../state/Session";
import { t } from "../i18n";
import { api } from "../services/firebase";
import { errorMessage } from "../services/errors";
export default function Blocked() {
  const { user, people, blocked, blockedLoaded, blockedError, error, refresh } = useSession();
  const c = useTheme();
  const [pending, setPending] = useState<string | null>(null);
  const unblock = async (phone: string) => {
    if (pending) return;
    setPending(phone);
    try {
      await api("setBlocked", { phone, blocked: false });
    } catch (e) {
      Alert.alert(t("errorTitle"), errorMessage(e));
    } finally {
      setPending(null);
    }
  };
  if (!user) return <Redirect href="/auth" />;
  return (
    <Page contentStyle={{ paddingTop: 0, paddingHorizontal: 16, gap: 0 }} headerStyle={{ paddingHorizontal: 16 }} header={
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable testID="blocked-back" accessibilityRole="button" accessibilityLabel={t("back")}
          onPress={() => router.back()}
          style={({ pressed }) => ({ width: 48, height: 48, marginLeft: -12, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <ArrowLeft size={24} color={c.text} />
        </Pressable>
        <Label style={{ fontSize: 20, fontWeight: "600", flex: 1 }}>{t("blocked")}</Label>
      </View>
    }>
      {(blockedError ?? error) && <View style={{ paddingTop: 16 }}><ErrorBanner message={blockedError ?? error} retry={refresh} /></View>}
      {!blockedLoaded && !blockedError && (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingTop: 20 }}>
          <ActivityIndicator color={c.primary} />
          <Label muted>{t("loadingBlocked")}</Label>
        </View>
      )}
      {blockedLoaded && !blockedError && !blocked.length && (
        <View style={{ paddingTop: 24 }}><Label style={{ fontSize: 20 }}>{t("noBlocked")}</Label></View>
      )}
      <View style={{ marginHorizontal: -16 }}>
        {blocked.map((phone) => {
          const name = people.find((person) => person.phone === phone)?.name;
          const label = name ?? displayPhone(phone);
          const busy = pending === phone;
          return <View key={phone} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: c.line }}>
            <Avatar name={label} />
            <View style={{ flex: 1, gap: 2 }}>
              <Label style={{ fontSize: 18, fontWeight: "500" }}>{label}</Label>
              {name && <Label muted style={{ fontSize: 14, lineHeight: 22 }}>{displayPhone(phone)}</Label>}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("unblock") + ", " + label}
              accessibilityState={{ disabled: pending !== null, busy }}
              disabled={pending !== null}
              onPress={() => void unblock(phone)}
              style={({ pressed }) => ({ minHeight: 48, minWidth: 80, paddingHorizontal: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.line, borderRadius: 14, opacity: pending !== null && !busy ? 0.5 : pressed ? 0.6 : 1 })}
            >
              {busy ? <ActivityIndicator color={c.primary} /> : <Label style={{ color: c.primary, fontSize: 16, fontWeight: "600" }}>{t("unblock")}</Label>}
            </Pressable>
          </View>;
        })}
      </View>
    </Page>
  );
}
