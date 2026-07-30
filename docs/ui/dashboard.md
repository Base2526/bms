# Dashboard & Reports

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [../ai/tools.md](../ai/tools.md) · Data: [../architecture/database.md](../architecture/database.md)

Reports are strictly **read-only** — they never modify business data, and they always read from
live transactional tables (no separate reporting/analytics store). Implemented in
[`lib/bms/dashboard.ts`](../../apps/web/lib/bms/dashboard.ts) +
[`lib/bms/reports.ts`](../../apps/web/lib/bms/reports.ts), REST `/api/bms/reports/*`, GraphQL
`bmsSalesSummary` / `bmsInventorySummary` / `bmsTopSellingProducts`, admin UI `/admin/reports` +
`/admin/dashboard`. Every report requires permission `report.view`.

## Dashboard (`getDashboard()`)

Today's overview in one call: revenue, low-stock alerts, order counts by status, top
products/customers, and a 7-day sales trend. This is the landing page after login
(`/admin` redirects here).

The dashboard also includes an **AI health** card for the last 7 days, backed by
`bmsAiFailureSummary`: total tool calls, error/denied calls, force-handoff count, and the tools
that fail most often. This reuses `bms_audit_log` (`ai.tool_call`) and `bms_conversation_notes`
instead of introducing a separate AI-failure table.

The card links to `/admin/ai-quality`, which adds turn-level success/handoff/unresolved trends,
automatic failure cases, a roughly 5% normal-conversation QA sample, redacted context, and human
`PASS`/`FAIL`/`UNCLEAR` review. Access uses `ai_quality.view` and `ai_quality.review`; definitions
and privacy constraints are documented in [AI quality control](../ai/quality.md).

## Sales Summary (`getSalesSummary(from, to)`)

Defaults to the last 30 days. Revenue only counts orders `PAID` or later (not `PENDING`).

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
