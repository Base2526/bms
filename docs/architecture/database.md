# Database

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Architecture overview: [system.md](system.md)

All BMS tables are tenant-scoped (`tenant_id UUID`) and enforced by Postgres Row-Level Security
(RLS) — see `db/migrations/4.2__bms_rls.sql` / `4.3__bms_rls_role.sql`. Writes go through
`beginTenantTx()` (`lib/bms/tenant.ts`), which drops the connection to role `bms_app` and sets
`bms.tenant_id` so RLS applies even if a `WHERE tenant_id = ...` clause is ever missed.

Plain `pg_dump` backups made with `--no-owner` / `--no-privileges` do not include PostgreSQL
cluster roles or object grants. After restoring one, apply migrations through
`6.6__bms_rls_role_restore_hardening.sql`; it idempotently provisions `bms_app`, restores the
current BMS grants, and ensures the older tenant-owned channel/RBAC/audit tables have RLS enabled.
If the runtime database login is not named `app`, grant it membership in `bms_app` explicitly.

Migrations are plain numbered SQL files under `db/migrations/`, applied in order, and written to
be idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded `ALTER`s).
BMS-specific migrations start at `3.2`; anything before that belongs to the base platform template
this project was built on top of (users/sessions/messages/etc.) and is out of scope here.

## Tables by module

| Module | Tables | Key migration |
| --- | --- | --- |
| Products & Inventory | `bms_products`, `bms_product_images`, `bms_inventory`, `bms_stock_movements`, `bms_product_categories` | `3.2`, `5.9`, `6.0`, `6.5`, `7.33` (AI discovery indexes) |
| Orders | `bms_orders`, `bms_order_items` | `3.3`, `3.5`, `7.21` (discount columns) |
| Coupons | `bms_coupons`, `bms_customer_coupon_wallet` | `7.21`, `7.25` |
| CRM | `bms_customers`, `bms_customer_identities`, `bms_customer_addresses` | `3.6` |
| Purchase | `bms_suppliers`, `bms_purchase_orders`, `bms_purchase_order_items` | `5.2` |
| Payment | `bms_payments` | `5.3` |
| Shipping | `bms_shipments` | `5.4` |
| Omnichannel Inbox | `bms_conversations`, `bms_messages`, `bms_conversation_notes` | `5.5`, `7.51` (read/search indexes) |
| Restock follow-up | `bms_restock_subscriptions`, `bms_restock_deliveries` | `7.41` |
| Multi-tenant / RBAC | `bms_tenants`, `bms_tenant_channels`, `bms_role_permissions`, `bms_plans`, `bms_audit_log` | `4.0`–`5.1`, `5.7`, `5.8` |
| Channel Health | `bms_channel_health_log` (+ columns on `bms_tenant_channels`) | `6.4` |
| Store profile / AI policy | `bms_store_profile` | `6.9`, `7.17`, `7.30` |
| AI usage / credits | `bms_tenant_ai_config`, `bms_ai_usage_monthly`, `bms_ai_usage_events`, `bms_ai_credit_ledger` | `6.8`, `7.27`, `7.35` |
| AI context safety / learning | `bms_inbound_events`, `bms_ai_synonym_candidates`; `bms_conversations.ai_state` | `7.30` |
| AI quality review | `bms_messages.meta.aiQuality`, `bms_ai_quality_reviews` | `7.31`, `7.32` |
| AI Provider Health | `bms_ai_provider_health`, `bms_ai_provider_health_log` (platform-wide, no `tenant_id`) | `7.34` |
| Failure incidents | `bms_failure_incidents` | `7.36` |
| Generated report exports | `bms_generated_reports` | `7.52` |
| Sales digest reports | `bms_report_subscriptions`, `bms_report_deliveries` | `7.37` |
| Support tickets | `support_tickets`, `support_ticket_comments` | `7.45` |
| Job run history | `bms_job_runs` (platform-wide, no `tenant_id`) | `7.53` |

## Notable schema details

