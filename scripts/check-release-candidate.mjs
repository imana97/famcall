import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const candidate = JSON.parse(readFileSync(resolve(root, 'store/release/candidate.json')));
const platform = process.env.FAMCALL_PLATFORM;
if (!['android', 'ios'].includes(platform)) throw new Error('Choose one public store.');
if (candidate.status !== 'ready') throw new Error('Release evidence is not ready for owner review.');
if (!/^[a-f0-9]{40}$/.test(candidate.sourceCommit ?? '')) throw new Error('A tested source commit is required.');
if (!/^\d+\.\d+\.\d+$/.test(candidate.version ?? '')) throw new Error('Invalid release version.');
if (!/^\d+$/.test(String(candidate[platform + 'BuildNumber'] ?? ''))) throw new Error('An explicit tested build number is required.');
for (const check of ['twoWaySpeechAndPoorNetwork', 'interruptionAndRecovery', 'physicalAndroidAndIPhone',
  'backgroundPushAndAudioRoutes', 'productionAuthAndAppCheck', 'smsDailyLimit',
  'storePrivacyAndLegalDeclarations', 'releaseScreenshotsAndCopy']) {
  const evidence = candidate.checks[check];
  if (evidence?.result !== 'pass' || typeof evidence.reference !== 'string' || !evidence.reference.trim()) {
    throw new Error('Missing passing release evidence: ' + check);
  }
}
// Evidence can be committed after testing, but app/backend/build inputs must match.
execFileSync('git', ['merge-base', '--is-ancestor', candidate.sourceCommit, 'HEAD'], { cwd: root });
execFileSync('git', ['diff', '--exit-code', candidate.sourceCommit, 'HEAD', '--',
  'apps', 'packages', 'backend', 'package.json', 'package-lock.json', '.nvmrc',
  'firestore.rules', 'firestore.indexes.json', 'firebase.json', 'scripts/restore-android-signing.mjs',
  'scripts/restore-firebase-config.py'],
{ cwd: root, stdio: 'pipe' });
console.log(`Verified release record: ${platform} ${candidate.version}, build ${candidate[platform + 'BuildNumber']}.`);
