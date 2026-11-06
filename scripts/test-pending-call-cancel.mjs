import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { captureNativeLogs } from './lab-log-capture.mjs';

const root = resolve(import.meta.dirname, '..');
const adb = resolve(process.env.ANDROID_HOME ?? resolve(homedir(), 'Library/Android/sdk'), 'platform-tools/adb');
const phase = process.argv[2];
if (!['before-request', 'after-response', 'after-native'].includes(phase) || process.argv.length !== 3)
  throw new Error('Choose before-request, after-response or after-native.');
const folder = resolve(root, '.local/audio-lab/pending-cancel-' + phase + '-' + Date.now());
const project = 'http://127.0.0.1:8080/v1/projects/demo-famcall/databases/(default)/documents/';
const command = args => execFileSync(adb, args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const baseline = { transport: 'udp', proxy: true, loss: 0, delayMs: 0, jitterMs: 0, kbps: 0, callStartGate: 'none' };
const report = { startedAt: Date.now(), phase, passed: false,
  scope: 'Controlled demo-build setup delays, local cancellation, backend receipt/state and native-session teardown. No packet impairment, speech, push or physical-device claim.' };
let child, stopLogs, interrupted;
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
  const files = ['scripts/test-pending-call-cancel.mjs', 'scripts/audio-lab.mjs', 'scripts/lab-log-capture.mjs', 'backend/src/index.ts', 'backend/lib/index.js',
    'apps/mobile/src/state/Calling.tsx', 'apps/mobile/src/services/OutgoingCallAttempt.ts', 'apps/mobile/src/services/callOutbox.ts',
    'apps/mobile/src/services/e2eDiagnostics.ts', 'apps/mobile/src/app/call/[id].tsx',
    ...['open-people', 'start-call', 'cancel-starting-call', 'dismiss-ended'].map(name => 'e2e/maestro/' + name + '.yaml')];
  report.sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')])));
  await configure('none');
  await flow('a', 'open-people'); await flow('b', 'open-people');
  stopLogs = await captureNativeLogs(adb, folder, 'pending-cancel');
  await configure(phase); await flow('a', 'start-call');
  report.gate = await until(async () => (await events()).find(e => e.kind === 'call-start-gate' && e.phase === phase && e.event === 'waiting'), 'setup gate');
  report.callId = report.gate.callId;
  if (!/^[a-f0-9-]{36}$/.test(report.callId)) throw new Error('Invalid demo call identity.');
  const started = await until(async () => (await events()).find(e => e.kind === 'outgoing-start' && e.callId === report.callId), 'caller identity');
  report.caller = started.uid;
  if (!/^[A-Za-z0-9_-]+$/.test(report.caller)) throw new Error('Invalid demo caller identity.');
  const before = await document('calls/' + report.callId);
  report.statusAtGate = before?.fields.status.stringValue ?? null;
  if (phase === 'before-request' ? before !== null : report.statusAtGate !== 'ringing') throw new Error('Wrong setup boundary.');
  await flow('a', 'cancel-starting-call');
  report.localCancellationObservedAt = Date.now();
  report.cancelStored = await until(async () => phase === 'before-request'
    ? !!(await document('users/' + report.caller + '/cancelledStarts/' + report.callId))
    : (await document('calls/' + report.callId))?.fields.status.stringValue === 'cancelled', 'durable cancellation');
  await configure('none'); report.gateReleasedAt = Date.now();
  report.finished = await until(async () => (await events()).find(e => e.kind === 'outgoing-finished' && e.callId === report.callId), 'late setup completion');
  if (report.finished.nativeSession && report.finished.nativeSession.status !== 'ended') throw new Error('A native call survived cancellation.');
  if ((await events()).some(e => e.kind === 'outgoing-bound' && e.callId === report.callId)) throw new Error('Cancelled setup bound a native call.');
  const after = await document('calls/' + report.callId);
  report.finalStatus = after?.fields.status.stringValue ?? null;
  if (phase === 'before-request' ? after !== null : report.finalStatus !== 'cancelled') throw new Error('Late setup revived the server call.');
  report.activeLeasesCleared = !(await document('activeCalls'))?.documents?.some(d => d.fields.callId.stringValue === report.callId);
  if (!report.activeLeasesCleared) throw new Error('An active call lease survived cancellation.');
  await flow('a', 'open-people', 'no-resurrection');
  if (phase !== 'before-request') await flow('b', 'dismiss-ended');
  else await flow('b', 'open-people', 'never-rang');
  await writeFile(resolve(folder, 'caller-final.png'), execFileSync(adb, ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'], { timeout: 10_000 }));
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  try { await configure('none'); }
  catch (error) { report.restoreError = error.message; report.passed = false; process.exitCode = 1; }
  if (stopLogs) await stopLogs();
  report.finishedAt = Date.now();
  await writeFile(resolve(folder, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, error: report.error, folder }));
}
