import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const officialStoreUrls = {
  appStore: 'https://apps.apple.com/app/id6831551843',
  googlePlay: 'https://play.google.com/store/apps/details?id=com.silvergridtech.famcall',
};
export async function publicStoreAvailability(fetchPage = fetch) {
  const stores = {};
  for (const [name, url] of Object.entries(officialStoreUrls)) {
    const response = await fetchPage(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) { stores[name] = { url, available: false }; continue; }
    if (!response.ok) throw new Error('Cannot verify ' + name + ' public availability: ' + response.status);
    const html = await response.text();
    // A generic store landing page or another app must not enable a download badge.
    const identifier = name === 'appStore' ? '6831551843' : 'com.silvergridtech.famcall';
    if (!html.includes(identifier) || !/famcall/i.test(html)) throw new Error('Unexpected ' + name + ' public page');
    stores[name] = { url, available: true };
  }
  return stores;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = resolve('website/store-links.json');
  // Refuse accidental changes to the registered official destinations.
  const saved = JSON.parse(await readFile(output, 'utf8'));
  for (const [name, url] of Object.entries(officialStoreUrls)) {
    if (saved[name]?.url !== url) throw new Error('Unexpected configured store URL');
  }
  const stores = await publicStoreAvailability();
  await writeFile(output, JSON.stringify(stores, null, 2) + '\n');
  console.log('Verified public store pages: ' + Object.entries(stores).map(([name, value]) => name + '=' + (value.available ? 'live' : 'coming soon')).join(', '));
}
