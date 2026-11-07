import { expect, test, vi } from "vitest";
import { presentIncomingCall } from "../apps/mobile/src/services/incomingCallPresentation";

test("cold-start foreground fallback preserves the native PushKit call before coordinator adoption", async () => {
  const report = vi.fn();
  await presentIncomingCall(async () => ({ status: "ringing" }), () => true, report);
  expect(report).not.toHaveBeenCalled();
});

test("answering native call cannot be replaced by a foreground report", async () => {
  const report = vi.fn();
  await presentIncomingCall(async () => ({ status: "connecting" }), () => true, report);
  expect(report).not.toHaveBeenCalled();
});

test("cancellation while native state is being read cannot produce a ghost ring", async () => {
  let finish!: (value: null) => void;
  let ringing = true;
  const report = vi.fn();
  const pending = presentIncomingCall(() => new Promise(resolve => { finish = resolve; }), () => ringing, report);
  ringing = false;
  finish(null);
  await pending;
  expect(report).not.toHaveBeenCalled();
});

test("foreground fallback still rings when no native call exists", async () => {
  const report = vi.fn();
  await presentIncomingCall(async () => null, () => true, report);
  expect(report).toHaveBeenCalledOnce();
});
