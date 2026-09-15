# ADR 001: transactional outbox and scoped invalidation events

- Status: Accepted; contract, migrations `9.70`–`9.71`, continuous dispatcher and clients implemented; live recovery/load verification pending
- Date: 2026-09-10
- Scope: BMS domain realtime delivery

## Context

BMS currently publishes a small number of GraphQL subscription payloads directly to Redis after a
write. Direct Pub/Sub is fast and works across web/WS instances, but it cannot guarantee that a
committed business mutation will eventually produce an event. A process can die after PostgreSQL
commits and before Redis accepts the publish. Publishing inside a transaction has the opposite
failure: clients can observe a state that later rolls back.

The WebSocket gateway cannot query PostgreSQL. Business services and PostgreSQL must remain the
source of truth, and a Redis/WS outage must not prevent core transactions from committing.

## Decision

Use a PostgreSQL transactional outbox for BMS domain invalidations, a dispatcher owned by the web/
worker side, scoped Redis topics, and client refetch of existing authoritative APIs.

```text
tenant transaction
  -> business rows + outbox row commit atomically
  -> dispatcher claims committed outbox rows
  -> Redis publish (and later bounded stream append)
  -> WS authorizes audience and forwards safe envelope
  -> client deduplicates/batches and refetches GraphQL/REST truth
```

Delivery is at least once. Duplicate publication is expected after a dispatcher crash between Redis
publish and outbox acknowledgement. Stable `eventId`, optional `aggregateVersion`, bounded client
deduplication, and authoritative refetch make duplicates harmless. We will not describe this as
exactly once.

## Event envelope

`packages/realtime` owns the only event type union, schema version, validator, topic builders,
permission metadata, safe logging projection, fixtures, and publish API.

```ts
type RealtimeEvent = {
  eventId: string;
  eventType: RealtimeEventType;
  schemaVersion: 1;
  tenantId: string;
  locationId?: string;
  userId?: string;
  entityType: RealtimeEntityType;
  entityId: string;
  aggregateVersion?: number;
  occurredAt: string;
  actorId?: string;
  correlationId?: string;
  reason?: RealtimeReason;
  data?: Record<string, boolean | number | string | null>;
};
```

Tenant, branch, user, actor, and correlation scope comes from server context or rows locked by the
service. Request bodies and model output never supply authorization scope. `reason` is a closed code,
not free text. `data` is allowlisted per event type and kept below the outbox payload ceiling.

Forbidden in every event and safe-log projection: names, phones, addresses, emails, tokens, payment
credentials/details, message bodies, attachment/file IDs, prescription/evidence IDs, clinical notes,
structured health answers, medication suggestions, and raw mutation arguments.

## Topics and replay shape

Pub/Sub topic builders are versioned and scoped from the start:

```text
bms:rt:v1:tenant:{tenantId}
bms:rt:v1:tenant:{tenantId}:location:{locationId}
bms:rt:v1:tenant:{tenantId}:user:{userId}
bms:rt:v1:tenant:{tenantId}:location:{locationId}:device:{deviceId}
```

IDs are opaque server identifiers, never secrets or PII. User events use only the user topic. Branch
events use the branch topic. Tenant events use the tenant topic. A publisher does not also broadcast
the same envelope to broader topics unless the event metadata explicitly defines multiple audiences;
this avoids duplicate fan-out by construction.

Redis Streams replay, if enabled later, uses one bounded tenant stream and a cursor returned to the
client. The gateway filters replay using the same ticket permission/location metadata as live
delivery. A missing/trimmed cursor is a gap and forces full refetch. Polling stays enabled until this
behavior and recovery load are proven.

## Proposed outbox schema

A new ordered, idempotent migration will create `bms_realtime_outbox` with:

| Column | Purpose |
| --- | --- |
| `id BIGSERIAL PRIMARY KEY` | efficient claim order |
| `event_id UUID NOT NULL UNIQUE` | stable delivery/dedup identity |
| `tenant_id UUID NOT NULL` | mandatory tenant ownership and RLS scope |
| `location_id UUID NULL` | optional branch/location audience derived by server |
| `user_id UUID NULL` | optional user audience derived by server |
| `event_type TEXT NOT NULL` | validated against the shared closed union before insert/publish |
| `schema_version SMALLINT NOT NULL` | payload evolution |
| `entity_type TEXT NOT NULL`, `entity_id TEXT NOT NULL` | invalidation target |
| `aggregate_version BIGINT NULL` | stale/out-of-order detection where the aggregate has a real version |
| `safe_payload JSONB NOT NULL DEFAULT '{}'` | per-event allowlisted data only |
| `occurred_at TIMESTAMPTZ NOT NULL` | business event time |
| `available_at TIMESTAMPTZ NOT NULL` | initial delivery/retry time |
| `claimed_at TIMESTAMPTZ NULL`, `claim_token UUID NULL` | crash-safe lease |
| `published_at TIMESTAMPTZ NULL` | successful dispatcher acknowledgement |
| `attempts INTEGER NOT NULL DEFAULT 0` | retry/dead-letter visibility |
| `last_error TEXT NULL`, `failed_at TIMESTAMPTZ NULL` | bounded, redacted failure information |
| `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` | retention/audit operations |

