# BMS system recheck — 14 Nov 2026

Scope: Inbox, Desktop, Mobile and Admin. This is an evidence ledger for the local code audit, not
a claim that every provider, hardware device, database transition or Admin screen was exercised.
The worktree already contained unrelated changes before this pass; they were preserved.

| Area | Boundary inspected | Evidence from this pass | Remaining unverified dependency |
| --- | --- | --- | --- |
| Inbox access | Admin UI callers → GraphQL/REST → conversation and helper queries | Sales ID access denied in `inbox-conversation-access-contract`; REST list cannot select another assignee; each conversation, nested field and timeline source read now checks owner/helper in the same SQL statement (`inbox-read-access-race-contract`); assignment, helper, status, tag, unread and note writes recheck owner/helper under a conversation lock; new auto-assignment locks the still-unassigned row and commits owner/audit together (`inbox-auto-assignment-transaction-contract`); helper, workload and event-name lookups bind the tenant; read-only local PostgreSQL `EXPLAIN` accepts the relevant statement shapes | A GraphQL response spans multiple SQL snapshots and may show some pre-reassignment rows together with empty post-reassignment fields; no post-reassignment read is authorized by an old adapter result |
| Inbox attachments | Upload → tenant-private `files` row → signed provider URL → download | `inbox-media-contract` covers tenant mismatch, tampered/expired token, oversized upload, denied Sales download and authorized read; external media route checks capability before storage | Live LINE/Meta media fetch, image format limits and storage-driver I/O were not exercised; provider URLs expire after 30 days |
| Inbox pipeline/queues/realtime | AI tool catalog, LINE/Meta webhook adapters, inbound job claim, outbound status and subscription paths | Pure contracts cover AI, webhook, retry, bounded read, queue, realtime and authorization; non-AI inbound conversation/message and diagnostic conversation/message/audit now commit together (`inbox-inbound-transaction-contract`); staff/follow-up/pharmacy drafts commit before provider I/O; Meta partial delivery is non-retryable; LINE/Meta transport timeouts retain an uncertain `PENDING` state; Inbox browser fixture passed at 1440/390 px | No live provider credential or outbound send; `PENDING` after a timeout or final DB write failure needs human reconciliation |
| Follow-up scheduler | Rule CRUD, worker reads, tenant-scoped lease claim, leased sends and outcome bookkeeping | Rule/audit rollback, duplicate-round, same-inbound suppression/new-inbound rearm, customer reply followed by AI reply, confirmed delivery failure, manual/fleet claim, stale worker and outcome rollback contracts pass; local PostgreSQL `EXPLAIN` under `bms_app` validated candidate, lease, insert, read, history and audit statement shape without executing writes; manual browser fixture passed at 1440/390 px | No disposable DB execution test of RLS, `SKIP LOCKED` concurrency or trigger behavior; no provider sandbox send |
| Desktop | Pairing, startup recovery, credential storage, IPC, POS host shell | 153 Node tests; macOS Electron renderer smoke and native keystore smoke; POS browser fixture at desktop/mobile widths | No native Windows/Linux run, installed package smoke, physical receipt printer or drawer in this pass |
| Mobile | Pairing, PIN, POS arithmetic, offline queue, printing, websocket and workflow contexts | 60 Jest suites / 471 tests, TypeScript and ESLint pass | No Android/iOS simulator or physical device run; Wi-Fi printer and offline replay with a real server not exercised |
| Admin and settings | Session/role refresh, tenant configuration GraphQL/REST, service write → tenant transaction/audit, admin pages | Sales configuration denial, audit rollback and platform tenant confirmation contracts; Admin and platform tenant browser fixtures at 1440/390 px; Web gate covers types, pure contracts and production build | Browser fixture intercepts API calls, so live RBAC/database transitions and every Admin route were not exercised |
| Database | Migration/RLS/schema references and tenant-scoped SQL in changed services | Existing migration grants checked for `bms_tenants`, AI config, profile and audit; GraphQL SDL exported after adding required platform confirmation arguments; `10.118` applied twice on both a minimal throwaway database and a schema-only restore of the local BMS database. Fake tenants/users under `bms_app` proved own-user update, cross-tenant/cross-user denial, direct UPDATE denial, invalid input and rollback; both throwaway databases and the schema-only dump were removed | Full data-bearing DB contract suite and production-shaped trigger/RLS interactions were not run |

## Confirmed fixes in this pass

