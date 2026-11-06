import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { captureNativeLogs, captureAudioState } from './lab-log-capture.mjs';

const root = resolve(import.meta.dirname, '..');
const adb = resolve(process.env.ANDROID_HOME ?? resolve(homedir(), 'Library/Android/sdk'), 'platform-tools/adb');
const folder = resolve(root, '.local/audio-lab/mute-' + Date.now());
const command = args => execFileSync(adb, args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const serials = { a: 'emulator-5554', b: 'emulator-5556' };
let child;
let interrupted;
let stopLogs;
let callStarted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = signal; child?.kill(signal); });
const report = { startedAt: Date.now(), passed: false, phases: [],
  scope: 'Android UI, JavaScript track-enabled state and Android system microphone mute only; no transmitted-silence, speech-quality, iPhone or physical-device claim.' };
await mkdir(folder, { recursive: true });
async function flow(peer, name) {
  if (interrupted) throw new Error('Interrupted by ' + interrupted);
  const file = await open(resolve(folder, peer + '-' + name + '-' + Date.now() + '.log'), 'w');
  let timeout;
  try {
    const status = await new Promise(done => {
      child = spawn(process.env.MAESTRO_BIN ?? 'maestro', ['--device', serials[peer], 'test', 'e2e/maestro/' + name + '.yaml'],
        { cwd: root, stdio: ['ignore', file.fd, file.fd] });
      child.once('error', () => done(1));
      child.once('exit', code => done(code ?? 1));
      timeout = setTimeout(() => child?.kill('SIGTERM'), 120_000);
    });
    if (status) throw new Error('Maestro failed: ' + peer + '/' + name);
  } finally { clearTimeout(timeout); child = undefined; await file.close(); }
}
async function events() {
  return (await readFile(resolve(root, '.local/audio-lab/metrics.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
    .filter(event => event.receivedAt >= report.startedAt);
}
async function identifyCall(since) {
  const ids = [...new Set((await events()).filter(e => e.kind === 'microphone-state' && e.receivedAt >= since).map(e => e.callId))];
  if (ids.length !== 1 || !/^[a-f0-9-]{36}$/.test(ids[0])) throw new Error('Expected one current test call.');
  const response = await fetch('http://127.0.0.1:8080/v1/projects/demo-famcall/databases/(default)/documents/calls/' + ids[0],
    { headers: { Authorization: 'Bearer owner' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Cannot read local demo call.');
  const call = await response.json();
  if (call.fields.status.stringValue !== 'accepted') throw new Error('Call is not accepted.');
  return { id: ids[0], caller: call.fields.callerId.stringValue };
}
async function state(phase, expected, call, first = false) {
  await captureAudioState(adb, folder, 'mute', phase);
  const snapshot = JSON.parse(await readFile(resolve(folder, 'mute-emulator-5554-audio-' + phase + '.json'), 'utf8'));
  const line = String(snapshot.dumps.audio).split('\n').find(line => line.includes('mic mute FromSwitch='));
  const match = line?.match(/FromSwitch=(true|false) FromRestrictions=(true|false) FromApi=(true|false) from system=(true|false)/);
  if (!match) throw new Error('Could not read Android microphone mute state.');
  const actual = match[3] === 'true';
  const systemMuted = match[4] === 'true';
  if (actual !== expected || systemMuted !== expected || match[1] !== 'false' || match[2] !== 'false')
    throw new Error('Unexpected Android microphone state during ' + phase);
  const entry = { phase, at: Date.now(), systemApiMuted: actual, systemMuted };
  if (call) {
    const values = (await events()).filter(e => e.kind === 'microphone-state' && e.callId === call.id && e.uid === call.caller && e.trackEnabled.length);
    const latest = values.at(-1);
    if (!latest || latest.muted !== expected || latest.trackEnabled.some(enabled => enabled === expected))
      throw new Error('App microphone track does not match requested mute during ' + phase);
    if (first && (values[0].muted !== expected || values[0].trackEnabled.some(enabled => enabled === expected)))
      throw new Error('The first microphone track state did not preserve mute intent.');
    entry.trackState = latest;
    if (first) entry.firstTrackState = values[0];
  }
  report.phases.push(entry);
}
async function hangup() {
  await flow('a', 'end-call');
  callStarted = false;
  await flow('b', 'dismiss-ended');
}
try {
  report.devices = Object.values(serials).map((serial, i) => {
    if (command(['-s', serial, 'emu', 'avd', 'name']).split('\n')[0].trim() !== ['famcall_a', 'famcall_b'][i])
      throw new Error('Only dedicated FamCall emulators are allowed.');
    const apk = command(['-s', serial, 'shell', 'pm', 'path', 'com.silvergridtech.famcall.e2e']).replace(/^package:/, '').trim();
    if (!apk.startsWith('/data/app/')) throw new Error('The isolated FamCall test app is missing.');
    return { serial, installedApkSha256: command(['-s', serial, 'shell', 'sha256sum', apk]).split(/\s/)[0] };
  });
  const files = ['scripts/test-mute.mjs', 'scripts/lab-log-capture.mjs', 'apps/mobile/src/state/Calling.tsx', 'apps/mobile/src/services/VoicePeer.ts',
    'apps/mobile/src/services/NativeCallCoordinator.ts', 'apps/mobile/src/services/nativeEvents.ts',
    'apps/mobile/src/app/call/[id].tsx', 'apps/mobile/src/components/ui.tsx',
    ...['open-people', 'start-muted-call', 'start-call', 'answer-call', 'mute-connected-call', 'unmute-connected-call', 'end-call', 'dismiss-ended'].map(name => 'e2e/maestro/' + name + '.yaml')];
  report.sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')])));
  const config = await fetch('http://127.0.0.1:8787/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transport: 'udp', proxy: true, loss: 0, delayMs: 0, jitterMs: 0, kbps: 0 }) });
  if (!config.ok) throw new Error('Lab configuration failed.');
  await flow('a', 'open-people'); await flow('b', 'open-people');
  stopLogs = await captureNativeLogs(adb, folder, 'mute');
  await state('idle', false);
  callStarted = true;
  await flow('a', 'start-muted-call'); await flow('b', 'answer-call');
  const call = await identifyCall(report.startedAt);
  report.firstCall = call.id;
  await state('muted-after-answer', true, call, true);
  await flow('a', 'unmute-connected-call'); await state('unmuted', false, call);
  await flow('a', 'mute-connected-call'); await state('muted-before-hangup', true, call);
  await hangup(); await state('after-hangup', false);
  const nextStartedAt = Date.now();
  callStarted = true;
  await flow('a', 'start-call'); await flow('b', 'answer-call');
  const next = await identifyCall(nextStartedAt);
  if (next.id === call.id) throw new Error('The follow-up call was not a new call.');
  report.secondCall = next.id;
  await state('next-call', false, next, true);
  await hangup(); await state('final-idle', false);
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  if (callStarted && !interrupted) try { await hangup(); } catch (error) { report.cleanupError = error.message; }
  try { await stopLogs?.(); } catch (error) { report.logCaptureError = error.message; report.passed = false; process.exitCode = 1; }
  report.finishedAt = Date.now();
  await writeFile(resolve(folder, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, phases: report.phases.map(p => p.phase), error: report.error, evidence: folder }));
}
