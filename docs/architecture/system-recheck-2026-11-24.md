# BMS POS+ system recheck — 24 Nov 2026

Scope: Web backend and Admin/public UI, Desktop, Mobile and their shared contracts on branch
`recheck/full-system-2026-11-24` (from `develop` `c9fb665a`). This ledger separates what ran from
what could not be exercised. No production API, migration, deployment, push, PR or merge was
performed. All database work used local throwaway Postgres instances (`bms-realtime-test` on
`localhost:5433`, a disposable instance on `127.0.0.1:5547`) and an isolated Redis on `:6380`.

## Starting state

- The working tree on `develop` held 25 uncommitted paths written at 13:36 on 24 Nov, four
  minutes after `git pull`. They exactly undid merged recheck fixes (`a55ea168`, `8f52d8fc`, `dd78a574`,
  `8b876736`, `0d8ac4e3`, `bfa0e937`, `19549a69`, `2d87c548`) and deleted their contracts. They are
  preserved as `5f51de9b` and reverted in `739e354a`, so the branch starts from `develop`'s code.
- Baseline 1: `npm run gate` exited 2 at typecheck because host `node_modules` (installed
  2026-11-19, Next 14 / React 18) no longer matched the lockfiles (Next 16.4.6 / React 19.3.1,
  `nodemailer-safe`). After `npm ci` in `apps/web`, `packages/graphql-core`, `packages/realtime`,
  `apps/ws`, `apps/desktop`, `apps/mobile`: baseline 2 `npm run gate` exit 0 — registry 93
  features, inventory 716 files, typecheck, 404 pure files (3,927 tests: 3,921 pass, 0 fail,
  6 skipped), build.
- Desktop 166/166 (`npm test`), lint 0. Mobile `graphql:check`, typecheck, lint 0 (2 warnings),
  Jest 62 suites / 493 tests.
- DB: `bms_recheck_1123` (left by the previous recheck) passes `schema-readiness.sql` ("ครบ"). It
  was cloned for every run below; nothing was applied to it.

## How the checks ran

- Sweeps: six read-only code sweeps (REST routes, GraphQL resolvers, SQL/tenant scope, frontend
  links/XSS/i18n, Desktop, Mobile) produced candidates; every fix below was reproduced first
  (red test, live request or browser evidence) before it was changed; sweep findings that could not
  be reproduced or were by design are listed as dismissed or recorded, not fixed.
- Web browser: a local dev server (`next dev --webpack`, port 3124) on the throwaway
  `bms_recheck_1124` + isolated Redis. FAKE users created only there: a shop Administrator (crawl),
  a platform admin (platform-only pages) and a Sales user (live permission checks: coupon mask,
  emergency directory, Lab). A Playwright/Edge crawl opened every Admin navigation route plus
  public/POS routes, recording console errors, 4xx/5xx, `Invalid Date`/`NaN`, raw i18n keys,
  error boundaries, Next runtime overlays and horizontal overflow, in Thai at 1440 px and English
  at 375 px.
- DB: every `-db-contract` file ran on a disposable DB of the name its guard requires.

## Fixes on this branch

No fix needs a migration or a new environment variable. Each was reproduced first (red test, live
request, or browser evidence) and has a test that was red before the change.

### Security and tenant/permission boundaries

