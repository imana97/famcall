import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { Redirect, router } from "expo-router";
import {
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from "@react-native-firebase/auth";
import {
  Button,
  ErrorBanner,
  Field,
  Heading,
  Label,
  Page,
} from "../components/ui";
import { auth, api, isE2E } from "../services/firebase";
import { preparePhoneVerification } from "../services/phoneVerification";
import { errorMessage } from "../services/errors";
import { useSession } from "../state/Session";
import { t } from "../i18n";
export default function DeleteAccount() {
  const { user } = useSession();
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [verified, setVerified] = useState(false);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  if (!user) return <Redirect href="/auth" />;
  const send = async () => {
    if (busy || remaining > 0) return;
    setBusy(true);
    setError(null);
    try {
      await preparePhoneVerification(isE2E);
      setConfirmation(await signInWithPhoneNumber(auth, user.phoneNumber!));
      setVerified(false);
      setCode("");
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
      if (!accepted) {
        if (!verified) {
          await confirmation!.confirm(code);
          setVerified(true);
        }
        // A failed response may follow a successful durable deletion request.
        // The endpoint accepts repeats, and a used OTP must not be replayed.
        await api("deleteAccount");
        setAccepted(true);
      }
      await signOut(auth);
      router.replace("/auth");
      Alert.alert(t("deleteAcceptedTitle"), t("deleteAcceptedBody"));
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "functions/unauthenticated" || code === "auth/requires-recent-login") {
        setVerified(false);
        setConfirmation(null);
        setCode("");
        setError(t("deleteVerifyAgain"));
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <Heading back title={t("deleteTitle")} subtitle={t("deleteBody")} />
      <ErrorBanner message={error} />
      <Label>{user.phoneNumber}</Label>
      {accepted ? <Label muted>{t("deleteAcceptedBody")}</Label> : verified ? (
        <Label muted>{t("deleteVerified")}</Label>
      ) : confirmation ? (
        <Field
          testID="delete-verification-code"
          label={t("code")}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          editable={!busy}
          maxLength={6}
        />
      ) : (
        <Label muted>{t("reverifyDelete")}</Label>
      )}
      <Button
        title={t(accepted ? "done" : confirmation || verified ? "deleteConfirm" : "continue")}
        testID="confirm-delete-account"
        danger
        busy={busy}
        disabled={!verified && !accepted && !!confirmation && code.length !== 6}
        onPress={run}
      />
      {confirmation && !verified && !accepted && (
        <Button
          title={remaining ? t("resendCountdown", { seconds: remaining }) : t("resend")}
          testID="resend-delete-code"
          secondary
          busy={busy}
          disabled={remaining > 0}
          onPress={send}
        />
      )}
    </Page>
  );
}
