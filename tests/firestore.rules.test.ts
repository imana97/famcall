import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  "Firestore participant isolation",
  () => {
    let env: RulesTestEnvironment;
    const id = "00000000-0000-4000-8000-000000000001";
    beforeAll(async () => {
      env = await initializeTestEnvironment({
        projectId: "demo-famcall-rules",
        firestore: {
          host: "127.0.0.1",
          port: 8080,
          rules: readFileSync("firestore.rules", "utf8"),
        },
      });
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    beforeEach(async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "calls", id), {
          callerId: "alice",
          calleeId: "bob",
          participants: ["alice", "bob"],
          status: "ringing",
          ringExpiresAtMs: Date.now() + 45_000,
          createdAtMs: Date.now(),
        });
        await setDoc(
          doc(ctx.firestore(), "users", "alice", "contacts", "+12025550102"),
          { name: "Bob", phone: "+12025550102" },
        );
      });
    });
    const db = (uid: string) =>
      env
        .authenticatedContext(uid, {
          phone_number: uid === "alice" ? "+12025550101" : "+12025550102",
          firebase: { sign_in_provider: "phone" },
        })
        .firestore();
    it("allows only the participants to read call records", async () => {
      await assertSucceeds(getDoc(doc(db("bob"), "calls", id)));
      await assertFails(getDoc(doc(db("eve"), "calls", id)));
      await assertFails(
        getDoc(doc(env.unauthenticatedContext().firestore(), "calls", id)),
      );
    });
    it("keeps saved contacts private", async () => {
      await assertSucceeds(
        getDoc(doc(db("alice"), "users", "alice", "contacts", "+12025550102")),
      );
      await assertFails(
        getDoc(doc(db("bob"), "users", "alice", "contacts", "+12025550102")),
      );
    });
    it("keeps cancellation receipts server-only, including for their owner", async () => {
      for (const uid of ["alice", "bob"]) {
        const receipt = doc(db(uid), "users", "alice", "cancelledStarts", id);
        await assertFails(getDoc(receipt));
        await assertFails(setDoc(receipt, { createdAt: 1 }));
      }
    });
    it("does not allow participants to rewrite call state or membership", async () => {
      await assertFails(
        updateDoc(doc(db("alice"), "calls", id), {
          status: "accepted",
          participants: ["alice", "eve"],
        }),
      );
    });
    it("prevents sending another participant’s description or a callee offer", async () => {
      const offer = { type: "offer", sdp: "v=0", generation: 1 };
      await assertSucceeds(
        setDoc(doc(db("alice"), "calls", id, "signals", "alice"), offer),
      );
      await assertFails(
        setDoc(doc(db("bob"), "calls", id, "signals", "alice"), offer),
      );
      await assertFails(
        setDoc(doc(db("bob"), "calls", id, "signals", "bob"), offer),
      );
      await assertSucceeds(
        setDoc(doc(db("bob"), "calls", id, "signals", "bob"), {
          ...offer,
          type: "answer",
        }),
      );
    });
    it("rejects oversized signaling and forged ICE candidate authors", async () => {
      await assertFails(
        setDoc(doc(db("alice"), "calls", id, "signals", "alice"), {
          type: "offer",
          sdp: "x".repeat(65537),
          generation: 1,
        }),
      );
      await assertFails(
        setDoc(doc(db("alice"), "calls", id, "candidates", "forged"), {
          senderId: "bob",
          candidate: "test",
          generation: 1,
          sdpMid: "0",
          sdpMLineIndex: 0,
        }),
      );
    });
    it("closes signaling after hangup and after ring expiry", async () => {
      for (const patch of [
        { status: "ended" },
        { status: "ringing", ringExpiresAtMs: Date.now() - 1 },
      ]) {
        await env.withSecurityRulesDisabled((ctx) =>
          updateDoc(doc(ctx.firestore(), "calls", id), patch),
        );
        await assertFails(
          setDoc(doc(db("alice"), "calls", id, "signals", "alice"), {
            type: "offer",
            sdp: "v=0",
            generation: 2,
          }),
        );
      }
    });
  },
);