| Commit | Risk before | Change | Test (red → green) |
| --- | --- | --- | --- |
| `9a4e532f` | Slip OCR loaded `/api/files/<id>` by id only; a `slip_url` naming another shop's file was sent to OCR and the extracted fields returned to the wrong shop. | `loadSlipImage` binds `files.tenant_id`. | DB `payment-slip-tenant` (real PNGs, two tenants) |
| `7a501d4c` | Four exported type resolvers were never wired: `BmsDashboard.couponSummary` (`coupon.view` mask) let `report.view` roles such as Sales read coupon rows; tracking events errored; parked carts skipped normalisation. | Wired in `resolvers.ts`. | Pure `graphql-type-resolver-wiring` (builds the real schema) |
| `01bdd969` | Lazada/Shopee/TikTok webhook HMAC and Meta verify token compared with `!==`. | `verifyHexHmacSignature` / `constantTimeTextEqual`. | Pure `webhook-signature-compare` |
| `67972bac` | Cashier PIN sent in GET query strings (`/api/pos/ar`, `shift-report`, `store-credit`) → proxy logs/history. | Header `x-pos-cashier-pin`; `?pin=` ignored; three web POS call sites updated. | Pure `pos-pin-header` (route behaviour + screen scan) |
| `19480ff9` | `/admin/mail-log` rendered stored email HTML in an unsandboxed `srcDoc` iframe (same origin as the admin page, no CSP). | `sandbox=""`. | Pure `stored-html-iframe-sandbox` |
| `01d92dfa` | Staff Inbox turned customer messages into official-looking coupon/product cards with a customer-chosen link. | Cards only from outbound messages; wallet link through `safeStoredLinkUrl`. | Pure `user-entered-link` (Inbox case) |
| `ebcbc13c` | Any admin-scope login could edit the emergency directory quoted in customer emergency replies. | Writes require the shop Administrator (or verified platform admin). | Pure `tenant-settings-auth` |
| `abaec12f` | `bmsPharmacyAssistantTest` only required login; a public account could run the default tenant's pharmacy data through the simulator. | Requires `pharmacy.assessment.read` (the Lab's menu permission). | Pure `pharmacy-lab-access` |
| `c4a793d5` | Public checkout/board-game routes echoed raw Postgres/runtime error messages to anonymous callers. | `publicErrorMessage` keeps service messages, hides DB/system/runtime errors. | Pure `public-error-message` |
| `e63afd17` | SQL console read-only filter missed `pg_advisory_*`, `pg_read_binary_file`, `pg_ls_dir`, `lo_*`, `set_config`, `pg_sleep*`; console client returned to the pool with session state. | Prefix-family blocks; `release(true)`. | Pure `sql-console-guard` |
| `be7d6b1c` | `updateRole` could switch a global role on/off with no audit; create/delete unaudited. | `role.create` / `role.update` / `role.delete` audits. | Pure `graphql-legacy-resolver-guard` |
| `98d862b7` | Public `createSupportTicket` unlimited: each call wrote a row and sent an email. | `enforceAuthRateLimit` (5/email, 20/IP per hour). | Pure `graphql-legacy-resolver-guard` |
| `5c782a98` | Clients could write unpurgeable rows into the reserved `log-admin` audit category. | Batch refused (400). | Pure `client-log-category` |
| `179dd929` | Branch-restricted users could adjust stock / reorder points in other branches. | `userCanAccessLocation` on `bmsAdjustStock`, `bmsSetReorderPoint`. | Pure `stock-adjust-branch-scope` |
| `c0aa5d6b` | `LoginClient` (kept, contract-tested, currently no route) navigated to an unchecked `nextPath`. | `safeInternalRedirectPath(nextPath, "/")`. | Pure `login-next-redirect` |

### Functional defects

| Commit | Defect | Change | Evidence |
| --- | --- | --- | --- |
| `fc5447c0` | After the React 19 upgrade, antd static `message.*` (867 sites), `Modal.confirm/…` (45) and `notification.*` (2) rendered nothing, silently. | antd's documented `unstableSetRender` with `react-dom/client` `createRoot`, first import of `ClientProviders`. | Bundle probe on `/admin/dashboard`: before `messageRendered:false, confirmRendered:false`; after both `true`. Pure `antd-react19-render`. |
| `cd782a2d` | `/admin/receivables` rendered the error boundary on every open since 2026-11-19 (`undefined === undefined`, then `statement.data.bmsArStatement`). | `visibleArStatement()`. | Crawl screenshot before; clean render after. Pure `ar-statement-selection`. |
| `17867e9b` | Log redaction turned `DEFAULT_TENANT_ID` into `…-[NUMBER]`; `system_logs` insert failed (22P02) and `/api/logs` answered 503, dropping the default shop's client and route logs. | `tenant_id` from unredacted meta, UUID-validated. | Live: 503 → 201, row carries the tenant. Pure `log-tenant-id`. |
| `804a9938` | `/admin/roles` showed `Invalid Date` (epoch string from `Role.created_at`). | ISO field resolvers. | Pure `graphql-role-dates` |
| `3fa19e65` | Board-game analytics showed raw i18n keys for two issue codes. | th/en entries. | Pure `board-game-analytics-issue-i18n` |
| `76fe1cf6` | POS readiness judged lot expiry by the UTC date (00:00–06:59 Bangkok = yesterday). | `bangkokDateKey()`. | Pure `bangkok-date-key` |

