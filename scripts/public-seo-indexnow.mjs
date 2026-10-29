#!/usr/bin/env node

const INDEXNOW_KEY = "219d7c802cd7ffabd58f4a75698af4cb";
const siteUrl = new URL(process.env.SEO_SITE_URL || "https://jachoei.com");
const args = process.argv.slice(2);
const submit = args.includes("--submit");
const all = args.includes("--all");
const requested = [];

for (let index = 0; index < args.length; index++) {
  if (args[index] === "--url") {
    const value = args[index + 1];
    if (!value) throw new Error("--url requires a path or URL");
    requested.push(new URL(value, siteUrl).toString());
    index++;
  }
}

if (!all && !requested.length) {
  console.error("Usage: npm run seo:indexnow -- --url /th/about [--url /en/about] [--submit]");
  console.error("Use --all only after a release that materially changes every public URL.");
  process.exit(2);
}

const sitemapSource = new URL(process.env.SEO_SITEMAP_URL || "/sitemap.xml", siteUrl);
const sitemapResponse = await fetch(sitemapSource, { signal: AbortSignal.timeout(30_000) });
if (!sitemapResponse.ok) throw new Error(`sitemap returned ${sitemapResponse.status}`);
const sitemap = await sitemapResponse.text();
const sitemapUrls = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
const urlList = all ? [...sitemapUrls] : requested;

for (const url of urlList) {
  const parsed = new URL(url);
  if (parsed.origin !== siteUrl.origin) throw new Error(`URL is outside ${siteUrl.origin}: ${url}`);
  if (!sitemapUrls.has(url)) throw new Error(`URL is not in the deployed sitemap: ${url}`);
}

const payload = {
  host: siteUrl.host,
  key: INDEXNOW_KEY,
  keyLocation: new URL(`/${INDEXNOW_KEY}.txt`, siteUrl).toString(),
  urlList,
};

if (!submit) {
  console.log(`[indexnow] DRY RUN ${urlList.length} URL(s)`);
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const keyResponse = await fetch(payload.keyLocation, { signal: AbortSignal.timeout(30_000) });
if (!keyResponse.ok || (await keyResponse.text()).trim() !== INDEXNOW_KEY) {
  throw new Error(`deployed key file is missing or invalid: ${payload.keyLocation}`);
}

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(30_000),
});
if (![200, 202].includes(response.status)) throw new Error(`IndexNow returned ${response.status}`);
console.log(`[indexnow] accepted ${urlList.length} URL(s) with status ${response.status}`);
