import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// These tests are deliberately confined to the local demo project.
const enabled = process.env.FAMCALL_FUNCTIONS_TEST === "1";
const project = "demo-famcall";
const identities: { uid: string; phone: string; token: string }[] = [];
const callIds: string[] = [];
let nextPhone = 120;
const app = enabled
  ? initializeApp({ projectId: project }, "calls-integration")
  : undefined;

async function user() {
  const phone = "+14085550" + nextPhone++;
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

    it("returns the same call for a retried start without creating another ring", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      const id = randomUUID();
      const first = await start(a, b, id);
      const retry = await start(a, b, id);
      expect(first.result?.id).toBe(id);
      expect(retry.result?.createdAtMs).toBe(first.result.createdAtMs);
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
    it("durably deletes an account, its private data and calls, denying its stale token", async () => {
      const [a, b] = await Promise.all([user(), user()]);
      await callApi(a, "registerProfile", {});
      await callApi(a, "saveContact", {phone: b.phone, name: "Test contact"});
      const {result} = await start(a, b);
      expect((await callApi(a, "deleteAccount", {})).result?.accepted).toBe(true);
      expect((await callApi(a, "registerProfile", {})).error?.status).toBe("PERMISSION_DENIED");
      const db = getFirestore(app!);
      await expect.poll(async () => (await db.doc("accountDeletions/" + a.uid).get()).data()?.status,
        {timeout: 20_000, interval: 300}).toBe("complete");
      expect((await db.doc("users/" + a.uid).get()).exists).toBe(false);
      expect((await db.collection("users/" + a.uid + "/contacts").get()).empty).toBe(true);
      expect((await db.doc("calls/" + result.id).get()).exists).toBe(false);
      expect((await db.doc("activeCalls/" + b.uid).get()).exists).toBe(false);
      expect((await start(b, a)).error?.status).toBe("UNAVAILABLE");
    }, 30_000);
  },
);