### Desktop and Mobile

| Commit | Defect | Test |
| --- | --- | --- |
| `b9585ab7` | Preload silently kept only the first 4 selected queue screens (main accepts 32). | Node `preload-bridge` (loads the real preload) |
| `5e985572` | Six queue-display messages showed Thai in the English shell. | Node `language` catalogue scan |
| `57daf5dd` | `/pos/manual` and legacy queue popups survived unpair (old token in memory) and cashier close. | Node `window-lifecycle` |
| `b1cfa587` | `--pairing-handoff=<any absolute path>` could delete arbitrary user files. | Node `window-lifecycle` |
| `117ffd68`, `054cd226` | Mobile Inventory never showed the permission panel in English (matched translated text against Thai server text). | Jest `InventoryPermission`, `permissionError` |
| `4e1fd642` | Mobile timeout/cancel errors were hardcoded Thai in English mode. | Jest `operationTimeoutLanguage` |

### Test infrastructure (DB contracts that could not pass on a correct schema)

`a16d4e1c` store-profile upsert (AR, blind return) · `91164938` Next 16 request-cookie scope for
route-level DB tests · `00fb17a9` restaurant-pickup synthetic schema (`10.131`/`10.134`) ·
`1e137e7f` technical-specs foreign actor · `7e4d5d55` operation-improvement due-time race ·
`bb47d252` inbox-read stub (follow-up to `01bdd969`) · `138efdba` user-admin-audit UUID actor.

### Corrections made during the pass

- `ae079a9f` deleted `LoginClient` as orphaned; two contracts still test it and its message wrongly
  called the auth group green. Reverted in `a825bee7`; the redirect is fixed in place (`c0aa5d6b`).
- `117ffd68` put a Thai literal in a helper; `pos-client-i18n-contract` flagged it; fixed in
  `054cd226` (regex over server text).
- `01bdd969` changed a module that `inbox-read-db-contract` stubs; fixed in `bb47d252`.
- `c4a793d5` added an import to the board-game payment route that `remaining-upload-body-contract`
  stubs; the first final gate failed on it (1 of 3,962 pure tests); fixed in `6bda5848`.

## Checklist and evidence

✅ checked and passing at the stated boundary · 🔧 fixed (commit + test) · ⛔ blocked or not
verified at the live boundary. A source, fixture or throwaway-DB check is not production evidence.

