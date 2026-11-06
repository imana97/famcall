import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import {
  onCall,
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { deliverIncoming, deliverEnded, pushSecrets } from "./push";
import { z } from "zod";
import {
  HISTORY_DAYS,
  MAX_CALL_MS,
  CALL_LEASE_MS,
  RING_TIMEOUT_MS,
  isTerminal,
  nextCallStatus,
  normalizePhone,
  type CallRecord,
} from "@famcall/core";

initializeApp();
setGlobalOptions({
  region: "us-east1",
  maxInstances: 2,
  minInstances: 0,
  memory: "256MiB",
  timeoutSeconds: 30,
  ...(process.env.FUNCTIONS_EMULATOR === "true" ? {} : {
    serviceAccount: "famcall-runtime@" + (process.env.GCLOUD_PROJECT ?? "famcall") + ".iam.gserviceaccount.com",
  }),
});
const db = getFirestore();
const turnId = defineSecret("CLOUDFLARE_TURN_KEY_ID");
const turnToken = defineSecret("CLOUDFLARE_TURN_API_TOKEN");
const secure = { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" };
const callIdSchema = z.string().uuid();
const ttl = (days: number) =>
  Timestamp.fromMillis(Date.now() + days * 86_400_000);

async function identity(request: CallableRequest) {
  if (
    !request.auth?.uid ||
    !request.auth.token.phone_number ||
    request.auth.token.firebase?.sign_in_provider !== "phone"
  ) {
    throw new HttpsError("unauthenticated", "Verify your phone number first.");
  }
  if ((await db.doc("accountDeletions/" + request.auth.uid).get()).exists)
    throw new HttpsError("permission-denied", "This account is being deleted.");
  return {
    uid: request.auth.uid,
    phone: normalizePhone(String(request.auth.token.phone_number)),
  };
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpsError(
      "invalid-argument",
      "Check the details and try again.",
    );
  return result.data;
}
function phone(input: unknown) {
  try {
    return normalizePhone(parse(z.string().max(80), input));
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "Use a valid number with its country code.",
    );
  }
}
async function rateLimit(
  uid: string,
  scope: string,
  limit: number,
  windowMs: number,
) {
  const bucket = Math.floor(Date.now() / windowMs);
  const ref = db.doc("limits/" + uid + "_" + scope + "_" + bucket);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const count = Number(snap.data()?.count ?? 0);
    if (count >= limit)
      throw new HttpsError(
        "resource-exhausted",
        "Please wait before trying again.",
      );
    t.set(ref, { count: count + 1, expiresAt: ttl(2) });
  });
}
async function targetFor(number: string): Promise<string | null> {
  try {
    const u = await getAuth().getUserByPhoneNumber(number);
    return u.disabled ? null : u.uid;
  } catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found")
      return null;
    throw new HttpsError("unavailable", "Please try again shortly.");
  }
}

