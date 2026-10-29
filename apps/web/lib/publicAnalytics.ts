import { PUBLIC_MARKETING_PATHS, localeFromPublicPath, stripPublicLocale } from "./publicSeo";
import { BMS_LINE_OA_URL } from "./bms/lineOfficialAccount";

// Marketing only. Never collect account, tenant, checkout, search or arbitrary URLs.
export function analyticsPage(pathname: string, learningPaths: readonly string[] = []): { path: string; locale: "th" | "en" } | null {
  const path = pathname.split(/[?#]/, 1)[0];
  const locale = localeFromPublicPath(path);
  if (!locale) return null;
  const bare = stripPublicLocale(path);
  if (!(PUBLIC_MARKETING_PATHS as readonly string[]).includes(bare) &&
      !learningPaths.includes(bare)) return null;
  return { path, locale };
}

export function validMeasurementId(value: string | undefined): string | null {
  const id = value?.trim();
  return id && /^G-[A-Z0-9]{4,20}$/.test(id) ? id : null;
}

// Categories are intentionally coarse: never transmit raw referrers, UTMs or query strings.
export function analyticsSource(pageUrl: string, referrer: string): string {
  try {
    const url = new URL(pageUrl);
    const utm = url.searchParams.get("utm_source")?.toLowerCase();
    const known: Record<string, string> = {
      "chatgpt.com": "chatgpt", chatgpt: "chatgpt", "perplexity.ai": "perplexity",
      perplexity: "perplexity", "claude.ai": "claude", "copilot.microsoft.com": "copilot",
    };
    if (utm && Object.hasOwn(known, utm)) return known[utm];
    if (!referrer) return "direct_or_unknown";
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (host === url.hostname.replace(/^www\./, "")) return "internal";
    if (Object.hasOwn(known, host)) return known[host];
    if (/^google\.(com|co\.th)$/.test(host)) return "google";
    if (host === "bing.com") return "bing";
    return "other_referral";
  } catch { return "direct_or_unknown"; }
}

export function analyticsCta(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin === new URL(BMS_LINE_OA_URL).origin && url.pathname === new URL(BMS_LINE_OA_URL).pathname) return "line_contact";
    if (url.origin !== origin) return null;
    if (url.pathname === "/shop-signup") return "signup_start";
    const path = stripPublicLocale(url.pathname);
    if (path === "/demo") return "demo_open";
    if (path === "/support") return "support_open";
    return null;
  } catch { return null; }
}
