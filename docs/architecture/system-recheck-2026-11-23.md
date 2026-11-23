# BMS POS+ system recheck — 23 Nov 2026

Scope: Web backend and public UI, Desktop, Mobile, and their shared contracts on branch
`recheck/full-system-2026-11-23`. This ledger separates checks that ran from live behavior that
could not be exercised. No production API, migration, deployment, push, or merge was performed.

The branch already existed at the start of this continuation. Five pending link-guard files were
preserved in `19549a69` before further edits. The baseline `npm run gate` passed registry,
inventory and typecheck, then stopped in pure tests: 3,901 passed, one failed, six skipped
(`.test-output/pure.run.txt` had `exit=1`). Build did not run in that baseline. The one failure
was the new link contract counting two guarded render paths as two calls when the source had four.

## Checklist and evidence

Status: ✅ checked at the stated boundary; 🔧 fixed in the cited commit; ⛔ blocked or not
verified at the requested live boundary. A source or fixture check does not establish a live
database, provider, or hardware result.

| Area | Check | Method | Result | Commit | Evidence / limit |
| --- | --- | --- | --- | --- | --- |
| A · REST | Route auth, server tenant, public rate limits | Reviewed route inventory (256 `route.ts` files), sampled `/api/logs/[id]`, realtime ticket, support bundle and store-logo routes; Web pure contracts | ✅ source/contract boundary; ⛔ live denial matrix for every route | `0d8ac4e3` | Sampled routes use platform or tenant-settings authorization; the existing route inventory covers BMS guards. No authenticated local API fixture covered all routes. |
| A · Dev webhooks | Unsigned single-tenant LINE/TikTok mocks | Red-then-green `webhook-body-contract`; `tiktok-mock-inbound-contract`; `pure webhook` group | 🔧 rate/body/event caps | `7338177c` | Production still returns 404. Development requests now have 20/min per route, 64 KiB streaming body and 200-event cap; malformed UTF-8/JSON is rejected before Inbox/AI. Focused group passed 73/73. |
| A · GraphQL | Permission, audit, global-role and platform-count scope | Web pure contracts and branch changes | 🔧 platform scope fixes; ⛔ exhaustive resolver audit | `dd78a574`, `8b876736` | Global role switching and platform counts now require platform-admin status. Full resolver-by-resolver live authorization was not run. |
| A · SQL/RLS/time | Parameter binding, tenant scope, `Date` serialization, `DATE::text` | Web pure contracts; sampled dynamic-query file list; local schema probe | ✅ contract boundary; ⛔ exhaustive SQL and live RLS | — | The local clone lacks current migrations, so current-code DB paths cannot be certified there. |
| A · GraphQL SDL | Executable schema matches committed SDL | `cd apps/web && npm run schema:export`; `git diff --exit-code -- schema.graphql` | ✅ no SDL diff | — | Export completed with exit 0. |
| A · Money/stock | Stable idempotency and transactional audit | Web pure POS/order/stock contracts | ✅ contract boundary; ⛔ live sale/return/stock transactions | — | No real money/stock mutation was sent to a shop. |
| A · Readiness | `createOrderInTx()` schema requirements and SQL artifact | `schema-readiness-contract` in Web gate; `git diff --exit-code -- db/checks/schema-readiness.sql`; local `psql` readiness query | ✅ artifact clean; ⛔ clone schema | — | Clone readiness returned 25 missing objects across 10 migration files, including `10.129`, `10.134`, `10.136`, `10.137`. No migration was applied. |
| A · Realtime | Outbox transaction and payload scope | Web pure realtime contracts | ✅ contract boundary; ⛔ restored-DB trigger execution | — | No current-schema DB write/outbox inspection. |
| A · AI | Confirmation, empty turn and verified facts | Web pure AI/customer-chat contracts | ✅ deterministic contract boundary; ⛔ live model/channel flow | — | No external model or provider credentials were used. |
| A · Roles | New permission seeding | Web permission and role contracts | ✅ contract boundary; ⛔ actual tenant role matrix | — | No ready local database to verify every tenant's seeded grants. |
| B · Pages | Admin menus, `/pos`, queue board, `/learn`, public routes | Local Next dev server on `localhost:3114`; browser at 375 and 1440 px | ✅ sampled public/POS routes; ⛔ all Admin menus, cart, chat and table QR | — | `/th`, `/en`, learning center, getting-started, retail guide, POS setup and queue handoff rendered. Admin and tenant-backed routes need a local session and current schema. |
| B · Errors | Console, network, loading and empty states | Browser DOM/console plus dev-server output | ⛔ full clean-browser claim | — | Public plans request failed because this host process had no local Postgres/Redis configuration; homepage showed a load error. POS log submission returned 401 while unauthenticated. These observations are environment-bound. |
| B · Language | Thai/English surfaces | Browser `/th`, `/en`, learning center and POS; Web i18n contracts | ✅ sampled bilingual render; ⛔ all Admin text | `a55ea168` | Sampled page headings and `html.lang` matched the route. Admin loading fallback was localized in the preceding branch commit. |
| B · Links/XSS | Shop website and payment-slip `href` from stored input | Red-then-green `user-entered-link-contract`; source review | 🔧 guarded links | `19549a69`, `2d87c548` | Public website links normalize to HTTP(S); payment-slip links require same-origin path or HTTP(S). The focused contract passed 3/3. Authenticated payment-screen browser rendering remains unverified. |
| B · Mobile/dark | Horizontal overflow at 375 px and dark theme | Browser DOM width and screenshot | ✅ sampled routes; ⛔ every Admin screen | — | `/th`, `/en`, `/en/learn`, `/en/learn/retail`, `/pos`, and queue handoff had no document overflow at 375 px; dark background and class applied. |
| B · Sidebar/roles | Collapsed badges and DB-backed role dropdown | Web pure navigation/role contracts | ✅ contract boundary; ⛔ live Admin UI | — | No valid local Admin session. |
| C · Package | Windows Desktop build | `cd apps/desktop && npm run pack:win` | ✅ package built | — | Exit 0; packaged-source/version verification ran. Installer signing/certification and installed launch were not tested. |
| C · IPC | Sandboxing, origin-bound preload and managed windows | `npm test`, `npm run lint`, sampled `main.mjs` preferences | ✅ source/tests | — | 166/166 Node tests; `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true` at sampled windows. |
| C · UX | Language, offline errors and external displays | Desktop Node tests | ✅ simulated logic; ⛔ physical monitors, audio, printer/drawer and installed offline run | — | No physical hardware or installed Electron session in this pass. |
| D · RN | Typecheck, lint and Jest | `npm run typecheck`, `npm run lint`, `npm test -- --runInBand --watch=false` | ✅ | — | 62 suites, 493/493 tests; lint exit 0 with two existing warnings. No Android/iOS emulator/device run. |
| D · GraphQL | RN generated types match SDL | `npm run graphql:check` red before regeneration, green after | 🔧 generated types synchronized | `53e95aba` | Added current supplier, product-import, receiving-location and inbox-read fields through codegen; check exit 0. |
| D · Scope/retry | Server-derived scope, offline same-shift replay, original-body return/void retry | RN Jest and Web pure contracts | ✅ simulated contracts; ⛔ real server replay | `8f52d8fc` | Refused sign-in now preserves queued cash sales. No device/server transaction performed. |
| D · Transport | HTTPS pairing and configured WebSocket URL | RN Jest and Web pure contracts | ✅ source/tests; ⛔ physical QR/WS session | — | No camera or live WebSocket used. |
| E · Full flow | Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard | Web pure contracts and cross-surface review | ⛔ live end-to-end | — | Current-schema local DB, channel sandbox and payment/shipping evidence unavailable in this pass. |
| E · POS parity | Sale, return, tax, shift, transfer and count across Web/Desktop/Mobile | Web pure, Desktop Node, RN Jest | ✅ shared contract boundary; ⛔ real cross-client bill | — | No shared DB transaction from the three clients. |
| E · Claims | Production-readiness wording | `CLAUDE.md`, domain status and prior recheck reviewed | ✅ status remains qualified | — | Retail Local, open-item, delivery providers, pharmacy and hardware remain pilot/unverified as already documented. |

