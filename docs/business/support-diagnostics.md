# Support diagnostics

`/admin/support-diagnostics` lets an authorised shop administrator or manager export diagnostics or
send them to the platform Support queue with explicit consent. The selected range is capped at seven
days. Sending creates a `SUP-*` ticket and stores a private gzip-compressed NDJSON bundle through the
configured storage driver; bundle metadata includes a SHA-256 checksum and Support download access
expires after 90 days. `POST /api/bms/support-diagnostics/purge-expired` is a fail-closed,
`BMS_CRON_SECRET`-protected retention job that physically removes expired objects through either the
local or S3 storage driver and soft-deletes their file rows. Run it daily; the database claim uses
`FOR UPDATE SKIP LOCKED`, so overlapping scheduler instances do not process the same bundle.

The browser keeps a bounded 1,000-event local ring buffer so navigation, connectivity changes and UI
failures survive a refresh or a temporary network outage. Restaurant POS also records mutating API
outcomes with route, status, duration, branch and device. The buffer is flushed before export/send.
The server combines these events with tenant audit rows, failure incidents and tenant-attributed
system logs in chronological form.

Each local queue is scoped to its signed-in admin or paired POS device. Every event has a client UUID
and the database enforces `(tenant_id, client_event_id)` uniqueness, so a lost response can be retried
without duplicating the timeline. Restaurant POS exposes the same 24-hour Export/Send workflow and
requires the device token, operator PIN and the matching support permission; it does not require an
open shift, because an inability to open the shift can itself be the incident being reported.

Each source is capped at 20,000 rows per bundle to keep a synchronous support export from exhausting a
web worker. The manifest and response report every truncated source; the UI tells the operator to
choose a shorter period instead of silently presenting a partial file as complete.

Diagnostics use an allowlist. They do not store request bodies, PINs, passwords, tokens, card data or
raw customer messages. `support.logs.view`, `.export` and `.send` are distinct permissions; Manager
receives them by default and Administrator remains a super-role. Export and send write
`support.logs_export`/`support.logs_send` audit rows. `bms_support_events` is append-only for the app
role, while bundle metadata may be updated only for lifecycle management.

Client event `message` values are ignored server-side. Device and location ids are accepted only when
they belong to the authenticated tenant. Nested diagnostic metadata is depth/size bounded and keys
that may contain credentials, request bodies, payment data, contact details or free-text notes are
redacted before the bundle is serialized.

The legacy global `/api/logs` surface is platform-admin-only. It must not be used as a tenant support
export because it contains fleet-wide operational data. Standalone deployments still need durable
stdout/file rotation for the case where PostgreSQL itself is unavailable; the browser ring buffer
preserves client history but cannot replace database-server crash logs.

## Two role/RLS rules this module must not break

Both were live defects in the first cut of `9.46` and are now pinned by
`scripts/support-diagnostics-extra-contract.test.mts`.

**The `files` table is off-limits to `bms_app`.** `9.28` revoked `SELECT ON files FROM bms_app`
on purpose: `files` has RLS disabled, so the grant let the deliberately-constrained role read
every shop's file rows. Any statement touching `files` therefore has to run on the plain pool
as the app role. `readSupportBundleForPlatform()` resolves `relpath` first and only then opens
the tenant transaction that writes the `support.logs_download` audit row — joining `files`
inside `beginTenantTx()` fails with `permission denied for table files`, which took out every
Support download. The retention worker's `LEFT JOIN files` is fine because it runs on a plain
`BEGIN` with no role switch; the rule is about the role, not the table.

**New tenant tables copy `4.2`'s permissive-when-unset policy, not a stricter one.** The policy
enforces `tenant_id` whenever `bms.tenant_id` is set and stays permissive when it is not.
`bms_app` always sets that GUC in `beginTenantTx()` and is `NOBYPASSRLS`, so a shop is still
isolated. Writing `tenant_id = NULLIF(current_setting(...))` without the `COALESCE` reads as
safer but matches zero rows for the table owner under `FORCE ROW LEVEL SECURITY` — and
`purgeExpiredSupportBundles()` is fleet-wide on the plain pool with no GUC set, so it would
claim nothing, purge nothing and report success forever. Private bundles that must be deleted
at 90 days would simply live on. `system_logs` additionally carries a base-app policy, because
enabling RLS on a pre-existing shared table must not be able to cut off the log writer or
`/admin/logs` on a deployment where the app role does not own the table.

A caller-supplied `from`/`to` that cannot be honoured answers `400`. Letting it throw reached
`withRouteErrorLog`, which writes an error-level `system_logs` row — a client-triggerable 500
that can page ops over a typo. Permission denials name the missing permission, because these
are back-office routes where the code is actionable; the counter is the surface where a raw
permission string would mean nothing to the reader.
