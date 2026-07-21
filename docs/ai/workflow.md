# AI Pipeline (AI-BMS)

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [tools.md](tools.md) · Prompts/guardrails: [prompts.md](prompts.md) · Business rules: [../business/](../business/)

Every channel flows into the same pipeline (channel-agnostic).
Implemented: [`apps/web/lib/bms/pipeline.ts`](../../apps/web/lib/bms/pipeline.ts)

Since the **AI tool-calling** work (2026-07) there are now **two AI surfaces**, both driven by the same
Claude tool-use runtime ([`lib/bms/tools/runtime.ts`](../../apps/web/lib/bms/tools/runtime.ts)) over a
shared tool catalog ([`lib/bms/tools/catalog.ts`](../../apps/web/lib/bms/tools/catalog.ts)):

- **Customer surface** — the webhook/playground pipeline below. Claude may call only customer-safe
  tools (`customerTools()`): read product/stock/own-order-status + `create_order`/`submit_payment`/
  `reorder`. No sensitive (A3) tool is ever exposed here.
- **Staff surface** — `bmsAssistant` mutation ([`graphql/bmsAssistant.ts`](../../apps/web/graphql/bmsAssistant.ts),
  UI `/admin/assistant`). Claude gets `staffTools(perms)` filtered by the admin's RBAC. Read + A2
  writes execute (with audit); **A3 sensitive tools are propose-only** — they return a proposal that
  a human confirms in the UI, which then fires the existing permission-gated mutation
  (`bmsRefundPayment`, `bmsAdjustStock`, …). AI never executes an A3 action itself.

```
Customer
    │
    ▼
Receive Message        ← per-tenant webhook (LINE / TikTok / Facebook / Instagram / Web / Shopee / Lazada)
    │
    ▼
AI tool-calling?       ← runToolLoop(customerTools())  [lib/bms/tools/runtime.ts]  (PRIMARY when AI creds exist)
    │                     Claude selects+calls tools itself (search_products / check_stock /
    │                     get_order_status / create_order / submit_payment / reorder), grounded on
    │                     real backend results; every business number traces to a tool result.
    │                     usedAi:true (even on mid-loop error) → return AI reply, never fall through
    │                     (write-safety: no double create_order).
    │
    ├─ usedAi:false (no key / quota exceeded) ──▶ deterministic rule-based fallback:
    │        Detect Intent (understand() [nlu.ts]) → checkStock()/createOrder() → generateResponse()
    │        → Thai-language template. This is the customer-critical deterministic path.
    ▼
Reply Customer         ← sent back on-channel + logged to Inbox (logConversation)
```

Credential resolution (both surfaces) is `resolveAiCredentials(tenantId)` [lib/bms/ai.ts]: BYOK key →
shared `ANTHROPIC_API_KEY` (consuming one `tryConsumeAiQuota()` unit per incoming customer message or
staff-assistant turn) → null. It is called once before the loop, so 1–5 Claude round-trips still count
as one quota unit. BYOK calls do not consume the platform quota.

Before each execution, `runtime.ts` independently re-checks the tool surface and staff permission
with `requirePermission()` even though the catalog was already filtered. It also rejects unknown
input fields and records a redacted `ai.tool_call` audit row for every success, failure, denial, and
proposal. A2 writes additionally retain their domain audit row; a confirmed A3 action is audited by
the existing GraphQL mutation that the human explicitly clicked.

## Intents (`nlu.ts`)

| Intent | Example message | Tool | Result |
| --- | --- | --- | --- |
| `CHECK_STOCK` | "Nike XL มีไหม" | `checkStock()` | Check stock/price and answer |
| `CONFIRM_ORDER` | "สั่ง Nike XL 2 ชิ้น" | `createOrder()` | Create order + reserve stock (atomic) — asks back if info is incomplete |
| `GREETING` | "สวัสดี" | — | Greet + invite the customer to name a product/size |
| other | — | — | Fall back to `generateResponse()` |

`CONFIRM_ORDER` supports multiple line items per message, e.g. "สั่ง Nike XL 1 ชิ้น กับ Adidas M 1
ชิ้น". If any item is incomplete (missing size/qty, or product not found) the whole message is
rejected with a follow-up question — no partial order is created.

## Channels → pipeline

Per-channel webhook/verification/reply details now live in [../integrations/](../integrations/).
Every channel except `test` calls `logConversation()`, so incoming messages + the AI's reply are
automatically recorded in the Omnichannel Inbox.

For LINE OA, webhook handling also best-effort syncs the user's LINE display profile after the
Inbox write/reply path. This profile cache is UI metadata only; it is not available to the AI as an
authoritative customer fact unless a backend tool explicitly returns it.

## AI free-tier quota + BYOK (2026-07)

Every tenant can generate AI replies without any setup — the shared platform `ANTHROPIC_API_KEY`
serves them by default, rate-limited per month by plan (`bms_plans.max_ai_messages_month`: free=400,
pro=4000, business=unlimited). A shop that wants no limit (or a different model) sets its own
Anthropic API key in `/admin/settings` — once set, that shop's replies always use its own key and
are never counted against the shared quota.

