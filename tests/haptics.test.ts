import { beforeEach, expect, test, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  native: vi.fn(), platform: { OS: "ios" },
  selection: vi.fn(), impact: vi.fn(), android: vi.fn(),
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: sdk.native }));
vi.mock("react-native", () => ({ Platform: sdk.platform }));
vi.mock("expo-haptics", () => ({
  selectionAsync: sdk.selection, impactAsync: sdk.impact, performAndroidHapticsAsync: sdk.android,
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  AndroidHaptics: { Virtual_Key: "key", Long_Press: "long", Context_Click: "context", Segment_Tick: "tick" },
}));
import { haptic } from "../apps/mobile/src/services/haptics";

beforeEach(() => {
  vi.resetAllMocks();
  sdk.platform.OS = "ios";
  sdk.native.mockReturnValue({});
  sdk.selection.mockResolvedValue(undefined);
  sdk.impact.mockResolvedValue(undefined);
  sdk.android.mockResolvedValue(undefined);
});

test("older installed clients and unsupported platforms can still use every action", async () => {
  sdk.native.mockReturnValue(null);
  expect(() => haptic("light")).not.toThrow();
  sdk.native.mockReturnValue({});
  sdk.platform.OS = "web";
  haptic("light");
  sdk.platform.OS = "ios";
  haptic(false);
  await vi.dynamicImportSettled();
  expect(sdk.selection).not.toHaveBeenCalled();
  expect(sdk.impact).not.toHaveBeenCalled();
  expect(sdk.android).not.toHaveBeenCalled();
});

test("uses subtle selection feedback and distinct primary and destructive impacts on iPhone", async () => {
  haptic("key");
  haptic("selection");
  haptic("light");
  haptic("medium");
  await vi.dynamicImportSettled();
  expect(sdk.selection).toHaveBeenCalledTimes(2);
  expect(sdk.impact.mock.calls).toEqual([["light"], ["medium"]]);
  expect(sdk.android).not.toHaveBeenCalled();
});

test("uses Android system haptics rather than vibrator patterns", async () => {
  sdk.platform.OS = "android";
  haptic("key");
  haptic("selection");
  haptic("light");
  haptic("medium");
  await vi.dynamicImportSettled();
  expect(sdk.android.mock.calls).toEqual([["key"], ["tick"], ["context"], ["long"]]);
  expect(sdk.impact).not.toHaveBeenCalled();
  expect(sdk.selection).not.toHaveBeenCalled();
});

test("native failures do not block buttons or produce unhandled rejections", async () => {
  sdk.native.mockImplementationOnce(() => { throw new Error("unavailable"); });
  expect(() => haptic()).not.toThrow();
  sdk.selection.mockRejectedValueOnce(new Error("hardware unavailable"));
  haptic();
  await vi.dynamicImportSettled();
  sdk.platform.OS = "android";
  sdk.android.mockRejectedValueOnce(new Error("system unavailable"));
  haptic();
  await vi.dynamicImportSettled();
});
