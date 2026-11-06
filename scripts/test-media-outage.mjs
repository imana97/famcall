import {spawn} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
const seconds = Number(process.argv[2] ?? 15);
if (![5, 15, 30].includes(seconds)) throw new Error('Use a 5, 15, or 30 second outage.');
const configure = async config => {
  const r = await fetch('http://127.0.0.1:8787/config', {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(config)});
  if (!r.ok) throw new Error('Could not configure isolated audio lab.');
};
await configure({transport:'udp', proxy:true, loss:0, delayMs:0, jitterMs:0, kbps:0});
const startedAt = Date.now();
console.log('Dropping only the test relay media for ' + seconds + ' seconds.');
try {
  await configure({loss:1});
  await new Promise(r => setTimeout(r, seconds * 1000));
} finally { await configure({loss:0}); }
const restoredAt = Date.now();
await new Promise(r => setTimeout(r, 10_000));
const output = resolve(root, '.local/audio-lab/outage-' + seconds + '-recovered.json');
const code = await new Promise(done => {
  const child = spawn(resolve(root,'.local/audio-venv/bin/python'), [resolve(root,'e2e/audio/measure.py'), '--seconds','20','--output', output], {stdio:'inherit'});
  child.on('error', () => done(1)); child.on('exit', done);
});
const entries = (await readFile(resolve(root,'.local/audio-lab/metrics.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
const states = entries.filter(e => e.kind==='state' && e.receivedAt>=startedAt)
  .map(e=>({afterRestoreMs:e.receivedAt-restoredAt,state:e.state}));
await writeFile(resolve(root, '.local/audio-lab/outage-' + seconds + '-timeline.json'), JSON.stringify({seconds, startedAt, restoredAt, states, audioMeasurementExit:code},null,2));
if (code) process.exitCode=1;
