import { en } from "./en";
import { fa } from "./fa";
import { zh } from "./zh";
import { hi } from "./hi";
import { es } from "./es";
import { ar } from "./ar";
import { fr } from "./fr";
import { bn } from "./bn";
import { pt } from "./pt";
import { ru } from "./ru";
import { id } from "./id";
import { ur } from "./ur";
import type { Locale } from "./languages";
export { isLocale } from "./languages";
export type { Locale } from "./languages";
export type TranslationKey = keyof typeof en;
export const catalogs = { en, fa, zh, hi, es, ar, fr, bn, pt, ru, id, ur } satisfies Record<Locale, Record<TranslationKey, string>>;
export const languageStorageKey = "famcall.language";
export let locale: Locale = "en";
export function setLocale(value: Locale) { locale = value; }
export function t(
  key: TranslationKey,
  values: Record<string, string | number> = {},
): string {
  return Object.entries(values).reduce<string>(
    (text, [name, value]) => text.replaceAll("{" + name + "}", ["fa", "ar", "ur"].includes(locale) ? "\u2068" + String(value) + "\u2069" : String(value)),
    catalogs[locale][key],
  );
}
