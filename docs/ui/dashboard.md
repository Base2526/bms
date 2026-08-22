# Dashboard & Reports

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [../ai/tools.md](../ai/tools.md) · Data: [../architecture/database.md](../architecture/database.md)

Reports are strictly **read-only** — they never modify business data, and they always read from
live transactional tables (no separate reporting/analytics store). Implemented in
[`lib/bms/dashboard.ts`](../../apps/web/lib/bms/dashboard.ts) +
[`lib/bms/reports.ts`](../../apps/web/lib/bms/reports.ts) plus generated-export service
[`lib/bms/reportEngine.ts`](../../apps/web/lib/bms/reportEngine.ts), REST `/api/bms/reports/*`,
GraphQL `bmsSalesSummary` / `bmsInventorySummary` / `bmsTopSellingProducts` /
`bmsGenerateReport` / `bmsGeneratedReports`, admin UI `/admin/reports` + `/admin/dashboard`.
Every report requires permission `report.view`.

Shipping note since `7.47__bms_shipping_fee_zone_weight.sql`: `bms_orders.total_amount` still means
"ค่าสินค้า - ส่วนลด" only. Any operator-facing surface that needs the amount a customer should pay must use
`shipping_fee` / `amount_due` (or an equivalent computed total), not reinterpret `total_amount`.

## Dashboard (`getDashboard()`)

Today's overview in one call: revenue, low-stock alerts, order counts by status, top
products/customers, and a 7-day sales trend. This is the landing page after login
(`/admin` redirects here).

The dashboard also includes an **AI health** card for the last 7 days, backed by
`bmsAiFailureSummary`: total tool calls, error/denied calls, force-handoff count, and the tools
that fail most often. This reuses `bms_audit_log` (`ai.tool_call`) and `bms_conversation_notes`
instead of introducing a separate AI-failure table.

As of 2026-08-22, `/admin/dashboard` carries the complete **Q1 + Q2 Phase 1** operator workflow:

- **Q1 / action center** materializes daily POS, stock, margin, retention, sales and operational
  signals with priority, evidence, expected impact, confidence, owner, due date and deep link.
  Staff can accept, complete or dismiss with a reason; transitions and audit evidence persist in
  `bms_actions`/`bms_action_events`. The dashboard reports acceptance, completion, time-to-action and
  measured-outcome coverage. Users with `action.manage` automatically refresh today's signals when
  the dashboard opens; manual refresh remains available. Signal-cleared actions expire with both an
  append-only event and an `action.expired` audit row. Migration `9.13` keeps Thai and English action
  copy together so the per-user language preference does not leak the other language.
- **Q2 / inventory cashflow** is now wired as a read-only block on the same page:
  `bmsInventoryActionCenter(windowDays, coverageDays, limit)` aggregates `listLowStock()`,
  `predictStockOut()`, and `suggestPurchaseOrder()` into one summary with:
  low-stock count, out-of-stock count, variants predicted to stock out within 7 days, suggested
  purchase lines, and total suggested units. Recommendations account for demand trend, configured
  safety-stock days, supplier lead time, open PO quantities, manually recorded lost sales and active
  customer restock subscriptions.
- The inventory block also classifies slow/dead stock with markdown/bundle/transfer/discontinue
  actions and reads FEFO lots for expiry-aware actions. Low-stock rows can record a lost sale, which
  feeds the next recommendation through `bms_inventory_demand_events`.
- Two inventory signals are promoted into the top triage list as actionable rows:
  variants likely to stock out within 7 days and purchase suggestions ready for review.

This stays within the repo's reporting contract: **read-only**, live transactional reads, no
separate analytics store, and no automatic purchasing action. The heuristic output remains advisory;
staff review is still required before any purchasing decision.

The card links to `/admin/ai-quality`, which adds turn-level success/handoff/unresolved trends,
automatic failure cases, a roughly 5% normal-conversation QA sample, redacted context, and human
`PASS`/`FAIL`/`UNCLEAR` review. Access uses `ai_quality.view` and `ai_quality.review`; definitions
and privacy constraints are documented in [AI quality control](../ai/quality.md).

