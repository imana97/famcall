import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { connect, type IncomingHttpHeaders } from "node:http2";
import { getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { defineSecret } from "firebase-functions/params";
import type { CallRecord } from "@famcall/core";

const apnsKey = defineSecret("APNS_PRIVATE_KEY");
const apnsKeyId = defineSecret("APNS_KEY_ID");
const apnsTeam = defineSecret("APNS_TEAM_ID");
export const pushSecrets = [apnsKey, apnsKeyId, apnsTeam];

export function incomingEvent(call: CallRecord) {
  return {
    eventId: call.id,
    serverCallId: call.id,
    hasVideo: false,
    supportsHolding: false,
    supportsDTMF: false,
    startedAt: new Date(call.createdAtMs).toISOString(),
    caller: {
      id: call.callerId,
      displayName: call.callerPhone,
      phoneNumber: call.callerPhone,
    },
  };
}

let jwtCache: { value: string; until: number } | undefined;
function apnsJwt() {
  if (jwtCache && Date.now() < jwtCache.until) return jwtCache.value;
  const b64 = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const content =
    b64({ alg: "ES256", kid: apnsKeyId.value() }) +
    "." +
    b64({ iss: apnsTeam.value(), iat: Math.floor(Date.now() / 1000) });
  const signature = sign("sha256", Buffer.from(content), {
    key: createPrivateKey(apnsKey.value()),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  jwtCache = {
    value: content + "." + signature,
    until: Date.now() + 40 * 60_000,
  };
  return jwtCache.value;
}

async function sendApns(device: DocumentSnapshot, call: CallRecord) {
  const data = device.data()!;
  const host =
    data.apnsEnvironment === "sandbox"
      ? "api.sandbox.push.apple.com"
      : "api.push.apple.com";
  const client = connect("https://" + host);
  try {
    const result = await new Promise<{ status: number; reason?: string }>(
      (resolve, reject) => {
        client.once("error", reject);
        const req = client.request({
          ":method": "POST",
          ":path": "/3/device/" + data.token,
          authorization: "bearer " + apnsJwt(),
          "apns-push-type": "voip",
          "apns-topic": "com.silvergridtech.famcall.voip",
          "apns-priority": "10",
          "apns-expiration": "0",
          "apns-id": call.id,
        });
        let headers: IncomingHttpHeaders = {};
        let body = "";
        req.on("response", (h) => {
          headers = h;
        });
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.once("error", reject);
        req.setTimeout(10_000, () =>
          req.destroy(new Error("APNs request timed out")),
        );
        req.on("end", () => {
          let reason: string | undefined;
          try {
            reason = JSON.parse(body).reason;
          } catch {
            /* Empty success body. */
          }
          resolve({ status: Number(headers[":status"]), reason });
        });
        req.end(JSON.stringify({ incomingCall: incomingEvent(call) }));
      },
    );
    if (result.status === 200) return;
    if (
      result.status === 410 ||
      result.reason === "BadDeviceToken" ||
      result.reason === "DeviceTokenNotForTopic"
    ) {
      await device.ref.delete();
      return;
    }
    // Never put push tokens or provider response bodies in logs.
    throw new Error("APNs delivery failed with status " + result.status);
  } finally {
    client.close();
  }
}

async function devicesFor(uid: string) {
  const devices = await getFirestore()
    .collection("users/" + uid + "/devices")
    .get();
  return devices.docs.filter(
    (d) => Number(d.data().expiresAt?.toMillis()) > Date.now(),
  );
}

async function sendFcm(
  devices: DocumentSnapshot[],
  data: Record<string, string>,
  ttl: number,
) {
  // Deduplicate installations and keep each provider request within its limit.
  for (let offset = 0; offset < devices.length; offset += 500) {
    const batch = devices.slice(offset, offset + 500);
    const result = await getMessaging().sendEachForMulticast({
      tokens: batch.map((d) => d.data()!.token as string),
      data,
      android: { priority: "high", ttl },
    });
    let retry = false;
    await Promise.all(
      result.responses.map(async (response, i) => {
        if (response.success) return;
        if (
          [
            "messaging/registration-token-not-registered",
            "messaging/invalid-registration-token",
          ].includes(response.error?.code ?? "")
        )
          await batch[i].ref.delete();
        else retry = true;
      }),
    );
    if (retry) throw new Error("FCM delivery requires retry");
  }
}

export async function deliverIncoming(call: CallRecord) {
  if (process.env.FUNCTIONS_EMULATOR === "true") return;
  const devices = await devicesFor(call.calleeId);
  await Promise.all([
    sendFcm(
      devices.filter((d) => d.data().type === "FCM"),
      {
        messageType: "incomingCall",
        incomingCall: JSON.stringify(incomingEvent(call)),
      },
      Math.max(0, call.ringExpiresAtMs - Date.now()),
    ),
    ...devices
      .filter((d) => d.data().type === "APNS_VOIP")
      .map((d) => sendApns(d, call)),
  ]);
}

export async function deliverEnded(call: CallRecord) {
  if (process.env.FUNCTIONS_EMULATOR === "true") return;
  const devices = (await Promise.all(call.participants.map(devicesFor))).flat();
  // Android can end a native ring without starting JS. iOS observes Firestore after
  // PushKit launches the app; cancellation is never sent as a new VoIP call push.
  await sendFcm(
    devices.filter((d) => d.data().type === "FCM"),
    {
      messageType: "callEnded",
      callEnded: JSON.stringify({
        eventId: randomUUID(),
        serverCallId: call.id,
        reason: call.status === "missed" ? "unanswered" : "remoteEnded",
      }),
    },
    45_000,
  );
}
