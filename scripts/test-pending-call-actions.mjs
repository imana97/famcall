import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { captureNativeLogs, captureAudioState } from './lab-log-capture.mjs';

const root = resolve(import.meta.dirname, '..');
const adb = resolve(process.env.ANDROID_HOME ?? resolve(homedir(), 'Library/Android/sdk'), 'platform-tools/adb');
const mode = process.argv[2];
const modes = ['mute-before-request', 'mute-after-response', 'mute-after-native', 'early-answer'];
if (!modes.includes(mode) || process.argv.length !== 3) throw new Error('Choose ' + modes.join(', ') + '.');
const muted = mode.startsWith('mute-');
const phase = muted ? mode.slice(5) : 'after-response';
const folder = resolve(root, '.local/audio-lab/pending-action-' + mode + '-' + Date.now());
const project = 'http://127.0.0.1:8080/v1/projects/demo-famcall/databases/(default)/documents/';
const command = args => execFileSync(adb, args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const baseline = { transport: 'udp', proxy: true, loss: 0, delayMs: 0, jitterMs: 0, kbps: 0, callStartGate: 'none' };
const report = { startedAt: Date.now(), mode, phase, passed: false,
  scope: 'Controlled demo-build setup delay, mute/answer preservation, UI and JavaScript/native microphone state. No received-silence, packet-impairment, speech, push or physical-device claim.' };
let child, stopLogs, interrupted, callStarted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = signal; child?.kill(signal); });
await mkdir(folder, { recursive: true });
async function configure(callStartGate) {
  const response = await fetch('http://127.0.0.1:8787/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...baseline, callStartGate }), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Cannot configure local test gate.');
}
async function pause() {
  await new Promise(resolve => setTimeout(resolve, 250));
  if (interrupted) throw new Error('Interrupted by ' + interrupted);
}
async function until(check, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  do { const value = await check(); if (value) return value; await pause(); } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}
async function events() {
  return (await readFile(resolve(root, '.local/audio-lab/metrics.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
    .filter(event => event.receivedAt >= report.startedAt);
}
async function document(path) {
  const response = await fetch(project + path, { headers: { Authorization: 'Bearer owner' }, signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not inspect isolated demo state.');
  return response.json();
}
async function flow(peer, name, label = name) {
  if (interrupted) throw new Error('Interrupted by ' + interrupted);
  const log = await open(resolve(folder, peer + '-' + label + '.log'), 'w');
  let timeout;
  try {
    const status = await new Promise(done => {
      child = spawn(process.env.MAESTRO_BIN ?? 'maestro', ['--device', peer === 'a' ? 'emulator-5554' : 'emulator-5556',
        'test', 'e2e/maestro/' + name + '.yaml'], { cwd: root, stdio: ['ignore', log.fd, log.fd] });
      child.once('error', () => done(1)); child.once('exit', code => done(code ?? 1));
      timeout = setTimeout(() => child?.kill('SIGTERM'), 90_000);
    });
    if (status) throw new Error('Maestro failed: ' + peer + '/' + label);
  } finally { clearTimeout(timeout); child = undefined; await log.close(); }
}
try {
  report.devices = ['emulator-5554', 'emulator-5556'].map((serial, index) => {
    if (command(['-s', serial, 'emu', 'avd', 'name']).split('\n')[0].trim() !== ['famcall_a', 'famcall_b'][index])
      throw new Error('Only dedicated FamCall AVDs are allowed.');
    const apk = command(['-s', serial, 'shell', 'pm', 'path', 'com.silvergridtech.famcall.e2e']).replace(/^package:/, '');
    if (!apk.startsWith('/data/app/')) throw new Error('The isolated test app is missing.');
    return { serial, installedApkSha256: command(['-s', serial, 'shell', 'sha256sum', apk]).split(/\s/)[0] };
  });
  const files = ['scripts/test-pending-call-actions.mjs', 'scripts/audio-lab.mjs', 'scripts/lab-log-capture.mjs', 'backend/src/index.ts', 'backend/lib/index.js',
    'apps/mobile/src/state/Calling.tsx', 'apps/mobile/src/services/OutgoingCallAttempt.ts', 'apps/mobile/src/services/callOutbox.ts',
    'apps/mobile/src/services/e2eDiagnostics.ts', 'apps/mobile/src/services/VoicePeer.ts', 'apps/mobile/src/app/call/[id].tsx',
    ...['open-people', 'start-call', 'start-muted-call', 'accept-without-waiting', 'wait-connected', 'answer-call', 'end-call', 'dismiss-ended'].map(name => 'e2e/maestro/' + name + '.yaml')];
  report.sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')])));
  await configure('none');
  await flow('a', 'open-people'); await flow('b', 'open-people');
  stopLogs = await captureNativeLogs(adb, folder, 'pending-actions');
  await configure(phase); callStarted = true; await flow('a', muted ? 'start-muted-call' : 'start-call');
  report.gate = await until(async () => (await events()).find(e => e.kind === 'call-start-gate' && e.phase === phase && e.event === 'waiting'), 'setup gate');
  report.callId = report.gate.callId;
  if (!/^[a-f0-9-]{36}$/.test(report.callId)) throw new Error('Invalid demo call identity.');
  const started = await until(async () => (await events()).find(e => e.kind === 'outgoing-start' && e.callId === report.callId), 'caller identity');
  report.caller = started.uid;
  if (!/^[A-Za-z0-9_-]+$/.test(report.caller)) throw new Error('Invalid demo caller identity.');
  const before = await document('calls/' + report.callId);
  report.statusAtGate = before?.fields.status.stringValue ?? null;
  if (phase === 'before-request' ? before !== null : report.statusAtGate !== 'ringing') throw new Error('Wrong setup boundary.');
  if (mode === 'mute-before-request') {
    // Keep the callable result pending until the Firestore watcher has attached.
    // This exercises both orders without relying on an arbitrary sleep.
    await configure('after-response');
    report.secondGate = await until(async () => (await events()).find(e => e.kind === 'call-start-gate' && e.callId === report.callId && e.phase === 'after-response' && e.event === 'waiting'), 'response gate');
    report.watchedBeforeResponse = await until(async () => (await events()).find(e => e.kind === 'call-record' && e.callId === report.callId && e.status === 'ringing'), 'Firestore attachment');
    if (!report.watchedBeforeResponse.muted) throw new Error('Attaching the call watcher lost pending mute intent.');
  }
  if (!muted) {
    await flow('b', 'accept-without-waiting');
    await until(async () => (await document('calls/' + report.callId))?.fields.status.stringValue === 'accepted', 'answer before response');
    const raw = execFileSync(process.env.MAESTRO_BIN ?? 'maestro', ['--device', 'emulator-5554', 'hierarchy'],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 5 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    await writeFile(resolve(folder, 'caller-before-response-ui.json'), raw);
    report.callerShowsAcceptedBeforeResponse = raw.includes('Connecting…');
    if (!report.callerShowsAcceptedBeforeResponse) throw new Error('Caller had not observed the early answer before the response was released.');
    report.acceptedBeforeResponseAt = Date.now();
  }
  await configure('none'); report.gateReleasedAt = Date.now();
  if (muted) await flow('b', 'answer-call');
  else await flow('b', 'wait-connected');
  await flow('a', 'wait-connected');
  report.bound = await until(async () => (await events()).find(e => e.kind === 'outgoing-bound' && e.callId === report.callId), 'native binding');
  if (!muted && report.bound.status !== 'accepted') throw new Error('The delayed ringing response replaced the early answer.');
  const tracks = await until(async () => {
    const values = (await events()).filter(e => e.kind === 'microphone-state' && e.callId === report.callId && e.uid === report.caller && e.trackEnabled.length).sort((a, b) => a.at - b.at);
    return values.length ? values : null;
  }, 'caller microphone state');
  report.firstTrack = tracks[0]; report.latestTrack = tracks.at(-1);
  await captureAudioState(adb, folder, 'pending-actions', 'connected');
  const audio = JSON.parse(await readFile(resolve(folder, 'pending-actions-emulator-5554-audio-connected.json'), 'utf8'));
  const line = String(audio.dumps.audio).split('\n').find(line => line.includes('mic mute FromSwitch='));
  const match = line?.match(/FromSwitch=(true|false) FromRestrictions=(true|false) FromApi=(true|false) from system=(true|false)/);
  if (!match) throw new Error('Android microphone mute state is unavailable.');
  report.systemMute = { api: match[3] === 'true', system: match[4] === 'true', fromSwitch: match[1] === 'true', restricted: match[2] === 'true' };
  await writeFile(resolve(folder, 'caller-connected.png'), execFileSync(adb, ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'], { timeout: 10_000 }));
  for (const value of [report.firstTrack, report.latestTrack])
    if (value.muted !== muted || value.trackEnabled.some(enabled => enabled === muted)) throw new Error('Mute intent was not preserved in microphone track state.');
  if (report.systemMute.api !== muted || report.systemMute.system !== muted || report.systemMute.fromSwitch || report.systemMute.restricted)
    throw new Error('Native microphone mute did not match the requested state.');
  report.finalStatus = (await document('calls/' + report.callId))?.fields.status.stringValue;
  if (report.finalStatus !== 'accepted') throw new Error('The resumed call is not accepted.');
  await flow('a', 'end-call'); callStarted = false; await flow('b', 'dismiss-ended');
  report.activeLeasesCleared = !(await document('activeCalls'))?.documents?.some(d => d.fields.callId.stringValue === report.callId);
  if (!report.activeLeasesCleared) throw new Error('A lease remained after cleanup.');
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  try { await configure('none'); }
  catch (error) { report.restoreError = error.message; report.passed = false; process.exitCode = 1; }
  if (callStarted && !interrupted) try { await flow('a', 'end-call', 'cleanup'); await flow('b', 'dismiss-ended', 'cleanup'); } catch (error) { report.cleanupError = error.message; }
  if (stopLogs) await stopLogs();
  report.finishedAt = Date.now();
  await writeFile(resolve(folder, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, error: report.error, folder }));
}
