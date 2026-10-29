# Public SEO and AI discovery

This document is the operating contract for public search surfaces on `jachoei.com`. It covers
classic search, generative search and discovery by crawlers that cite public pages. It does not
change any authenticated BMS workflow or make a ranking guarantee.

## Scope and phases

### Phase 1 — crawl and language foundation

- Stable Thai and English URLs under `/th/**` and `/en/**`.
- Self-canonical URLs plus reciprocal `th-TH`, `en-US` and `x-default` alternates.
- One root sitemap and a robots policy that excludes private surfaces.
- Public pages render their meaningful text in the server HTML.
- Cookie-selected redirects use temporary 307 responses with private/no-store caching; explicitly
  localized URLs remain the stable canonical destinations. Footer discovery links also render in HTML.

### Phase 2 — page meaning

- Unique titles and descriptions for public landing and learning pages.
- Organization, WebSite, Breadcrumb and reviewed Article JSON-LD where the visible page supports it.
- Semantic headings and localized internal links.

### Phase 3 — first-party authority

- `/about` answers what BMS is from the product architecture and names the system of record.
- `/ai-business-system` explains how AI uses approved tools, permissions, confirmation and verified
  results.
- Both pages are bilingual, visibly reviewed and avoid invented customers, statistics, integrations
  or production claims.

### Phase 4 — answer-ready content

- Each authority page begins with a short direct answer, then adds the workflow, operating boundaries
  and visible FAQ content.
- `AboutPage`, `WebPage` and `FAQPage` JSON-LD reproduce visible copy; markup must never say more than
  the page.
- Authority pages link to detailed learning material and public workflows. Footer links make the
  pages discoverable without relying on the sitemap alone.

There is deliberately no `llms.txt`. Google states that AI Overviews and AI Mode use the normal
Search index and need no special AI file or schema. Keep public HTML useful, crawlable and factual
instead of maintaining a second body of machine-only copy.

References:

- [Google: optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- [OpenAI publisher and crawler FAQ](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq)

### Phase 5 — validation, discovery and measurement

#### Before deployment

Run the production build and then start it on a separate port:

```bash
cd apps/web
npm run build
PORT=3100 npm run start
```

In another terminal, audit every URL declared by the running sitemap:

```bash
cd apps/web
SEO_BASE_URL=http://localhost:3100 npm run seo:audit
```

The audit fails on a non-200 page, noindex header, missing title/description, missing or multiple H1,
canonical mismatch, missing hreflang, invalid JSON-LD or an unlocalized link to a public page.

#### After deployment

1. Verify the domain in Google Search Console and Bing Webmaster Tools.
2. Submit `https://jachoei.com/sitemap.xml` to both services.
3. Inspect `/th`, `/en`, both authority pages and one learning article as representative live URLs.
4. Submit only changed URLs to IndexNow. Dry-run is the default:

```bash
cd apps/web
npm run seo:indexnow -- --url /th/about --url /en/about
npm run seo:indexnow -- --url /th/about --url /en/about --submit
```

Use `--all` only after a release that materially changes every public URL. The public verification
key is intentionally served from the website root; it is not a secret.

#### Monthly scorecard

Record one row per locale and query group:

| Signal | Source | Decision it supports |
| --- | --- | --- |
| Valid indexed URLs vs sitemap URLs | Search Console Pages + Sitemaps | Find discovery or canonical problems |
| Impressions, clicks, CTR and average position | Search Console Performance | Prioritize title, snippet and content work |
| Queries by landing page and locale | Search Console Performance | Find missing answer pages and language mismatch |
| Structured-data valid/invalid count | Search Console enhancements and Rich Results Test | Catch template regressions |
| Bing indexed pages and crawl errors | Bing Webmaster Tools | Confirm non-Google discovery |
| Referrals with `utm_source=chatgpt.com` | Web analytics | Measure visits from ChatGPT search citations |
| Organic conversion to demo, signup or LINE | Consent-aware web analytics | Separate visibility from useful outcomes |

Do not compare only total traffic. Review the Thai and English cohorts separately, annotate releases,
and compare at least 28 days against the preceding 28 days. Search Console data is delayed; do not
treat the first days after deployment as a ranking verdict.

## Release status and external dependencies

Phases 1–4 are implemented and locally validated. Phase 5 has local audit and discovery tooling;
production rollout and measurement remain outstanding: Search Console/Bing ownership and sitemap submission, IndexNow
submission, and a consent-aware analytics destination still need the deployed site and account access.
The monthly scorecard above is an operating procedure, not an implemented analytics integration or
evidence of collected traffic. No scheduled monitor has been enabled.

## Content rules

- A public claim must be supported by current code or an authoritative product/domain document.
- Examples and mock data must remain visibly labeled as examples.
- Never add testimonials, customer logos, rankings, adoption numbers or integration readiness without
  evidence and approval.
- Refresh `dateModified` only after the visible content is substantively reviewed.
- Structured data must match visible content and use the same canonical URL.
- Keep private, checkout, token, POS, API and admin surfaces out of the sitemap and marked noindex.