**`bms_products` customer discovery (`7.33`)** — customer AI reads the live active catalog directly;
there is no product embedding/cache that must be refreshed after an insert. A newly created active
product with sellable inventory is therefore visible to `browse_catalog`/`list_new_arrivals` on the
next tool call, even if it introduces a new category. The active-tenant/creation-time index supports
new-arrival reads, while trigram indexes support bounded partial matching over name, SKU, category,
and brand. Product aliases remain authoritative in `bms_products.keywords`.

**`bms_customer_identities`** — maps `(tenant_id, channel, external_ref)` → `customer_id`, with a
`UNIQUE (tenant_id, channel, external_ref)` constraint (added in `4.0`, originally per-channel-only
in `3.6`). This is *the* matching key for "who is this customer" — there is no automatic dedup by
phone/email across channels (see [../ui/customer360.md](../ui/customer360.md) for the manual merge
feature that fixes this per-customer). Since `6.7`, the table also stores cached channel profile
metadata (`display_name`, `picture_url`, `status_message`, `language`, `profile_synced_at`,
`profile_error_at`, `profile_error`) for display-only use. LINE OA sync writes these fields after
webhook processing; Inbox uses them as fallback when no authoritative CRM customer name/avatar is
available.

**Omnichannel Inbox read path (`7.51`)** — `/admin/inbox` reads the latest conversation list and the
selected conversation separately. Recent-list indexes cover tenant/status/time ordering, detail
indexes cover latest message/event slices, and trigram indexes support bounded text search across
conversation previews, customer refs, message bodies, CRM names, and cached channel display names.
Keep list/detail GraphQL queries bounded; do not reintroduce unbounded message/note/event reads on
the initial inbox view.

**`bms_orders` / `bms_order_items`** — orders start directly at `PENDING` with stock already
reserved; there is no separate `DRAFT` status in the implementation despite earlier planning docs
mentioning one. `bms_order_items` snapshots `unit_price` at order time (not a live join to
`bms_products.price`), so historical order totals don't change if a product's price changes later.
Since `7.21`, `bms_orders.total_amount` is the **post-discount** amount actually owed;
`discount_amount`/`coupon_code` are snapshotted at order creation the same way item prices are, so
totals stay correct even if the coupon is later edited or deleted.

**`bms_coupons` (`7.21`)** — one row per discount code, `UNIQUE (tenant_id, code)`. `type` is
`PERCENT` (capped at 100 by a `CHECK`) or `FIXED`. Redemption is applied inside the same transaction
as `createOrder()` (`applyCouponInTx()`, `lib/bms/coupons.ts`) — the coupon row is locked with
`FOR UPDATE` and `redemptions_count` incremented atomically, so concurrent checkouts can't both
"win" the last redemption of a limited coupon. `redemptions_count` is decremented again only for
pre-sale cancellation paths (`cancelOrder()` and unpaid-order auto-release) in the same transaction
that returns reserved stock. Payment rejection alone leaves the order open and does not release the
coupon; post-sale returns/refunds do not release coupon quota automatically. Per-customer limits are
checked by counting matching non-cancelled `bms_orders` rows directly; there is no separate
redemption-log table.

**`bms_customer_coupon_wallet` (`7.25`)** — a light entitlement table that records which coupons a
customer has explicitly received. One row represents one `(tenant, customer, coupon)` relationship;
the unique constraint is intentionally permanent, so re-granting the same coupon later reuses the
row by clearing `revoked_at` and refreshing `assigned_at` instead of creating duplicates. This table
does **not** carry the source of truth for usage counts or redemption state — those still come from
`bms_orders` — but it lets the product answer "which coupons belong to this customer", "what was
sent to them in chat", and "which assigned coupons are near expiry" without guessing from all global
active coupons. The current assignment flow is best-effort from staff Inbox coupon sends
(`sendStaffMessage()`), source-tagged as `MANUAL_CHAT`.

