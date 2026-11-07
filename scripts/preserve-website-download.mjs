import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { packageName, signingCertificate, validateApk } from './download-play-apk.mjs';

// Ordinary hosting updates must retain the last explicitly published APK.
const root = 'https://famcall.web.app/downloads/';
const response = await fetch(root + 'release.json', { cache: 'no-store' });
if (response.status === 404) {
  console.log('No existing APK download to preserve.');
} else {
  if (!response.ok) throw new Error('Cannot verify the existing download; website deployment stopped.');
  const release = await response.json();
  if (release.packageName !== packageName || release.signingCertificateSha256 !== signingCertificate ||
      !/^\d+\.\d+\.\d+$/.test(release.version) || !/^[1-9]\d*$/.test(release.versionCode) ||
      !/^[a-f0-9]{64}$/.test(release.sha256) || release.url !== '/downloads/famcall.apk')
    throw new Error('Unexpected website download metadata.');
  const download = await fetch(root + 'famcall.apk', { cache: 'no-store' });
  if (!download.ok) throw new Error('Could not preserve the published APK.');
  const apk = Buffer.from(await download.arrayBuffer());
  if (apk.length !== release.bytes || createHash('sha256').update(apk).digest('hex') !== release.sha256)
    throw new Error('Published APK checksum mismatch.');
  const output = resolve('website/downloads');
  await mkdir(output, { recursive: true });
  const apkPath = resolve(output, 'famcall.apk');
  await writeFile(apkPath, apk);
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('Android SDK is required to verify the preserved APK.');
  const versions = (await readdir(resolve(sdk, 'build-tools'))).filter(value => /^\d+\.\d+\.\d+$/.test(value))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error('Android verification tools are missing.');
  const tools = resolve(sdk, 'build-tools', versions.at(-1));
  validateApk(
    execFileSync(resolve(tools, 'aapt2'), ['dump', 'badging', apkPath], { encoding: 'utf8' }),
    execFileSync(resolve(tools, 'apksigner'), ['verify', '--print-certs', apkPath], { encoding: 'utf8' }),
    release.versionCode, release.version,
  );
  await writeFile(resolve(output, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  await writeFile(resolve(output, 'famcall.apk.sha256'), release.sha256 + '  famcall.apk\n');
  console.log('Preserved verified FamCall ' + release.version + ' APK for this website deployment.');
}
