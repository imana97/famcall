import { describe, expect, it, vi } from "vitest";
import type { CallSession } from "expo-callkit-telecom";
import { NativeCallCoordinator } from "../apps/mobile/src/services/NativeCallCoordinator";
import type { NativeEvent } from "../apps/mobile/src/services/nativeEvents";

const session = (id: string, isMuted = false) => ({
  id, origin: "incoming", status: "ringing", isMuted,
  incomingCallEvent: { serverCallId: "server-" + id },
} as CallSession);
const added = (value: CallSession): NativeEvent => ({ kind: "session", event: { session: value } });
const mute = (id: string, isMuted: boolean): NativeEvent => ({ kind: "mute", event: { id, isMuted } });
const answer = (id: string): NativeEvent => ({ kind: "answer", event: { id, requestId: "request-" + id } });
const ended = (value: CallSession): NativeEvent => ({ kind: "end", event: { id: value.id, session: value } } as NativeEvent);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(ready: Promise<unknown> = Promise.resolve()) {
  let active: string | null = null;
  const hooks = {
    ready, getActive: vi.fn<() => Promise<CallSession | null>>().mockResolvedValue(null),
    getActiveId: () => active, hasEndedLocally: vi.fn(() => false),
    adopt: vi.fn((value: CallSession) => { active = value.id; }),
    mute: vi.fn(), answer: vi.fn(),
    end: vi.fn((event: { id: string }) => { if (active === event.id) active = null; }),
    dismiss: vi.fn(), error: vi.fn(),
  };
  return { coordinator: new NativeCallCoordinator(hooks), hooks };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("native call startup and delayed actions", () => {
  it("restores the native session's existing mute state", async () => {
    const { coordinator, hooks } = fixture();
    hooks.getActive.mockResolvedValue(session("a", true));
    await coordinator.start();
    expect(hooks.adopt).toHaveBeenCalledWith(expect.objectContaining({ id: "a", isMuted: true }));
  });

  it("keeps a mute event that arrives before local hangup storage is restored", async () => {
    const storage = deferred<void>();
    const { coordinator, hooks } = fixture(storage.promise);
    coordinator.handle(added(session("a")));
    coordinator.handle(mute("a", true));
    const started = coordinator.start();
    expect(hooks.adopt).not.toHaveBeenCalled();
    storage.resolve(); await started;
    expect(hooks.adopt).toHaveBeenCalledWith(expect.objectContaining({ id: "a", isMuted: true }));
    expect(hooks.mute).toHaveBeenCalledWith(expect.objectContaining({ id: "a", isMuted: true }));
  });

  it("uses a newer mute event instead of an older in-flight session snapshot", async () => {
    const lookup = deferred<CallSession | null>();
    const { coordinator, hooks } = fixture();
    hooks.getActive.mockReturnValue(lookup.promise);
    const started = coordinator.start(); await settle();
    coordinator.handle(mute("a", true));
    lookup.resolve(session("a", false)); await started;
    expect(hooks.adopt).toHaveBeenCalledWith(expect.objectContaining({ id: "a", isMuted: true }));
  });

  it("does not resurrect a call ended while the startup lookup was pending", async () => {
    const lookup = deferred<CallSession | null>();
    const { coordinator, hooks } = fixture();
    hooks.getActive.mockReturnValue(lookup.promise);
    const started = coordinator.start(); await settle();
    coordinator.handle(ended(session("a")));
    expect(hooks.end).toHaveBeenCalledOnce();
    lookup.resolve(session("a")); await started;
    expect(hooks.adopt).not.toHaveBeenCalled();
  });

  it("cannot restore an old snapshot after a newer call started and ended", async () => {
    const lookup = deferred<CallSession | null>();
    const { coordinator, hooks } = fixture();
    hooks.getActive.mockReturnValueOnce(lookup.promise).mockResolvedValue(null);
    const started = coordinator.start(); await settle();
    coordinator.handle(added(session("b")));
    coordinator.handle(ended(session("b")));
    lookup.resolve(session("a")); await started;
    expect(hooks.adopt.mock.calls.map(([s]) => s.id)).toEqual(["b"]);
    expect(hooks.getActive).toHaveBeenCalledTimes(2);
  });

  it("does not apply an old call's mute action or answer request to the current call", async () => {
    const { coordinator, hooks } = fixture();
    await coordinator.start();
    coordinator.handle(added(session("b")));
    coordinator.handle(mute("a", true));
    hooks.getActive.mockResolvedValue(session("b"));
    coordinator.handle(answer("a")); await settle();
    expect(hooks.mute).not.toHaveBeenCalled();
    expect(hooks.answer).not.toHaveBeenCalled();
    expect(hooks.getActiveId()).toBe("b");
  });

  it("delivers an answer only for its matching live session, with the latest mute state", async () => {
    const { coordinator, hooks } = fixture();
    await coordinator.start();
    coordinator.handle(added(session("a")));
    coordinator.handle(mute("a", true));
    hooks.getActive.mockResolvedValue(session("a", false));
    coordinator.handle(answer("a")); await settle();
    expect(hooks.answer).toHaveBeenCalledWith(expect.objectContaining({ id: "a", isMuted: true }), "request-a");
  });

  it("processes hangup immediately while an answer lookup is stalled", async () => {
    const lookup = deferred<CallSession | null>();
    const { coordinator, hooks } = fixture();
    await coordinator.start();
    coordinator.handle(added(session("a")));
    hooks.getActive.mockReturnValue(lookup.promise);
    coordinator.handle(answer("a"));
    coordinator.handle(ended(session("a")));
    expect(hooks.end).toHaveBeenCalledOnce();
    lookup.resolve(session("a")); await settle();
    expect(hooks.answer).not.toHaveBeenCalled();
    expect(hooks.getActiveId()).toBeNull();
  });

  it("dismisses a locally ended call after reading the durable outbox", async () => {
    const { coordinator, hooks } = fixture();
    hooks.hasEndedLocally.mockReturnValue(true);
    hooks.getActive.mockResolvedValue(session("a"));
    await coordinator.start();
    expect(hooks.dismiss).toHaveBeenCalledWith("a");
    expect(hooks.adopt).not.toHaveBeenCalled();
  });

  it("discards an in-flight answer after the account listener is disposed", async () => {
    const lookup = deferred<CallSession | null>();
    const { coordinator, hooks } = fixture();
    await coordinator.start();
    hooks.getActive.mockReturnValue(lookup.promise);
    coordinator.handle(answer("a"));
    coordinator.dispose(); lookup.resolve(session("a")); await settle();
    expect(hooks.adopt).not.toHaveBeenCalled();
    expect(hooks.answer).not.toHaveBeenCalled();
  });

  it("accepts a matching new answer after an old call ended even if its added event was missed", async () => {
    const { coordinator, hooks } = fixture();
    await coordinator.start();
    coordinator.handle(added(session("a")));
    coordinator.handle(ended(session("a")));
    hooks.getActive.mockResolvedValue(session("b", true));
    coordinator.handle(answer("b")); await settle();
    expect(hooks.answer).toHaveBeenCalledWith(expect.objectContaining({ id: "b", isMuted: true }), "request-b");
  });

  it("handles end immediately and refuses adoption when durable outbox restoration fails", async () => {
    const storage = deferred<void>();
    const { coordinator, hooks } = fixture(storage.promise);
    coordinator.handle(added(session("a")));
    const started = coordinator.start();
    coordinator.handle(ended(session("a")));
    expect(hooks.end).toHaveBeenCalledOnce();
    expect(hooks.end).toHaveBeenCalledWith(expect.objectContaining({
      id: "a", session: expect.objectContaining({ incomingCallEvent: { serverCallId: "server-a" } }),
    }));
    storage.reject(new Error("storage-unavailable")); await started;
    expect(hooks.error).toHaveBeenCalledWith(expect.objectContaining({ message: "storage-unavailable" }));
    expect(hooks.adopt).not.toHaveBeenCalled();
    expect(hooks.getActive).not.toHaveBeenCalled();
  });
});
