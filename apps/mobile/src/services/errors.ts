import { PhoneError } from "@famcall/core";
import { t } from "../i18n";

export class MicrophonePermissionError extends Error {
  constructor() {
    super("microphone-permission-denied");
    this.name = "MicrophonePermissionError";
  }
}

export type ErrorContext = "general" | "call-start";

export function errorMessage(error: unknown, context: ErrorContext = "general"): string {
  if (error instanceof MicrophonePermissionError) return t("errorPermission");
  if (error instanceof PhoneError)
    return t(
      error.code === "country-code-required" ? "errorCountry" : "errorNumber",
    );
  const value = (error as { code?: unknown } | null)?.code;
  const code = typeof value === "string" ? value : "";
  if (/^auth\/(invalid-verification-code|invalid-verification-id|session-expired)$/.test(code))
    return t("errorCode");
  if (code === "auth/invalid-phone-number") return t("errorNumber");
  if (code === "auth/quota-exceeded") return t("errorQuota");
  if (/(^|\/)(quota-exceeded|too-many-requests|resource-exhausted)$/.test(code))
    return t("errorRateLimit");
  if (/(^|\/)(network-request-failed|network-error|deadline-exceeded)$/.test(code))
    return t("errorNetwork");
  // Only startCall uses this callable code for an active-call conflict.
  // Registration, Firestore and other native failures need a neutral fallback.
  if (context === "call-start" && code === "functions/failed-precondition")
    return t("errorBusy");
  if (/(^|\/)unavailable$/.test(code)) return t("errorUnavailable");
  // Permission errors can come from contacts, App Check or backend access.
  // Only the getUserMedia boundary can identify microphone permission denial.
  return t("errorGeneric");
}
