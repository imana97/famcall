import { sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [buildNumber, version] = process.argv.slice(2);
if (!/^[1-9]\d*$/.test(buildNumber ?? '') || !/^\d+\.\d+\.\d+$/.test(version ?? ''))
  throw new Error('The exact iOS build and marketing version are required.');
const credential = JSON.parse(process.env.FAMCALL_APPLE_API_KEY_JSON ?? '{}');
if (credential.key_id !== '824PKL27T3' || credential.issuer_id !== 'c824ef09-93ae-4905-8efd-7c9280cf8731' || !credential.key)
  throw new Error('The protected App Store Connect credential is missing or unexpected.');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = encode({ alg: 'ES256', kid: credential.key_id, typ: 'JWT' }) + '.' +
    encode({ iss: credential.issuer_id, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  return unsigned + '.' + sign('sha256', Buffer.from(unsigned), { key: credential.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
async function api(path, method = 'GET', data) {
  const response = await fetch('https://api.appstoreconnect.apple.com' + path, {
    method, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify({ data }) } : {}),
  });
  if (!response.ok) throw new Error('App Store Connect ' + method + ' failed: ' + response.status);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

let build;
for (let attempt = 0; attempt < 60; attempt++) {
  const response = await api('/v1/apps/6831551843/builds?limit=50');
  const candidate = response.data.find(value => value.attributes.version === buildNumber);
  if (candidate) {
    const preRelease = await api('/v1/builds/' + candidate.id + '/preReleaseVersion');
    if (preRelease.data.attributes.version !== version) throw new Error('Unexpected TestFlight marketing version.');
    if (candidate.attributes.processingState === 'VALID') { build = candidate; break; }
    if (['INVALID', 'FAILED'].includes(candidate.attributes.processingState)) throw new Error('Apple rejected build processing.');
  }
  await new Promise(resolve => setTimeout(resolve, 10_000));
}
if (!build) throw new Error('The requested TestFlight build did not finish processing.');
if (build.attributes.usesNonExemptEncryption === null) {
  // This repeats the existing, approved standard-encryption answer in app.config.ts.
  await api('/v1/builds/' + build.id, 'PATCH', { type: 'builds', id: build.id, attributes: { usesNonExemptEncryption: false } });
}
const whatsNew = await readFile('store/metadata/en-US/beta/testflight_what_to_test.txt', 'utf8');
if (!whatsNew.trim() || whatsNew.length > 4000) throw new Error('Invalid TestFlight testing notes.');
const current = await api('/v1/builds/' + build.id + '/betaBuildLocalizations');
const existing = current.data.find(value => value.attributes.locale === 'en-US');
if (existing?.attributes.whatsNew !== whatsNew) {
  await api(existing ? '/v1/betaBuildLocalizations/' + existing.id : '/v1/betaBuildLocalizations', existing ? 'PATCH' : 'POST',
    existing ? { type: 'betaBuildLocalizations', id: existing.id, attributes: { whatsNew } } : {
      type: 'betaBuildLocalizations', attributes: { locale: 'en-US', whatsNew },
      relationships: { build: { data: { type: 'builds', id: build.id } } },
    });
}
const group = '081af94e-c957-4b1c-9060-2b8ea494b7ee';
const testers = await api('/v1/betaGroups/' + group + '/betaTesters');
if (!testers.data.some(value => value.attributes.email === 'iman.khaghani@gmail.com'))
  throw new Error('The expected testing owner is not in the existing group.');
let builds = await api('/v1/betaGroups/' + group + '/builds');
if (!builds.data.some(value => value.id === build.id)) {
  await api('/v1/betaGroups/' + group + '/relationships/builds', 'POST', [{ type: 'builds', id: build.id }]);
  builds = await api('/v1/betaGroups/' + group + '/builds');
}
const detail = await api('/v1/builds/' + build.id + '/buildBetaDetail');
const notes = await api('/v1/builds/' + build.id + '/betaBuildLocalizations');
if (!builds.data.some(value => value.id === build.id) || !notes.data.some(value => value.attributes.whatsNew === whatsNew) ||
    detail.data.attributes.internalBuildState !== 'IN_BETA_TESTING')
  throw new Error('TestFlight testing access is not yet active.');
console.log(JSON.stringify({ version, buildNumber, appleBuildId: build.id, processingState: 'VALID',
  internalBuildState: detail.data.attributes.internalBuildState, ownerGroupAssigned: true, testingNotesVerified: true }));
