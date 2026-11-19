# System logs and incident triage

> Entry point: [CLAUDE.md](../../CLAUDE.md) · [System Health](system.md) ·
> [Support diagnostics](../business/support-diagnostics.md) ·
> [Daily log triage](../../scripts/bms-log-triage/README.md)

`/admin/logs` reads `system_logs` through the platform-admin-only `GET /api/logs` route. Its
`level` and `status` filters are independent. `level=error` selects entries logged at error
severity; `status=error` selects a structured event status, which can also describe a client failure.
The page is paginated (at most 200 rows per request), so one visible page is not the full history.
Use a date range and group by cause before treating the number of rows as distinct incidents.

GraphQL resolver failures and the Apollo request plugin can write separate diagnostic records for
one request (subject to log throttling). Explicit client and authorization codes (`UNAUTHENTICATED`,
`FORBIDDEN`, `BAD_USER_INPUT`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, GraphQL parse/validation
and other expected codes in `graphql/expectedErrorCodes.ts`) use `level=warn`. Unexpected failures
still use `level=error`.
The resolver wrapper records operation, actor and argument **keys** only; it never writes argument
values such as phone numbers, bank accounts, passwords or customer text. The shared logger redacts
credentials, contact data, account-sized numbers and sensitive metadata keys before stdout,
`system_logs` or Slack. `system_logs.created_by` remains a legacy integer column: UUID actors stay
in redacted `meta.userId`, rather than being misparsed into an unrelated integer.

Authenticated client batches to `POST /api/logs` are limited to 256 KiB and 50 records. Actor and
tenant are refreshed from the server, and each row is marked `meta.source=client`; client-submitted
errors do not trigger Slack. A failed insert returns a non-success response with `insertedCount`.
The platform-admin delete API requires an explicit confirmation header and writes a `log-admin`
deletion record in the same transaction. Those deletion records cannot be removed through the API.
Log detail and deletion accept both integer and legacy UUID row IDs. Log filters reject malformed
IDs, dates and pagination values instead of broadening a query. Legacy GraphQL resolver `console`
calls that printed customer input or returned rows have been removed; fallback error output is
sanitized before reaching stdout.
The Redis request metric records every GraphQL error response, including expected ones; its error
rate is a request-outcome metric, not a count of server faults. Wrapped REST routes use a static
`rest:METHOD:/api/...` metric label, but routes without `withRouteErrorLog()` are not covered.

The daily collector in `scripts/bms-log-triage/collect-error-logs.mjs` selects `level=error`, groups
and redacts every exported field, labels client/server origin and bounds the report. The report is
untrusted input to its model workflow; text inside a log cannot authorize an action. Its workflow
opens only a draft PR for review. It does not equate
`status=error` with a server failure. A locally copied/restored database and the live deployment
can have different log IDs, counts, timestamps and schema state; record which source was inspected
before comparing trends or claiming a production fix.

## Triage sequence

1. Set the time window and inspect `level`, `status`, category, route, platform and operation name.
   Group repeated messages or error codes. A request may have both a resolver and an Apollo row.
2. For `UNAUTHENTICATED`/`FORBIDDEN`, verify the session, role and permission path. A normal denial
   is not a server outage. For malformed GraphQL JSON, check the HTTP status: empty or malformed
   JSON now returns `400 BAD_REQUEST` before Apollo parsing.
3. For mobile `Network request failed`, correlate nearby operations, device connectivity and the
   configured API origin. Several unrelated operations failing at the same instant can indicate a
   client or emulator network problem; it does not identify one broken resolver.
4. For `column does not exist` or `relation does not exist`, compare the deployed service version
   with migration history on that same database. A restored copy having a column does not prove it
   exists in production. Do not rewrite an applied migration to repair a rollout mismatch.
5. For process errors such as `EADDRINUSE`, inspect which service owns the port and deployment
   startup state. Do not hide a process crash by downgrading its log level.
6. Reproduce a confirmed code defect at the narrow boundary, run the relevant contract tests and
   `npm run gate` from `apps/web`, then verify the deployed behavior separately after release.

Use read-only, parameterized queries or the authenticated admin API for inspection. Do not copy
raw tokens, customer data, request bodies or database credentials into an issue or AI prompt.
`/admin/system-health` is read-only and summarizes current signals; it is not a replacement for
the time-ordered log and process/container logs. When PostgreSQL is unavailable, `system_logs`
cannot capture the database outage itself, so check durable container output as well.

## 2026-11-16 audit scope

A read-only review of the accessible local database copy found 41,946 rows with
`level=error OR status=error` through 2026-11-15. Most historical rows were authentication
denials, revoked device tokens, or earlier schema mismatches. The Android emulator screenshot
shows an April network failure; the HeidiSQL screenshot shows a migration query, not a log entry.
The live log API was sampled separately and had different IDs, so the local count is **not** a
production total. Code changes in this branch classify expected GraphQL rejections as warnings,
return HTTP 400 for malformed JSON, allow nullable `User.username`, and render posts without an
author. These changes require deployment before they affect live logs. Admin page browser
verification still requires an authenticated session.