| Area | Check | Method | Result | Commit | Evidence / limit |
| --- | --- | --- | --- | --- | --- |
| A · REST | Every `/api/**` method guards itself; tenant server-derived; public routes rate-limited | Read all 256 `route.ts` + 3 Pages API routes; `inventory-tenant-scope`, `pos-route-guard` | ✅ every method guarded, no `if (secret &&)` cron; 🔧 constant-time webhooks, PIN header, anonymous error text, log category | `01bdd969` `67972bac` `c4a793d5` `5c782a98` | `order/[id]/pay` has no branch check but `payOrder()` is a fail-closed stub (writes nothing). Board-game session GET is device-only (register loads before a PIN) — recorded. |
| A · GraphQL | Permission/audit/scope on 751 resolvers + type resolvers | Sweep + schema-wiring contract | 🔧 wiring, emergency directory, Lab permission, role audit, support-ticket limit, stock branch scope | `7a501d4c` `ebcbc13c` `abaec12f` `be7d6b1c` `98d862b7` `179dd929` | No unknown permission strings; `retail_local.license.*` seeded to no role (Administrator only). Remaining gaps listed under follow-ups. |
| A · SQL/RLS | Injection, tenant predicates, `beginTenantTx`, stock movements | AST sweep of 905 files | ✅ no reachable injection (331 interpolation sites, all constant/allowlisted; SQL console is raw by design); 🔧 slip OCR tenant | `9a4e532f` | Many tenant writes still use plain `query()`/`runInTransaction` or post-commit `audit()` — recorded, not changed. |
| A · Dates | `Date` → ISO on `String!`; `DATE::text` | Sweep + browser | 🔧 `Role` timestamps, Bangkok day | `804a9938` `76fe1cf6` | `User`/`Comment`/`Notification` timestamps still epoch strings (consumer app contract) — recorded. |
| A · SDL | `schema.graphql` matches code | `npm run schema:export` + `git diff` | ✅ no diff (start and after the GraphQL fixes) | — | |
| A · Readiness | `createOrderInTx` columns declared; artifact current | `check-schema-readiness.mts --sql` vs file | ✅ identical | — | Readiness on `bms_recheck_1123`/`bms_realtime_test`: complete. |
| A · DB suites | All `-db-contract` files on throwaway DBs | See § Database | ✅ after test-infra fixes; ⛔ production | 8 `test(db)` commits | |
| A · Realtime | Outbox in the same tx, no PII | Pure realtime contracts; DB realtime suites | ✅ pure + restaurant/stock DB suites on `bms_realtime_test` | — | Live Redis → WS → client chain not exercised. |
| A · AI rules | Confirmation before order, no empty turn, no invented facts | Pure AI/customer-chat contracts | ✅ deterministic boundary | — | No live model call. |
| A · Permissions seeded | New permissions seeded | Sweep vs `db/migrations` | ✅ none introduced; Lab permission already seeded (`7.57`) | — | |
| B · Admin pages | Every navigation route, th 1440 px / en 375 px | Playwright/Edge crawl on local dev + FAKE users | 🔧 receivables crash, toasts/confirms, logs 503 | `cd782a2d` `fc5447c0` `17867e9b` | See § Browser pass. |
| B · Public/POS pages | `/`, `/th`, `/en`, `/learn/**`, `/pos`, queue board, shop, support | Same crawl | ✅ render; React 19 `element.ref` warning from antd internals | — | POS register needs a paired device (not paired in this pass). |
| B · XSS/links | `dangerouslySetInnerHTML`, stored hrefs, redirects, iframes | Sweep + contracts | 🔧 mail-log sandbox, Inbox cards, LoginClient | `19480ff9` `01d92dfa` `c0aa5d6b` | 6 `dangerouslySetInnerHTML` uses are constant/escaped JSON-LD. |
| B · i18n | th/en parity, template keys | Sweep (113 template sites) + crawl | 🔧 analytics keys, Desktop/Mobile copy | `3fa19e65` `5e985572` `4e1fd642` | th/en dictionaries 9,893 keys each, identical sets. |
| B · Mobile width / dark | 375 px overflow; dark theme | Crawl (overflow probe, computed body background) | ✅ 99 routes at 375 px without overflow; 14 routes in dark mode | — | Dark mode checked on a representative subset, not every Admin route. |
| B · Sidebar/roles | `collapsed` badges; DB role dropdowns | Sweep | ✅ every entry passes `collapsed`; admin role dropdowns use `Q_ROLES` | — | Collapsed rail hides some badges by design; legacy `/settings` role select is hardcoded but unreachable — recorded. |
| C · Desktop | Tests, lint, package, IPC/preload/window security | `npm test`, `lint`, `pack:win`, sweep | 🔧 4 fixes; ✅ 171/171 Node tests (166 at baseline), lint, `pack:win` + packaged-source verification | `b9585ab7` `5e985572` `57daf5dd` `b1cfa587` | ⛔ installed run, external monitors/audio, printer/drawer, signing/notarisation. |
| D · Mobile | typecheck, lint, Jest, `graphql:check`, scope/offline/retry | npm scripts + sweep | 🔧 2 fixes; ✅ 65 suites / 501 tests, typecheck, lint, `graphql:check` | `117ffd68` `054cd226` `4e1fd642` | ⛔ Android/iOS device, camera QR, Wi-Fi printer. Offline-queue/retry design gaps recorded. |
| E · Cross-system | Customer→AI→CRM→Order→Inventory→Payment→Shipping→Dashboard | Pure contracts + DB suites + browser | ✅ component boundaries; ⛔ live end-to-end | — | No channel sandbox, payment provider or carrier. |
| E · POS parity | Sale/return/tax/shift/transfer/count across Web/Desktop/Mobile | Shared contracts, DB stock suites | ✅ shared service + DB boundary | — | No real bill from the three clients against one DB. |
| E · Claims | Docs do not overclaim | Public copy + docs grep | ✅ unready features stay qualified | — | |

