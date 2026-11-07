import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: { OS: "android", Version: 35 },
  app: { currentState: "active" },
  storage: new Map<string, string>(),
  queryMicrophone: vi.fn(), requestMicrophone: vi.fn(), androidRequest: vi.fn(),
  readNotifications: vi.fn(), requestNotifications: vi.fn(),
  fullScreen: vi.fn(), fullScreenSettings: vi.fn(), settings: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async (key: string) => mocks.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { mocks.storage.set(key, value); },
} }));
vi.mock("react-native", () => ({
  Platform: mocks.platform, AppState: mocks.app,
  Linking: { openSettings: mocks.settings },
  PermissionsAndroid: { request: mocks.androidRequest,
    PERMISSIONS: { RECORD_AUDIO: "android.permission.RECORD_AUDIO" },
    RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" } },
  NativeModules: { FamCallPermissions: {
    canUseFullScreenIntent: mocks.fullScreen,
    openFullScreenIntentSettings: mocks.fullScreenSettings,
  } },
}));
vi.mock("react-native-webrtc", () => ({
  permissions: { query: mocks.queryMicrophone, request: mocks.requestMicrophone },
}));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: mocks.readNotifications, requestPermissionsAsync: mocks.requestNotifications,
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3 },
}));

import { assertMicrophonePermission, canUseVoiceCalls, isCallingReady, readCallingPermissions, requestCallingPermission } from "../apps/mobile/src/services/callReadiness";
import { MicrophonePermissionError } from "../apps/mobile/src/services/errors";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.storage.clear();
  mocks.platform.OS = "android";
  mocks.platform.Version = 35;
  mocks.app.currentState = "active";
  mocks.queryMicrophone.mockResolvedValue("granted");
  mocks.readNotifications.mockResolvedValue({ status: "granted", granted: true, canAskAgain: true });
  mocks.fullScreen.mockResolvedValue(true);
});

