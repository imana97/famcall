import { beforeEach, expect, test, vi } from "vitest";
import type { Auth, PhoneAuthSnapshot, User } from "@react-native-firebase/auth";

const sdk = vi.hoisted(() => ({
  verify: vi.fn(), credential: vi.fn(), reauthenticate: vi.fn(), token: vi.fn(),
  signIn: vi.fn(), signInCredential: vi.fn(),
}));
vi.mock("@react-native-firebase/auth", () => ({
  verifyPhoneNumber: sdk.verify,
  PhoneAuthProvider: { credential: sdk.credential },
  reauthenticateWithCredential: sdk.reauthenticate,
  getIdToken: sdk.token,
  signInWithPhoneNumber: sdk.signIn,
  signInWithCredential: sdk.signInCredential,
}));
import { requestPhoneReauthentication } from "../apps/mobile/src/services/PhoneReauthentication";

const user = { uid: "existing-user", phoneNumber: "+14085550120" } as User;
let auth: Auth;
let emit: (snapshot: PhoneAuthSnapshot) => void;
let fail: (error: unknown) => void;
const sent: PhoneAuthSnapshot = {
  state: "sent", verificationId: "fictional-verification-id", code: null, error: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  auth = { currentUser: user } as Auth;
  sdk.verify.mockReturnValue({ on: (_: string, callback: typeof emit, error: typeof fail) => {
    emit = callback;
    fail = error;
  } });
  sdk.credential.mockReturnValue({ providerId: "phone", token: "fictional-credential" });
  sdk.reauthenticate.mockResolvedValue({ user });
  sdk.token.mockResolvedValue("fictional-fresh-token");
});

async function challenge() {
  const pending = requestPhoneReauthentication(auth, user.uid);
  emit(sent);
  return pending;
}

test("accepts Android's sent event immediately and reauthenticates only the captured user", async () => {
  const confirmation = await challenge();
  expect(sdk.verify).toHaveBeenCalledWith(auth, user.phoneNumber, false);
  expect(sdk.reauthenticate).not.toHaveBeenCalled();
  await confirmation.confirm("123456");
  expect(sdk.credential).toHaveBeenCalledWith(sent.verificationId, "123456");
  expect(sdk.reauthenticate).toHaveBeenCalledWith(user, sdk.credential.mock.results[0].value);
  expect(sdk.token).toHaveBeenCalledWith(user, true);
  expect(sdk.signIn).not.toHaveBeenCalled();
  expect(sdk.signInCredential).not.toHaveBeenCalled();
  // A failed delete request can retry without replaying an already-used SMS code.
  await confirmation.confirm("123456");
  expect(sdk.reauthenticate).toHaveBeenCalledTimes(1);
});

test("uses native resend and preserves an automatically retrieved code for explicit confirmation", async () => {
  const pending = requestPhoneReauthentication(auth, user.uid, true);
  emit({ ...sent, state: "verified", code: "654321" });
  const confirmation = await pending;
  expect(sdk.verify).toHaveBeenCalledWith(auth, user.phoneNumber, true);
  expect(confirmation.code).toBe("654321");
  expect(sdk.reauthenticate).not.toHaveBeenCalled();
});

test("does not send SMS for a different or absent signed-in user", async () => {
  await expect(requestPhoneReauthentication(auth, "different-user")).rejects.toMatchObject({ code: "auth/user-mismatch" });
  auth = { currentUser: null } as Auth;
  await expect(requestPhoneReauthentication(auth, user.uid)).rejects.toMatchObject({ code: "auth/user-mismatch" });
  expect(sdk.verify).not.toHaveBeenCalled();
});

test("rejects account changes while requesting or confirming an SMS challenge", async () => {
  const pending = requestPhoneReauthentication(auth, user.uid);
  Object.assign(auth, { currentUser: { ...user, uid: "replacement-user" } });
  emit(sent);
  await expect(pending).rejects.toMatchObject({ code: "auth/user-mismatch" });
  Object.assign(auth, { currentUser: user });
  const confirmation = await challenge();
  Object.assign(auth, { currentUser: { ...user, uid: "replacement-user" } });
  await expect(confirmation.confirm("123456")).rejects.toMatchObject({ code: "auth/user-mismatch" });
  expect(sdk.reauthenticate).not.toHaveBeenCalled();
});

test("deleted users and SDK failures never fall back to sign-in or create a replacement account", async () => {
  const confirmation = await challenge();
  const deleted = Object.assign(new Error("Deleted"), { code: "auth/user-not-found" });
  sdk.reauthenticate.mockRejectedValue(deleted);
  await expect(confirmation.confirm("123456")).rejects.toBe(deleted);
  expect(auth.currentUser).toBe(user);
  expect(sdk.token).not.toHaveBeenCalled();
  expect(sdk.signIn).not.toHaveBeenCalled();
  expect(sdk.signInCredential).not.toHaveBeenCalled();
});

test("does not mark verification complete when SDK returns a different UID or identity changes in flight", async () => {
  const confirmation = await challenge();
  sdk.reauthenticate.mockResolvedValueOnce({ user: { ...user, uid: "other-user" } });
  await expect(confirmation.confirm("123456")).rejects.toMatchObject({ code: "auth/user-mismatch" });
  expect(sdk.token).not.toHaveBeenCalled();
  sdk.reauthenticate.mockImplementationOnce(async () => {
    Object.assign(auth, { currentUser: null });
    return { user };
  });
  await expect(confirmation.confirm("123456")).rejects.toMatchObject({ code: "auth/user-mismatch" });
  expect(sdk.token).not.toHaveBeenCalled();
});

test("surfaces native verification errors and rejects a missing verification ID", async () => {
  const error = Object.assign(new Error("Quota"), { code: "auth/quota-exceeded" });
  const pending = requestPhoneReauthentication(auth, user.uid);
  fail(error);
  await expect(pending).rejects.toBe(error);
  const malformed = requestPhoneReauthentication(auth, user.uid);
  emit({ ...sent, verificationId: "" });
  await expect(malformed).rejects.toMatchObject({ code: "auth/invalid-verification-id" });
  expect(sdk.reauthenticate).not.toHaveBeenCalled();
});

test("wrong codes can retry safely and simultaneous confirms use one reauthentication", async () => {
  const confirmation = await challenge();
  await expect(confirmation.confirm("bad")).rejects.toMatchObject({ code: "auth/invalid-verification-code" });
  sdk.reauthenticate.mockRejectedValueOnce({ code: "auth/invalid-verification-code" });
  await expect(confirmation.confirm("111111")).rejects.toMatchObject({ code: "auth/invalid-verification-code" });
  await Promise.all([confirmation.confirm("123456"), confirmation.confirm("123456")]);
  expect(sdk.reauthenticate).toHaveBeenCalledTimes(2);
  expect(sdk.token).toHaveBeenCalledTimes(1);
});

test("retries a failed token refresh without replaying a successfully used SMS code", async () => {
  const confirmation = await challenge();
  const offline = { code: "auth/network-request-failed" };
  sdk.token.mockRejectedValueOnce(offline);
  await expect(confirmation.confirm("123456")).rejects.toBe(offline);
  await confirmation.confirm("123456");
  expect(sdk.reauthenticate).toHaveBeenCalledTimes(1);
  expect(sdk.token).toHaveBeenCalledTimes(2);
});
