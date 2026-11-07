import { HapticPressable as Pressable } from "../components/HapticPressable";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Redirect, router } from "expo-router";
import { signOut } from "@react-native-firebase/auth";
import { ArrowLeft } from "lucide-react-native";
import { displayPhone } from "@famcall/core";
import {
  Button,
  ErrorBanner,
  Field,
  Label,
  Page,
  useTheme,
} from "../components/ui";
import { auth, api, isE2E } from "../services/firebase";
import { preparePhoneVerification } from "../services/phoneVerification";
import { requestPhoneReauthentication, type PhoneReauthentication } from "../services/PhoneReauthentication";
import { errorMessage } from "../services/errors";
import { useSession } from "../state/Session";
import { t } from "../i18n";
export default function DeleteAccount() {
  const c = useTheme();
  const { user } = useSession();
  const [userId] = useState(user?.uid ?? null);
  const [confirmation, setConfirmation] = useState<PhoneReauthentication | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [verified, setVerified] = useState(false);
  const [accepted, setAccepted] = useState<"complete" | "pending" | null>(null);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  if (!user || user.uid !== userId) return <Redirect href="/auth" />;
  const send = async () => {
    if (busy || remaining > 0) return;
    setBusy(true);
    setError(null);
    try {
      await preparePhoneVerification(isE2E);
      const next = await requestPhoneReauthentication(auth, user.uid, !!confirmation);
      setConfirmation(next);
      setVerified(false);
      setCode(next.code);
      setRemaining(60);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (busy) return;
    if (!confirmation && !verified && !accepted) return send();
    setBusy(true);
    setError(null);
    try {
      let outcome = accepted;
      if (!outcome) {
        if (!verified) {
          await confirmation!.confirm(code);
          setVerified(true);
        }
        // A failed response may follow a successful durable deletion request.
        // The endpoint accepts repeats, and a used OTP must not be replayed.
        confirmation!.assertCurrent();
        const result = await api<{ accepted?: boolean; status?: string }>("deleteAccount");
        if (!result.accepted) throw new Error("Deletion was not accepted.");
        // Older servers acknowledge a durable request without reporting completion.
        outcome = result.status === "complete" ? "complete" : "pending";
        setAccepted(outcome);
      }
      // An account change during the request must never sign out a different user.
      if (auth.currentUser && auth.currentUser.uid !== userId)
        throw Object.assign(new Error("Account changed."), { code: "auth/user-mismatch" });
      await signOut(auth);
      router.replace("/auth");
      Alert.alert(
        t(outcome === "complete" ? "deleteCompleteTitle" : "deleteAcceptedTitle"),
        t(outcome === "complete" ? "deleteCompleteBody" : "deleteAcceptedBody"),
      );
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "functions/unauthenticated" || code === "auth/requires-recent-login") {
        setVerified(false);
        setConfirmation(null);
        setCode("");
        setError(t("deleteVerifyAgain"));
      } else if (code === "auth/user-mismatch" || code === "auth/user-not-found" || code === "auth/user-disabled") {
        setVerified(false);
        setConfirmation(null);
        setCode("");
        setError(t("deleteSessionChanged"));
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page contentStyle={{ paddingHorizontal: 16, paddingTop: 20, gap: 24 }} headerStyle={{ paddingHorizontal: 16 }} header={
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("back")}
          onPress={() => router.back()}
          style={({ pressed }) => ({ width: 48, height: 48, marginLeft: -12, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <ArrowLeft size={24} color={c.text} />
        </Pressable>
        <Label style={{ flex: 1, fontSize: 20, fontWeight: "600" }}>{t("deleteAccount")}</Label>
      </View>
    }>
      <Label style={{ fontSize: 16, lineHeight: 26 }}>{t(accepted ? accepted === "complete" ? "deleteCompleteBody" : "deleteAcceptedBody" : "deleteBody")}</Label>
      <View style={{ gap: 4, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Label muted style={{ fontSize: 14 }}>{t("account")}</Label>
        <Label style={{ fontSize: 20, lineHeight: 28 }}>{displayPhone(user.phoneNumber ?? "")}</Label>
      </View>
      <ErrorBanner message={error} />
      {accepted ? null : verified ? (
        <Label muted>{t("deleteVerified")}</Label>
      ) : confirmation ? (
        <View style={{ gap: 8 }}>
          <Label style={{ fontSize: 18, fontWeight: "500" }}>{t("code")}</Label>
          <Field
            testID="delete-verification-code"
            label={t("code")}
            hideLabel
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            editable={!busy}
            maxLength={6}
            style={{ minHeight: 64, fontSize: 24, letterSpacing: 4, textAlign: "center", borderColor: c.muted }}
          />
          <Label muted style={{ fontSize: 14, lineHeight: 22 }}>{t("deleteCodeBody")}</Label>
        </View>
      ) : (
        <Label muted>{t("reverifyDelete")}</Label>
      )}
      <Button
        title={t(accepted ? "done" : confirmation || verified ? "deleteConfirm" : "continue")}
        testID="confirm-delete-account"
        danger={!accepted && (!!confirmation || verified)}
        busy={busy}
        disabled={!verified && !accepted && !!confirmation && code.length !== 6}
        style={{ minHeight: 60, borderRadius: 16 }}
        textStyle={{ fontSize: 18 }}
        onPress={run}
      />
      {confirmation && !verified && !accepted && (
        <Button
          title={remaining ? t("resendCountdown", { seconds: remaining }) : t("resend")}
          testID="resend-delete-code"
          secondary
          busy={busy}
          disabled={remaining > 0}
          style={{ minHeight: 48, borderWidth: 0, backgroundColor: c.bg }}
          textStyle={{ fontSize: 16, color: c.primary }}
          onPress={send}
        />
      )}
    </Page>
  );
}
