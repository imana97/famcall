/** Reconcile an already-present native call before the foreground fallback reports one. */
export async function presentIncomingCall(
  getActive: () => Promise<{ status: string } | null>,
  stillRinging: () => boolean,
  report: () => Promise<unknown>,
): Promise<void> {
  const active = await getActive();
  // PushKit may have reported the call while the JS coordinator was starting.
  // A native call also owns the surface when it belongs to another server call.
  if (!stillRinging() || (active && active.status !== "ended")) return;
  await report();
}
