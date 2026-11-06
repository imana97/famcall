import { useState } from "react";
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
import { auth, api } from "../services/firebase";
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
  if (!user) return <Redirect href="/auth" />;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!confirmation) {
        setConfirmation(await signInWithPhoneNumber(auth, user.phoneNumber!));
        return;
      }
      await confirmation.confirm(code);
      await api("deleteAccount");
      await signOut(auth);
      router.replace("/auth");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <Heading back title={t("deleteTitle")} subtitle={t("deleteBody")} />
      <ErrorBanner message={error} />
      <Label>{user.phoneNumber}</Label>
      {confirmation ? (
        <Field
          label={t("code")}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={6}
        />
      ) : (
        <Label muted>{t("reverifyDelete")}</Label>
      )}
      <Button
        title={t(confirmation ? "deleteConfirm" : "continue")}
        danger
        busy={busy}
        disabled={!!confirmation && code.length !== 6}
        onPress={run}
      />
    </Page>
  );
}
