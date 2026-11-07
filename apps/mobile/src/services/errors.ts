import { PhoneError } from "@famcall/core";
import { t } from "../i18n";

export class MicrophonePermissionError extends Error {
  constructor() {
    super("microphone-permission-denied");
    this.name = "MicrophonePermissionError";
  }
}

class CallBusyError extends Error {}

function errorCode(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === "string" ? value : "";
}

/** Apply only to a rejected startCall request, before other native call setup. */
export function callStartError(error: unknown): unknown {
  const code = errorCode(error);
  return code === "failed-precondition" || code === "functions/failed-precondition"
    ? new CallBusyError("call-busy")
    : error;
}

export function errorMessage(error: unknown): string {
  if (error instanceof MicrophonePermissionError) return t("errorPermission");
  if (error instanceof CallBusyError) return t("errorBusy");
  if (error instanceof PhoneError)
    return t(
      error.code === "country-code-required" ? "errorCountry" : "errorNumber",
    );
  const code = errorCode(error);
  if (/^auth\/(invalid-verification-code|invalid-verification-id|session-expired)$/.test(code))
    return t("errorCode");
  if (code === "auth/invalid-phone-number") return t("errorNumber");
  if (code === "auth/quota-exceeded") return t("errorQuota");
  if (/(^|\/)(quota-exceeded|too-many-requests|resource-exhausted)$/.test(code))
    return t("errorRateLimit");
  if (/(^|\/)(network-request-failed|network-error|deadline-exceeded)$/.test(code))
    return t("errorNetwork");
  if (/(^|\/)unavailable$/.test(code)) return t("errorUnavailable");
  // Permission errors can come from contacts, App Check or backend access.
  // Only the getUserMedia boundary can identify microphone permission denial.
  return t("errorGeneric");
}
