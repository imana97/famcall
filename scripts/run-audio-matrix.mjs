import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { captureNativeLogs, captureAudioState } from './lab-log-capture.mjs';

const root = resolve(import.meta.dirname, '..');
const maestro = process.env.MAESTRO_BIN ?? 'maestro';
const outageMode = process.argv[2] === '--outages';
const requestedOutages = process.argv.slice(3).map(Number);
const requestedDirection = process.env.FAMCALL_AUDIO_DIRECTION;
const requestedProfiles = process.env.FAMCALL_AUDIO_PROFILES?.split(',');
const outageProfile = process.env.FAMCALL_OUTAGE_PROFILE ?? 'baseline';
const networkProfiles = [
  { name: 'baseline', loss: 0, delayMs: 0, jitterMs: 0, kbps: 0 },
  { name: 'modest', loss: 0.005, delayMs: 35, jitterMs: 10, kbps: 128 },
  { name: 'weak', loss: 0.0151, delayMs: 75, jitterMs: 25, kbps: 64 },
  { name: 'stress', loss: 0.03, delayMs: 150, jitterMs: 50, kbps: 48 },
];
if (!networkProfiles.some(profile => profile.name === outageProfile) || (!outageMode && process.env.FAMCALL_OUTAGE_PROFILE))
  throw new Error('FAMCALL_OUTAGE_PROFILE accepts baseline,modest,weak,stress in outage mode only.');
if (requestedProfiles && (outageMode || requestedProfiles.some(name => !['baseline', 'modest', 'weak', 'stress'].includes(name))))
  throw new Error('FAMCALL_AUDIO_PROFILES accepts comma-separated baseline,modest,weak,stress for fixed-profile runs only.');