describe("calling setup permissions", () => {
  it("reads a fresh install without prompting or confusing a missing grant with permission", async () => {
    mocks.queryMicrophone.mockResolvedValue("prompt");
    mocks.readNotifications.mockResolvedValue({ status: "undetermined", granted: false, canAskAgain: true });
    mocks.fullScreen.mockResolvedValue(false);
    const result = await readCallingPermissions();
    expect(result).toEqual({
      microphone: { status: "undetermined", canAskAgain: true },
      notifications: { status: "undetermined", canAskAgain: true }, fullScreen: "denied",
    });
    expect(isCallingReady(result)).toBe(false);
    expect(mocks.androidRequest).not.toHaveBeenCalled();
    expect(mocks.requestMicrophone).not.toHaveBeenCalled();
    expect(mocks.requestNotifications).not.toHaveBeenCalled();
    expect(mocks.storage.size).toBe(0);
  });

  it("preserves an Android denial, then directs a permanent denial to Settings", async () => {
    mocks.queryMicrophone.mockResolvedValue("prompt");
    mocks.androidRequest.mockResolvedValueOnce("denied").mockResolvedValueOnce("never_ask_again");
    await requestCallingPermission("microphone");
    expect((await readCallingPermissions()).microphone).toEqual({ status: "denied", canAskAgain: true });
    await requestCallingPermission("microphone");
    expect((await readCallingPermissions()).microphone).toEqual({ status: "denied", canAskAgain: false });
    await requestCallingPermission("microphone");
    expect(mocks.androidRequest).toHaveBeenCalledTimes(2);
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.requestMicrophone).not.toHaveBeenCalled();
  });

  it("rechecks actual grants after Settings and detects later revocation", async () => {
    mocks.storage.set("famcall-microphone-request", "blocked");
    expect(isCallingReady(await readCallingPermissions())).toBe(true);
    mocks.queryMicrophone.mockResolvedValue("prompt");
    expect(isCallingReady(await readCallingPermissions())).toBe(false);
    mocks.queryMicrophone.mockResolvedValue("granted");
    expect(isCallingReady(await readCallingPermissions())).toBe(true);
    mocks.fullScreen.mockResolvedValue(false);
    expect(isCallingReady(await readCallingPermissions())).toBe(false);
  });

  it("keeps voice calling available when optional alerts or full-screen access are declined", async () => {
    mocks.readNotifications.mockResolvedValue({ status: "denied", granted: false, canAskAgain: false });
    mocks.fullScreen.mockResolvedValue(false);
    const settings = await readCallingPermissions();
    expect(isCallingReady(settings)).toBe(false);
    expect(canUseVoiceCalls(settings)).toBe(true);
    mocks.readNotifications.mockRejectedValue(new Error("unavailable"));
    mocks.fullScreen.mockRejectedValue(new Error("unavailable"));
    expect(canUseVoiceCalls(await readCallingPermissions())).toBe(true);
    mocks.queryMicrophone.mockResolvedValue("prompt");
    expect(canUseVoiceCalls(await readCallingPermissions())).toBe(false);
  });

  it("requests iOS microphone access explicitly without opening a capture session", async () => {
    mocks.platform.OS = "ios";
    mocks.queryMicrophone.mockResolvedValue("prompt");
    await requestCallingPermission("microphone");
    expect(mocks.requestMicrophone).toHaveBeenCalledWith({ name: "microphone" });
    expect(mocks.androidRequest).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
    mocks.queryMicrophone.mockResolvedValue("denied");
    await requestCallingPermission("microphone");
    expect(mocks.requestMicrophone).toHaveBeenCalledOnce();
    expect(mocks.settings).toHaveBeenCalledOnce();
  });

  it("asks for audible notifications only from the setup action and respects denial", async () => {
    mocks.readNotifications.mockResolvedValue({ status: "undetermined", granted: false, canAskAgain: true });
    await requestCallingPermission("notifications");
    expect(mocks.requestNotifications).toHaveBeenCalledWith({ ios: { allowAlert: true, allowSound: true, allowBadge: true } });
    mocks.readNotifications.mockResolvedValue({ status: "denied", granted: false, canAskAgain: false });
    expect((await readCallingPermissions()).notifications.status).toBe("denied");
    await requestCallingPermission("notifications");
    expect(mocks.requestNotifications).toHaveBeenCalledOnce();
    expect(mocks.settings).toHaveBeenCalledOnce();
  });

  it("does not mistake quiet iOS authorization or disabled sound for alert readiness", async () => {
    mocks.platform.OS = "ios";
    mocks.readNotifications.mockResolvedValue({ status: "granted", granted: true, canAskAgain: true,
      ios: { status: 3, allowsAlert: true, allowsSound: true } });
    expect(isCallingReady(await readCallingPermissions())).toBe(false);
    mocks.readNotifications.mockResolvedValue({ status: "granted", granted: true, canAskAgain: true,
      ios: { status: 2, allowsAlert: true, allowsSound: false } });
    expect(isCallingReady(await readCallingPermissions())).toBe(false);
    await requestCallingPermission("notifications");
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.requestNotifications).not.toHaveBeenCalled();
  });

  it.each(["microphone", "notifications", "fullScreen"] as const)("never requests %s from the background", async name => {
    mocks.app.currentState = "background";
    await requestCallingPermission(name);
    expect(mocks.androidRequest).not.toHaveBeenCalled();
    expect(mocks.requestMicrophone).not.toHaveBeenCalled();
    expect(mocks.requestNotifications).not.toHaveBeenCalled();
    expect(mocks.fullScreenSettings).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
  });

  it("does not prompt after the app backgrounds during an asynchronous status check", async () => {
    mocks.queryMicrophone.mockImplementation(async () => {
      mocks.app.currentState = "background";
      return "prompt";
    });
    await requestCallingPermission("microphone");
    expect(mocks.androidRequest).not.toHaveBeenCalled();
  });

  it("opens the dedicated Android setting only from the user's action", async () => {
    mocks.fullScreen.mockResolvedValue(false);
    await readCallingPermissions();
    expect(mocks.fullScreenSettings).not.toHaveBeenCalled();
    await requestCallingPermission("fullScreen");
    expect(mocks.fullScreenSettings).toHaveBeenCalledOnce();
    expect((await readCallingPermissions()).fullScreen).toBe("denied");
    mocks.platform.Version = 33;
    mocks.fullScreen.mockClear();
    expect((await readCallingPermissions()).fullScreen).toBe("not-required");
    expect(mocks.fullScreen).not.toHaveBeenCalled();
  });

  it("rejects an ungranted microphone at the call boundary without prompting", async () => {
    mocks.queryMicrophone.mockResolvedValue("prompt");
    await expect(assertMicrophonePermission()).rejects.toBeInstanceOf(MicrophonePermissionError);
    expect(mocks.androidRequest).not.toHaveBeenCalled();
    expect(mocks.requestMicrophone).not.toHaveBeenCalled();
  });
});