Since `7.26`, the same table also carries a lightweight lifecycle snapshot: `ASSIGNED`, `RESERVED`,
`REDEEMED`, `REVOKED`, `EXPIRED`, plus timestamps and order links
(`claimed_at`, `reserved_at`/`reserved_order_id`, `redeemed_at`/`redeemed_order_id`, `expired_at`).
These fields are intentionally derivative and UX-oriented: they help AI and operators talk about
"ลูกค้าใช้คูปองนี้ไปหรือยัง" or "กำลังจองอยู่กับออเดอร์ไหน" without replacing the authoritative
order/payment facts. Pre-sale cancellation clears a reservation (and even a paid-path redemption if
that order is cancelled before shipping) so the wallet remains consistent with the coupon quota
release policy. The database CHECK still accepts legacy `CLAIMED` rows from the earlier claim-link
experiment, but the current product flow normalizes those rows back to `ASSIGNED`; customers no
longer need to press a claim button.

**`bms_tenant_channels`** — one row per `(tenant_id, channel)`, `channel` is a free-text column
(no CHECK constraint / enum), storing `access_token` and `channel_secret` **encrypted** (AES-256-GCM
via `lib/bms/crypto.ts`), plus an `extra JSONB` column and `active BOOLEAN`. Because `channel` is
unconstrained text, adding a new channel (e.g. Shopee/Lazada) needs no migration — only application
code needs to know the new value (see [../integrations/](../integrations/)). LINE OA bot/source
display metadata is cached in `extra` (`botDisplayName`, `botBasicId`, `botPictureUrl`,
`botChatMode`, `botInfoSyncedAt`) so Inbox can show which OA/shop received a message without
calling LINE APIs during reads.

**Channel Health (`6.4__bms_channel_health.sql`)** — `bms_tenant_channels` also carries `status`
(CHECK-constrained enum: `connected`/`token_expired`/`webhook_failed`/`rate_limited`/`no_events`/
`send_failed`), `status_detail`, `last_error_at`, `last_inbound_event_at`, `last_outbound_success_at`,
`last_checked_at` — the shop's actual connection health, deliberately separate from `active` (the
admin's on/off switch). `active`+`has_token` are checked client-side before trusting `status` at all,
since a never-configured channel still defaults to `status = 'connected'` in the DB (meaningless until
a real webhook/send event happens). `bms_channel_health_log` is an append-only history of status
transitions (written only when status actually changes), separate from `bms_audit_log` because these
are automated events from external platforms, not admin actions. Written exclusively through
`setChannelStatus()` in `lib/bms/channelHealth.ts` — see [../integrations/lazada.md](../integrations/lazada.md)
for a caveat on what a `webhook_failed` badge means for the Shopee/Lazada beta scaffold specifically.

**AI Provider Health (`7.34__bms_ai_provider_health.sql`)** — same shape as Channel Health but for the
shared platform AI provider (Anthropic/DeepSeek/Qwen OCR) instead of a chat channel. `bms_ai_provider_health`
has **no `tenant_id`** and no RLS (same convention as `bms_plans`) because it tracks the platform's own
shared credentials, not any one shop's data — a tenant's own BYOK key failing is that tenant's problem
and is intentionally not tracked here. Composite primary key `(provider, purpose)` because one provider
can serve more than one purpose independently (Anthropic can back sensitive `chat` baseline/fallback
and, if `BMS_SLIP_READER_FALLBACK_PROVIDER=anthropic`, `ocr` slip fallback — each can be
healthy/unhealthy on its own).
Written exclusively through `setAiProviderStatus()` in `lib/bms/aiProviderHealth.ts`, called from three
places: `finalizeAiUsageEvent()` in `lib/bms/aiUsage.ts` (the single choke point every shared-key chat
and OCR call already passes through — BYOK-sourced events are skipped by checking `source = 'shared'`),
the `/admin/env` "ทดสอบ" button (`testPlatformAiKey()` in `lib/bms/aiConfig.ts`), and the cron
`POST /api/bms/ai/check-health`. `bms_ai_provider_health_log` is append-only history, written only on
an actual status change (same anti-spam rule as `bms_channel_health_log`).
The UI derives `STALE` for a connected row whose `last_checked_at` is older than the configured
freshness window; `stale` is not stored in the database status constraint.

