import { en } from "@/locales/en";
import { th } from "@/locales/th";

export type Lang = "en" | "th";
export const DEFAULT_LANG: Lang = "en";

export type I18nKey = keyof typeof en;

type Dict = Record<I18nKey, string>;

function isLang(input: unknown): input is Lang {
  return input === "en" || input === "th";
}

export function getLangFromQuery(lang: unknown): Lang {
  return isLang(lang) ? lang : DEFAULT_LANG;
}

export function getDictionary(lang: Lang): Dict {
  return (lang === "th" ? th : en) as unknown as Dict;
}

export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

export function tFor(lang: Lang) {
  const dict = getDictionary(lang);
  return (key: I18nKey, vars?: Record<string, string | number>) => format(dict[key] ?? String(key), vars);
}

export function safeInternalNextPath(nextPath: string | null | undefined): string | null {
  if (!nextPath) return null;
  if (!nextPath.startsWith("/")) return null;
  if (nextPath.startsWith("//")) return null;
  return nextPath;
}
