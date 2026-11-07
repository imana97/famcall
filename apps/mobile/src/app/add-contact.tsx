import { HapticPressable as Pressable } from "../components/HapticPressable";
import { useCallback, useState } from "react";
import { ActivityIndicator, BackHandler, View } from "react-native";
import { Contact } from "expo-contacts";
import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ArrowLeft, ChevronRight, ContactRound } from "lucide-react-native";
import { displayPhone, normalizePhone } from "@famcall/core";
import {
  Button,
  ErrorBanner,
  Field,
  Label,
  Page,
  useTheme,
} from "../components/ui";
import { useSession } from "../state/Session";
import { api } from "../services/firebase";
import { errorMessage } from "../services/errors";
import { t } from "../i18n";
function ContactHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const c = useTheme();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("back")}
      onPress={onBack}
      style={({ pressed }) => ({ width: 48, height: 48, marginLeft: -12, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <ArrowLeft size={24} color={c.text} />
    </Pressable>
    <Label style={{ fontSize: 20, fontWeight: "600", flex: 1 }}>{title}</Label>
  </View>;
}

export default function AddContact() {
  const c = useTheme();
  const { user } = useSession();
  const params = useLocalSearchParams<{ editPhone?: string; name?: string }>();
  const editing = !!params.editPhone;
  const [{ name, phone }, setPerson] = useState({ name: params.name ?? "", phone: params.editPhone ?? "" });
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
        ...(editing ? { previousPhone: params.editPhone } : {}),
      });
      router.back();
    } catch (e) {
      setError(String((e as { code?: string })?.code).endsWith("already-exists")
        ? t("errorContactExists") : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (choice)
    return (
      <Page key="contact-choice" contentStyle={{ paddingHorizontal: 16, gap: 16 }} headerStyle={{ paddingHorizontal: 16 }}
        header={<ContactHeader title={t("choosePhone")} onBack={() => setChoice(null)} />}>
        <Label style={{ fontSize: 18, fontWeight: "500" }}>{choice.name}</Label>
        {choice.numbers.map((number, index) => (
          <Button
            key={number}
            testID={"contact-phone-choice-" + index}
            title={displayPhone(number)}
            secondary
            style={{ minHeight: 60, borderRadius: 16 }}
            textStyle={{ fontSize: 18 }}
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
    <Page key="contact-form" contentStyle={{ paddingHorizontal: 16, paddingTop: 20, gap: 24 }} headerStyle={{ paddingHorizontal: 16 }}
      header={<ContactHeader title={t(editing ? "editPerson" : "addContact")} onBack={() => router.back()} />}>
      <ErrorBanner message={error} />
      {!editing && <View style={{ gap: 10 }}>
        <Pressable
          testID="choose-contact"
          accessibilityRole="button"
          accessibilityLabel={t("chooseContacts")}
          accessibilityState={{ disabled: busy || picking, busy: picking }}
          disabled={busy || picking}
          onPress={() => void pick()}
          style={({ pressed }) => ({
            minHeight: 60,
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            marginHorizontal: -16,
            paddingHorizontal: 16,
            paddingBottom: 16,
            borderBottomWidth: 1,
            borderBottomColor: c.line,
            opacity: busy ? 0.5 : pressed ? 0.6 : 1,
          })}
        >
          <ContactRound size={24} color={c.text} />
          <Label style={{ flex: 1, fontSize: 18, fontWeight: "500" }}>{t("chooseContacts")}</Label>
          {picking ? <ActivityIndicator color={c.primary} /> : <ChevronRight size={20} color={c.muted} />}
        </Pressable>
        <Label muted style={{ fontSize: 14, lineHeight: 22 }}>{t("contactPrivacy")}</Label>
      </View>}
      <View style={{ gap: 8 }}>
        <Label style={{ fontSize: 18, fontWeight: "500" }}>{t("name")}</Label>
        <Field
          testID="contact-name"
          label={t("name")}
          hideLabel
          placeholder={t("namePlaceholder")}
          value={name}
          onChangeText={(value) => setPerson((person) => ({ ...person, name: value }))}
          editable={!busy && !picking}
          autoCapitalize="words"
          maxLength={80}
          style={{ minHeight: 60, fontSize: 20, borderColor: c.muted }}
        />
      </View>
      <View style={{ gap: 8 }}>
        <Label style={{ fontSize: 18, fontWeight: "500" }}>{t("phone")}</Label>
        <Field
          testID="contact-number"
          label={t("phone")}
          hideLabel
          placeholder={t("phonePlaceholder")}
          value={phone}
          onChangeText={(value) => setPerson((person) => ({ ...person, phone: value }))}
          editable={!busy && !picking}
          keyboardType="phone-pad"
          style={{ minHeight: 60, fontSize: 20, borderColor: c.muted }}
        />
        <Label muted style={{ fontSize: 14, lineHeight: 22 }}>{t("countryCodeHint")}</Label>
      </View>
      <Button
        testID="save-contact"
        title={t(editing ? "saveChanges" : "save")}
        busy={busy}
        disabled={picking}
        style={{ minHeight: 60, borderRadius: 16 }}
        textStyle={{ fontSize: 18 }}
        onPress={save}
      />
    </Page>
  );
}
