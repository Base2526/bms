"use client";

import { useMemo } from "react";
import { useI18n } from "@/lib/i18nContext";
import { createUiTranslator } from "@/i18n/uiText";

export type { UiTranslator } from "@/i18n/uiText";
export const thaiUiText = createUiTranslator("th");

export function useUiText() {
  const { lang } = useI18n();
  return useMemo(() => createUiTranslator(lang), [lang]);
}
