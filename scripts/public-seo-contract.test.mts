import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import robots from "../apps/web/app/robots.ts";
import sitemap from "../apps/web/app/sitemap.ts";
import {
  isLocalizedPublicPath,
  localeFromPublicPath,
  localizedPublicPath,
  publicAlternates,
  publicSiteUrl,
  stripPublicLocale,
} from "../apps/web/lib/publicSeo.ts";
import { breadcrumbJsonLd, faqPageJsonLd, learningArticleJsonLd, organizationJsonLd, webPageJsonLd, websiteJsonLd } from "../apps/web/lib/seoJsonLd.ts";

const repo = resolve(import.meta.dirname, "..");

test("public SEO paths have stable language prefixes and reciprocal alternates", () => {
  assert.equal(localizedPublicPath("/", "th"), "/th");
  assert.equal(localizedPublicPath("/pos", "th"), "/pos");
  assert.equal(localizedPublicPath("/pos/restaurant?branch=example", "en"), "/pos/restaurant?branch=example");
  assert.equal(localizedPublicPath("/admin/dashboard", "th"), "/admin/dashboard");
  assert.equal(localizedPublicPath("/restaurant", "en"), "/en/restaurant");
  assert.equal(localizedPublicPath("/learn?q=stock", "th"), "/th/learn?q=stock");
  assert.equal(localizedPublicPath("/th/learn#steps", "en"), "/en/learn#steps");
  assert.equal(localeFromPublicPath("/en/cost-pricing"), "en");
  assert.equal(stripPublicLocale("/th/learn/restaurant"), "/learn/restaurant");
  assert.equal(isLocalizedPublicPath("/learn/guides/start-here"), true);
  assert.equal(isLocalizedPublicPath("/admin/dashboard"), false);
  assert.deepEqual(publicAlternates("/restaurant", "th"), {
    canonical: "/th/restaurant",
    languages: {
      "th-TH": "/th/restaurant",
      "en-US": "/en/restaurant",
      "x-default": "/th/restaurant",
    },
  });
});

test("root sitemap contains only localized public pages and both language variants", () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.some((url) => url.endsWith("/th/restaurant")));
  assert.ok(urls.some((url) => url.endsWith("/en/restaurant")));
  assert.ok(urls.some((url) => url.endsWith("/th/about")));
  assert.ok(urls.some((url) => url.endsWith("/en/ai-business-system")));
  assert.ok(urls.some((url) => url.endsWith("/th/learn/guides/start-here")));
  assert.ok(urls.some((url) => url.endsWith("/en/learn/guides/start-here")));
  for (const url of urls) {
    assert.match(url, /^https?:\/\/[^/]+\/(?:th|en)(?:\/|$)/);
    assert.doesNotMatch(url, /\/(?:admin|api|checkout|pos|q|bg|my|settings)(?:\/|$)/);
  }
});

test("robots advertises the root sitemap, permits ChatGPT Search and protects private surfaces", () => {
  const output = robots();
  assert.match(String(output.sitemap), /\/sitemap\.xml$/);
  const rules = Array.isArray(output.rules) ? output.rules : [output.rules];
  const openAiRule = rules.find((rule) => rule.userAgent === "OAI-SearchBot");
  assert.ok(openAiRule);
  assert.equal(openAiRule?.allow, "/");
  assert.ok(Array.isArray(openAiRule?.disallow));
  assert.ok(openAiRule?.disallow?.includes("/admin/"));
  assert.ok(openAiRule?.disallow?.includes("/api/"));
});

test("JSON-LD identifies BMS, localized breadcrumbs and reviewed learning articles", () => {
  assert.equal(organizationJsonLd()["@type"], "Organization");
  assert.equal(websiteJsonLd()["@type"], "WebSite");
  const breadcrumb = breadcrumbJsonLd("th", [
    { name: "หน้าหลัก", path: "/" },
    { name: "ร้านอาหาร", path: "/restaurant" },
  ]);
  assert.equal(breadcrumb["@type"], "BreadcrumbList");
  assert.match(JSON.stringify(breadcrumb), /\/th\/restaurant/);
  const article = learningArticleJsonLd({
    locale: "en",
    path: "/learn/guides/start-here",
    title: "Start here",
    description: "A verified guide",
    reviewedAt: "2026-10-29",
  });
  assert.equal(article["@type"], "Article");
  assert.equal(article.inLanguage, "en-US");
  assert.equal(article.dateModified, "2026-10-29");
  assert.match(String(article.url), /\/en\/learn\/guides\/start-here$/);

  const about = webPageJsonLd({
    locale: "th",
    path: "/about",
    title: "BMS คืออะไร",
    description: "ระบบบริหารธุรกิจ",
    reviewedAt: "2026-10-29",
    type: "AboutPage",
  });
  assert.equal(about["@type"], "AboutPage");
  assert.deepEqual(about.mainEntity, { "@id": "https://jachoei.com/#organization" });

  const faq = faqPageJsonLd([{ question: "BMS คืออะไร?", answer: "ระบบบริหารธุรกิจ" }]);
  assert.equal(faq["@type"], "FAQPage");
  assert.match(JSON.stringify(faq), /BMS คืออะไร/);
});

