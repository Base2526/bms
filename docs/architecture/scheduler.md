# Central Docker scheduler

The opt-in `scheduler` Compose service runs the 17 existing authenticated BMS cron APIs.
It owns timing and dispatch only: all SQL, tenant selection, permissions, business rules,
idempotency and `recordJobRun()` remain in the Web services. It receives no database,
AI-provider or GitHub credentials and has no host ports or Docker socket.

The service builds the `scheduler` target in `apps/web/Dockerfile`. This target uses Node 22,
the committed Web dependency lock, the existing `sharedRedisClient`, and the scheduler files;
it does not compile Next.js. The final/default Dockerfile target is still the Web application.

## Enable on an existing Cloud/self-hosted Compose deployment

1. Select one scheduler owner. Set GitHub repository **variable** `BMS_CRON_RUNNER=docker`
   before starting this service and wait for any existing BMS scheduled jobs to finish.
   `.github/workflows/bms-cron.yml` now runs automatically only when this variable is
   explicitly `github`; `docker` also blocks manual dispatch. An unset variable permits
   manual dispatch only. This is a change from the previous automatic GitHub schedule.
2. Set `BMS_CRON_SECRET` in the deployment environment to the same nonempty value used by
   Web. Set `REDIS_URL` to the same Redis deployment as Web, including its password if enabled.
   `BMS_SCHEDULER_BASE_URL` defaults to `http://web:3000`; supply an HTTP(S) origin only.
   These values are injected into the scheduler by all three Cloud Compose files.
3. With Web and Redis already running, build and start only the scheduler:

   ```sh
   docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml --profile scheduler build scheduler
   docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml --profile scheduler up -d --no-deps scheduler
   ```

   For a fresh complete stack, use the deployment's normal Compose startup command with
   `--profile scheduler`. Development uses `docker-compose.dev.yml` in place of the production
   override. Starting the profile performs real scheduled work against the configured Web;
   point development at a sandbox, never at production.
4. Inspect `docker compose ... logs scheduler`, container health, and
   `/admin/operations-schedule` run history. A configured schedule is not proof that a job ran.

Missing secrets fail startup. Redis or Web unavailability prevents dispatch and makes health
unhealthy; the scheduler waits for recovery. Readiness uses the existing `/admin/login` surface
(HEAD, no credential) as Retail Local does. A ready Web process does not prove its DB is healthy;
the actual cron response is checked separately. No secret, response body or customer data is logged.

## Schedule and failure semantics

`apps/web/scheduler/jobs.json` is the Docker schedule registry. A contract test checks exact
name/path/group parity with the existing GitHub workflow.

| Group | UTC schedule | Bangkok time | Jobs |
| --- | --- | --- | --- |
| frequent | Every 15 minutes | Every 15 minutes | 12 existing order, follow-up, shipping, menu, delivery and board-game jobs |
| daily | 20:00 | 03:00 next day | Loyalty maintenance, channel health, AI health, report digest, answer-evidence retention |

Polling is every 10 seconds with at most three concurrent requests. Startup/recovery catches up
only the latest quarter-hour and daily period, including the previous UTC day's daily slot before
20:00. It never replays a historical backlog. A first deployment can therefore run all 17 jobs
soon after startup rather than waiting for the next daily boundary.

Before any POST, one Redis Lua command claims both the job's UTC slot and an in-flight lease.
Slots survive scheduler restarts for three days. All replicas must use the **same base origin and
Redis database** so they share the same keys. Redis errors fail closed; there is no local-lock
fallback. The job lease lasts its HTTP timeout plus two minutes, and release checks its owner.
Frequent requests have a five-minute limit; daily requests have ten minutes total, including
retention pagination (at most 100 pages, validated tenant cursors). Responses are bounded to 1 MiB
per page. HTTP errors, malformed JSON, `ok:false` and top-level `error` are failures. Successful
transport is not proof that every provider is healthy: inspect the endpoint's domain run results.

There is **no automatic retry within a claimed slot**, including after a lost response. Unknown
outcomes retain the lease until expiry because aborting HTTP does not stop server work. Failures
are logged and make container health unhealthy until that process observes a later successful
attempt for the affected job. SIGTERM/SIGINT abort outbound requests and stop new dispatches.

These claims prevent ordinary concurrent/restarted dispatch, not exactly-once business execution:
Redis data loss, lease expiry while server work continues, differing origins, manual API calls,
or another scheduler can still cause another request. Existing backend transaction claims and
idempotency remain authoritative. Do not clear Redis claims to force a retry of an unknown outcome
without checking the actual job result first. Endpoint run history covers requests that reached
Web; scheduler logs/health cover failures before reaching Web.

## Diagnostics and retention

