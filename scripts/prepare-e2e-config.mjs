import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const local = resolve(import.meta.dirname, "../.local");
await mkdir(local, { recursive: true });
const packageName = "com.silvergridtech.famcall.e2e";
// Firebase Installations validates the shape even when all services use emulators.
const emulatorKey = "AIzaSy" + "0".repeat(33);
await writeFile(
  resolve(local, "google-services.e2e.json"),
  JSON.stringify(
    {
      project_info: {
        project_number: "123456789012",
        project_id: "demo-famcall",
        storage_bucket: "demo-famcall.appspot.com",
      },
      client: [
        {
          client_info: {
            mobilesdk_app_id: "1:123456789012:android:0000000000000000",
            android_client_info: { package_name: packageName },
          },
          oauth_client: [],
          api_key: [{ current_key: emulatorKey }],
          services: { appinvite_service: { other_platform_oauth_client: [] } },
        },
      ],
      configuration_version: "1",
    },
    null,
    2,
  ),
);
await writeFile(
  resolve(local, "GoogleService-Info.e2e.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>API_KEY</key><string>${emulatorKey}</string>
<key>GCM_SENDER_ID</key><string>123456789012</string>
<key>PLIST_VERSION</key><string>1</string>
<key>BUNDLE_ID</key><string>${packageName}</string>
<key>PROJECT_ID</key><string>demo-famcall</string>
<key>GOOGLE_APP_ID</key><string>1:123456789012:ios:0000000000000000</string>
<key>CLIENT_ID</key><string>123456789012-demo.apps.googleusercontent.com</string>
<key>REVERSED_CLIENT_ID</key><string>com.googleusercontent.apps.123456789012-demo</string>
<key>IS_ADS_ENABLED</key><false/><key>IS_ANALYTICS_ENABLED</key><false/>
<key>IS_APPINVITE_ENABLED</key><false/><key>IS_GCM_ENABLED</key><true/><key>IS_SIGNIN_ENABLED</key><true/>
</dict></plist>`,
);
console.log(
  "Local emulator configurations prepared; no production credentials included.",
);
