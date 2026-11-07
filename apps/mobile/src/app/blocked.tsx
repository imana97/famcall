import { Alert, View } from "react-native";
import { Redirect } from "expo-router";
import { displayPhone } from "@famcall/core";
import { Button, Heading, Label, Page } from "../components/ui";
import { useSession } from "../state/Session";
import { t } from "../i18n";
import { api } from "../services/firebase";
import { errorMessage } from "../services/errors";
export default function Blocked() {
  const { user, blocked } = useSession();
  if (!user) return <Redirect href="/auth" />;
  return (
    <Page>
      <Heading back title={t("blocked")} />
      {!blocked.length && <Label muted>{t("noBlocked")}</Label>}
      {blocked.map((phone) => (
        <View key={phone} style={{ gap: 12 }}>
          <Label>{displayPhone(phone)}</Label>
          <Button
            title={t("unblock")}
            secondary
            onPress={() =>
              api("setBlocked", { phone, blocked: false }).catch((e) =>
                Alert.alert(t("errorTitle"), errorMessage(e)),
              )
            }
          />
        </View>
      ))}
    </Page>
  );
}
