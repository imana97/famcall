import { HapticPressable as Pressable } from "../../components/HapticPressable";
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, View } from "react-native";
import { ArrowLeft, ChevronRight, Info, Languages, LogOut, Mail, Phone, Shield, Trash2, UserRound, UserRoundX, type LucideIcon } from "lucide-react-native";
import { nativeApplicationVersion, nativeBuildVersion } from "expo-application";
import { router } from "expo-router";
import { displayPhone, isTerminal } from "@famcall/core";
import { ErrorBanner, Label, Page, useTheme } from "../../components/ui";
import { useCalling } from "../../state/Calling";
import { errorMessage } from "../../services/errors";
import { useSession } from "../../state/Session";
import { useCallReadiness } from "../../state/CallReadiness";
import { t } from "../../i18n";
import { useLanguage } from "../../state/Language";

function SettingsRow({ title, icon: Icon, detail, danger = false, busy = false, disabled = false, testID, onPress }: {
  title: string;
  icon: LucideIcon;
  detail?: string;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
  onPress: () => void;
}) {
  const c = useTheme();
  const color = danger ? c.danger : c.text;
  return <Pressable
    haptic={danger ? "medium" : "selection"}
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={detail ? title + ", " + detail : title}
    accessibilityState={{ disabled: disabled || busy, busy }}
    disabled={disabled || busy}
    onPress={onPress}
    style={({ pressed }) => ({
      minHeight: 68,
      paddingHorizontal: 16,
      paddingVertical: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
      opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
    })}
  >
    <Icon size={24} color={color} />
    <View style={{ flex: 1, gap: 2 }}>
      <Label style={{ fontSize: 18, fontWeight: "500", color }}>{title}</Label>
      {detail && <Label muted style={{ fontSize: 14, lineHeight: 22 }}>{detail}</Label>}
    </View>
    {busy ? <ActivityIndicator color={color} /> : <ChevronRight size={20} color={danger ? c.danger : c.muted} />}
  </Pressable>;
}

export default function Settings() {
  const { language } = useLanguage();
  const c = useTheme();
  const { user } = useSession();
  const { canCall } = useCallReadiness();
  const { call, logOut } = useCalling();
  const [loggingOut, setLoggingOut] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inCall = !!call && !isTerminal(call.status);
  const version = (nativeApplicationVersion ?? "—") +
    (nativeBuildVersion ? ` (${nativeBuildVersion})` : "");
  async function handleLogOut() {
    if (loggingOut || inCall) return;
    setLoggingOut(true);
    setActionError(null);
    try {
      await logOut();
      router.replace("/auth");
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setLoggingOut(false);
    }
  }
  function openLink(url: string) {
    void Linking.openURL(url).catch(error => setActionError(errorMessage(error)));
  }
  return (
    <Page contentStyle={{ paddingHorizontal: 0, paddingTop: 0, gap: 0 }} headerStyle={{ paddingHorizontal: 16 }} header={
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable testID="settings-back" accessibilityRole="button" accessibilityLabel={t("back")}
          onPress={() => router.back()}
          style={({ pressed }) => ({ width: 48, height: 48, marginLeft: -12, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <ArrowLeft size={24} color={c.text} />
        </Pressable>
        <Label style={{ fontSize: 20, fontWeight: "600", flex: 1 }}>{t("settings")}</Label>
      </View>
    }>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <UserRound size={24} color={c.muted} />
        <View style={{ flex: 1, gap: 4 }}>
          <Label muted style={{ fontSize: 14 }}>{t("account")}</Label>
          <Label style={{ fontSize: 20, lineHeight: 28 }}>{displayPhone(user?.phoneNumber ?? "")}</Label>
        </View>
      </View>
      {actionError && <View style={{ paddingHorizontal: 16, paddingTop: 12 }}><ErrorBanner message={actionError} /></View>}
      <SettingsRow title={t("callingSetup")} icon={Phone} testID="calling-settings"
        detail={t(canCall ? "callingReady" : "callingSetupNeeded")}
        onPress={() => router.push("/calling-setup")} />
      <SettingsRow title={t("language")} icon={Languages} detail={t(language === "fa" ? "persian" : "english")} testID="language-settings" onPress={() => router.push("/language")} />
      <SettingsRow title={t("blocked")} icon={UserRoundX} onPress={() => router.push("/blocked")} />
      <SettingsRow title={t("support")} icon={Mail} onPress={() => openLink("mailto:info@silvergridtech.com")} />
      <SettingsRow title={t("privacy")} icon={Shield} onPress={() => openLink("https://famcall.web.app/privacy")} />
      <SettingsRow title={t("about")} icon={Info} onPress={() => Alert.alert(
        t("appName"), [t("aboutBody"), t("noEmergency"), t("version", { version })].join("\n\n"),
      )} />
      <SettingsRow title={t("logOut")} icon={LogOut} testID="log-out" busy={loggingOut} disabled={inCall}
        detail={inCall ? t("logOutAfterCall") : undefined} onPress={() => void handleLogOut()} />
      <SettingsRow title={t("deleteAccount")} icon={Trash2} danger disabled={loggingOut} onPress={() =>
        Alert.alert(t("deleteTitle"), t("deleteBody"), [
          { text: t("cancel"), style: "cancel" },
          { text: t("reviewDeletion"), style: "destructive", onPress: () => router.push("/delete-account") },
        ])
      } />
      <View style={{ paddingHorizontal: 16, paddingTop: 24 }}>
        <Label muted style={{ fontSize: 14 }}>{t("version", { version })}</Label>
      </View>
    </Page>
  );
}
