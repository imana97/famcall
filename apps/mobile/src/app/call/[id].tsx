import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react-native";
import { displayPhone, isTerminal } from "@famcall/core";
import {
  Avatar,
  Button,
  ErrorBanner,
  Heading,
  Label,
  useTheme,
} from "../../components/ui";
import { useSession } from "../../state/Session";
import { useCalling } from "../../state/Calling";
import { t, type TranslationKey } from "../../i18n";
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
  const ended = !!call && isTerminal(call.status);
  const terminal: Record<string, TranslationKey> = {
    ended: "callEnded",
    cancelled: "callCancelled",
    missed: "callMissed",
    declined: "callDeclined",
    failed: "callFailed",
  };
  const status: TranslationKey = ended
    ? (terminal[call!.status] ?? "callEnded")
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
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24, gap: 18 }}
      >
        <View style={{ alignItems: "center", paddingTop: 48, gap: 24 }}>
          <Avatar name={name || "?"} size={112} />
          <View style={{ alignItems: "center", gap: 8 }}>
            <Label style={{ fontSize: 30, fontWeight: "600" }}>{name}</Label>
            <Label muted>{displayPhone(phone)}</Label>
          </View>
        </View>
        <View style={{ paddingTop: 36 }}>
          <Heading
            title={t(status)}
            subtitle={
              calling.voice === "reconnecting" ? t("reconnectingBody") : undefined
            }
          />
        </View>
        {calling.connectedAt && !ended && (
          <Label muted>
            {Math.floor(elapsed / 60) +
              ":" +
              String(elapsed % 60).padStart(2, "0")}
          </Label>
        )}
        <ErrorBanner message={calling.error} />
      </ScrollView>
      <View style={{ flexShrink: 0, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 18 }}>
        {incoming ? (
          <>
            <Button
              testID="answer-call"
              title={t("answer")}
              icon={Phone}
              onPress={() => void calling.answer()}
            />
            <Button
              title={t("decline")}
              danger
              secondary
              onPress={() => void calling.end()}
            />
          </>
        ) : ended || (!call && calling.error) ? (
          <Button title={t("done")} onPress={() => router.replace("/")} />
        ) : (
          <>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Button
                  testID="mute-call"
                  title={t(calling.muted ? "unmute" : "mute")}
                  icon={calling.muted ? MicOff : Mic}
                  secondary
                  onPress={calling.toggleMute}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  testID="speaker-call"
                  title={t(calling.speaker ? "earpiece" : "speaker")}
                  icon={Volume2}
                  secondary
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
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
