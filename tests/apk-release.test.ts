import { expect, test } from "vitest";
import { packageName, registeredCertificates, selectUniversalApk, signingCertificate, validateApk } from "../scripts/download-play-apk.mjs";
import { validateArtifactSource } from "../scripts/check-apk-artifact-source.mjs";

const badging = `package: name='${packageName}' versionCode='6' versionName='0.2.0' platformBuildVersionName='16'`;
const certificate = `Signer #1 certificate SHA-256 digest: ${signingCertificate}`;

test("only deploys artifacts prepared successfully by the owner on the reviewed main branch", () => {
  const run = { repository: { full_name: "silvergrid/famcall" }, head_repository: { full_name: "silvergrid/famcall" },
    head_branch: "main", event: "workflow_dispatch", actor: { login: "silvergrid" }, triggering_actor: { login: "silvergrid" },
    path: ".github/workflows/apk-website.yml", head_sha: "a".repeat(40) };
  const jobs = { jobs: [{ name: "prepare", conclusion: "success" }] };
  expect(validateArtifactSource(run, jobs)).toBe(run.head_sha);
  for (const change of [{ actor: { login: "contributor" } }, { head_branch: "feature" }, { event: "pull_request" },
    { path: ".github/workflows/quality.yml" }, { head_repository: { full_name: "another/famcall" } }])
    expect(() => validateArtifactSource({ ...run, ...change }, jobs)).toThrow();
  expect(() => validateArtifactSource(run, { jobs: [{ name: "prepare", conclusion: "failure" }] })).toThrow();
});

test("only publishes a universal APK with the existing Play signing identity", () => {
  expect(selectUniversalApk({ generatedApks: [
    { certificateSha256Hash: "another-key", generatedUniversalApk: { downloadId: "wrong" } },
    { certificateSha256Hash: signingCertificate.toUpperCase().match(/../g)!.join(":"), generatedUniversalApk: { downloadId: "correct" } },
  ] })).toBe("correct");
  expect(() => selectUniversalApk({ generatedApks: [{ certificateSha256Hash: "another-key", generatedUniversalApk: { downloadId: "wrong" } }] })).toThrow();
  expect(() => selectUniversalApk({ generatedApks: [{ certificateSha256Hash: signingCertificate, generatedSplitApks: [{ downloadId: "split" }] }] })).toThrow();
});

test("rejects ambiguous generated APK metadata", () => {
  const group = { certificateSha256Hash: signingCertificate, generatedUniversalApk: { downloadId: "apk" } };
  expect(() => selectUniversalApk({ generatedApks: [group, group] })).toThrow();
});

test("accepts verified Android 37 hybrid signing identities while excluding the source stamp", () => {
  const modern = `V3.0 Signer: certificate SHA-256 digest: ${signingCertificate}\n` +
    `V3.2 Hybrid Classical Signer: (minSdkVersion=37) certificate SHA-256 digest: ${registeredCertificates[1]}\n` +
    `V3.2 Hybrid PQC Signer: (minSdkVersion=37) certificate SHA-256 digest: ${registeredCertificates[2]}\n` +
    'Source Stamp Signer: certificate SHA-256 digest: aabbcc';
  expect(() => validateApk(badging, modern, "6", "0.2.0")).not.toThrow();
  expect(() => validateApk(badging, modern.replace(registeredCertificates[1], "deadbeef"), "6", "0.2.0")).toThrow();
});

test("checks package, exact build/version, release mode and signing identity before publishing", () => {
  expect(() => validateApk(badging, certificate, "6", "0.2.0")).not.toThrow();
  for (const invalid of [badging.replace(packageName, "com.example.other"), badging.replace("versionCode='6'", "versionCode='5'"),
    badging.replace("versionName='0.2.0'", "versionName='0.1.0'"), badging + "\napplication-debuggable", "not an APK"]) {
    expect(() => validateApk(invalid, certificate, "6", "0.2.0")).toThrow();
  }
  expect(() => validateApk(badging, certificate.replace(signingCertificate, "012345"), "6", "0.2.0")).toThrow();
  expect(() => validateApk(badging, certificate + "\nSigner #2 certificate SHA-256 digest: 1234", "6", "0.2.0")).toThrow();
});