## Database (throwaway instances only)

`bms_recheck_1123` (restored dump, readiness complete) was cloned for every run; it was never
modified. Renamed aside, not dropped: `bms_requisition_test` → `bms_requisition_test_pre1124`,
`bms_realtime_test` (10 readiness migrations missing) → `bms_realtime_test_pre1124`.

| Run | DB | Result |
| --- | --- | --- |
| Full `npm run test:db`, baseline | `bms_recheck_1124` (clone) | 117 files · 992 tests · 756 pass · 212 fail |
| Full `npm run test:db`, after fixes | `bms_recheck_1124_final` (fresh clone) | 118 files · 993 tests · 773 pass · 196 fail · 24 skipped — every remaining failure is a suite whose guard requires another DB name or an opt-in flag (rows below) |
| Name-guarded suites | `bms_realtime_test` (fresh clone): fish-dock 9/9, operation-production 38/38, -material 22/22, -quality 17/17, -improvement 18/18 (×3), restaurant-costing 25/25, -costing-migrations 3/3, -actual-costs 21/21, -completion 10/10, stock-integrity 17/17, pos-offline-product 3/3, order-list-batch 1/1, retail-cart 2/2, shipment-lot 1/1, product-technical-specs 6/6; opt-in `BMS_*_DISPOSABLE_DB=1`: audit-traceability 3/3, inbox-inbound-claim 1/1, inbox-read 1/1, team-assistant-access 1/1, user-admin-audit 2/2 | ✅ |
| | `bms_requisition_test`: branch-requisitions 22/22, staff-stock-transfer-route 2/2 · `bms_operations_test`: operation-checklists 32/32 · `bms_freemium_test`: fake-package 6/6, freemium 29 + 1 skipped · `bms_installer_reports_test`: installer-reports 1/1 · `bms_restaurant_readiness_test` (`127.0.0.1:5547`): restaurant-pickup 7/7 · `bms_recheck_1124`: payment-slip-tenant 1/1, ar 26/26, pos-blind-return 9/9 | ✅ |

The baseline's apparent failures were mostly these name guards; the eight `test(db)` commits fixed
the suites that could not pass on a correct schema (fixture state, Next 16 internals, synthetic
schemas behind `10.131`/`10.134`, a timing race, hard-coded fixture ids).

## Blocked or not verified (stated plainly)

- ⛔ Production: no API, migration, deploy, push, PR or merge. Nothing here proves production state.
- ⛔ `/api/files` legacy Inbox files (REST sweep F5): `9.26` made existing files public and only
  later migrations re-privatised payments/reports/pharmacy/community chat. New Inbox uploads and
  LINE media are private, but pre-`9.26` Inbox attachments may still be public on the unthrottled
  `/api/files/<id>`. The restored dump has no Inbox-pattern files, so this needs a read-only check
  on the target DB before any data fix:
  `SELECT visibility, count(*) FROM files WHERE filename ~ '^([0-9]+-)?(bms-inbox-|line-(image|video|audio)-[0-9]+[.])' GROUP BY 1;`
- ⛔ Hardware/providers: ESC/POS, cash drawer, external monitors/audio, Wi-Fi printing, installed
  Desktop on Windows/macOS/Linux, Android/iOS devices and camera QR, Shopee/Lazada/TikTok, Flash/
  Kerry, e-Tax, SMTP, GrabFood/LINE MAN/foodpanda, AI models — not exercised.
