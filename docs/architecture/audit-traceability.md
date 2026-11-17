# Audit traceability

This page describes what the audit timeline can prove. It is not a record of every page view or
click. Business records and their domain ledgers remain authoritative; audit rows identify the
decision, actor and target, while revision snapshots show selected before/after states.

## Event sources

| Source | Purpose | Durability |
| --- | --- | --- |
| `bms_audit_log` | Tenant business decisions, approvals, AI tool attempts | Required service writes belong in the business transaction; legacy `audit(ctx)` is best-effort |
| `bms_security_events` (`10.122`) | Login, logout, password reset, sensitive reads | Successful login and sensitive reads require a committed event; denied attempts and logout are best-effort so logout is never blocked |
| Domain ledgers and `_revisions` | Exact stock/money/operational facts and selected previous row snapshots | Follow each domain transaction and permission contract |

The admin `/admin/audit` timeline unions tenant business and security events with cursor pagination.
It searches at the server, including older rows. A tenant Administrator can read only the acting
tenant. A database-verified platform admin may switch to platform-global security events with
`tenant_id IS NULL`; ordinary tenant staff cannot request that scope through GraphQL.
When a platform admin has not entered a tenant, the timeline uses global security events rather
than the application's default-tenant fallback. Tenant events require an actual tenant context.
Clicking a row with a verified actor UUID opens a paged event-flow dialog for that actor in the
current tenant or platform scope. The connected nodes show reverse chronological order, not a
causal chain. Email-only legacy rows and anonymous/system events cannot be opened as a person's
history because their identity cannot be verified from that row.
The dialog renders at most 30 events at once. Previous/next controls retain only page cursors in
the client, and each page is fetched without Apollo caching, so a long history does not grow the
timeline DOM or retain every event in browser memory.
In the local synthetic browser benchmark (`scripts/audit-actor-flow-perf-smoke.mjs`, 40 pages of
30 events), the old append-all dialog reached 1,200 timeline nodes and about 28,000 page DOM nodes;
the last five page transitions took a median of 978 ms at 1440 px and 890 ms at 390 px. With page-only
rendering, the dialog stays at 30 timeline nodes and about 1,000 page DOM nodes; the last five
transitions took 112 ms and 98 ms respectively. At 4× CPU throttling, the same last five transitions
took 480 ms and 418 ms. The original timing run did not intercept background WebSocket traffic;
the timing comparison is indicative, while the bounded node count is deterministic. All runs use
mocked API responses and include browser interaction overhead; none measures PostgreSQL latency or
production data.

## Long-history capacity

The actor flow uses exact UUID identity and keyset cursors; it never requests a total row count or
uses `OFFSET`. With an actor and no free-text query, `listAuditTimeline()` reads at most `limit + 1`
IDs from each of four indexed streams (structured business actor, raw UUID-text actor,
`user:<UUID>` actor and security actor), then resolves display fields and merges them. The generic
timeline filters and limits each business/security source before merging. Migration `10.122`
supplies the tenant/time and structured actor/time indexes; `10.123` supplies the legacy text-actor
index, including for services that still write only the text actor field. On an in-memory
PostgreSQL fixture of about 250,000 business and 25,000 security rows spread across ten years, the first
actor page used index scans of 31 rows per active stream, and a cursor 9.5 years back read 12–13
rows per stream. This proves the SQL shape on that fixture, not production latency or ten-year
storage capacity. A one-million-row in-memory attempt terminated without a result on this machine;
large-scale proof needs a disposable PostgreSQL instance and a production-shaped data distribution.

This is **not yet a ten-year storage guarantee**. Both audit tables remain unpartitioned, there is
no approved retention/archive policy, and broad substring search (`ILIKE '%…%'`) may inspect a
large date range. No audit rows are purged by this feature. The `5.1` tenant foreign key still
deletes a tenant's `bms_audit_log` rows on tenant deletion; the platform-global deletion event does
not preserve that history. Before claiming ten-year readiness,
measure daily event volume, `pg_total_relation_size` for each table and index, actor-flow and broad
search p95 query plans/latency, and backup/restore time on a disposable copy sized to the projected
ten-year volume. Set retention/legal-hold requirements before designing monthly partitions or a
readable cold archive. Partitioning the existing `BIGSERIAL` primary-key tables requires a planned
table transition, not a casual `ALTER TABLE`; keep old IDs and tenant isolation queryable during it.

