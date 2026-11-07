import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { invalidateRejectedDevice } from "../backend/src/push";

// These tests are deliberately confined to the local demo project.
const enabled = process.env.FAMCALL_FUNCTIONS_TEST === "1";
const project = "demo-famcall";
const identities: { uid: string; phone: string; token: string }[] = [];
const callIds: string[] = [];
let nextPhone = 120;
const app = enabled
  ? initializeApp({ projectId: project }, "calls-integration")
  : undefined;

async function user(phone = "+14085550" + nextPhone++) {
  const base =
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:";
  const post = async (method: string, body: unknown) => {
    const response = await fetch(base + method + "?key=emulator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error("Emulator sign-in failed: " + response.status);
    return response.json();
  };
  const verification = await post("sendVerificationCode", {
    phoneNumber: phone,
  });
  const codes = await (
    await fetch(
      "http://127.0.0.1:9099/emulator/v1/projects/" +
        project +
        "/verificationCodes",
    )
  ).json();
  const code = codes.verificationCodes.find(
    (c: { sessionInfo: string }) => c.sessionInfo === verification.sessionInfo,
  )?.code;
  const result = await post("signInWithPhoneNumber", {
    sessionInfo: verification.sessionInfo,
    code,
  });
  const identity = {
    uid: result.localId as string,
    phone,
    token: result.idToken as string,
  };
  identities.push(identity);
  return identity;
}
async function callApi(
  identity: Awaited<ReturnType<typeof user>>,
  method: string,
  data: unknown,
) {
  const response = await fetch(
    "http://127.0.0.1:5001/" + project + "/us-east1/" + method,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + identity.token,
      },
      body: JSON.stringify({ data }),
    },
  );
  const body = await response.json();
  return { http: response.status, ...body };
}
function withAuthTime(identity: Awaited<ReturnType<typeof user>>, authTime: number) {
  // The Auth emulator issues unsigned tokens. Never alter a production token.
  const [header, payload] = identity.token.split(".");
  if (JSON.parse(Buffer.from(header, "base64url").toString()).alg !== "none")
    throw new Error("Expected an unsigned Auth emulator token.");
  const claims = { ...JSON.parse(Buffer.from(payload, "base64url").toString()), auth_time: authTime };
  return { ...identity, token: [header, Buffer.from(JSON.stringify(claims)).toString("base64url"), ""].join(".") };
}
async function start(
  caller: Awaited<ReturnType<typeof user>>,
  callee: Awaited<ReturnType<typeof user>>,
  id = randomUUID(),
) {
  callIds.push(id);
  return callApi(caller, "startCall", { phone: callee.phone, requestId: id });
}

