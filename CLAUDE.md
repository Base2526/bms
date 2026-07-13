# AI Business Management System (AI-BMS)

AI-BMS is an AI-first Business Management System that automates business operations from
customer conversations to order fulfillment. Unlike traditional ERP/CRM, it treats every customer
conversation as the starting point of a business workflow:

```
Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard
```

AI-BMS is **not** a chatbot — it is an AI Business Operating System. AI never touches the database
directly; it only calls approved backend tools. Business logic always lives in
`apps/web/lib/bms/*.ts` (shared by REST and GraphQL) — see [docs/architecture/system.md](docs/architecture/system.md)
for the full philosophy and module breakdown.

## Documentation map

| Doc | Covers |
| --- | --- |
| [docs/architecture/system.md](docs/architecture/system.md) | Vision, modules, build status, RBAC model, folder structure |
| [docs/architecture/database.md](docs/architecture/database.md) | Tables per module, RLS/tenant scoping, migration notes |
| [docs/architecture/api.md](docs/architecture/api.md) | REST routes, GraphQL modules, auth scopes |
| [docs/business/order.md](docs/business/order.md) | Order lifecycle, reorder, shipping |
| [docs/business/inventory.md](docs/business/inventory.md) | Stock rules, movement types, purchase orders |
| [docs/business/payment.md](docs/business/payment.md) | Payment methods, lifecycle, AI slip verification |
| [docs/business/crm.md](docs/business/crm.md) | Customer identity, addresses, omnichannel inbox rules |
| [docs/ai/workflow.md](docs/ai/workflow.md) | The AI pipeline (intent → tool → backend → reply) |
| [docs/ai/tools.md](docs/ai/tools.md) | Every tool AI is allowed to call |
| [docs/ai/prompts.md](docs/ai/prompts.md) | The actual Claude system prompt + guardrails |
| [docs/integrations/line.md](docs/integrations/line.md) | LINE webhook/reply |
| [docs/integrations/tiktok.md](docs/integrations/tiktok.md) | TikTok webhook (send API = roadmap) |
| [docs/integrations/lazada.md](docs/integrations/lazada.md) | Lazada + Shopee beta scaffold — what's real vs. placeholder |
| [docs/ui/customer360.md](docs/ui/customer360.md) | Inbox customer tab, cross-channel merge, reorder |
| [docs/ui/dashboard.md](docs/ui/dashboard.md) | Dashboard & Reports |
| [CLAUDE.local.md](CLAUDE.local.md) | Machine-local dev notes (not a spec — run commands, gotchas, lessons learned) |

## Current status (2026-07)

Every module in the table above is **fully built** except Shopee/Lazada (🧪 beta scaffold — see
[docs/integrations/lazada.md](docs/integrations/lazada.md)) and the roadmap items below. Full
build-status table: [docs/architecture/system.md](docs/architecture/system.md#build-status-2026-07).

**Roadmap remaining:** TikTok send API · real carrier API (label PDF/auto-tracking) ·
AI tool-calling / OCR / forecasting (Phase 3–4) · WhatsApp / Email / Voice AI · Shopee/Lazada
signature verification against real Open Platform docs · letting shop owners (Manager role)
manage their own staff.

## AI rules (non-negotiable)

- AI **never** writes SQL or touches the database directly — only approved tools in
  [docs/ai/tools.md](docs/ai/tools.md).
- AI **never** fabricates stock/price/order numbers — facts always come from the backend.
- Sensitive actions (delete, refund, cancel, change price, adjust inventory) require **human
  confirmation + RBAC permission**.

Full rules and enum values actually enforced in code: [docs/business/](docs/business/).