Scheduler stdout is structured JSON. Each actual attempt records its start, each HTTP page's
start/result, final outcome, UTC slot, route (without tenant cursor), duration, timeout, stage,
and lease/retry decision. Skipped claims are summarized once per job/slot/process. Readiness
changes and continuing outages are recorded with separate Redis/Web status; repeated outages
are summarized once per minute. Network diagnostics include allowlisted cause codes such as
`ENOTFOUND`, `ECONNREFUSED` and `ETIMEDOUT`; Redis authentication and command-timeout failures are
distinct. Unknown errors remain UNKNOWN instead of guessing their cause.
Allowlisted aggregate counts (processed/sent/failed/retried and similar) are logged without result
rows. Reported failed items or provider results produce a `JOB_RESULT_REQUIRES_ATTENTION` warning
even with HTTP 200. The final `warnings` count distinguishes this from a clean response; transport
success and container health do not assert that every domain item/provider succeeded.

Every dispatch has a `runId`, and every page a separate `requestId`. Web accepts only valid UUIDs
on the 17 registered cron paths for correlation. These headers grant no authority; the existing
cron-secret guard still decides whether the handler may execute. AsyncLocalStorage isolates
simultaneous requests. When `recordJobRun()` inserts history, Web returns `x-bms-job-run-id`;
on a recognized error it also returns a safe machine code such as SQLSTATE `42703`.

The evidence is stored in these locations:

| Place | Evidence | Limitation |
| --- | --- | --- |
| Docker logs for `scheduler` | Dispatch, HTTP/network/Redis failure, trace IDs, stage and remediation hint | Local driver rotates at 10 MiB x 5 files per container; retained over restart, removed with that container |
| Docker logs for `web` | Matching trace IDs, DB job-run ID, execution/history-write stage, safe code and file/line frames | Same rotation; remains available when database logging fails |
| `bms_job_runs` / `/admin/operations-schedule` | Existing job result/error plus `output.scheduler` trace metadata; failure diagnostic and stage | Requires the DB write to succeed; backup/retention is the deployment's DB policy |
| `system_logs` / `/admin/logs` | Best-effort scheduler backend failure, correlation ID, safe diagnostic and frames, including errors caught by the route | Requires a working DB; enters the existing error-log collector when that workflow is configured |

The original business return value is unchanged. For traced runs, stored success output is
`{ result, scheduler }`; failure output includes `{ scheduler, diagnostic, stage }`. Manual and
legacy untraced job output keeps its existing shape. If recording an error also fails, the
original exception remains primary and the history-write failure is logged separately.

Use the same deployment files as startup to inspect both sides:

```sh
docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml logs --since 1h scheduler web
```

Find an error's `runId`/`requestId` in both streams and open the job's history using `jobRunId`.
For example, `HTTP_500` with `serverCode: "42703"` means to inspect schema readiness and the
matching Web frames; `stage: "record-start"` means no business job started, while
`stage: "record-success"` means business work returned but recording its success failed. A lost
HTTP response never proves the business work was rolled back.

This is bounded operational evidence, not a permanent archive of every payload. New diagnostic
events never copy raw response bodies, free-form exception messages, SQL, credentials, customer
data, tenant cursors or full filesystem paths. The existing protected job-history error field
retains its original exception-message behavior. Only file/line stack frames and known codes are
added to the new log surfaces. Export/ship Docker logs before removing containers if longer
incident retention is required. Failures before Web is reachable exist in Docker logs only;
they cannot be guaranteed in a database that is itself unavailable.

## Scope and rollback

The daily error-log/Claude/draft-PR workflow remains `.github/workflows/daily-log-triage.yml`.
Its missing database/API credentials are a separate setup task; this service does not enable it.
Continuous realtime and delivery workers retain their existing roles; the 15-minute delivery
jobs are recovery polling. Retail Local's separate Compose/release manifests and its existing
in-process evidence-retention timer are unchanged by this Cloud scheduler profile.

To return scheduling to GitHub, stop the Docker scheduler, inspect any in-flight/unknown jobs,
then set repository variable `BMS_CRON_RUNNER=github`. Configure the existing GitHub
`BMS_APP_BASE_URL` and `BMS_CRON_SECRET` secrets. Never enable both owners concurrently.

## Verification

From `apps/web`: `node --import tsx --test ../../scripts/central-scheduler-contract.test.mts`.
This suite is also discovered by `npm run test:pure`. It verifies UTC boundaries, config refusal,
atomic-claim adapter behavior, multiple runners/restarts, error privacy, shutdown, pagination,
bounded concurrency, API/catalog parity and deployment selection without production calls.

For a local container integration check, build the scheduler target as `bms-scheduler:review`,
then run `node scripts/testing/scheduler-smoke.mjs` from the repository root. It creates and
removes its own network, fake Web and disposable Redis (no host ports or deployment env files),
and checks two replicas, restart deduplication, retention pagination, Redis failure and SIGTERM.
`scripts/scheduler-diagnostics-contract.test.mts` also exercises request isolation, correlation,
SQLSTATE/network classification, safe result summaries, caught backend failures and failures
of the history/system-log sinks with an in-memory query boundary. The container smoke test
checks a real HTTP 500 response carrying diagnostic headers; it never calls a production API.
