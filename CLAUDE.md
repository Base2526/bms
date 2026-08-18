# AI Business Management System (BMS)

BMS turns every customer conversation into a business workflow:

```
Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard
```

It is **not** a chatbot. AI never touches the database — it only calls approved backend tools.
Business logic always lives in `apps/web/lib/bms/*.ts`, shared by REST and GraphQL.

This file is the **navigation index + AI rules**. Working rules for agents are in
[AGENTS.md](AGENTS.md); machine-local notes in [CLAUDE.local.md](CLAUDE.local.md).

## Documentation map

| Doc | Covers |
| --- | --- |
| [architecture/system.md](docs/architecture/system.md) | Module build status, RBAC model, folder structure, roadmap |
| [architecture/database.md](docs/architecture/database.md) | Tables per module, RLS/tenant scoping, migration notes |
| [architecture/api.md](docs/architecture/api.md) | REST routes, GraphQL modules, auth scopes, RBAC gates |
| [architecture/multi-instance-readiness.md](docs/architecture/multi-instance-readiness.md) · [admin-scale-readiness.md](docs/architecture/admin-scale-readiness.md) | Running >1 instance · measured admin load |
| [business/order.md](docs/business/order.md) · [inventory.md](docs/business/inventory.md) · [payment.md](docs/business/payment.md) · [pos.md](docs/business/pos.md) · [crm.md](docs/business/crm.md) | Order lifecycle/coupons · stock/PO/import + branch transfers/counts · payment + slip verify · counter POS/runbook + membership/loyalty · customer identity/inbox |
| [AI_GUIDELINES.md](docs/AI_GUIDELINES.md) | Rules for AI features and approval boundaries |
| [ai/workflow.md](docs/ai/workflow.md) · [tools.md](docs/ai/tools.md) · [prompts.md](docs/ai/prompts.md) · [quality.md](docs/ai/quality.md) | Pipeline + provider routing + usage accounting · tool catalog · prompts · quality signals |
| [pharmacy/README.md](apps/web/lib/bms/pharmacy/README.md) | Pharmacy intake: flags, migrations `7.57`–`7.73` + `7.83`, pharmacist-decides contract |
| [integrations/](docs/integrations/) · [ui/](docs/ui/) | LINE · TikTok · Lazada/Shopee (beta) · carriers — Customer 360 · checkout wireframe · dashboard |
| [scripts/ai-eval/README.md](scripts/ai-eval/README.md) | Deterministic contract suites + live-model evals |
| [agent-invariants.md](docs/agent-invariants.md) | Per-domain rules in full (AGENTS.md has the short form) |
| [feature-log.md](docs/feature-log.md) · [local-notes-archive.md](docs/local-notes-archive.md) | Why each built feature works the way it does (EN · TH) |

## Current status (2026-08)

Fully built except: **Shopee/Lazada** (🧪 beta, signatures unverified) · **Flash/Kerry carriers**
(🧪 safety layer done, adapters await a real merchant contract) · **AI Pharmacy Intake** (🧪
flag-gated off) · **`/live-dashboard`** (🚧 layout only, all numbers mock) · **e-Tax submission**
(🧪 built, gated off by default, no signing/submission provider verified yet) · **POS ESC/POS
printing/cash-drawer** (🧪 written, never run against real hardware). POS counter sale/return/refund
and Thai tax invoicing (migrations `7.84`–`7.95`), membership/tiers/loyalty points (`7.96`), parked
bills + drawer movements + void + shift report (`7.97`), and inter-branch stock transfers + stock
counts (`7.98`) are otherwise fully built — see [business/pos.md](docs/business/pos.md) and
[business/inventory.md](docs/business/inventory.md).

Build table + roadmap: [architecture/system.md](docs/architecture/system.md#build-status-2026-08).
Migrations written but not yet applied to production are listed in
[CLAUDE.local.md](CLAUDE.local.md) § ก่อน production — check the target database, several features
look done in code but need their migration first.

## AI rules (non-negotiable)

- AI **never** writes SQL or touches the database — only approved tools in [ai/tools.md](docs/ai/tools.md).
- AI **never** fabricates stock/price/order numbers — facts come from a successful backend result.
- Sensitive actions (delete, refund, cancel, change price, adjust inventory) require **human
  confirmation + RBAC permission**.
- Every AI tool attempt is audited without raw arguments/PII; successful writes and confirmed
  proposals keep their normal domain audit entries too.
- High-impact records use revision history for before/after snapshots; the audit log remains the
  source for who/when/action. Sensitive writes record their audit row **inside the same transaction**
  as the money or stock they move, so a committed movement can never lack one.
- **Counter POS (`/api/pos/*`) and branch inventory ops (`/api/bms/inventory/*`) are REST-only** —
  a register authenticates with a device token + cashier PIN, not a GraphQL session. They are
  absent from the tool catalogue today because no wrapper registers them. A future staff tool does
  not require GraphQL: wrap the underlying service in `lib/bms/tools/catalog.ts`, derive the tenant
  server-side, re-check permission, preserve the service's in-transaction domain audit, and keep a
  stock-moving action propose-only for explicit human confirmation. Never call the REST route from a
  tool or resolver as a shortcut around those boundaries.
