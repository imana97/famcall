import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Capture only the test app's native logs, privately, for the lifetime of a case. */
export async function captureNativeLogs(adb, folder, prefix) {
  const entries = [];
  const stop = async () => {
    for (const entry of entries)
      if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill('SIGTERM');
    for (const entry of entries) {
      const deadline = setTimeout(() => entry.child.kill('SIGKILL'), 5000);
      const exit = await entry.exited;
      clearTimeout(deadline);
      await entry.file.close();
      const bytes = await readFile(entry.path);
      entry.record.stoppedAt = Date.now();
      entry.record.exit = exit;
      entry.record.bytes = bytes.length;
      entry.record.sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    await writeFile(resolve(folder, prefix + '-native-log-capture.json'), JSON.stringify({
      scope: 'Private Android test-app logs; may contain sensitive diagnostic values. Never publish raw logs. PID filtering does not follow an app process restart.',
      captures: entries.map(entry => entry.record),
    }, null, 2) + '\n');
  };
  try {
    for (const serial of ['emulator-5554', 'emulator-5556']) {
      const pid = execFileSync(adb, ['-s', serial, 'shell', 'pidof', 'com.silvergridtech.famcall.e2e'], {
        encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (!/^\d+$/.test(pid)) throw new Error('Expected one isolated test-app process on ' + serial);
      const name = prefix + '-' + serial + '-native.log';
      const path = resolve(folder, name);
      const file = await open(path, 'w');
      const child = spawn(adb, ['-s', serial, 'logcat', '--pid=' + pid, '-v', 'epoch', '-T', '1'], {
        stdio: ['ignore', file.fd, file.fd],
      });
      const exited = new Promise(done => {
        child.once('exit', (code, signal) => done({ code, signal }));
        child.once('error', error => done({ error: error.message }));
      });
      entries.push({ child, exited, file, path, record: { serial, pid, file: name, startedAt: Date.now() } });
      await new Promise((done, fail) => { child.once('spawn', done); child.once('error', fail); });
    }
    return stop;
  } catch (error) { await stop(); throw error; }
}

export async function captureAudioState(adb, folder, prefix, phase) {
  for (const serial of ['emulator-5554', 'emulator-5556']) {
    const state = { serial, phase, capturedAt: Date.now(), dumps: {} };
    for (const service of ['audio', 'media.audio_flinger']) {
      try {
        state.dumps[service] = execFileSync(adb, ['-s', serial, 'shell', 'dumpsys', service], {
          encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 2 * 1024 * 1024,
        });
      } catch { state.dumps[service] = { unavailable: true }; }
    }
    await writeFile(resolve(folder, prefix + '-' + serial + '-audio-' + phase + '.json'), JSON.stringify(state, null, 2) + '\n');
  }
}
