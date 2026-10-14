# AGENTS.md

How coding agents work in the BMS repository. Applies repo-wide unless a subdirectory has its own
`AGENTS.md`.

BMS is an AI-first business operating system, not a chatbot: `Customer -> AI -> CRM -> Order ->
Inventory -> Payment -> Shipping -> Dashboard`. The database and backend services are the source of
truth; AI interprets intent, selects approved tools, and explains verified results.

Docs index: [CLAUDE.md](CLAUDE.md). Thai customer/sales overview:
[docs/business/product-overview-th.md](docs/business/product-overview-th.md). **Full per-domain rules:
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
| `apps/web/lib/bms/assistantKnowledge/` | Deterministic bilingual capability/guide catalog + retrieval (no DB, no network) |
| `apps/web/lib/bms/pharmacy/` | Flag-gated pharmacy intake |
| `apps/web/lib/bms/deliveryPlatforms/` | Delivery-platform adapters, capability matrix, webhook inbox and command outbox workers (foodpanda sandbox/shadow; GrabFood and LINE MAN contract-blocked) |
| `apps/web/app/api/bms/` · `apps/web/graphql/` | REST/webhooks/cron · GraphQL schema + resolvers |
| `apps/web/app/(admin)/admin/` | Admin UI (incl. `assistant`, `revisions`, `manual`, `system-health`) |
| `apps/web/components/work-assistant/` | Global admin assistant Drawer, shared confirm mutations, POS register guide surface |
| `apps/web/app/(main)/` · `(auth)/` · `(checkout)/` | Public landing/products/`live-dashboard` · auth+signup · signed-link checkout |
| `apps/mobile/` | Bare React Native POS — secure device pairing, generated Apollo GraphQL reads/commands, cashier PIN/RBAC, Wi-Fi/LAN ESC/POS receipt printing, and named WS invalidation for retail/restaurant/board-game/branch-inventory/shift workflows |
| `apps/web/scheduler/` · `apps/web/Dockerfile` (`scheduler` target) | Opt-in central cron dispatcher — timing only; all business logic stays in the Web cron routes |
| `apps/desktop/` | Electron POS shell for Windows/Linux/macOS — first-run pairing, OS-keystore device token, origin-restricted IPC bridge; it hosts `/pos` and owns no business rule |
| `apps/retail-local-agent/` · `deploy/retail-local/` | Go host agent (resumable staging, update transaction, signed licence evidence, local licence UI, installation telemetry) · Retail Local Compose profile, Managed Runtime and online/offline installer builds — a delivery layer that owns no business rule |
| `apps/ws/` · `packages/graphql-core/` | Subscription-only WebSocket gateway (no database connection, ever) · shared typeDefs/resolvers used by both web and ws |
| `packages/realtime/` | The one realtime contract: event union + per-event audience/permission rules, topic builders, validation/redaction, ticket claims, `subscriptionAuth`, `NAMED_REALTIME_SUBSCRIPTIONS` |
| `schema.graphql` | Committed SDL artifact used by in-repo RN codegen and external clients (`npm run schema:export`) |
| `db/migrations/` · `docs/` · `scripts/` | Ordered idempotent migrations · docs · log triage, AI evals, load tests |

## Hard invariants (short form)

One line per rule. Long form: [docs/agents-long-form.md](docs/agents-long-form.md) · authoritative
detail per domain: [docs/agent-invariants.md](docs/agent-invariants.md) — read the matching section
before changing that domain.

**AI and customer chat**
- Two surfaces, one runtime: customer gets `customerTools()` only (no sensitive tool); staff gets
  `staffTools(perms)` re-checked by `requirePermission()` before execution; sensitive staff tools are
  propose-only and the Confirm button must show the mutation and its server-composed args. Every
  attempt audits `ai.tool_call` without raw args; quota is spent once per loop.
- `requestedItems.ts` is the only multi-item splitter; it never resolves SKUs, converts pack units
  or defaults a missing quantity to 1. Pack size/price always come from `bms_product_packs`.
- Customer PII: resolve the customer only from server-established `(tenant, channel, customer_ref)`;
  tools return completeness, never raw name/phone/address. Never name an unconfigured payment
  method. The signed checkout HMAC is the only authority and creates `PENDING` only.