## Live Dashboard (`/live-dashboard`) — phase 1 wired to real business data

A **public-route** monitoring screen for watching sales during a live-selling session without going
through the admin shell. It lives at `apps/web/app/(main)/live-dashboard/page.tsx` (next to
`/checkout` and `/shop/...`, **not** under `/admin/*`), so it renders with the public header/footer
instead of `AdminSidebar`/`AdminLayoutClient`. The intended use case is putting it on a TV or second
monitor in the shop while a live stream runs.

**Current status after the phase-1 pass:** this page now reads real business data for the parts BMS
already owns, and keeps the truly missing pieces clearly pending instead of faking them. The route
still reuses the public shell, but it now queries the same tenant-scoped GraphQL reads that power
the admin dashboard/reports instead of rendering a full mock screen.

All day-based figures use `Asia/Bangkok` boundaries in the reporting services, independent of the
PostgreSQL server timezone. An open dashboard also rolls its query range forward automatically when
the Bangkok calendar day changes, so a TV does not remain pinned to yesterday until reload.

- **Access**: reuses the existing session cookie. A signed-in admin with `report.view` sees the
  dashboard; signed-in without the permission sees a 403 result; signed out sees a login prompt
  linking to `/admin/login?next=/live-dashboard`. No new permission was added.
- **`?demo=1`**: no longer renders a fake dashboard preview. Once real queries were wired in, the
  unlocked demo route was no longer acceptable because an empty/non-querying preview would look too
  close to a real store screen. It now shows an explicit informational result directing the user to
  log in for live data.
- **Fullscreen**: `element.requestFullscreen()` on the page shell, with layout/typography scaled up
  through the CSS `:fullscreen` pseudo-class (not a React state class) so the styling can never
  disagree with the browser's actual state. A `fullscreenchange` listener is the single source of
  truth for the button label, because the user can leave fullscreen with Esc without touching it.
- **Display mode selector**: the URL-backed `mode` switch lets the viewer choose `Auto`, `TV`,
  `Desk`, or `Compact`. `Auto` follows responsive breakpoints, `TV` enlarges high-priority figures
  and hides the operations/pending row, `Desk` keeps all sections with denser spacing, and `Compact`
  keeps KPI, urgent work, recent orders, and channel mix. The selected non-auto mode is shareable as
  `?mode=tv|desk|compact`; choosing Auto removes the parameter.
- **Connected in phase 1**:

  | Block | Will read from |
  | --- | --- |
  | KPI + "เทียบเมื่อวาน" deltas | today's `bmsSalesSummary` + current/previous `byDay` ranges; `bmsDashboard` is a partial fallback |
  | งานค้าง tiles | `bmsOperationalAlerts` |
  | ออเดอร์ที่เพิ่งเข้า feed | `bmsOrders(limit)` ordered by `created_at DESC`; requires `order.view`, otherwise the panel explains why detail is hidden |
  | สัดส่วนตามช่องทาง donut | `bmsSalesSummary(from: today, to: today).byChannel` |
  | Sidebar channel rows | `bmsSalesSummary(...).byChannel` + `bmsChannelHealth` |
  | ยอดขาย trend chart | two `bmsSalesSummary(...).byDay` aliases for the latest 7 days and the preceding 7 days |
  | สินค้าขายดีวันนี้ | `bmsTopSellingProducts(from: today, to: today)` |
  | ออเดอร์วันนี้ตามสถานะ | `bmsSalesSummary(from: today, to: today).byStatus` |
  | สินค้าใกล้หมด (detail) | `bmsLowStock` when the viewer also has `product.view`; otherwise fallback to `bmsDashboard.lowStockCount` |

- **Still intentionally pending**:

  | Block | Why it is still pending |
  | --- | --- |
  | Intraday/hourly live sales curve | `salesDaily[]` is only daily; a true during-stream chart needs a new finer-grained query |
  | Viewers / comments / conversion | BMS has no owned source for these; requires per-platform Live API integration |

