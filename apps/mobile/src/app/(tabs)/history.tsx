import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, PhoneMissed } from "lucide-react-native";
import { displayPhone, historyKind } from "@famcall/core";
import {
  Avatar,
  Card,
  ErrorBanner,
  Heading,
  Label,
  Page,
  useTheme,
} from "../../components/ui";
import { useSession } from "../../state/Session";
import { locale, t } from "../../i18n";
import { api } from "../../services/firebase";
import { errorMessage } from "../../services/errors";
export default function History() {
  const c = useTheme();
  const { history, historyLoaded, historyError, error, refresh, user, people, blocked } = useSession();
  return (
    <Page safeBottom={false}>
      <Heading title={t("history")} />
      <ErrorBanner message={historyError ?? error} retry={refresh} />
      {!historyLoaded && !historyError && (
        <View accessibilityLiveRegion="polite" style={{ gap: 12, alignItems: "center" }}>
          <ActivityIndicator color={c.primary} />
          <Label muted>{t("loadingHistory")}</Label>
        </View>
      )}
      {historyLoaded && !historyError && !history.length && (
        <Card>
          <Label style={{ fontSize: 20 }}>{t("emptyHistory")}</Label>
          <Label muted>{t("emptyHistoryBody")}</Label>
        </Card>
      )}
      {history.map((call) => {
        const phone =
          call.callerId === user?.uid ? call.calleePhone : call.callerPhone;
        const name =
          people.find((p) => p.phone === phone)?.name ?? displayPhone(phone);
        const kind = historyKind(call, user!.uid);
        const when = new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(call.createdAtMs);
        const Icon =
          kind === "missed"
            ? PhoneMissed
            : kind === "outgoing"
              ? ArrowUpRight
              : ArrowDownLeft;
        return (
          <Pressable
            key={call.id}
            testID={"history-" + call.id}
            accessibilityRole="button"
            accessibilityLabel={
              name + ", " + t(kind === "incoming" ? "incomingHistory" : kind) + ", " + when
            }
            onPress={() =>
              Alert.alert(name, displayPhone(phone), [
                {
                  text: t("call", { name }),
                  onPress: () =>
                    router.push({
                      pathname: "/call/[id]",
                      params: { id: "new", phone, name },
                    }),
                },
                {
                  text: t(blocked.includes(phone) ? "unblock" : "block"),
                  style: "destructive",
                  onPress: () =>
                    Alert.alert(
                      t(
                        blocked.includes(phone) ? "unblockTitle" : "blockTitle",
                      ),
                      t(blocked.includes(phone) ? "unblockBody" : "blockBody"),
                      [
                        { text: t("cancel"), style: "cancel" },
                        {
                          text: t(
                            blocked.includes(phone) ? "unblock" : "block",
                          ),
                          style: "destructive",
                          onPress: () =>
                            api("setBlocked", {
                              phone,
                              blocked: !blocked.includes(phone),
                            }).catch((e) =>
                              Alert.alert(t("errorTitle"), errorMessage(e)),
                            ),
                        },
                      ],
                    ),
                },
                { text: t("cancel"), style: "cancel" },
              ])
            }
            style={({ pressed }) => ({
              flexDirection: "row",
              gap: 14,
              alignItems: "center",
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: c.line,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Avatar name={name} />
            <View style={{ flex: 1, gap: 4 }}>
              <Label
                style={{
                  fontWeight: "500",
                  color: kind === "missed" ? c.danger : c.text,
                }}
              >
                {name}
              </Label>
              <View
                style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}
              >
                <Icon size={14} color={c.muted} />
                <Label muted style={{ fontSize: 13 }}>
                  {t(kind === "incoming" ? "incomingHistory" : kind)}
                </Label>
              </View>
              <Label muted style={{ fontSize: 12 }}>{when}</Label>
            </View>
          </Pressable>
        );
      })}
    </Page>
  );
}
