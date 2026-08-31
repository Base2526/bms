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
| [ai/work-assistant-coverage.md](docs/ai/work-assistant-coverage.md) | Global staff assistant: capability/guide catalog, what each status word means, coverage + regression gates |
| [pharmacy/README.md](apps/web/lib/bms/pharmacy/README.md) | Pharmacy intake: flags, migrations `7.57`–`7.73` + `7.83`, pharmacist-decides contract |
| [integrations/](docs/integrations/) · [ui/](docs/ui/) | LINE · TikTok · Lazada/Shopee (beta) · carriers — Customer 360 · checkout wireframe · dashboard · retention engine |
| [scripts/ai-eval/README.md](scripts/ai-eval/README.md) | Deterministic contract suites + live-model evals |
| [agent-invariants.md](docs/agent-invariants.md) | Per-domain rules in full (AGENTS.md has the short form) |
| [feature-log.md](docs/feature-log.md) · [local-notes-archive.md](docs/local-notes-archive.md) | Why each built feature works the way it does (EN · TH) |

## Current status (2026-08)

Fully built except: **Shopee/Lazada** (🧪 beta, signatures unverified) · **Flash/Kerry carriers**
(🧪 safety layer done, adapters await a real merchant contract) · **AI Pharmacy Intake** (🧪
flag-gated off) · **e-Tax submission**
(🧪 built, gated off by default, no signing/submission provider verified yet) · **POS ESC/POS
printing/cash-drawer** (🧪 written, never run against real hardware). POS counter sale/return/refund
and Thai tax invoicing (migrations `7.84`–`7.95`), membership/tiers/loyalty points (`7.96`), parked
bills + drawer movements + void + shift report (`7.97`, hardened through `9.5` with idempotent
drawer cash movements, whole-bill serial checks, and shift-report correctness fixes), inter-branch
stock transfers + stock counts (`7.98`), and a keyboard-wedge Scan Manager plus retry-safe PO
receiving at the register (`9.6`) are otherwise fully built — see
[business/pos.md](docs/business/pos.md) and [business/inventory.md](docs/business/inventory.md).
The commercial intelligence roadmap is built through **Q3**: Phase 1 bundles the daily Action Center
and inventory purchasing intelligence (`9.12`–`9.13`), while Phase 2 adds the monthly customer
retention engine (`9.14`) with RFM/risk scoring, verified next-product evidence, a propose-only
comeback queue, deterministic holdout, and bounded 30-day conversion attribution. See
[ui/dashboard.md](docs/ui/dashboard.md), [ui/retention-engine.md](docs/ui/retention-engine.md), and
[business/crm.md](docs/business/crm.md). Q4 profit/growth simulation remains planned.
Migrations `8.0`–`9.4` add further POS features (blind close/no-sale, price tiers, blind returns,
serials, commission, non-stock charge lines, promotions, bundles, store credit, deposits, branch
creation) not yet reflected in this summary — see [CLAUDE.local.md](CLAUDE.local.md) for the
per-migration build/verify/production status of each.

**REST surface hardening (2026-08-24, no migration)** — `middleware.ts` only guards `/admin/**`, so
every route under `/api/**` needs its own check. Twenty-three single-tenant-era routes had none:
`/api/bms/reserve` could reserve stock in *every* shop selling a SKU without logging in, and the
order/payment/purchase/shipment/report/inbox routes let an anonymous caller act on the default shop.
All now use `authorizeAdminRoute(<permission>)` with the tenant taken from the signed session; two
webhook mocks that cannot check a session are 404 in production, the public demo endpoint gained a
rate limit, and the two upload routes — authenticated but permission-less — now require the
permission the step that consumes the file needs. `/admin/products` also gained a drill-down that answers "who is holding this reserved
stock". Details: [business/inventory.md](docs/business/inventory.md) and
[architecture/api.md](docs/architecture/api.md).

**Global AI Work Assistant (2026-08-28, no migration, no new permission)** — the staff tool-calling
runtime now also serves `bmsWorkAssistant` from a Drawer on every back-office page, grounded on a
deterministic bilingual catalog (46 capabilities, 97 guides, 20 FAQ answers, 97 limit rules) covering every Sidebar
destination and every routable Admin page. `/pos` gets the same catalog as offline guide search with
no GraphQL/AI call, so a `pos_only` cashier is never pulled toward `/admin`. No new tool executes
anything a permission did not already allow. The FAQ *and* the limits/traps moved out of
`/admin/manual` into the catalog, so the page and the assistant read one array instead of two copies. Every question the product asks
is pinned to the entry that must *lead* its answer (`scripts/ai-eval/work-assistant-question-corpus.mts`)
— retrieving the right guide at rank 6 is a failure, not a pass. Coverage, status vocabulary and the
regression gates: [ai/work-assistant-coverage.md](docs/ai/work-assistant-coverage.md).

**Shop archetype lock + bilingual labels (2026-08-31)** — the `9.40`–`9.43` archetype work expanded
the catalog and now locks `business_archetype` after the tenant's first real order; the dropdown
labels themselves now live in the shared `th`/`en` dictionary. Demo rows marked with `FAKE-*` stay
editable, but real order history freezes the preset so AI guidance, onboarding checklists and
capability defaults cannot drift behind the business record. See
[ui/shop-signup-archetype-spec.md](docs/ui/shop-signup-archetype-spec.md) and
[shop-archetype-guide.md](docs/shop-archetype-guide.md).

