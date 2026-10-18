# Fleet Delivery development stack

This stack is isolated from BMS PostgreSQL, Redis, credentials and routes. It is a Phase 1 synthetic
foundation only: no BMS mutation, live provider, driver/customer notification, COD or payout exists.

## Start

```bash
cp infrastructure/fleet-delivery/.env.example infrastructure/fleet-delivery/.env
# Replace every development password in the ignored .env file.
docker compose --env-file infrastructure/fleet-delivery/.env \
  -f infrastructure/fleet-delivery/docker-compose.yml up -d --build
curl -fsS http://127.0.0.1:4100/readyz
```

The API, PostgreSQL and Redis development ports are bound to loopback only. PostgreSQL and Redis are
published solely so host-side DB/contract tests can use the disposable stack. The migration container
must finish before API/worker start. Re-running it verifies file checksums and applies no duplicate
migration.

The API and worker run as the non-root Node user with a read-only root filesystem, all Linux
capabilities dropped and `no-new-privileges`. API responses are non-cacheable and carry restrictive
browser security headers. Readiness returns 503 during dependency loss or graceful drain; the API
shutdown timeout defaults to 15 seconds and must stay below Compose `stop_grace_period`.

## Stop

```bash
docker compose --env-file infrastructure/fleet-delivery/.env \
  -f infrastructure/fleet-delivery/docker-compose.yml down
```

Add `-v` only when intentionally deleting the disposable local Delivery database and Redis volumes.

## Authentication in Phase 1

The integration ingestion route is unavailable unless all service issuer/audience/JWKS settings are
provided. Production startup fails when the verifier configuration is absent. Do not commit a private
key or real token; tests generate ephemeral keys in memory.

## Migration recovery

Migrations are additive, checksum-pinned and serialized by advisory lock. Production rollback never
drops accepted data: stop intake/consumption, deploy the last compatible binary, then apply a reviewed
forward repair migration. Deleting volumes is only for the disposable development stack above.

## Disposable backup/restore check

After the isolated stack is healthy and migrations are applied, run:

```bash
infrastructure/fleet-delivery/scripts/verify-backup-restore.sh
```

It restores into `fleet_delivery_restore_verify`, checks migration/RLS/finance/index invariants and
removes the restored database and temporary dump. It is not a production backup scheduler and does
not establish an RPO/RTO.
