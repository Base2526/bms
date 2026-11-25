# POS connection diagnostics: independent review matrix

Review of `codex/pos-connection-diagnostics` on 2026-11-25. “Admin history” means a row in
`/admin/pos-devices` after an item-level accepted/duplicate ACK. A client attempt ID without an
echoed `x-pos-attempt-id` is client evidence only; it must not be joined to a server log as proof of
receipt. These are code and automated-test findings, not a claim of physical-device testing.

| Scenario | Operator UI | Client journal / export | Upload / ACK | Admin history |
| --- | --- | --- | --- | --- |
| Offline before send | Offline/network guidance; no DNS/TLS guess | Coded `POS_NETWORK`, attempt UUID, route/operation, duration; Desktop/Mobile export offline | No request reaches ingest; pending until verified recovery | Appears only after later ACK; no server-received proof for original request |
| Mutation times out after send | Result unknown; inspect original sale/payment and key | `POS_TIMEOUT` with `outcome=unknown`; original business key stays in workflow, never in diagnostics | Retry diagnostics with same event UUID only; no new sale/payment key | Attempt and outcome visible after ACK; server log link only if original server received the UUID |
| HTTP 401 | Token rejected; re-pair/re-authenticate | `POS_AUTHENTICATION` and 401 | Diagnostic upload can be blocked; local/export retained | Existing events remain; pending event appears only if credential becomes valid |
| HTTP 403 | Permission guidance; no forced logout | `POS_PERMISSION` and 403 | Item retained if upload denied | Existing history stays tenant/RBAC scoped |
| HTTP 408 | Timeout and unknown mutation result | `POS_TIMEOUT`, status 408 and attempt | ACK after transport recovers | Filterable by status/code/attempt |
| HTTP 429 | Rate-limit guidance | `POS_RATE_LIMIT`, 429 | Upload backs off, retains items | Appears after retry succeeds |
| HTTP 5xx | Server unavailable guidance | `POS_SERVER`, status and duration | Upload retries; DB writer failure gives no success ACK | Server fault log may carry UUID when received; client event appears after ACK |
| HTML 200 / malformed data | Protocol/URL/version guidance | `POS_PROTOCOL` or invalid-response code; no HTML body | Coded event only | Code/status and receipt delay visible after ACK |
| Native network error without detail | Network failure with unknown subcause | `POS_NETWORK`, optional safe native numeric code when platform supplies one; no raw exception | Pending offline | No invented DNS/TLS classification |
| WebSocket fails, HTTP works | Realtime degraded while HTTP reads remain usable | Ticket/close/reconnect coded events; rate limited | Upload over HTTP continues | Realtime event distinct from HTTP health |
| Recovery | Online/recovered status | Transition timestamp and prior/next state, no success probe flood | Pending diagnostics flush; per-item ACK | Occurred/received timestamps show outage and delayed upload |
| App restart | Last state and export remain accessible | Desktop file and Mobile Keychain reload with allowlist sanitization | Same event UUID can be redelivered | Duplicate ACK does not duplicate timeline |
| Token rotation | Credential guidance; old evidence remains exportable | Separate target fingerprint/journal target key | Old target queue cannot upload with new token | No cross-device attribution |
| Server/tenant change | New pairing verified independently | Old target evidence retained locally or counted as target-history gap | Upload only to verified exact target | Tenant/device derived server-side; branch is shown only when the occurrence is safely after the latest device edit, otherwise unknown |
| Queue fills / retention rotates | Pending/rejected/dropped summary shown | Dropped count, range and coded reason in export | Mobile uploads gap marker when possible; rejected items retained | Uploaded gap is visible; local-only gaps require export |
| Clock ahead / event older than 7 days | Clock/rejected count visible in diagnostics UI | Rejected event and reason kept for export | Per-item `clock_ahead` / `event_too_old`, not silent 200 discard | No false claim that rejected row exists |
| Duplicate delivery | No duplicate business action | Same diagnostic event ID remains until ACK | `duplicate` ACK removes only acknowledged diagnostic item | One `(tenant_id, client_event_id)` row |
| DB or log writer fails | Connection/server guidance; do not claim stored evidence | Client queue/export persists; storage failure surfaced separately | DB failure gives 5xx/no success ACK; log writer fallback is stdout | No admin row until successful retry; absence is explicit, not a server-fault inference |

## Release-candidate manual checks

Repeat offline, timeout-after-submit, WebSocket-only loss, restart, token rotation, target change,
capacity gap and export on Windows, Linux and macOS Desktop builds and Android and iOS Mobile builds.
Use a disposable tenant and original idempotency key when checking an uncertain mutation. Inspect
the actual journal/export, HTTP payload/ACK, `bms_support_events` and admin search for credentials,
customer data, raw URLs/query strings, headers, bodies, stacks and free text. This review ran
automated suites and a PostgreSQL 16 throwaway migration replay; it did not exercise those five
release binaries or a restored production-like database.

| Release binary | Actual check in this review | Manual check still required |
| --- | --- | --- |
| Windows Desktop | Node tests and Chrome browser fixtures on a Windows host; no installed Electron binary | Pairing, OS ACL, crash/restart, offline export, upload and admin lookup |
| Linux Desktop | None | Same scenarios on an installed Linux build, including user-only journal permissions |
| macOS Desktop | None | Same scenarios on an installed macOS build and Keychain access |
| Android Mobile | Jest/typecheck only; no emulator or device | Network/WS switching, Keychain restart, share export and payment uncertainty |
| iOS Mobile | Jest/typecheck only; no simulator or device | Same scenarios plus Keychain and OS share sheet behavior |
