import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run only in the owner-approved release environment. Never log the payload.
const raw = process.env.FAMCALL_ANDROID_SIGNING_JSON;
if (!raw) throw new Error('The protected Android signing secret is missing.');
const value = JSON.parse(raw);
for (const key of ['keystoreBase64', 'keystorePassword', 'keyAlias', 'keyPassword']) {
  if (typeof value[key] !== 'string' || !value[key]) throw new Error('Incomplete Android signing configuration.');
}
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, '.local/android-signing'), { recursive: true, mode: 0o700 });
await writeFile(resolve(root, '.local/android-signing/upload.jks'), Buffer.from(value.keystoreBase64, 'base64'), { mode: 0o600 });
await writeFile(resolve(root, 'apps/mobile/credentials.json'), JSON.stringify({ android: { keystore: {
  keystorePath: '../../.local/android-signing/upload.jks',
  keystorePassword: value.keystorePassword,
  keyAlias: value.keyAlias,
  keyPassword: value.keyPassword,
} } }), { mode: 0o600 });
console.log('Android signing files restored for this protected build.');
