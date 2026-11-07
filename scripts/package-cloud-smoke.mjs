import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const lifecycle = process.argv.includes('--lifecycle');
const paired = lifecycle || process.argv.includes('--paired-call');
const files = [
  'e2e/cloud/signup-and-contacts.yaml',
  'e2e/cloud/read-emulator-code.js',
  'e2e/cloud/validate-inputs.js',
  'e2e/maestro/start-signin.yaml',
  'e2e/maestro/verify.yaml',
  'e2e/maestro/add-person.yaml',
  'e2e/maestro/open-people.yaml',
  ...(paired ? [
    'e2e/cloud/call-event.js',
    'e2e/cloud/call-caller.yaml',
    'e2e/cloud/call-callee.yaml',
    'e2e/maestro/wait-connected.yaml',
    'e2e/maestro/end-call.yaml',
  ] : []),
  ...(lifecycle ? [
    'e2e/cloud/lifecycle-caller.yaml',
    'e2e/cloud/lifecycle-callee.yaml',
    'e2e/maestro/cancel-starting-call.yaml',
    'e2e/maestro/block-history.yaml',
    'e2e/maestro/unblock.yaml',
  ] : []),
];
const destination = resolve(root, '.local/cloud-testing');
await mkdir(destination, { recursive: true, mode: 0o700 });
const temporary = await mkdtemp(resolve(tmpdir(), 'famcall-cloud-suite-'));
const suiteName = lifecycle ? 'lifecycle' : paired ? 'call' : 'smoke';
const archive = resolve(destination, 'famcall-cloud-' + suiteName + '.zip');
const hashes = {};
try {
  for (const file of files) {
    const source = resolve(root, file);
    const target = resolve(temporary, 'famcall', file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    hashes[file] = createHash('sha256').update(await readFile(source)).digest('hex');
  }
  const zip = resolve(temporary, 'suite.zip');
  execFileSync('zip', ['-q', '-X', zip, ...files.map(file => 'famcall/' + file)], { cwd: temporary });
  const members = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n').sort();
  if (JSON.stringify(members) !== JSON.stringify(files.map(file => 'famcall/' + file).sort())) {
    throw new Error('Cloud archive contains unexpected files.');
  }
  await copyFile(zip, archive);
  const manifest = {
    createdAt: new Date().toISOString(),
    archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
    files: hashes,
    execute: lifecycle ? ['e2e/cloud/lifecycle-caller.yaml', 'e2e/cloud/lifecycle-callee.yaml'] :
      paired ? ['e2e/cloud/call-caller.yaml', 'e2e/cloud/call-callee.yaml'] : 'e2e/cloud/signup-and-contacts.yaml',
    cloudExecuted: false,
  };
  await writeFile(resolve(destination, suiteName + '-suite-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ archive, sha256: manifest.archiveSha256, fileCount: members.length, cloudExecuted: false }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
