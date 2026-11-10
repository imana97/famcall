import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocales } from "expo-localization";
import { setLocale, type Locale } from "../i18n";
import { deviceLanguage, type LanguagePreference } from "../i18n/languages";
import { readLanguagePreference, saveLanguagePreference } from "../services/languagePreference";

interface Language {
  language: Locale;
  preference: LanguagePreference;
  setLanguage: (language: LanguagePreference) => Promise<void>;
}
const Context = createContext<Language | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  const deviceLocales = useLocales();
  const [preference, updatePreference] = useState<LanguagePreference>("system");
  const language = preference === "system" ? deviceLanguage(deviceLocales) : preference;
  setLocale(language);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void readLanguagePreference().then(next => {
      if (!alive) return;
      updatePreference(next);
      setReady(true);
    });
    return () => { alive = false; };
  }, []);
  const setLanguage = useCallback(async (next: LanguagePreference) => {
    await saveLanguagePreference(next);
    updatePreference(next);
  }, []);
  const value = useMemo<Language>(() => ({
    language, preference, setLanguage,
  }), [language, preference, setLanguage]);
  if (!ready) return <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}><ActivityIndicator /></View>;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLanguage() {
  const value = useContext(Context);
  if (!value) throw new Error("LanguageProvider is missing");
  return value;
}
