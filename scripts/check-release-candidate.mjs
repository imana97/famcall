import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { validateReleaseCandidate } from './release-candidate.mjs';

const root = resolve(import.meta.dirname, '..');
const candidate = JSON.parse(readFileSync(resolve(root, 'store/release/candidate.json')));
const platform = process.env.FAMCALL_PLATFORM;
const initialAndroidDraft = process.env.FAMCALL_INITIAL_PUBLIC_DRAFT === 'true';
if (initialAndroidDraft && platform !== 'android')
  throw new Error('Initial production drafts apply only to Google Play.');
let ownerReport;
if (candidate.ownerAcceptanceReference) {
  const evidenceFile = resolve(root, candidate.ownerAcceptanceReference);
  if (!evidenceFile.startsWith(root + '/store/release/')) throw new Error('Owner evidence must be in the release records.');
  ownerReport = JSON.parse(readFileSync(evidenceFile, 'utf8'));
}
validateReleaseCandidate(candidate, platform, ownerReport, { initialAndroidDraft });
// Evidence can be committed after testing, but app/backend/build inputs must match.
execFileSync('git', ['merge-base', '--is-ancestor', candidate.sourceCommit, 'HEAD'], { cwd: root });
execFileSync('git', ['diff', '--exit-code', candidate.sourceCommit, 'HEAD', '--',
  'apps', 'packages', 'backend', 'package.json', 'package-lock.json', '.nvmrc',
  'firestore.rules', 'firestore.indexes.json', 'firebase.json', 'scripts/restore-android-signing.mjs',
  'scripts/restore-firebase-config.py'],
{ cwd: root, stdio: 'pipe' });
console.log(`Verified ${initialAndroidDraft ? 'unsubmitted production draft' : 'release'} record: ${platform} ${candidate.version}, build ${candidate[platform + 'BuildNumber']}.`);