- **Live-stream metrics are a different category.** ผู้ชมสด / Conversion / คอมเมนต์ are not
  "unwired" — BMS has no data for them at all, and getting it requires per-platform Live API
  integration (Facebook Live, TikTok Live, Shopee/Lazada Live) that does not exist. They are
  deliberately placed last, on a dashed-border card, and must keep their "ตัวอย่าง" tag until a real
  integration lands. Conversion in particular cannot be computed before viewer counts are real.

## Sales Summary (`getSalesSummary(from, to)`)

Defaults to the last 30 Bangkok calendar days. Every explicit `from`/`to` range is converted to
`Asia/Bangkok` timestamp boundaries before filtering, regardless of the PostgreSQL server timezone.
Revenue only counts orders `PAID` or later (not `PENDING`). Profit and POS-return report ranges use
the same boundary convention.

```
{
  from, to,
  revenue, orderCount, avgOrderValue,
  byDay[]     { day, revenue, orders },
  byStatus[]  { status, count },
  byChannel[] { channel, revenue, orders }
}
```

`byChannel` reflects whatever channels have real order data — Shopee/Lazada rows will appear here
automatically once real orders start flowing through those channels (no report-side change needed
when a new channel is added, since channel is just a grouping column).

## Inventory Summary (`getInventorySummary()`)

```
{
  skuCount, variantCount,
  totalUnits, reservedUnits, availableUnits,
  stockValue,             // Σ current_stock × price
  lowStockCount, outOfStockCount
}
```

## Top Selling Products (`getTopSellingProducts(from, to, limit=10)`)

Returns `[{ sku, name, qty, revenue }]` for the given date range.

## On-demand generated reports (XLSX / CSV / PDF)

`/admin/reports` now includes an **AI Report Generator** card for staff with `report.view`. It
creates real downloadable files from the same live read paths the dashboard already uses, instead of
introducing a separate reporting store:

- **Report types**: `SALES`, `INVENTORY`, `PROFIT`.
- **Formats**: `XLSX`, `CSV`, `PDF`.
- **History**: every export writes an append-only `bms_generated_reports` row and appears in the
  same page's "recent exports" table for re-download.
- **Shared service**: GraphQL `bmsGenerateReport` / `bmsGeneratedReports`, REST
  `POST /api/bms/reports/generate`, and the staff AI tool `generate_report` all call
  `lib/bms/reportEngine.ts` so the export semantics are identical no matter how staff request it.
- **Download path**: exports are served from tenant-gated `GET /api/bms/reports/download/[id]`, not
  `/api/files/[id]`, because they may contain sensitive revenue/profit/customer information.

Current per-report behavior:

- **Sales**: summary + by-day + top-products + by-channel + **by-status** (order count per status,
  added 2026-08 — was queried by `getSalesSummary()` but never reached any output format until then),
  with the selected date range.
- **Inventory**: current stock snapshot + low/out-of-stock rows, including each row's **reorder
  point** (added 2026-08 — `listLowStock()` already selected it, it just wasn't in the output column
  list); ignores the date-range picker.
- **Profit**: estimated gross profit only. Revenue comes from historical order-item snapshots, but
  cost comes from the product's **current** `cost_price`, so this export must continue to present
  itself as an estimate rather than an accounting-perfect historical profit statement.

Every report type is defined once as a `ReportDoc` (title/subtitle/meta + one or more named sheets)
in `lib/bms/documentGenerator.ts`'s `build*ReportDoc()` functions, then rendered by format-specific
builders (`buildXlsx`/`buildCsv`/`buildPdf`) that all read the same sheets — so XLSX/CSV/PDF cannot
drift in which rows/columns they contain, only in layout. They *did* drift once: `buildCsv()` used to
only emit `doc.sheets[0]`, so a Sales CSV export silently omitted "Top products", "By channel", and
"By status" while XLSX/PDF already included them — fixed by making `buildCsv()` iterate every sheet
(each sheet gets a `# <sheet name>` marker line). A query field only appears in the file once it is
also listed in the corresponding sheet's `columns`/`rows` in `documentGenerator.ts` — the two are
separate steps, and forgetting the second one is exactly how the by-status/reorder-point fields above
went missing for a while.

