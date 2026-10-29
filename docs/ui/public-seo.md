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

Phases 1–4 have been implemented. Production passed the previous HTTP audit for 208 URLs on
2026-10-29; that verifies the deployed technical surface, not indexing or citations. The expanded audit exposed 30 learning pages linking to `/th/pos` or `/en/pos`
(and restaurant variants), which returned 404. The locale helper now leaves operational URLs
unprefixed; regression coverage prevents this mistake. The current branch adds answer sections, entity/contact links, stronger auditing and optional consent-gated
analytics. These changes require deployment before they affect production.

Search Console/Bing ownership, sitemap submission, IndexNow submission and GA4 account setup remain
external steps. There is no evidence in the repository that these account-side steps are complete.
No scheduled monitor has been enabled.

### Optional GA4 activation (disabled by default)

1. Create a dedicated GA4 web data stream for the public BMS website. **Turn off Enhanced
   Measurement entirely**, including history page views, outbound clicks, form interactions, search
   and downloads. `send_page_view: false` alone does not disable enhanced/history measurement.
   Do not install another Google tag or GTM container beside this integration.
2. Set appropriate GA property retention and access settings. Register `discovery_source` and
   `cta_action` as event-scoped custom dimensions if needed. Events are `page_view` and
   `public_cta_click`; CTA values are `demo_open`, `signup_start`, `line_contact`, and `support_open`.
   These are intent clicks, **not completed registrations, payments or leads**. GA4 may additionally
   create its standard session/engagement events once enabled.
3. Set runtime `PUBLIC_GA4_MEASUREMENT_ID=G-...` in the deployment environment, then recreate the
   web service. This public identifier is read on the server, not baked into `NEXT_PUBLIC_*`.
   All three standard Compose profiles pass it through. Missing/invalid IDs load no tag and send
   no data; never enable the fake browser-test ID on a deployed site.
4. Verify no Google requests before consent or after rejection; consent must explicitly name Google
   Analytics. Prior `pdpa_consent_v1` choices are not reused. Re-test grant, revoke, blocked storage,
   cross-tab changes and private-route navigation before enabling real collection.
5. Confirm the manually sent page URL has no query or fragment. Raw referrers/UTMs, typed text,
   calculator values, account identifiers, tenant shops and private pages are excluded. The source
   classification is a bounded category, not proof that AI cited the page. DNT/GPC disables collection.
6. The footer allows withdrawal. Consent is stored for up to 180 days; rejection clears this
   integration's `bms_analytics_*` cookies. Advertising storage, personalization and Google signals
   are disabled. No advanced-consent cookieless pings are intentionally sent. The Google tag still
   processes connection metadata and its own analytics cookies after explicit permission.
7. Learning pages can use a previously granted preference. Visitors can manage it through the
   privacy page's footer; visiting a guide does not opt them in.

Account-side Enhanced Measurement settings cannot be verified from repository tests. Validate
in the actual GA4 stream before launch.

References: [Google consent setup](https://developers.google.com/tag-platform/security/guides/consent),
[manual page views](https://developers.google.com/analytics/devguides/collection/ga4/views).

### Repeatable audit evidence

```bash
SEO_BASE_URL=http://localhost:3000 npm run seo:audit -- --output ../../.test-output/seo/local.json
SEO_BASE_URL=https://jachoei.com npm run seo:audit -- --output ../../.test-output/seo/production.json
```

Reports include each URL's status, canonical/hreflang checks, title, description, schema types,
localized links, warnings, HTML bytes and request duration. The audit now rejects broken localized
links to pages outside the sitemap, duplicate canonical tags, restrictive snippet directives, page
schema/OG URL drift, invalid review dates and FAQ claims absent from server HTML. Duplicate titles
and descriptions within one language are reported for editorial review. HTML/link and JSON-LD
checks do not prove indexing, rich-result eligibility or citations. Fetch durations are not Core Web
Vitals; measure those separately with field data and browser performance tooling.

Store reports under ignored `.test-output/`. Compare the same environment and build when reviewing
changes. Do not commit account reports or visitor data.

## Content rules

- A public claim must be supported by current code or an authoritative product/domain document.
- Examples and mock data must remain visibly labeled as examples.
- Never add testimonials, customer logos, rankings, adoption numbers or integration readiness without
  evidence and approval.
- Refresh `dateModified` only after the visible content is substantively reviewed.
- Structured data must match visible content and use the same canonical URL.
- Keep private, checkout, token, POS, API and admin surfaces out of the sitemap and marked noindex.


### Browser regression check

Start a local production build with the fake test identifier (never a real GA4 property):

```bash
cd apps/web
PUBLIC_GA4_MEASUREMENT_ID=G-BMSSEOQA PORT=3114 npm run start
# In another terminal, from the repository root:
BMS_SMOKE_URL=http://127.0.0.1:3114 node scripts/public-seo-browser-smoke.mjs
```

The smoke requires Playwright and Chrome; `BMS_PLAYWRIGHT_MODULE` can point to an installed
Playwright module. All external traffic is blocked and the Google tag is replaced with a local
fixture. It checks both languages at 1440px/390px, live FAQ interactions, corrected POS links,
explicit opt-in, withdrawal, cross-tab synchronization, DNT/GPC, blocked storage, sanitized payloads
and SPA page views. Use `BMS_SEO_VISUAL_ONLY=1` to run the page/layout checks against the regular
unconfigured development server. Screenshots and local navigation timings go to
`.test-output/public-seo-browser/`; they are not field Core Web Vitals.
