import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ available: vi.fn(), compose: vi.fn(), share: vi.fn() }));
vi.mock("expo-sms", () => ({ isAvailableAsync: native.available, sendSMSAsync: native.compose }));
vi.mock("react-native", () => ({ Share: { share: native.share } }));
import { inviteToFamCall, famcallWebsite } from "../apps/mobile/src/services/invite";
import { setLocale } from "../apps/mobile/src/i18n";

beforeEach(() => { vi.resetAllMocks(); setLocale("en"); native.available.mockResolvedValue(true); });
it("prepares the chosen recipient and website in the OS text composer", async () => {
  await inviteToFamCall("0012025550101");
  expect(native.compose).toHaveBeenCalledExactlyOnceWith(["+12025550101"], "Let’s talk on FamCall. Get the app here: " + famcallWebsite);
  expect(native.share).not.toHaveBeenCalled();
});
it("offers the share sheet when the device has no SMS composer", async () => {
  native.available.mockResolvedValue(false);
  await inviteToFamCall("+12025550101");
  expect(native.compose).not.toHaveBeenCalled();
  expect(native.share).toHaveBeenCalledExactlyOnceWith({ message: expect.stringContaining(famcallWebsite) });
});
it.each(["fa", "ar", "ur"] as const)("preserves a plain clickable website in %s invitations", async locale => {
  setLocale(locale);
  await inviteToFamCall("+12025550101");
  const text = native.compose.mock.calls[0][1];
  expect(text).toContain(famcallWebsite);
  expect(text).not.toMatch(/[\u2068\u2069]/);
  expect(text).not.toContain("Let’s talk");
});
it("does not open a composer for an invalid recipient", async () => {
  await expect(inviteToFamCall("not a number")).rejects.toThrow();
  expect(native.compose).not.toHaveBeenCalled();
});
it("allows OS composer failures to be retried without claiming a message was sent", async () => {
  native.compose.mockRejectedValueOnce(new Error("composer unavailable"));
  await expect(inviteToFamCall("+12025550101")).rejects.toThrow("composer unavailable");
  native.compose.mockResolvedValueOnce({ result: "cancelled" });
  await expect(inviteToFamCall("+12025550101")).resolves.toBeUndefined();
});
