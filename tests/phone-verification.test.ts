import { afterEach, beforeEach, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({
  platform: { OS: "ios" },
  register: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: native.platform }));
vi.mock("expo-notifications", () => ({ getDevicePushTokenAsync: native.register }));
import { preparePhoneVerification } from "../apps/mobile/src/services/phoneVerification";

beforeEach(() => {
  vi.useFakeTimers();
  native.platform.OS = "ios";
  native.register.mockReset();
});
afterEach(() => vi.useRealTimers());

test("waits for native APNs registration before allowing phone verification to continue", async () => {
  let registered!: (token: object) => void;
  native.register.mockReturnValue(new Promise(resolve => { registered = resolve; }));
  const next = vi.fn();
  const preparing = preparePhoneVerification(false).then(next);
  await vi.advanceTimersByTimeAsync(1000);
  expect(next).not.toHaveBeenCalled();
  registered({ type: "ios", data: "fictional-apns-token" });
  await preparing;
  expect(next).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test("registration failure allows Firebase fallback and a later attempt can retry", async () => {
  native.register.mockRejectedValueOnce(new Error("APNs unavailable"));
  await expect(preparePhoneVerification(false)).resolves.toBeUndefined();
  native.register.mockResolvedValueOnce({ type: "ios", data: "fictional-token" });
  await preparePhoneVerification(false);
  expect(native.register).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test("a stalled APNs request cannot indefinitely block login; late failure stays handled", async () => {
  let fail!: (error: Error) => void;
  native.register.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  const next = vi.fn();
  const preparing = preparePhoneVerification(false).then(next);
  await vi.advanceTimersByTimeAsync(4999);
  expect(next).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await preparing;
  expect(next).toHaveBeenCalledOnce();
  fail(new Error("late APNs failure"));
  await vi.runAllTimersAsync();
  expect(vi.getTimerCount()).toBe(0);
});

test("Android and isolated emulator tests never register with Apple", async () => {
  await preparePhoneVerification(true);
  native.platform.OS = "android";
  await preparePhoneVerification(false);
  expect(native.register).not.toHaveBeenCalled();
});
