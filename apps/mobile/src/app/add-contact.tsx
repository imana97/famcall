import { useCallback, useState } from "react";
import { BackHandler } from "react-native";
import { Contact } from "expo-contacts";
import { Redirect, router, useFocusEffect } from "expo-router";
import { ContactRound } from "lucide-react-native";
import { displayPhone, normalizePhone } from "@famcall/core";
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
  const [{ name, phone }, setPerson] = useState({ name: "", phone: "" });
  const [choice, setChoice] = useState<{
    name: string;
    numbers: string[];
  } | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!choice) return;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        setChoice(null);
        return true;
      });
      return () => subscription.remove();
    }, [choice]),
  );
  if (!user) return <Redirect href="/auth" />;
  async function pick() {
    if (picking || busy) return;
    setPicking(true);
    setError(null);
    try {
      const person = await Contact.presentPicker();
      if (!person) return;
      const [fullName, rawNumbers] = await Promise.all([
        person.getFullName(),
        person.getPhones(),
      ]);
      const numbers = [
        ...new Set(
          rawNumbers
            .map((n) => n.number?.trim())
            .filter((number): number is string => !!number),
        ),
      ];
      // Do not attach the previous phone to the newly chosen person's name.
      // A cancelled or unusable selection leaves the entire draft unchanged.
      if (numbers.length === 0) setError(t("errorContactNumber"));
      else if (numbers.length === 1)
        setPerson({ name: fullName, phone: numbers[0] });
      else setChoice({ name: fullName, numbers });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPicking(false);
    }
  }
  async function save() {
    if (busy || picking || choice) return;
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
  if (choice)
    return (
      <Page key="contact-choice">
        <Heading title={t("choosePhone")} subtitle={choice.name} />
        {choice.numbers.map((number, index) => (
          <Button
            key={number}
            testID={"contact-phone-choice-" + index}
            title={displayPhone(number)}
            secondary
            onPress={() => {
              setPerson({ name: choice.name, phone: number });
              setChoice(null);
            }}
          />
        ))}
        <Button
          testID="cancel-contact-choice"
          title={t("cancel")}
          secondary
          onPress={() => setChoice(null)}
        />
      </Page>
    );
  return (
    <Page key="contact-form">
      <Heading back title={t("addContact")} />
      <ErrorBanner message={error} />
      <Button
        testID="choose-contact"
        title={t("chooseContacts")}
        icon={ContactRound}
        secondary
        busy={picking}
        disabled={busy}
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
        onChangeText={(value) => setPerson((person) => ({ ...person, name: value }))}
        editable={!busy && !picking}
        autoCapitalize="words"
        maxLength={80}
      />
      <Field
        testID="contact-number"
        label={t("phone")}
        placeholder={t("phonePlaceholder")}
        value={phone}
        onChangeText={(value) => setPerson((person) => ({ ...person, phone: value }))}
        editable={!busy && !picking}
        keyboardType="phone-pad"
      />
      <Label muted style={{ fontSize: 14 }}>
        {t("countryCodeHint")}
      </Label>
      <Button
        testID="save-contact"
        title={t("save")}
        busy={busy}
        disabled={picking}
        onPress={save}
      />
    </Page>
  );
}