- ⛔ POS register browser flows: no device was paired in this pass, so sale/return/shift reports
  (including the new PIN header) were verified by contract tests, not by a live register.
- ⛔ Live realtime chain (Redis → `apps/ws` → client) and multi-instance behaviour.

## Recorded, not changed (follow-ups)

Priority:
1. Stock counts (REST `/api/bms/inventory/counts` and GraphQL `bmsStockCount*`) take `locationId`
   from the caller with no branch scope in the shared service; `bmsAdjustStock`,
   `bmsRecordInventoryWastage`, `bmsAdjustLoyaltyPoints`, `bmsIssueStoreCredit` have no idempotency
   key (a retried delta applies twice). Needs service + schema changes (and likely a migration).
2. Audit rows written after commit and best-effort (`audit()` helper, 49 call sites; pharmacy
   assessment events; tax/membership settings) — violates the "same transaction" rule; plain
   `query()` tenant writes without `beginTenantTx` in pharmacy assessments, e-Tax queue, membership,
   shipping booking, restock subscriptions, `runInTransaction` for expense documents.
3. `x-scope: web` with both a public-user and an admin cookie mixes identities (permissions from the
   admin, actor id from the public user) — affects branch checks that use `author_id`.
4. SQL console runs as the pool login role (not `bms_app`, not tenant-scoped); audit after the query.
5. Mobile: deposit/AR/expense retries rebuild the request from edited form fields under the old key;
   return/void keys live only in screen memory; offline review rows have no in-app reconcile path
   and block shift close/unpair.
6. Desktop: raw device token readable by `/pos` page JavaScript (no site CSP); display windows load
   the full cashier preload; no Electron fuses; blocked navigations open any http(s) URL in the
   system browser.
