import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DeviceRegistration, type PushToken } from "../apps/mobile/src/services/DeviceRegistration";

const oldToken: PushToken = { token: "old-native-push-token", type: "FCM" };
const newToken: PushToken = { token: "new-native-push-token", type: "FCM" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  let current = true;
  let native: PushToken | null = oldToken;
  const deps = {
    current: () => current,
    registerNative: vi.fn(),
    readToken: vi.fn(() => native),
    prepare: vi.fn(async () => ({ installationId: "installation-one", sequence: 1 })),
    send: vi.fn(async (_data: unknown) => ({})),
    error: vi.fn(),
  };
  const registration = new DeviceRegistration("alice", deps);
  return { registration, deps, setCurrent: (value: boolean) => { current = value; },
    setNative: (value: PushToken | null) => { native = value; registration.update(value); } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

test("retries an offline upload without another token event and stops after success", async () => {
  const { registration, deps } = setup();
  deps.send.mockRejectedValueOnce(new Error("offline"));
  registration.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.send).toHaveBeenCalledOnce();
  registration.update(oldToken);
  registration.update(oldToken);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(deps.send).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.send).toHaveBeenCalledTimes(2);
  expect(deps.prepare).toHaveBeenCalledOnce();
  expect(deps.send).toHaveBeenLastCalledWith({ ...oldToken, userId: "alice", installationId: "installation-one", sequence: 1 });
  await vi.advanceTimersByTimeAsync(120_000);
  registration.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.send).toHaveBeenCalledTimes(2);
  registration.dispose();
});

test("bounds background retries and resumes on a connectivity or foreground refresh", async () => {
  const { registration, deps } = setup();
  deps.send.mockRejectedValue(new Error("offline"));
  registration.start();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(deps.send).toHaveBeenCalledTimes(5);
  expect(vi.getTimerCount()).toBe(0);
  deps.send.mockResolvedValue({});
  registration.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.send).toHaveBeenCalledTimes(6);
  registration.dispose();
});

test("serializes rotation during an upload so the newest token is written last", async () => {
  const { registration, deps, setNative } = setup();
  const first = deferred<object>();
  deps.send.mockReturnValueOnce(first.promise);
  deps.prepare.mockResolvedValueOnce({ installationId: "installation-one", sequence: 1 })
    .mockResolvedValueOnce({ installationId: "installation-one", sequence: 2 });
  registration.start();
  await vi.advanceTimersByTimeAsync(0);
  setNative(newToken);
  registration.refresh();
  expect(deps.send).toHaveBeenCalledOnce();
  first.resolve({});
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.send.mock.calls.map(([data]) => (data as PushToken).token)).toEqual([oldToken.token, newToken.token]);
  expect(deps.send).toHaveBeenLastCalledWith({ ...newToken, userId: "alice", installationId: "installation-one", sequence: 2 });
  expect(vi.getTimerCount()).toBe(0);
  registration.dispose();
});

test("uses only the replacement token when a pending upload fails", async () => {
  const { registration, deps, setNative } = setup();
  const first = deferred<object>();
  deps.send.mockReturnValueOnce(first.promise);
  registration.start();
  await vi.advanceTimersByTimeAsync(0);
  setNative(newToken);
  first.reject(new Error("old request lost"));
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.send.mock.calls.map(([data]) => (data as PushToken).token)).toEqual([oldToken.token, newToken.token]);
  expect(deps.error).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  registration.dispose();
});

test("drops stale tokens while storage is pending and delivers a newly available native token", async () => {
  const { registration, deps, setNative } = setup();
  const stored = deferred<{ installationId: string; sequence: number }>();
  deps.prepare.mockReturnValueOnce(stored.promise);
  registration.start();
  setNative(newToken);
  stored.resolve({ installationId: "installation-one", sequence: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.send).toHaveBeenCalledOnce();
  expect(deps.send).toHaveBeenLastCalledWith({ ...newToken, userId: "alice", installationId: "installation-one", sequence: 1 });
  registration.dispose();

  const missing = setup();
  missing.setNative(null);
  missing.registration.start();
  missing.setNative(newToken);
  await vi.advanceTimersByTimeAsync(0);
  expect(missing.deps.send).toHaveBeenCalledOnce();
  missing.registration.dispose();
});

test("does not upload after an account change or schedule work after disposal", async () => {
  const { registration, deps, setCurrent } = setup();
  const stored = deferred<{ installationId: string; sequence: number }>();
  deps.prepare.mockReturnValueOnce(stored.promise);
  registration.start();
  setCurrent(false);
  stored.resolve({ installationId: "installation-one", sequence: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.send).not.toHaveBeenCalled();
  registration.dispose();
  registration.start();
  registration.refresh();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(deps.send).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);

  const pending = setup();
  const upload = deferred<object>();
  pending.deps.send.mockReturnValueOnce(upload.promise);
  pending.registration.start();
  await vi.advanceTimersByTimeAsync(0);
  pending.registration.dispose();
  upload.reject(new Error("late failure"));
  await vi.advanceTimersByTimeAsync(600_000);
  expect(pending.deps.send).toHaveBeenCalledOnce();
  expect(pending.deps.error).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("recovers native-token and installation-storage failures without duplicate uploads", async () => {
  const { registration, deps } = setup();
  deps.readToken.mockImplementationOnce(() => { throw new Error("token unavailable"); });
  deps.prepare.mockRejectedValueOnce(new Error("storage unavailable"));
  registration.start();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(deps.send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(deps.send).toHaveBeenCalledOnce();
  expect(deps.error).toHaveBeenCalledTimes(2);
  registration.dispose();
});
