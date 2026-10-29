import type { Metadata } from "next";

export type PublicSeoLocale = "th" | "en";

export const PUBLIC_SEO_LOCALES: readonly PublicSeoLocale[] = ["th", "en"];

// Only pages in this catalog receive stable language-prefixed public URLs. Keep
// account, checkout, POS, token and tenant-shop routes outside this list.
export const PUBLIC_MARKETING_PATHS = [
  "/",
  "/restaurant",
  "/cost-pricing",
  "/how-it-works",
  "/board-game",
  "/retail-local",
  "/demo",
  "/about",
  "/ai-business-system",
  "/help",
  "/roadmap",
  "/support",
  "/privacy",
  "/terms",
  "/pdpa",
  "/data-deletion",
  "/open-source",
  "/license",
] as const;

const PUBLIC_MARKETING_PATH_SET = new Set<string>(PUBLIC_MARKETING_PATHS);
const LOCALE_PREFIX_RE = /^\/(th|en)(?=\/|$)/;

export function publicSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (!url.username && !url.password && (url.protocol === "https:" ||
          (url.protocol === "http:" && process.env.NODE_ENV !== "production"))) {
        return url.origin;
      }
    } catch {
      // Fall through to the production public origin.
    }
  }
  return "https://jachoei.com";
}

export function localeFromPublicPath(pathname: string): PublicSeoLocale | null {
  const match = pathname.match(LOCALE_PREFIX_RE);
  return match?.[1] === "th" || match?.[1] === "en" ? match[1] : null;
}

export function stripPublicLocale(pathname: string): string {
  const stripped = pathname.replace(LOCALE_PREFIX_RE, "");
  return stripped || "/";
}

export function isLocalizedPublicPath(pathname: string): boolean {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  if (PUBLIC_MARKETING_PATH_SET.has(path)) return true;
  return path === "/learn" || (path.startsWith("/learn/") && !path.endsWith("/sitemap.xml"));
}

export function localizedPublicPath(path: string, locale: PublicSeoLocale): string {
  if (!path.startsWith("/")) path = `/${path}`;
  const hashIndex = path.indexOf("#");
  const queryIndex = path.indexOf("?");
  const suffixIndex = [hashIndex, queryIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? path.length;
  const pathname = stripPublicLocale(path.slice(0, suffixIndex)) || "/";
  const suffix = path.slice(suffixIndex);
  // Operational and signed URLs never receive a public language prefix.
  if (!isLocalizedPublicPath(pathname)) return `${pathname}${suffix}`;
  return pathname === "/" ? `/${locale}${suffix}` : `/${locale}${pathname}${suffix}`;
}

export function publicAlternates(path: string, locale: PublicSeoLocale): Metadata["alternates"] {
  return {
    canonical: localizedPublicPath(path, locale),
    languages: {
      "th-TH": localizedPublicPath(path, "th"),
      "en-US": localizedPublicPath(path, "en"),
      "x-default": localizedPublicPath(path, "th"),
    },
  };
}

export function publicPageMetadata(input: {
  path: string;
  locale: PublicSeoLocale;
  title: string;
  description: string;
}): Metadata {
  const url = localizedPublicPath(input.path, input.locale);
  return {
    title: input.title,
    description: input.description,
    alternates: publicAlternates(input.path, input.locale),
    openGraph: {
      type: "website",
      siteName: "BMS",
      title: input.title,
      description: input.description,
      url,
      locale: input.locale === "th" ? "th_TH" : "en_US",
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: ["/og.png"],
    },
  };
}

export function absolutePublicUrl(path: string): string {
  return `${publicSiteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
