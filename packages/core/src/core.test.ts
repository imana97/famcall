import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  normalizeDigits,
  nextCallStatus,
  tuneOpus,
  audioInterval,
} from "./index";

describe("international usernames", () => {
  it("unifies international prefixes and formatting", () => {
    for (const input of [
      "+1 (202) 555-0101",
      "0012025550101",
      "+۱۲۰۲۵۵۵۰۱۰۱",
      "+١٢٠٢٥٥٥٠١٠١",
      "+१२०२५५५०१०१",
      "+১২০২৫৫৫০১০১",
      "+１２０２５５５０１０１",
    ]) {
      expect(normalizePhone(input)).toBe("+12025550101");
    }
  });
  it("normalizes verification codes without dropping localized digits", () => {
    for (const input of ["123456", "١٢٣٤٥٦", "۱۲۳۴۵۶", "१२३४५६", "১২৩৪৫৬", "１２３４５６"]) {
      expect(normalizeDigits(input)).toBe("123456");
    }
    expect(normalizeDigits("code १२३४५६")).toBe("code 123456");
  });
  it("rejects local numbers, extensions, embedded text and invalid country codes", () => {
    for (const input of [
      "2025550101",
      "+12025550101x123",
      "call +12025550101",
      "+999123456789",
      "+1",
    ]) {
      expect(() => normalizePhone(input)).toThrow();
    }
  });
});

describe("call authorization and races", () => {
  it("only the callee can answer", () => {
    expect(nextCallStatus("ringing", "accept", "callee")).toBe("accepted");
    expect(() => nextCallStatus("ringing", "accept", "caller")).toThrow();
  });
  it("keeps an expired or cancelled call closed after a late answer", () => {
    for (const status of ["missed", "cancelled", "ended"] as const) {
      expect(nextCallStatus(status, "accept", "callee")).toBe(status);
    }
  });
  it("does not let a caller declare a missed call or decline for the callee", () => {
    expect(() => nextCallStatus("ringing", "timeout", "caller")).toThrow();
    expect(() => nextCallStatus("ringing", "decline", "caller")).toThrow();
  });
});

describe("speech transport", () => {
  it("preserves other media and existing codec options when tuning audio", () => {
    const sdp =
      "v=0\r\nm=audio 9 RTP/AVP 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;stereo=1\r\na=ptime:20\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
    const result = tuneOpus(sdp);
    expect(result).toContain("minptime=10;stereo=0");
    expect(result).toContain("usedtx=1");
    expect(result).toContain("a=ptime:40");
    expect(
      result.endsWith("m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"),
    ).toBe(true);
    expect(tuneOpus(result)).toBe(result);
  });
  it("measures intervals rather than hiding new loss in lifetime averages", () => {
    const before = {
      timestampMs: 1000,
      packetsReceived: 1000,
      packetsLost: 0,
      bytesReceived: 10000,
    };
    expect(
      audioInterval(before, {
        timestampMs: 2000,
        packetsReceived: 1010,
        packetsLost: 10,
        bytesReceived: 11000,
      })?.lossFraction,
    ).toBe(0.5);
    expect(
      audioInterval(before, {
        timestampMs: 2000,
        packetsReceived: 1,
        packetsLost: 0,
        bytesReceived: 10,
      }),
    ).toBeNull();
  });
});
