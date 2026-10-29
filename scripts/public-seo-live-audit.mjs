#!/usr/bin/env node

const baseUrl = new URL(process.env.SEO_BASE_URL || "http://localhost:3000");
const requestedConcurrency = Number(process.env.SEO_AUDIT_CONCURRENCY || 6);
if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1 || requestedConcurrency > 16) {
  throw new Error("SEO_AUDIT_CONCURRENCY must be an integer from 1 to 16");
}
const concurrency = requestedConcurrency;

function tags(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
}

function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1] || null;
}

function textOf(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "";
}

function publicHrefErrors(html) {
  const publicRoots = [
    "restaurant", "cost-pricing", "how-it-works", "board-game", "retail-local", "demo",
    "about", "ai-business-system", "help", "roadmap", "support", "privacy", "terms",
    "pdpa", "data-deletion", "open-source", "license", "learn",
  ];
  const pattern = new RegExp(`^/(?:${publicRoots.join("|")})(?:[/?#]|$)`);
  return tags(html, "a")
    .map((tag) => attr(tag, "href"))
    .filter((href) => href && pattern.test(href));
}

async function auditPage(canonicalUrl) {
  const canonical = new URL(canonicalUrl);
  const requestUrl = new URL(`${canonical.pathname}${canonical.search}`, baseUrl);
  const response = await fetch(requestUrl, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  const html = await response.text();
  const errors = [];

  if (response.status !== 200) errors.push(`status ${response.status}`);
  if (response.headers.get("x-robots-tag")) errors.push(`x-robots-tag ${response.headers.get("x-robots-tag")}`);
  if (!textOf(html, "title")) errors.push("missing title");
  if (!tags(html, "meta").some((tag) => attr(tag, "name")?.toLowerCase() === "description" && attr(tag, "content"))) {
    errors.push("missing meta description");
  }

  const h1Count = (html.match(/<h1(?:\s|>)/gi) || []).length;
  if (h1Count !== 1) errors.push(`expected one h1, found ${h1Count}`);

  const linkTags = tags(html, "link");
  const canonicalHref = linkTags.find((tag) => attr(tag, "rel")?.toLowerCase() === "canonical");
  if (attr(canonicalHref || "", "href") !== canonicalUrl) errors.push("canonical mismatch");

  const alternates = new Map(
    linkTags
      .filter((tag) => attr(tag, "rel")?.toLowerCase() === "alternate" && attr(tag, "hreflang"))
      .map((tag) => [attr(tag, "hreflang"), attr(tag, "href")]),
  );
  for (const language of ["th-TH", "en-US", "x-default"]) {
    const expected = new URL(canonicalUrl);
    expected.pathname = expected.pathname.replace(/^\/(th|en)(?=\/|$)/, language === "en-US" ? "/en" : "/th");
    if (alternates.get(language) !== expected.toString()) errors.push(`missing hreflang or incorrect destination: ${language}`);
  }

  const expectedLang = canonical.pathname.split("/")[1];
  const htmlTag = tags(html, "html")[0] || "";
  if (attr(htmlTag, "lang") !== expectedLang) errors.push(`html lang is not ${expectedLang}`);
  if (tags(html, "meta").some(tag => /^(robots|googlebot)$/i.test(attr(tag, "name") || "") && /noindex|none/i.test(attr(tag, "content") || ""))) errors.push("public page has noindex meta");
  if (!canonical.pathname.includes("/learn") && !tags(html, "a").some(tag => attr(tag, "href") === `/${expectedLang}/about`)) {
    errors.push("missing server-rendered authority navigation");
  }

  const jsonLdBlocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (!jsonLdBlocks.length) errors.push("missing JSON-LD");
  for (const [, value] of jsonLdBlocks) {
    try { JSON.parse(value); } catch { errors.push("invalid JSON-LD"); break; }
  }

  const badHrefs = publicHrefErrors(html);
  if (badHrefs.length) errors.push(`unlocalized public hrefs: ${[...new Set(badHrefs)].join(", ")}`);

  return { canonicalUrl, errors };
}

async function main() {
  const sitemapUrl = new URL("/sitemap.xml", baseUrl);
  const [sitemapResponse, robotsResponse] = await Promise.all([
    fetch(sitemapUrl, { signal: AbortSignal.timeout(30_000) }),
    fetch(new URL("/robots.txt", baseUrl), { signal: AbortSignal.timeout(30_000) }),
  ]);
  if (!sitemapResponse.ok) throw new Error(`sitemap returned ${sitemapResponse.status}`);
  if (!robotsResponse.ok) throw new Error(`robots returned ${robotsResponse.status}`);

  const sitemap = await sitemapResponse.text();
  const robots = await robotsResponse.text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (!urls.length) throw new Error("sitemap contains no URLs");
  if (new Set(urls).size !== urls.length) throw new Error("duplicate sitemap URLs");
  for (const language of ["th", "en"]) {
    const response = await fetch(new URL("/about?ref=audit", baseUrl), {
      redirect: "manual", headers: { cookie: `lang=${language}` }, signal: AbortSignal.timeout(30_000),
    });
    const location = new URL(response.headers.get("location") || "/", baseUrl);
    if (response.status !== 307 || location.pathname !== `/${language}/about` || location.search !== "?ref=audit" || !response.headers.get("cache-control")?.includes("no-store")) {
      throw new Error(`preference redirect is incorrect or cacheable for ${language}`);
    }
  }
  if (!/User-agent:\s*OAI-SearchBot/i.test(robots)) throw new Error("robots.txt does not name OAI-SearchBot");
  if (!/Sitemap:\s*https?:\/\//i.test(robots)) throw new Error("robots.txt does not advertise an absolute sitemap URL");

  let cursor = 0;
  let checked = 0;
  const failures = [];
  async function worker() {
    while (cursor < urls.length) {
      const index = cursor++;
      let result;
      try {
        result = await auditPage(urls[index]);
      } catch (error) {
        result = { canonicalUrl: urls[index], errors: [error instanceof Error ? error.message : String(error)] };
      }
      checked++;
      if (result.errors.length) failures.push(result);
      if (checked % 50 === 0) console.log(`[seo-audit] checked ${checked}/${urls.length}`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failures.length) {
    for (const failure of failures) console.error(`[seo-audit] ${failure.canonicalUrl}: ${failure.errors.join("; ")}`);
    throw new Error(`${failures.length}/${urls.length} public pages failed`);
  }
  console.log(`[seo-audit] PASS ${urls.length}/${urls.length} public pages at ${baseUrl.origin}`);
}

main().catch((error) => {
  console.error(`[seo-audit] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
