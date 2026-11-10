import { beforeEach, expect, test, vi } from "vitest";
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: storage }));
import { catalogs, isLocale, languageStorageKey, locale, setLocale, t, type TranslationKey } from "../apps/mobile/src/i18n";
import { deviceLanguage, languages, type Locale } from "../apps/mobile/src/i18n/languages";
import { readLanguagePreference, saveLanguagePreference } from "../apps/mobile/src/services/languagePreference";

beforeEach(() => { vi.resetAllMocks(); setLocale("en"); });

test.each(languages)("$code covers every message and preserves placeholders", ({ code }) => {
  expect(Object.keys(catalogs[code]).sort()).toEqual(Object.keys(catalogs.en).sort());
  for (const key of Object.keys(catalogs.en) as TranslationKey[]) {
    expect(catalogs[code][key].trim(), key).not.toBe("");
    expect([...catalogs[code][key].matchAll(/\{\w+\}/g)].map(match => match[0]).sort(), key)
      .toEqual([...catalogs.en[key].matchAll(/\{\w+\}/g)].map(match => match[0]).sort());
  }
});

test("new installs and invalid saved values follow the phone language", async () => {
  expect(locale).toBe("en");
  for (const saved of [null, "", "FA", "unexpected"]) {
    storage.getItem.mockResolvedValueOnce(saved);
    expect(await readLanguagePreference()).toBe("system");
  }
  expect(isLocale("ar")).toBe(true);
  expect(isLocale("FA")).toBe(false);
  expect(isLocale("system")).toBe(false);
});

test.each([
  ["en-GB", "en"], ["es-MX", "es"], ["pt-BR", "pt"], ["pt-PT", "pt"],
  ["zh-Hans-CN", "zh"], ["zh-Hant-TW", "zh"], ["fa-AF", "fa"], ["ar-EG", "ar"],
  ["ur-PK", "ur"], ["hi-IN", "hi"], ["bn-BD", "bn"], ["ru-RU", "ru"],
  ["fr-CA", "fr"], ["id-ID", "id"], ["in-ID", "id"], ["de-DE", "en"],
])("matches phone language %s to %s", (tag, expected) => {
  expect(deviceLanguage([{ languageTag: tag }])).toBe(expected);
});

test("uses the ordered phone preferences with an English fallback", () => {
  expect(deviceLanguage([{ languageTag: "de-DE" }, { languageTag: "fr-FR" }, { languageTag: "es-ES" }])).toBe("fr");
  expect(deviceLanguage([{ languageCode: "fa" }])).toBe("fa");
  expect(deviceLanguage([])).toBe("en");
  expect(deviceLanguage([{ languageTag: "unknown" }])).toBe("en");
});

test.each(languages)("a manual $code preference survives startup and can return to automatic", async ({ code }) => {
  storage.setItem.mockResolvedValue(undefined);
  await saveLanguagePreference(code);
  expect(storage.setItem).toHaveBeenCalledWith(languageStorageKey, code);
  expect(locale).toBe(code);
  storage.getItem.mockResolvedValue(code);
  expect(await readLanguagePreference()).toBe(code);
  await saveLanguagePreference("system");
  expect(storage.setItem).toHaveBeenLastCalledWith(languageStorageKey, "system");
  storage.getItem.mockResolvedValue("system");
  expect(await readLanguagePreference()).toBe("system");
});

test("failed storage writes keep the active language unchanged", async () => {
  storage.getItem.mockRejectedValue(new Error("unavailable"));
  expect(await readLanguagePreference()).toBe("system");
  storage.setItem.mockRejectedValue(new Error("full"));
  await expect(saveLanguagePreference("fa")).rejects.toThrow();
  expect(locale).toBe("en");
});

test.each(["fa", "ar", "ur"] as Locale[])("keeps dynamic numbers, names and URLs intact in %s", code => {
  const phone = "+12025550101";
  setLocale(code);
  expect(t("verifyBody", { phone })).toContain("\u2068" + phone + "\u2069");
  expect(t("call", { name: "مامان" })).toContain("مامان");
  expect(t("resendCountdown", { seconds: 30 })).toContain("30");
  expect(t("inviteMessage", { url: "https://famcall.web.app" })).toContain("https://famcall.web.app");
});
