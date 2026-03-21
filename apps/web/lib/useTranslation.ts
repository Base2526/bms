"use client";

import { useCallback, useMemo } from "react";
import { format, getDictionary, type I18nKey, type Lang } from "@/lib/i18n";

export function useTranslation(lang: Lang) {
  const dict = useMemo(() => getDictionary(lang), [lang]);

  const t = useCallback(
    (key: I18nKey, vars?: Record<string, string | number>) => format(dict[key] ?? String(key), vars),
    [dict]
  );

  return { lang, t };
}
