import { beforeEach, expect, test, vi } from "vitest";
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: storage }));
import { catalogs, isLocale, languageStorageKey, locale, setLocale, t, type TranslationKey } from "../apps/mobile/src/i18n";
import { readLanguagePreference, saveLanguagePreference } from "../apps/mobile/src/services/languagePreference";

beforeEach(() => { vi.resetAllMocks(); setLocale("en"); });

test("Persian covers every English message and preserves interpolation placeholders", () => {
  expect(Object.keys(catalogs.fa).sort()).toEqual(Object.keys(catalogs.en).sort());
  for (const key of Object.keys(catalogs.en) as TranslationKey[]) {
    expect(catalogs.fa[key].trim(), key).not.toBe("");
    expect([...catalogs.fa[key].matchAll(/\{\w+\}/g)].map(match => match[0]).sort(), key)
      .toEqual([...catalogs.en[key].matchAll(/\{\w+\}/g)].map(match => match[0]).sort());
  }
});

test("English is the default when no valid preference is saved, regardless of device language", async () => {
  expect(locale).toBe("en");
  expect(t("settings")).toBe("Settings");
  for (const saved of [null, "", "ar", "FA", "unexpected"]) {
    storage.getItem.mockResolvedValueOnce(saved);
    expect(await readLanguagePreference()).toBe("en");
  }
  expect(isLocale("fa")).toBe(true);
  expect(isLocale("en")).toBe(true);
  expect(isLocale("ar")).toBe(false);
});

test("the saved language survives a fresh startup and can switch back to English", async () => {
  storage.setItem.mockResolvedValue(undefined);
  await saveLanguagePreference("fa");
  expect(storage.setItem).toHaveBeenCalledWith(languageStorageKey, "fa");
  expect(t("settings")).toBe("تنظیمات");
  storage.getItem.mockResolvedValue("fa");
  setLocale("en");
  setLocale(await readLanguagePreference());
  expect(t("language")).toBe("زبان");
  await saveLanguagePreference("en");
  expect(t("settings")).toBe("Settings");
});

test("storage failures do not leave the UI and stored language out of sync", async () => {
  storage.getItem.mockRejectedValue(new Error("unavailable"));
  expect(await readLanguagePreference()).toBe("en");
  storage.setItem.mockRejectedValue(new Error("full"));
  await expect(saveLanguagePreference("fa")).rejects.toThrow();
  expect(locale).toBe("en");
});

test("phone numbers and names stay intact within Persian messages", () => {
  const phone = "+12025550101";
  expect(t("verifyBody", { phone })).toBe(`Enter the six-digit code sent to ${phone}.`);
  setLocale("fa");
  expect(t("verifyBody", { phone })).toContain("\u2068" + phone + "\u2069");
  expect(t("call", { name: "مامان" })).toContain("مامان");
  expect(t("resendCountdown", { seconds: 30 })).toContain("30");
});