## Implemented coverage

| Flow | Evidence | Boundary |
| --- | --- | --- |
| Staff, mobile and legacy login; denied password/social login; password reset; logout | `bms_security_events` | Successful login and reset are required; denied login and logout are best-effort |
| Platform drill-down and test-shop deletion | Global `bms_security_events` | Entry is required before setting the acting-tenant cookie; deletion event commits with the deletion; exit is best-effort |
| Staff account and role administration | `bms_audit_log` | Existing service transactions; new team-account rows carry `actor_user_id` |
| Standalone order create/reorder, payment submission and slip verification | `bms_audit_log` | Same service transaction as the business write across REST, GraphQL and AI callers |
| POS shift open/close and selected catalog/stock writes | `bms_audit_log` | Same service transaction; duplicate resolver rows removed |
| Report, pharmacy evidence, POS shift and bank-reconciliation file downloads | `bms_security_events` | Required after permission check and before streaming; metadata stores the internal target identifier |
| AI tool attempts | `ai.tool_call` in `bms_audit_log` | Redacted best-effort attempt evidence; a committed business mutation is proven by its domain event or ledger |

Other existing domain services already append audit rows within their transactions. Older resolver
`audit(ctx)` calls and routes not listed here remain best-effort or may have no event; treat absence
of a timeline row as **unknown**, never proof that no action occurred. This release does not claim
page-view, button-click, or comprehensive sensitive-read tracking. Extend coverage at each domain
service boundary, remove duplicate resolver events, and add a transaction/denial test for that flow.

## Identity and correlation

New `bms_audit_log.actor_user_id` stores the authenticated staff UUID where available. `actor_kind`
distinguishes staff, customer, AI, system and provider actors. The old text `actor` stays for
compatibility and historical display. Old email-only rows must not be assigned a UUID by matching
today's email: an address can change or be reused. Old UUID-text and `user:<UUID>` rows may be
matched by the exact ID.

Customer AI tool events contain only an internal `conversationId` in metadata; raw channel customer
references, prompts, model arguments, PINs and bearer tokens must never enter audit metadata.
The conversation ID links the customer message, AI tool attempt and any domain action under the
existing tenant/inbox permissions. `bms_security_events.session_ref` is SHA-256 of an opaque random
session identifier, never the identifier itself. `request_id` and `event_key` are available for
new service integrations; neither may be supplied as authority by a client.

## Write rules

- Use `insertAuditInTx(client, ...)` for a business mutation whose audit must commit or roll back
  with the change. Use one event for one decision, at the service layer shared by REST and GraphQL.
- Keep `audit(ctx, ...)` only for diagnostic/attempt events that have no authoritative business
  mutation. It still swallows insert failures, so it cannot prove a business change happened.
- A successful privileged login and sensitive file response must wait for `recordSecurityEvent()`.
  Failed anonymous login attempts and logout use the best-effort variant; their absence is not
  proof that no attempt occurred.
- `10.122` revokes `UPDATE`/`DELETE` on `bms_audit_log` from `bms_app`. The runtime `app` role is
  currently a database superuser in some deployments, so the table is not tamper-proof against that
  role. Reducing runtime DB privileges is a separate deployment prerequisite for that claim.

## Verification and rollout

Apply `10.122` before deploying code that reads or writes the new columns/table. Recheck migration
filename collisions before release; migration identity is immutable after application. Export
`schema.graphql` in the same change. Test tenant RLS, grants, repeated migration application,
cross-tenant denial, rollback on audit failure and cursor stability on a disposable restored DB.
Pure tests and TypeScript cannot establish deployed database state. Historical unlogged actions
cannot be reconstructed and should remain marked as uncertain.