The table has `CHECK (pg_column_size(safe_payload) <= 16384)`, positive schema/attempt checks,
foreign keys that do not cascade-delete delivery history unexpectedly, a partial claim index on
`(available_at, id) WHERE published_at IS NULL AND failed_at IS NULL`, and indexes for tenant/event
inspection and retention.

It is tenant-owned, has forced RLS, a tenant policy using `bms.tenant_id`, and explicit `bms_app`
grants. Business services call `enqueueRealtimeEventInTx(client, event)` only with the same client
and open tenant transaction that changes the aggregate.

Cross-tenant dispatch does not weaken RLS or give `apps/ws` a database connection. The migration
provides narrowly granted, fixed-`search_path` `SECURITY DEFINER` claim/ack/nack functions owned by a
locked migration role. They expose only unpublished safe envelopes and require an internal worker
credential at the route/worker boundary. Ordinary tenant code cannot scan another tenant's outbox.

## Dispatcher algorithm

1. In a short transaction, claim up to `REALTIME_OUTBOX_BATCH_SIZE` eligible rows with
   `FOR UPDATE SKIP LOCKED`, set a unique claim token/time, and increment `attempts`.
2. Commit the claim before network I/O.
3. Validate each envelope again and publish through the shared scoped API. Redis network calls never
   run inside a business transaction.
4. Acknowledge using `(event_id, claim_token)` and set `published_at`.
5. On failure, clear the claim, set a redacted `last_error`, and move `available_at` by bounded
   exponential backoff plus jitter. After the configured maximum, set `failed_at` for operator
   visibility; do not silently discard it.
6. Expired leases are claimable again. A crash after publish but before acknowledgement republishes
   the same `eventId`, which consumers deduplicate.

Published rows are retained for an initial seven days; failed rows for at least thirty days. Cleanup
is a separately named, cron-authorized, multi-instance-safe job with job-run visibility. Final values
must be confirmed from observed event rate and recovery needs before migration implementation.

## WebSocket authentication decision

The browser does not send its long-lived admin cookie as the gateway's complete authority. An HTTP
endpoint, using the existing HTTP session path, mints a short-lived WS ticket after checking:

- JWT and expiry;
- Redis session `jti` revocation;
- fresh account/role/tenant/session-version state;
- signed acting-tenant context;
- current permissions and allowed branch IDs.

The ticket includes an audience restricted to the WS gateway, a short expiry, session ID, context
version, user/tenant/acting-tenant IDs, permission/location snapshot, and a unique ticket ID. It
contains no PII. The gateway verifies it with a shared Next-independent helper, fails closed when
Redis is unavailable, schedules connection expiry, and periodically checks session/context version.
Changing acting tenant or logging out increments/revokes the context version and disposes the browser
socket. This gives `apps/ws` HTTP-equivalent authorization without PostgreSQL access.

POS and future public/customer sockets use distinct ticket audiences minted by their existing
authenticated HTTP surface. They cannot impersonate an admin ticket or choose a branch in connection
parameters.

## Consequences

Positive consequences:

- a committed BMS change eventually becomes publishable even if Redis is temporarily down;
- rollback produces no event;
- multiple dispatchers and WS instances are safe;
- small invalidations keep business state behind existing authorization and query code;
- replay can be added without redesigning the event identity or client contract.

Costs and limitations:

- every instrumented transaction gains an outbox insert;
- dispatcher lag and failed rows become an operational responsibility;
- user/location permission snapshots are short-lived rather than instantly DB-backed, so context
  version revocation is required;
- Redis Streams add memory and cursor complexity and therefore are deferred until live Pub/Sub plus
  polling is stable;
- legacy community events outside tenant-owned BMS data need a separate migration plan rather than
  being forced into the tenant outbox.

## Rejected alternatives

- **Publish directly after commit only:** leaves an unrecoverable commit/publish crash window.
- **Publish before commit:** exposes rolled-back state.
- **Let `apps/ws` read PostgreSQL:** violates the service boundary and multiplies database pools as
  the gateway scales.
- **Put business state in event payloads:** creates a competing source of truth and increases leak/
  schema-drift risk.
- **One global topic plus `withFilter`:** wakes unrelated tenants/users and makes a filter bug a data
  isolation incident.
- **Remove polling immediately:** Pub/Sub has no replay and cannot recover missed events.
- **Claim exactly-once delivery:** not achievable across PostgreSQL and Redis without a distributed
  transaction; at-least-once plus idempotent reconciliation is the honest contract.
