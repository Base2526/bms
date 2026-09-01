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
