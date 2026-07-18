# AI Pipeline (AI-BMS)

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [tools.md](tools.md) · Prompts/guardrails: [prompts.md](prompts.md) · Business rules: [../business/](../business/)

Every channel flows into the same pipeline (channel-agnostic).
Implemented: [`apps/web/lib/bms/pipeline.ts`](../../apps/web/lib/bms/pipeline.ts)

```
Customer
    │
    ▼
Receive Message        ← per-tenant webhook (LINE / TikTok / Facebook / Instagram / Web / Shopee / Lazada)
    │
    ▼
Detect Intent          ← understand()  [lib/bms/nlu.ts]  (rule-based NLU)
    │
    ▼
Extract Entities       ← product / size / qty / multiple items per message
    │
    ▼
Select Tool            ← by intent
    │
    ▼
Call Backend Service   ← checkStock() / createOrder()  (RLS-scoped, atomic)
    │
    ▼
Receive Data           ← real stock/price/order facts from the DB
    │
    ▼
Generate Response      ← generateResponse()  [lib/bms/ai.ts]
    │                     • ANTHROPIC_API_KEY set → Claude composes the reply (facts injected into the prompt)
    │                     • no key → deterministic Thai-language template
    ▼
Reply Customer         ← sent back on-channel + logged to Inbox (logConversation)
```

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

- **Playground** (`/api/bms/chat`, channel=`test`) — send a simulated message and see the full
  trace (intent/tool/reply) without logging to inbox.
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
