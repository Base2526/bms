# AI Pipeline (AI-BMS)

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [tools.md](tools.md) · Prompts/guardrails: [prompts.md](prompts.md) · Business rules: [../business/](../business/)

Every channel flows into the same pipeline (channel-agnostic).
Implemented: [`apps/web/lib/bms/pipeline.ts`](../../apps/web/lib/bms/pipeline.ts)

Since the **AI tool-calling** work (2026-07) there are now **two AI surfaces**, both driven by the same
Anthropic-compatible tool-use runtime ([`lib/bms/tools/runtime.ts`](../../apps/web/lib/bms/tools/runtime.ts))
over a shared tool catalog ([`lib/bms/tools/catalog.ts`](../../apps/web/lib/bms/tools/catalog.ts)):

- **Customer surface** — the webhook/playground pipeline below. The active provider may call only customer-safe
  tools (`customerTools()`): read product/stock/own-order-status + `create_order`/`submit_payment`/
  `reorder`. No sensitive (A3) tool is ever exposed here.
- **Staff surface** — `bmsAssistant` mutation ([`graphql/bmsAssistant.ts`](../../apps/web/graphql/bmsAssistant.ts),
  UI `/admin/assistant`). The active provider gets `staffTools(perms)` filtered by the admin's RBAC. Read + A2
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
Deterministic intent?  ← coupon wallet / own-order status / payment / reorder / confirmed order slots
    │                     Server selects an approved catalog tool, then runtime applies the same
    │                     surface authorization, argument validation, redacted audit, and domain audit.
    │                     Customer never supplies tenant authority; status/payment/reorder resolve the
    │                     latest order from the established (channel, customer_ref) identity.
    │
    ├─ no ─────────────▶ continue to AI tool-calling
    ▼
AI tool-calling?       ← runToolLoop(customerTools())  [lib/bms/tools/runtime.ts]  (PRIMARY when AI creds exist)
    │                     The configured provider selects+calls tools itself (search_products / browse_catalog /
    │                     list_new_arrivals / find_alternatives / check_stock / get_order_status /
    │                     create_order / submit_payment / reorder), grounded on
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

Credential resolution (both surfaces) is `resolveAiCredentials(tenantId)` [lib/bms/ai.ts]: tenant
BYOK (Anthropic or DeepSeek) → shared provider selected by routing policy → null. General customer sales/text
work uses `BMS_AI_PROVIDER` (default DeepSeek), while sensitive/baseline staff-assistant turns use
`BMS_AI_SENSITIVE_PROVIDER` (default Anthropic). A staff turn is sensitive for provider routing only
when the latest request matches a sensitive action exposed to that user; merely having sensitive
tools in the catalog no longer routes every read-only staff question to Anthropic. The resolver only falls back to the alternate
shared provider when the preferred provider is not configured; once a provider call starts, mid-loop
errors do not retry a different provider, which prevents duplicate writes. Shared calls consume one
`tryConsumeAiQuota()` unit per incoming customer message or staff-assistant turn. It is called once
before the loop, so 1–5 provider round-trips still count as one quota unit. BYOK calls do not consume
the platform quota.

Before each execution, `runtime.ts` independently re-checks the tool surface and staff permission
with `requirePermission()` even though the catalog was already filtered. It also rejects unknown
input fields and records a redacted `ai.tool_call` audit row for every success, failure, denial, and
proposal. A2 writes additionally retain their domain audit row; a confirmed A3 action is audited by
the existing GraphQL mutation that the human explicitly clicked.

The provider request caches the stable tool prefix and system prompt with explicit ephemeral cache
breakpoints. Tool-only caching remains valid when per-conversation slot memory changes the system
prompt, reducing repeated input cost without changing the authorization or execution boundary.

`runApprovedTool()` is the same execution boundary without provider inference. The customer
pipeline uses it only for narrow intents whose target is unambiguous. Recent customer turns are also
reduced to non-authoritative order slots (product text, size, quantity, confirmation); product and
stock facts still have to come from tools. Colloquial quantity/size corrections update the
corresponding slot without overwriting the product, while an explicit draft cancellation clears the
stored slots and prevents turns before that cancellation from rebuilding them. A successful customer tool call or a relevant
single-field clarification resets the turn budget, so legitimate browsing/slot filling is not
mistaken for a stalled conversation.