**Tenant AI provider (`7.35__bms_tenant_ai_provider.sql`)** — adds a constrained
`bms_tenant_ai_config.provider` (`anthropic`/`deepseek`, default `anthropic`) so legacy BYOK rows
retain their meaning while new tenants can supply a DeepSeek key. The encrypted-key column remains
the same and arbitrary tenant-supplied base URLs are intentionally unsupported.

**Failure incidents (`7.36__bms_failure_incidents.sql`)** — tenant-scoped, append-only log of system
failures that reached a customer or degraded AI behavior, written only through `reportBmsFailure()`
in `lib/bms/failureAlert.ts`. Deliberately **per-occurrence rows** (like `bms_audit_log`) rather than
one status row per subject (like `bms_ai_provider_health`): the question this table answers is *which
conversations were affected*, so a shop can follow up with each customer, not *is it broken right
now*. `conversation_id` is **intentionally not a foreign key** — an incident must still be recorded
when resolving the conversation is itself the failure being reported, and when the conversation was
later deleted. `notified_shop_at`/`notified_platform_at` double as the alert-cooldown source
(`MAX(...)` per `(tenant_id, code)`), so no separate dedupe table is needed; they are set only after a
notification actually succeeded, so a failed/timed-out notification retries instead of starting a
silent cooldown. This table complements rather than replaces Channel Health and AI Provider Health:
those record *connection status*, this records *customer-visible events that already happened*.

**Generated report exports (`7.52__bms_generated_reports.sql`)** — tenant-scoped, append-only rows
describing each on-demand report export (`SALES` / `INVENTORY` / `PROFIT`) created from
`lib/bms/reportEngine.ts`, regardless of whether the caller came from GraphQL, REST, or the staff AI
tool. Each row stores the export type/format, user-supplied params JSON, optional AI executive
summary text, `generated_by`, and a nullable `file_id` reference into the shared `files` table. The
database row is tenant-owned and RLS-protected, but the referenced file still lives in the global
`files` table, so downloads must verify both: the requester's tenant owns a row in
`bms_generated_reports` for that `file_id`, and the underlying `files` row exists and is not deleted.
That is why report downloads use `/api/bms/reports/download/[id]` instead of the public-ish
`/api/files/[id]` path used for ordinary attachments/images. This table is an audit/history ledger,
not a mutable "latest report" state table: re-generating the same report creates a new row and file.