- Customer chat states published facts only (`10.43`, `10.51`–`10.53`): unknown = "not provided",
  capacity ≠ vacancy, truncated ≠ absent, no invented wait time. Answer evidence (`10.53`) is
  provenance in a savepoint, never a verdict, never retries a business action.
- Pharmacy (`10.44`–`10.47`): chat stays non-clinical; a clinical question gets an `APPROVED`
  per-shop guidance body or the fixed handoff verbatim; only a licensed pharmacist approves (licence
  row locked until commit, no Administrator shortcut); editing approved text returns it to `DRAFT`.
  Emergency wording is checked on the raw message before any DB read. Shift evidence ≠ "pharmacist
  present now".
- A pharmacist approval is spent once, in the sale's own transaction (`markAssessmentOrderCreatedInTx`);
  a cancelled bill does not return it. `ONLINE_SALE_PROHIBITED` is per channel; `evaluatePharmacySale()`
  defaults to `"online"` (strict). Clinical evidence streams only from
  `/api/bms/pharmacy/evidence/[id]/file` with `pharmacy.evidence.read` (Pharmacist only).
- AI accounting: keep `billable_credits`, `provider_calls`, `actual_cost_usd` separate; retries
  share one `usage_group_id`; unknown cost is `NULL`. Monthly points (`10.56`): Free 100 / Pro 1,000 /
  Business unlimited, reset 00:00 Asia/Bangkok; no USD cap; attempts recorded before I/O; only
  DB-verified platform admins change plans/points. Shared-provider completions go through
  `finalizeAiUsageEvent()`. Never hook failure alerts off a tool's audit outcome.
- Customer merges need `customer.edit` + a ten-minute signed preview + reason/method/evidence/
  confirmation, committed with the `customer.merge` audit; AI never supplies proof. Web-chat
  `sessionId` is an opaque 30-day tenant-bound signed token; unsigned ids start a new identity.

**Security and platform**
- Every `/api/**` route guards itself (`middleware.ts` covers `/admin/**` only):
  `authorizeAdminRoute(perm)` for staff, signatures for webhooks, `authorizeCronRequest()` for cron
  (503 when the secret is unset — never `if (secret && …)`). Never read the tenant from the body;
  public routes need `rateLimit()`.
- Secrets resolve in a function that throws in production when missing; never `process.env.X ||
  "literal"`, never a module-level const, never exported.
- Files: `files.tenant_id` mismatch answers 404; `visibility` missing = private; uploads bind the
  owner from session/device/signed token only.
- Nothing touches `bms_inventory` without `tenant_id` (+ branch); every stock change writes a
  movement in the same transaction. Who holds reserved stock is derived from `bms_order_stock_lines`.
- A manual "run now" of a fleet-wide job passes the caller's own tenant. Redis has five separate
  uses — reuse `sharedRedisClient`; cache is fail-open, rate limiting is not. Multi-instance state goes
  to Redis/Postgres, never a module `Map`; scheduled read-then-act jobs claim with `SKIP LOCKED`.
- A new env knob goes into the `web` `environment:` block of all three compose files.
- Mail: `MAIL_PROVIDER=smtp` uses implicit TLS on 465/2465 and requires STARTTLS elsewhere;
  `normalizeReplyTo()` drops invalid reply-to; apply `10.59` before enabling SMTP. One cron owner:
  the Docker `scheduler` (timing only, no DB/AI credentials) or GitHub, chosen by `BMS_CRON_RUNNER`.

**POS, tax and money**
- A device token is not a user: every mutating `/api/pos/*` and GraphQL POS op re-checks cashier PIN
  + permission; settlement is one transaction; every money/stock/drawer action carries a stable
  idempotency key. Manual discount, void and drawer cash-out need a second person's PIN.
- A void reuses the return machinery inside its own transaction; serial checks span the bill; shift
  reports answer only the owning device; refund allocations split cash (now) from non-cash (pending).
- Money authority is `bms_order_items.line_amount` (`10.13`), never `unit_price × qty`. Tax documents
  are immutable; a full invoice issues only for a completed, never-voided/returned bill; back office
  refuses cancel/return/refund with an active tax document.
- Expenses (`10.11`): input VAT only on a valid `TAX_INVOICE`; corrections are `VOID`. Supplier
  notes (`10.37`) store positive differences, claim in the month received, move no cash/stock.
