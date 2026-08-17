# Multi-instance readiness

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Forward-looking scale plan: [admin-scale-readiness.md](admin-scale-readiness.md)

> POS-specific runtime split: [pos-runtime-readiness.md](pos-runtime-readiness.md)

Branch `feat/multi-instance-readiness` (2026-08). **Done: removing per-instance state so running more
than one `web` (or `ws`) container is safe. Not done: actually deploying replicas/a load balancer** —
every default still preserves single-instance behavior exactly; nothing here requires a new env var to
keep working as before. `admin session` revocation, `AI conversation state`, `scheduleNewJobs()`, and
`releaseExpiredOrders()` were checked and were already multi-instance-safe before this pass.

## What changed

- **Postgres pool has an explicit ceiling** (`lib/db.ts`). It previously had no `max`, so it fell back
  to `pg`'s default of 10 per process — harmless with one instance, but total connections become
  `POSTGRES_POOL_MAX × replica count` once scaled, and exceeding Postgres's `max_connections` fails
  every instance at once rather than degrading gradually. Now configurable via `POSTGRES_POOL_MAX` /
  `_IDLE_TIMEOUT_MS` / `_CONNECT_TIMEOUT_MS` (**default is still 10** — must be lowered before adding
  replicas). Added `pool.on("error")` too: a pool-level error (Postgres restart, an idle connection cut
  by the network) never surfaces at any individual query — without a listener, Node treats it as an
  unhandled `'error'` event and kills the process.
