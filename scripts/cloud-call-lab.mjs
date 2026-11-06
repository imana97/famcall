import http from 'node:http';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Reachable only through the authenticated provider tunnel. No admin or TURN API.
const runId = process.argv[2];
if (!/^[0-9a-f-]{36}$/.test(runId ?? '')) throw new Error('Supply a fresh run UUID.');
const directory = resolve('.local/cloud-testing', runId);
await mkdir(directory, { recursive: true, mode: 0o700 });
const events = new Map();
const hosts = new Set(['127.0.0.1:8787', 'localhost:8787', 'bs-local.com:8787']);
const roles = new Set(['caller', 'callee']);
const stages = new Set(['ready', 'connected', 'finished']);
let sequence = 0;
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, body = {}) => res.writeHead(status).end(JSON.stringify(body));
  if (!hosts.has(req.headers.host)) return reply(403);
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/config')
    return reply(200, { transport: 'udp', proxy: false, callStartGate: 'none' });
  if (req.method === 'GET' && url.pathname === '/status')
    return reply(200, { runId, samples: sequence, events: Object.fromEntries(events) });
  if (req.method === 'GET' && url.pathname === '/event') {
    if (url.searchParams.get('run') !== runId) return reply(404);
    const role = url.searchParams.get('role'), stage = url.searchParams.get('stage');
    if (!roles.has(role) || !stages.has(stage)) return reply(400);
    // Bound the runner's polling rate without a fixed sleep in the UI flow.
    await new Promise(resolve => setTimeout(resolve, 1000));
    const at = events.get(role + ':' + stage) ?? null;
    return reply(200, { at, elapsed: at ? Date.now() - at : 0 });
  }
  if (req.method !== 'POST' || !['/metrics', '/event'].includes(url.pathname)) return reply(404);
  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 65_536) return reply(413);
    }
    const data = JSON.parse(body);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400);
    if (url.pathname === '/event') {
      if (data.run !== runId) return reply(404);
      if (!roles.has(data.role) || !stages.has(data.stage)) return reply(400);
      const key = data.role + ':' + data.stage;
      if (!events.has(key)) events.set(key, Date.now());
      await writeFile(resolve(directory, 'events.json'), JSON.stringify(Object.fromEntries(events), null, 2));
      return reply(200, { at: events.get(key) });
    }
    await appendFile(resolve(directory, 'metrics.jsonl'), JSON.stringify({ ...data, receivedAt: Date.now(), sequence: ++sequence }) + '\n');
    reply(200, { ok: true });
  } catch { reply(400); }
});
server.listen(8787, '127.0.0.1', () => console.log(JSON.stringify({ runId, directory, ready: true })));
const stop = () => { server.close(); server.closeAllConnections(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
