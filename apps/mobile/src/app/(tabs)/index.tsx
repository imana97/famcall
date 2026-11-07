import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { AudioLines, Phone, Plus } from "lucide-react-native";
import { displayPhone } from "@famcall/core";
import {
  Avatar,
  Button,
  Card,
  ErrorBanner,
  Field,
  Heading,
  Label,
  Page,
  useTheme,
} from "../../components/ui";
import { useSession } from "../../state/Session";
import { t } from "../../i18n";
export default function People() {
  const c = useTheme();
  const { people, error, refresh } = useSession();
  const [search, setSearch] = useState("");
  const filtered = people.filter((p) =>
    (p.name + " " + p.phone).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Page>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <AudioLines color={c.text} size={24} />
        <Label style={{ fontWeight: "600", fontSize: 20 }}>
          {t("appName")}
        </Label>
      </View>
      <Heading title={t("yourPeople")} subtitle={t("peopleSubtitle")} />
      <ErrorBanner message={error} retry={refresh} />
      {people.length > 0 ? (
        <Field
          label={t("search")}
          placeholder={t("search")}
          value={search}
          onChangeText={setSearch}
          testID="contact-search"
        />
      ) : (
        <Card>
          <Label style={{ fontSize: 20, fontWeight: "500" }}>
            {t("emptyPeople")}
          </Label>
          <Label muted>{t("emptyPeopleBody")}</Label>
        </Card>
      )}
      <View>
        {filtered.map((person) => (
          <Pressable
            key={person.phone}
            testID={"contact-" + person.phone}
            accessibilityRole="button"
            accessibilityLabel={t("call", { name: person.name })}
            onPress={() =>
              router.push({
                pathname: "/call/[id]",
                params: { id: "new", phone: person.phone, name: person.name },
              })
            }
            style={({ pressed }) => ({
              flexDirection: "row",
              gap: 14,
              alignItems: "center",
              paddingVertical: 18,
              borderBottomWidth: 1,
              borderBottomColor: c.line,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Avatar name={person.name} />
            <View style={{ flex: 1, gap: 2 }}>
              <Label style={{ fontWeight: "500", fontSize: 18 }}>
                {person.name}
              </Label>
              <Label muted style={{ fontSize: 14 }}>
                {displayPhone(person.phone)}
              </Label>
            </View>
            <Phone size={20} color={c.primary} />
          </Pressable>
        ))}
      </View>
      <Button
        testID="add-person"
        title={t("addSomeone")}
        icon={Plus}
        secondary
        onPress={() => router.push("/add-contact")}
      />
    </Page>
  );
}
