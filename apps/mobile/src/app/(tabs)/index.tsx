import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Phone, Plus } from "lucide-react-native";
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
import { BrandMark } from "../../components/BrandMark";
import { useSession } from "../../state/Session";
import { t } from "../../i18n";
export default function People() {
  const c = useTheme();
  const { people, peopleLoaded, peopleError, error, refresh } = useSession();
  const [search, setSearch] = useState("");
  const filtered = people.filter((p) =>
    (p.name + " " + p.phone).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Page safeBottom={false}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <BrandMark size={36} />
        <Label style={{ fontWeight: "600", fontSize: 20 }}>
          {t("appName")}
        </Label>
      </View>
      <Heading title={t("yourPeople")} subtitle={t("peopleSubtitle")} />
      <ErrorBanner message={peopleError ?? error} retry={refresh} />
      {!peopleLoaded && !peopleError && (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: "row", gap: 12, alignItems: "center" }}
        >
          <ActivityIndicator color={c.primary} />
          <Label muted style={{ flex: 1 }}>
            {t("loadingPeople")}
          </Label>
        </View>
      )}
      {people.length > 0 ? (
        <Field
          label={t("search")}
          placeholder={t("search")}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          testID="contact-search"
        />
      ) : peopleLoaded && !peopleError ? (
        <Card>
          <Label style={{ fontSize: 20, fontWeight: "500" }}>
            {t("emptyPeople")}
          </Label>
          <Label muted>{t("emptyPeopleBody")}</Label>
        </Card>
      ) : null}
      {people.length > 0 && filtered.length === 0 && (
        <Card>
          <Label style={{ fontSize: 20, fontWeight: "500" }}>
            {t("noPeopleMatch")}
          </Label>
          <Label muted>{t("noPeopleMatchBody")}</Label>
          <Button
            testID="clear-contact-search"
            title={t("clearSearch")}
            secondary
            onPress={() => setSearch("")}
          />
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
