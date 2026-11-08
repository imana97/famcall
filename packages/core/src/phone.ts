import { parsePhoneNumberWithError } from "libphonenumber-js/max";

export class PhoneError extends Error {
  constructor(
    public readonly code: "country-code-required" | "invalid-number",
  ) {
    super(code);
  }
}

/** Keep phone usernames and SMS codes canonical across supported keyboards. */
export function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹०-९০-৯０-９]/g, digit => {
    const code = digit.charCodeAt(0);
    const zero = [0x660, 0x6f0, 0x966, 0x9e6, 0xff10].find(start => code >= start && code <= start + 9)!;
    return String(code - zero);
  });
}

/** Usernames always include a country code. Never infer a country from a device locale. */
export function normalizePhone(input: string): string {
  const ascii = normalizeDigits(input).trim();
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
