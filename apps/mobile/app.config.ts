import type { ExpoConfig } from "expo/config";
import path from "node:path";

const e2e = process.env.APP_VARIANT === "e2e";
const emulatorHost = e2e
  ? (process.env.EXPO_PUBLIC_EMULATOR_HOST ?? "10.0.2.2")
  : null;
const audioRecordDiagnostics = process.env.FAMCALL_AUDIO_RECORD_DIAGNOSTICS === "1";
if (audioRecordDiagnostics && !e2e)
  throw new Error("Audio recording diagnostics require the separate e2e app.");
const root = path.resolve(__dirname, "../..");
if (!e2e && process.env.EXPO_PUBLIC_EMULATOR_HOST)
  throw new Error("Emulator settings require the separate e2e app.");
const config: ExpoConfig = {
  name: e2e ? "FamCall Test" : "FamCall",
  slug: "famcall",
  owner: "silvergrid",
  version: "0.1.0",
  scheme: e2e ? "famcall-test" : "famcall",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "com.silvergridtech.famcall" + (e2e ? ".e2e" : ""),
    supportsTablet: false,
    ...(e2e
      ? {}
      : {
          entitlements: {
            "com.apple.developer.devicecheck.appattest-environment": "production",
          },
        }),
    googleServicesFile:
      process.env.GOOGLE_SERVICE_INFO_PLIST ??
      path.join(
        root,
        ".local",
        e2e ? "GoogleService-Info.e2e.plist" : "GoogleService-Info.plist",
      ),
    infoPlist: { CFBundleAllowMixedLocalizations: true },
  },
  android: {
    package: "com.silvergridtech.famcall" + (e2e ? ".e2e" : ""),
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ??
      path.join(
        root,
        ".local",
        e2e ? "google-services.e2e.json" : "google-services.json",
      ),
    blockedPermissions: [
      "android.permission.CAMERA",
      "android.permission.READ_CALL_LOG",
      "android.permission.WRITE_CALL_LOG",
      // FamCall reads a selected contact and uses app-private storage only.
      "android.permission.WRITE_CONTACTS",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundColor: "#183D34",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
  },
  plugins: [
    // Info.plist mods run in reverse order; apply voice-only wording after SDK plugins.
    "./plugins/withAudioOnly",
    "./plugins/withFirebasePhoneAuth",
    "./plugins/withTestBackend",
    "expo-router",
    ["expo-localization", { supportedLocales: ["en"], supportsRTL: false }],
    [
      "expo-contacts",
      {
        contactsPermission:
          "Choose someone from your contacts to add to FamCall.",
      },
    ],
    ["expo-notifications", { enableBackgroundRemoteNotifications: true }],
    [
      "expo-build-properties",
      {
        ios: { useFrameworks: "dynamic" },
        android: {
          usesCleartextTraffic: e2e,
          kotlinVersion: "2.4.20",
          // M155's optional AV1 decoder JNI interface is absent from its AAR.
          // FamCall negotiates audio only. Keep this exception narrowly scoped.
          extraProguardRules: "-dontwarn org.webrtc.Dav1dDecoder$Natives",
        },
      },
    ],
    "@react-native-firebase/app",
    "@react-native-firebase/auth",
    "@react-native-firebase/app-check",
    [
      "@config-plugins/react-native-webrtc",
      {
        microphonePermission:
          "FamCall uses your microphone during voice calls.",
      },
    ],
    [
      "expo-callkit-telecom",
      {
        supportsVideo: false,
        supportsHolding: false,
        includesCallsInRecents: false,
        cameraPermission: false,
        microphonePermission:
          "FamCall uses your microphone during voice calls.",
        incomingCallTimeout: 45,
        outgoingCallTimeout: 60,
        fulfillAnswerCallTimeout: 45,
        androidEventReceiver: "com.silvergridtech.famcall.calls.FamCallEndReceiver",
      },
    ],
    "./plugins/withCallEndReceiver",
    ["./plugins/withAudioRecordDiagnostics", { enabled: audioRecordDiagnostics }],
  ],
  extra: {
    ...(e2e ? {} : { eas: { projectId: "76a56f3e-a64d-4917-9da0-d9f9018de627" } }),
    appMode: e2e ? "e2e" : "production",
    emulatorHost,
  },
};
export default config;
