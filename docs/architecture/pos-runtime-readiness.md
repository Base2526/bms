# POS runtime readiness (100 shops)

The POS surface can be isolated from admin, AI, webhook, and storefront traffic without creating a
second application or database. The first split should deploy the same immutable `myapp-web` image
as a separate runtime pool and route only `/pos` and `/api/pos/*` to it.

DigitalOcean forwarding rules select backends by protocol and port, not URL path. Keep the managed
load balancer in front and let the existing Caddy layer perform the POS path split.

## Prepared but dormant

- `docker-compose.pos.yml` defines a `pos` service behind the explicit `pos-runtime` profile. Normal
  `docker compose up` does not start it.
- `apps/web/Caddyfile.pos-split.example` contains the future path routing. The active Caddy config is
  unchanged, so current traffic still goes to `web`.
- `GET /api/pos/health` checks the app-to-Postgres path and returns only `200`/`503`, database state,
  and latency. It exposes no host, credentials, query text, or error details.
- Migration `7.96__bms_pos_runtime_readiness.sql` indexes the hashed device token used by every POS
  request. Device `last_seen_at` writes are limited to at most once per minute per register.
- The load-test harness includes read-only `pos-session` and `pos-scan` scenarios.

## Target routing

```text
DigitalOcean Load Balancer
  -> Caddy
       /pos, /pos/*, /api/pos/* -> POS pool (same image, separate processes)
       /graphql websocket       -> WS pool
       everything else          -> web pool

POS pool and web pool -> same PostgreSQL and Redis
```

Keep PostgreSQL shared. A sale uses the common order, inventory, lot, payment, tax-document, audit,
and coupon services; splitting those tables into another database would break the transaction and
idempotency model. Redis also stays shared for fleet-wide state and cache invalidation. POS does not
currently require the WebSocket service.

## Activation checklist

1. Apply migrations through `7.96` and verify `uq_bms_pos_devices_token_hash` exists.
2. Build `myapp-web` once with an immutable tag and deploy that exact image digest to both web and
   POS pools. Different Next.js builds can reference different `/_next/static` assets.
3. Budget Postgres connections across every process. A safe starting allocation is five connections
   per POS instance; total connections are `pool max x process count`, plus workers and maintenance.
4. Start the dormant runtime and verify readiness before changing routing:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.pos.yml \
     --profile pos-runtime up -d pos
   curl --fail http://127.0.0.1:3001/api/pos/health
   ```

5. Run `pos-session` and `pos-scan` against staging. Initial targets are `p95 < 500 ms` and
   `p95 < 250 ms`, respectively, with at least 99% success.
6. Apply the Caddy routing template and reload Caddy only after the POS pool is healthy. On separate
   Droplets, replace `pos_b:3000` with private VPC addresses and allow the port only from the proxy.
7. Roll back routing to `web` first if the POS pool has a problem. Idempotency keys make retrying a
   sale safe across runtime instances.

## Later optimizations

The `/pos` route still passes through the global Apollo and Ant Design providers even though the
counter uses REST and its own CSS. A lightweight root/provider split can reduce first-load JavaScript
for older tablets, but it is independent of server isolation and is not required to activate the
runtime pool.