Known output limitation:

- **PDF Thai text**: current PDF generation uses `pdfkit`'s built-in fonts, which do not render Thai
  glyphs correctly. The generator therefore keeps its own headings/labels in English for now. Thai
  data values in PDF remain a known limitation until a Thai-capable TTF is embedded. XLSX/CSV use
  UTF-8 and handle Thai correctly today.

## Sales digest subscriptions (email/Slack/LINE)

A shop can subscribe to have the same numbers pushed to them automatically instead of only viewing
the dashboard on demand. Implemented in [`lib/bms/reportDigest.ts`](../../apps/web/lib/bms/reportDigest.ts),
GraphQL `graphql/bmsReportSchedule.ts`, migration `7.37__bms_report_subscriptions.sql`, admin UI
card `ReportSubscriptionCard.tsx` on `/admin/settings`, and a platform-admin-only cross-tenant view
at `/admin/report-schedule`.

- **Frequency**: `DAILY`/`WEEKLY`/`MONTHLY`, plus a send hour (and a weekday for weekly / a
  day-of-month for monthly). All period math is Asia/Bangkok, computed as direct UTC+7 arithmetic
  (no DST, no timezone library) — consistent with the rest of the codebase's
  `Intl.DateTimeFormat`-based date handling.
- **Content**: revenue, order count, discount total, top products, and a breakdown by channel —
  the same shape as `computeSalesSummary()` reads directly from `bms_orders`/`bms_order_items`
  (`PAID` or later, same convention as [Sales Summary](#sales-summary-getsalessummaryfrom-to)
  above), for the just-completed period only (yesterday / last 7 days / last calendar month).
- **Channels**: one row per channel in the subscription — email (via the existing `sendEmail()`
  mailer), Slack (posted to a shop-supplied incoming webhook URL, encrypted at rest like
  `channel_secret`), and LINE (pushed to an admin-supplied LINE user id using the shop's own LINE
  OA `access_token` — there is no separate LINE-to-owner integration; the shop's existing bot just
  also pushes to this one id).
- **Idempotency**: `runScheduledDigests()` — the cron entrypoint behind `POST
  /api/bms/reports/send-digest` — scans every enabled subscription, checks `shouldSendNow()`
  (hour/weekday/day-of-month match), and skips any tenant whose `last_period_key` already matches
  the current period. This means the cron can be invoked at any frequency (hourly, or more often)
  without ever double-sending; it does not need to run exactly once per period.
- **Testing**: `bmsSendTestReportNow` (`sendTestDigest()`) sends immediately using the last 24
  hours as an ad-hoc period, logs to `bms_report_deliveries` like a real send, but never touches
  the subscription's `last_sent_at`/`last_period_key` — so testing the configuration can't cause a
  real scheduled send to be skipped or duplicated.
- **Delivery history**: every send attempt — one row per channel, success or failure with the
  error message — is logged to append-only `bms_report_deliveries`, visible per-tenant on the
  settings card and cross-tenant (with a per-tenant drawer) on `/admin/report-schedule`.
- **Access**: the shop-facing config (`bmsReportSubscription`/`bmsUpsertReportSubscription`) uses
  the same `requireTenantAdmin()` config-domain gate as `bmsChannels`/`bmsStoreProfile` — no new
  `report.view`/`report.manage` permission was added. The cross-tenant view gates with
  `requirePlatformAdmin()`.
- **Not yet done**: the cron endpoint is not on an actual schedule (same state as
  `channels/check-health` and `ai/check-health` — see [../architecture/api.md](../architecture/api.md)).

## Extending

New report queries should follow the same shape (a `lib/bms/reports.ts` function, a `report.view`
gated GraphQL query, no writes). See [../architecture/api.md](../architecture/api.md) for the
resolver pattern shared across every BMS module.
