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

## Extending

New report queries should follow the same shape (a `lib/bms/reports.ts` function, a `report.view`
gated GraphQL query, no writes). See [../architecture/api.md](../architecture/api.md) for the
resolver pattern shared across every BMS module.
