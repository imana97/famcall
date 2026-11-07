import { Redirect, Stack } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useSession } from "../../state/Session";
import { useCallReadiness } from "../../state/CallReadiness";
import { Page, useTheme } from "../../components/ui";
export default function MainLayout() {
  const c = useTheme();
  const { ready, user } = useSession();
  const readiness = useCallReadiness();
  if (!ready || (user && !readiness.checked))
    return (
      <Page>
        <ActivityIndicator color={c.text} />
      </Page>
    );
  if (!user) return <Redirect href="/auth" />;
  if (readiness.needsSetup) return <Redirect href="/calling-setup" />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="index" options={{ gestureEnabled: false }} />
      <Stack.Screen name="history" />
      <Stack.Screen name="settings" />
    </Stack>
  );
}