Build table + roadmap: [architecture/system.md](docs/architecture/system.md#build-status-2026-08).
Migrations written but not yet applied to production are listed in
[CLAUDE.local.md](CLAUDE.local.md) § ก่อน production — check the target database, several features
look done in code but need their migration first.

## AI rules (non-negotiable)

- AI **never** writes SQL or touches the database — only approved tools in [ai/tools.md](docs/ai/tools.md).
- **The staff assistant's knowledge catalog states product capability, never tenant state.**
  `AVAILABLE`/`CONDITIONAL`/`BETA`/`MOCK` describe one capability, not a module — shipment
  creation is `AVAILABLE` while carrier booking stays `MOCK`. A status that overstates what has
  been verified end to end is a lie told to staff at a counter, so e-Tax, Shopee/Lazada and
  ESC/POS printing are `BETA` until a real integration is proven.
- **Standing on a page re-ranks its guides; it never turns them into an answer.** The
  current-page bonus is larger than any relevance floor, so a result carries `matchedQuery` and
  only query-matched entries become citations or links — otherwise every guide on the page is
  cited for every message and "no verified guide matched" becomes unreachable. Page context is
  retrieval only and never grants permission; a guide's `route` must be a page that renders,
  because the assistant hands it to the user as a link.
- **A verified answer is a payload, not a retrieval key.** Each FAQ and each limit group names the
  guide that owns it; questions, group titles and the phrasings staff really type are folded into
  that guide's aliases, but answer and rule text is never scored. Scoring long prose makes every
  answer a weak match for every question — the "it found something" failure. The Manual renders the
  same arrays, so an answer has one home, not two.
- **A question is answered by the entry that leads the result, not by one buried in it.** Every
  question the product ships (starter chips) or was verified against is pinned in
  `scripts/ai-eval/work-assistant-question-corpus.mts` with the entry that must rank first, and
  every question that needs live data is pinned to an approved tool plus the permission gating it.
  Every guide and capability needs at least one such question: an entry nobody can ask about is
  unreachable, and unreachable text is where wrong text survives.
- **The register assistant stays inside the register.** `/pos` gets deterministic guide search
  with no GraphQL/AI call, limited to guides performed at the register (`pageId === "pos"`) — a
  `pos_only` account cannot open `/admin` at all, so answering a cashier with a back-office
  guide is a dead end.
- AI **never** fabricates stock/price/order numbers — facts come from a successful backend result.
- AI **never** sets a price, a pack size, or a pieces-per-unit count — a pack code returned by
  `check_stock` reaches `create_order` as a name only; pieces-per-pack and pack price are always
  read from `bms_product_packs` server-side, never supplied by the model.
- Sensitive actions (delete, refund, cancel, change price, adjust inventory) require **human
  confirmation + RBAC permission**.
- **A customer order is never created until the customer has seen every line and said yes.** The
  first `create_order` call for a basket on the customer surface writes nothing — it returns
  `CONFIRMATION_REQUIRED` plus the resolved lines, the pipeline shows a **server-composed** itemised
  summary (never the model's prose), and only a call whose lines still match the fingerprint the
  customer affirmed creates the order. The confirmation signal is server-only (`ExecCtx`), so the
  model cannot grant it to itself, change a quantity, or add a line after the customer agreed.
- Ambiguous pharmacy catalog matches use server-owned line codes (`A1/B2`) persisted in conversation
  state. A choice turn always produces a new server-composed basket summary; confirmation text sent
  with the choice cannot skip that second, fingerprint-bound confirmation.
- **AI never answers with an empty turn.** A model turn carrying no text block is a system failure
  (`ai.empty_reply`), not an answer — the customer is told the system failed and a human is alerted.
  Never tell a customer to retype what they typed correctly.
- Every AI tool attempt is audited without raw arguments/PII; successful writes and confirmed
  proposals keep their normal domain audit entries too.
- High-impact records use revision history for before/after snapshots; the audit log remains the
  source for who/when/action. Sensitive writes record their audit row **inside the same transaction**
  as the money or stock they move, so a committed movement can never lack one.
- **A REST route is not protected by being under `/api`.** `middleware.ts` guards `/admin/**` only.
  Every `/api/bms/*` route authenticates itself — `authorizeAdminRoute(permission)` for staff routes,
  a verified signature for webhooks, a job token for cron — and **derives the tenant server-side**.
  A route that is public by design needs a rate limit, because a public endpoint that calls a model
  spends the operator's money. Enforced by `scripts/inventory-tenant-scope-contract.test.mts`.
- **Counter POS (`/api/pos/*`) and branch inventory ops (`/api/bms/inventory/*`) are REST-only** —
  a register authenticates with a device token + cashier PIN, not a GraphQL session. They are
  absent from the tool catalogue today because no wrapper registers them. A future staff tool does
  not require GraphQL: wrap the underlying service in `lib/bms/tools/catalog.ts`, derive the tenant
  server-side, re-check permission, preserve the service's in-transaction domain audit, and keep a
  stock-moving action propose-only for explicit human confirmation. Never call the REST route from a
  tool or resolver as a shortcut around those boundaries.