7. Webhook rate limits are keyed by tenant before signature checks (a stranger can exhaust a
   tenant's budget); web-chat accepts any tenant id with no channel configured.
8. `User`/`Comment`/`Notification` timestamps are epoch strings (consumer-app contract to confirm
   before changing); `/admin/architecture` duplicate React keys; antd `useForm` not-connected and
   deprecation warnings; Apollo `BmsAiUsage` cache merge warning.
9. Smaller scope gaps: admin POS shift open/close and sales/management reports ignore branch scope;
   several POS device-only reads return customer data (parity with GraphQL); a prescription image
   whose evidence link fails stays readable by any staff of the shop; support-diagnostic events
   are written with a view permission; Mobile accepts `http://localhost` in release builds and stores
   the device token with `AFTER_FIRST_UNLOCK` (iOS backup); printer status bytes are not matched to
   their request; the collapsed Admin rail hides some badges; the legacy `/settings` role select is
   hardcoded (unreachable).

Dismissed after checking (no change): `POST /api/bms/order/[id]/pay` lacks a branch check but
`payOrder()` is a fail-closed stub that writes nothing; the POS deposit `input.shiftId` fallback is
dead code (`shiftId` is not in `BmsPosDepositInput`); deposit settle/close are idempotent server-side
(derived key, row lock + replay); `GET /api/pos/board-game/session` is device-only by design because
the register loads it before a PIN; `apps/desktop/dist-audit/…/default_app.asar` was deliberately
preserved in `392fe3c5`.

## Deploy and migration impact

No migration and no new environment variable. Behaviour changes operators may notice:
- Emergency-directory edits now need the shop Administrator.
- The support form returns `RATE_LIMITED` after 5 tickets per address / 20 per IP per hour.
- Client logs with category `log-admin` are refused (400).
- `GET /api/pos/{ar,shift-report,store-credit}` read the PIN from `x-pos-cashier-pin` only. The web
  POS (also hosted by Desktop) is updated in the same change, so deploy web as one unit; a stale
  cached register page would get 400 until reloaded.
- Toasts and confirmation dialogs appear again. Since the React 19 upgrade they rendered nothing,
  so feedback was invisible and actions behind a static `Modal.confirm` could not be completed
  (the dialog never opened, so its OK handler never ran).
- Slip OCR no longer reads a legacy slip file without `tenant_id`; it falls back to manual checking.

## Browser pass (local dev server, throwaway data)

- Thai, 1440 px, shop Administrator: 99 routes. 81 clean on the first run; 9 routes lost to a
  server stop (the app stopped the dev server while the session was paused) and 3 slow first loads
  were re-run clean; 12 platform-only routes were re-crawled as the FAKE platform admin and render.
  Real findings: `/admin/receivables` error boundary (fixed `cd782a2d`) and `POST /api/logs` 503
  (fixed `17867e9b`). Expected: board-game REST 400 for a non-café tenant (archetype gate),
  platform-only 403s/redirects for a shop Administrator.
- English, 375 px, shop Administrator (user language set to `en`): all 99 routes. 66 loaded on
  the first run; 33 hit dev-server connection drops (environmental: the server stopped or briefly
  refused connections under compile load) and were re-run (29 clean, 4 with the known dev warnings
  or the board-game archetype 400). Across all 99: no horizontal overflow, no raw i18n keys, no
  `Invalid Date`/`NaN`, no error boundary or runtime overlay; `html lang="en"` except the explicit
  `/th` routes.
- Dark theme, 375 px (FAKE platform admin, saved theme `dark`): `/`, `/en`, `/en/learn`, `/pos`,
  `/pos/queue-board`, `/shop/default`, `/admin/dashboard`, `/admin/orders`, `/admin/customers`,
  `/admin/settings`, `/admin/inbox`, `/admin/receivables`, `/admin/products`, `/admin/mail-log` —
  dark body background (`rgb(15, 23, 42)`) and no horizontal overflow on every route. Not every
  Admin route was checked in dark mode.
- Dev-only noise left in place: React 19 "Accessing element.ref" from antd v5 internals (public
  pages), antd deprecation warnings (`destroyOnClose`, `rowKey` index), `useForm` not connected
  (restaurant floor, delivery platforms, stock transfers), duplicate React keys on
  `/admin/architecture`, Apollo cache merge warning for `BmsAiUsage`.

Live API checks on the same server after the fixes (FAKE users):

| Check | Result |
| --- | --- |
| `bmsDashboard.couponSummary` as Sales / Administrator | `null` / object (`7a501d4c`) |
| `bmsUpsertEmergencyFacility` as Sales | `FORBIDDEN` "เฉพาะ Administrator เท่านั้น" (`ebcbc13c`) |
| `bmsPharmacyAssistantTest` as Sales | `FORBIDDEN` `pharmacy.assessment.read` (`abaec12f`) |
| `createSupportTicket` ×6, same address | 5 × ok, 6th `RATE_LIMITED` (`98d862b7`) |
| `POST /api/logs` category `log-admin` / `client` | 400 / 201 (`5c782a98`) |
| `POST /api/logs` as the default-shop admin | 503 before, 201 after; row carries tenant `11111111-…` (`17867e9b`) |
| App bundle `message.success` + `Modal.confirm` on `/admin/dashboard` | nothing rendered before; both render after (`fc5447c0`) |

## Final verification

- `cd apps/web && npm run gate` at `6bda5848`: exit 0 — registry 93 features, regression inventory
  736 files (716 at baseline), typecheck, 419 pure files (3,962 tests: 3,956 pass, 0 fail,
  6 skipped; `.test-output/pure.run.txt` records `files=419`, `exit=0`), production build (149
  static pages). A first final run failed on one harness stub (see Corrections) and was re-run.
- `npm run schema:export`: no `schema.graphql` diff. `check-schema-readiness.mts --sql`: identical
  to `db/checks/schema-readiness.sql`.
- Desktop: 171/171 Node tests, lint, `pack:win` with packaged-source verification.
- Mobile: 65 suites / 501 tests, typecheck, lint (2 existing warnings), `graphql:check`.
- DB: § Database — every suite green on the throwaway database its guard requires.

Branch: `recheck/full-system-2026-11-24` (local only; not pushed, no PR).
