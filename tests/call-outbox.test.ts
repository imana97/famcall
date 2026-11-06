import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ values: new Map<string, string>(), api: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => mocks.values.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { mocks.values.set(key, value); }),
} }));
vi.mock("../apps/mobile/src/services/firebase", () => ({ api: mocks.api }));
import { flushCallOutbox, queueCallEnd, restoreCallOutbox, hasEndedLocally } from "../apps/mobile/src/services/callOutbox";

beforeEach(() => { mocks.values.clear(); mocks.api.mockReset().mockResolvedValue({}); });

describe("durable hangup delivery", () => {
  it("drains an intent queued during an in-flight delivery without waiting for another network event", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    mocks.api.mockReturnValueOnce(pending);
    await queueCallEnd("alice", "first");
    const first = flushCallOutbox("alice");
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
    await queueCallEnd("alice", "second");
    const joined = flushCallOutbox("alice");
    expect(joined).toBe(first);
    release(); await joined;
    expect(mocks.api.mock.calls.map(([, data]) => data.callId)).toEqual(["first", "second"]);
    expect(JSON.parse(mocks.values.get("famcall-call-outbox:alice")!)).toEqual([]);
  });

  it("retains a failed delivery for the next flush", async () => {
    await queueCallEnd("bob", "retry");
    mocks.api.mockRejectedValueOnce({ code: "functions/unavailable" });
    await expect(flushCallOutbox("bob")).rejects.toEqual({ code: "functions/unavailable" });
    expect(JSON.parse(mocks.values.get("famcall-call-outbox:bob")!)).toHaveLength(1);
    await flushCallOutbox("bob");
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.values.get("famcall-call-outbox:bob")!)).toEqual([]);
  });

  it("restores local cancellation from storage before any server delivery", async () => {
    mocks.values.set("famcall-call-outbox:carol", JSON.stringify([{ callId: "restored", createdAt: 1 }]));
    await restoreCallOutbox("carol");
    expect(hasEndedLocally("restored")).toBe(true);
    expect(mocks.api).not.toHaveBeenCalled();
  });
});
