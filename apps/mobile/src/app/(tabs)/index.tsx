import { HapticPressable as Pressable } from "../../components/HapticPressable";
import { useCallback, useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, View, useWindowDimensions } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Clock3, EllipsisVertical, Grid3X3, Plus, Settings2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { deleteDoc, doc } from "@react-native-firebase/firestore";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Label,
  Page,
  useTheme,
} from "../../components/ui";
import { BrandMark } from "../../components/BrandMark";
import { PersonRow } from "../../components/PersonRow";
import { useSession, type Person } from "../../state/Session";
import { database } from "../../services/firebase";
import { errorMessage } from "../../services/errors";
import { t } from "../../i18n";
import { haptic } from "../../services/haptics";
export default function People() {
  const c = useTheme();
  const { user, people, peopleLoaded, peopleError, error, refresh } = useSession();
  const [swipedPhone, setSwipedPhone] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const menuAnchor = useRef<ComponentRef<typeof View>>(null);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  useFocusEffect(useCallback(() => () => { setMenu(null); setSwipedPhone(null); }, []));
  function remove(person: Person) {
    if (!user) return;
    const uid = user.uid;
    setSwipedPhone(null);
    Alert.alert(t("removePerson"), t("removePersonBody", { name: person.name }), [
      { text: t("cancel"), style: "cancel" },
      { text: t("remove"), style: "destructive", onPress: () => {
        haptic("medium");
        setRemoving(person.phone);
        setActionError(null);
        void deleteDoc(doc(database, "users", uid, "contacts", person.phone))
          .catch(e => setActionError(errorMessage(e)))
          .finally(() => setRemoving(null));
      } },
    ]);
  }
  const filtered = people.filter((p) =>
    (p.name + " " + p.phone).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <View style={{ flex: 1 }}>
    <Page contentStyle={{ paddingTop: 0, paddingHorizontal: 16 }} headerStyle={{ paddingHorizontal: 16 }} header={
      <>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <BrandMark size={36} />
          <Label style={{ flex: 1, fontWeight: "600", fontSize: 20 }}>
            {t("appName")}
          </Label>
          <Pressable
            ref={menuAnchor}
            testID="people-menu"
            accessibilityRole="button"
            accessibilityLabel={t("moreOptions")}
            accessibilityState={{ expanded: menu !== null }}
            onPress={() => menuAnchor.current?.measureInWindow((x, y, buttonWidth, buttonHeight) =>
              setMenu({ top: y + buttonHeight + 8, right: Math.max(16, width - x - buttonWidth) }))}
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              borderRadius: 24,
              // Extend the touch target while keeping the dots near the edge.
              marginRight: -8,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <EllipsisVertical size={26} color={c.text} />
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}><Field
          label={t("search")}
          hideLabel
          placeholder={t("search")}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={{ minHeight: 50, fontSize: 17 }}
          testID="contact-search"
        /></View>
        <Pressable
          testID="add-person"
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel={t("addSomeone")}
          onPress={() => router.push("/add-contact")}
          style={({ pressed }) => ({ width: 50, height: 50, borderRadius: 16, backgroundColor: c.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.75 : 1 })}
        >
          <Plus size={28} color={c.onPrimary} />
        </Pressable>
        </View>
      </>
    }>
      <ErrorBanner message={actionError ?? peopleError ?? error} retry={() => { setActionError(null); refresh(); }} />
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
      {people.length === 0 && peopleLoaded && !peopleError ? (
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
      <View style={{ marginHorizontal: -16 }}>
        {filtered.map((person) => (
          <PersonRow
            key={person.phone}
            person={person}
            open={swipedPhone === person.phone}
            busy={removing === person.phone}
            onOpenChange={open => setSwipedPhone(open ? person.phone : null)}
            onEdit={() => { setSwipedPhone(null); router.push({ pathname: "/add-contact", params: { editPhone: person.phone, name: person.name } }); }}
            onRemove={() => remove(person)}
            onCall={() =>
              router.push({
                pathname: "/call/[id]",
                params: { id: "new", phone: person.phone, name: person.name },
              })
            }
          />
        ))}
      </View>
      <View style={{ height: 96 }} />
    </Page>
    <Pressable
      testID="open-dial-pad"
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={t("dialPad")}
      onPress={() => router.push("/dial")}
      style={({ pressed }) => ({
        position: "absolute",
        left: "50%",
        marginLeft: -38,
        bottom: insets.bottom + 16,
        width: 76,
        height: 76,
        borderRadius: 38,
        backgroundColor: c.primary,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 5,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Grid3X3 size={34} color={c.onPrimary} />
    </Pressable>
    <Modal transparent visible={menu !== null} animationType="fade" onRequestClose={() => setMenu(null)}>
      <View style={{ flex: 1 }} accessibilityViewIsModal>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("closeMenu")}
          haptic={false}
          onPress={() => setMenu(null)}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {menu && <ScrollView
          accessibilityRole="menu"
          style={{
            position: "absolute",
            top: menu.top,
            right: menu.right,
            direction: "ltr",
            width: Math.min(260, width - 32),
            maxHeight: Math.max(100, height - menu.top - insets.bottom - 16),
            backgroundColor: c.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: c.line,
            shadowColor: "#000000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.12,
            shadowRadius: 12,
            elevation: 8,
          }}
          contentContainerStyle={{ paddingVertical: 6 }}
        >
          {([
            { title: t("callHistory"), path: "/history", icon: Clock3, id: "menu-history" },
            { title: t("settings"), path: "/settings", icon: Settings2, id: "menu-settings" },
          ] as const).map(({ title, path, icon: Icon, id }) => <Pressable
            key={id}
            testID={id}
            accessibilityRole="menuitem"
            accessibilityLabel={title}
            onPress={() => { setMenu(null); router.push(path); }}
            style={({ pressed }) => ({
              minHeight: 56,
              paddingHorizontal: 18,
              paddingVertical: 14,
              flexDirection: "row",
              gap: 14,
              alignItems: "center",
              backgroundColor: pressed ? c.avatar : c.card,
            })}
          >
            <Icon size={21} color={c.text} />
            <Label style={{ flex: 1 }}>{title}</Label>
          </Pressable>)}
        </ScrollView>}
      </View>
    </Modal>
    </View>
  );
}
