import AsyncStorage from "@react-native-async-storage/async-storage";
import { languageStorageKey, setLocale } from "../i18n";
import { isLanguagePreference, type LanguagePreference } from "../i18n/languages";

export async function readLanguagePreference(): Promise<LanguagePreference> {
  try {
    const saved = await AsyncStorage.getItem(languageStorageKey);
    return isLanguagePreference(saved) ? saved : "system";
  } catch { return "system"; }
}

export async function saveLanguagePreference(language: LanguagePreference): Promise<void> {
  await AsyncStorage.setItem(languageStorageKey, language);
  if (language !== "system") setLocale(language);
}
