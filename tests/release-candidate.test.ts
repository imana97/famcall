import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("public release rejects app changes made after the recorded test commit", () => {
  const root = mkdtempSync(join(tmpdir(), "famcall-release-"));
  try {
    for (const dir of ["scripts", "store/release", "apps/mobile"])
      mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(resolve("scripts/check-release-candidate.mjs"), join(root, "scripts/check-release-candidate.mjs"));
    writeFileSync(join(root, "apps/mobile/source.txt"), "tested source\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "--quiet");
    git("add", ".");
    git("-c", "user.name=Release test", "-c", "user.email=release-test@example.invalid", "commit", "--quiet", "-m", "Tested source");
    const checks = Object.fromEntries([
      "twoWaySpeechAndPoorNetwork", "interruptionAndRecovery", "physicalAndroidAndIPhone",
      "backgroundPushAndAudioRoutes", "productionAuthAndAppCheck", "smsDailyLimit",
      "storePrivacyAndLegalDeclarations", "releaseScreenshotsAndCopy",
    ].map(key => [key, { result: "pass", reference: "test fixture only" }]));
    const candidate = { status: "ready", sourceCommit: git("rev-parse", "HEAD"), version: "0.1.0", iosBuildNumber: "7", checks };
    const save = () => writeFileSync(join(root, "store/release/candidate.json"), JSON.stringify(candidate));
    const validate = () => spawnSync(process.execPath, ["scripts/check-release-candidate.mjs"], {
      cwd: root, encoding: "utf8", env: { ...process.env, FAMCALL_PLATFORM: "ios" },
    });
    save();
    expect(validate().status).toBe(0);
    // Recording evidence after testing is allowed; changing the tested app is not.
    git("add", ".");
    git("-c", "user.name=Release test", "-c", "user.email=release-test@example.invalid", "commit", "--quiet", "-m", "Record evidence");
    expect(validate().status).toBe(0);
    writeFileSync(join(root, "apps/mobile/source.txt"), "untested change\n");
    git("add", ".");
    git("-c", "user.name=Release test", "-c", "user.email=release-test@example.invalid", "commit", "--quiet", "-m", "Untested app change");
    expect(validate().status).not.toBe(0);
    candidate.sourceCommit = git("rev-parse", "HEAD");
    candidate.checks.twoWaySpeechAndPoorNetwork.result = "pending";
    save();
    expect(validate().stderr).toContain("Missing passing release evidence");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
