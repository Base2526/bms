# AGENTS.md

How coding agents work in the BMS repository. Applies repo-wide unless a subdirectory has its own
`AGENTS.md`.

BMS is an AI-first business operating system, not a chatbot: `Customer -> AI -> CRM -> Order ->
Inventory -> Payment -> Shipping -> Dashboard`. The database and backend services are the source of
truth; AI interprets intent, selects approved tools, and explains verified results.

Docs index: [CLAUDE.md](CLAUDE.md). **Full per-domain rules:
[docs/agent-invariants.md](docs/agent-invariants.md)** — this file has the short form; read the
matching section there before changing that domain. Two are required reading, not optional:
[docs/AI_GUIDELINES.md](docs/AI_GUIDELINES.md) before changing prompts/AI orchestration/AI
tools/slip analysis/any AI-generated customer response, and
[the pharmacy README](apps/web/lib/bms/pharmacy/README.md) before touching `lib/bms/pharmacy/`
(flag-gated off by default; a **licensed pharmacist**, never the model, makes every clinical
decision). When docs and code disagree, inspect the migration and the service, fix whichever is
wrong, and update the doc in the same change.

## Architecture boundaries

- Business logic and database access go in `apps/web/lib/bms/*.ts`.
- REST routes (`app/api/bms/*`) and GraphQL resolvers (`graphql/*`) stay thin adapters:
  authenticate, authorize, validate, call a service, format the result.
