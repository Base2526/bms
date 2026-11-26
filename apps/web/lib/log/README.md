# BMS logging

Use `writeLogServer()` from `@/lib/log/writeLog.server` for server diagnostics. It
sanitizes messages and metadata before writing to `system_logs`, stdout or Slack.
Prefer stable operation names, status codes and actor IDs. Do not put request
bodies, prompts, names, phone numbers, payment data or raw errors in log fields.
Logging is best effort and must not change a business transaction's result.
If the logging endpoint fails, `addLog()` returns `false` without writing a
second console error that would obscure the original failure.

Browser code may use `addLog()` from `@/lib/log/log`. It sends to `POST /api/logs`,
which requires an authenticated admin session or valid user bearer token. The
helper skips `/pos` pages because device authentication cannot write to this route;
the Desktop shell uses `/api/pos/diagnostics/events` for device diagnostics.
The server refreshes actor and tenant, limits the body to 256 KiB and 50 records,
marks each row as client sourced and prevents client errors from triggering
Slack. Do not pass credentials or customer text from the browser; redaction is
defense in depth, not consent to collect it.

`GET /api/logs` and `GET /api/logs/[id]` require platform admin access. The
platform admin `DELETE /api/logs` route requires `x-bms-confirmed: true` and
records the deletion in the same transaction. Use the confirmed controls on
`/admin/logs` rather than calling the API directly. Legacy integer and UUID log
IDs are supported.

For incident classification and operational limits, see
[`docs/architecture/logging-and-triage.md`](../../../../docs/architecture/logging-and-triage.md).
