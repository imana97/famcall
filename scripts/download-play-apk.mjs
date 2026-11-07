import { createHash, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageName = 'com.silvergridtech.famcall';
// The existing Google Play app-signing certificate, also registered with Firebase.
export const signingCertificate = 'a396534ac88e52831867135c9c656d37d0f40880dde540e769f08a0cc18a8205';
export const registeredCertificates = [signingCertificate,
  'df602b7e26d9d7c795e6d3126d8ec13e2fbaf2081fdfb9c68a2fa8c18eb94d60',
  '22991947705dcb0e8710d5e6996637abae6cb53024500d37594f8678586578a4'];
const normalized = value => String(value).replaceAll(':', '').toLowerCase();

export function selectUniversalApk(response) {
  const matching = response.generatedApks?.filter(group =>
    normalized(group.certificateSha256Hash) === signingCertificate && group.generatedUniversalApk?.downloadId);
  if (matching?.length !== 1) throw new Error('Expected one universal APK signed by the registered Play certificate.');
  return matching[0].generatedUniversalApk.downloadId;
}

export function validateApk(badging, certificates, versionCode, version) {
  const match = badging.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);
  if (!match || match[1] !== packageName || match[2] !== versionCode || match[3] !== version)
    throw new Error('The downloaded APK package or version does not match the requested release.');
  if (/application-debuggable/.test(badging)) throw new Error('A debug APK cannot be published.');
  // New Play APKs include registered Android 37 hybrid signing certificates.
  // The Play source stamp is provenance metadata, not an app-signing identity.
  const signers = [...certificates.matchAll(/^(?!Source Stamp).*Signer.*certificate SHA-256 digest: ([a-fA-F0-9:]+)$/gm)]
    .map(match => normalized(match[1]));
  if (!signers.includes(signingCertificate) || signers.some(value => !registeredCertificates.includes(value)))
    throw new Error('The downloaded APK signing certificate is not the registered Play certificate.');
}

async function publisherToken(raw) {
  const credential = JSON.parse(raw ?? '{}');
  if (credential.client_email !== 'famcall-play-publisher@famcall.iam.gserviceaccount.com' || !credential.private_key)
    throw new Error('The protected FamCall publisher credential is missing or unexpected.');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
    iss: credential.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600,
  });
  const assertion = payload + '.' + sign('RSA-SHA256', Buffer.from(payload), credential.private_key).toString('base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error('Publisher authentication failed: ' + response.status);
  return (await response.json()).access_token;
}

async function main() {
  const [versionCode, version, destination = 'website/downloads'] = process.argv.slice(2);
  if (!/^[1-9]\d*$/.test(versionCode ?? '') || !/^\d+\.\d+\.\d+$/.test(version ?? ''))
    throw new Error('Provide the exact Play version code and marketing version.');
  if (!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')) throw new Error('Release source commit is required.');
  const token = await publisherToken(process.env.FAMCALL_PLAY_API_KEY_JSON);
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}`;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  async function api(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Play API ${method} failed: ${response.status}`);
    return response.status === 204 ? {} : response.json();
  }
  // Inspect a temporary edit without committing any change to the store.
  const edit = await api('/edits', 'POST', {});
  try {
    const track = await api(`/edits/${edit.id}/tracks/internal`);
    if (!track.releases?.some(release => release.status === 'completed' && release.versionCodes?.includes(versionCode)))
      throw new Error('This exact build is not yet active in internal testing.');
  } finally { await api(`/edits/${edit.id}`, 'DELETE'); }

  const downloadId = selectUniversalApk(await api(`/generatedApks/${versionCode}`));
  const response = await fetch(`${base}/generatedApks/${versionCode}/downloads/${encodeURIComponent(downloadId)}:download?alt=media`, { headers });
  if (!response.ok) throw new Error('Play-signed APK download failed: ' + response.status);
  const apk = Buffer.from(await response.arrayBuffer());
  if (apk.length < 100_000 || apk.readUInt32LE(0) !== 0x04034b50) throw new Error('Download is not an APK archive.');
  const output = resolve(destination);
  await mkdir(output, { recursive: true });
  const apkPath = resolve(output, 'famcall.apk');
  await writeFile(apkPath, apk);
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('Android SDK is required for signature and package verification.');
  const versions = (await readdir(resolve(sdk, 'build-tools'))).filter(value => /^\d+\.\d+\.\d+$/.test(value))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error('Android build tools are missing.');
  const tools = resolve(sdk, 'build-tools', versions.at(-1));
  validateApk(
    execFileSync(resolve(tools, 'aapt2'), ['dump', 'badging', apkPath], { encoding: 'utf8' }),
    execFileSync(resolve(tools, 'apksigner'), ['verify', '--print-certs', apkPath], { encoding: 'utf8' }),
    versionCode, version,
  );
  const sha256 = createHash('sha256').update(apk).digest('hex');
  const release = { version, versionCode, packageName, sha256, bytes: apk.length, signingCertificateSha256: signingCertificate,
    sourceCommit: process.env.GITHUB_SHA, url: '/downloads/famcall.apk', publishedAt: new Date().toISOString() };
  await writeFile(resolve(output, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  await writeFile(resolve(output, 'famcall.apk.sha256'), sha256 + '  famcall.apk\n');
  console.log(JSON.stringify(release));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
