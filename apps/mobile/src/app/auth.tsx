import { HapticPressable as Pressable } from "../components/HapticPressable";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
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
  useTheme,
} from "../components/ui";
import { BrandMark } from "../components/BrandMark";
import { t } from "../i18n";
import { auth, initializeFirebase, isE2E } from "../services/firebase";
import { preparePhoneVerification } from "../services/phoneVerification";
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
    <Page
      key={confirmation ? "verification" : "phone"}
      contentStyle={{ flexGrow: 1, gap: 0, paddingTop: 32 }}
    >
      <View
        style={{
          alignItems: "center",
          marginBottom: confirmation ? 32 : 44,
        }}
      >
        <BrandMark size={64} />
      </View>
      <Heading
        title={t(confirmation ? "verifyTitle" : "loginTitle")}
        bottomSpacing={32}
        subtitle={
          confirmation ? t("verifyBody", { phone: number }) : undefined
        }
      />
      <ErrorBanner message={error} />
      {confirmation ? (
        <View style={{ gap: 18 }}>
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
        </View>
      ) : (
        <>
          <View style={{ gap: 12 }}>
          <Label style={{ fontSize: 20, lineHeight: 28, fontWeight: "500" }}>{t("phone")}</Label>
          <Field
            testID="phone-number"
            label={t("phone")}
            hideLabel
            placeholder={t("phonePlaceholder")}
            value={number}
            onChangeText={setNumber}
            editable={!busy}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            style={{ minHeight: 66, fontSize: 22, borderWidth: 1.5, borderColor: c.muted }}
          />
          <Label muted style={{ fontSize: 16, lineHeight: 24 }}>
            {t("loginCountryCodeHint")}
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
            style={{ minHeight: 66, marginTop: 12 }}
            textStyle={{ fontSize: 20, lineHeight: 28 }}
          />
          </View>
          <Label muted style={{ fontSize: 15, lineHeight: 22, marginTop: 20 }}>
            {t("phoneConsent")}
          </Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 28, marginTop: "auto", paddingTop: 24 }}>
            <Pressable
              accessibilityRole="link"
              style={{ minHeight: 48, justifyContent: "center" }}
              onPress={() => Linking.openURL("https://famcall.web.app/privacy")}
            >
              <Label muted style={{ textDecorationLine: "underline", fontSize: 16 }}>
                {t("privacy")}
              </Label>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              style={{ minHeight: 48, minWidth: 48, justifyContent: "center" }}
              onPress={() => Linking.openURL("https://famcall.web.app/terms")}
            >
              <Label muted style={{ textDecorationLine: "underline", fontSize: 16 }}>
                {t("terms")}
              </Label>
            </Pressable>
          </View>
        </>
      )}
    </Page>
  );
}
