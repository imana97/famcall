import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const platform = process.env.FAMCALL_PLATFORM;
if (!['all', 'android', 'ios'].includes(platform)) throw new Error('Choose a store platform.');
const root = resolve(import.meta.dirname, '..', '.local', 'store-access');
await mkdir(root, { recursive: true, mode: 0o700 });
if (platform !== 'android') {
  const raw = process.env.FAMCALL_APPLE_API_KEY_JSON;
  if (!raw) throw new Error('The protected App Store Connect credential is missing.');
  const apple = JSON.parse(raw);
  if (apple.key_id !== '824PKL27T3' || apple.issuer_id !== 'c824ef09-93ae-4905-8efd-7c9280cf8731' ||
      typeof apple.key !== 'string' || !apple.key.startsWith('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('App Store Connect credential does not match the submission profile.');
  }
  await writeFile(resolve(root, 'AuthKey.p8'), apple.key, { mode: 0o600 });
}
if (platform !== 'ios') {
  const raw = process.env.FAMCALL_PLAY_API_KEY_JSON;
  if (!raw) throw new Error('The protected Google Play publisher credential is missing.');
  const play = JSON.parse(raw);
  if (play.type !== 'service_account' || !play.client_email || !play.private_key) {
    throw new Error('Invalid Google Play publisher credential.');
  }
  await writeFile(resolve(root, 'play-credentials.json'), raw, { mode: 0o600 });
}
console.log('Store access files restored for this protected submission.');
