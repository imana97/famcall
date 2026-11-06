import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const cases = [
  { name: 'baseline-b-to-a-repeat', sender: 8556, receiver: 8554, loss: 0, delayMs: 0, jitterMs: 0, kbps: 0 },
  { name: 'poor-b-to-a', sender: 8556, receiver: 8554, loss: 0.03, delayMs: 150, jitterMs: 50, kbps: 48 },
  { name: 'poor-a-to-b-repeat', sender: 8554, receiver: 8556, loss: 0.03, delayMs: 150, jitterMs: 50, kbps: 48 },
  { name: 'severe-a-to-b', sender: 8554, receiver: 8556, loss: 0.08, delayMs: 250, jitterMs: 100, kbps: 32 },
];
const configure = config => fetch('http://127.0.0.1:8787/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }).then(r => { if (!r.ok) throw new Error('Lab configuration failed'); });
try {
  for (const { name, sender, receiver, ...config } of cases) {
    console.log('Starting ' + name);
    await configure(config);
    await new Promise(r => setTimeout(r, 3000));
    const status = await new Promise(resolveExit => {
      const child = spawn(resolve(root, '.local/audio-venv/bin/python'), [resolve(root, 'e2e/audio/measure.py'),
        '--sender', String(sender), '--receiver', String(receiver), '--seconds', '20', '--output',
        resolve(root, '.local/audio-lab', name + '.json')], { cwd: root, stdio: 'inherit' });
      child.on('exit', resolveExit);
    });
    if (status !== 0) console.log('Audio measurement did not pass for ' + name);
  }
} finally { await configure({ loss: 0, delayMs: 0, jitterMs: 0, kbps: 0 }); }
