import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../state/Session";
import { CallingProvider } from "../state/Calling";
import { CallReadinessProvider } from "../state/CallReadiness";
import { useTheme } from "../components/ui";
import { LanguageProvider } from "../state/Language";
export default function RootLayout() {
  return <LanguageProvider><AppLayout /></LanguageProvider>;
}
function AppLayout() {
  const c = useTheme();
  return (
    <SessionProvider>
      <CallReadinessProvider>
      <CallingProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: c.bg },
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
          <Stack.Screen name="dial" options={{
            presentation: "formSheet",
            animation: "slide_from_bottom",
            gestureEnabled: true,
            sheetAllowedDetents: [0.85, 1],
            sheetCornerRadius: 28,
            sheetGrabberVisible: true,
            sheetExpandsWhenScrolledToEdge: true,
          }} />
        </Stack>
      </CallingProvider>
      </CallReadinessProvider>
    </SessionProvider>
  );
}