**Job run history (`7.53__bms_job_runs.sql`)** — platform-wide (no `tenant_id`/RLS, same convention
as `bms_ai_provider_health`) append-only log of every cron/batch invocation, filling a gap
`/admin/operations-schedule` used to admit openly: that page could describe a job's intended
schedule/purpose by reading source files, but never showed a real last-run status. One row per
invocation via `lib/bms/jobRuns.ts` `recordJobRun()` (inserts `status='running'`, then updates to
`success`/`error` once the wrapped function settles — the same helper closes the row on both
outcomes so a route can't forget to) or `recordExternalJobRun()` for a job that already finished
outside this process (currently only the `daily-log-triage` GitHub Action, reporting back through
`POST /api/bms/jobs/report-run`). `job_name` matches the `key` used in
`lib/bms/operationsSchedule.ts`'s `DEFINITIONS` array by convention, not a foreign key — the two
were built as separate registries (one describes "what a job is", the other "what actually
happened") and are joined only in the UI. A `running` row whose process crashed before finishing is
never auto-corrected; the UI flags it "stuck" once it's older than a fixed threshold rather than
guessing at a real outcome.

**Sales digest reports (`7.37__bms_report_subscriptions.sql`)** — `bms_report_subscriptions` is one
row per tenant (`tenant_id` PK, like `bms_store_profile`): frequency (`DAILY`/`WEEKLY`/`MONTHLY`),
send hour (+ weekday for weekly / day-of-month for monthly), a recipient + enable flag per channel
(email address, Slack webhook URL — encrypted like `channel_secret` via `lib/bms/crypto.ts`, LINE
user id), an overall `enabled` flag, and `last_sent_at`/`last_period_key`/`last_status` for
idempotency. `bms_report_deliveries` is append-only (like `bms_audit_log`), one row per channel per
send attempt, so the platform-admin page can show real delivery history instead of just a single
last-status field. `last_period_key` (e.g. `DAILY:2026-07-30`) is the actual dedup key — the cron
can be invoked at any frequency (hourly, even more often) without ever double-sending, since a
tenant whose current period already matches `last_period_key` is skipped. `sendTestDigest()`
deliberately does not touch `last_sent_at`/`last_period_key`, so testing configuration never
disturbs the real schedule. Both tables have the standard tenant-owned RLS policy and `bms_app`
grants; there is no new permission — the shop-facing config mutation gates with the same
`requireTenantAdmin()` pattern as `bms_store_profile`/`bms_tenant_channels`, and the cross-tenant
platform view gates with `requirePlatformAdmin()`.

**`bms_product_images` (`6.5__bms_product_images.sql`)** — ordered gallery rows
`(tenant_id, product_sku, file_id, sort_order)` pointing at the shared `files` table. The older
`bms_products.image_url` column remains in place as the canonical cover image for backward
compatibility with existing UI/API consumers. In the current implementation, product save replaces
the gallery rows for that SKU inside the same tenant-scoped transaction, then repopulates them in
the submitted order. The table has its own RLS policy and explicit `bms_app` grants; forgetting
those breaks product save even if the table itself exists.

**Support tickets (`7.45__support_ticket_comments.sql`)** — `support_tickets` stores the public
support intake from `/support`; it keeps the user-submitted contact/topic/message plus page/UA/IP
metadata and trackable `updated_at` / `closed_at` timestamps. `support_ticket_comments` stores the
internal notes and status transitions for `/admin/support-tickets`, preserving a readable history
of what changed and why. The support tables are platform-wide rather than tenant-owned because
they belong to ops/support, not a specific shop's business data.

**`bms_role_permissions`** — composite key `(tenant_id, role_id, permission)`; `permission` is a
free-text string validated against the `BMS_PERMISSIONS` catalog in `lib/bms/permissions.ts`, not a
DB-level enum. Administrator role bypasses this table entirely (hardcoded super-access in code).

**`bms_audit_log`** — append-only, written via `audit(ctx, action, target, meta)`
(`lib/bms/audit.ts`); failures to write are swallowed (never blocks the mutation that triggered it).
The AI runtime writes `ai.tool_call` for every tool success, failure, denial, or proposal. Its meta
contains only surface/outcome/permission/sensitivity/channel—not raw args, prompts, or customer PII.
Successful AI writes also retain their normal domain action, while confirmed sensitive proposals
are audited by the existing GraphQL mutation.
Realtime diagnostics write `inbox.diagnostic_event` for `Emit` and `inbox.diagnostic_message` for
`Create Msg`. The latter also creates ordinary tenant-scoped `bms_conversations`/`bms_messages`
rows using `customer_ref = diagnostic:{channel}:{adminId}`, `sender = diagnostic`, and
`meta.diagnostic = true`; no separate diagnostic tables or migrations are required.

**`bms_store_profile` (`6.9__bms_store_profile.sql`, `7.30__bms_ai_context_strategy.sql`)** —
one row per tenant (`tenant_id` PK), holding the store facts AI may disclose to customers:
business type, name/about/address/phone/hours, shipping and return policies, shop-owned receiving
accounts, and flat/free-threshold delivery estimates. It has forced RLS and explicit `bms_app`
grants; writes run through `beginTenantTx()`. Carrier quotes are not stored or implied—the current
estimate is only the shop-configured flat-rate policy.

Signup/onboarding extension (`7.42`) — the current store-profile `business_type` remains the broad
AI-facing classification, while the separate optional `business_archetype` field captures richer
onboarding/demo defaults. `bms_pending_shop_signups.business_archetype` stores the value until email
verification, then `verifyPendingShopSignup()` copies it into the first `bms_store_profile` row in
the same transaction that creates the tenant and Manager account. See
[../ui/shop-signup-archetype-spec.md](../ui/shop-signup-archetype-spec.md).

Migration `7.43` enforces the shared archetype allowlist at the database boundary (while allowing
`NULL`) and stores durable onboarding state on `bms_store_profile`: completed/skipped step keys,
dismissed time, and last-seen time. It also adds `resolved_order_id` and an order-item
`recovered_revenue` snapshot to restock subscriptions, so recovery KPIs are attributable to a real
tenant order rather than inferred from status alone.

Migration `7.44` adds the intermediate restock `ORDERED` state and a tenant-scoped
`bms_onboarding_seed_runs` ledger. The ledger records completed seed stages and allows a failed or
stale run to resume without repeating already completed stages; RLS and `bms_app` grants match the
other tenant-owned onboarding data.

Migration `7.30` also adds validated AI language/ordering/required-field/short-reply/handoff policy.
`bms_inbound_events` is the tenant/channel/platform-event idempotency ledger, while
`bms_ai_synonym_candidates` stores bounded search misses for human review. Both have forced RLS and
`bms_app` grants. `bms_conversations.ai_state` is non-authoritative conversation memory; orders and
stock remain backend sources of truth.

**`bms_ai_quality_reviews` (`7.31__bms_ai_quality_review.sql`)** — a tenant-scoped review queue that
references the existing Inbox conversation and AI message. It stores only automatic outcome/reason
codes, sampling source, severity, workflow status, and a human verdict/category/note; it does not
duplicate customer or AI message text. Every failure/handoff/unresolved turn is queued, plus a
stable approximately 5% sample of normal turns. Source-message deletion cascades to the review row.
Each message has at most one review. Tenant/date and severity-queue indexes serve dashboard reads;
foreign-key and partial Inbox indexes keep cascade deletion, metrics, and customer-preview lookups
bounded as volume grows. RLS and `bms_app` grants follow the standard tenant-owned table pattern. See
[AI quality control](../ai/quality.md) for metric definitions and privacy behavior.

## Revision checklist

Use revision tables only for records where a before/after snapshot materially improves auditability,
rollback confidence, or dispute handling. For everything else, prefer append-only history tables or
`bms_audit_log`.

### Should have revision history

These entities are likely to benefit from `_revisions` tables or an equivalent snapshot history:

- `bms_orders`
- `bms_order_items`
- `bms_payments`
- `bms_shipments`
- `bms_products`
- `bms_inventory`
- `bms_customers`
- `bms_customer_addresses`
- `bms_customer_identities`
- `bms_suppliers`
- `bms_purchase_orders`
- `bms_purchase_order_items`
- `bms_store_profile`
- `bms_tenant_channels`
- `bms_tenant_ai_config`

### Should not have revision history

These tables are better served by immutable rows, append-only logs, or reference-style updates:

- `bms_plans`
- `bms_role_permissions`
- `bms_tenants`
- `bms_product_categories`
- `bms_ai_usage_monthly`
- `bms_channel_health_log`
- `bms_customer_ai_summary`
- `bms_audit_log`

### Case-by-case

Decide per workflow rather than forcing a blanket rule:

- `bms_conversations` — use revision only if state fields such as assignment/status/tags need
  exact before/after snapshots; otherwise audit/event history is usually enough.
- `bms_messages` — usually append-only; do not add revision unless message edit history becomes a
  product requirement.
- `bms_conversation_notes` — revision is optional if staff edits to notes must be recoverable.
- `bms_stock_movements` — usually the movement rows themselves are the history; revision is only
  needed if you add mutable metadata that must be snapshotted.

### Rule of thumb

- If the row changes money, stock, customer master data, shipping/order state, or AI-visible store
  settings, revision is usually worth it.
- If the row is reference data, usage data, an append-only log, or a derived summary, revision is
  usually wasteful.
- If reviewers only need "who did what and when", `bms_audit_log` is the right tool.

### Suggested rollout priority

If revision history is added gradually, this is the order I would use:

| Priority | Tables | Why first |
| --- | --- | --- |
| 1 | `bms_orders`, `bms_payments`, `bms_shipments` | Highest dispute risk; customers and staff need exact historical state |
| 2 | `bms_products`, `bms_inventory`, `bms_stock_movements` | Stock and pricing mistakes are expensive and hard to reconstruct |
| 3 | `bms_customers`, `bms_customer_addresses`, `bms_customer_identities` | CRM merges and edits need a recoverable before/after trail |
| 4 | `bms_purchase_orders`, `bms_purchase_order_items`, `bms_suppliers` | Procurement history matters, but usually after sales-critical flows |
| 5 | `bms_store_profile`, `bms_tenant_channels`, `bms_tenant_ai_config` | Config changes affect behavior, but can often be audited before revisionized |

### Quick review checklist

Before adding a revision table, ask:

- Can a human dispute this record later?
- Would a rollback need the exact previous row state?
- Is the table frequently edited instead of appended to?
- Would an audit log alone be enough?
- Does the record affect money, stock, or customer trust?

If the answer is "yes" to the first, second, or fifth question, revision is usually justified.

### Migration plan

The repo carries a generic revision pattern (`create_revision_trigger()` /
`trg_generic_revision()`). Migration `7.0__bms_revision_helpers.sql` standardizes it for BMS by
creating tenant-scoped `<table>_revisions` tables, enabling RLS, granting `bms_app`, and recording
`app.editor_id` / `app.revision_id` from the current transaction. `beginTenantTx()` accepts
`{ editorId }` for attributable tenant writes. That means rollout can be incremental instead of a
database rewrite.

Recommended plan:

1. Confirm the target tables for revision and freeze the initial scope.
2. Add one numbered migration that creates or reuses the generic revision helpers if the current
   database does not already have them.
3. Add revision tables for the first rollout batch only:
   - `bms_orders`
   - `bms_payments`
   - `bms_shipments`
   - `bms_products`
   - `bms_inventory`
4. Backfill only if the business truly needs historical snapshots from before the migration date.
   For most tables, starting from the migration timestamp is enough.
5. Add second-batch revision tables in a later migration:
   - `bms_customers`
   - `bms_customer_addresses`
   - `bms_customer_identities`
   - `bms_purchase_orders`
   - `bms_purchase_order_items`
   - `bms_suppliers`
6. Add config-facing revision tables only after the operational tables are stable:
   - `bms_store_profile`
   - `bms_tenant_channels`
   - `bms_tenant_ai_config`
7. Leave append-only logs and reference tables as-is; do not force them into revision just to be
   consistent.
8. Verify:
   - the revision trigger fires only on update,
   - the revision row stores the correct editor/revision id,
   - RLS and grants still apply to the new tables,
   - reads and writes to the parent tables remain backward compatible.

Implemented migration shape:

- `7.0__bms_revision_helpers.sql` creates/replaces the helper functions.
- `7.1`–`7.3` are broad batch wrappers for core/purchase/config revision tables.
- `7.4`–`7.14` are narrower per-domain wrappers for teams that prefer applying one area at a time.
- Minimal snapshot columns: `id`, `tenant_id`, `editor_id`, `revision_id`, `snapshot`, `created_at`.
- Revision rows store the row state before `UPDATE`; they do not backfill changes made before the
  trigger existed.
- The admin UI at `/admin/revisions` supports list/detail/compare for products, orders, payments,
  and shipments through GraphQL.
- No business logic in the migration beyond table/trigger setup.
- One follow-up validation step per batch using the existing integration or SQL smoke checks.

If a future table needs revision, prefer another small wrapper that calls `create_revision_trigger()`
instead of duplicating trigger DDL.

## Adding a table for a new module

Copy the RLS policy from `4.2` and the `bms_app` grant from `4.3` for any new `bms_*` table — see
the "adding a new module" checklist referenced from [CLAUDE.local.md](../../CLAUDE.local.md).
