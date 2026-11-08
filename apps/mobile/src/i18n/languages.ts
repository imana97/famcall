/** In-app choices only; public store listings intentionally stay English. */
export const languages = [
  { code: "en", name: "English" },
  { code: "zh", name: "简体中文" },
  { code: "hi", name: "हिन्दी" },
  { code: "es", name: "Español" },
  { code: "ar", name: "العربية" },
  { code: "fr", name: "Français" },
  { code: "bn", name: "বাংলা" },
  { code: "pt", name: "Português" },
  { code: "ru", name: "Русский" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "ur", name: "اردو" },
  { code: "fa", name: "فارسی" },
] as const;
export type Locale = (typeof languages)[number]["code"];
export type LanguagePreference = Locale | "system";
export function isLocale(value: unknown): value is Locale {
  return languages.some(language => language.code === value);
}
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || isLocale(value);
}
/** Match the user's ordered language list, independently of the region suffix. */
export function deviceLanguage(locales: readonly { languageTag?: string; languageCode?: string | null }[]): Locale {
  for (const value of locales) {
    const code = (value.languageTag || value.languageCode || "").toLowerCase().split(/[-_]/)[0];
    const canonical = code === "in" ? "id" : code;
    if (isLocale(canonical)) return canonical;
  }
  return "en";
}
export function languageName(locale: Locale) {
  return languages.find(language => language.code === locale)!.name;
}
