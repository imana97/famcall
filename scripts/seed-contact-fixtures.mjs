import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const adb = resolve(process.env.ANDROID_HOME ?? resolve(homedir(), 'Library/Android/sdk'), 'platform-tools/adb');
const serial = process.argv[2] ?? 'emulator-5554';
if (!/^emulator-\d+$/.test(serial)) throw new Error('Only dedicated FamCall emulators are allowed.');
const command = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 15_000 }).trim();
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const shell = (...args) => command('shell', args.map(quote).join(' '));
if (!['famcall_a', 'famcall_b'].includes(command('emu', 'avd', 'name').split('\n')[0].trim()) ||
    shell('getprop', 'ro.kernel.qemu') !== '1') throw new Error('Unexpected or physical device refused.');
const account = 'FamCallSelectionFixtures';
const rawUri = 'content://com.android.contacts/raw_contacts';
const dataUri = 'content://com.android.contacts/data';
// Replace only this script's fictional fixtures; never clear the address book.
shell('content', 'delete', '--uri', rawUri, '--where', "account_name='" + account + "'");
const fixtures = [
  { name: 'FamCallNoPhone', numbers: [] },
  { name: 'FamCallManyNumbers', numbers: Array.from({ length: 9 }, (_, i) => '+1202555010' + (i + 1)) },
  { name: 'FamCallOneNumber', numbers: ['+12025550104'] },
];
for (const fixture of fixtures) {
  shell('content', 'insert', '--uri', rawUri, '--bind', 'account_name:s:' + account,
    '--bind', 'account_type:s:com.famcall.test');
  const created = shell('content', 'query', '--uri', rawUri, '--projection', '_id',
    '--where', "account_name='" + account + "'", '--sort', '_id DESC');
  const id = created.match(/_id=(\d+)/)?.[1];
  if (!id) throw new Error('Could not identify created fixture contact.');
  shell('content', 'insert', '--uri', dataUri, '--bind', 'raw_contact_id:i:' + id,
    '--bind', 'mimetype:s:vnd.android.cursor.item/name', '--bind', 'data1:s:' + fixture.name);
  for (const number of fixture.numbers)
    shell('content', 'insert', '--uri', dataUri, '--bind', 'raw_contact_id:i:' + id,
      '--bind', 'mimetype:s:vnd.android.cursor.item/phone_v2', '--bind', 'data1:s:' + number,
      '--bind', 'data2:i:2');
}
await mkdir(resolve(root, '.local'), { recursive: true });
await writeFile(resolve(root, '.local/contact-selection-fixtures.json'), JSON.stringify({ serial, account, fixtures }, null, 2) + '\n');
console.log('Prepared three fictional contacts on the dedicated test emulator.');
