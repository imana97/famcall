import { spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv[2];
if (!['recover', 'timeout'].includes(mode)) throw new Error('Choose recover or timeout. End any existing lab call first.');
const folder = resolve(root, '.local/audio-lab/setup-' + mode + '-' + Date.now());
await mkdir(folder, { recursive: true });
const pause = ms => new Promise(r => setTimeout(r, ms));
const baseline = { transport: 'udp', proxy: true, loss: 0, delayMs: 0, jitterMs: 0, kbps: 0 };
async function configure(config) {
  const r = await fetch('http://127.0.0.1:8787/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
  if (!r.ok) throw new Error('Lab configuration failed.');
}
async function run(bin, args, name) {
  const log = await open(resolve(folder, name + '.log'), 'w');
  try {
    return await new Promise(done => {
      const child = spawn(bin, args, { cwd: root, stdio: ['ignore', log.fd, log.fd] });
      child.once('error', () => done(1)); child.once('exit', code => done(code ?? 1));
    });
  } finally { await log.close(); }
}
async function flow(peer, name) {
  if (await run(process.env.MAESTRO_BIN ?? 'maestro', ['--device', peer === 'a' ? 'emulator-5554' : 'emulator-5556', 'test', 'e2e/maestro/' + name + '.yaml'], peer + '-' + name))
    throw new Error('Maestro failed: ' + peer + '/' + name);
}
async function document(path) {
  const r = await fetch('http://127.0.0.1:8080/v1/projects/demo-famcall/databases/(default)/documents/' + path, { headers: { Authorization: 'Bearer owner' } });
  if (!r.ok) throw new Error('Cannot read the local demo call state.');
  return r.json();
}
const report = { mode, startedAt: Date.now(), scope: 'Initial native connection retry only; not a speech test.', passed: false };
let callId;
try {
  await configure(baseline);
  await flow('a', 'open-people'); await flow('b', 'open-people');
  await configure({ ...baseline, loss: 1 });
  await flow('a', 'start-call'); await flow('b', 'answer-connecting');
  await pause(4000);
  const entries = (await readFile(resolve(root, '.local/audio-lab/metrics.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  callId = [...entries].reverse().find(e => e.kind === 'stats' && e.receivedAt >= report.startedAt)?.callId;
  if (!callId || !/^[a-f0-9-]{36}$/.test(callId)) throw new Error('No current test call.');
  report.callId = callId;
  const call = await document('calls/' + callId);
  const acceptedAt = Number(call.fields.acceptedAtMs.integerValue);
  report.acceptedAt = acceptedAt;
  await pause(Math.max(0, acceptedAt + 22_000 - Date.now()));
  const signals = await document('calls/' + callId + '/signals');
  report.generationsWhileBlocked = (signals.documents ?? []).map(d => Number(d.fields.generation.integerValue));
  if (report.generationsWhileBlocked.length !== 2 || report.generationsWhileBlocked.some(g => g < 2))
    throw new Error('No initial retry was observed while relay packets were blocked.');
  if (mode === 'recover') {
    await configure(baseline);
    report.restoredAt = Date.now();
    await flow('a', 'wait-connected'); await flow('b', 'wait-connected');
    if (await run(process.execPath, ['scripts/measure-transport-session.mjs', 'udp', '15'], 'received-packets'))
      throw new Error('Packet flow did not recover at both peers.');
    const events = (await readFile(resolve(root, '.local/audio-lab/metrics.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    const connected = new Map();
    for (const e of events) if (e.kind === 'state' && e.callId === callId && e.state === 'connected' && e.receivedAt >= report.restoredAt && !connected.has(e.uid))
      connected.set(e.uid, e.receivedAt - report.restoredAt);
    report.connectedAfterRestoreMs = [...connected.values()];
    report.passed = true;
  } else {
    let current;
    do {
      await pause(1000);
      current = await document('calls/' + callId);
    } while (current.fields.status.stringValue === 'accepted' && Date.now() - acceptedAt < 90_000);
    report.finalStatus = current.fields.status.stringValue;
    report.endedAfterMs = Number(current.fields.endedAtMs?.integerValue) - acceptedAt;
    report.passed = report.finalStatus === 'ended' && report.endedAfterMs <= 90_000;
    if (!report.passed) throw new Error('Initial setup did not end within the bounded retry window.');
  }
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  try {
    await configure(baseline);
    if (callId) {
      const call = await document('calls/' + callId);
      if (call.fields.status.stringValue === 'accepted') await flow('a', 'end-call');
      else await flow('a', 'dismiss-ended');
      await flow('b', 'dismiss-ended');
    }
  } catch (error) { report.cleanupError = error.message; report.passed = false; process.exitCode = 1; }
  report.finishedAt = Date.now();
  await writeFile(resolve(folder, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
