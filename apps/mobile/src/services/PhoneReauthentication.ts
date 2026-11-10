import {
  getIdToken,
  PhoneAuthProvider,
  reauthenticateWithCredential,
  verifyPhoneNumber,
  type Auth,
  type PhoneAuthSnapshot,
} from "@react-native-firebase/auth";

export interface PhoneReauthentication {
  readonly userId: string;
  readonly code: string;
  assertCurrent: () => void;
  confirm: (code: string) => Promise<void>;
}

function authError(code: string) {
  return Object.assign(new Error(code), { code });
}

/** Requests proof for the existing user; never signs in or creates an account. */
export async function requestPhoneReauthentication(
  auth: Auth,
  expectedUserId: string,
  forceResend = false,
): Promise<PhoneReauthentication> {
  const user = auth.currentUser;
  const phone = user?.phoneNumber;
  const assertCurrent = () => {
    if (!user || !phone || user.uid !== expectedUserId ||
        auth.currentUser?.uid !== expectedUserId || auth.currentUser.phoneNumber !== phone)
      throw authError("auth/user-mismatch");
  };
  assertCurrent();
  const snapshot = await new Promise<PhoneAuthSnapshot>((resolve, reject) => {
    // Awaiting the listener itself waits for Android's automatic retrieval
    // timeout. The sent event lets the user enter their SMS code immediately.
    verifyPhoneNumber(auth, phone!, forceResend).on("state_changed", event => {
      if (event.error || event.state === "error") {
        reject(event.error ?? authError("auth/verification-failed"));
      } else if (event.verificationId) {
        resolve(event);
      } else {
        reject(authError("auth/invalid-verification-id"));
      }
    }, reject);
  });
  assertCurrent();
  let reauthenticated = false;
  let verified = false;
  let pending: Promise<void> | undefined;
  return {
    userId: expectedUserId,
    code: snapshot.code ?? "",
    assertCurrent,
    confirm: async (code) => {
      assertCurrent();
      if (verified) return Promise.resolve();
      if (pending) return pending;
      if (!/^\d{6}$/.test(code)) return Promise.reject(authError("auth/invalid-verification-code"));
      pending = (async () => {
        if (!reauthenticated) {
          const credential = PhoneAuthProvider.credential(snapshot.verificationId, code);
          const result = await reauthenticateWithCredential(user!, credential);
          assertCurrent();
          if (result.user.uid !== expectedUserId) throw authError("auth/user-mismatch");
          reauthenticated = true;
        }
        // The deletion endpoint checks auth_time; force a fresh token before it runs.
        await getIdToken(user!, true);
        assertCurrent();
        verified = true;
      })().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
