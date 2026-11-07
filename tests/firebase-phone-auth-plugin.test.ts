import { createRequire } from "node:module";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const plugin = require("../apps/mobile/plugins/withFirebasePhoneAuth.js");
const delegate = `internal import Expo
import FirebaseCore
@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FirebaseApp.configure()
    return super.application(application, didFinishLaunchingWithOptions: options)
  }
}
class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {}
`;

async function apply(name: "infoPlist" | "appDelegate", value: object) {
  const config = plugin({ name: "FamCall", slug: "famcall" });
  const result = await config.mods.ios[name]({
    ...config,
    modResults: structuredClone(value),
    modRequest: { platform: "ios", modName: name, introspect: true },
  });
  return result.modResults;
}

test("adds Firebase background modes without losing voice modes or callback schemes", async () => {
  const initial = { UIBackgroundModes: ["voip", "audio"], CFBundleURLTypes: [{ CFBundleURLSchemes: ["firebase-callback"] }] };
  const output = await apply("infoPlist", initial);
  expect(output.UIBackgroundModes).toEqual(["voip", "audio", "fetch", "remote-notification"]);
  expect(output.CFBundleURLTypes).toEqual(initial.CFBundleURLTypes);
  expect(await apply("infoPlist", output)).toEqual(output);
});

test("forwards the APNs token and only consumes Firebase-owned notifications, once", async () => {
  const output = await apply("appDelegate", { language: "swift", contents: delegate });
  expect(output.contents).toContain("Auth.auth().setAPNSToken(deviceToken, type: .unknown)");
  expect(output.contents).toContain("super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)");
  expect(output.contents).toMatch(/if Auth\.auth\(\)\.canHandleNotification\(userInfo\) \{\s+completionHandler\(\.noData\)\s+return\s+\}\s+super\.application\(application, didReceiveRemoteNotification: userInfo, fetchCompletionHandler: completionHandler\)/);
  expect(output.contents.match(/FirebaseApp.configure\(\)/g)).toHaveLength(1);
  expect(output.contents).not.toMatch(/DebugProvider|appVerificationDisabled|setenv/);
  expect(await apply("appDelegate", output)).toEqual(output);
});

test("fails visibly if a future template already owns APNs callbacks or changes language", async () => {
  await expect(apply("appDelegate", { language: "objc", contents: "" })).rejects.toThrow(/Swift AppDelegate/);
  await expect(apply("appDelegate", { language: "swift", contents: delegate + "\n// didReceiveRemoteNotification" })).rejects.toThrow(/Review existing APNs callbacks/);
  await expect(apply("appDelegate", { language: "swift", contents: "import Expo\nclass RenamedDelegate {}" })).rejects.toThrow();
});
