import http from "node:http";
import dgram from "node:dgram";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const local = resolve(import.meta.dirname, "../.local/audio-lab");
await mkdir(local, { recursive: true });
const configuration = resolve(local, "config.json");
let config = {
  transport: "udp",
  proxy: true,
  loss: 0,
  delayMs: 0,
  jitterMs: 0,
  kbps: 0,
};
try {
  config = { ...config, ...JSON.parse(await readFile(configuration, "utf8")) };
} catch {
  /* New run. */
}
await writeFile(configuration, JSON.stringify(config, null, 2));
let sequence = 0;
const metrics = resolve(local, "metrics.jsonl");
const traffic = { sent: 0, dropped: 0, bytes: 0, estimatedIpBytes: 0 };
const shaper = { version: 2, ipVersion: 4, udpIpHeaderBytes: 28, excludes: 'link-layer and VPN overhead' };
const allowed = new Set(["127.0.0.1:8787", "10.0.2.2:8787", "localhost:8787"]);
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  if (!allowed.has(req.headers.host)) return res.writeHead(403).end("{}");
  if (req.url === "/config" && req.method === "GET")
    return res.end(JSON.stringify(config));
  if (req.url === "/status" && req.method === "GET")
    return res.end(JSON.stringify({ config, traffic, shaper, samples: sequence }));
  if (
    req.method !== "POST" ||
    !["/config", "/metrics", "/mark"].includes(req.url)
  )
    return res.writeHead(404).end("{}");
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65_536) return res.writeHead(413).end("{}");
  }
  try {
    const data = JSON.parse(body);
    if (req.url === "/config") {
      const next = { ...config, ...data };
      if (
        !["udp", "tcp", "tls", "direct"].includes(next.transport) ||
        typeof next.proxy !== "boolean" ||
        !Number.isFinite(next.loss) ||
        next.loss < 0 ||
        next.loss > 1 ||
        ![next.delayMs, next.jitterMs, next.kbps].every(
          (v) => Number.isFinite(v) && v >= 0 && v <= 100_000,
        )
      )
        return res.writeHead(400).end("{}");
      config = next;
      await writeFile(configuration, JSON.stringify(config, null, 2));
      await appendFile(
        metrics,
        JSON.stringify({ kind: "configuration", at: Date.now(), config }) +
          "\n",
      );
    } else {
      sequence++;
      await appendFile(
        metrics,
        JSON.stringify({ ...data, receivedAt: Date.now(), sequence }) + "\n",
      );
    }
    res.end('{"ok":true}');
  } catch {
    res.writeHead(400).end("{}");
  }
});
server.listen(8787, "127.0.0.1");

// Impair only this experiment's UDP relay traffic. Each client receives a
// separate upstream socket so TURN allocations and return traffic stay isolated.
const listener = dgram.createSocket("udp4");
const clients = new Map();
let seed = 0xfacecafe;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};
function forward(message, endpoint, send) {
  if (random() < config.loss) {
    traffic.dropped++;
    return;
  }
  const now = Date.now();
  // UDP sockets expose payload only. Include the IPv4 + UDP headers in the cap.
  const ipBytes = message.length + shaper.udpIpHeaderBytes;
  const serializationMs = config.kbps ? (ipBytes * 8) / config.kbps : 0;
  const start = Math.max(now, endpoint.nextAt ?? 0);
  const delay = Math.max(
    0,
    start - now + serializationMs + config.delayMs + (random() * 2 - 1) * config.jitterMs,
  );
  // A bounded queue represents congestion rather than accumulating stale audio forever.
  if (delay > 3000) {
    traffic.dropped++;
    return;
  }
  endpoint.nextAt = start + serializationMs;
  setTimeout(() => {
    traffic.sent++;
    traffic.bytes += message.length;
    traffic.estimatedIpBytes += ipBytes;
    send();
  }, delay);
}
listener.on("message", (message, address) => {
  const id = address.address + ":" + address.port;
  let client = clients.get(id);
  if (!client) {
    const socket = dgram.createSocket("udp4");
    client = { socket, up: {}, down: {}, seenAt: Date.now() };
    clients.set(id, client);
    socket.on("error", () => {});
    socket.on("message", (reply) =>
      forward(reply, client.down, () =>
        listener.send(reply, address.port, address.address),
      ),
    );
  }
  client.seenAt = Date.now();
  forward(message, client.up, () =>
    client.socket.send(message, 3478, "turn.cloudflare.com"),
  );
});
listener.bind(3479, "127.0.0.1");
const cleanup = setInterval(() => {
  for (const [id, client] of clients)
    if (Date.now() - client.seenAt > 120_000) {
      client.socket.close();
      clients.delete(id);
    }
}, 30_000);
function stop() {
  clearInterval(cleanup);
  for (const c of clients.values()) c.socket.close();
  listener.close();
  server.close();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log(
  "Audio lab ready on loopback: metrics 8787, impaired UDP relay 3479. No microphone is captured.",
);