- **Rate limiting moved to Redis** (`lib/bms/rateLimit.ts`). It was an in-process `Map`, so the
  effective limit was `configured value × instance count`. The dangerous case isn't the 7 webhook call
  sites but `auth:*` (2 call sites in `resolvers.ts`'s `enforceAuthRateLimit`) — login brute-force
  protection weakens directly with instance count. The Redis fallback is deliberately **not
  fail-open**: if Redis is unreachable, it falls back to the old in-process `Map` (i.e. per-instance,
  same as before), not to no limiting at all — unlike `lib/cache.ts`, which can fail open because a
  cache miss just costs latency, whereas a fail-open rate limiter disables protection for the whole
  fleet exactly when Redis has a problem. `rateLimit()` is now `async` (9 call sites updated).
  `enforceAuthRateLimit()` fires both counters via `Promise.all`, never short-circuiting — otherwise
  someone who only rotates IPs would never accumulate on the identity-side counter.
- **Files moved behind a storage driver** (`lib/storageDrivers/`). The part that breaks hardest without
  this fix isn't upload — it's *reading the file back on a later request*, which a load balancer can
  route to any instance: slip OCR (`payments.ts`), report downloads, email attachments
  (`reportEmail.ts`), and image serving (`/api/files/[id]`). All four used to build
  `path.join(STORAGE_DIR, relpath)` themselves; they now call `readStoredFile()` /
  `statStoredFile()` / `openStoredFileStream()` from `lib/storage.ts` — **no call site should ever
  assemble that path itself again**. `STORAGE_DRIVER=local` (default) is byte-for-byte the old
  behavior; `s3` works with AWS S3, R2, MinIO, or GCS's S3-compat endpoint. `relpath` in the `files`
  table is the driver-agnostic key (still `YYYY/MM/DD/<ts>-<name>`), so moving to S3 is just copying the
  existing file tree into a bucket — no DB migration needed.
- **The S3 driver is hand-written, no new dependency** (`storageDrivers/s3.ts`) — SigV4 via
  `node:crypto` + `fetch`, implementing only the 3 verbs the system actually uses (PUT / GET including
  ranged / HEAD). Its `writeStream` buffers the whole payload before a single-part signed PUT, because
  that signing needs the payload hash upfront (files on this path are avatars/attachments, not bulk —
  a future large-file case would need multipart). The local driver still streams for real.
- **Redis password is opt-in** (`docker-compose.yml`): not setting `REDIS_PASSWORD` behaves exactly as
  before; setting it makes the container enable `requirepass` itself (and `REDIS_URL` must then be
  updated to `redis://:<password>@redis:6379` by hand). Uses `$${VAR:+...}` so the **container's own
  shell** expands it, not Compose at parse time — verified both ways (unset → `PING` returns `PONG`;
  set → `NOAUTH` until authenticated).
- **Cron jobs that used to "read, then act" now claim before acting** (2 of them). This bug was asleep
  with a single instance, because an external cron hitting one URL only ever reaches one instance per
  tick — but it wakes up the moment (a) a new tick overlaps a still-running one, (b) the admin "run now"
  button races the cron, or (c) a scheduler fans out to multiple instances:
  - `runDueFollowups()` (`followups.ts`) used to `SELECT` due jobs, then loop and send — two overlapping
    readers would send the same customer message twice. Fixed with
    `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING ...`, claiming by pushing
    `next_run_at` forward as a lease (`JOB_LEASE_MINUTES = 5`) rather than changing `status` — the
    table's CHECK only allows PENDING/SENT/STOPPED/FAILED (no RUNNING), so this avoided a schema
    change entirely. A process dying mid-job just means the lease expires and the job becomes due again
    (existing retry behavior, just delayed 5 minutes).
  - `runScheduledDigests()` (`reportDigest.ts`) used to check `last_period_key` from a prior `SELECT`
    before sending — two readers would both see the stale value and the shop owner would get the digest
    twice (email+Slack+LINE). Fixed with a compare-and-set:
    `UPDATE ... WHERE last_period_key IS DISTINCT FROM $key`, checking `rowCount` before sending. If
    sending then throws, `last_period_key` is reverted back to its previous value (guarded by
    `= $key` so it can't clobber a newer claim), preserving the existing behavior that the next cron
    tick can still retry.
  - `scheduleNewJobs()` needed no change — it already has
    `ON CONFLICT (conversation_id, rule_id) WHERE status='PENDING' DO NOTHING` backed by the unique
    partial index from migration `7.52` (the only thing that can duplicate is a wasted AI
    intent-classification call, not incorrect data). `releaseExpiredOrders()` needed no change either —
    it has used `FOR UPDATE SKIP LOCKED` since it was written.
  - **Known, accepted gap**: `runCarrierTrackingSync()` (`shipping.ts`) still reads then calls the
    carrier API — two concurrent runs will call the carrier API twice (wasted quota) but won't corrupt
    data, because `syncShipmentLive()` already re-locks and never regresses status. Left unfixed
    because a lease-style fix would need to move `carrier_last_synced_at` (a field staff see on screen)
    at claim time, which would show "synced" before it actually happened — a real fix needs a separate
    claim column.
- **`ws` never touched Postgres at all — `apps/ws/src/db/` was deleted entirely.** While hunting for a
  second connection pool (worried that scaling `ws` would multiply connections), this folder turned out
  to open a real `pg.Pool` with no `max` either — but nothing imported it, and `pg` wasn't even in
  `apps/ws`'s `dependencies`; importing it would have crashed at runtime in the container immediately
  (every `ws` subscription comes from Redis pub/sub alone). `DATABASE_URL` was also removed from the
  `ws` service in both compose files, since no code reads it and its hardcoded `app:app` value was
  misleading. Side effect: `ws` can now scale horizontally with no further changes.
- **`lib/upload-helpers.ts` was deleted** — dead code with no caller (`saveUpload`/`saveUploads`) that
  hardcoded `/app/storage`, wrote files directly, and returned a `/uploads/<name>` URL that **no route
  even serves** (the real path is `/api/files/[id]`). Leaving it in place would have been a standing
  shortcut for someone to accidentally import and bypass the new storage driver.
- **A stale line in `docker-compose.dev.yml` that broke the dev stack — unrelated to this work, found
  while confirming "does single-instance still behave normally"**: the `web` service ran
  `test -f ../../packages/social-queue/node_modules/.package-lock.json || npm --prefix
  ../../packages/social-queue ci && npm run dev`, but `packages/social-queue` was deleted in the earlier
  "Redis infrastructure hardening" pass without removing this line. Simulating the shell chain confirmed
  `npm run dev` was **never actually invoked** on any `web` container recreate/restart, because
  `npm --prefix` against a missing path exits 1 and short-circuits the `&&` before reaching `npm run
  dev` (confirmed by exit code, not guessed). Now it just checks `web`'s own `node_modules` and runs
  `npm run dev` directly. Does not affect production (`docker-compose.prod.yml` builds via the real
  Dockerfile and never referenced `social-queue`).

## Verification (not just `tsc`)

- `scripts/infra/multi-instance-contract.test.mts` passes 11/11 against real Redis + **real MinIO**
  (docker): local round-trip/range/stream-hash/missing-file/path-traversal, Redis counter + non-sliding
  TTL + the Redis-down fallback still blocking, and S3 round-trip/range/HEAD/stream-hash. The Redis/S3
  cases **SKIP (not pass)** if their env vars aren't set. Requires `--test-force-exit` or ioredis leaves
  a handle open and the runner never exits.
- Both SQL claim patterns were verified against real Postgres 16 (temp tables in a container, not the
  dev DB): lease + `FOR UPDATE SKIP LOCKED` — session A holds an open transaction claiming 3 rows;
  session B running concurrently gets **0 rows** (not a lock wait), and still gets 0 after A commits
  because the lease hasn't expired yet. Digest CAS: firing twice gives `UPDATE 1` then `UPDATE 0`.

## Not yet done / known gaps

- A dedicated POS runtime is now **prepared but dormant**: `docker-compose.pos.yml` defines an
  opt-in `pos-runtime` profile, `Caddyfile.pos-split.example` contains future path routing, and
  `/api/pos/health` provides readiness. No active Caddy route or production replica was changed.
  Migration `7.96` indexes device-token authentication and POS `last_seen_at` writes are throttled.
  Activate only through the checklist in [pos-runtime-readiness.md](pos-runtime-readiness.md).

- `STORAGE_DRIVER=s3` has not been exercised through the real app in a browser (only verified at the
  driver-contract level — no real slip has gone through `/checkout` and back through OCR on S3 yet).
- No migration script to move existing files into a bucket (`mc mirror` / `aws s3 sync` works by hand
  since keys are unchanged).
- No replicas/load balancer have been activated (deliberate — the optional POS service remains behind
  an explicit Compose profile and the active Caddy config still routes POS through `web`).
- `app/api/admin/queue/db/route.ts` is leftover dead code from removing the social queue: it queries a
  `social_posts` table that no longer exists, no page calls it, it opens a second per-instance `Pool`
  with no `max`, and its guard (`if (expected && ...)`) means **anyone can call it if `ADMIN_TOKEN` isn't
  set**. Left alone as out of scope for this pass, but should be deleted.