const delivery = process.env.FAMCALL_AUDIO_DELIVERY ?? 'buffered';
const inputRate = Number(process.env.FAMCALL_AUDIO_INPUT_RATE ?? 48000);
const captureRate = Number(process.env.FAMCALL_AUDIO_CAPTURE_RATE ?? 48000);
if (![8000, 16000, 48000].includes(inputRate)) throw new Error('FAMCALL_AUDIO_INPUT_RATE must be 8000, 16000, or 48000.');
if (![8000, 16000, 48000].includes(captureRate)) throw new Error('FAMCALL_AUDIO_CAPTURE_RATE must be 8000, 16000, or 48000.');
if (!['buffered', 'realtime'].includes(delivery)) throw new Error('FAMCALL_AUDIO_DELIVERY must be buffered or realtime.');
if (requestedDirection && !['a-to-b', 'b-to-a'].includes(requestedDirection)) throw new Error('FAMCALL_AUDIO_DIRECTION must be a-to-b or b-to-a.');
const directions = [['a-to-b', 8554, 8556], ['b-to-a', 8556, 8554]].filter(([direction]) => !requestedDirection || direction === requestedDirection);
if (outageMode && requestedOutages.some(n => ![2, 5, 15, 30].includes(n))) throw new Error('Outages must be 2, 5, 15, or 30 seconds.');
if (process.argv[2] && !outageMode) throw new Error('Use no arguments for fixed profiles, or --outages [2 5 15 30].');
const folder = resolve(root, '.local/audio-lab/' + (outageMode ? 'recovery-' : 'matrix-') + new Date().toISOString().replaceAll(':', '-'));
await mkdir(folder, { recursive: true });
const reference = resolve(folder, 'reference.wav');
await copyFile(resolve(root, outageMode ? '.local/recovery-source.wav' : '.local/audio-source.wav'), reference);
const files = ['e2e/audio/measure.py', 'e2e/audio/evidence.py', 'e2e/audio/recovery.py', 'scripts/run-audio-matrix.mjs', 'scripts/restart-lab-emulators.mjs', 'scripts/audio-lab.mjs', 'scripts/lab-log-capture.mjs'];
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
const referenceSha256 = createHash('sha256').update(await readFile(reference)).digest('hex');
const sdk = process.env.ANDROID_HOME ?? resolve(homedir(), 'Library/Android/sdk');
const adb = resolve(sdk, 'platform-tools/adb');
const command = (bin, args) => execFileSync(bin, args, { cwd: root, encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
await writeFile(resolve(folder, 'provenance.json'), JSON.stringify({
  capturedAt: new Date().toISOString(), workspaceBaseCommit: command('git', ['rev-parse', 'HEAD']),
  uncommittedChanges: Boolean(command('git', ['status', '--porcelain'])),
  node: process.version, files: hashes, referenceSha256, delivery, inputRate, captureRate, requestedProfiles,
  outageProfile: outageMode ? outageProfile : null,
  audioProtoDirectory: process.env.FAMCALL_AUDIO_PROTO_DIR ?? resolve(root, '.local/audio-proto'),
  emulator: command(process.env.FAMCALL_EMULATOR_BIN ?? resolve(sdk, 'emulator/emulator'), ['-version']).split('\n')[0],
  scope: 'Workspace commit is context only; each profile records the actual installed APK hash.',
}, null, 2) + '\n');
// Each endpoint's relay leg is impaired independently, in each direction.
// These are not end-to-end RTT or loss percentages; inspect measured counters.
const profiles = outageMode ? (requestedOutages.length ? requestedOutages : [2, 5, 15, 30]).map(seconds => ({
  ...networkProfiles.find(profile => profile.name === outageProfile),
  name: (outageProfile === 'baseline' ? '' : outageProfile + '-') + 'outage-' + seconds,
  outageSeconds: seconds,
})) : networkProfiles.filter(profile => !requestedProfiles || requestedProfiles.includes(profile.name));
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
  for (const { name, outageSeconds, ...config } of profiles) {
   for (const [direction, sender, receiver] of directions) {
    const caseName = name + '-' + direction;
    console.log('Starting fresh emulator pair for ' + caseName);
    await configure(baseline);
    if (await run(process.execPath, [resolve(root, 'scripts/restart-lab-emulators.mjs')], caseName + '-boot'))
      throw new Error('Emulator restart failed; inspect ' + folder);
    const devices = ['emulator-5554', 'emulator-5556'].map(serial => {
      const apk = command(adb, ['-s', serial, 'shell', 'pm', 'path', 'com.silvergridtech.famcall.e2e']).split('\n')[0].replace('package:', '').trim();
      return { serial, api: command(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk']),
        systemBuild: command(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.fingerprint']),
        installedApkSha256: command(adb, ['-s', serial, 'shell', 'sha256sum', apk]).split(/\s/)[0] };
    });
    await writeFile(resolve(folder, caseName + '-devices.json'), JSON.stringify(devices, null, 2) + '\n');
    for (const peer of ['a', 'b']) await flow(peer, 'open-people', caseName);
    await configure({ ...baseline, ...config });
    let stopNativeLogs;
    try {
      stopNativeLogs = await captureNativeLogs(adb, folder, caseName);
      await flow('a', 'start-call', caseName);
      await flow('b', 'answer-call', caseName);
      await captureAudioState(adb, folder, caseName, 'connected');
      await new Promise(r => setTimeout(r, 5000));
        console.log('Measuring ' + name + '/' + direction);
        const output = resolve(folder, name + '-' + direction + '.json');
        const status = await run(resolve(root, '.local/audio-venv/bin/python'), [resolve(root, 'e2e/audio/measure.py'),
          ...(delivery === 'buffered' ? ['--buffered'] : []), '--source', reference, '--sender', String(sender), '--receiver', String(receiver),
          '--input-rate', String(inputRate), '--capture-rate', String(captureRate),
          '--seconds', String(outageSeconds ? outageSeconds + 32 : 30), '--output', output,
          ...(outageSeconds ? ['--outage-seconds', String(outageSeconds)] : [])], name + '-' + direction);
        if (status !== 0) failed++;
        let report;
        try { report = JSON.parse(await readFile(output, 'utf8')); } catch { /* Failed before report creation. */ }
        results.push({ profile: name, direction, config, status, measurementValid: report?.measurementValid ?? false,
          stoi: report?.stoi ?? null, speechRecovery: report?.speechRecovery ?? null,
          invalidReasons: report?.invalidReasons ?? ['No measurement report'] });
        await captureAudioState(adb, folder, caseName, 'measured');
    } finally {
      try {
        await configure(baseline);
        if (!interrupted) {
          await flow('a', 'end-call', caseName);
          await flow('b', 'dismiss-ended', caseName);
        }
      } finally { await stopNativeLogs?.(); }
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
