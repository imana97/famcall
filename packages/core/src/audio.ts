/** Initial speech settings. Network-test results, not marketing claims, decide later tuning. */
export const AUDIO = {
  bitrate: 16_000,
  constrainedBitrate: 12_000,
  recoveredBitrate: 20_000,
  packetTimeMs: 40,
} as const;

export function tuneOpus(sdp: string, bitrate: number = AUDIO.bitrate): string {
  // Keep video/application sections intact and preserve Opus' mandatory /48000/2 declaration.
  return sdp
    .split(/(?=^m=)/m)
    .map((section) => {
      if (!section.startsWith("m=audio")) return section;
      const payload = section.match(
        /^a=rtpmap:(\d+) opus\/48000\/2\r?$/im,
      )?.[1];
      if (!payload) throw new Error("opus-unavailable");
      const additions: Record<string, string> = {
        maxaveragebitrate: String(bitrate),
        stereo: "0",
        "sprop-stereo": "0",
        useinbandfec: "1",
        usedtx: "1",
        maxplaybackrate: "16000",
      };
      const lines = section.trimEnd().split(/\r?\n/);
      const idx = lines.findIndex((l) =>
        l.startsWith("a=fmtp:" + payload + " "),
      );
      const params = new Map<string, string>();
      if (idx >= 0)
        for (const pair of lines[idx]
          .split(" ")
          .slice(1)
          .join(" ")
          .split(";")) {
          const [key, value] = pair.trim().split("=");
          if (key) params.set(key, value ?? "");
        }
      Object.entries(additions).forEach(([k, v]) => params.set(k, v));
      const fmtp =
        "a=fmtp:" +
        payload +
        " " +
        [...params].map(([k, v]) => k + "=" + v).join(";");
      if (idx < 0) lines.push(fmtp);
      else lines[idx] = fmtp;
      const filtered = lines.filter((l) => !l.startsWith("a=ptime:"));
      filtered.push("a=ptime:" + AUDIO.packetTimeMs);
      return filtered.join("\r\n") + "\r\n";
    })
    .join("");
}

export interface AudioCounters {
  timestampMs: number;
  packetsReceived: number;
  packetsLost: number;
  bytesReceived: number;
  totalAudioEnergy?: number;
  totalSamplesDuration?: number;
  concealedSamples?: number;
  totalSamplesReceived?: number;
}
export function audioInterval(before: AudioCounters, after: AudioCounters) {
  const duration = (after.timestampMs - before.timestampMs) / 1000;
  if (
    duration <= 0 ||
    after.packetsReceived < before.packetsReceived ||
    after.bytesReceived < before.bytesReceived
  )
    return null;
  const received = after.packetsReceived - before.packetsReceived;
  // Late packets can reduce the cumulative loss count; never report negative loss.
  const lost = Math.max(0, after.packetsLost - before.packetsLost);
  const energy =
    (after.totalAudioEnergy ?? NaN) - (before.totalAudioEnergy ?? NaN);
  const samplesDuration =
    (after.totalSamplesDuration ?? NaN) - (before.totalSamplesDuration ?? NaN);
  return {
    durationSeconds: duration,
    packetsReceived: received,
    lossFraction: received + lost > 0 ? lost / (received + lost) : null,
    receivedBitrate:
      (8 * (after.bytesReceived - before.bytesReceived)) / duration,
    rms:
      energy >= 0 && samplesDuration > 0
        ? Math.sqrt(energy / samplesDuration)
        : null,
  };
}
