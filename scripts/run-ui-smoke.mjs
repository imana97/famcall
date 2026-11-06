import {spawn} from 'node:child_process';
import {mkdir, open} from 'node:fs/promises';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
const maestro = process.env.MAESTRO_BIN ?? 'maestro';
const steps = [
  ['a', 'open-people'], ['b', 'open-people'],
  ['a', 'start-call'], ['b', 'decline-call'], ['a', 'dismiss-ended'],
  ['b', 'block-history'], ['a', 'blocked-call'], ['b', 'unblock'],
  ['a', 'start-call'], ['b', 'answer-call'],
];
await mkdir(resolve(root, '.local/ui-smoke'), {recursive: true});
for (const [peer, flow] of steps) {
  console.log(peer + ': ' + flow);
  const log = await open(resolve(root, '.local/ui-smoke', peer + '-' + flow + '.log'), 'w');
  const status = await new Promise(done => {
    const child = spawn(maestro, ['--device', peer === 'a' ? 'emulator-5554' : 'emulator-5556',
      'test', resolve(root, 'e2e/maestro', flow + '.yaml')], {cwd: root, stdio: ['ignore', log.fd, log.fd]});
    child.on('error', () => done(1));
    child.on('exit', done);
  });
  await log.close();
  if (status !== 0) throw new Error('Flow failed: ' + peer + '/' + flow);
}
console.log('UI smoke passed. The final call remains connected for audio measurements.');