- **Schema** (migration [`6.8__bms_ai_config.sql`](../../db/migrations/6.8__bms_ai_config.sql)):
  `bms_tenant_ai_config` (tenant_id PK, `api_key_encrypted` — same AES-256-GCM scheme as
  `bms_tenant_channels.channel_secret`, see [`lib/bms/crypto.ts`](../../apps/web/lib/bms/crypto.ts) —
  plus an optional `model` override) and `bms_ai_usage_monthly` (tenant_id + `year_month` composite
  key, `count`). **No cron/reset job** — a new calendar month is simply a new `year_month` row
  starting at 0, so usage resets itself.
- **Service** — [`lib/bms/aiConfig.ts`](../../apps/web/lib/bms/aiConfig.ts) (get/set/remove the
  tenant's own key, `testAiKey()`/`testTenantAiKey()`/`testPlatformAiKey()` via the free
  `GET /v1/models/{id}` endpoint — no inference cost) and
  [`lib/bms/aiUsage.ts`](../../apps/web/lib/bms/aiUsage.ts) (`getAiUsage()`,
  `tryConsumeAiQuota()` — a single atomic `UPDATE ... WHERE count < limit` so concurrent requests
  can't blow past the quota).
- **`generateResponse()`** ([`lib/bms/ai.ts`](../../apps/web/lib/bms/ai.ts)) now takes `tenantId` and
  tries, in order: tenant's own key (no quota) → shared key (quota-gated) → template. A shop that
  runs out of shared-key quota is never blocked — it just gets the plain template until next month
  or until it adds its own key.
- **GraphQL** — `bmsAiConfig`/`bmsAiUsage` (query) and `bmsSetAiKey`/`bmsRemoveAiKey`/`bmsTestAiKey`
  (tenant, `graphql/bmsAiConfig.ts`) gated by the same `requireTenantAdmin()` as `bmsChannels`/
  `bmsUpsertChannel` — **no new permission was seeded**, same reasoning as Channel Health (this is
  connection/config-domain, not an operational `BMS_PERMISSIONS` action). `bmsTestPlatformAiKey`
  (platform admin only, `requirePlatformAdmin()`) tests the shared env-level key.
- **UI** — AI card in `/admin/settings` (BYOK key + optional model + test/remove, usage banner when
  on the shared key); Dashboard alert when shared-key usage is near/over quota
  (`/admin/dashboard`); "ทดสอบ Shared AI Key" button in the platform-only `/admin/env` page;
  a sidebar indicator (`components/AdminSidebar.tsx`, polled every 60s — coarser than the 15s
  Inbox/Channel-Health polls since quota moves monthly, not by the second) pinned above the
  manual/profile block, echoing the always-visible balance strip pattern from the Claude Console
  sidebar: a `RobotOutlined` icon with a status dot (blue = has usage, amber = ≤20% of quota left,
  red = exhausted) linking to `/admin/settings`, hidden entirely once the shop has BYOK or an
  unlimited plan.

## Hard rules (see [../business/](../business/) and [prompts.md](prompts.md))

- AI **never touches the DB directly and never writes SQL** — only calls approved services.
- AI **never guesses or fabricates stock/price numbers** — facts always come from the backend; AI
  only composes the wording.
- Sensitive actions (confirming payment, refunds, cancellations, stock adjustments) require a
  **human confirmation + RBAC permission** — e.g. `verifyPaymentSlip()` is advisory only, a human
  must still click Confirm.

## AI Workflow #2 — Daily Log Triage (ops, not customer-facing)

A separate AI workflow that maintains the system itself (daily GitHub Actions run).
Implemented: [`.github/workflows/daily-log-triage.yml`](../../.github/workflows/daily-log-triage.yml) +
[`scripts/bms-log-triage/`](../../scripts/bms-log-triage/)

```
Cron (daily)
    │
    ▼
Collect + Redact       ← pull last 24h of errors from system_logs · redact email/phone/token/PII
    │
    ▼
Claude Analyze/Patch   ← find root cause in apps/web → make a minimal, confident fix → npx tsc
    │
    ▼
Open Draft PR          ← base main · a human reviews/merges (never auto-merged)
    │
    ▼
Notify LINE            ← push the PR link (Messaging API; LINE Notify is discontinued)
```

Same principle as the customer pipeline: **AI proposes, it never decides** — a human always
confirms before anything reaches production.

## Testing the pipeline

- **Playground** (`/api/bms/chat`, channel=`test`) — requires a signed admin session, derives the
  tenant from that session/drill-down context, and returns the full trace (intent/tool/reply)
  without logging to inbox.
- **Realtime Diagnostics** (`/admin/inbox/realtime-diagnostics`) — Administrator/platform-admin
  only. `Emit` tests PubSub/WebSocket delivery without DB writes; `Create Msg` creates a diagnostic
  Inbox message for the current tenant without calling the AI pipeline or sending to any external
  channel.
- **Fake Data Seeder** (`/admin/dev/fake`) — bulk-generates products/customers/orders/conversations/
  purchase orders to populate Dashboard/Reports/Inbox/Payment/Shipping/Purchase (marker `FAKE-`,
  cleanable; off in production by default, enabled on demo machines via `BMS_ALLOW_FAKE_SEED=1`).
  Seeds into **the logged-in user's own tenant** — a platform admin must drill down into a shop
  (`bmsEnterTenant`) first to see that shop's pipeline/data.

Every tool in the pipeline runs through a service scoped by `getTenantId(ctx)` — webhook context
comes from `{tenantId}` in the URL; admin context comes from the session (or whichever shop a
platform admin is currently drilled into).
