import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME ?? resolve(homedir(), 'Library/Android/sdk');
const adb = resolve(sdk, 'platform-tools/adb');
const app = 'com.silvergridtech.famcall.e2e';
const role = process.argv[2] ?? 'caller';
if (!['caller', 'callee'].includes(role) || process.argv.length > 3) throw new Error('Choose caller or callee.');
const actor = role === 'caller' ? 'a' : 'b';
const other = actor === 'a' ? 'b' : 'a';
const serial = actor === 'a' ? 'emulator-5554' : 'emulator-5556';
const folder = resolve(root, '.local/audio-lab/offline-hangup-' + Date.now());
const baseline = { transport: 'udp', proxy: true, loss: 0, delayMs: 0, jitterMs: 0, kbps: 0 };
const command = args => execFileSync(adb, args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let interrupted;
let child;
let originalNetwork;
let callId;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = signal;
  child?.kill(signal);
});
async function pause(ms) {
  await new Promise(done => setTimeout(done, ms));
  if (interrupted) throw new Error('Interrupted by ' + interrupted);
}
async function flow(peer, name, label = name) {
  if (interrupted) throw new Error('Interrupted by ' + interrupted);
  const log = await open(resolve(folder, peer + '-' + label + '.log'), 'w');
  let timeout;
  try {
    const status = await new Promise(done => {
      child = spawn(process.env.MAESTRO_BIN ?? 'maestro', ['--device', peer === 'a' ? 'emulator-5554' : 'emulator-5556',
        'test', 'e2e/maestro/' + name + '.yaml'], { cwd: root, stdio: ['ignore', log.fd, log.fd] });
      child.once('error', () => done(1));
      child.once('exit', code => done(code ?? 1));
      timeout = setTimeout(() => child?.kill('SIGTERM'), 120_000);
    });
    if (status) throw new Error('Maestro failed: ' + peer + '/' + label);
  } finally { clearTimeout(timeout); child = undefined; await log.close(); }
}
async function document(path) {
  const response = await fetch('http://127.0.0.1:8080/v1/projects/demo-famcall/databases/(default)/documents/' + path,
    { headers: { Authorization: 'Bearer owner' }, signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Local demo state could not be read.');
  return response.json();
}
function defaultNetwork() {
  const state = command(['-s', serial, 'shell', 'dumpsys', 'connectivity']);
  const match = state.match(/^Active default network: (.+)$/m);
  if (!match) throw new Error('Could not determine the emulator default network.');
  return match[1].trim();
}
async function captureCallUi(label) {
  const raw = execFileSync(process.env.MAESTRO_BIN ?? 'maestro', ['--device', serial, 'hierarchy'],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 5 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  await writeFile(resolve(folder, label + '-ui.json'), raw);
  const nodes = [];
  function visit(node) { nodes.push(node.attributes ?? {}); (node.children ?? []).forEach(visit); }
  visit(JSON.parse(raw));
  const bounds = nodes.find(node => node['resource-id'] === 'end-call')?.bounds;
  if (!bounds) throw new Error('End Call control is missing during ' + label);
  const screenshot = execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 10_000 });
  await writeFile(resolve(folder, label + '.png'), screenshot);
  return { bounds, reconnecting: nodes.some(node => node.text?.includes('Finding your voice again')), observedAt: Date.now() };
}
function restoreNetwork() {
  if (!originalNetwork) return;
  for (const [service, setting] of [['wifi', 'wifi'], ['data', 'data']])
    command(['-s', serial, 'shell', 'svc', service, originalNetwork[setting] === '1' ? 'enable' : 'disable']);
}
await mkdir(folder, { recursive: true });
const report = { startedAt: Date.now(), passed: false, role, offlineSerial: serial,
  scope: 'Selected participant offline hangup, process restart and durable replay on two dedicated Android emulators. No speech, background push or physical-device claim.' };
try {
  report.devices = ['emulator-5554', 'emulator-5556'].map((device, i) => {
    if (command(['-s', device, 'emu', 'avd', 'name']).split('\n')[0].trim() !== ['famcall_a', 'famcall_b'][i])
      throw new Error('This test only operates on the dedicated FamCall AVDs.');
    const apk = command(['-s', device, 'shell', 'pm', 'path', app]).split('\n')[0].replace(/^package:/, '');
    if (!apk.startsWith('/data/app/')) throw new Error('Install the isolated FamCall test APK first.');
    return { serial: device, installedApkSha256: command(['-s', device, 'shell', 'sha256sum', apk]).split(/\s/)[0] };
  });
  const files = ['scripts/test-offline-hangup.mjs', 'apps/mobile/src/state/Calling.tsx', 'apps/mobile/src/services/callOutbox.ts',
    'apps/mobile/src/services/NativeCallCoordinator.ts', 'apps/mobile/src/services/nativeEvents.ts',
    'apps/mobile/src/services/OutgoingCallAttempt.ts', 'backend/src/index.ts', 'backend/lib/index.js',
    'apps/mobile/src/app/call/[id].tsx', 'apps/mobile/src/components/ui.tsx',
    ...['open-people', 'start-call', 'answer-call', 'end-call', 'dismiss-ended'].map(f => 'e2e/maestro/' + f + '.yaml')];
  report.sourceHashes = Object.fromEntries(await Promise.all(files.map(async f => [f, createHash('sha256').update(await readFile(resolve(root, f))).digest('hex')])));
  const config = await fetch('http://127.0.0.1:8787/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(baseline) });
  if (!config.ok) throw new Error('Lab configuration failed.');
  await flow('a', 'open-people'); await flow('b', 'open-people');
  await flow('a', 'start-call'); await flow('b', 'answer-call');
  await pause(4000);
  const events = (await readFile(resolve(root, '.local/audio-lab/metrics.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  callId = [...events].reverse().find(e => e.kind === 'stats' && e.receivedAt > report.startedAt)?.callId;
  if (!/^[a-f0-9-]{36}$/.test(callId ?? '')) throw new Error('No current test call was identified.');
  report.callId = callId;
  const before = await document('calls/' + callId);
  if (before?.fields.status.stringValue !== 'accepted') throw new Error('Call was not accepted.');
  const participants = before.fields.participants.arrayValue.values.map(v => v.stringValue);
  report.acceptedAt = Number(before.fields.acceptedAtMs.integerValue);
  const networkBefore = {
    wifi: command(['-s', serial, 'shell', 'settings', 'get', 'global', 'wifi_on']),
    data: command(['-s', serial, 'shell', 'settings', 'get', 'global', 'mobile_data']),
  };
  if (Object.values(networkBefore).some(value => !['0', '1'].includes(value)))
    throw new Error('Network state is transitional or unavailable; refusing to change it.');
  originalNetwork = networkBefore;
  report.originalNetwork = originalNetwork;
  report.defaultNetworkBefore = defaultNetwork();
  report.connectedUi = await captureCallUi('connected');
  command(['-s', serial, 'shell', 'svc', 'wifi', 'disable']);
  command(['-s', serial, 'shell', 'svc', 'data', 'disable']);
  const offlineDeadline = Date.now() + 15_000;
  while (defaultNetwork() !== 'none') {
    if (Date.now() > offlineDeadline) throw new Error('Selected participant still has a default network.');
    await pause(1000);
  }
  report.offlineAt = Date.now();
  const reconnectingDeadline = Date.now() + 20_000;
  do {
    report.offlineUi = await captureCallUi('offline');
    if (report.offlineUi.reconnecting) break;
    await pause(1000);
  } while (Date.now() < reconnectingDeadline);
  if (!report.offlineUi.reconnecting) throw new Error('Reconnecting message was not observed.');
  if (report.connectedUi.bounds !== report.offlineUi.bounds)
    throw new Error('End Call moved when the connection dropped.');
  await flow(actor, 'end-call');
  report.localHangupObservedAt = Date.now();
  report.serverStatusWhileOffline = (await document('calls/' + callId))?.fields.status.stringValue;
  if (report.serverStatusWhileOffline !== 'accepted') throw new Error('Server already ended the call before replay could be tested.');
  report.processBefore = command(['-s', serial, 'shell', 'pidof', app]);
  command(['-s', serial, 'shell', 'am', 'force-stop', app]);
  await flow(actor, 'open-people', 'restart-offline');
  report.processAfter = command(['-s', serial, 'shell', 'pidof', app]);
  if (report.processBefore === report.processAfter) throw new Error('App process restart was not observed.');
  if (defaultNetwork() !== 'none') throw new Error('Network returned before durable replay could be tested.');
  report.serverStatusAfterRestart = (await document('calls/' + callId))?.fields.status.stringValue;
  if (report.serverStatusAfterRestart !== 'accepted') throw new Error('Call ended before network restoration.');
  restoreNetwork();
  const restoreDeadline = Date.now() + 15_000;
  while (defaultNetwork() === 'none') {
    if (Date.now() > restoreDeadline) throw new Error('Emulator network did not restore.');
    await pause(1000);
  }
  report.networkRestoredObservedAt = Date.now();
  const replayDeadline = Date.now() + 90_000;
  let current;
  do {
    current = await document('calls/' + callId);
    if (current?.fields.status.stringValue !== 'accepted') break;
    await pause(1000);
  } while (Date.now() < replayDeadline);
  report.finalStatus = current?.fields.status.stringValue;
  report.serverEndedAt = Number(current?.fields.endedAtMs?.integerValue);
  report.replayObservedWithinMs = Date.now() - report.networkRestoredObservedAt;
  if (report.finalStatus !== 'ended') throw new Error('Persisted hangup did not end the call after reconnection.');
  report.activeLeasesCleared = (await Promise.all(participants.map(uid => document('activeCalls/' + uid)))).every(d => d === null);
  if (!report.activeLeasesCleared) throw new Error('An active call lease remained.');
  await flow(other, 'dismiss-ended');
  await flow(actor, 'open-people', 'still-ended');
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  try { restoreNetwork(); }
  catch (error) { report.restoreError = error.message; report.passed = false; process.exitCode = 1; }
  if (!report.passed && callId && !interrupted) {
    try {
      if ((await document('calls/' + callId))?.fields.status.stringValue === 'accepted') await flow(other, 'end-call', 'cleanup');
    } catch (error) { report.cleanupError = error.message; }
  }
  report.finishedAt = Date.now();
  await writeFile(resolve(folder, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, error: report.error, folder }));
}