Every customer reply — AI, deterministic-route, or rule-based fallback — leaves the pipeline through
one sanitizer (`customerSafe()`): full UUIDs are shortened to their first eight characters, and the
shop brand voice is normalized (`ครับ` → `ค่ะ`, a standalone `ผม` → `ทางร้าน`) so a model or template
slip cannot change the shop persona mid-conversation. This is the shop's own voice and is unrelated
to the per-admin `ครับ/ค่ะ` particle used by Inbox suggested replies.

Customer product discovery is sales-first and retrieval-first. Broad product questions read
`browse_catalog` and present real in-stock choices; “what is new?” reads `list_new_arrivals` ordered
by product creation time; exact misses and out-of-stock requests read `find_alternatives`. These
tools query the tenant's active catalog on every call, so a newly inserted product (including one in
a previously unseen category) is available on the next message without retraining or cache
invalidation. A contextual “ดูอย่างอื่น/สินค้าอื่น/รุ่นอื่น” follow-up is routed directly to
`browse_catalog`; products named in the immediately previous assistant reply are removed before
presenting up to three alternatives, so the customer is not asked to repeat a product name or size.
The deterministic no-credential path uses the same product-resolution and sellable
catalog services and also offers verified alternatives instead of ending at “not found”.

Payment guidance is configuration-first. The customer pipeline and `submit_payment` tool use only
non-blank receiving accounts returned by `get_payment_info`. If no channel is configured, the
pipeline does not suggest bank transfer, PromptPay, QR, or an invented alternative; it asks the
customer to wait for an admin's payment details, and no PENDING payment is created.

When a turn fails in a way the customer can feel — a tool throwing, the provider loop erroring or
timing out, or a reply that never reaches the channel — the pipeline and tool runtime also call
`reportBmsFailure()` (`lib/bms/failureAlert.ts`), which records the incident against the conversation
and alerts the shop and/or platform admins. This is separate from the fallback reply itself: the
customer still gets the safe template, but the failure is no longer silent. Alerting is intentionally
*not* driven by the `ai.tool_call` audit outcome, because that outcome also covers ordinary business
results such as "product not found" — see AGENTS.md § Failure incidents.

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

## AI credits + BYOK (2026-07)

Every tenant can generate AI replies without any setup — the shared platform provider serves them
by default (`BMS_AI_PROVIDER`, default DeepSeek, with Anthropic reserved as sensitive/baseline
fallback). The old shared-key message
count is now complemented by an AI-credit data
model: per-plan monthly credits (`bms_plans.ai_credits_monthly`), a monthly summary row
(`bms_ai_usage_monthly`), append-only usage events (`bms_ai_usage_events`), and an append-only
credit ledger (`bms_ai_credit_ledger`). A shop that wants no shared-key limit (or a different
model) sets its own Anthropic or DeepSeek API key in `/admin/settings`. General turns use that key
without deducting the shared credit pool. For a sensitive staff request, Anthropic BYOK remains
first choice; DeepSeek BYOK yields to the shared Anthropic baseline when available and is used only
as a safe provider fallback when that baseline is unavailable. Payment-slip OCR is configured
separately through `lib/bms/slipReaders/index.ts`: `BMS_SLIP_READER_PROVIDER` defaults to Qwen OCR
and `BMS_SLIP_READER_FALLBACK_PROVIDER` defaults to Anthropic. Because OCR is read-only, a failed
Qwen request retries Anthropic once; each attempt has its own usage event and neither can confirm a payment.
Qwen cost estimation uses the official US/global `qwen-vl-ocr` list rate ($0.043 input /
$0.072 output per million tokens as checked 2026-07-30) and can be overridden with
`QWEN_OCR_INPUT_USD_PER_MILLION` / `QWEN_OCR_OUTPUT_USD_PER_MILLION` for another region; see
[Alibaba Cloud model pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing).

- **Schema** (migration [`6.8__bms_ai_config.sql`](../../db/migrations/6.8__bms_ai_config.sql)):
  `bms_tenant_ai_config` (tenant_id PK, `api_key_encrypted` — same AES-256-GCM scheme as
  `bms_tenant_channels.channel_secret`, see [`lib/bms/crypto.ts`](../../apps/web/lib/bms/crypto.ts) —
  plus an optional `model` override). Migration
  [`7.35__bms_tenant_ai_provider.sql`](../../db/migrations/7.35__bms_tenant_ai_provider.sql)
  adds the constrained `provider` (`anthropic`/`deepseek`); legacy rows remain Anthropic.
  Provider base URLs remain platform-controlled.
  Migration
  [`7.27__bms_ai_credit_usage.sql`](../../db/migrations/7.27__bms_ai_credit_usage.sql) extends
  `bms_ai_usage_monthly` from count-only → monthly summary (shared/byok/blocked requests,
  granted/consumed/bonus/adjusted credits, estimated cost), and adds `bms_ai_usage_events` +
  `bms_ai_credit_ledger`. **No cron/reset job** — a new calendar month is simply a new
  `year_month` row starting at 0, so usage resets itself.
