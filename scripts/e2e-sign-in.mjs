import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const device = process.env.DEVICE ?? 'emulator-5554';
const phone = process.env.PHONE ?? '+12025550101';
if (!/^\+1202555010[12]$/.test(phone)) throw new Error('Use one of the two fictional lab numbers.');
const maestro = process.env.MAESTRO_BIN ?? 'maestro';
function run(flow, values) {
  const args = ['--device', device, 'test', '--test-output-dir', resolve(root, '.local/maestro', device, flow)];
  for (const [key, value] of Object.entries(values)) args.push('-e', key + '=' + value);
  args.push(resolve(root, 'e2e/maestro', flow + '.yaml'));
  const result = spawnSync(maestro, args, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!process.argv.includes('--finish')) run('start-signin', { PHONE: process.env.INPUT_PHONE ?? phone });
const response = await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-famcall/verificationCodes');
if (!response.ok) throw new Error('The local authentication emulator is unavailable.');
const data = await response.json();
const verification = data.verificationCodes.filter(c => c.phoneNumber === phone).at(-1);
if (!verification?.code) throw new Error('No local verification code was issued.');
run('verify', { OTP: verification.code });
