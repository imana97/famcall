import { expect, test, vi } from "vitest";
import { SessionValidation } from "../apps/mobile/src/services/SessionValidation";

type User = { uid: string };
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(initial: User | null = { uid: "alice" }) {
  let current = initial;
  const deps = {
    current: () => current,
    reload: vi.fn(async (_user: User) => {}),
    signOut: vi.fn(async () => { current = null; }),
  };
  const validation = new SessionValidation(deps);
  return { validation, deps, setCurrent: (user: User | null) => { current = user; } };
}

test("does not reload or sign out when no user is persisted", async () => {
  const { validation, deps } = setup(null);
  await validation.validate();
  expect(deps.reload).not.toHaveBeenCalled();
  expect(deps.signOut).not.toHaveBeenCalled();
});

test.each([
  "auth/user-not-found", "auth/user-disabled", "auth/user-token-expired", "auth/invalid-user-token",
])("clears confirmed invalid persisted credentials: %s", async code => {
  const { validation, deps } = setup();
  deps.reload.mockRejectedValueOnce({ code });
  await validation.validate();
  expect(deps.signOut).toHaveBeenCalledOnce();
  expect(deps.current()).toBeNull();
});

test.each([
  "auth/network-request-failed", "auth/too-many-requests", "app-check/unknown",
  "functions/permission-denied", "functions/unauthenticated", undefined,
])("preserves the cached user on an inconclusive failure: %s", async code => {
  const { validation, deps } = setup();
  const user = deps.current();
  deps.reload.mockRejectedValueOnce({ code });
  await validation.validate();
  expect(deps.signOut).not.toHaveBeenCalled();
  expect(deps.current()).toBe(user);
});

test("retries after an offline validation without blocking later validation", async () => {
  const { validation, deps } = setup();
  deps.reload.mockRejectedValueOnce({ code: "auth/network-request-failed" });
  await validation.validate();
  await validation.validate();
  expect(deps.reload).toHaveBeenCalledTimes(2);
  expect(deps.signOut).not.toHaveBeenCalled();
});

test("deduplicates concurrent initial, Retry and foreground checks", async () => {
  const { validation, deps } = setup();
  const lookup = deferred();
  deps.reload.mockReturnValueOnce(lookup.promise);
  const first = validation.validate();
  const retry = validation.validate();
  await Promise.resolve();
  const foreground = validation.validate();
  expect(deps.reload).toHaveBeenCalledOnce();
  lookup.resolve();
  await Promise.all([first, retry, foreground]);
  expect(deps.reload).toHaveBeenCalledOnce();
});

test("serializes validation for a replacement account and ignores the old failure", async () => {
  const { validation, deps, setCurrent } = setup();
  const lookup = deferred();
  deps.reload.mockReturnValueOnce(lookup.promise);
  const first = validation.validate();
  await Promise.resolve();
  const replacement = { uid: "bob" };
  setCurrent(replacement);
  const next = validation.validate();
  expect(deps.reload).toHaveBeenCalledOnce();
  lookup.reject({ code: "auth/user-not-found" });
  await Promise.all([first, next]);
  expect(deps.reload).toHaveBeenCalledTimes(2);
  expect(deps.reload).toHaveBeenLastCalledWith(replacement);
  expect(deps.signOut).not.toHaveBeenCalled();
});

test("does not clear a fresh sign-in with the same UID after an old failure", async () => {
  const { validation, deps, setCurrent } = setup();
  const lookup = deferred();
  deps.reload.mockReturnValueOnce(lookup.promise);
  const pending = validation.validate();
  await Promise.resolve();
  setCurrent({ uid: "alice" });
  lookup.reject({ code: "auth/user-token-expired" });
  await pending;
  expect(deps.signOut).not.toHaveBeenCalled();
  expect(deps.current()?.uid).toBe("alice");
});

test("handles native Firebase already signing out during reload", async () => {
  const { validation, deps, setCurrent } = setup();
  deps.reload.mockImplementationOnce(async () => {
    setCurrent(null);
    throw { code: "auth/user-not-found" };
  });
  await validation.validate();
  expect(deps.signOut).not.toHaveBeenCalled();
  expect(deps.current()).toBeNull();
});

test("does not act on late results after unmount and cancels queued checks", async () => {
  const { validation, deps, setCurrent } = setup();
  const lookup = deferred();
  deps.reload.mockReturnValueOnce(lookup.promise);
  const pending = validation.validate();
  await Promise.resolve();
  setCurrent({ uid: "bob" });
  void validation.validate();
  validation.dispose();
  lookup.reject({ code: "auth/user-disabled" });
  await pending;
  await validation.validate();
  expect(deps.reload).toHaveBeenCalledOnce();
  expect(deps.signOut).not.toHaveBeenCalled();
});

test("allows another recovery attempt if local sign-out fails", async () => {
  const { validation, deps } = setup();
  deps.reload.mockRejectedValue({ code: "auth/user-not-found" });
  deps.signOut.mockRejectedValueOnce(new Error("Keychain unavailable"));
  await validation.validate();
  expect(deps.current()).not.toBeNull();
  await validation.validate();
  expect(deps.signOut).toHaveBeenCalledTimes(2);
  expect(deps.current()).toBeNull();
});
