import { describe, expect, it } from "vitest";
import { PhoneError } from "@famcall/core";
import { errorMessage } from "../apps/mobile/src/services/errors";

const generic = "Couldn’t finish that. Please try again.";

describe("error guidance across app operations", () => {
  it.each([
    { code: "functions/permission-denied" }, // Expired call or account deletion.
    { code: "firestore/permission-denied" }, // Reading history or contacts.
    { code: "functions/unauthenticated" }, // Auth/App Check validation.
    { code: "ERR_MISSING_PERMISSION" }, // Native contacts operation.
    { code: "NotAllowed" },
    { name: "NotAllowedError" },
    { name: "SecurityError", message: "Permission denied." },
  ])("does not send unrelated access failures to microphone settings: %j", error => {
    expect(errorMessage(error)).toBe(generic);
  });

  it.each(["functions/resource-exhausted", "firestore/resource-exhausted", "auth/too-many-requests"])(
    "explains throttling without claiming an SMS quota for %s", code => {
      expect(errorMessage({ code })).toBe("Too many attempts. Please wait before trying again.");
    },
  );

  it("keeps provider SMS quota guidance specific to phone authentication", () => {
    expect(errorMessage({ code: "auth/quota-exceeded" }))
      .toBe("Verification is busy. Please try again later.");
  });

  it.each(["functions/unavailable", "firestore/unavailable", "unavailable"])(
    "does not blame the recipient for an ambiguous service failure: %s", code => {
      expect(errorMessage({ code })).toBe("Couldn’t connect right now. Please try again shortly.");
    },
  );

  it("keeps blocked and unregistered responses indistinguishable without showing server text", () => {
    const responses = [
      { code: "functions/unavailable", message: "blocked recipient", details: { phone: "+12025550101" } },
      { code: "functions/unavailable", message: "unregistered recipient" },
    ];
    expect(responses.map(error => errorMessage(error, "call-start")))
      .toEqual(Array(2).fill("Couldn’t connect right now. Please try again shortly."));
  });

  it("limits busy-call guidance to a start-call conflict", () => {
    const error = { code: "functions/failed-precondition" };
    expect(errorMessage(error, "call-start")).toBe("Another call is in progress.");
    expect(errorMessage(error)).toBe(generic); // A device registration can also use this code.
    expect(errorMessage({ code: "firestore/failed-precondition" }, "call-start")).toBe(generic);
  });

  it.each(["auth/network-request-failed", "functions/deadline-exceeded", "firestore/deadline-exceeded"])(
    "provides connection guidance for %s", code => {
      expect(errorMessage({ code })).toBe("Check your connection and try again.");
    },
  );

  it.each(["auth/invalid-verification-code", "auth/invalid-verification-id", "auth/session-expired"])(
    "preserves verification-code guidance for %s", code => {
      expect(errorMessage({ code })).toBe("That code didn’t work. Check it and try again.");
    },
  );

  it("keeps international phone guidance and ignores arbitrary internal messages", () => {
    expect(errorMessage(new PhoneError("country-code-required")))
      .toBe("Add the country code, starting with + or 00.");
    expect(errorMessage(new PhoneError("invalid-number")))
      .toBe("Enter a valid phone number with its country code.");
    expect(errorMessage({ code: "auth/invalid-phone-number" }))
      .toBe("Enter a valid phone number with its country code.");
    expect(errorMessage({ code: "internal", message: "private server details" })).toBe(generic);
    expect(errorMessage(null)).toBe(generic);
  });
});
