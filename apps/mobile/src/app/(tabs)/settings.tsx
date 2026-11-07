import { Alert, Linking } from "react-native";
import { nativeApplicationVersion, nativeBuildVersion } from "expo-application";
import { router } from "expo-router";
import { displayPhone } from "@famcall/core";
import { Button, Card, Heading, Label, Page } from "../../components/ui";
import { useSession } from "../../state/Session";
import { useCallReadiness } from "../../state/CallReadiness";
import { t } from "../../i18n";
export default function Settings() {
  const { user } = useSession();
  const { canCall } = useCallReadiness();
  const version = (nativeApplicationVersion ?? "—") +
    (nativeBuildVersion ? ` (${nativeBuildVersion})` : "");
  return (
    <Page safeBottom={false}>
      <Heading title={t("settings")} />
      <Card>
        <Label muted>{t("account")}</Label>
        <Label style={{ fontSize: 21 }}>
          {displayPhone(user?.phoneNumber ?? "")}
        </Label>
      </Card>
      <Card>
        <Label style={{ fontWeight: "600" }}>{t("callingSetup")}</Label>
        <Label muted>{t(canCall ? "callingReady" : "callingSetupNeeded")}</Label>
        <Button
          title={t("callingSetup")}
          secondary
          testID="calling-settings"
          onPress={() => router.push("/calling-setup")}
        />
      </Card>
      <Card>
        <Label muted>{t("language")}</Label>
        <Label>{t("english")}</Label>
      </Card>
      <Button
        title={t("blocked")}
        secondary
        onPress={() => router.push("/blocked")}
      />
      <Card>
        <Label style={{ fontWeight: "600" }}>{t("about")}</Label>
        <Label muted>{t("aboutBody")}</Label>
        <Label muted style={{ fontSize: 13 }}>
          {t("noEmergency")}
        </Label>
      </Card>
      <Button
        title={t("privacy")}
        secondary
        onPress={() => Linking.openURL("https://famcall.web.app/privacy")}
      />
      <Button
        title={t("support")}
        secondary
        onPress={() => Linking.openURL("mailto:info@silvergridtech.com")}
      />
      <Button
        title={t("deleteAccount")}
        danger
        secondary
        onPress={() =>
          Alert.alert(t("deleteTitle"), t("deleteBody"), [
            { text: t("cancel"), style: "cancel" },
            {
              text: t("reviewDeletion"),
              style: "destructive",
              onPress: () => router.push("/delete-account"),
            },
          ])
        }
      />
      <Label muted style={{ fontSize: 12 }}>
        {t("version", { version })}
      </Label>
    </Page>
  );
}
