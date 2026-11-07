import { HapticPressable as Pressable } from "../../components/HapticPressable";
import { ActivityIndicator, Alert, View } from "react-native";
import { router } from "expo-router";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Phone, PhoneMissed } from "lucide-react-native";
import { displayPhone, historyKind } from "@famcall/core";
import {
  Avatar,
  ErrorBanner,
  Label,
  Page,
  useTheme,
} from "../../components/ui";
import { useSession } from "../../state/Session";
import { locale, t } from "../../i18n";
import { api } from "../../services/firebase";
import { errorMessage } from "../../services/errors";
import { haptic } from "../../services/haptics";
export default function History() {
  const c = useTheme();
  const { history, historyLoaded, historyError, error, refresh, user, people, blocked } = useSession();
  return (
    <Page contentStyle={{ paddingTop: 0, paddingHorizontal: 16 }} headerStyle={{ paddingHorizontal: 16 }} header={
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          testID="history-back"
          accessibilityRole="button"
          accessibilityLabel={t("back")}
          onPress={() => router.back()}
          style={({ pressed }) => ({ width: 48, height: 48, marginLeft: -12, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <ArrowLeft size={24} color={c.text} />
        </Pressable>
        <Label style={{ fontSize: 20, fontWeight: "600", flex: 1 }}>{t("callHistory")}</Label>
      </View>
    }>
      <ErrorBanner message={historyError ?? error} retry={refresh} />
      {!historyLoaded && !historyError && (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingTop: 20 }}>
          <ActivityIndicator color={c.primary} />
          <Label muted>{t("loadingHistory")}</Label>
        </View>
      )}
      {historyLoaded && !historyError && !history.length && (
        <View style={{ gap: 8, paddingTop: 24 }}>
          <Label style={{ fontSize: 20 }}>{t("emptyHistory")}</Label>
          <Label muted>{t("emptyHistoryBody")}</Label>
        </View>
      )}
      <View style={{ marginHorizontal: -16 }}>
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
                  onPress: () => {
                    haptic("light");
                    router.push({
                      pathname: "/call/[id]",
                      params: { id: "new", phone, name },
                    });
                  },
                },
                {
                  text: t(blocked.includes(phone) ? "unblock" : "block"),
                  style: "destructive",
                  onPress: () => {
                    haptic("medium");
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
                          onPress: () => {
                            haptic("medium");
                            api("setBlocked", {
                              phone,
                              blocked: !blocked.includes(phone),
                            }).catch((e) =>
                              Alert.alert(t("errorTitle"), errorMessage(e)),
                            );
                          },
                        },
                      ],
                    );
                  },
                },
                { text: t("cancel"), style: "cancel" },
              ])
            }
            style={({ pressed }) => ({
              flexDirection: "row",
              gap: 14,
              alignItems: "center",
              paddingVertical: 18,
              paddingHorizontal: 16,
              borderBottomWidth: 1,
              borderBottomColor: c.line,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Avatar name={name} />
            <View style={{ flex: 1, gap: 2 }}>
              <Label
                style={{
                  fontWeight: "500",
                  fontSize: 18,
                  color: kind === "missed" ? c.danger : c.text,
                }}
              >
                {name}
              </Label>
              <View
                style={{ flexDirection: "row", gap: 6, alignItems: "center" }}
              >
                <Icon size={16} color={kind === "missed" ? c.danger : c.muted} />
                <Label muted style={{ fontSize: 14, lineHeight: 22, flex: 1 }}>
                  {t(kind === "incoming" ? "incomingHistory" : kind) + " · " + when}
                </Label>
              </View>
            </View>
            <Phone size={20} color={c.primary} />
          </Pressable>
        );
      })}
      </View>
    </Page>
  );
}
