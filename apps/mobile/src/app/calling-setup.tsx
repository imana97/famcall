import { ActivityIndicator, View } from "react-native";
import { Redirect, router } from "expo-router";
import { BellRing, Check, LockKeyhole, Mic, type LucideIcon } from "lucide-react-native";
import { Button, Card, ErrorBanner, Heading, Label, Page, useTheme } from "../components/ui";
import { useSession } from "../state/Session";
import { useCallReadiness } from "../state/CallReadiness";
import { t } from "../i18n";
import type { CallingPermissionName } from "../services/callReadiness";

export default function CallingSetup() {
  const c = useTheme();
  const { ready: sessionReady, user } = useSession();
  const readiness = useCallReadiness();
  const { permissions, busy } = readiness;
  if (!sessionReady) return <Page><ActivityIndicator color={c.text} /></Page>;
  if (!user) return <Redirect href="/auth" />;

  const finish = async () => {
    try {
      await readiness.finishSetup();
      router.replace("/");
    } catch { /* The provider keeps the recovery message visible. */ }
  };
  const row = (name: CallingPermissionName, Icon: LucideIcon, title: string, body: string) => {
    if (!permissions) return null;
    const permission = name === "fullScreen" ? null : permissions[name];
    const status = name === "fullScreen" ? permissions.fullScreen : permission!.status;
    const granted = status === "granted";
    const settings = name === "fullScreen" || permission?.canAskAgain === false;
    return (
      <Card key={name}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Icon color={c.primary} size={24} />
          <Label style={{ flex: 1, fontWeight: "600", fontSize: 18 }}>{title}</Label>
          {granted && <Check color={c.primary} size={22} accessibilityLabel={t("setupAllowed")} />}
        </View>
        <Label muted>{body}</Label>
        <Label style={{ fontSize: 14, color: granted ? c.primary : c.muted }}>
          {t(granted ? "setupAllowed" : status === "denied" ? "setupNotAllowed" : status === "unavailable" ? "setupUnavailable" : "setupNotAsked")}
        </Label>
        {!granted && status !== "unavailable" && (
          <Button
            testID={`setup-${name}`}
            title={t(settings ? "setupOpenSettings" : name === "microphone" ? "setupAllowMicrophone" : "setupAllowNotifications")}
            secondary
            busy={busy === name}
            disabled={busy !== null}
            onPress={() => { void readiness.request(name); }}
          />
        )}
      </Card>
    );
  };
  return (
    <Page
      footer={
          <Button
            testID="setup-finish"
            title={t(readiness.canCall ? "setupStartCalling" : "setupLater")}
            secondary={!readiness.canCall}
            disabled={!readiness.checked || busy !== null}
            onPress={() => { void finish(); }}
          />
      }
    >
      <Heading title={t("setupTitle")} subtitle={t("setupBody")} />
      <ErrorBanner message={readiness.error} retry={() => { void readiness.refresh(); }} />
      {!readiness.checked && <ActivityIndicator color={c.text} />}
      {row("microphone", Mic, t("setupMicrophone"), t("setupMicrophoneBody"))}
      {permissions && permissions.notifications.status !== "not-required" &&
        row("notifications", BellRing, t("setupNotifications"), t("setupNotificationsBody"))}
      {permissions && permissions.fullScreen !== "not-required" &&
        row("fullScreen", LockKeyhole, t("setupFullScreen"), t("setupFullScreenBody"))}
      <Label muted style={{ fontSize: 14 }}>{t("setupContactsOptional")}</Label>
      {readiness.ready && <View accessibilityLiveRegion="polite"><Label>{t("setupReadyBody")}</Label></View>}
      {!readiness.ready && (
        <Label muted style={{ fontSize: 13, lineHeight: 18 }}>
          {t(readiness.canCall ? "setupOptionalBody" : "setupLaterBody")}
        </Label>
      )}
    </Page>
  );
}
