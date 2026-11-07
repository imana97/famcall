import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Observe an already-connected lab call. This never injects or scores speech.
const root = resolve(import.meta.dirname, '..');
const expected = process.argv[2] ?? 'udp';
const seconds = Number(process.argv[3] ?? 30);
if (!['udp', 'tcp', 'tls', 'direct'].includes(expected) || !Number.isFinite(seconds) || seconds < 15 || seconds > 7200)
  throw new Error('Usage: node scripts/measure-transport-session.mjs udp|tcp|tls|direct [15..7200 seconds]');
const pause = ms => new Promise(r => setTimeout(r, ms));
const entries = async () => (await readFile(resolve(root, '.local/audio-lab/metrics.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const startedAt = Date.now();
const initial = await entries();
const callId = [...initial].reverse().find(e => e.kind === 'stats' && e.receivedAt > startedAt - 10_000)?.callId;
if (!callId || !/^[a-f0-9-]{36}$/.test(callId)) throw new Error('No current lab call.');

async function generations() {
  // Only the local, fictional Firebase demo project; never store SDP or ICE passwords.
  const response = await fetch('http://127.0.0.1:8080/v1/projects/demo-famcall/databases/(default)/documents/calls/' + callId + '/signals', {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!response.ok) throw new Error('Cannot inspect the local demo signaling state.');
  const data = await response.json();
  return (data.documents ?? []).map(d => ({
    type: d.fields?.type?.stringValue,
    generation: Number(d.fields?.generation?.integerValue),
    updatedAt: d.updateTime,
  })).sort((a, b) => String(a.type).localeCompare(String(b.type)));
}
const initialGenerations = await generations();
console.log(`Observing ${expected} transport for ${seconds}s; this does not test speech.`);
const timeline = [];
while (Date.now() - startedAt < seconds * 1000) {
  await pause(Math.min(10_000, seconds * 1000 - (Date.now() - startedAt)));
  const current = await entries();
  const latest = new Map();
  for (const e of current) if (e.kind === 'stats' && e.callId === callId && e.receivedAt > Date.now() - 10_000) latest.set(e.uid, e);
  timeline.push({ elapsedMs: Date.now() - startedAt, reportingPeers: latest.size, generations: await generations() });
}
const finishedAt = Date.now();
const observed = (await entries()).filter(e => e.callId === callId && e.receivedAt >= startedAt && e.receivedAt <= finishedAt);
const rows = observed.filter(e => e.kind === 'stats');
const peers = new Map();
for (const e of rows) {
  const byId = new Map(e.rows.map(r => [r.id, r]));
  const transport = e.rows.find(r => r.type === 'transport');
  const pair = byId.get(transport?.selectedCandidatePairId);
  const candidate = byId.get(pair?.localCandidateId);
  const inbound = e.rows.filter(r => r.type === 'inbound-rtp');
  const list = peers.get(e.uid) ?? [];
  list.push({ at: e.receivedAt, type: candidate?.candidateType, protocol: candidate?.relayProtocol,
    packets: inbound.reduce((n, r) => n + (r.packetsReceived ?? 0), 0) });
  peers.set(e.uid, list);
}
const reasons = [];
if (peers.size !== 2 || timeline.some(t => t.reportingPeers !== 2)) reasons.push('Missing current statistics from both participants');
const peerWindows = [...peers.values()].map(samples => {
  const first = samples[0], last = samples.at(-1);
  if (last.at - first.at < seconds * 1000 * 0.7 || finishedAt - last.at > 10_000) reasons.push('Insufficient transport observation window');
  if (samples.some(p => expected === 'direct' ? !['host', 'srflx', 'prflx'].includes(p.type) : p.type !== 'relay' || p.protocol !== expected)) reasons.push('Selected path did not match requested transport');
  // DTX may reduce traffic while silent; ten-second windows should still advance.
  let progressAt = first.at, previous = first.packets, longestStallMs = 0;
  for (const p of samples.slice(1)) {
    if (p.packets > previous) progressAt = p.at;
    longestStallMs = Math.max(longestStallMs, p.at - progressAt);
    previous = p.packets;
  }
  if (last.packets <= first.packets || longestStallMs > 10_000) reasons.push('Received packets stopped advancing');
  return { observedSeconds: (last.at - first.at) / 1000, packetsReceived: last.packets - first.packets, longestStallMs,
    paths: [...new Set(samples.map(p => p.type + '/' + (p.protocol ?? 'none')))] };
});
const finalGenerations = await generations();
const report = {
  scope: 'Native selected-path and packet continuity only; no speech, automatic fallback, or physical-device claim.',
  expected, seconds, startedAt, finishedAt, callId, initialGenerations, finalGenerations, timeline, peerWindows,
  states: observed.filter(e => e.kind === 'state').map(e => ({ elapsedMs: e.receivedAt - startedAt, state: e.state })),
  renegotiated: finalGenerations.length === 2 && initialGenerations.length === 2 && finalGenerations.every((g, i) => g.generation > initialGenerations[i].generation),
  transportValid: reasons.length === 0, invalidReasons: [...new Set(reasons)],
};
const output = resolve(root, `.local/audio-lab/transport-${expected}-${startedAt}.json`);
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (!report.transportValid) process.exitCode = 1;
