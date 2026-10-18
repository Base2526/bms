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

For local synthetic Customer/Driver scenarios, prefer the repository bootstrap command. It generates
an ephemeral EdDSA key under the ignored `.local/fleet-delivery/` directory, injects only the public
JWKS into the API container, starts Compose, waits for readiness and never prints a bearer token:

```bash
cd ../..
npm run dev:bootstrap
npm run dev:scenario -- customer-search
npm run dev:customer-flow -- <customer-search-scenario-id>
npm run dev:customer-dispatch -- <customer-search-scenario-id>
npm run dev:customer-complete -- <customer-search-scenario-id>
# or exercise failure and return instead
npm run dev:customer-return -- <customer-search-scenario-id>
npm run dev:scenario -- customer-delivery
```

`customer-search` prepares an exact synthetic BMS order and a one-hour, purpose-bound customer
grant. The protected mode-`0600` activation file contains the raw short-lived token; the database
contains its SHA-256 digest only. `dev:customer-flow` uses the same platform-neutral client core a
React Native Android debug shell calls, requests a motorcycle quote without sending
tenant/branch/order authority, then confirms the Delivery. It prints IDs and calculated amounts,
never the token.

To run the UI flow instead of `dev:customer-flow`, leave the generated scenario unused, connect an
Android emulator/device, map its loopback to the API, and launch the separate Customer App:

```bash
adb reverse tcp:4100 tcp:4100
cd apps/fleet-delivery-customer
npm ci
npm run android
```

Copy only `customerActivation.apiBaseUrl`, `.accessToken` and `.expiresAt` from the protected
scenario file into the Debug screen. After confirming the Delivery in the app, run
`npm run dev:customer-dispatch -- <scenario-id>` and refresh status. Continue with
`dev:customer-complete` or `dev:customer-return`, then refresh again. The runner—not the Customer
App—uses service authority for synthetic service transitions and driver authority for journey
actions. The customer projection never returns driver identity or coordinates. These runners do not
send provider notifications, upload image bytes, contact a person or move money. The release variant
cannot activate a synthetic session.

The `customer-delivery` Driver scenario walks the real local APIs through merchant configuration, synthetic BMS order intake,
an explicit versioned motorcycle/package requirement, quote, immutable delivery creation,
payment/merchant-ready transitions, capacity-aware dispatch and one motorcycle offer.
It writes the Debug Driver activation values to the mode-`0600` file reported as
`activationFile`. Open that local file to paste `driverActivation` into the Debug app; do not share
or commit it. The token lasts one hour and the pending offer lasts five minutes. This Driver scenario
still reports `customerSurfaceAvailable: false`; use the separate `customer-search` scenario for the
Customer client flow.

Remove the exact scenario and its local activation file when finished:

```bash
npm run dev:cleanup -- <scenario-id>
```

All three commands reject missing/example passwords, use loopback host ports only, and refuse cleanup
unless the manifest tenant starts with `tenant:dev-`. Re-running bootstrap reuses its local key so an
active scenario is not invalidated. Delete `.local/fleet-delivery/` only after cleaning its scenarios.

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

It creates `fleet_delivery_restore_verify` (refusing an existing database or a name matching the
source), restores the dump, and checks migrations through `0017` plus
RLS/finance/index/post-pickup/amount/terminal invariants, and
removes the restored database and temporary dump. It is not a production backup scheduler and does
not establish an RPO/RTO.
