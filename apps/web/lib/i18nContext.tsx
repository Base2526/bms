"use client";

import React, { createContext, useContext, useMemo } from "react";
import { Lang, getMessage } from "@/i18n";

type I18nContextValue = {
  lang: Lang;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLang?: (lang: Lang) => void; // ให้ component ข้างในเปลี่ยนได้
};

const I18nContext = createContext<I18nContextValue>({
  lang: "th",
  t: (k) => k,
});

export function I18nProvider({
  lang,
  setLang,
  children,
}: {
  lang: Lang;
  setLang?: (lang: Lang) => void;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: (key: string, vars?: Record<string, string | number>) => getMessage(lang, key, vars),
    }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
