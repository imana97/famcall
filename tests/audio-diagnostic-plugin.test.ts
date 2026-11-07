import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const plugin = require("../apps/mobile/plugins/withAudioRecordDiagnostics.js");

test("recording diagnostics reject production and remove generated code when disabled", async () => {
  expect(() => plugin({ android: { package: "com.silvergridtech.famcall" } }, { enabled: true })).toThrow(/e2e package/);
  const original = "class MainApplication {\n  fun onCreate() {\n    loadReactNative(this)\n  }\n}\n";
  const enabled = plugin.configureApplication(original, true);
  expect(enabled).toContain("FamCallAudioRecordDiagnostics.install(this)");
  expect(plugin.configureApplication(enabled, true)).toBe(enabled);
  expect(plugin.configureApplication(enabled, false)).toBe(original);
  const root = await mkdtemp(join(tmpdir(), "famcall-audio-diagnostic-"));
  try {
    await mkdir(join(root, "native/android"), { recursive: true });
    await writeFile(join(root, "native/android/FamCallAudioRecordDiagnostics.kt"), "test diagnostic source");
    const target = join(root, "android/app/src/main/java/com/silvergridtech/famcall/diagnostics/FamCallAudioRecordDiagnostics.kt");
    await plugin.syncSource(root, join(root, "android"), true);
    expect(await readFile(target, "utf8")).toBe("test diagnostic source");
    await plugin.syncSource(root, join(root, "android"), false);
    await expect(access(target)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recording diagnostic insertion fails if native initialization cannot be identified", () => {
  expect(() => plugin.configureApplication("class ChangedTemplate {}", true)).toThrow(/initialization point/);
  expect(() => plugin.configureApplication("    // FamCall audio recording diagnostics begin\n", false)).toThrow(/Incomplete/);
});