- Sales could act on another shop conversation by ID through GraphQL or REST despite list filtering.
  Conversation/message operations now enforce the same owner/helper scope, and assignment targets
  are checked against the active tenant and eligible staff roles. Assignment now rechecks that scope
  under a conversation lock and rolls its owner/helper change back if audit fails. Adding/removing
  a helper, changing status/tags, and clearing unread follow the same scoped transaction rule;
  status/tag audits roll back with their writes. Notes now commit with validated @mention rows
  and audit; notification delivery is best-effort after commit.
- Helper listings, staff workload counts and audit-event display names now bind `users` and helper
  rows to the conversation tenant, preventing a bad legacy association from resolving another
  tenant's staff identity on the Inbox screen.
- Conversation and nested Inbox reads enforce Sales ownership in the same SQL statement returning
  data, closing the adapter-check-to-service-read race. New-conversation auto-assignment now locks
  the row, does not overwrite a human's assignment, and rolls back the owner update if audit fails.
- Non-AI inbound media and diagnostic messages now write their conversation and message atomically;
  diagnostic audit commits in that same transaction. A post-commit assignment failure is reported
  separately and does not turn a saved message into a failed inbound result.
- Pipeline conversation creation, AI handoff-counter updates and mention-read actions now execute
  under the tenant GUC, and the mention list joins related rows on tenant as well as their IDs.
- Inbox self-availability now requires `inbox.view` and uses an editor/tenant-checked function in a
  tenant transaction. The function grants no direct `users` UPDATE to `bms_app`.
- Sales could write channel credentials, AI keys and store identity/profile through broad admin
  gates. The mutations and branding uploads now require the tenant Administrator or DB-verified
  platform admin.
- AI key, onboarding progress, store profile, tenant identity and tenant active-state writes could
  commit separately from audit or race with partial progress updates. Changed writes place the audit
  in the tenant transaction; onboarding locks the tenant before reading/merging progress.
- Inbox attachments previously exposed private session-only URLs to LINE/Meta. New uploads carry a
  tenant/file-scoped 30-day media capability, and ordinary file download checks Inbox permission
  plus Sales conversation scope.
- The queue DB route created a second pool with fallback credentials. It now reuses the shared DB
  client. Mobile shift time formatting now uses its language dependency directly.
- Platform tenant suspension/activation and plan changes now require a visible review step and an
  explicit server-checked confirmation; the active-state audit commits with the change.
- Staff, follow-up and pharmacy-intake messages now persist before external delivery. The staff
  reply audit and coupon-wallet grant are in the initial transaction. A retry claims `FAILED` as
  `PENDING` before provider I/O, and Meta partial text/image acceptance is labelled `PARTIAL`
  without a whole-message retry. Transport timeouts remain `PENDING` until a human checks the
  provider; the Meta inbound worker does not replay an uncertain or partly accepted reply. A
  reclaimed follow-up lease reuses its committed message and original body for the same job and
  retry index. Follow-up rule writes now commit their audit in one tenant transaction, and worker
  reads of rule/conversation/customer/intent/history bind the claimed job's tenant.
- Follow-up scheduling now anchors a conversation to its latest inbound customer message, so a
  completed job cannot be recreated by the next cron sweep, while a later inbound message can
  start a new round. Confirmed outbound failure is failed work, and partial/uncertain delivery
  ends subsequent automated rounds for that job. Fleet claims run in tenant transactions with
  `SKIP LOCKED`; job outcome, history and audit commit atomically.

## Evidence limits and follow-up

The final Web gate passed: 3,710 pure cases (3,700 passed, 10 skipped), type/build and 149 static
pages. Desktop Node tests passed 153/153; Mobile Jest passed 471/471 in 60 suites, with Mobile
typecheck/lint and Desktop syntax lint passing. Read-only local PostgreSQL `EXPLAIN` confirmed the
tenant-bound helper display query under the app role and tenant-bound event-name lookups under
`bms_app`, along with the Inbox read/write statement shapes changed in this pass. Migration `10.118`
was applied twice and exercised under `bms_app` on a minimal local throwaway database and then on a
schema-only restore of the local BMS database seeded with fake tenants/users: own-user success,
cross-tenant/user denial, invalid input, direct-table denial and rollback all behaved as expected.
Both databases and the schema-only dump were removed. Browser fixtures used desktop and 390 px widths. Pure
contracts and intercepted browser fixtures cannot establish live provider behavior, full-schema
Postgres trigger/RLS interactions, device hardware support or installed Windows/Linux operation. A
fully migrated disposable database and provider sandbox credentials are required before those claims.
