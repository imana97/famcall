import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const plugin = require("../apps/mobile/plugins/withCallPermissions.js");

test("prebuild registers the call settings bridge once and refuses an unfamiliar application template", () => {
  const original = `class MainApplication {\n  val packages = PackageList(this).packages.apply {\n    add(ExistingPackage())\n  }\n}`;
  const modified = plugin.configureApplication(original);
  expect(modified).toContain("add(ExistingPackage())");
  expect(modified.match(/add\(com\.silvergridtech\.famcall\.permissions\.FamCallPermissionsPackage\(\)\)/g)).toHaveLength(1);
  expect(plugin.configureApplication(modified)).toBe(modified);
  expect(() => plugin.configureApplication("class DifferentTemplate {}")).toThrow(/registration block/);
});

test("prebuild includes the same reviewed native bridge for production and test app packages", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "famcall-call-permissions-"));
  try {
    const app = path.resolve("apps/mobile");
    await plugin.syncSource(app, directory);
    const source = await readFile(path.join(directory, "app/src/main/java/com/silvergridtech/famcall/permissions/FamCallPermissionsPackage.kt"), "utf8");
    expect(source).toBe(await readFile(path.join(app, "native/android/FamCallPermissionsPackage.kt"), "utf8"));
    expect(source).toContain('Uri.parse("package:${context.packageName}")');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
