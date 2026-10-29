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
| AI-feature impressions by page, country and device | Search Console Generative AI performance | Measure Google AI visibility separately from ordinary search |
| Queries by landing page and locale | Search Console Performance | Find missing answer pages and language mismatch |
| Structured-data valid/invalid count | Search Console enhancements and Rich Results Test | Catch template regressions |
| Bing indexed pages and crawl errors | Bing Webmaster Tools | Confirm non-Google discovery |
| Citations, cited URLs and grounding queries | Bing AI Performance | Measure citations on supported Microsoft/partner surfaces, not all AI engines |
| Referrals with `utm_source=chatgpt.com` | Web analytics | Measure visits from ChatGPT search citations |
| Organic conversion to demo, signup or LINE | Consent-aware web analytics | Separate visibility from useful outcomes |

Do not compare only total traffic. Review the Thai and English cohorts separately, annotate releases,
and compare at least 28 days against the preceding 28 days. Search Console data is delayed; do not
treat the first days after deployment as a ranking verdict.

## How to judge whether the work delivers results

Technical audit success is a release prerequisite, not proof of traffic, citations or revenue.
Use four separate layers; do not combine them into an invented universal AI SEO score.

| Layer | Measure | Evidence of improvement | Interpretation limit |
| --- | --- | --- | --- |
| Discovery | Intended canonical pages indexed / intended indexable pages; priority-page crawl/index status | Priority pages are discoverable with no blocking errors | A 200 response, sitemap entry or bot visit does not prove indexing |
| AI visibility | Google AI-feature impressions; Bing citations and cited pages; repeatable prompt-panel citation rate | More relevant non-brand visibility and accurate citations across multiple periods | Each provider covers different surfaces; do not sum their metrics into a global market share |
| Visits and intent | Observed AI-source sessions; sessions containing a contact/demo/signup CTA | Absolute intent sessions and intent rate rise together | Opt-in and referrer loss undercount traffic; clicks do not prove conversations or registrations |
| Business outcomes | Qualified enquiries, completed shop registrations, activated shops and paid subscriptions with supported attribution | More real prospective shops or customers, with stable or improving quality | The current public analytics integration does not join visits to authenticated/business outcomes |

### Measurement setup and baseline

- Record the actual production deployment time and commit. Pushing Git is not deployment. Compare
  production evidence with the deployed commit; local audits cannot measure production impact.
- Verify Search Console and Bing ownership, submit the canonical sitemap, and confirm Google Search
  generative-AI inclusion settings. Activate GA4 only after following the consent and stream setup
  below. Export account data privately; do not commit it to this repository.
- Capture a pre-release snapshot of priority URLs: `/th`, `/en`, both language variants of `/about`,
  `/ai-business-system`, `/restaurant`, `/cost-pricing`, and the most relevant learning articles.
- Use the prior 28 days if genuine historical data exists. When it does not, mark the baseline
  **unavailable**, not zero, and use the first complete collection window as the starting point.
  GA4 cannot reconstruct visits from before it was enabled.
- Segment Thai/English, brand/non-brand questions, landing page and source. Brand searches such as
  “BMS คืออะไร” measure recognition; unbranded questions measure discovery. Exclude staff, QA and
  development traffic. Track measurement/consent changes as well as product and marketing releases.
- Review crawl and tagging problems after release, then compare complete 28-day windows. Use a
  second comparable window (roughly days 29–56) and a later review around day 84 to assess persistence.
  These are review checkpoints, not promised indexing or ranking deadlines. Exclude preliminary
  report days and preserve each provider's time-zone and aggregation definitions.

### A reproducible AI-answer panel

Start with a fixed panel of 20 relevant questions, split into branded and non-branded groups and
reported separately for Thai and English. Candidate questions include:

- “ระบบจัดการร้านอาหารที่เชื่อมออร์เดอร์ ครัว และสต็อก มีอะไรบ้าง”
- “คาเฟ่ควรคิดต้นทุนต่อแก้วและจุดคุ้มทุนอย่างไร”
- “ระบบ AI ช่วยเจ้าของร้านตรวจยอดขายและสต็อกได้อย่างไร”
- “BMS ต่างจากแชทบอทอย่างไร”
- “How should a cafe calculate cost per cup and break-even sales?”

For each selected engine, keep the exact question, language, search-enabled mode, region and model
version recorded. Use fresh conversations without prior BMS context or memory. Repeat each question
three times per review and retain the date, answer and cited URLs as private evidence. Do not change
questions because one wording happens to produce a favorable result.

Record separately: (1) BMS mentioned, (2) a `jachoei.com` URL cited, and (3) claims about BMS correct.
Panel citation rate = answers citing a BMS URL / completed answer runs; failed runs are recorded
separately. Also report the number of distinct questions that produced a citation. A panel rate
measures this controlled sample only, not the share of all real AI questions. Provider reports and
actual visitors are needed to determine whether the sample corresponds to real demand.

### Outcome definitions and decisions

For the consented/observed audience, intent rate = AI-source sessions with at least one
`public_cta_click` / observed AI-source sessions. Use session segments and deduplicate repeated
clicks. Register event-scoped `discovery_source` and `cta_action` dimensions in GA4 as described below.
The current source classification is a coarse per-document observation; a full reload, stripped
referrer, missing UTM or consent refusal can break attribution. Do not label all Google visits as
AI traffic or treat absent attribution as evidence of no AI influence.

`line_contact` is a link click, not a LINE conversation; `signup_start` is not a completed account;
`demo_open` is not a sales-qualified lead. To measure actual conversion, plan a separate consented,
server-confirmed attribution design at registration/activation boundaries, or maintain a private
qualified-lead log with voluntarily reported discovery source. Avoid sending tenant/customer IDs
or personal data into this public tracking integration.

- Not indexed: investigate crawl access, canonicalization, internal links and indexing evidence.
- Indexed but little relevant AI visibility: improve answers for real non-brand customer questions,
  original evidence and trusted references; do not keep adding schema as a substitute for substance.
- Citations/impressions grow but visits do not: inspect intent and whether the AI answer satisfies
  the task without a click. Visibility alone is not evidence of acquisition growth.
- Visits grow but CTA intent does not: review landing-page relevance, mobile usability and the next step.
- Intent grows but qualified enquiries or completed registrations do not: investigate contact/signup
  friction and attribution before claiming commercial success.
- Relevant visibility, observed intent and verified business outcomes improve across comparable
  periods: evidence of useful progress. Report raw counts alongside rates; small baselines make
  percentage increases unstable. Set numeric growth targets only after a real baseline exists.

Before/after trends are observational. Record campaigns, seasonality, outages and engine/model
changes. Where possible, compare with similar pages unaffected by the specific content change;
sitewide changes can contaminate that comparison. A staggered rollout in a future iteration can
provide stronger evidence than attributing every increase to this release.

Current official measurement references, checked 2026-10-29:

- [Google Generative AI performance report](https://support.google.com/webmasters/answer/16984139?hl=en)
  reports AI-feature impressions, including AI Overviews and AI Mode. The report may not appear when
  impression volume is too low; do not interpret a missing report as a measured zero.
- [Bing AI Performance](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c)
  reports citations on supported Microsoft/partner surfaces. Citation trends alone do not establish
  which content change caused an increase.

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
