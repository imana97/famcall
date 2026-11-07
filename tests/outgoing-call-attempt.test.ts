import { describe, expect, it, vi } from "vitest";
import { type CallRecord } from "@famcall/core";
import { OutgoingCallAttempt } from "../apps/mobile/src/services/OutgoingCallAttempt";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const call = { id: "request-a", status: "ringing" } as CallRecord;
function fixture() {
  const create = deferred<CallRecord>();
  const native = deferred<string>();
  const hooks = {
    isCurrent: vi.fn(() => true), hasEndedLocally: vi.fn(() => false), nativeEnded: vi.fn(() => false),
    create: vi.fn(() => create.promise), startNative: vi.fn(() => native.promise),
    endNative: vi.fn(async () => undefined), persistEnd: vi.fn(async () => undefined),
    record: vi.fn(), ready: vi.fn(), cancelled: vi.fn(), error: vi.fn(),
  };
  return { attempt: new OutgoingCallAttempt(call.id, hooks), hooks, create, native };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("outgoing setup cancellation", () => {
  it("does not ring or write a server cancellation when permission preflight is denied", async () => {
    const { hooks } = fixture();
    const attempt = new OutgoingCallAttempt(call.id, { ...hooks, preflight: async () => false });
    await attempt.run();
    expect(hooks.create).not.toHaveBeenCalled();
    expect(hooks.startNative).not.toHaveBeenCalled();
    expect(hooks.persistEnd).not.toHaveBeenCalled();
    expect(hooks.cancelled).toHaveBeenCalledOnce();
  });

  it("can cancel during permission preflight without starting a late call", async () => {
    const { hooks } = fixture();
    const permission = deferred<boolean>();
    const attempt = new OutgoingCallAttempt(call.id, { ...hooks, preflight: () => permission.promise });
    const run = attempt.run();
    await attempt.cancel();
    permission.resolve(true);
    await run;
    expect(hooks.create).not.toHaveBeenCalled();
    expect(hooks.startNative).not.toHaveBeenCalled();
    expect(hooks.persistEnd).not.toHaveBeenCalled();
  });

  it("persists cancellation before creation resolves and never creates a native call afterward", async () => {
    const { attempt, hooks, create } = fixture();
    const run = attempt.run();
    await attempt.cancel();
    expect(hooks.persistEnd).toHaveBeenCalledOnce();
    create.resolve(call); await run;
    expect(hooks.record).not.toHaveBeenCalled();
    expect(hooks.startNative).not.toHaveBeenCalled();
    expect(hooks.ready).not.toHaveBeenCalled();
  });

  it("closes a late native UUID after cancellation without binding it", async () => {
    const { attempt, hooks, create, native } = fixture();
    const run = attempt.run(); create.resolve(call); await settle();
    expect(hooks.startNative).toHaveBeenCalledOnce();
    await attempt.cancel(); native.resolve("old-native"); await run;
    expect(hooks.endNative).toHaveBeenCalledWith("old-native");
    expect(hooks.ready).not.toHaveBeenCalled();
  });

  it("cannot adopt or report an error from an attempt superseded by a new call", async () => {
    const { attempt, hooks, create, native } = fixture();
    const run = attempt.run(); create.resolve(call); await settle();
    hooks.isCurrent.mockReturnValue(false);
    native.reject(new Error("old-native-failed")); await run;
    expect(hooks.persistEnd).toHaveBeenCalledOnce();
    expect(hooks.ready).not.toHaveBeenCalled();
    expect(hooks.error).not.toHaveBeenCalled();
  });

  it("persists an end intent when the create response fails, since the server may have committed", async () => {
    const { attempt, hooks, create } = fixture();
    const run = attempt.run(); create.reject(new Error("response-lost")); await run;
    expect(hooks.persistEnd).toHaveBeenCalledOnce();
    expect(hooks.error).toHaveBeenCalledWith(expect.objectContaining({ message: "response-lost" }));
    expect(hooks.startNative).not.toHaveBeenCalled();
  });

  it("does not create native ringing from a terminal idempotent server response", async () => {
    const { attempt, hooks, create } = fixture();
    const terminal = { ...call, status: "cancelled" as const };
    const run = attempt.run(); create.resolve(terminal); await run;
    expect(hooks.record).toHaveBeenCalledWith(terminal);
    expect(hooks.startNative).not.toHaveBeenCalled();
  });

  it("does not bind a native session ended before its creation promise resolves", async () => {
    const { attempt, hooks, create, native } = fixture();
    const run = attempt.run(); create.resolve(call); await settle();
    hooks.nativeEnded.mockReturnValue(true); native.resolve("ended-native"); await run;
    expect(hooks.cancelled).toHaveBeenCalledOnce();
    expect(hooks.persistEnd).toHaveBeenCalledOnce();
    expect(hooks.ready).not.toHaveBeenCalled();
  });

  it("retries failed persistence after cancellation instead of reviving the call", async () => {
    const { attempt, hooks, create } = fixture();
    hooks.persistEnd.mockRejectedValueOnce(new Error("storage-unavailable"));
    const run = attempt.run();
    await expect(attempt.cancel()).rejects.toThrow("storage-unavailable");
    create.resolve(call); await run;
    expect(hooks.persistEnd).toHaveBeenCalledTimes(2);
    expect(hooks.startNative).not.toHaveBeenCalled();
  });

  it("binds the matching native UUID for an unchanged live attempt", async () => {
    const { attempt, hooks, create, native } = fixture();
    const run = attempt.run(); create.resolve(call); await settle();
    native.resolve("current-native"); await run;
    expect(hooks.ready).toHaveBeenCalledWith(call, "current-native");
    expect(hooks.persistEnd).not.toHaveBeenCalled();
  });
});
