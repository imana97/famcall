import { HapticPressable as Pressable } from "../components/HapticPressable";
import { ActivityIndicator, View } from "react-native";
import { Redirect, router } from "expo-router";
import { ArrowLeft, BellRing, Check, LockKeyhole, Mic, type LucideIcon } from "lucide-react-native";
import { Button, ErrorBanner, Label, Page, useTheme } from "../components/ui";
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
      <View key={name} style={{ flexDirection: "row", gap: 14, paddingHorizontal: 16, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Icon color={c.text} size={24} />
        <View style={{ flex: 1, gap: 8 }}>
          <Label style={{ fontWeight: "500", fontSize: 18 }}>{title}</Label>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {granted && <Check color={c.primary} size={16} />}
            <Label style={{ flex: 1, fontSize: 14, lineHeight: 22, color: granted ? c.primary : c.muted }}>
              {t(granted ? "setupAllowed" : status === "denied" ? "setupNotAllowed" : status === "unavailable" ? "setupUnavailable" : "setupNotAsked")}
            </Label>
          </View>
          <Label muted style={{ fontSize: 14, lineHeight: 22 }}>{body}</Label>
          {!granted && status !== "unavailable" && (
            <Button
              testID={`setup-${name}`}
              title={t(settings ? "setupOpenSettings" : name === "microphone" ? "setupAllowMicrophone" : "setupAllowNotifications")}
              secondary
              busy={busy === name}
              disabled={busy !== null}
              style={{ minHeight: 54, borderRadius: 16, marginTop: 4 }}
              textStyle={{ fontSize: 16 }}
              onPress={() => { void readiness.request(name); }}
            />
          )}
        </View>
      </View>
    );
  };
  return (
    <Page
      contentStyle={{ paddingHorizontal: 16, paddingTop: 0, gap: 0 }}
      headerStyle={{ paddingHorizontal: 16 }}
      header={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48 }}>
          {!readiness.needsSetup && router.canGoBack() && <Pressable
            testID="calling-setup-back" accessibilityRole="button" accessibilityLabel={t("back")}
            onPress={() => router.back()}
            style={({ pressed }) => ({ width: 48, height: 48, marginLeft: -12, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <ArrowLeft size={24} color={c.text} />
          </Pressable>}
          <Label style={{ flex: 1, fontSize: 20, fontWeight: "600" }}>{t("callingSetup")}</Label>
        </View>
      }
      footer={
        <View style={{ marginHorizontal: -8 }}>
          <Button
            testID="setup-finish"
            title={t(readiness.canCall ? "setupStartCalling" : "setupLater")}
            secondary={!readiness.canCall}
            disabled={!readiness.checked || busy !== null}
            style={{ minHeight: 60, borderRadius: 16 }}
            textStyle={{ fontSize: 18 }}
            onPress={() => { void finish(); }}
          />
        </View>
      }
    >
      {readiness.error && <View style={{ paddingTop: 16 }}><ErrorBanner message={readiness.error} retry={() => { void readiness.refresh(); }} /></View>}
      {!readiness.checked && <View style={{ paddingTop: 20 }}><ActivityIndicator color={c.primary} /></View>}
      <View style={{ marginHorizontal: -16 }}>
      {row("microphone", Mic, t("setupMicrophone"), t("setupMicrophoneBody"))}
      {permissions && permissions.notifications.status !== "not-required" &&
        row("notifications", BellRing, t("setupNotifications"), t("setupNotificationsBody"))}
      {permissions && permissions.fullScreen !== "not-required" &&
        row("fullScreen", LockKeyhole, t("setupFullScreen"), t("setupFullScreenBody"))}
      </View>
      {permissions && <View accessibilityLiveRegion="polite" style={{ paddingTop: 20 }}>
        <Label muted style={{ fontSize: 14, lineHeight: 22 }}>
          {t(readiness.ready ? "setupReadyBody" : readiness.canCall ? "setupOptionalBody" : "setupLaterBody")}
        </Label>
      </View>}
    </Page>
  );
}
