import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../state/Session";
import { CallingProvider } from "../state/Calling";
import { useTheme } from "../components/ui";
export default function RootLayout() {
  const c = useTheme();
  return (
    <SessionProvider>
      <CallingProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: c.bg },
            animation: "slide_from_right",
          }}
        />
      </CallingProvider>
    </SessionProvider>
  );
}
