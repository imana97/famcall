import { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { Redirect } from "expo-router";
import {
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "@react-native-firebase/auth";
import { normalizePhone } from "@famcall/core";
import {
  Button,
  ErrorBanner,
  Field,
  Heading,
  Label,
  Page,
} from "../components/ui";
import { BrandMark } from "../components/BrandMark";
import { t } from "../i18n";
import { auth, initializeFirebase, isE2E } from "../services/firebase";
import { preparePhoneVerification } from "../services/phoneVerification";
import { errorMessage } from "../services/errors";
import { useSession } from "../state/Session";
export default function AuthScreen() {
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
      await preparePhoneVerification(isE2E);
      setNumber(phone);
      setConfirmation(await signInWithPhoneNumber(auth, phone));
      setCode("");
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
    <Page key={confirmation ? "verification" : "phone"}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <BrandMark size={48} />
        <Label style={{ fontWeight: "600", fontSize: 22 }}>
          {t("appName")}
        </Label>
      </View>
      <Heading
        title={t(confirmation ? "verifyTitle" : "welcome")}
        bottomSpacing={10}
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
            editable={!busy}
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
            testID="resend-code"
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
            testID="change-number"
            title={t("changeNumber")}
            secondary
            disabled={busy}
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
            editable={!busy}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
          />
          <Label muted style={{ fontSize: 14 }}>
            {t("countryCodeHint")}
          </Label>
          <Label muted style={{ fontSize: 13, lineHeight: 20 }}>
            {t("phoneConsent")}
          </Label>
          <Button
            testID="send-code"
            title={
              remaining
                ? t("resendCountdown", { seconds: remaining })
                : t("continue")
            }
            busy={busy}
            disabled={!number.trim() || remaining > 0}
            onPress={send}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            <Pressable
              accessibilityRole="link"
              style={{ minHeight: 48, justifyContent: "center" }}
              onPress={() => Linking.openURL("https://famcall.web.app/privacy")}
            >
              <Label style={{ textDecorationLine: "underline", fontSize: 13 }}>
                {t("privacy")}
              </Label>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              style={{ minHeight: 48, minWidth: 48, justifyContent: "center" }}
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
