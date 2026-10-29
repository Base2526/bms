import assert from "node:assert/strict";
import test from "node:test";
import { inspectPublicHtml, duplicateMetadata, blocksSnippets, visibleText } from "./lib/public-seo-audit.mjs";

const url = "https://jachoei.com/en/about";
function html(faq = "A visible answer.") {
  return `<html><head><title>About BMS</title><meta name="description" content="A description"><link rel="canonical" href="${url}"></head><body><h1>About</h1><details><summary>What is BMS?</summary><p>A visible answer.</p></details><script type="application/ld+json">${JSON.stringify({ "@type": "FAQPage", mainEntity: [{ name: "What is BMS?", acceptedAnswer: { text: faq } }] })}</script></body></html>`;
}
test("semantic audit catches hidden FAQ claims instead of accepting valid JSON alone", () => {
  assert.deepEqual(inspectPublicHtml(html(), url, [url]).errors, []);
  assert.ok(inspectPublicHtml(html("An invented claim."), url, [url]).errors.includes("FAQ structured data does not match visible HTML"));
});
test("semantic audit identifies broken localized links and entity URL drift", () => {
  const source = html() + '<a href="/en/missing?private=x">Missing</a><script type="application/ld+json">{"@type":"Article","url":"https://wrong.test"}</script>';
  const result = inspectPublicHtml(source, url, [url]);
  assert.ok(result.errors.includes("localized internal link is absent from sitemap: /en/missing"));
  assert.ok(result.errors.includes("Article URL differs from canonical"));
  assert.deepEqual(result.internalLinks, ["/en/missing"]);
});
test("snippet checks recognize restrictive directives without rejecting benign robot headers", () => {
  for (const value of ["noindex, follow", "Googlebot: nosnippet", "max-snippet:0", "none"]) assert.ok(blocksSnippets(value), value);
  for (const value of ["index, follow", "max-snippet:-1", "max-snippet:100", null]) assert.equal(blocksSnippets(value), false);
});
test("duplicate detection is per locale and skips empty metadata", () => {
  const result = duplicateMetadata([
    { canonicalUrl: url, title: "BMS" }, { canonicalUrl: "https://jachoei.com/en/demo", title: "BMS" },
    { canonicalUrl: "https://jachoei.com/th/about", title: "BMS" }, { canonicalUrl: "https://jachoei.com/en/learn", title: "" },
  ], "title");
  assert.deepEqual(result, [[url, "https://jachoei.com/en/demo"]]);
});
test("visible copy excludes scripts and styles and decodes HTML entities", () => {
  assert.equal(visibleText('<style>hidden</style><script>hidden</script><p>Cost &amp; pricing</p>'), "Cost & pricing");
});
