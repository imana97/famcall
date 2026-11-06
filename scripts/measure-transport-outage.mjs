import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const seconds = Number(process.argv[2] ?? 5);
if (![5, 15, 30].includes(seconds)) throw new Error('Choose a 5, 15, or 30 second outage.');
const pause = ms => new Promise(r => setTimeout(r, ms));
const get = async path => { const r = await fetch('http://127.0.0.1:8787/' + path); if (!r.ok) throw new Error('Lab unavailable'); return r.json(); };
const configure = async config => {
  const r = await fetch('http://127.0.0.1:8787/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
  if (!r.ok) throw new Error('Could not configure the lab.');
};
const entries = async () => (await readFile(resolve(root, '.local/audio-lab/metrics.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
function snapshot(rows, callId) {
  const peers = new Map();
  for (const e of rows) {
    if (e.kind !== 'stats' || e.callId !== callId || e.receivedAt < Date.now() - 10_000) continue;
    const byId = new Map(e.rows.map(r => [r.id, r]));
    const transport = e.rows.find(r => r.type === 'transport');
    const pair = byId.get(transport?.selectedCandidatePairId);
    const candidate = byId.get(pair?.localCandidateId);
    const inbound = e.rows.filter(r => r.type === 'inbound-rtp');
    peers.set(e.uid, { at: e.receivedAt, relay: candidate?.candidateType, protocol: candidate?.relayProtocol,
      inbound: Object.fromEntries(inbound.map(r => [r.id, r.packetsReceived ?? 0])) });
  }
  return peers;
}
function advanced(before, after) {
  return before && after && after.at > before.at && Object.entries(after.inbound)
    .some(([id, count]) => count > (before.inbound[id] ?? 0));
}
const initial = await get('status');
if (initial.config.transport !== 'udp' || !initial.config.proxy) throw new Error('This test requires the isolated UDP proxy.');
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]])
  process.once(signal, async () => { try { await configure(initial.config); } finally { process.exit(code); } });
const all = await entries();
const callId = [...all].reverse().find(e => e.kind === 'stats' && e.receivedAt > Date.now() - 10_000)?.callId;
if (!callId) throw new Error('No current lab call.');
const first = snapshot(all, callId);
if (first.size !== 2 || [...first.values()].some(p => p.relay !== 'relay' || p.protocol !== 'udp'))
  throw new Error('Both peers must be using the UDP relay.');
await pause(6500);
const before = snapshot(await entries(), callId);
if ([...first].some(([id, p]) => !advanced(p, before.get(id)))) throw new Error('Media packets are not advancing at both peers.');
const startedAt = Date.now();
const trafficBefore = (await get('status')).traffic;
let restoredAt;
let during;
try {
  await configure({ ...initial.config, loss: 1 });
  console.log(`Blocking relay packets for ${seconds}s; measuring transport only.`);
  await pause(seconds * 1000);
  during = snapshot(await entries(), callId);
} finally {
  await configure(initial.config);
  restoredAt = Date.now();
}
const recovered = new Map();
const deadline = restoredAt + 45_000;
while (Date.now() < deadline && recovered.size < 2) {
  await pause(1000);
  for (const [id, current] of snapshot(await entries(), callId)) {
    if (first.has(id) && current.relay === 'relay' && current.protocol === 'udp' &&
        current.at > restoredAt && advanced(during.get(id), current) && !recovered.has(id))
      recovered.set(id, current.at - restoredAt);
  }
}
const after = await get('status');
const report = {
  scope: 'Native relay transport recovery; this does not prove audible speech recovery.',
  seconds, startedAt, restoredAt, callId, initialConfig: initial.config, labShaper: initial.shaper,
  droppedPackets: after.traffic.dropped - trafficBefore.dropped,
  peerRecoveryMs: [...first.keys()].map(id => recovered.get(id) ?? null),
  transportRecovered: recovered.size === 2 && after.traffic.dropped > trafficBefore.dropped,
  states: (await entries()).filter(e => e.kind === 'state' && e.callId === callId && e.receivedAt >= startedAt)
    .map(e => ({ afterRestoreMs: e.receivedAt - restoredAt, state: e.state })),
};
await writeFile(resolve(root, `.local/audio-lab/transport-outage-${seconds}-${startedAt}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (!report.transportRecovered) process.exitCode = 1;
