import { en } from "./en";
import { fa } from "./fa";
export type TranslationKey = keyof typeof en;
export const catalogs = { en, fa };
export type Locale = keyof typeof catalogs;
export const languageStorageKey = "famcall.language";
export let locale: Locale = "en";
export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "fa";
}
export function setLocale(value: Locale) { locale = value; }
export function t(
  key: TranslationKey,
  values: Record<string, string | number> = {},
): string {
  return Object.entries(values).reduce<string>(
    (text, [name, value]) => text.replaceAll("{" + name + "}", locale === "fa" ? "\u2068" + String(value) + "\u2069" : String(value)),
    catalogs[locale][key],
  );
}
