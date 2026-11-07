import { Redirect, Tabs } from "expo-router";
import { UsersRound, Clock3, Settings2 } from "lucide-react-native";
import { ActivityIndicator } from "react-native";
import { useSession } from "../../state/Session";
import { Page, useTheme } from "../../components/ui";
import { t } from "../../i18n";
export default function TabLayout() {
  const c = useTheme();
  const { ready, user } = useSession();
  if (!ready)
    return (
      <Page>
        <ActivityIndicator color={c.text} />
      </Page>
    );
  if (!user) return <Redirect href="/auth" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.line },
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("contacts"),
          tabBarIcon: ({ color, size }) => (
            <UsersRound color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t("history"),
          tabBarIcon: ({ color, size }) => <Clock3 color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("settings"),
          tabBarIcon: ({ color, size }) => (
            <Settings2 color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