export const registerProfile = onCall(secure, async (request) => {
  const { uid, phone } = await identity(request);
  await db
    .doc("users/" + uid)
    .set({ phone, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { phone };
});

export const saveContact = onCall(secure, async (request) => {
  const { uid } = await identity(request);
  const data = parse(
    z.object({ phone: z.string(), name: z.string().trim().min(1).max(80) }),
    request.data,
  );
  const normalized = phone(data.phone);
  await rateLimit(uid, "contacts", 100, 86_400_000);
  // Save only contacts the user explicitly selects; no address-book upload or public directory.
  await db
    .doc("users/" + uid + "/contacts/" + normalized)
    .set({ phone: normalized, name: data.name });
  return { phone: normalized, name: data.name };
});

export const setBlocked = onCall(secure, async (request) => {
  const { uid, phone: own } = await identity(request);
  const data = parse(
    z.object({ phone: z.string(), blocked: z.boolean() }),
    request.data,
  );
  const normalized = phone(data.phone);
  if (own === normalized)
    throw new HttpsError("invalid-argument", "Choose another number.");
  const ref = db.doc("users/" + uid + "/blocked/" + normalized);
  if (data.blocked)
    await ref.set({
      phone: normalized,
      createdAt: FieldValue.serverTimestamp(),
    });
  else await ref.delete();
  return { blocked: data.blocked };
});

export const registerDevice = onCall(secure, async (request) => {
  const { uid } = await identity(request);
  const data = parse(
    z.object({
      installationId: z.string().uuid(),
      token: z.string().min(16).max(4096),
      type: z.enum(["FCM", "APNS_VOIP"]),
      apnsEnvironment: z.enum(["sandbox", "production"]).default("production"),
    }),
    request.data,
  );
  await db.doc("users/" + uid + "/devices/" + data.installationId).set({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt: ttl(60),
  });
  return { ok: true };
});

export const startCall = onCall(secure, async (request) => {
  const { uid, phone: own } = await identity(request);
  const data = parse(
    z.object({ phone: z.string(), requestId: z.string().uuid() }),
    request.data,
  );
  const normalized = phone(data.phone);
  if (normalized === own)
    throw new HttpsError("invalid-argument", "Choose another number.");
  await rateLimit(uid, "calls-minute", 6, 60_000);
  await rateLimit(uid, "calls-day", 100, 86_400_000);
  const callee = await targetFor(normalized);
  // Match blocked and unregistered responses to avoid exposing a recipient's blocking decision.
  if (!callee)
    throw new HttpsError(
      "unavailable",
      "This person is not available on FamCall.",
    );
  const now = Date.now();
  const ref = db.doc("calls/" + data.requestId);
  const call: CallRecord = {
    id: data.requestId,
    callerId: uid,
    calleeId: callee,
    callerPhone: own,
    calleePhone: normalized,
    participants: [uid, callee],
    status: "ringing",
    createdAtMs: now,
    ringExpiresAtMs: now + RING_TIMEOUT_MS,
  };
  const existing = await db.runTransaction(async (t) => {
    const refs = [
      ref,
      db.doc("users/" + callee + "/blocked/" + own),
      db.doc("users/" + uid + "/blocked/" + normalized),
      db.doc("activeCalls/" + uid),
      db.doc("activeCalls/" + callee),
      db.doc("accountDeletions/" + uid),
      db.doc("accountDeletions/" + callee),
      db.doc("users/" + uid + "/cancelledStarts/" + data.requestId),
    ];
    const [
      previous,
      blockedByCallee,
      blockedByCaller,
      callerActive,
      calleeActive,
      callerDeleting,
      calleeDeleting,
      cancelledStart,
    ] = await t.getAll(...refs);
    if (previous.exists) {
      const old = previous.data() as CallRecord;
      if (old.callerId !== uid || old.calleeId !== callee)
        throw new HttpsError("already-exists", "Try starting a new call.");
      return old;
    }
    if (cancelledStart.exists)
      throw new HttpsError("cancelled", "This call was cancelled.");
    if (blockedByCallee.exists || blockedByCaller.exists || callerDeleting.exists || calleeDeleting.exists)
      throw new HttpsError(
        "unavailable",
        "This person is not available on FamCall.",
      );
    if (
      [callerActive, calleeActive].some(
        (s) => Number(s.data()?.expiresAtMs ?? 0) > now,
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Another call is in progress.",
      );
    }
    t.create(ref, { ...call, expiresAt: ttl(HISTORY_DAYS) });
    for (const active of [refs[3], refs[4]])
      t.set(active, { callId: call.id, expiresAtMs: call.ringExpiresAtMs });
    return null;
  });
  return existing ?? call;
});

export const updateCall = onCall(secure, async (request) => {
  const { uid } = await identity(request);
  const data = parse(
    z.object({
      callId: callIdSchema,
      action: z.enum(["accept", "decline", "cancel", "hangup", "end"]),
    }),
    request.data,
  );
  if (data.action === "end") await rateLimit(uid, "ends-minute", 30, 60_000);
  return transition(data.callId, uid, data.action);
});

async function transition(
  id: string,
  actor: string | null,
  action:
    "accept" | "decline" | "cancel" | "hangup" | "end" | "timeout" | "fail",
  onlyIfLeaseExpired = false,
) {
  return db.runTransaction(async (t) => {
    const ref = db.doc("calls/" + id);
    const snap = await t.get(ref);
    if (!snap.exists) {
      // The caller already knows its request UUID while startCall is in flight.
      // Serialize cancellation with creation, including when cancellation wins.
      if (actor && action === "end") {
        if ((await t.get(db.doc("accountDeletions/" + actor))).exists)
          throw new HttpsError("permission-denied", "This account is being deleted.");
        t.set(db.doc("users/" + actor + "/cancelledStarts/" + id), {
          createdAt: FieldValue.serverTimestamp(), expiresAt: ttl(HISTORY_DAYS),
        });
        return { id, status: "cancelled" as const };
      }
      throw new HttpsError("not-found", "This call has ended.");
    }
    const call = snap.data() as CallRecord;
    if (actor && !call.participants.includes(actor))
      throw new HttpsError("permission-denied", "This call is unavailable.");
    const now = Date.now();
    const role =
      actor === null ? "system" : actor === call.callerId ? "caller" : "callee";
    let status = call.status;
    if (call.status === "ringing" && now >= call.ringExpiresAtMs)
      status = "missed";
    else {
      try {
        status = nextCallStatus(call.status, action, role);
      } catch {
        throw new HttpsError(
          "failed-precondition",
          "The call has changed. Try again.",
        );
      }
    }
    const activeRefs = call.participants.map((p) => db.doc("activeCalls/" + p));
    const activeDocs = await t.getAll(...activeRefs);
    // The scheduled scan and a heartbeat can race. Recheck inside the transaction.
    if (onlyIfLeaseExpired && (call.status !== "accepted" || !activeDocs.some(s =>
      s.data()?.callId !== id || Number(s.data()?.expiresAtMs ?? 0) <= now))) return call;
    if (status === "accepted" && call.status === "ringing") {
      const blocked = await t.get(
        db.doc("users/" + call.calleeId + "/blocked/" + call.callerPhone),
      );
      if (blocked.exists) status = "declined";
    }
    if (status === call.status) return call;
    const patch = {
      status,
      ...(status === "accepted" ? { acceptedAtMs: now } : { endedAtMs: now }),
    };
    t.update(ref, patch);
    activeDocs.forEach((s, i) => {
      if (s.data()?.callId !== id) return;
      if (isTerminal(status)) t.delete(activeRefs[i]);
      else t.update(activeRefs[i], { expiresAtMs: now + CALL_LEASE_MS });
    });
    return { ...call, ...patch };
  });
}

export const heartbeatCall = onCall(secure, async request => {
  const {uid} = await identity(request);
  const id = parse(callIdSchema, request.data?.callId);
  return db.runTransaction(async t => {
    const ref = db.doc("calls/" + id);
    const activeRef = db.doc("activeCalls/" + uid);
    const [snapshot, active] = await t.getAll(ref, activeRef);
    const call = snapshot.data() as CallRecord | undefined;
    if (!call?.participants.includes(uid)) throw new HttpsError("permission-denied", "This call is unavailable.");
    const now = Date.now();
    if (call.status !== "accepted" || active.data()?.callId !== id ||
        Number(active.data()?.expiresAtMs ?? 0) <= now || now >= (call.acceptedAtMs ?? 0) + MAX_CALL_MS)
      return {active: false};
    t.update(activeRef, {expiresAtMs: Math.min(now + CALL_LEASE_MS, call.acceptedAtMs! + MAX_CALL_MS)});
    return {active: true};
  });
});

export const getIceServers = onCall(
  {
    ...secure,
    secrets:
      process.env.FUNCTIONS_EMULATOR === "true" ? [] : [turnId, turnToken],
  },
  async (request) => {
    const { uid } = await identity(request);
    const id = parse(callIdSchema, request.data?.callId);
    await rateLimit(uid, "ice", 15, 60_000);
    const snap = await db.doc("calls/" + id).get();
    const call = snap.data() as CallRecord | undefined;
    if (
      !call ||
      !call.participants.includes(uid) ||
      isTerminal(call.status) ||
      (call.status === "ringing" && Date.now() >= call.ringExpiresAtMs) ||
      Date.now() > (call.acceptedAtMs ?? call.createdAtMs) + MAX_CALL_MS
    ) {
      throw new HttpsError(
        "permission-denied",
        "This call is no longer active.",
      );
    }
    const result = await fetch(
      "https://rtc.live.cloudflare.com/v1/turn/keys/" +
        turnId.value() +
        "/credentials/generate-ice-servers",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + turnToken.value(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 600 }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!result.ok)
      throw new HttpsError(
        "unavailable",
        "Could not connect the call. Please try again.",
      );
    const body = (await result.json()) as { iceServers: unknown[] };
    return {
      iceServers: body.iceServers,
      expiresAtMs: Date.now() + 540_000,
      refreshAfterMs: 420_000,
    };
  },
);

export const expireCalls = onSchedule(
  { schedule: "every 1 minutes", timeoutSeconds: 60 },
  async () => {
    const now = Date.now();
    const ringing = await db
      .collection("calls")
      .where("status", "==", "ringing")
      .where("ringExpiresAtMs", "<=", now)
      .limit(100)
      .get();
    await Promise.all(
      ringing.docs.map((d) => transition(d.id, null, "timeout")),
    );
    const active = await db
      .collection("calls")
      .where("status", "==", "accepted")
      .where("acceptedAtMs", "<=", now - MAX_CALL_MS)
      .limit(100)
      .get();
    await Promise.all(active.docs.map((d) => transition(d.id, null, "fail")));
    const abandoned = await db.collection("activeCalls").where("expiresAtMs", "<=", now).limit(100).get();
    await Promise.all([...new Set(abandoned.docs.map(d => String(d.data().callId)))].map(async id => {
      try { await transition(id, null, "fail", true); }
      catch (error) { if ((error as {code?: string}).code !== "not-found") throw error; }
    }));
  },
);

export const dispatchCall = onDocumentWritten(
  {
    document: "calls/{callId}",
    retry: true,
    secrets: process.env.FUNCTIONS_EMULATOR === "true" ? [] : pushSecrets,
  },
  async (event) => {
    const before = event.data?.before.data() as CallRecord | undefined;
    const after = event.data?.after.data() as CallRecord | undefined;
    if (!after || before?.status === after.status) return;
    // Trigger deliveries may arrive out of order. Never ring an already-ended call.
    const latest = (await event.data!.after.ref.get()).data() as
      CallRecord | undefined;
    if (!latest) return;
    if (
      !before &&
      latest.status === "ringing" &&
      Date.now() < latest.ringExpiresAtMs
    )
      await deliverIncoming(latest);
    else if (isTerminal(latest.status)) {
      if (Date.now() - (latest.endedAtMs ?? 0) < 60_000) await deliverEnded(latest);
      await Promise.all(["signals", "candidates", "restarts"].map(name =>
        db.recursiveDelete(event.data!.after.ref.collection(name))));
    }
  },
);

export const deleteAccount = onCall(secure, async (request) => {
  const { uid } = await identity(request);
  const authTime = Number(request.auth!.token.auth_time) * 1000;
  if (Date.now() - authTime > 5 * 60_000)
    throw new HttpsError(
      "unauthenticated",
      "Verify your number again to delete your account.",
    );
  // The job is the durable boundary: rules deny this identity immediately and
  // the worker retries cleanup even if the app closes or the request disconnects.
  await db.doc("accountDeletions/" + uid).create({ status: "pending", requestedAt: FieldValue.serverTimestamp() });
  return { accepted: true };
});

export const processAccountDeletion = onDocumentCreated({
  document: "accountDeletions/{uid}", retry: true, timeoutSeconds: 300,
}, async event => {
  const uid = event.params.uid;
  const job = event.data?.ref;
  if (!job || (await job.get()).data()?.status === "complete") return;
  try { await getAuth().updateUser(uid, { disabled: true }); }
  catch (error) { if ((error as {code?: string}).code !== "auth/user-not-found") throw error; }
  const active = await db.doc("activeCalls/" + uid).get();
  if (active.exists) {
    try { await transition(active.data()!.callId, null, "fail"); }
    catch (error) { if ((error as {code?: string}).code !== "not-found") throw error; }
  }
  const calls = await db.collection("calls").where("participants", "array-contains", uid).limit(100).get();
  for (const call of calls.docs) await db.recursiveDelete(call.ref);
  if (calls.size === 100) throw new Error("Account cleanup continues in the next retry");
  await db.recursiveDelete(db.doc("users/" + uid));
  await db.doc("activeCalls/" + uid).delete();
  try { await getAuth().deleteUser(uid); }
  catch (error) { if ((error as {code?: string}).code !== "auth/user-not-found") throw error; }
  await job.update({ status: "complete", completedAt: FieldValue.serverTimestamp(), expiresAt: ttl(30) });
});

export const pruneHistory = onSchedule({ schedule: "every 24 hours", timeoutSeconds: 300 }, async () => {
  // Firestore TTL does not remove subcollections. Delete call trees explicitly.
  for (let page = 0; page < 10; page++) {
    const expired = await db.collection("calls").where("expiresAt", "<=", Timestamp.now()).limit(100).get();
    await Promise.all(expired.docs.map(d => db.recursiveDelete(d.ref)));
    if (expired.size < 100) break;
  }
});
