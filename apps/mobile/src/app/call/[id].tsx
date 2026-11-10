import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { MessageCircle, Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react-native";
import { displayPhone, isTerminal } from "@famcall/core";
import {
  Avatar,
  Button,
  ErrorBanner,
  Label,
  useTheme,
} from "../../components/ui";
import { useSession } from "../../state/Session";
import { useCalling } from "../../state/Calling";
import { t, type TranslationKey } from "../../i18n";
import { inviteToFamCall } from "../../services/invite";
import { errorMessage } from "../../services/errors";
export default function CallScreen() {
  const params = useLocalSearchParams<{
    id: string;
    phone?: string;
    name?: string;
  }>();
  const { user, people } = useSession();
  const calling = useCalling();
  const c = useTheme();
  const began = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  async function invite() {
    if (!calling.invitePhone || inviting) return;
    setInviting(true);
    setInviteError(null);
    try { await inviteToFamCall(calling.invitePhone); }
    catch (error) { setInviteError(errorMessage(error)); }
    finally { setInviting(false); }
  }
  const start = useEffectEvent(calling.start);
  useEffect(() => {
    if (params.id === "new" && params.phone && !began.current) {
      began.current = true;
      void start(params.phone).catch(() => undefined);
    }
  }, [params.id, params.phone]);
  useEffect(() => {
    if (!calling.connectedAt) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - calling.connectedAt!) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [calling.connectedAt]);
  if (!user) return <Redirect href="/auth" />;
  const call = calling.call;
  const phone = call
    ? call.callerId === user.uid
      ? call.calleePhone
      : call.callerPhone
    : (params.phone ?? "");
  const name =
    people.find((p) => p.phone === phone)?.name ??
    params.name ??
    displayPhone(phone);
  const incoming = call?.calleeId === user.uid && call.status === "ringing";
  const ended = calling.cancelledBeforeStart || (!!call && isTerminal(call.status));
  const terminal: Record<string, TranslationKey> = {
    ended: "callEnded",
    cancelled: "callCancelled",
    missed: "callMissed",
    declined: "callDeclined",
    failed: "callFailed",
  };
  const status: TranslationKey = ended
    ? (calling.cancelledBeforeStart ? "callCancelled" : terminal[call!.status] ?? "callEnded")
    : incoming
      ? "incoming"
      : calling.voice === "reconnecting"
        ? "reconnecting"
        : calling.voice === "connected"
          ? "connected"
          : call?.status === "accepted"
            ? "connecting"
            : "calling";
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, direction: "ltr" }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 32, gap: 24 }}
      >
        <View style={{ alignItems: "center", gap: 28 }}>
          <Avatar name={name || "?"} size={96} />
          <View style={{ alignItems: "center", gap: 8, width: "100%" }}>
            <Label style={{ fontSize: 32, lineHeight: 40, fontWeight: "600", textAlign: "center" }}>{name}</Label>
            {phone && name !== displayPhone(phone) && <Label muted style={{ textAlign: "center" }}>{displayPhone(phone)}</Label>}
          </View>
          <View style={{ alignItems: "center", gap: 8 }}>
          <View accessibilityLiveRegion="polite" testID={calling.invitePhone ? "invite-call-status" : "call-status"}>
            <Label muted style={{ fontSize: 20, lineHeight: 28, textAlign: "center" }}>{t(calling.invitePhone ? "inviteTitle" : status)}</Label>
          </View>
          {!ended && calling.voice === "reconnecting" && <Label muted style={{ textAlign: "center" }}>{t("reconnectingBody")}</Label>}
          {calling.connectedAt && !ended && (
          <Label muted style={{ fontSize: 18, lineHeight: 26, textAlign: "center", fontVariant: ["tabular-nums"] }}>
            {Math.floor(elapsed / 60) +
              ":" +
              String(elapsed % 60).padStart(2, "0")}
          </Label>
          )}
          </View>
          {calling.invitePhone && <Label muted style={{ textAlign: "center", lineHeight: 26 }}>{t("inviteBody")}</Label>}
        </View>
        <ErrorBanner message={inviteError ?? calling.error} />
      </ScrollView>
      <View style={{ flexShrink: 0, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 16 }}>
        {calling.invitePhone ? (
          <>
            <Button testID="invite-to-famcall" title={t("inviteButton")} icon={MessageCircle}
              busy={inviting} onPress={() => void invite()} style={{ minHeight: 64 }} textStyle={{ fontSize: 20 }} />
            <Button title={t("done")} secondary onPress={() => router.replace("/")} style={{ minHeight: 60 }} />
          </>
        ) : incoming ? (
          <>
            <Button
              testID="answer-call"
              title={t("answer")}
              icon={Phone}
              onPress={() => void calling.answer()}
              style={{ minHeight: 64 }}
              textStyle={{ fontSize: 20 }}
            />
            <Button
              title={t("decline")}
              danger
              secondary
              onPress={() => void calling.end()}
              style={{ minHeight: 64 }}
              textStyle={{ fontSize: 18 }}
            />
          </>
        ) : ended || (!call && calling.error) ? (
          <Button title={t("done")} style={{ minHeight: 64 }} textStyle={{ fontSize: 20 }} onPress={() => router.replace("/")} />
        ) : (
          <>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Button
                  testID="mute-call"
                  title={t(calling.muted ? "unmute" : "mute")}
                  icon={calling.muted ? MicOff : Mic}
                  secondary={!calling.muted}
                  selected={calling.muted}
                  style={{ minHeight: 64 }}
                  textStyle={{ fontSize: 18 }}
                  onPress={calling.toggleMute}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  testID="speaker-call"
                  title={t("speaker")}
                  icon={Volume2}
                  secondary={!calling.speaker}
                  selected={calling.speaker}
                  style={{ minHeight: 64 }}
                  textStyle={{ fontSize: 18 }}
                  onPress={calling.toggleSpeaker}
                />
              </View>
            </View>
            <Button
              testID="end-call"
              title={t("end")}
              icon={PhoneOff}
              danger
              onPress={() => void calling.end()}
              style={{ minHeight: 66 }}
              textStyle={{ fontSize: 20 }}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
