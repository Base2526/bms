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
outcomes with route, status, duration, branch and device. When the ring fills it retains a coded
count/time-range gap marker; local storage failures and server-rejected items are shown in the
Support panel. Browser flush requires an item-by-item acknowledgement, removes only accepted or
duplicate items, and retains rejected items locally. The buffer is flushed before export/send.
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

POS PIN-verification diagnostics may carry the UUID of the cashier selected on the device, never the
PIN. Ingestion accepts that UUID only when it belongs to the authenticated tenant. The admin event
detail resolves it to the current user label and role, describes it as the selected cashier rather
than proof of identity, and removes the raw UUID from the returned context. A device-only event says
that no cashier was identified instead of presenting the device actor as a person.

Client event `message` values are ignored server-side. Device and location ids are accepted only when
they belong to the authenticated tenant. Event category, action, status, IDs and context are
revalidated on ingestion and again when a bundle is built, including historical rows. Audit,
failure-incident and system-log bundle entries include only coded/timestamp metadata; their
historical free-text messages, targets and arbitrary metadata are omitted. This reduces the detail
in older bundles but prevents a legacy free-text field from leaking into a new export.

## POS connection incident timeline (10.140)

The [independent scenario review matrix](pos-connection-review-matrix.md) checks operator UI,
local/export evidence, upload ACK and admin history for each connection failure and recovery case.

Desktop and Mobile POS persist coded connection events locally even when a request never reaches the
backend. Events contain a UUID client attempt ID, a fixed action/error code, an allowlisted route or
GraphQL operation, HTTP status if received, duration, app version and platform. Direct REST calls
from the full `/pos` selling screen are covered. Its session read has an
eight-second deadline and rejects malformed/HTML 200 replies with a coded, safe operator message.
The browser POS screen does not display raw server errors or a suffix of the device token.
The ingestion route and native journals reduce check/ticket URLs to their fixed endpoint family; neither query
strings nor record IDs belong in a diagnostic route. Unfamiliar error codes become
`POS_UNKNOWN_ERROR` rather than arbitrary client text. Ingestion derives tenant, device and branch
from the authenticated device token. The admin activity endpoint rejects `pos` events so an
administrator session cannot impersonate a paired device in the POS history. A valid
`x-pos-attempt-id` received by a POS REST or GraphQL route is echoed in its response and included in
unhandled server fault logs; an event without the echoed proof records the client's attempt but
does not prove that the original request reached the backend. A transport timeout after a
sale/payment is `unknown` until the original idempotency key and server state are checked.
Diagnostics never retry business actions.

`POST /api/pos/diagnostics/events` acknowledges every item as accepted, duplicate or rejected with
a safe reason (`event_too_old`, `clock_ahead`, invalid field, etc.). The backend accepts events from
the previous seven days and at most five minutes in the future. It does not silently clamp a wrong
device clock or claim that an older event was stored. Mobile keeps up to 25 events per paired target
for 30 days in Keychain; Desktop keeps up to 500 for 30 days in a user-only local journal. Capacity
and local retention losses create a count/time-range gap summary. Mobile uploads a coded gap event
when it can; both clients show/export the local gap even if upload is blocked. Rejected items stay
available for export; token rejection blocks only that target's upload and never moves its queue to
another server or device. The Desktop recovery and setup screens can export before `/pos` opens;
Mobile Settings uses the OS share sheet even when the server is unavailable.

`/admin/pos-devices` requires `support.logs.view` for the event timeline. Its server-backed cursor
pages by occurrence time (50 at a time) and filters device, time range, status, reason code and
correlation ID. Event detail shows occurrence and receipt separately; a delay over one minute is
marked as queued/delayed, and a device clock over one minute ahead is flagged for checking. The
branch is populated only when the event timestamp is at least five minutes after the device's
latest server-side edit, allowing for the accepted clock skew. Older or ambiguous events show an
unknown branch instead of being attributed to a newly assigned branch. A device edit may be token
rotation or a setting change, so some valid events will also have an unknown branch. Inspect device
assignment history and the local export when the branch is unknown. The seven-day
export-bundle window remains separate from the paged POS history. Existing legacy event
messages are cleared and old actor/session/correlation fields, action/status and context values are reduced to typed/coded metadata by migration
`10.140`; unsafe old context values may no longer be searchable after that privacy cleanup. New
ingestion writes `message = NULL` and newly built bundles never expose the old free text. The
migration also removes free-text message/stack/meta from identifiable historical POS REST
faults and POS GraphQL logs identified by a valid attempt ID or a standard POS operation name.
Historical GraphQL logs with neither identifier cannot be attributed to POS with certainty, so
the bundle reader continues to omit all server free text.
Bundles
sent before this migration are immutable stored files and remain under the existing 90-day purge
policy; this migration does not rewrite copies already downloaded. No PIN, device token, headers,
bodies, payment/card details or customer text enter the new coded client journal, upload or export.

### Manual acceptance on release candidates

Run the same script on Windows, Linux and macOS Desktop builds, then Android and iOS Mobile builds:

1. Pair a disposable device, open the selling screen, then disconnect the network before a health
   check. Confirm a coded offline reason, local evidence and export while still offline.
2. Restore HTTP while blocking only the WebSocket gateway. Confirm selling reads use HTTP, the UI
   says realtime is degraded, and recovery is recorded when the gateway returns.
3. Exercise 401, 403, 408, 429, 5xx, HTML 200 and a delayed response after a test mutation on a
   disposable tenant. For an unknown mutation result, look up the original idempotency key and
   server record; do not submit it under a new key.
4. Restart the app while offline, rotate the device token, and then pair a different server. Check
   that old evidence remains exportable and never uploads under the new target. Fill the diagnostic
   queue and verify dropped count/time range in the UI or export.
5. Check `/admin/pos-devices` with `support.logs.view`: search by device, time, code and attempt ID;
   page beyond 50 rows; compare occurrence and receipt time. Confirm a request that never reached
   the server has no server-received proof. Inspect journal, export, payload and DB row for secrets.

These are manual release checks, not claims that all five platforms were exercised by unit tests.

The legacy global `/api/logs` surface is platform-admin-only. It must not be used as a tenant support
export because it contains fleet-wide operational data. Standalone deployments still need durable
stdout/file rotation for the case where PostgreSQL itself is unavailable; the browser ring buffer
preserves client history but cannot replace database-server crash logs.
For platform incident review, `level=error` and structured `status=error` are different filters;
expected GraphQL authorization/client failures are warnings. See the
[log triage runbook](../architecture/logging-and-triage.md) before interpreting counts.

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
