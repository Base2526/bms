# Public learning center

The public entry point is `/learn`, linked from the public header (including the mobile menu),
footer and existing `/admin/manual`. `/learn/board-game` and `/learn/restaurant` provide ordered
learning paths. Shared articles have a single canonical `/learn/guides/[slug]` URL; `?track=` only
preserves previous/next navigation. Unknown tracks/articles render a not-found page.

## Content and maintenance

`apps/web/lib/learning/catalog.ts` is an explicitly authored, bilingual public catalogue: 44 unique
articles, reused in the 40-lesson board-game path and 20-lesson restaurant path. Every article has
audience, menu, prerequisites, steps, success check and relevant limitations. It does not expose
internal documentation, assistant tool metadata, permissions catalogues or tenant data. Content is
reviewed against board-game-cafe.md, the restaurant manuals, pos.md, the in-app manual, desktop
README and implemented routes. Update both languages and the reviewed date when behavior changes.
Do not publish a capability just because it was in a proposed manual outline.

The 2026-10-28 board-game review added 16 detailed lessons and corrected existing guidance against
the services and actual Admin/POS forms. See [the evidence matrix](board-game-manual-review.md)
for sources, discovered limitations and coverage. Keep the summary in `/admin/manual` and
`board-game-cafe-setup-guide.md` consistent with the public path.

Explicit limitations include no production-verified e-Tax provider; Desktop manual download/update;
hardware printing verification; no board-game/restaurant emergency offline; no generic POS credit
issue/redeem controls; no-deposit chat booking; product-only coupon base; and authorized, scoped AI
reads. Reading progress does not certify shop readiness. Full customer-data migration, holiday
management and maintenance workflows are not advertised as universal one-click capabilities.

The public page uses server-rendered content and GET search with bounded input, business and role
filters. Search reads only this authored catalogue. There is no public LLM endpoint or hidden
tenant query. Existing staff AI is described and linked through authorized workspaces, not copied
into an anonymous assistant. Public guidance can be read without JavaScript or authentication.

Reading completion is local to the browser (`bms.learning.read.v1`), contains only article slugs,
and is optional. Storage failures are explained. Print, copy-link, on-page contents, previous/next,
related articles and support links work without analytics or a feedback database. No fake helpfulness
votes or review counts are displayed. Task CTA destinations still enforce their own RBAC; navigation
does not grant permission. Existing admin sessions see dashboard/workspace CTAs instead of signup.

Track contents use a compact heading with the start action beside it on wide screens, two-column
lesson lists where space allows, and single-column rows on phones. Full titles and descriptions
remain visible. The duplicate sidebar is hidden on smaller screens; guide switching remains in
the header. The optional reading checklist is in a native expandable section so it does not
repeat the entire contents list by default.

The learning-center home uses the same compact spacing: a short heading area, one desktop row
for search/business/role controls, smaller business cards and denser lesson cards. Narrow screens
stack the search field and submit action around two labelled filters and omit the duplicate sidebar.
Full summaries and native GET search remain available; no lesson text is truncated.

Article pages keep body text at 16px on desktop and phones with 1.8 line spacing. Smaller titles,
inline audience/review metadata, tighter section/step spacing and compact callouts reduce scrolling
without hiding lesson content. Desktop keeps the sticky section sidebar; phones and tablets use
a native collapsed section menu after the introduction, operable without JavaScript. Previous/next,
reading progress, print, copy-link and related lessons remain available with compact controls.

At widths up to 850px the shared header is one 61px row with the brand and a 44px menu control.
The native disclosure opens an overlaid navigation panel containing guide links, language and the
session-aware shop action. It supports keyboard activation, Escape with focus return, outside-click
dismissal and closes after navigation or switching to desktop. Guide links also work without JS.
Desktop keeps the expanded navigation; the menu does not push article content down when opened.

`/learn` skips SessionLayer (not the auth-route gate) so the article HTML remains server-rendered and
does not initialize global chat/realtime. A small session-aware CTA reads `/api/auth/me` only.
The pages use normal global theme variables, scoped CSS and language-prefixed public URLs. Requests
to `/th/learn/**` and `/en/learn/**` are rewritten to the shared page implementation while the
middleware pins the request language, so the server-rendered `<html lang>`, copy and metadata agree.
Legacy unprefixed public URLs use a temporary 307 redirect to the current cookie language (Thai by
default), with private/no-store caching so a user's language choice is not cached permanently.
Every page has a self-canonical plus reciprocal `th-TH`, `en-US` and `x-default` alternates.
`/sitemap.xml` is the primary site sitemap; `/learn/sitemap.xml` remains as the localized
learning-only compatibility sitemap. Existing help pages stay available.

Design references: [Shopify initial setup](https://help.shopify.com/en/manual/intro-to-shopify)
and [setup-guide composition](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/setup-guide):
searchable guidance, step-by-step paths and a printable checklist, adapted to actual BMS workflows.

## Narrated workflow overviews

The retail, board-game, restaurant, pharmacy and specialist inventory paths include bilingual
workflow diagrams with separate customer and owner AI examples. Owner narration covers operational
analysis and reports, with data completeness and human confirmation boundaries. Board-game analytics
exports are XLSX; the general report examples show XLSX/CSV/PDF. Pharmacy clinical decisions remain
with a licensed pharmacist.

Thai narration ships as 64 recorded MP3 cues using the same pinned `thai_som` voice as the Restaurant
guide; English uses browser speech synthesis when available. The active diagram node follows each
cue's completion. Previous/next, restart and speed changes stop the current cue. Playing the final
cue replays that cue rather than resetting the guide. Generation instructions are in `scripts/README.md`.

The shared full-screen viewer is a native modal dialog with keyboard focus containment, Escape and
focus return, scrollable narration, zoom/pan and optional cue following. Background page scrolling
is suspended during narration in the dialog. Phones retain a scrollable transcript below the diagram.
These public examples do not query shop data or execute AI tools.

## Verification commands

- `cd apps/web && npm run typecheck`
- `node scripts/run-contract-tests.mjs pure learning-center`
- `node scripts/run-contract-tests.mjs pure i18n-keys`
- `BMS_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/learning-center-browser-smoke.mjs`
- `cd apps/web && npm run build`

The browser smoke uses read-only routes and isolated auth fixtures. It checks Thai/light and
English/dark at 1440, 390 and 320px; search/no-match; progress persistence; print; article language
switching; signed-in CTAs; no public business API calls; JavaScript-disabled SSR; canonical links;
sitemap and missing articles. Screenshots go to a fresh OS temporary directory.
It also follows every board-game contents link in both languages and checks rendered steps and
mobile overflow, including the longer deposit and rehearsal lessons.
