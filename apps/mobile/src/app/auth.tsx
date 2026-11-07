import { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { Redirect } from "expo-router";
import {
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "@react-native-firebase/auth";
import { AudioLines } from "lucide-react-native";
import { normalizePhone } from "@famcall/core";
import {
  Button,
  ErrorBanner,
  Field,
  Heading,
  Label,
  Page,
  useTheme,
} from "../components/ui";
import { t } from "../i18n";
import { auth, initializeFirebase } from "../services/firebase";
import { errorMessage } from "../services/errors";
import { useSession } from "../state/Session";
export default function AuthScreen() {
  const c = useTheme();
  const { user } = useSession();
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  if (user) return <Redirect href="/" />;
  const send = async () => {
    if (busy || remaining > 0) return;
    setBusy(true);
    setError(null);
    try {
      const phone = normalizePhone(number);
      await initializeFirebase();
      setNumber(phone);
      setConfirmation(await signInWithPhoneNumber(auth, phone));
      setRemaining(60);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    if (busy || !confirmation) return;
    setBusy(true);
    setError(null);
    try {
      await confirmation.confirm(code);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginBottom: 24,
        }}
      >
        <AudioLines color={c.text} size={28} />
        <Label style={{ fontWeight: "600", fontSize: 22 }}>
          {t("appName")}
        </Label>
      </View>
      <Heading
        title={t(confirmation ? "verifyTitle" : "welcome")}
        subtitle={
          confirmation ? t("verifyBody", { phone: number }) : t("welcomeBody")
        }
      />
      <ErrorBanner message={error} />
      {confirmation ? (
        <>
          <Field
            testID="verification-code"
            label={t("code")}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
          />
          <Button
            testID="verify-number"
            title={t("verify")}
            busy={busy}
            disabled={code.length !== 6}
            onPress={verify}
          />
          <Button
            title={
              remaining
                ? t("resendCountdown", { seconds: remaining })
                : t("resend")
            }
            disabled={remaining > 0}
            busy={busy}
            secondary
            onPress={send}
          />
          <Button
            title={t("changeNumber")}
            secondary
            onPress={() => {
              setConfirmation(null);
              setCode("");
              setError(null);
            }}
          />
        </>
      ) : (
        <>
          <Label style={{ fontWeight: "500" }}>{t("verifyOnce")}</Label>
          <Field
            testID="phone-number"
            label={t("phone")}
            placeholder={t("phonePlaceholder")}
            value={number}
            onChangeText={setNumber}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
          />
          <Label muted style={{ fontSize: 14 }}>
            {t("countryCodeHint")}
          </Label>
          <Button
            testID="send-code"
            title={t("continue")}
            busy={busy}
            disabled={!number.trim() || remaining > 0}
            onPress={send}
          />
          <Label muted style={{ fontSize: 13, lineHeight: 20 }}>
            {t("phoneConsent")}
          </Label>
          <View style={{ flexDirection: "row", gap: 24 }}>
            <Pressable
              accessibilityRole="link"
              onPress={() => Linking.openURL("https://famcall.web.app/privacy")}
            >
              <Label style={{ textDecorationLine: "underline", fontSize: 13 }}>
                {t("privacy")}
              </Label>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => Linking.openURL("https://famcall.web.app/terms")}
            >
              <Label style={{ textDecorationLine: "underline", fontSize: 13 }}>
                {t("terms")}
              </Label>
            </Pressable>
          </View>
        </>
      )}
    </Page>
  );
}
