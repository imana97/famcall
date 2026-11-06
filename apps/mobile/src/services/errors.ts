import { PhoneError } from "@famcall/core";
import { t } from "../i18n";
export function errorMessage(error: unknown): string {
  if (error instanceof PhoneError)
    return t(
      error.code === "country-code-required" ? "errorCountry" : "errorNumber",
    );
  const code = String((error as { code?: unknown })?.code ?? "");
  if (/invalid-verification|session-expired/.test(code)) return t("errorCode");
  if (/invalid-phone/.test(code)) return t("errorNumber");
  if (/quota|too-many-requests|resource-exhausted/.test(code))
    return t("errorQuota");
  if (/network|deadline-exceeded/.test(code)) return t("errorNetwork");
  if (/failed-precondition/.test(code)) return t("errorBusy");
  if (/unavailable/.test(code)) return t("errorUnavailable");
  if (
    /permission|NotAllowed/.test(code) ||
    (error as Error)?.name === "NotAllowedError"
  )
    return t("errorPermission");
  return t("errorGeneric");
}
