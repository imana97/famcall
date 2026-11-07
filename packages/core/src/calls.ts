export const RING_TIMEOUT_MS = 45_000;
export const MAX_CALL_MS = 4 * 60 * 60 * 1_000;
export const CALL_LEASE_MS = 180_000;
export const HISTORY_DAYS = 90;
export type CallStatus =
  | "ringing"
  | "accepted"
  | "ended"
  | "declined"
  | "missed"
  | "cancelled"
  | "failed";
export type CallAction =
  "accept" | "decline" | "cancel" | "hangup" | "end" | "timeout" | "fail";
export type Role = "caller" | "callee" | "system";
export const TERMINAL: readonly CallStatus[] = [
  "ended",
  "declined",
  "missed",
  "cancelled",
  "failed",
];
export const isTerminal = (status: CallStatus) => TERMINAL.includes(status);

export interface CallRecord {
  id: string;
  callerId: string;
  calleeId: string;
  callerPhone: string;
  calleePhone: string;
  participants: string[];
  status: CallStatus;
  createdAtMs: number;
  ringExpiresAtMs: number;
  acceptedAtMs?: number;
  endedAtMs?: number;
  connectedAtMs?: number;
}

/** Called inside a server transaction; terminal calls cannot be resurrected. */
export function nextCallStatus(
  status: CallStatus,
  action: CallAction,
  role: Role,
): CallStatus {
  if (isTerminal(status)) return status;
  // The user's intent survives a concurrent answer/cancel race.
  if (action === "end" && role !== "system")
    return status === "accepted"
      ? "ended"
      : role === "caller"
        ? "cancelled"
        : "declined";
  if (action === "fail" && role === "system") return "failed";
  if (status === "ringing") {
    if (action === "accept" && role === "callee") return "accepted";
    if (action === "decline" && role === "callee") return "declined";
    if (action === "cancel" && role === "caller") return "cancelled";
    if (action === "timeout" && role === "system") return "missed";
  }
  if (status === "accepted" && action === "hangup" && role !== "system")
    return "ended";
  throw new Error("invalid-call-transition");
}

export function historyKind(
  call: CallRecord,
  userId: string,
): "incoming" | "outgoing" | "missed" {
  if (call.callerId === userId) return "outgoing";
  return call.status === "missed" || call.status === "cancelled"
    ? "missed"
    : "incoming";
}
