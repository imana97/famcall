import { useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { Redirect } from "expo-router";
import { displayPhone } from "@famcall/core";
import { Button, ErrorBanner, Heading, Label, Page, useTheme } from "../components/ui";
import { useSession } from "../state/Session";
import { t } from "../i18n";
import { api } from "../services/firebase";
import { errorMessage } from "../services/errors";
export default function Blocked() {
  const { user, blocked, blockedLoaded, blockedError, error, refresh } = useSession();
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
    <Page>
      <Heading back title={t("blocked")} />
      <ErrorBanner message={blockedError ?? error} retry={refresh} />
      {!blockedLoaded && !blockedError && (
        <View accessibilityLiveRegion="polite" style={{ gap: 12, alignItems: "center" }}>
          <ActivityIndicator color={c.primary} />
          <Label muted>{t("loadingBlocked")}</Label>
        </View>
      )}
      {blockedLoaded && !blockedError && !blocked.length && <Label muted>{t("noBlocked")}</Label>}
      {blocked.map((phone) => (
        <View key={phone} style={{ gap: 12 }}>
          <Label>{displayPhone(phone)}</Label>
          <Button
            title={t("unblock")}
            secondary
            busy={pending === phone}
            disabled={pending !== null}
            onPress={() => void unblock(phone)}
          />
        </View>
      ))}
    </Page>
  );
}
