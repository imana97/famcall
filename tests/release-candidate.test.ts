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
    copyFileSync(resolve("scripts/release-candidate.mjs"), join(root, "scripts/release-candidate.mjs"));
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
    const candidate = { status: "ready", sourceCommit: git("rev-parse", "HEAD"), version: "0.1.0", iosBuildNumber: "7", androidBuildNumber: "8", checks };
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
    expect(validate().stderr).toContain("Unresolved release evidence");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { describe, it } from 'vitest';
// @ts-expect-error The dependency-free workflow helper is ESM JavaScript.
import { requiredChecks, runtimeChecks, validateReleaseCandidate } from '../scripts/release-candidate.mjs';
function fixture() {
  const sourceCommit='a'.repeat(40), reference='store/release/owner-report.json';
  const candidate={status:'ready',version:'0.3.0',sourceCommit,iosBuildNumber:6,androidBuildNumber:7,
    ownerAcceptanceReference:reference,checks:Object.fromEntries(requiredChecks.map((key:string)=>[key,{result:'pass',reference:'evidence.json'}]))};
  const owner={owner:'silvergrid',testingConfirmed:true,publicSubmissionAuthorized:true,version:'0.3.0',sourceCommit,
    buildNumbers:{ios:6,android:7},scopeLimit:'Owner tested; detailed physical/network matrix is not inferred.'};
  return {candidate,owner,reference};
}
describe('public release evidence',()=>{
  it('accepts measured evidence for either exact store build',()=>{const{candidate}=fixture();for(const os of ['ios','android'])expect(()=>validateReleaseCandidate(candidate,os)).not.toThrow();});
  it('retains explicit owner acceptance without labeling unreported scenarios as passed tests',()=>{const{candidate,owner,reference}=fixture();for(const key of runtimeChecks)candidate.checks[key]={result:'owner-accepted',reference};expect(()=>validateReleaseCandidate(candidate,'ios',owner)).not.toThrow();});
  it('rejects incomplete preparation',()=>{const{candidate}=fixture();candidate.status='not-ready';expect(()=>validateReleaseCandidate(candidate,'ios')).toThrow('not ready');});
  it('requires a matching, authorized owner report for accepted runtime checks',()=>{const{candidate,owner,reference}=fixture();candidate.checks.backgroundPushAndAudioRoutes={result:'owner-accepted',reference};for(const bad of [undefined,{...owner,owner:'someone-else'},{...owner,testingConfirmed:false},{...owner,publicSubmissionAuthorized:false},{...owner,version:'0.2.0'},{...owner,sourceCommit:'b'.repeat(40)},{...owner,buildNumbers:{ios:5,android:7}},{...owner,scopeLimit:''}])expect(()=>validateReleaseCandidate(candidate,'ios',bad)).toThrow();});
  it('does not use owner acceptance to bypass quota, privacy or asset evidence',()=>{for(const key of ['smsDailyLimit','storePrivacyAndLegalDeclarations','releaseScreenshotsAndCopy']){const{candidate,owner,reference}=fixture();candidate.checks[key]={result:'owner-accepted',reference};expect(()=>validateReleaseCandidate(candidate,'ios',owner)).toThrow(key);}});
  it('does not accept an unrelated owner-evidence reference',()=>{const{candidate,owner}=fixture();candidate.checks.physicalAndroidAndIPhone={result:'owner-accepted',reference:'other.json'};expect(()=>validateReleaseCandidate(candidate,'android',owner)).toThrow();});
  it('rejects missing evidence even with owner approval',()=>{const{candidate,owner}=fixture();delete candidate.checks.smsDailyLimit;expect(()=>validateReleaseCandidate(candidate,'ios',owner)).toThrow();});
  it('keeps each store’s disclosure readiness independent',()=>{const{candidate}=fixture();candidate.checks.storePrivacyAndLegalDeclarations={platforms:{ios:{result:'pass',reference:'apple.json'},android:{result:'pending',reference:'play.json'}}};expect(()=>validateReleaseCandidate(candidate,'ios')).not.toThrow();expect(()=>validateReleaseCandidate(candidate,'android')).toThrow('storePrivacyAndLegalDeclarations');});
  it('can prepare an Android draft with pending declarations without enabling final submission',()=>{const{candidate}=fixture();candidate.status='not-ready';candidate.checks.storePrivacyAndLegalDeclarations={result:'pending',reference:'pending-declarations.json'};expect(()=>validateReleaseCandidate(candidate,'android',undefined,{initialAndroidDraft:true})).not.toThrow();expect(()=>validateReleaseCandidate(candidate,'android')).toThrow('not ready');expect(()=>validateReleaseCandidate(candidate,'ios',undefined,{initialAndroidDraft:true})).toThrow();});
  it('still requires quota and asset evidence before preparing a draft',()=>{for(const key of ['smsDailyLimit','releaseScreenshotsAndCopy']){const{candidate}=fixture();candidate.status='not-ready';candidate.checks[key]={result:'pending',reference:'pending.json'};expect(()=>validateReleaseCandidate(candidate,'android',undefined,{initialAndroidDraft:true})).toThrow(key);}});
  it('does not prepare a draft with failed or missing legal evidence',()=>{for(const evidence of [{result:'failed',reference:'failed.json'},{result:'pending',reference:''}]){const{candidate}=fixture();candidate.checks.storePrivacyAndLegalDeclarations=evidence;expect(()=>validateReleaseCandidate(candidate,'android',undefined,{initialAndroidDraft:true})).toThrow();}});
  it('rejects invalid platform and nonpositive build numbers',()=>{const{candidate}=fixture();expect(()=>validateReleaseCandidate(candidate,'web')).toThrow();for(const value of [0,-1,'',null])expect(()=>validateReleaseCandidate({...candidate,iosBuildNumber:value},'android')).toThrow();});
});
