import { spawn, execFileSync } from 'node:child_process';
import { access, mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME ?? resolve(homedir(), 'Library/Android/sdk');
const adb = resolve(sdk, 'platform-tools/adb');
const emulator = process.env.FAMCALL_EMULATOR_BIN ?? resolve(sdk, 'emulator/emulator');
const avdHome = resolve(root, '.local/avd');
const devices = [
  { name: 'famcall_a', serial: 'emulator-5554', port: 5554, grpc: 8554 },
  { name: 'famcall_b', serial: 'emulator-5556', port: 5556, grpc: 8556 },
];
const pause = ms => new Promise(r => setTimeout(r, ms));
const command = (args) => execFileSync(adb, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim();
await access(emulator);
for (const d of devices) await access(resolve(avdHome, d.name + '.ini'));
await mkdir(resolve(root, '.local/emulator-logs'), { recursive: true });

// The ports may belong to another task: refuse to stop an unrelated AVD.
const visibleDevices = command(['devices']);
const identified = [];
for (const d of devices) {
  if (!visibleDevices.includes(d.serial)) continue;
  let name;
  try { name = command(['-s', d.serial, 'emu', 'avd', 'name']).split('\n')[0].trim(); }
  catch { throw new Error(`Cannot identify ${d.serial}; refusing to stop it.`); }
  if (name !== d.name) throw new Error(`${d.serial} belongs to another emulator; refusing to stop it.`);
  identified.push(d);
}
for (const d of identified) {
  // Commit recent APK/data writes before terminating the dedicated emulator.
  command(['-s', d.serial, 'shell', 'sync']);
  try { command(['-s', d.serial, 'emu', 'kill']); } catch { /* Already stopped. */ }
}
const stoppedDeadline = Date.now() + 30_000;
while (true) {
  const live = command(['devices']);
  if (devices.every(d => !live.includes(d.serial))) break;
  if (Date.now() >= stoppedDeadline) throw new Error('The lab emulators did not stop.');
  await pause(1000);
}
await pause(2000);
for (const d of devices) {
  const log = await open(resolve(root, '.local/emulator-logs', d.name + '.log'), 'w');
  const child = spawn(emulator, ['-avd', d.name, '-port', String(d.port), '-grpc', String(d.grpc),
    '-grpc-use-token', '-no-audio', '-no-window', '-no-snapshot', '-gpu', 'swiftshader', '-memory', '2048', '-cores', '2'], {
    cwd: root, env: { ...process.env, ANDROID_AVD_HOME: avdHome },
    detached: true, stdio: ['ignore', log.fd, log.fd],
  });
  await new Promise((ok, fail) => { child.once('spawn', ok); child.once('error', fail); });
  child.unref();
  await log.close();
  // Stagger boots to avoid starving Android's System UI on a busy host.
  const bootDeadline = Date.now() + 120_000;
  while (true) {
    try { if (command(['-s', d.serial, 'shell', 'getprop', 'sys.boot_completed']) === '1') break; }
    catch { /* ADB may not be ready yet. */ }
    if (Date.now() >= bootDeadline) throw new Error('Lab boot timed out; inspect .local/emulator-logs.');
    try { process.kill(child.pid, 0); } catch { throw new Error('A lab emulator exited during boot.'); }
    await pause(2000);
  }
  for (const setting of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'])
    command(['-s', d.serial, 'shell', 'settings', 'put', 'global', setting, '0']);
  command(['-s', d.serial, 'shell', 'input', 'keyevent', '82']);
  await pause(10_000);
}
for (const d of devices) {
  if (!command(['-s', d.serial, 'shell', 'pm', 'path', 'com.silvergridtech.famcall.e2e']).startsWith('package:'))
    throw new Error('Install the separate FamCall test build on ' + d.serial + ' first.');
}
console.log('Two fresh FamCall emulators are ready; host microphone passthrough remains disabled.');
