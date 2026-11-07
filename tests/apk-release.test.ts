import { expect, test } from "vitest";
import { packageName, registeredCertificates, selectUniversalApk, signingCertificate, validateApk } from "../scripts/download-play-apk.mjs";

const badging = `package: name='${packageName}' versionCode='6' versionName='0.2.0' platformBuildVersionName='16'`;
const certificate = `Signer #1 certificate SHA-256 digest: ${signingCertificate}`;

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
