import { useState } from "react";
import { Alert } from "react-native";
import { Contact } from "expo-contacts";
import { Redirect, router } from "expo-router";
import { ContactRound } from "lucide-react-native";
import { normalizePhone } from "@famcall/core";
import {
  Button,
  ErrorBanner,
  Field,
  Heading,
  Label,
  Page,
} from "../components/ui";
import { useSession } from "../state/Session";
import { api } from "../services/firebase";
import { errorMessage } from "../services/errors";
import { t } from "../i18n";
export default function AddContact() {
  const { user } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return <Redirect href="/auth" />;
  async function pick() {
    try {
      const person = await Contact.presentPicker();
      if (!person) return;
      const [fullName, rawNumbers] = await Promise.all([
        person.getFullName(),
        person.getPhones(),
      ]);
      const numbers = rawNumbers.filter(
        (n): n is typeof n & { number: string } => !!n.number,
      );
      setName(fullName);
      if (numbers.length === 1) setPhone(numbers[0].number);
      else if (numbers.length > 1)
        Alert.alert(fullName, t("phone"), [
          ...numbers.slice(0, 8).map((n) => ({
            text: n.number,
            onPress: () => setPhone(n.number),
          })),
          { text: t("cancel"), style: "cancel" as const },
        ]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function save() {
    if (busy) return;
    setError(null);
    if (!name.trim()) {
      setError(t("errorContactName"));
      return;
    }
    setBusy(true);
    try {
      await api("saveContact", {
        name: name.trim(),
        phone: normalizePhone(phone),
      });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Heading back title={t("addContact")} />
      <ErrorBanner message={error} />
      <Button
        title={t("chooseContacts")}
        icon={ContactRound}
        secondary
        onPress={pick}
      />
      <Label muted style={{ fontSize: 13 }}>
        {t("contactPrivacy")}
      </Label>
      <Field
        testID="contact-name"
        label={t("name")}
        placeholder={t("namePlaceholder")}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        maxLength={80}
      />
      <Field
        testID="contact-number"
        label={t("phone")}
        placeholder={t("phonePlaceholder")}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <Label muted style={{ fontSize: 14 }}>
        {t("countryCodeHint")}
      </Label>
      <Button
        testID="save-contact"
        title={t("save")}
        busy={busy}
        onPress={save}
      />
    </Page>
  );
}
