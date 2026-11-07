import AsyncStorage from "@react-native-async-storage/async-storage";
import { isLocale, languageStorageKey, setLocale, type Locale } from "../i18n";

export async function readLanguagePreference(): Promise<Locale> {
  try {
    const saved = await AsyncStorage.getItem(languageStorageKey);
    return isLocale(saved) ? saved : "en";
  } catch { return "en"; }
}

export async function saveLanguagePreference(language: Locale): Promise<void> {
  await AsyncStorage.setItem(languageStorageKey, language);
  setLocale(language);
}
