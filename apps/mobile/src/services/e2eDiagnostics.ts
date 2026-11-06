import Constants from "expo-constants";
import { getApp } from "@react-native-firebase/app";
import { isE2E } from "./firebase";

const enabled = isE2E && getApp().options.projectId === "demo-famcall";
const base =
  "http://" +
  String(Constants.expoConfig?.extra?.emulatorHost ?? "10.0.2.2") +
  ":8787";
export type TestTransport = "udp" | "tcp" | "tls" | "direct";
export async function testTransport(): Promise<{
  transport: TestTransport;
  proxy: boolean;
  host: string;
} | null> {
  if (!enabled) return null;
  try {
    const response = await fetch(base + "/config", {
      signal: AbortSignal.timeout(1500),
    });
    const config = await response.json();
    if (["udp", "tcp", "tls", "direct"].includes(config.transport))
      return {
        transport: config.transport,
        proxy: config.proxy === true,
        host: String(Constants.expoConfig?.extra?.emulatorHost ?? "10.0.2.2"),
      };
  } catch {
    /* UI-only tests do not require the audio collector. */
  }
  return { transport: "udp", proxy: false, host: "10.0.2.2" };
}
export function recordTestMetric(data: Record<string, unknown>) {
  if (!enabled) return;
  void fetch(base + "/metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, at: Date.now() }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => undefined);
}
