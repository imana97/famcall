import { en } from "./en";
export type TranslationKey = keyof typeof en;
// Register additional catalogs here. Every locale deliberately uses LTR layout.
const catalogs = { en };
export const locale = "en" as keyof typeof catalogs;
export function t(
  key: TranslationKey,
  values: Record<string, string | number> = {},
): string {
  return Object.entries(values).reduce<string>(
    (text, [name, value]) => text.replaceAll("{" + name + "}", String(value)),
    catalogs[locale][key],
  );
}