- **Service** — [`lib/bms/aiConfig.ts`](../../apps/web/lib/bms/aiConfig.ts) (get/set/remove the
  tenant's own key, `testAiKey()`/`testTenantAiKey()` for tenant BYOK Anthropic/DeepSeek, and
  `testPlatformAiKey()` for whichever shared provider is active) and
  [`lib/bms/aiUsage.ts`](../../apps/web/lib/bms/aiUsage.ts) (`getAiUsage()`,
  `tryConsumeAiQuota()`, `recordByokAiUsage()`, `finalizeAiUsageEvent()`,
  `listAiCreditLedger()`, `listAiUsageBreakdown()`). Usage metadata records
  `routing_reason`, configured/effective provider and `fallback_from`; shared-key deduction remains atomic so
  concurrent requests cannot blow past the monthly quota.
- **`generateResponse()`** ([`lib/bms/ai.ts`](../../apps/web/lib/bms/ai.ts)) now takes `tenantId` and
  tries, in order: tenant's own key (BYOK event only, no shared credit deduction) → shared provider
  (quota-gated + ledger deduction) → template. A shop that runs out of shared credits is never
  blocked entirely — it just gets the deterministic template until next month or until it adds its
  own key.
- **GraphQL** — `bmsAiConfig`/`bmsAiUsage`/`bmsAiCreditLedger`/`bmsAiUsageBreakdown` (query) and
  `bmsSetAiKey`/`bmsRemoveAiKey`/`bmsTestAiKey`
  (tenant, `graphql/bmsAiConfig.ts`) gated by the same `requireTenantAdmin()` as `bmsChannels`/
  `bmsUpsertChannel` — **no new permission was seeded**, same reasoning as Channel Health (this is
  connection/config-domain, not an operational `BMS_PERMISSIONS` action). `bmsTestPlatformAiKey`
  (platform admin only, `requirePlatformAdmin()`) tests the shared env-level key.
- **UI** — AI card in `/admin/settings` (BYOK provider + key + optional model + test/remove, usage banner when
  on the shared key); Dashboard alert when shared-key usage is near/over quota
  (`/admin/dashboard`); Billing now has an AI Credit mockup that reads the real monthly summary,
  real ledger, and real usage breakdown while the pricing/top-up engine remains under construction;
  "ทดสอบ Shared AI Key" button in the platform-only `/admin/env` page; a sidebar indicator
  (`components/AdminSidebar.tsx`, polled every 60s — coarser than the 15s Inbox/Channel-Health
  polls since quota moves monthly, not by the second) pinned above the manual/profile block,
  echoing the always-visible balance strip pattern from the Claude Console sidebar: a
  `RobotOutlined` icon with a status dot (blue = has usage, amber = ≤20% of quota left,
  red = exhausted) linking to `/admin/settings`, hidden entirely once the shop has BYOK or an
  unlimited plan. Platform `/admin/env` also shows Config Doctor, effective runtime routing,
  recent routing reasons, and marks a previously connected provider `STALE` when it has not been
  checked within `BMS_AI_HEALTH_STALE_MINUTES` (default 60).

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
- **AI eval suites** ([`scripts/ai-eval/`](../../scripts/ai-eval/)) — the deterministic runtime
  contract suite forces provider/tool validation, authorization, proposal, timeout, bounded-loop,
  audit-redaction, and post-write-outage paths without network or DB access. The live-model suite
  uses a development/sandbox tenant, persists `EVAL-*` conversations, creates real test orders and
  pending payments, and verifies tool arguments plus GraphQL backend postconditions. Every live
  `ai:tool-calling` turn also resolves its tenant-scoped usage event through an `EVAL-*`-only
  correlation marker and checks configured/effective provider, routing reason, fallback source,
  finalization, and that customer traffic is never marked sensitive. Supplying
  `BMS_EVAL_SLIP_PAYMENT_ID` additionally runs advisory Qwen-primary/Anthropic-fallback OCR
  verification against a real slip and asserts that the payment status does not change (the
  verification result/audit are still persisted). It rejects
  remote targets unless `BMS_EVAL_ALLOW_REMOTE_WRITES=true`, reports functional/safety/system
  results separately, and treats every intermittent safety failure as a defect.
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
