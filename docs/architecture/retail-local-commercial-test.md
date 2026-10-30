# Retail Local commercial: local database and browser checks

The helper `scripts/testing/retail-local-commercial-local.mjs` copies a **stopped PostgreSQL 16
volume** into a separate labelled Docker instance. It never starts or migrates the original shop
database. Do not rebuild the historical schema using an alphabetical SQL loop or mock tables.

Run from the repository root with Docker Desktop running (`docker desktop start` on Windows):

```powershell
node scripts/testing/retail-local-commercial-local.mjs setup bms-retail-local_postgres_data bms_local
node scripts/testing/retail-local-commercial-local.mjs db
node scripts/testing/retail-local-commercial-local.mjs license-db
node scripts/testing/retail-local-commercial-local.mjs build
node scripts/testing/retail-local-commercial-local.mjs web
```

On another workstation replace the last two `setup` arguments with its intended stopped volume and
database. The helper refuses an active source, missing volume, unowned container, or destination
volume without its matching container. Existing test instances are reused with checksum verification.
An interrupted first setup needs inspection; the helper never overwrites or deletes its volume.

- PostgreSQL: `127.0.0.1:55442/bms_retail_local_commercial_test`
- Dedicated test Redis: `127.0.0.1:56390`
- Production Web build: `http://localhost:3011`, bound to loopback
- Test-only credentials: ignored `.test-output/retail-local-commercial-integration/private-state.json`
- Synthetic users: one platform admin and one shop Administrator; existing user passwords are unchanged

Keep the state file private. Never commit/share database volumes, credentials, or customer data.
Setup generates a dedicated `BMS_SECRET_KEY` in that private state for production-mode activation
retry derivation. It does not reuse the source shop's encryption key or rewrite local env files.
The snapshot source is mounted read-only. Migrations, fixtures, role-password changes and cleanup
target the copied cluster only. Stop any host dev server before building into `apps/web/.next`.

Use `localhost` for both Next's bind hostname and browser origin: with this Next version, a
`127.0.0.1` bind combined with middleware's `localhost` rewrite can loop public-language redirects.
The browser GraphQL URL now defaults to same-origin `/api/graphql` when the build has no
`NEXT_PUBLIC_GRAPHQL_HTTP`; the upload-link default `/graphql` is not a BMS route.

## Real browser verification

In another terminal, with Playwright installed or `BMS_PLAYWRIGHT_MODULE` pointing to an absolute
`file:///.../playwright/index.mjs` URL, run:

```powershell
node scripts/retail-local-commercial-integration-browser.mjs
```

The runner uses real login, HTTP APIs, Redis and PostgreSQL without mocking responses or bypassing
authorization. It checks Thai/English at 1280/390px, consent, Lead insertion, admin status/note/follow-up
edits and reload, Bangkok time conversion, audit/revisions, staff denial, and the sixth-request limit.
Teardown removes only its recorded synthetic Lead UUIDs and their histories.

The DB suite checks a nonsuperuser `bms_app` without BYPASSRLS, direct-write denial, platform-admin
access, consent immutability, append-only history grants, and rollback when audit insertion fails.
On this exact disposable database it also executes `10.105` twice and checks that a nonempty sentinel
and all three policies survive unchanged. Run migration-reapplication checks before browser writes.

## Licensing rehearsal

With the same Web server, Chrome, Go and Playwright available:

```powershell
node scripts/retail-local-license-rehearsal-browser.mjs
```

The runner issues a Trial/code through the UI, exercises real activation/retry/signature boundaries,
converts to Paid with an audit and confirms a replacement in the detail drawer. Two separate Go
agent roots generate fresh identities and signed evidence; the test client forwards that evidence
to loopback HTTP. The agent's HTTPS requirement remains intact. It checks 401/403, confirmation,
capacity rejection, failed-transfer rollback, four language/viewport combinations, resolution actor,
and subsequent source/destination heartbeats. It removes only its own synthetic license rows in
`finally` and restores the synthetic user's language. No payment or messaging provider is called.
Each run clears only the two synthetic identities' login counters in the labelled test Redis,
then reuses sessions from real login across viewport contexts; production auth limits are unchanged.
Raw codes/tokens never enter logs/screenshots. Host fixture private keys remain only in ignored
test output; do not share that directory wholesale. The sanitized `license-rehearsal-result.json`
reports six groups and cleanup. DB licensing contracts separately cover concurrent approvals.

## Stop and resume the environment

For the shared audio/diagram guide, `web-local` starts the same build on `localhost:3012` in
Retail Local mode, alongside cloud-mode `web` on 3011. Its host status directory is an intentionally
unavailable path under ignored output; the guide must work even when host status cannot be read.
Run `node scripts/retail-local-guide-browser-smoke.mjs` with Chrome/Playwright available.
The restored baseline must contain its existing `bms_local_installation` row. The runner temporarily
binds only the synthetic login user to that tenant and restores its original tenant/language in
`finally`. It never updates the singleton, activates a license or runs backup. Stop both Web processes
before stopping the database. See `scripts/README.md` for audio regeneration and contract checks.

Stop the Web terminal with Ctrl+C, then run:

```powershell
node scripts/testing/retail-local-commercial-local.mjs stop
```

This stops only the labelled test PostgreSQL/Redis containers. It preserves the volume and leaves
Docker Desktop and other projects alone. `setup` restarts the isolated environment for another run.

## Evidence and limits

On 30 October 2026 the copied baseline had 315 public tables and migrations through `10.25`.
The authoritative runner upgraded it through `10.105`. DB checks passed 4/4; real browser checks
passed six groups (authorization, four language/width workflows, consent/rate limiting).
Nine synthetic leads were cleaned after each full browser run. Logs and screenshots are in
`.test-output/retail-local-commercial-integration/`.

The licensing rehearsal additionally passed six groups, and its DB suite passed 3/3. See the
[dated rehearsal report](../business/retail-local-commercial/rehearsal-2026-10-30.md).
This verifies the Lead flow and licensing control plane using simulated hosts. Physical replacement,
host HTTPS delivery, backup/restore reconciliation, peripherals, power failure, the WebSocket gateway,
deployment and GA need separate acceptance.
