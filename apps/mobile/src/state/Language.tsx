import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { ActivityIndicator, View } from "react-native";
import { setLocale, type Locale } from "../i18n";
import { readLanguagePreference, saveLanguagePreference } from "../services/languagePreference";

interface Language {
  language: Locale;
  setLanguage: (language: Locale) => Promise<void>;
}
const Context = createContext<Language | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, updateLanguage] = useState<Locale>("en");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void readLanguagePreference().then(next => {
      if (!alive) return;
      setLocale(next);
      updateLanguage(next);
      setReady(true);
    });
    return () => { alive = false; };
  }, []);
  const setLanguage = useCallback(async (next: Locale) => {
    await saveLanguagePreference(next);
    updateLanguage(next);
  }, []);
  const value = useMemo<Language>(() => ({
    language, setLanguage,
  }), [language, setLanguage]);
  if (!ready) return <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}><ActivityIndicator /></View>;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLanguage() {
  const value = useContext(Context);
  if (!value) throw new Error("LanguageProvider is missing");
  return value;
}