- Receipt-QR invoice requests (`10.38`–`10.39`): tenant/order from the signature, hashed tracking
  secret, 3 submissions within 168 h, staff issue with `tax.document.issue` + branch + reviewed
  version. PDF email (`10.58`) is an outbox committed with the invoice; failure never undoes issuance;
  the copy is never e-Tax.
- `BUY_A_GET_B` (`10.41`) gifts are real direct-stock lines frozen in `pricing_snapshot`; returns
  use the frozen rule.
- Credit sales (`9.30`) open AR in the settlement transaction; collection is a drawer cash-in on the
  collecting shift. Store credit/points/deposits are liabilities, never Product SKUs.
- Emergency Offline (`10.5`) is a plain-retail cash queue on the phone only; replay uses the original
  idempotency key; accepted cash is never discarded. The desktop shell owns only the keystore
  credential (Linux refuses `basic_text`) and no business rule. Native Wi-Fi printing sends only
  server-backed receipt raster after `DLE EOT` checks.

**Domains**
- Catalog (`9.40`–`9.52`): sizes come from `bms_product_variants`, never `bms_inventory`; channel
  visibility is `bms_product_sales_surfaces`; only `RECIPE`/`MODIFIER`/`WEIGHTED_PRODUCT`/`WASTAGE`/
  `KITCHEN_WORKFLOW` capabilities gate behaviour.
- Restaurant (`9.44`–`9.62`): a check settles through `recordPosSale()`; round replacement is one
  transaction; modifiers are server-priced and valid only on `RECIPE`; restaurant permissions are its
  own. Online orders need branch + `fulfillmentType`; payment never creates kitchen work; shift-open
  clears only expired sold-out rows; line cancellation reuses `processPosReturn()`.
- Board game (`9.79`–`10.7`, `10.40`–`10.50`): a billing group owns money, a seating owns the table;
  time/passes/offers are entitlements, never SKUs; coverage applies only at group close. Chat booking
  previews without writing, writes after the latest-summary affirmative, `CONFIRMED` only with
  `chat_auto_confirm` on a no-deposit branch, ≤3 active CHAT bookings per customer.
- Branch inventory (`7.98`): transfers are send then receive; counts apply `counted − snapshot`;
  native ops use the `9.88` idempotency record.
- Delivery platforms (`10.12`–`10.21`): capability-gated, never guessed; verified mappings only;
  provider calls run after commit from the outbox; GrabFood/LINE MAN contract-blocked.
- Retail Local is a deployment profile, not a fork; licensing is evidence-only and fail-open; never
  fall back to an offline bundle silently; technical pilot, not GA.
- Social Login (`10.22`): per-surface switch AND ready config; secrets in env only. Sample data
  (`10.26`) is deleted by ledger, never by name prefix. Decision intelligence (`9.12`–`9.14`) is
  advisory/propose-only.
- Realtime: outbox row in the same tenant tx, dispatched after commit; `apps/ws` never touches
  Postgres; new events use `packages/realtime` only; 18 named views share one authorizer.
- Typed GraphQL: regenerate `schema.graphql` in the same change; no caller-supplied scope; business
  rejections stay in `data.<op>.status`, not GraphQL errors.

## i18n

- Operational scripts (PowerShell/shell/release tools) print English, ASCII where practical; keep
  existing UTF-8 BOMs (PowerShell 5.1) and LF for Unix scripts.
- `apps/web/i18n/` + `useI18n()` is the shared dictionary (exact th↔en parity). **A key must live in
  the namespace its `t()` prefix names** — a miss renders the raw key while `tsc`/build stay green.
  `i18n-keys-contract` checks literal keys; runtime-built keys and `adminNavigation.ts` labels
  (checked by `admin-navigation-contract`) need care.
- `resolveBilingual()` for prose-heavy public pages; inline `lang === "en"` is fine where it exists;
  `lib/i18n.ts` + `locales/` is dead — delete, don't extend.
- Don't "fix" intentional Thai: brand voice, regexes on customer-typed Thai, CRM tag values, CSV
  import headers, playground prompts, `฿`, mockup data.
