// Shared `lang` cookie helpers — mirrors lib/theme.ts's getThemeMode()/setThemeMode() shape,
// but deliberately smaller: there's no localStorage/matchMedia/DOM-class analog for language,
// and actually re-rendering already-mounted server components with the new value still requires
// the caller to call router.refresh() after setLangCookie() (see HeaderBar.tsx's changeLang()).
import type { Lang } from "@/i18n";

export const LANG_COOKIE = "lang";

export function isLang(value: unknown): value is Lang {
  return value === "th" || value === "en";
}

export function getLangCookie(): Lang | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )lang=([^;]+)/);
  try {
    const value = m ? decodeURIComponent(m[1]) : null;
    return isLang(value) ? value : null;
  } catch { return null; }
}

export function setLangCookie(lang: Lang, maxAgeSeconds?: number) {
  if (typeof document === "undefined") return;
  document.cookie = `lang=${lang}; path=/; samesite=lax${maxAgeSeconds ? `; max-age=${maxAgeSeconds}` : ""}`;
}
