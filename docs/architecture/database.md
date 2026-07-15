# Database

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Architecture overview: [system.md](system.md)

All BMS tables are tenant-scoped (`tenant_id UUID`) and enforced by Postgres Row-Level Security
(RLS) — see `db/migrations/4.2__bms_rls.sql` / `4.3__bms_rls_role.sql`. Writes go through
`beginTenantTx()` (`lib/bms/tenant.ts`), which drops the connection to role `bms_app` and sets
`bms.tenant_id` so RLS applies even if a `WHERE tenant_id = ...` clause is ever missed.

Migrations are plain numbered SQL files under `db/migrations/`, applied in order, and written to
be idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded `ALTER`s).
BMS-specific migrations start at `3.2`; anything before that belongs to the base platform template
this project was built on top of (users/sessions/messages/etc.) and is out of scope here.

## Tables by module

| Module | Tables | Key migration |
| --- | --- | --- |
| Products & Inventory | `bms_products`, `bms_inventory`, `bms_stock_movements`, `bms_product_categories` | `3.2`, `5.9`, `6.0` |
| Orders | `bms_orders`, `bms_order_items` | `3.3`, `3.5` |
| CRM | `bms_customers`, `bms_customer_identities`, `bms_customer_addresses` | `3.6` |
| Purchase | `bms_suppliers`, `bms_purchase_orders`, `bms_purchase_order_items` | `5.2` |
| Payment | `bms_payments` | `5.3` |
| Shipping | `bms_shipments` | `5.4` |
| Omnichannel Inbox | `bms_conversations`, `bms_messages`, `bms_conversation_notes` | `5.5` |
| Multi-tenant / RBAC | `bms_tenants`, `bms_tenant_channels`, `bms_role_permissions`, `bms_plans`, `bms_audit_log` | `4.0`–`5.1`, `5.7`, `5.8` |
| Channel Health | `bms_channel_health_log` (+ columns on `bms_tenant_channels`) | `6.4` |

## Notable schema details

**`bms_customer_identities`** — maps `(tenant_id, channel, external_ref)` → `customer_id`, with a
`UNIQUE (tenant_id, channel, external_ref)` constraint (added in `4.0`, originally per-channel-only
in `3.6`). This is *the* matching key for "who is this customer" — there is no automatic dedup by
phone/email across channels (see [../ui/customer360.md](../ui/customer360.md) for the manual merge
feature that fixes this per-customer).

**`bms_orders` / `bms_order_items`** — orders start directly at `PENDING` with stock already
reserved; there is no separate `DRAFT` status in the implementation despite earlier planning docs
mentioning one. `bms_order_items` snapshots `unit_price` at order time (not a live join to
`bms_products.price`), so historical order totals don't change if a product's price changes later.

**`bms_tenant_channels`** — one row per `(tenant_id, channel)`, `channel` is a free-text column
(no CHECK constraint / enum), storing `access_token` and `channel_secret` **encrypted** (AES-256-GCM
via `lib/bms/crypto.ts`), plus an `extra JSONB` column and `active BOOLEAN`. Because `channel` is
unconstrained text, adding a new channel (e.g. Shopee/Lazada) needs no migration — only application
code needs to know the new value (see [../integrations/](../integrations/)).

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

**`bms_role_permissions`** — composite key `(tenant_id, role_id, permission)`; `permission` is a
free-text string validated against the `BMS_PERMISSIONS` catalog in `lib/bms/permissions.ts`, not a
DB-level enum. Administrator role bypasses this table entirely (hardcoded super-access in code).

**`bms_audit_log`** — append-only, written via `audit(ctx, action, target, meta)`
(`lib/bms/audit.ts`); failures to write are swallowed (never blocks the mutation that triggered it).

## Adding a table for a new module

Copy the RLS policy from `4.2` and the `bms_app` grant from `4.3` for any new `bms_*` table — see
the "adding a new module" checklist referenced from [CLAUDE.local.md](../../CLAUDE.local.md).
