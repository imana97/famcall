import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const maestro = process.env.MAESTRO_BIN ?? 'maestro';
const folder = resolve(root, '.local/audio-lab/matrix-' + new Date().toISOString().replaceAll(':', '-'));
await mkdir(folder, { recursive: true });
const reference = resolve(folder, 'reference.wav');
await copyFile(resolve(root, '.local/audio-source.wav'), reference);
const files = ['e2e/audio/measure.py', 'e2e/audio/evidence.py', 'scripts/run-audio-matrix.mjs', 'scripts/restart-lab-emulators.mjs', 'scripts/audio-lab.mjs'];
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
const referenceSha256 = createHash('sha256').update(await readFile(reference)).digest('hex');
const sdk = process.env.ANDROID_HOME ?? resolve(homedir(), 'Library/Android/sdk');
const adb = resolve(sdk, 'platform-tools/adb');
const command = (bin, args) => execFileSync(bin, args, { cwd: root, encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
await writeFile(resolve(folder, 'provenance.json'), JSON.stringify({
  capturedAt: new Date().toISOString(), workspaceBaseCommit: command('git', ['rev-parse', 'HEAD']),
  uncommittedChanges: Boolean(command('git', ['status', '--porcelain'])),
  node: process.version, files: hashes, referenceSha256,
  emulator: command(process.env.FAMCALL_EMULATOR_BIN ?? resolve(sdk, 'emulator/emulator'), ['-version']).split('\n')[0],
  scope: 'Workspace commit is context only; each profile records the actual installed APK hash.',
}, null, 2) + '\n');
// Each endpoint's relay leg is impaired independently, in each direction.
// These are not end-to-end RTT or loss percentages; inspect measured counters.
const profiles = [
  { name: 'baseline', loss: 0, delayMs: 0, jitterMs: 0, kbps: 0 },
  { name: 'modest', loss: 0.005, delayMs: 35, jitterMs: 10, kbps: 128 },
  { name: 'weak', loss: 0.0151, delayMs: 75, jitterMs: 25, kbps: 64 },
  { name: 'stress', loss: 0.03, delayMs: 150, jitterMs: 50, kbps: 48 },
];
const configure = async config => {
  const r = await fetch('http://127.0.0.1:8787/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
  if (!r.ok) throw new Error('Lab configuration failed.');
};
const baseline = { transport: 'udp', proxy: true, loss: 0, delayMs: 0, jitterMs: 0, kbps: 0 };
let interrupted;
let activeChild;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => {
  interrupted = signal;
  process.exitCode = code;
  activeChild?.kill(signal);
});
async function run(command, args, logName) {
  if (interrupted) throw new Error('Matrix interrupted by ' + interrupted);
  const log = await open(resolve(folder, logName + '.log'), 'w');
  try {
    return await new Promise(done => {
      const child = spawn(command, args, { cwd: root, stdio: ['ignore', log.fd, log.fd] });
      activeChild = child;
      child.once('exit', code => done(code ?? 1));
      child.once('error', () => done(1));
    });
  } finally { activeChild = null; await log.close(); }
}
async function flow(peer, name, prefix) {
  const result = await run(maestro, ['--device', peer === 'a' ? 'emulator-5554' : 'emulator-5556',
    'test', resolve(root, 'e2e/maestro', name + '.yaml')], prefix + '-' + peer + '-' + name);
  if (result) throw new Error('Maestro failed: ' + peer + '/' + name + '; inspect ' + folder);
}
let failed = 0;
const results = [];
try {
  for (const { name, ...config } of profiles) {
    console.log('Starting fresh emulator pair for ' + name);
    await configure(baseline);
    if (await run(process.execPath, [resolve(root, 'scripts/restart-lab-emulators.mjs')], name + '-boot'))
      throw new Error('Emulator restart failed; inspect ' + folder);
    const devices = ['emulator-5554', 'emulator-5556'].map(serial => {
      const apk = command(adb, ['-s', serial, 'shell', 'pm', 'path', 'com.silvergridtech.famcall.e2e']).split('\n')[0].replace('package:', '').trim();
      return { serial, api: command(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk']),
        systemBuild: command(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.fingerprint']),
        installedApkSha256: command(adb, ['-s', serial, 'shell', 'sha256sum', apk]).split(/\s/)[0] };
    });
    await writeFile(resolve(folder, name + '-devices.json'), JSON.stringify(devices, null, 2) + '\n');
    for (const peer of ['a', 'b']) await flow(peer, 'open-people', name);
    await configure({ ...baseline, ...config });
    await flow('a', 'start-call', name);
    await flow('b', 'answer-call', name);
    try {
      await new Promise(r => setTimeout(r, 5000));
      for (const [direction, sender, receiver] of [['a-to-b', 8554, 8556], ['b-to-a', 8556, 8554]]) {
        console.log('Measuring ' + name + '/' + direction);
        const output = resolve(folder, name + '-' + direction + '.json');
        const status = await run(resolve(root, '.local/audio-venv/bin/python'), [resolve(root, 'e2e/audio/measure.py'),
          '--buffered', '--source', reference, '--sender', String(sender), '--receiver', String(receiver), '--seconds', '30', '--output', output], name + '-' + direction);
        if (status !== 0) failed++;
        let report;
        try { report = JSON.parse(await readFile(output, 'utf8')); } catch { /* Failed before report creation. */ }
        results.push({ profile: name, direction, config, status, measurementValid: report?.measurementValid ?? false,
          stoi: report?.stoi ?? null, invalidReasons: report?.invalidReasons ?? ['No measurement report'] });
      }
    } finally {
      await configure(baseline);
      if (!interrupted) {
        await flow('a', 'end-call', name);
        await flow('b', 'dismiss-ended', name);
      }
    }
  }
} finally {
  await configure(baseline);
  await writeFile(resolve(folder, 'summary.json'), JSON.stringify({
    scope: 'Pilot samples, one per direction/profile; valid measurement is not a release-quality pass.',
    interrupted: interrupted ?? null, results,
  }, null, 2) + '\n');
}
console.log('Audio matrix evidence: ' + folder);
if (failed) process.exitCode = 1;