- Counts and per-change history: [docs/agents-long-form.md § i18n](docs/agents-long-form.md#i18n-long-form-including-dictionary-count-history).

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
- **A trigger that runs inside a business transaction can roll that business write back**, so the
  realtime triggers (`9.71`/`9.72`) are held to stricter rules than "it compiles":
  - **One function may only reference columns that exist on every table it is attached to.**
    PL/pgSQL resolves `NEW.<field>` against the real row type, and a `CASE`/`IF` guard on
    `TG_TABLE_NAME` is not proof that the other branch is never resolved. Use `to_jsonb(NEW)->>'x'`
    or a function per table. `9.73` only added table-name branches to the old shared POS trigger;
    `9.74` deliberately replaced it with `bms_realtime_pos_device_trigger()` and
    `bms_realtime_pos_shift_trigger()` because `bms_pos_devices` has `active` while
    `bms_pos_shifts` has `status`/`device_id`. Do not collapse those functions back into one shared
    `NEW.status`/`NEW.active` implementation without proving it on the throwaway database.
    `9.84` also keeps `last_seen_at`/receipt-counter bookkeeping out of the device trigger; otherwise
    authenticating an RN GraphQL request emits `device.session.changed` and prompts a needless
    verify/refetch cycle.
  - **`SECURITY DEFINER` + `BYPASSRLS` does not replace a table grant.** `BYPASSRLS` skips the row
    policy only; a missing `GRANT` is still `42501` and rolls back the caller's write. Grant every
    table the function reads, plus `INSERT` on the outbox and `USAGE` on its sequence, at column
    level following `8.4__grant_bms_app_read_users_roles.sql`.
  - `9.70` runs `CREATE ROLE … BYPASSRLS`, so **that file needs a superuser connection**; it will
    start failing the day `app` is downgraded to a non-superuser as planned.
  - Retention (`bms_cleanup_realtime_outbox`) only deletes `PUBLISHED`/`FAILED`. Installing the
    triggers while nothing drains the outbox grows `PENDING` without a bound, and the
    `REALTIME_*_ENABLED` flags do not stop event production — they gate delivery. The only way to
    stop production today is to drop the triggers, so a migration in this family needs a written
    `ROLLBACK` block.
  - Prove any change on the throwaway instance in
    [docs/architecture/realtime-test-database.md](docs/architecture/realtime-test-database.md),
    against a restored dump. `db/migrations` cannot build an empty database (`1.24` vs `001`).
- Document new tables, states, constraints, and dependencies in `docs/architecture/database.md` and
  the relevant business doc. If operator workflows change, update the in-app manual
  (`app/(admin)/admin/manual/page.tsx`) in the same change.
- `business_archetype` is a starter preset only. Migration `9.43` locks it after the tenant's first
  real order; demo rows marked `FAKE-*` do not count. Any UI list for the field should use the shared
  bilingual `shop_archetypes.*` labels rather than hardcoded strings.
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

```bash
cd apps/web && npm run gate   # typecheck → every DB-free contract suite → production build
```

- `npm run test:pure` (no DB) · `npm run test:db` (`-db-contract`, local host only, writes data —
  never production). The runner walks `scripts/` and `scripts/ai-eval/` (`*.test.mts` only);
  `gate.yml` runs typecheck + pure + build, never DB mode, so "pure green" ≠ DB path exercised.
- One file: `node scripts/run-contract-tests.mjs <pure|db> <name-filter>` (a filter matching
  nothing exits 2).
- Never claim a check passed unless it ran. Cover what you touched: schema (ordering, idempotency,
  RLS, grants, isolation) · API (auth, denial, bad input, success) · money/stock (transitions,
  rollback, duplicates) · AI (verified/missing facts, malformed output, provider failure).
- Realtime DB suites need `9.70`–`9.74`/`9.84`–`9.86`; prove on the throwaway instance
  ([realtime-test-database.md](docs/architecture/realtime-test-database.md)) with a baseline first.
- `apps/mobile` (Jest) and `apps/desktop` (`node --test`) have their own suites that `gate.yml`
  does not run. Browser smokes (`scripts/*-browser-smoke.mjs`) and the live-model suite
  (`scripts/ai-eval/run.mjs`, dev tenants only) run by hand.
- Which suite covers what: [docs/agents-long-form.md § Testing](docs/agents-long-form.md#testing-and-verification-long-form-with-suite-table)
  and [scripts/README.md](scripts/README.md).

## Definition of done

Architecture boundaries intact, tenant/RBAC rules enforced, sensitive actions human-controlled,
relevant checks pass, and documentation reflects the implemented behavior.
