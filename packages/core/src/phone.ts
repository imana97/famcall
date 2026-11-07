import { parsePhoneNumberWithError } from "libphonenumber-js/max";

export class PhoneError extends Error {
  constructor(
    public readonly code: "country-code-required" | "invalid-number",
  ) {
    super(code);
  }
}

/** Usernames always include a country code. Never infer a country from a device locale. */
export function normalizePhone(input: string): string {
  const ascii = input
    .trim()
    .replace(/[٠-٩۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0)),
    );
  const compact = ascii.replace(/[\s().-]/g, "").replace(/^00/, "+");
  if (!compact.startsWith("+")) throw new PhoneError("country-code-required");
  if (!/^\+[1-9]\d{6,14}$/.test(compact))
    throw new PhoneError("invalid-number");
  try {
    const phone = parsePhoneNumberWithError(compact);
    if (!phone.isValid() || phone.ext) throw new Error("invalid");
    return phone.number;
  } catch {
    throw new PhoneError("invalid-number");
  }
}

export function displayPhone(number: string): string {
  try {
    return parsePhoneNumberWithError(number).formatInternational();
  } catch {
    return number;
  }
}
