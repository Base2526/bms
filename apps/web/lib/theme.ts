export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_COOKIE = "theme";
export const THEME_STORAGE_KEY = "theme";

function isThemeMode(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark" || v === "system";
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode;
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; samesite=lax`;
}

export function getThemeMode(): ThemeMode {
  const fromCookie = readCookie(THEME_COOKIE);
  if (isThemeMode(fromCookie)) return fromCookie;

  if (typeof window !== "undefined") {
    try {
      const fromStorage = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeMode(fromStorage)) return fromStorage;
    } catch {
      // ignore
    }
  }

  return "system";
}

export function getResolvedTheme(): ResolvedTheme {
  if (typeof document !== "undefined") {
    const d = document.documentElement.dataset.theme;
    if (d === "light" || d === "dark") return d;
  }

  return resolveTheme(getThemeMode());
}

export function applyThemeToDom(mode: ThemeMode) {
  if (typeof document === "undefined") return;

  const resolved = resolveTheme(mode);
  const el = document.documentElement;

  el.dataset.themeMode = mode;
  el.dataset.theme = resolved;

  if (resolved === "dark") el.classList.add("dark");
  else el.classList.remove("dark");

  // Helps native UI (scrollbars/form controls) match.
  el.style.colorScheme = resolved;
}

export function setThemeMode(mode: ThemeMode) {
  writeCookie(THEME_COOKIE, mode);

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore
  }

  applyThemeToDom(mode);

  // Notify same-tab subscribers.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("themechange"));
  }
}

export function subscribeTheme(cb: () => void) {
  if (typeof window === "undefined") return () => {};

  const onThemeChange = () => cb();
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    cb();
  };

  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onMq = () => {
    // Only update resolved theme when user chose system.
    if (getThemeMode() !== "system") return;
    applyThemeToDom("system");
    cb();
  };

  window.addEventListener("themechange", onThemeChange);
  window.addEventListener("storage", onStorage);
  if (mq?.addEventListener) mq.addEventListener("change", onMq);
  else mq?.addListener?.(onMq);

  return () => {
    window.removeEventListener("themechange", onThemeChange);
    window.removeEventListener("storage", onStorage);
    if (mq?.removeEventListener) mq.removeEventListener("change", onMq);
    else mq?.removeListener?.(onMq);
  };
}
