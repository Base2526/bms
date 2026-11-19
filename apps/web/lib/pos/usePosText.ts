"use client";
import { useMemo } from "react";
import { useI18n } from "@/lib/i18nContext";
import { createPosTranslator } from "@/i18n/posClient";
export { createPosTranslator, type PosTranslator } from "@/i18n/posClient";
export const thaiPosText = createPosTranslator("th");
export function usePosText() {
  const { lang } = useI18n();
  return useMemo(() => createPosTranslator(lang), [lang]);
}