- Frontend components implement no authoritative business rules and never touch the database.
- AI code never queries the database or generates SQL — approved backend tools only.
- Every tenant-owned operation is tenant-scoped and protected by RLS.
- Sensitive mutations need both RBAC permission and explicit human confirmation.
- A service in `lib/bms/*.ts` is **not** automatically an AI tool. It must be wrapped in
  `lib/bms/tools/catalog.ts` (arg validation, server-derived tenant, permission, audit) first.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/web/lib/bms/` | Shared business services — the only BMS layer allowed to run SQL |
| `apps/web/lib/bms/tools/` | AI tool catalog + runtime, shared by customer pipeline and staff assistant |
| `apps/web/lib/bms/pharmacy/` | Flag-gated pharmacy intake |
| `apps/web/app/api/bms/` · `apps/web/graphql/` | REST/webhooks/cron · GraphQL schema + resolvers |
| `apps/web/app/(admin)/admin/` | Admin UI (incl. `assistant`, `revisions`, `manual`, `system-health`) |
| `apps/web/app/(main)/` · `(auth)/` · `(checkout)/` | Public landing/products/`live-dashboard` · auth+signup · signed-link checkout |
| `apps/ws/` · `packages/` | WebSocket gateway · shared GraphQL + Redis pub/sub |
| `db/migrations/` · `docs/` · `scripts/` | Ordered idempotent migrations · docs · log triage, AI evals, load tests |

## Hard invariants (short form)

- **AI tool-calling** — two surfaces, one runtime. Customer (`pipeline.ts`) gets only
  `customerTools()`; no sensitive tool is ever exposed there. Staff (`/admin/assistant`) gets
  `staffTools(perms)`, re-checked by `requirePermission()` immediately before execution; sensitive
  tools (refund, cancel, adjust stock, merge, confirm/reject payment, email a report) are
  **propose-only** — the UI's Confirm fires the pre-existing permission-gated mutation. Every attempt
  is audited as `ai.tool_call` without raw args. Quota is consumed once per loop, not per round-trip.
- **Multi-item customer requests** — one chat message can name several products at once.
  `requestedItems.ts` (`parseRequestedItems`) is the *only* splitter for "how many things did the
  customer ask for" — it never resolves a SKU, never converts a pack unit into a piece count, and
  never defaults a missing quantity to 1; do not write a second splitter. A pack's `packCode`
  reaches `create_order` as a name only — pieces-per-pack and pack price always come from
  `bms_product_packs`, resolved server-side, never supplied by the model. `evaluatePharmacySale()`
  reports every blocking SKU in one pass, but a basket with any blocker is still rejected whole —
  never let some lines through because others failed.
- **Customer-surface PII** — checkout tools resolve the customer only from the server-established
  `(tenant_id, channel, customer_ref)`, never an id the model supplies, and return *completeness*
  (booleans/counts/`missingFields`), never the raw name, phone, or address.
- **Payment channels** — never name a method the shop has not configured
  (`paymentConfiguration.ts`). No hardcoded bank/PromptPay/QR examples on the customer surface.
- **Signed checkout link** — the HMAC token is the only authority; never accept tenant id, order id,
  amount, or customer identity from the request body. Amount comes from the order. It creates
  `PENDING` only — never auto-confirm a payment.
- **AI usage accounting** — keep `billable_credits` (charged), `provider_calls` (attempts), and
  `actual_cost_usd` (attributed cost) separate. A retry or provider fallback shares one
  `meta.usage_group_id` and bills **one** credit. Unknown cost is `NULL`, never `0`. Cost attribution
  is not a provider invoice.
- **Shared-provider completions** flow through `finalizeAiUsageEvent()` — a parallel success/error
  path silently stops AI Provider Health from covering it.
- **Failure alerting** — never hook it off a tool's audit `outcome` (that merges real exceptions with
  ordinary "product not found"). Report next to the existing `console.error` sites, and keep the
  notification step time-bounded — it is awaited on the customer-reply path.
- **Carriers** — Flash/Kerry are mock-ready scaffolds, not live adapters; do not "finish" one by
  guessing endpoints or payloads. A carrier call never runs inside the fulfillment transaction, the
  shipment UUID is the idempotency key, and a failed booking stays visible and retryable rather than
  degrading silently into "manual".
- **POS/tax** — a device token is not a user; every mutating `/api/pos/*` route re-checks the
  cashier PIN and an action permission server-side. Settlement (stock, FEFO lots, tax document) is
  one atomic transaction, and every mutating action — sale, return, refund settlement, and (since
  `9.5`) a standalone drawer cash in/out, and (since `9.6`) a POS PO receipt — takes a stable client idempotency key so a lost response
  replays the original write instead of double-charging or moving cash twice. Refund allocations
  split cash (immediate) from non-cash (pending until `payment.refund`); a shift can't close with a
  pending allocation, and a return refunded across cash + card must still count once, not once per
  allocation row. A partial return rechecks the retained quantity against the sale-time
  wholesale/promotion snapshot; falling below a threshold reduces the refund rather than preserving
  an unqualified wholesale price. Tax documents are immutable once issued; e-Tax submission (`7.94`) is a separate
  gated queue, not automatic, and its cron route doesn't yet call `recordJobRun()` like the others —
  don't copy that. `pos_only` accounts are hard-blocked from `/admin` login, not just hidden from the
  menu. **A manual discount, a void, and cash out of the drawer each demand a second person's PIN
  even when the operator holds the permission themselves** — holding a right and exercising it must
  be two separate acts in the evidence. A void is not a return: it reuses the return machinery but
  carries `isVoid`, and its `voided_at` stamp, tax-document cancellation, and audit row happen
  **inside that reversal's transaction**, never a second one afterwards. Serial-number checks (`8.3`)
  span the whole bill, not one line at a time, and the DB write that marks a serial `SOLD` is
  race-safe against two bills claiming it at once. A shift report only answers to the device that
  owns the shift. POS PO receiving derives the branch from the device, re-checks `purchase.receive`,
  and commits stock/movement/audit/retry result together. Bluetooth HID is globally captured only
  after a configured positive prefix; timing/focus is never treated as proof of a scanner. Full detail:
  [agent-invariants.md § POS and tax](docs/agent-invariants.md#pos-and-tax).
- **Branch inventory ops (`7.98`)** — a transfer is two steps (send, then receive) so goods in
  transit belong to no branch; that is what keeps a count at the source correct while the van moves.
  A send never moves reserved stock, and a short receive books the shortfall as lost in transit at
  the source rather than letting it vanish between two branch totals. A count applies
  `counted − snapshot` (snapshot taken when the line was first entered), never an absolute, so sales
  during the count survive; applying is refused if it would drop stock below what customers reserved.
  `inventory.count` and `inventory.count.apply` are separate on purpose — walking the shelves and
  signing off the shrinkage are different jobs.
- **Decision intelligence (`9.12`–`9.14`)** — Q1/Q2 recommendations are advisory: refreshing an
  action never creates a PO or mutates stock, and lost-sale/restock feedback must represent observed
  demand rather than a guess. Q3 retention uses identified customers and paid orders only. A
  next-product suggestion must come from verified basket history; no evidence means no product.
  Treatment is propose-only (`NEW -> ACCEPTED -> CONTACTED`), holdout rows can never be contacted,
  and conversion attribution is bounded to 30 days before open cases expire. Keep `retention.view`
  independent from `followup.view`; sharing a page must not silently widen either permission.
- **Every `/api/**` route carries its own guard** — `middleware.ts` only protects `/admin/**`; the
  other branch returns `NextResponse.next()`, so a REST route with no check of its own is world-
  reachable. Use `authorizeAdminRoute(permission)` (`lib/bms/adminRouteAuth.ts`): it verifies the
  signed session, honours the drill-down cookie, checks RBAC, and returns `tenantId`/`adminId`/`ctx`.
  **Never read the tenant from the request body** — that rebuilds the same hole behind a login. Pass
  `null` as the permission only for a route that genuinely has none in the catalog. A route that is
  public on purpose (customer widget, marketing demo) needs a `rateLimit()` ceiling, because a public
  endpoint that calls a model spends the operator's money, not the caller's. Legacy single-tenant
  mocks that cannot check a session (`/api/bms/{line,tiktok}/webhook` without a `[tenantId]`) are
  404 in production. Guard: `scripts/inventory-tenant-scope-contract.test.mts`.
- **Nothing touches `bms_inventory` without naming the shop** — the table is keyed by
  `(tenant_id, location_id, product_sku, size)`, so a statement filtered by sku + size alone hits that
  product in *every* shop and branch that stocks it, returns success, and leaves no error behind.
  A reservation is also a branch fact, not a shop-wide one, and it writes a `RESERVE` movement in the
  same transaction — the module's rule that every stock change records a movement has no exceptions.
- **Reserved stock has no ledger of ownership** — `reserved_stock` is a running total; nothing records
  which bill owns which unit. Rebuilding "who is holding this" (`listVariantReservations()`) reads the
  `bms_order_stock_lines` view, because a bundle reserves its *components*; counts only bills in
  `PENDING`/`PAID`/`PACKING`, because `SHIP`/cancel release; and reports the part no bill explains
  instead of hiding it, because stock can be locked with no owner to chase.
- **Cross-tenant jobs** — a manual "run now" over a cron/service function that scans all tenants must
  pass the caller's own `tenantId`. A tenant-scoped grant firing a fleet-wide job is a tenancy leak.
- **Redis** backs five separate things (pub/sub, read-through cache, admin session revocation, job
  runs, GraphQL request-latency metrics behind `/admin/system-health`) — do not conflate them or add
  a new client; reuse `sharedRedisClient` from `lib/cache.ts`. The cache is fail-open; **rate limiting
  is not** (it degrades to a per-instance window, never to "allow everything"). Do not cache
  product/catalog reads — they are intentionally always-fresh.
- **Multi-instance** — file bytes go through `lib/storageDrivers/`, fleet-wide state goes to Redis or
  Postgres (never a module-level `Map`), and a scheduled job that reads-then-acts must claim its
  batch (`FOR UPDATE SKIP LOCKED` or compare-and-set) or two schedulers double-fire it.
- **Env knobs** — a new key/model/URL/rate needs an entry in the `web` service `environment:` block of
  **all three** compose files. `--env-file` does not inject it; a missing one reads as `undefined`
  with no error.

## i18n

Four mechanisms; the first three are real, the fourth is dead:

1. `apps/web/i18n/` + `useI18n()` — the shared dictionary (**69 namespaces / 3,892 keys per language,
   exact th↔en parity** as of 2026-08-25 — the +20 that day were `AdminSidebar.tsx`'s Store/Pharmacy
   submenu child labels, which had been plain English string literals inside an otherwise-converted
   file; see [agent-invariants.md § i18n coverage](docs/agent-invariants.md#i18n-coverage-what-bilingual-actually-means-today)).
   This is what the per-user language preference switches.
   **A key must live in the namespace its `t()` prefix names.** `getMessage()` returns the key itself
   on a miss, so a key filed under the wrong section renders `admin_products.col_variant_price` on a
   shop's screen while `tsc`, the build, and every test stay green — it has happened twice in two
   commits. `scripts/i18n-keys-contract.test.mts` resolves every literal `t()` key in both languages
   and checks section-by-section parity; a key built at runtime is invisible to it and still needs
   care.
2. `resolveBilingual()` (`lib/static-page-i18n.ts`) — page-local content objects. Use for new
   prose-heavy public pages.
3. Inline `lang === "en" ? … : …` — used by `/shop/**` and `/checkout` metadata. Fine as-is.
4. `lib/i18n.ts` + `useTranslation()` + `locales/` — **dead**; delete rather than extend.

Coverage: all public/auth/legal pages, storefront, checkout, nav chrome, and **50 of 90** admin
`.tsx` files. The remainder are layout/loading guards and English-only legacy platform pages
(`admin/roles`, `admin/logs`, `admin/files`, `admin/posts`/`post/**`, `admin/operations-schedule`,
`admin/dev/sql-console`) — not Thai leaks.

**Thai a grep will flag but that must NOT be "fixed"**: customer-facing brand voice, regexes matching
a customer's raw typed Thai, CRM tag *values*, the CSV import template's header map,
`admin/playground` sample prompts, `฿`, and `admin/pharmacy-review-mockup`'s mock case data.

Counts are snapshots — re-run
`grep -rl "useI18n\|resolveBilingual" "apps/web/app/(admin)/admin" --include=*.tsx | wc -l` rather
than trusting them, and update this section after any i18n pass. Per-file detail and the reusable
per-user-preference pattern:
[agent-invariants.md § i18n](docs/agent-invariants.md#i18n-coverage-what-bilingual-actually-means-today).

## Frontend and CSS Modules

- A selector in `*.module.css` must contain a local class or ID. A `:global(...)`-only selector fails
  Next.js compilation with `is not pure` and turns the route into a blank/500 page even though `tsc`
  is clean — combine (`:global(.bms-auth-main):has(.page)`) or move it to `app/globals.css`.
- A page-level `<style>{...}</style>` in a client component is plain CSS — `:global()` inside it is
  silently dropped. Target third-party classes with ordinary descendant selectors.
- Keep public auth routes in `isAuthPath()` and other public standalone routes (e.g. `/checkout`) in
  `skipsSessionLayer()` (`ClientProviders.tsx`). Two different gates; don't widen the wrong one.
- Scope Thai-only typography through `html[lang="th"]` so English layout is unaffected.
- Public CTAs are session-aware: with a valid admin session, send the user to `/admin/dashboard`
  instead of showing "start free" / "log in" again.
- Grid columns in shared chrome must be able to shrink (`minmax(0, 1fr)`); a hard min on an empty
  column gave the whole document a horizontal scrollbar and clipped header buttons on every page.
- Large admin lists use server-backed search args, not client-only table filtering.
- Reuse the existing service instead of forking behavior: `createOrder()` for staff-created orders,
  `upsertProduct()`/`validateProductFields()` for bulk import, `bmsMe`/`updateMe`/`uploadAvatar` for
  profile edits, `lib/theme.ts` + `lib/lang.ts` for per-user preferences.
- Inbox reads are bounded (`limit`/`messageLimit`/`eventLimit`/`noteLimit`) — never reintroduce an
  unbounded read. The reply payload contract stays `body + one attachment`, and `/admin/*` links are
  never sent to customers (use `/shop/[tenantSlug]/products/[sku]`).
- Placeholder figures on an operator screen must be unmistakable: standing banner, per-figure
  "ตัวอย่าง" tag, and a `// TODO(real):` naming the query. Distinguish "not wired yet" from "no data
  source exists".
- After changing a route, layout, provider boundary, or CSS Module, open that route in a browser at
  desktop and mobile widths. `tsc` does not catch CSS selector failures.
- The Docker dev stack owns its own `.next` and `node_modules` volumes — never share them with a host
  dev server.

## Database and migration rules

- Add a new numbered migration; never rewrite one that may already have been applied. Migrations must
  be safe to re-run (guarded/idempotent style already in `db/migrations/`).
- Every new tenant-owned `bms_*` table needs `tenant_id`, an RLS policy, and `bms_app` grants — follow
  `4.2__bms_rls.sql` and `4.3__bms_rls_role.sql`.
- Use `beginTenantTx()` for tenant writes; keep multi-step stock/order/payment changes atomic. Pass
  `{ editorId }` when the write should be attributable in revision history. A "single statement, it
  has its own `WHERE tenant_id`" write is still wrong: without `beginTenantTx` the GUC is unset, the
  tenant policy degrades to `tenant_id = tenant_id`, and RLS contributes nothing.
- A sensitive write records its audit row **in the same transaction** as the change. Resolvers use
  `audit(ctx, …)`; paths with no GraphQL context (POS device+PIN, admin REST) insert into
  `bms_audit_log` directly inside the open transaction — see `pos.ts` and `stockTransfers.ts`. Do not
  audit high-volume inner loops (a shelf count is hundreds of lines); audit the decision that accepts
  the outcome. `listAudit()` resolves a raw user id back to an email on read, so storing the id is
  fine — storing nothing is not.
- Per-day document numbers (`TRF-`/`CNT-YYMMDD-NNN`) go through `insertWithDailyDocNo()`
  (`lib/bms/dailyDocNo.ts`). Never take the date from the Node clock and the counter from
  `CURRENT_DATE`: an app on `Asia/Bangkok` against a UTC database then issues duplicates every
  morning until 07:00.
- Parameterized queries only. Preserve append-only audit/history semantics.
- Document new tables, states, constraints, and dependencies in `docs/architecture/database.md` and
  the relevant business doc. If operator workflows change, update the in-app manual
  (`app/(admin)/admin/manual/page.tsx`) in the same change.
- Inbox diagnostics stay split: `Emit` publishes a realtime event only (no rows, no external calls);
  `Create Msg` writes diagnostic rows but never runs the AI pipeline or sends to a channel.

## Authentication, tenancy, and RBAC

- Resolve tenant context with the established helpers; never accept a tenant id from a client as
  authority. Cross-tenant data is reachable only through the drill-down/impersonation flow.
- GraphQL mutations follow: permission check → tenant resolution → service call → audit.
- New permissions go in `BMS_PERMISSIONS` (`lib/bms/permissions.ts`) — no separate frontend catalog.
- `401` for missing/invalid auth, `403` for authenticated-without-permission. A permission failure is
  never a logout.
- Hiding a menu item is not authorization. Enforce on the server.
- A REST route mirrors the permission of the GraphQL resolver doing the same job (`order.pay`,
  `purchase.receive`, `report.view`, `inbox.reply`, …) — do not invent a second, looser rule for the
  same action. "Logged in" is not a permission: an upload endpoint gates on the permission the step
  that consumes the file needs.
- Public login/registration normalizes identity through `lib/auth/identity.ts` (trim + NFKC +
  lowercase); never add an auth path that queries raw `email = $1`. Google ID tokens must be verified
  with `google-auth-library` (decoding claims is an account takeover); Facebook debug-token
  `app_id`/`user_id` must match. Secrets never use a `NEXT_PUBLIC_*` name.

## API and integration rules

- REST and GraphQL call the same service functions so behavior cannot diverge.
- Verify webhook signatures before processing; keep Shopee/Lazada marked beta until verified against
  official docs. Make handlers idempotent where platforms retry.
- Never log raw tokens, secrets, payment details, or unnecessary PII.
- Channel health semantics: `active` is an admin switch, `status` is observed connection health.
- Cached external profile data (e.g. LINE display name) is display fallback only — never call profile
  APIs from list renders or read resolvers, and never overwrite staff-maintained CRM fields.
- Realtime diagnostic routes are Administrator/platform-admin only, tenant-scoped, audited, and safe
  to run in production without messaging real customers.
- Adding a channel means updating every duplicated channel allowlist and the integration docs.

## Observability (`/admin/system-health`)

Platform-admin, **read-only** page answering "how is the system doing right now" in one place —
never add a button here that writes, restarts, or mutates anything. `lib/bms/systemHealth.ts` is a
**composition layer, not a new subsystem**: reuse an existing service if one exists, and every read
returns `{ok:false, error}` instead of throwing (an unapplied migration must degrade to one warning
card, not a 500). GraphQL latency/error-rate metrics live in Redis histograms
(`lib/bms/requestMetrics.ts`), not Postgres, on purpose — do not add a per-request DB write here or a
process-local `Map`. Full rationale, what it does not answer yet (slow-query, REST latency,
container CPU/memory), and the request-metrics design tradeoffs:
[agent-invariants.md § Observability](docs/agent-invariants.md#observability-adminsystem-health).

## Working method

1. Inspect the service, API adapters, UI caller, schema/migration, and relevant docs before editing.
2. Make the smallest coherent change that preserves existing public behavior.
3. Reuse existing services, permission helpers, transaction helpers, and UI patterns.
4. Validate at the boundary — webhook payloads, API inputs, model output, and JSON fields are
   untrusted.
5. Verify the narrowest affected surface first, then broader build/type checks.
6. Report what changed, what was verified, and any remaining risk or unverified dependency.

Never modify unrelated user changes, secrets, local env files, generated artifacts, or database
dumps. Never commit `.env*`, tokens, customer data, or credentials.

## Testing and verification

No repository-wide test script. Use checks proportional to the change:

```bash
cd apps/web && npx tsc --noEmit && npm run build
```

(`apps/ws`, `packages/graphql-core`, `packages/realtime` each have their own `npm run build`.)

- Never claim a check passed unless it was run successfully.
- Schema changes: migration ordering, idempotency, RLS, grants, tenant isolation.
- API changes: authentication, permission denial, invalid input, success path.
- Order/inventory/payment: state transitions, rollback, duplicate requests, stock invariants.
- AI changes: verified facts, missing facts, malformed model output, provider failure, deterministic
  fallback.
- Deterministic contract suites need **no network or database** — run the ones covering what you
  touched (`cd apps/web && npx tsx --test ../../scripts/<path>`):

| Suite | Covers |
| --- | --- |
| `ai-eval/runtime-contract` | tool runtime, RBAC/surface denial, propose-only, usage accounting |
| `ai-eval/slip-reader-contract` | OCR adapters, provider fallback, cost attribution |
| `ai-eval/customer-policy-contract` · `customer-message-routing-contract` | customer reply policy and routing |
| `ai-eval/checkout-token-contract` | signed checkout link scope/tamper/expiry |
| `ai-eval/archetype-policy-contract` · `restock-lifecycle-contract` · `pharmacy-intake-contract` | archetype policy · restock consent · pharmacy intake |
| `auth-identity-contract` · `user-admin-contract` | auth identity · staff management |
| `multi-item-request-contract` · `pharmacy-trigger-contract` · `pharmacy-policy-decision-contract` | multi-item message splitting/pack units · pharmacy product-vs-symptom classification · basket-wide policy blockers |
| `infra/multi-instance-contract` | storage driver, fleet-wide state, cron claim-before-act |
| `i18n-keys-contract` | every literal `t()` key resolves in th+en; per-section key parity |
| `inventory-tenant-scope-contract` | every `bms_inventory` statement is tenant-scoped; every `/api/bms` route has a guard; the reserve route never takes a tenant from the body |

  Suites that need a real Postgres **write to it** — dev only, never production. They create and
  remove their own rows (`scripts/variant-reservations-db-contract.test.mts` covers reservation
  attribution incl. bundles and unexplained holds; `scripts/reserve-stock-db-contract.test.mts`
  covers cross-shop/cross-branch reservation, the ledger row, and rollback). Run them from
  `apps/web` with the `next-runtime-shim` import and `--test-concurrency=1`; the exact command lives
  in [CLAUDE.local.md](CLAUDE.local.md).

  The **live-model** suite (`scripts/ai-eval/run.mjs`) writes real data — development/sandbox tenants
  only. See [scripts/ai-eval/README.md](scripts/ai-eval/README.md).

## Definition of done

Architecture boundaries intact, tenant/RBAC rules enforced, sensitive actions human-controlled,
relevant checks pass, and documentation reflects the implemented behavior.