test("phase 3-5 authority pages are crawlable, measurable and ready for controlled discovery", () => {
  const aboutPage = readFileSync(resolve(repo, "apps/web/app/(main)/about/page.tsx"), "utf8");
  const aiPage = readFileSync(resolve(repo, "apps/web/app/(main)/ai-business-system/page.tsx"), "utf8");
  const audit = readFileSync(resolve(repo, "scripts/public-seo-live-audit.mjs"), "utf8");
  const indexNow = readFileSync(resolve(repo, "scripts/public-seo-indexnow.mjs"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve(repo, "apps/web/package.json"), "utf8"));
  const key = "219d7c802cd7ffabd58f4a75698af4cb";

  assert.match(aboutPage, /type: "AboutPage"/);
  assert.match(aboutPage, /faqPageJsonLd\(content\.faq\)/);
  assert.match(aiPage, /approved tools/i);
  assert.match(aiPage, /faqPageJsonLd\(content\.faq\)/);
  assert.match(audit, /expected one h1/);
  assert.match(audit, /missing hreflang/);
  assert.match(indexNow, /if \(!submit\)/);
  assert.match(indexNow, /api\.indexnow\.org\/indexnow/);
  assert.equal(readFileSync(resolve(repo, `apps/web/public/${key}.txt`), "utf8").trim(), key);
  assert.equal(packageJson.scripts["seo:audit"], "node ../../scripts/public-seo-live-audit.mjs");
  assert.equal(packageJson.scripts["seo:indexnow"], "node ../../scripts/public-seo-indexnow.mjs");
});

test("middleware rewrites locale URLs, persists language and marks private pages noindex", () => {
  const source = readFileSync(resolve(repo, "apps/web/middleware.ts"), "utf8");
  assert.match(source, /NextResponse\.rewrite/);
  assert.match(source, /x-bms-public-locale/);
  assert.match(source, /response\.cookies\.set\("lang"/);
  assert.match(source, /x-robots-tag/);
  assert.match(source, /noindex, nofollow/);
});

test("public marketing content is server-rendered instead of hidden behind the client-only session shell", () => {
  const source = readFileSync(resolve(repo, "apps/web/app/ClientProviders.tsx"), "utf8");
  assert.match(source, /onPublicSeoRoute\s*=\s*isLocalizedPublicPath/);
  assert.match(source, /onPublicSeoRoute[\s\S]{0,300}<SessionProvider>\{children\}<\/SessionProvider>/);
  assert.match(source, /Public marketing copy must remain in the server HTML/);
});

test("public theme changes keep signed-out visitors out of authenticated mutations", () => {
  const source = readFileSync(resolve(repo, "apps/web/components/ThemeToggle.tsx"), "utf8");
  assert.match(source, /const \{ isAuthenticated \} = useSession\(\)/);
  assert.match(source, /setTheme\(key\);\s*if \(isAuthenticated\) \{\s*void updateTheme/);
});

test("footer discovery survives SSR without escaped CSS text hydration errors", () => {
  const layout = readFileSync(resolve(repo, "apps/web/app/(main)/layout.tsx"), "utf8");
  const footer = readFileSync(resolve(repo, "apps/web/components/footer/AppFooter.tsx"), "utf8");
  assert.match(layout, /import AppFooter from/);
  assert.doesNotMatch(footer, /<style>\{/);
  assert.match(footer, /<style dangerouslySetInnerHTML=/);
});


test("public origin normalization prevents malformed canonical roots and embedded credentials", () => {
  const previous = process.env.NEXT_PUBLIC_BASE_URL;
  try {
    process.env.NEXT_PUBLIC_BASE_URL = "https://jachoei.com/path?query=1#fragment";
    assert.equal(publicSiteUrl(), "https://jachoei.com");
    for (const invalid of ["ftp://example.com", "https://user:password@example.com", "not a URL"]) {
      process.env.NEXT_PUBLIC_BASE_URL = invalid;
      assert.equal(publicSiteUrl(), "https://jachoei.com");
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = previous;
  }
});
