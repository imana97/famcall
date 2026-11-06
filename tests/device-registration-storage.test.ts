import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ values: new Map<string, string>(), uuid: vi.fn(), write: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: mocks.uuid }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async (key: string) => mocks.values.get(key) ?? null,
  setItem: mocks.write,
} }));

beforeEach(() => {
  vi.resetModules();
  mocks.values.clear();
  mocks.uuid.mockReset().mockReturnValue("new-installation");
  mocks.write.mockReset().mockImplementation(async (key: string, value: string) => { mocks.values.set(key, value); });
});

test("orders concurrent preparations and continues the same installation after restart", async () => {
  let { prepareDeviceRegistration } = await import("../apps/mobile/src/services/deviceRegistrationStorage");
  expect(await Promise.all([prepareDeviceRegistration(), prepareDeviceRegistration()])).toEqual([
    { installationId: "new-installation", sequence: 1 },
    { installationId: "new-installation", sequence: 2 },
  ]);
  expect(mocks.uuid).toHaveBeenCalledOnce();
  vi.resetModules();
  ({ prepareDeviceRegistration } = await import("../apps/mobile/src/services/deviceRegistrationStorage"));
  expect(await prepareDeviceRegistration()).toEqual({ installationId: "new-installation", sequence: 3 });
});

test("preserves an existing installation and does not hand out an unpersisted sequence", async () => {
  mocks.values.set("famcall-installation", "existing-installation");
  const { prepareDeviceRegistration } = await import("../apps/mobile/src/services/deviceRegistrationStorage");
  mocks.write.mockRejectedValueOnce(new Error("storage full"));
  await expect(prepareDeviceRegistration()).rejects.toThrow("storage full");
  expect(mocks.values.has("famcall-device-registration")).toBe(false);
  expect(await prepareDeviceRegistration()).toEqual({ installationId: "existing-installation", sequence: 1 });
  expect(mocks.uuid).not.toHaveBeenCalled();
});