describe.skipIf(!enabled)(
  "call service with Auth and Firestore emulators",
  () => {
    afterAll(async () => {
      if (!app) return;
      const db = getFirestore(app);
      for (const id of new Set(callIds))
        await db.recursiveDelete(db.doc("calls/" + id));
      for (const identity of identities) {
        await db.recursiveDelete(db.doc("users/" + identity.uid));
        await db.doc("activeCalls/" + identity.uid).delete();
        await db.doc("accountDeletions/" + identity.uid).delete();
        await getAuth(app).deleteUser(identity.uid).catch(error => {
          if (error.code !== "auth/user-not-found") throw error;
        });
      }
      await deleteApp(app);
    }, 30_000);

    it("binds retried push registration to the account that started it", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      const installationId = randomUUID();
      const data = { userId: a.uid, installationId, sequence: 1, type: "FCM", token: "fictional-registration-token-one" };
      expect((await callApi(a, "registerDevice", data)).result?.ok).toBe(true);
      expect((await callApi(b, "registerDevice", data)).error?.status).toBe("PERMISSION_DENIED");
      const db = getFirestore(app!);
      expect((await db.doc("users/" + b.uid + "/devices/" + installationId).get()).exists).toBe(false);
      expect((await callApi(a, "registerDevice", { ...data, sequence: 2, token: "fictional-registration-token-two" })).result?.ok).toBe(true);
      expect((await db.doc("users/" + a.uid + "/devices/" + installationId).get()).data()?.token).toBe("fictional-registration-token-two");
    }, 30_000);

    it("returns the same call for a retried start without creating another ring", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      const id = randomUUID();
      const first = await start(a, b, id);
      const retry = await start(a, b, id);
      expect(first.result?.id).toBe(id);
      expect(retry.result?.createdAtMs).toBe(first.result.createdAtMs);
    }, 30_000);
    it("retains the latest push token after late uploads and old provider rejections", async () => {
      const a = await user();
      const installationId = randomUUID();
      const data = { userId: a.uid, installationId, sequence: 1, type: "FCM", token: "fictional-registration-token-one" };
      const ref = getFirestore(app!).doc("users/" + a.uid + "/devices/" + installationId);
      await callApi(a, "registerDevice", data);
      const old = await ref.get();
      const replacement = { ...data, sequence: 2, token: "fictional-registration-token-two" };
      expect((await callApi(a, "registerDevice", replacement)).result?.ok).toBe(true);
      await callApi(a, "registerDevice", data);
      await invalidateRejectedDevice(old);
      const current = await ref.get();
      expect(current.data()?.token).toBe(replacement.token);
      expect(current.data()?.invalidated).toBe(false);
      expect((await callApi(a, "registerDevice", { ...data, sequence: 2 })).error?.status).toBe("FAILED_PRECONDITION");
      expect((await callApi(a, "registerDevice", { ...replacement, apnsEnvironment: "sandbox" })).error?.status).toBe("FAILED_PRECONDITION");
      await invalidateRejectedDevice(current);
      await callApi(a, "registerDevice", replacement);
      await callApi(a, "registerDevice", data);
      expect((await ref.get()).data()).toMatchObject({ sequence: 2, invalidated: true });
      expect((await ref.get()).data()?.token).toBeUndefined();
      expect((await callApi(a, "registerDevice", { ...replacement, sequence: 3 })).result?.ok).toBe(true);
      expect((await ref.get()).data()).toMatchObject({ sequence: 3, token: replacement.token, invalidated: false });
    }, 30_000);
    it("atomically admits only one simultaneous caller to a recipient", async () => {
      const [a, b, c] = await Promise.all([user(), user(), user()]);
      const responses = await Promise.all([start(a, c), start(b, c)]);
      expect(
        responses.filter((r) => r.result?.status === "ringing"),
      ).toHaveLength(1);
      expect(
        responses.filter((r) => r.error?.status === "FAILED_PRECONDITION"),
      ).toHaveLength(1);
    }, 30_000);
    it("remembers cancellation before creation and never takes either call lease", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      const callId = randomUUID();
      expect((await callApi(a, "updateCall", { callId, action: "end" })).result?.status).toBe("cancelled");
      expect((await start(a, b, callId)).error?.status).toBe("CANCELLED");
      expect((await start(a, b, callId)).error?.status).toBe("CANCELLED");
      const db = getFirestore(app!);
      for (const path of ["calls/" + callId, "activeCalls/" + a.uid, "activeCalls/" + b.uid])
        expect((await db.doc(path).get()).exists).toBe(false);
    }, 30_000);
    it("scopes pre-creation cancellation to its caller, not a guessed request UUID", async () => {
      const [a, b, outsider] = await Promise.all([user(), user(), user()]);
      const callId = randomUUID();
      await callApi(outsider, "updateCall", { callId, action: "end" });
      expect((await start(a, b, callId)).result?.status).toBe("ringing");
      expect((await callApi(outsider, "updateCall", { callId, action: "end" })).error?.status).toBe("PERMISSION_DENIED");
    }, 30_000);
    it("serializes simultaneous creation and cancellation without leaving a ringing call", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      const callId = randomUUID();
      const [created, ended] = await Promise.all([
        start(a, b, callId), callApi(a, "updateCall", { callId, action: "end" }),
      ]);
      expect(ended.result?.status).toBe("cancelled");
      expect(created.result?.status === "ringing" || created.result?.status === "cancelled" || created.error?.status === "CANCELLED").toBe(true);
      const db = getFirestore(app!);
      const doc = await db.doc("calls/" + callId).get();
      expect(!doc.exists || doc.data()?.status === "cancelled").toBe(true);
      expect((await db.doc("activeCalls/" + a.uid).get()).exists).toBe(false);
      expect((await db.doc("activeCalls/" + b.uid).get()).exists).toBe(false);
      const retry = await start(a, b, callId);
      expect(retry.result?.status === "cancelled" || retry.error?.status === "CANCELLED").toBe(true);
    }, 30_000);
    it("prevents an outsider accepting, ending, or obtaining relay credentials", async () => {
      const [a, b, outsider] = await Promise.all([user(), user(), user()]);
      const started = await start(a, b);
      const callId = started.result.id;
      for (const action of ["accept", "end"]) {
        expect(
          (await callApi(outsider, "updateCall", { callId, action })).error
            ?.status,
        ).toBe("PERMISSION_DENIED");
      }
      expect(
        (await callApi(outsider, "getIceServers", { callId })).error?.status,
      ).toBe("PERMISSION_DENIED");
      expect(
        (await callApi(a, "updateCall", { callId, action: "accept" })).error
          ?.status,
      ).toBe("FAILED_PRECONDITION");
    }, 30_000);
    it("blocks calls and permits them again after unblocking", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      expect(
        (await callApi(b, "setBlocked", { phone: a.phone, blocked: true }))
          .result?.blocked,
      ).toBe(true);
      expect((await start(a, b)).error?.status).toBe("UNAVAILABLE");
      await callApi(b, "setBlocked", { phone: a.phone, blocked: false });
      expect((await start(a, b)).result?.status).toBe("ringing");
    }, 30_000);
    it("keeps a call terminal when an answer races with an end intent", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      const started = await start(a, b);
      const callId = started.result.id;
      await Promise.all([
        callApi(b, "updateCall", { callId, action: "accept" }),
        callApi(a, "updateCall", { callId, action: "end" }),
      ]);
      const retry = await callApi(b, "updateCall", {
        callId,
        action: "accept",
      });
      expect(["ended", "cancelled"]).toContain(retry.result?.status);
      const db = getFirestore(app!);
      expect((await db.doc("activeCalls/" + a.uid).get()).exists).toBe(false);
      expect((await db.doc("activeCalls/" + b.uid).get()).exists).toBe(false);
    }, 30_000);
    it("rejects late answers and releases the busy locks", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      const started = await start(a, b);
      const callId = started.result.id;
      await getFirestore(app!)
        .doc("calls/" + callId)
        .update({ ringExpiresAtMs: Date.now() - 1000 });
      expect(
        (await callApi(b, "updateCall", { callId, action: "accept" })).result
          ?.status,
      ).toBe("missed");
      expect((await start(a, b)).result?.status).toBe("ringing");
    }, 30_000);
    it("renews only a participant's live lease and cannot resurrect an expired lease", async () => {
      const [a, b, outsider] = await Promise.all([user(), user(), user()]);
      const {result} = await start(a, b);
      const callId = result.id;
      await callApi(b, "updateCall", {callId, action: "accept"});
      expect((await callApi(outsider, "heartbeatCall", {callId})).error?.status).toBe("PERMISSION_DENIED");
      expect((await callApi(a, "heartbeatCall", {callId})).result?.active).toBe(true);
      await getFirestore(app!).doc("activeCalls/" + a.uid).update({expiresAtMs: Date.now() - 1000});
      expect((await callApi(a, "heartbeatCall", {callId})).result?.active).toBe(false);
    }, 30_000);
    it("deletes an ordinary account, auth identity and call trees before returning, denying its stale token", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      const db = getFirestore(app!);
      await callApi(a, "registerProfile", {});
      await callApi(a, "saveContact", {phone: b.phone, name: "Test contact"});
      await callApi(a, "registerDevice", {
        userId: a.uid, installationId: randomUUID(), sequence: 1,
        token: "fictional-deletion-test-device-token", type: "FCM",
      });
      const cancelledId = randomUUID();
      await callApi(a, "updateCall", { callId: cancelledId, action: "end" });
      expect((await getFirestore(app!).doc("users/" + a.uid + "/cancelledStarts/" + cancelledId).get()).exists).toBe(true);
      const {result} = await start(a, b);
      for (const collection of ["signals", "candidates", "restarts"])
        await db.doc(`calls/${result.id}/${collection}/deletion-test`).set({ participant: a.uid });
      expect((await callApi(a, "deleteAccount", {})).result).toEqual({ accepted: true, status: "complete" });
      // No polling: success now means the cleanup has completed before the response.
      expect((await db.doc("accountDeletions/" + a.uid).get()).data()?.status).toBe("complete");
      await expect(getAuth(app!).getUser(a.uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
      for (const collection of ["signals", "candidates", "restarts"])
        expect((await db.collection(`calls/${result.id}/${collection}`).get()).empty).toBe(true);
      expect((await callApi(a, "deleteAccount", {})).result).toEqual({ accepted: true, status: "complete" });
      expect((await callApi(a, "registerProfile", {})).error?.status).toBe("PERMISSION_DENIED");
      const completedJob = (await db.doc("accountDeletions/" + a.uid).get()).data();
      const staleIdentity = withAuthTime(a, Math.floor(Date.now() / 1000) - 600);
      expect((await callApi(staleIdentity, "deleteAccount", {})).result).toEqual({ accepted: true, status: "complete" });
      expect((await db.doc("accountDeletions/" + a.uid).get()).data()).toEqual(completedJob);
      expect((await db.doc("users/" + a.uid).get()).exists).toBe(false);
      expect((await db.collection("users/" + a.uid + "/contacts").get()).empty).toBe(true);
      expect((await db.collection("users/" + a.uid + "/devices").get()).empty).toBe(true);
      expect((await db.collection("users/" + a.uid + "/cancelledStarts").get()).empty).toBe(true);
      expect((await callApi(a, "updateCall", { callId: randomUUID(), action: "end" })).error?.status).toBe("PERMISSION_DENIED");
      expect((await db.doc("calls/" + result.id).get()).exists).toBe(false);
      expect((await db.doc("activeCalls/" + b.uid).get()).exists).toBe(false);
      expect((await start(b, a)).error?.status).toBe("UNAVAILABLE");
    }, 30_000);
    it("accepts concurrent account deletion requests through one durable job", async () => {
      const a = await user();
      const responses = await Promise.all(Array.from({ length: 4 }, () => callApi(a, "deleteAccount", {})));
      expect(responses.map(response => response.result?.accepted)).toEqual([true, true, true, true]);
      expect(responses.map(response => response.result?.status)).toEqual(["complete", "complete", "complete", "complete"]);
      const job = getFirestore(app!).doc("accountDeletions/" + a.uid);
      const requestedAt = (await job.get()).data()?.requestedAt;
      expect(requestedAt).toBeDefined();
      expect((await job.get()).data()?.status).toBe("complete");
      expect((await job.get()).data()?.requestedAt).toEqual(requestedAt);
      expect((await callApi(a, "registerProfile", {})).error?.status).toBe("PERMISSION_DENIED");
    }, 30_000);
    it("does not recreate private data when profile and device writes race account deletion", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      const device = {
        userId: a.uid, installationId: randomUUID(), sequence: 1,
        token: "fictional-deletion-race-device-token", type: "FCM",
      };
      const writes = [
        callApi(a, "registerProfile", {}),
        callApi(a, "registerDevice", device),
        callApi(a, "saveContact", { phone: b.phone, name: "Concurrent contact" }),
        callApi(a, "setBlocked", { phone: b.phone, blocked: true }),
      ];
      expect((await callApi(a, "deleteAccount", {})).result).toEqual({ accepted: true, status: "complete" });
      await Promise.all(writes);
      const db = getFirestore(app!);
      expect((await db.doc("users/" + a.uid).get()).exists).toBe(false);
      for (const collection of ["contacts", "devices", "blocked"])
        expect((await db.collection(`users/${a.uid}/${collection}`).get()).empty).toBe(true);
      expect((await callApi(a, "registerDevice", device)).error?.status).toBe("PERMISSION_DENIED");
    }, 30_000);
    it("re-registers the same phone with a new UID without an old deletion retry removing it", async () => {
      const old = await user();
      const db = getFirestore(app!);
      expect((await callApi(old, "registerProfile", {})).result?.phone).toBe(old.phone);
      expect((await callApi(old, "deleteAccount", {})).result).toEqual({ accepted: true, status: "complete" });
      const job = db.doc("accountDeletions/" + old.uid);
      expect((await job.get()).data()?.status).toBe("complete");
      await expect(getAuth(app!).getUser(old.uid)).rejects.toMatchObject({ code: "auth/user-not-found" });

      const replacement = await user(old.phone);
      expect(replacement.uid).not.toBe(old.uid);
      expect((await callApi(replacement, "registerProfile", {})).result?.phone).toBe(old.phone);
      const profile = db.doc("users/" + replacement.uid);
      const savedProfile = (await profile.get()).data();
      const completedJob = (await job.get()).data();

      // Retry a lost deletion response with the original identity after the
      // same phone number has been verified into its replacement account.
      const stale = withAuthTime(old, Math.floor(Date.now() / 1000) - 600);
      expect((await callApi(stale, "deleteAccount", {})).result).toEqual({ accepted: true, status: "complete" });
      expect((await job.get()).data()).toEqual(completedJob);
      expect((await profile.get()).data()).toEqual(savedProfile);
      expect((await getAuth(app!).getUserByPhoneNumber(old.phone)).uid).toBe(replacement.uid);
      expect((await getAuth(app!).getUser(replacement.uid)).disabled).toBe(false);
      expect((await db.doc("accountDeletions/" + replacement.uid).get()).exists).toBe(false);
      expect((await db.doc("users/" + old.uid).get()).exists).toBe(false);
      expect((await callApi(old, "registerProfile", {})).error?.status).toBe("PERMISSION_DENIED");
    }, 30_000);
    it("logs out only this device without deleting account data or allowing stale token uploads", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      await callApi(a, "registerProfile", {});
      await callApi(a, "saveContact", { phone: b.phone, name: "Saved person" });
      const installationId = randomUUID();
      const otherInstallationId = randomUUID();
      const data = { userId: a.uid, installationId, sequence: 1, type: "FCM", token: "fictional-logout-device-token" };
      await callApi(a, "registerDevice", data);
      await callApi(a, "registerDevice", { ...data, installationId: otherInstallationId });
      expect((await callApi(a, "unregisterDevice", { installationId, sequence: 2 })).result?.ok).toBe(true);
      const db = getFirestore(app!);
      const ref = db.doc("users/" + a.uid + "/devices/" + installationId);
      expect((await ref.get()).data()?.invalidated).toBe(true);
      expect((await ref.get()).data()?.token).toBeUndefined();
      expect((await db.doc("users/" + a.uid + "/devices/" + otherInstallationId).get()).data()?.invalidated).toBe(false);
      expect((await db.collection("users/" + a.uid + "/contacts").get()).size).toBe(1);
      expect((await db.doc("accountDeletions/" + a.uid).get()).exists).toBe(false);
      expect((await getAuth(app!).getUser(a.uid)).disabled).toBe(false);
      await callApi(a, "registerDevice", data);
      await callApi(a, "registerDevice", { ...data, sequence: 2 });
      expect((await ref.get()).data()?.invalidated).toBe(true);
      await callApi(b, "unregisterDevice", { installationId, sequence: 3 });
      expect((await ref.get()).data()?.sequence).toBe(2);
      await callApi(a, "registerDevice", { ...data, sequence: 3 });
      expect((await ref.get()).data()?.invalidated).toBe(false);
      expect((await callApi(a, "unregisterDevice", { installationId, sequence: 2 })).error?.status).toBe("FAILED_PRECONDITION");
      expect((await ref.get()).data()?.invalidated).toBe(false);
    }, 30_000);
    it("atomically edits a contact phone, normalizes country codes and refuses to overwrite another person", async () => {
      const [a, b, c] = await Promise.all([user(), user(), user()]);
      await callApi(a, "saveContact", { phone: b.phone, name: "Original" });
      const changed = await callApi(a, "saveContact", {
        previousPhone: b.phone, phone: "00" + c.phone.slice(1), name: "Updated",
      });
      expect(changed.result?.phone).toBe(c.phone);
      const contacts = getFirestore(app!).collection("users/" + a.uid + "/contacts");
      expect((await contacts.doc(b.phone).get()).exists).toBe(false);
      expect((await contacts.doc(c.phone).get()).data()?.name).toBe("Updated");
      expect((await contacts.get()).size).toBe(1);
      await callApi(a, "saveContact", { phone: b.phone, name: "Other person" });
      expect((await callApi(a, "saveContact", { previousPhone: c.phone, phone: b.phone, name: "Conflict" })).error?.status).toBe("ALREADY_EXISTS");
      expect((await contacts.doc(c.phone).get()).data()?.name).toBe("Updated");
      expect((await contacts.doc(b.phone).get()).data()?.name).toBe("Other person");
      expect((await callApi(b, "saveContact", { previousPhone: c.phone, phone: a.phone, name: "Not mine" })).error?.status).toBe("NOT_FOUND");
    }, 30_000);
    it("requires recent verified phone authentication for a new deletion job", async () => {
      const a = await user();
      const staleIdentity = withAuthTime(a, Math.floor(Date.now() / 1000) - 600);
      expect((await callApi(staleIdentity, "deleteAccount", {})).error?.status).toBe("UNAUTHENTICATED");
      expect((await getFirestore(app!).doc("accountDeletions/" + a.uid).get()).exists).toBe(false);
      expect((await callApi(a, "registerProfile", {})).result?.phone).toBe(a.phone);
    }, 30_000);
  },
);