## Fixes on this recheck branch

- `a55ea168`: localized Admin/session loading fallbacks; protects English Admin loading copy.
- `8f52d8fc`: a refused mobile sign-in no longer strands accepted offline cash records.
- `dd78a574`, `8b876736`: platform-wide role and count mutations/reads require platform-admin scope.
- `0d8ac4e3`: Inbox and payment-slip downloads keep their specific permission gates.
- `bfa0e937`: `/admin/login?next=` accepts only a same-origin path.
- `19549a69`, `2d87c548`: stored shop/payment links use guarded URLs; the pending test's incorrect call count was fixed after a red baseline.
- `53e95aba`: regenerated RN GraphQL types from committed SDL after `graphql:check` exposed drift.
- `7338177c`: bounded and rate-limited the unsigned development LINE/TikTok webhook mocks before
  any Inbox/AI work; production remains closed.

These fixes add no migration or environment setting. They do not change a feature's documented
production status. The link guard is covered by `user-entered-link-contract` (3/3); the RN type
sync is covered by `graphql:check`. The Web gate and Desktop/Mobile suites cover the preceding
branch fixes at their automated boundaries.

## Blocked evidence and rollout

- Local `bms-realtime-test` has 442 public tables and is on a dedicated Docker Compose project,
  but `db/checks/schema-readiness.sql` reports 25 missing objects from 10 migration files. In
  particular, ordinary order/POS paths require missing `10.129`, `10.134`, `10.136` and `10.137`.
  The requested DB contract suites and an end-to-end transaction cannot pass against this clone.
  No migration was applied under this task's no-apply instruction.
- Browser coverage was limited to public static and unauthenticated POS surfaces. The local host
  dev server had no usable Postgres/Redis connection, and the separate Docker container at port
  3001 belongs to another project. The existing Playwright smoke scripts could not start because
  the `playwright` package is absent locally; browser control provided a narrower manual check.
- ESC/POS, cash drawer, external monitor/audio, native Wi-Fi printing, installed Windows/Linux/
  macOS Desktop, Android/iOS device behavior, external marketplaces/carriers, e-Tax, SMTP and
  delivery-platform contracts remain unverified here. No provider or production API was called.
- No new migration exists in this branch. Applying migrations, production checks, push, PR and
  merge were outside the authorized boundary.

Final Web gate: `npm run gate` exited 0. Registry (93 known features), regression inventory
(713 files), typecheck, 401 pure files (3,903 passed, 0 failed, 6 skipped), and the production
build (157 static pages) completed. `.test-output/pure.run.txt` records `files=401` and `exit=0`.
