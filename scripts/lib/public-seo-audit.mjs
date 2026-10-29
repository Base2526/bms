function decode(value) {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
export function visibleText(html) {
  return decode(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim();
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, name, , value]) => [name.toLowerCase(), decode(value)]));
}
export function blocksSnippets(value) {
  return /(?:^|[\s,;])(?:noindex|none|nosnippet)(?=$|[\s,;])|max-snippet\s*:\s*0(?:$|[\s,;])/i.test(value || "");
}

/** Supplemental semantic checks; this does not replace a rich-results validator or index inspection. */
export function inspectPublicHtml(html, canonicalUrl, sitemapUrls) {
  const errors = [], warnings = [];
  const canonical = new URL(canonicalUrl);
  const sitemapPaths = new Set(sitemapUrls.map(url => new URL(url).pathname));
  const visible = visibleText(html);
  const normalized = value => visibleText(value).normalize("NFC");
  const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributes(tag));
  for (const tag of meta) {
    if (/^(robots|googlebot)$/i.test(tag.name || "") && blocksSnippets(tag.content)) errors.push("public page blocks indexing or snippets");
  }
  const title = visibleText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const description = meta.find(tag => tag.name === "description")?.content || "";
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => attributes(tag));
  if (links.filter(tag => tag.rel === "canonical").length !== 1) errors.push("expected exactly one canonical link");
  if (meta.filter(tag => tag.name === "description").length !== 1) errors.push("expected exactly one meta description");
  for (const property of ["og:title", "og:description", "og:image"]) {
    if (!meta.some(tag => tag.property === property && tag.content)) warnings.push(`missing ${property}`);
  }
  const ogUrl = meta.find(tag => tag.property === "og:url")?.content;
  if (ogUrl && ogUrl !== canonicalUrl) errors.push("Open Graph URL differs from canonical");
  const internalLinks = new Set();
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attributes(tag).href;
    if (!href) continue;
    let url;
    try { url = new URL(href, canonical); } catch { warnings.push("invalid link URL"); continue; }
    if (url.origin !== canonical.origin || !/^\/(th|en)(?:\/|$)/.test(url.pathname)) continue;
    internalLinks.add(url.pathname);
    if (!sitemapPaths.has(url.pathname)) errors.push(`localized internal link is absent from sitemap: ${url.pathname}`);
  }
  const schemaTypes = new Set();
  for (const [, json] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(json);
      const nodes = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== "object") { errors.push("JSON-LD node is not an object"); continue; }
        const type = node["@type"];
        for (const entry of Array.isArray(type) ? type : [type]) if (typeof entry === "string") schemaTypes.add(entry);
        if (["WebPage", "AboutPage", "Article"].includes(type) && node.url !== canonicalUrl) errors.push(`${type} URL differs from canonical`);
        if (node.dateModified && (!Number.isFinite(Date.parse(node.dateModified)) || Date.parse(node.dateModified) > Date.now() + 86400000)) errors.push("invalid or future review date");
        if (type === "FAQPage") {
          if (!Array.isArray(node.mainEntity) || !node.mainEntity.length) errors.push("FAQPage has no questions");
          for (const question of node.mainEntity || []) {
            if (!question?.name || !question?.acceptedAnswer?.text ||
                !normalized(visible).includes(normalized(question.name)) ||
                !normalized(visible).includes(normalized(question.acceptedAnswer.text))) errors.push("FAQ structured data does not match visible HTML");
          }
        }
      }
    } catch { errors.push("invalid JSON-LD"); }
  }
  return { title, description, internalLinks: [...internalLinks], schemaTypes: [...schemaTypes], errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export function duplicateMetadata(results, field) {
  const groups = new Map();
  for (const result of results) {
    const value = result[field]?.trim();
    if (!value) continue;
    const key = `${new URL(result.canonicalUrl).pathname.split("/")[1]}:${value}`;
    groups.set(key, [...(groups.get(key) || []), result.canonicalUrl]);
  }
  return [...groups.values()].filter(urls => urls.length > 1);
}
