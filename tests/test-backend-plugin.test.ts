import { createRequire } from "node:module";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const plugin = require("../apps/mobile/plugins/withTestBackend.js");

async function apply(appMode: string, emulatorHost: string | null, plist: object, bundle = "com.silvergridtech.famcall.e2e") {
  const config = plugin({ name: "FamCall", slug: "famcall", ios: { bundleIdentifier: bundle }, extra: { appMode, emulatorHost } });
  const result = await config.mods.ios.infoPlist({
    ...config,
    modResults: structuredClone(plist),
    modRequest: { platform: "ios", modName: "infoPlist", introspect: true },
  });
  return result.modResults;
}

test("reusing a cloud-test plist for production or local testing removes the tunnel exception", async () => {
  const original = { NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true } };
  const cloud = await apply("e2e", "bs-local.com", original);
  expect(cloud.NSAppTransportSecurity.NSExceptionDomains["bs-local.com"]).toEqual({
    NSExceptionAllowsInsecureHTTPLoads: true,
    NSIncludesSubdomains: false,
  });
  expect(await apply("production", null, cloud, "com.silvergridtech.famcall")).toEqual(original);
  expect(await apply("e2e", "127.0.0.1", cloud)).toEqual(original);
  expect(await apply("e2e", "bs-local.com", cloud)).toEqual(cloud);
});

test("the exception requires the separate test bundle and preserves unrelated ATS settings", async () => {
  await expect(apply("e2e", "bs-local.com", {}, "com.silvergridtech.famcall")).rejects.toThrow(/separate test app/);
  const unrelated = { "example.com": { NSExceptionMinimumTLSVersion: "TLSv1.3" } };
  const original = { NSAppTransportSecurity: { NSExceptionDomains: unrelated } };
  expect(await apply("production", "bs-local.com", original, "com.silvergridtech.famcall")).toEqual(original);
});
