import type { Lang } from "@/i18n";

export type Bilingual<T> = {
  en: T;
  th: T;
};

export const FALLBACK_LANG: Lang = "en";

export function normalizeLang(input: unknown): Lang | null {
  if (input === "en" || input === "th") return input;
  return null;
}

/**
 * Resolve bilingual content with English fallback.
 * - If `lang` is missing/unknown, returns `en`.
 * - If the requested language is missing (shouldn't happen), returns `en`.
 */
export function resolveBilingual<T>(content: Partial<Record<Lang, T>> & { en: T }, lang: Lang | null | undefined): T {
  if (lang && content[lang] != null) return content[lang] as T;
  return content.en;
}
