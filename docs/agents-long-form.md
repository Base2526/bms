# AGENTS.md long form

Verbatim text moved out of [AGENTS.md](../AGENTS.md) on 2026-10-13 so the agent entry file stays
small. AGENTS.md keeps a one-line rule per area and links here; the authoritative per-domain rules
are in [agent-invariants.md](agent-invariants.md). Update this file when a rule below changes.

## Hard invariants (long form)

- **AI tool-calling** — two surfaces, one runtime. Customer (`pipeline.ts`) gets only
  `customerTools()`; no sensitive tool is ever exposed there. Staff (`/admin/assistant`) gets
  `staffTools(perms)`, re-checked by `requirePermission()` immediately before execution; sensitive
  tools (refund, cancel, adjust stock, merge, confirm/reject payment, email a report) are
  **propose-only** — the UI's Confirm fires the pre-existing permission-gated mutation. Every attempt
  is audited as `ai.tool_call` without raw args. Quota is consumed once per loop, not per round-trip.
  The same runtime serves `bmsWorkAssistant` (global admin Drawer + `/admin/assistant`): it adds
  bounded `currentPath`/`pageId` retrieval hints and a client-supplied `locale`, none of which is
  authorization — `users.language` is deliberately not a session claim, so it cannot be read from
  the GraphQL context. **A Confirm button must show the mutation and its server-composed
  arguments**, not just the model's summary; an outbound recipient is reviewed and validated
  before send. See [docs/ai/work-assistant-coverage.md](ai/work-assistant-coverage.md).
- **Multi-item customer requests** — one chat message can name several products at once.
  `requestedItems.ts` (`parseRequestedItems`) is the *only* splitter for "how many things did the
  customer ask for" — it never resolves a SKU, never converts a pack unit into a piece count, and
  never defaults a missing quantity to 1; do not write a second splitter. A pack's `packCode`
  reaches `create_order` as a name only — pieces-per-pack and pack price always come from
  `bms_product_packs`, resolved server-side, never supplied by the model. `evaluatePharmacySale()`
  reports every blocking SKU in one pass, but a basket with any blocker is still rejected whole —
  never let some lines through because others failed.
- **A pharmacist's approval is spent once.** `checkPharmacySaleInTx()` takes the case row `FOR UPDATE`
  and refuses one whose `checkout_order_draft.status` is already `ORDER_CREATED`;
  `markAssessmentOrderCreatedInTx()` spends it in the *same* transaction that reserves the stock it
  authorises. Never mark it after commit — the fire-and-forget version this replaced let one approved
  case dispense an approval-gated drug again and again. A cancelled bill does **not** hand the
  approval back (a fresh review is required), because releasing it would make "cancel to get another
  dispense" a supported move.
- **A guard that can be skipped is not a guard.** Scheduled endpoints go through
  `authorizeCronRequest()` (`lib/bms/cronRouteAuth.ts`), which refuses with **503 when the env var is
  unset** and 401 on a wrong header — never `if (secret && header !== secret)`, which reads like a
  check but means "no env, no check". Nine cron routes and `admin/queue/db` were open that way while
  `BMS_CRON_SECRET` sat unconfigured, on endpoints that send email, spend AI credit, release reserved
  stock and expire loyalty points. Consequence to accept, not work around: with no secret set the
  jobs refuse to run, visibly, instead of running for anyone. Enforced by
  `inventory-tenant-scope-contract`'s "no route treats a missing secret as permission to run".
- **A secret never falls back to a literal in production.** `jwtSecret()`, `crypto.ts`'s `getKey()`,
  `checkoutToken.ts`'s `tokenSecret()` and the ws gateway all throw when their env var is missing
  under `NODE_ENV=production`, and only use a dev constant otherwise. Resolve a secret in a
  **function, not a module-level `const`** — a const is evaluated on import, so `next build` would
  crash on a machine without runtime env, and any importer could read the unchecked value. Never
  write `process.env.X || "literal"` for a key, and never export the resolved secret. Enforced by
  `scripts/secret-fallback-contract.test.mts`.
- **A private file belongs to one shop (9.27).** `files.tenant_id` is derived from whichever BMS
  table references the file; `/api/files/[id]` compares it against the acting tenant from
  `authorizeAdminRoute(null)` (so a signed drill-down cookie works) and answers **404, not 403**, on a
  mismatch — 403 would confirm to an outsider that the id exists. `NULL` means "not owned by a shop"
  (legacy community uploads) and still needs only a session. Every BMS upload path binds the owner
  from a trusted source: the session, the authenticated device, or the signed checkout token — never
  the request body.
- **`files.visibility` decides who may read an upload (9.26).** `/api/files/[id]` serves a `public`
  row with no session (storefront product images, the legacy community uploads) and demands one for
  `private`; a missing or unknown value is treated as private, so the route fails closed. Listing and
  uploading (`GET`/`POST /api/files`) always require a session — the listing returned every file's
  `relpath` to anyone. `persistWebFile`/`persistBuffer` default to `private` and only
  `persistUploadStream` stays `public`; a new upload path that forgets to choose gets the safe one.
  Slips, Inbox attachments, generated reports and prescription images are `private`. Enforced by
  `scripts/file-visibility-contract.test.mts`.
- **Clinical evidence is health data.** Prescription images never go through
  `/api/files/[id]` (no auth, sequential ids); they stream from
  `/api/bms/pharmacy/evidence/[id]/file` behind a session, `pharmacy.evidence.read`, and a tenant
  match, and `file_id` never appears in any client-facing shape. `pharmacy.evidence.*` is seeded to
  Pharmacist only — deliberately narrower than the case itself, so a Manager who can read the case
  still cannot open the prescription. The counter writes evidence but cannot read it back. Audit
  trails carry the kind and id, never the note text or reference number.
- **`ONLINE_SALE_PROHIBITED` is a channel rule, not a blanket ban.** `evaluatePharmacySale()` takes a
  `channel`; online is a hard refusal, the counter falls through to `PHARMACY_REVIEW_REQUIRED` so a
  pharmacist still gates every hand-over. The parameter defaults to `"online"` on purpose — a caller
  that has not been taught about channels must keep the strict behaviour rather than silently gain a
  counter exemption.
- **Customer-surface PII** — checkout tools resolve the customer only from the server-established
  `(tenant_id, channel, customer_ref)`, never an id the model supplies, and return *completeness*
  (booleans/counts/`missingFields`), never the raw name, phone, or address.
- **Payment channels** — never name a method the shop has not configured
  (`paymentConfiguration.ts`). No hardcoded bank/PromptPay/QR examples on the customer surface.
- **Signed checkout link** — the HMAC token is the only authority; never accept tenant id, order id,
  amount, or customer identity from the request body. Amount comes from the order. It creates
  `PENDING` only — never auto-confirm a payment.
- **AI usage accounting** — keep `billable_credits` (charged), `provider_calls` (attempts), and
  `actual_cost_usd` (attributed cost) separate. A retry or provider fallback shares one
  `meta.usage_group_id` and bills **one** credit. Unknown cost is `NULL`, never `0`. Cost attribution
  is not a provider invoice.
  Monthly AI points are Free **100**, Pro **1,000 at THB 990**, Growth **2,500 at THB 1,990**,
  Business **5,000 at THB 4,900**, and Enterprise Factory **10,000 starting at THB 29,900**
  (`10.73` preserves Business's old allowance through rollout month), resetting on the first at
  **00:00 Asia/Bangkok**. There is no per-tenant USD cap.
  `recordAiProviderAttempt()` still records attempts before network I/O; failure blocks the call.
  Unknown cost stays unknown and historical reservations remain evidence, never a usage gate.
  Retail Local uses owner-funded keys (saved or server env), no AI plan points or SaaS purchase UI;
  the internal business plan is shop capability metadata, not an AI subscription.
  Only database-verified platform admins may change paid plans or adjust AI points; a shop admin
  session is never payment evidence. Automated subscription charging is not implemented.
  Point notices distinguish warnings, exhaustion and recovery; notification failure never rolls
  back accounting. See the full AI accounting invariants.
- **Shared-provider completions** flow through `finalizeAiUsageEvent()` — a parallel success/error
  path silently stops AI Provider Health from covering it.
- **Failure alerting** — never hook it off a tool's audit `outcome` (that merges real exceptions with
  ordinary "product not found"). Report next to the existing `console.error` sites, and keep the
  notification step time-bounded — it is awaited on the customer-reply path.
- **Carriers** — Flash/Kerry are mock-ready scaffolds, not live adapters; do not "finish" one by
  guessing endpoints or payloads. A carrier call never runs inside the fulfillment transaction, the
  shipment UUID is the idempotency key, and a failed booking stays visible and retryable rather than
  degrading silently into "manual".
- **POS/tax** — a device token is not a user; every mutating `/api/pos/*` route re-checks the
  cashier PIN and an action permission server-side. Settlement (stock, FEFO lots, tax document) is
  one atomic transaction, and every mutating action — sale, return, refund settlement, and (since
  `9.5`) a standalone drawer cash in/out, and (since `9.6`) a POS PO receipt — takes a stable client idempotency key so a lost response
  replays the original write instead of double-charging or moving cash twice. Refund allocations
  split cash (immediate) from non-cash (pending until `payment.refund`); a shift can't close with a
  pending allocation, and a return refunded across cash + card must still count once, not once per
  allocation row. A partial return rechecks the retained quantity against an exact sale-time
  wholesale/promotion snapshot; falling below a threshold reduces the refund rather than preserving
  an unqualified wholesale price; legacy rows without that evidence keep proportional refunds.
  Tax documents are immutable once issued; e-Tax submission (`7.94`) is a separate
  gated queue, not automatic, and its cron route doesn't yet call `recordJobRun()` like the others —
  don't copy that. `pos_only` accounts are hard-blocked from `/admin` login, not just hidden from the
  menu. **A manual discount, a void, and cash out of the drawer each demand a second person's PIN
  even when the operator holds the permission themselves** — holding a right and exercising it must
  be two separate acts in the evidence. A void is not a return: it reuses the return machinery but
  carries `isVoid`, and its `voided_at` stamp, tax-document cancellation, and audit row happen
  **inside that reversal's transaction**, never a second one afterwards. Serial-number checks (`8.3`)
  span the whole bill, not one line at a time, and the DB write that marks a serial `SOLD` is
  race-safe against two bills claiming it at once. A shift report only answers to the device that
  owns the shift. POS PO receiving derives the branch from the device, re-checks `purchase.receive`,
  and commits stock/movement/audit/retry result together. Browser Bluetooth HID is globally captured
  only after a configured positive prefix; timing/focus is never treated as proof of a scanner. The
  native app's focused HID mode is different: the cashier explicitly opens the scanner modal, which
  must keep its input focused, suppress duplicate CR+LF submission, and route modifier/multi-pack
  items through the existing product-options flow. It is not global capture or authorization.
  Since `10.13` a sale line's money is `bms_order_items.line_amount` (a promotion discount is
  allocated per line in satang, remainder on the last line); sales, tax and report readers use it,
  never `unit_price × qty`. A full tax invoice issues only for a `COMPLETED`, never-voided,
  never-returned bill, and back-office cancel/return/refund refuses a bill with an active tax
  document — return it at the register so a credit note is issued. A tax document snapshots the
  seller's name/tax id/branch/address at issue (`10.24`) and carries the Bangkok issue date
  (`10.8`); an unsent e-Tax row of a cancelled document becomes `CANCELLED` (`10.25`). Expense
  documents (`10.11`, `expense.view`/`expense.manage`) claim input VAT only on a `TAX_INVOICE`
  with a document number and a checksum-valid payee tax id, the duplicate-invoice key is the
  normalised number + branch, and a correction is `VOID` with a reason, never a delete. Supplier
  credit/debit notes (`10.37`) store positive difference amounts — only reports apply the credit
  note's negative sign — claim in the month received, reject WHT, and move no cash, stock or tax
  document. `BUY_A_GET_B` gifts (`10.41`) are real direct-stock `RETAIL_POS` lines priced by the one
  shared basket engine and frozen in `pricing_snapshot.crossSkuGifts`; returns reclaim lost gifts
  from that frozen rule, never today's promotion. A receipt-QR full-invoice request (`10.38`) is a
  purpose-bound capability, not payment authority: tenant/order come from the verified signature,
  read-back needs a separate hashed tracking secret, Retail Local refuses it, and staff issue it
  with `tax.document.issue` + allowed branch + the reviewed version (lock order → request → tax
  document). `10.39` caps a receipt at three successful submissions before 168 hours from the
  abbreviated receipt; staff actions never spend or reset that quota. The PDF email (`10.58`) is a
  tenant outbox row committed with the invoice and sent after commit; a failed send never undoes
  issuance, uncertain attempts need explicit retry, and the copy is never e-Tax. Full detail:
  [agent-invariants.md § POS and tax](agent-invariants.md#pos-and-tax).
- **The desktop shell is a window, not a register (`apps/desktop`)** — Electron hosts the
  authoritative `/pos` surface on Windows, Linux and macOS. It owns no schema,
  no price, no settlement and no permission: anything a cashier can do in it, a paired browser
  register can already do. What it does own is the credential — the device token is verified at
  pairing through `/api/pos/session`, stored through the OS keystore (`safeStorage`), and reachable
  only across the allow-listed IPC bridge, which answers a frame only when that frame is the local
  setup page or a `/pos*` frame on the paired origin; navigation and window-open anywhere else go to
  the system browser. **On Linux, pairing is refused when Electron selects `basic_text`** — an
  unencrypted fallback is not storage for a bearer credential — and a keystore message must name the
  keystore that machine actually has, because one naming the wrong one sends the cashier to a
  setting that does not exist. Every package (NSIS · AppImage/DEB · DMG for Intel and Apple Silicon)
  is unsigned and carries no auto-update — Gatekeeper blocks a first launch, which makes these
  internal-test builds rather than a distribution channel;
  never give the shell a second money path, offline tender, or an OS-level way around a server
  check. Detail: [apps/desktop/README.md](../apps/desktop/README.md).
- **Mobile Emergency Offline is an encrypted cash queue, not an offline backend.** It accepts only
  plain retail cash sales after the cashier is already signed in, the original shift is open, and
  the required product snapshot was loaded. Restaurant, pharmacy, board-game, member/coupon/points,
  approval, serial/weighted/modifier, credit/deposit, non-cash and stock-operation workflows remain
  server-required. The temporary reference is not a receipt or tax document; on reconnect the normal
  settlement service rechecks device/cashier/shift/branch, price, stock, tax and eligibility with the
  original idempotency key. Accepted cash can never be discarded: unresolved rows block shift close,
  unpair and pairing replacement. Do not use this boundary to narrow Retail Local—the latter still
  has an authoritative server in the shop. Detail:
  [docs/business/cloud-hybrid-pos.md](business/cloud-hybrid-pos.md).
- **Retail Local is a deployment profile, not a fork.** It runs the same Web/WS services and POS
  settlement path with one local PostgreSQL source of truth; it has no cloud replica, sync queue,
  alternate price/stock logic, or database inside Electron. `bms_local_installation` is a singleton,
  public shop signup is disabled in local mode, and first-run tenant/admin/`MAIN` branch/`POS-01`
  provisioning commits atomically. `retail-local-migrate.mjs` is the local migration authority: it
  orders the historical chain, records checksums, and refuses changed applied SQL. PostgreSQL/Redis
  stay off host ports, Web/WS bind to loopback, and backups must include both data and the local
  secrets needed to decrypt it. A test release carries pinned Web/WS/PostgreSQL/Redis images and the
  Web image carries its matching migrations; target installs never mount schema from a source tree.
  Bulk release installers upload only through the raw Pages API stream
  (`/api/admin/retail-local/releases-upload`, body parser off and excluded from middleware); routing
  them through Next.js 14 `NextRequest` buffers gigabytes and can kill the Web process.
  Release builds use the small online bootstrap by default and must never fall back to an offline
  bundle because a manifest URL, keyring, or requested target is missing. Build offline only after
  an explicit user request, with both `-Distribution Offline` and `-AllowOfflineRecovery`.
  **Licensing is evidence-only and fail-open** (`10.16`–`10.18`, `10.35`): licence, trial or review
  state never blocks POS, payment, stock, tax, backup, restore, data access or a corrective update,
  and there is no kill switch or lease. Setup never prompts for or redeems an Activation Code —
  downloading or installing creates no licence or trial; activation is an explicit post-install
  action from `/admin/retail-local-license` (`retail_local.license.view`/`.manage`, seeded to no
  role, so only Administrator holds them until granted). Web has only a request mailbox and a
  read-only status mount; the host agent owns credentials and signed evidence. The installation
  registry (`10.36`) counts instances by a random UUID and never stores a hardware serial, MAC,
  hostname or source IP; installer error reports (`10.31`) are consent-gated, opt-in
  (`BMS_INSTALLER_REPORTS_ENABLED=true`), size/rate-bounded, allow-listed JSON that only platform
  admins read. Server runs on Windows x64 and Ubuntu x64; `windows-x86-legacy` is POS-only; macOS
  packages are experimental. The product is a **technical pilot, not Commercial/GA**
  ([retail-local-ga-readiness.md](business/retail-local-ga-readiness.md)).
  Detail: [docs/business/retail-local.md](business/retail-local.md)
  and [agent-invariants.md § Retail Local](agent-invariants.md#retail-local-deployment).
- **Restaurant dine-in (`9.44`–`9.60`)** — `/pos/restaurant` is a second operating surface, never a
  second money path: a check reserves stock by creating one PENDING POS order when a kitchen round is
  sent, and `settleRestaurantCheck()` closes that same order through `recordPosSale()`. A check is
  scoped to the device's **branch** only — a waiter's tablet opens it, the register pays it, possibly
  after a shift change — so settlement re-stamps device/shift/cashier and the sale belongs to the
  shift that took the money. Replacing the reservation for a later round is **one** transaction
  (`createOrderInTx()` + `cancelOrderInTx()`): a round that cannot be reserved rolls back to the
  previous order, because the alternative leaves food already cooking with no reserved stock.
  Cancelling a check commits order cancellation, released stock, stopped tickets, the closed check
  and its audit together. Settlement takes the tenant advisory lock and row-locks check + order, and
  a replayed `CLOSING`/`PAID` response is accepted only from the same device, shift and cashier.
  Modifier prices are catalog data resolved server-side inside that transaction and written into the
  sale-time pricing snapshot; the register sends codes only, and a modifier is valid **only** on a
  `RECIPE` product — charging a surcharge while silently skipping its ingredient movement is not an
  acceptable fallback. Restaurant work uses its own permissions (`restaurant.floor.manage`,
  `restaurant.kitchen.update`, `restaurant.check.cancel`); do not reuse `pos.device.manage` or
  `order.ship` for it. A static table QR is only an opaque locator: its hashed browser session binds
  to the current OPEN check, a customer submission stays PENDING, and only a device/PIN-authenticated
  `pos.sell` acceptance may add it and run the existing reservation + KDS transaction. Full detail:
  [business/pos.md § Restaurant POS](business/pos.md).
- **Board game cafe (`9.79`–`9.83`, `9.89`–`9.94`, `9.96`, `9.98`–`10.7`, `10.40`, `10.42`, `10.48`–`10.50`)** — play time, sellable goods, and playable game
  copies are three different domains. A billing group, never the table session, owns the frozen
  charge, snack tab and settling order. One group may close and pay while every other group keeps
  accruing time; the table remains occupied until no group is `OPEN` or `CLOSING`. A checked-out
  game belongs to the session, so it may remain with groups still playing but blocks the final open
  group from closing. Settlement validates branch and group again, then marks that group `PAID` in
  the same payment transaction. Never type time fees as a Product SKU or reduce inventory when a
  library copy is borrowed. Fixed-duration alerts are computed from timestamps, not persisted as
  authority. Public nearby-store discovery is per-branch opt-in and may expose only published profile
  fields, rates/game highlights, and aggregate availability, never table/session/participant/customer
  identifiers. Dev fixtures use `FAKE` markers and cleanup must remove linked board-game orders before
  sessions. The table itself belongs to a **seating** (`9.91`), not to a visit: moving a party or
  merging two tables changes only where people sit and must never touch a session, billing group, tab
  row or order, and a table is free only when every session sharing its seating is settled. Read the
  current table from the seating — `bms_board_game_sessions.table_id` is the table the visit *opened*
  at. A member pass (`9.92`) is an entitlement with the same rules as play time — no SKU, no stock —
  snapshotted at sale time, with its minute balance a cache of the pass ledger; coverage is applied
  only when a billing group is closed, inside that transaction, never while previewing a bill.
  Since `9.94`, the sold pass snapshots its branch too: a branch-scoped entitlement never follows a
  plan moved later and never covers a visit at another branch. Identity holds may be taken only while
  the session is `OPEN`; final POS settlement rechecks that no card is still held, and settlement
  locks session → billing group → order to match close/cancel.
  `10.3` offers discount only play time and are selected server-side against pass coverage; a required
  SKU must already be a real inventory-backed tab line. `10.4` renewal is store-credit-only: funding
  belongs to the same member, and the new pass, payment and both ledgers commit together or not at all.
  `10.7` treats capacity as a server-checked explicit override, lets each participant own an actual,
  session-end or independent purchased-time boundary, and permits only OPEN billing groups to merge
  or detach to a free table. Merge rebuilds both tab reservations atomically and retains a MERGED
  history row; detach moves one group's people/order plus explicitly selected loans/holds into a new
  session/seating and is rejected for the last group.
  A guest service bell (`9.96`, scope hardened by `9.98`) is session-scoped and operational only: it never changes time, bill,
  stock, or copy condition. Move/merge resolves the current table from seating, terminal sessions
  revoke the guest token and expire active calls, and a reported game issue still needs the existing
  copy-condition workflow after staff physically inspect it.
  The walk-in queue (`9.99`) exists only before seating: it owns branch/service-day queue numbers,
  never starts time or money, and seating opens the normal session and marks the queue `SEATED` in
  one transaction. Arrival order is visible but table capacity means seating is not strict FIFO;
  `expected_end_at` is an estimate, never a promised table time.
  An advance reservation (`10.0`) is a fixed pre-session table window on that same waitlist
  aggregate: booking/check-in/seating serialise on the table, reject overlapping active reservation
  windows and never create a clock, bill, order, or stock movement before seating. Check-in allocates
  a normal queue number; direct seating opens the existing session atomically. A reschedule is
  `CONFIRMED`-only and repeats the locked capacity/session/overlap checks; guarded cron expiry claims
  stale confirmed rows with `SKIP LOCKED` and never closes a checked-in party. Public booking
  (`10.1`) is an opt-in `REQUESTED` row with no table until staff approves it under the same locks;
  opaque-token cancellation and bounded retryable email reminders expose no customer data. `10.2`
  interprets public times in the branch timezone, expires stale requests, records immediate decision
  delivery, and carries configurable reservation deposits in `bms_payments`. The confirmed deposit is
  applied once as an internal tender to the real POS order; unused/refundable money stays on the
  original payment for refund. It is never a Product SKU, stock movement, or parallel billing ledger.
  `10.40` `TIME_BUY_GET` offers repeat per participant over already-rounded minutes and compete with,
  never stack on, other offers and passes; `10.42` adds one optional catalogue image per title.
  Customer chat booking (`10.48`) previews without writing and writes only after a short affirmative
  to the exact latest server summary (15-minute fingerprint, consumed by any other message); it
  inserts `REQUESTED`, or `CONFIRMED` with a table allocated under the shared reservation locks only
  when the branch opted into `chat_auto_confirm` (`10.49`, part of the consent fingerprint). Only
  active, booking-enabled, no-deposit branches qualify; contact data are CRM snapshots, never tool
  arguments; at most three active future CHAT bookings per customer. Table area/capacity details
  reach customers only after the per-branch `10.50` opt-in.
  Native POS derives its branch from the paired device, hands the billing-group id to the
  existing sale mutation, and must never submit its display-only time line as a Product SKU. Full detail:
  [business/board-game-cafe.md](business/board-game-cafe.md) and
  [agent-invariants.md § Board game cafe](agent-invariants.md#board-game-cafe).
- **Product catalog truth (`9.40`–`9.43`, `9.51`, `9.52`)** — a product's serving/size options live
  in `bms_product_variants`, never `bms_inventory`: a `RECIPE`/`NON_STOCK` item's own inventory row
  is deliberately zero, so reading inventory to discover sizes returns nothing for exactly the items
  this exists to sell (found live in `checkStock()`'s AI path; `listSellableProducts()` still has
  it). `bms_product_sales_surfaces` is channel authority — `active` is only lifecycle state, and a
  product invisible on a channel needs a surface row there, not a change to `active`. A store
  capability only does something if `isCapabilityEnabledInTx()` is called for it (`RECIPE`,
  `MODIFIER`, `WEIGHTED_PRODUCT`, `WASTAGE`, `KITCHEN_WORKFLOW` — the rest of the archetype preset
  is descriptive, inferred from existing data). Full detail:
  [agent-invariants.md § Product catalog](agent-invariants.md#product-catalog-variants-sales-surfaces-and-stock-policies).
- **Restaurant online ordering (`9.55`–`9.57`)** — gates on `business_archetype === 'restaurant'`
  read in its own statement, because the shared function runs for every non-POS order of every
  tenant and naming a not-yet-migrated column there takes every shop offline, not just restaurants.
  `bms_locations` has no `is_default` column — the default-branch order is
  `(code = 'MAIN') DESC, is_head_office DESC, created_at`. A "sold out today" flag
  (`bms_product_menu_unavailability`) clears on the earliest of a 15-minute cron or the branch's
  next shift-open, both keyed off `resets_at`; **shift-open must clear only rows past their
  `resets_at`, never the whole branch** — a shift is per device and cashier, not per service day. An
  online order needs an explicit branch and `fulfillmentType`; payment alone never creates kitchen
  work, only `packOrder()`'s `PAID -> PACKING`. Line cancellation reuses `processPosReturn()`
  (never a second money path), writes an immutable cancellation cause, and reprices/absorbs/queues a
  refund exactly like a counter partial return. Full detail:
  [agent-invariants.md § Restaurant online ordering](agent-invariants.md#restaurant-online-ordering-chat-delivery-sold-out).
- **Delivery platforms (`10.12`, `10.14`, `10.21`)** — provider contracts are capability-gated: never invent an
  endpoint, signature header, payload, status or retry guarantee. The opaque integration id derives
  tenant and a verified store mapping derives branch. Platform partner contracts and encrypted
  credentials live only in the platform-admin `/admin/delivery-provider-settings` control plane;
  tenant authorization and store/menu mappings live in `/admin/delivery-platforms`, which never
  receives platform secrets. Only `VERIFIED` item/variant/modifier mappings
  create a whole order. Webhooks write a sanitized durable inbox, the order/payment/reservation
  commit atomically, and every external call runs after commit through the command outbox. Desired
  pause, provider state and sync result remain separate. `PLATFORM_SETTLEMENT` is server-only and is
  never a checkout/POS/AI choice. Scheduled orders require an explicit prep lead; rider handoff
  commits evidence, `PACKING -> SHIPPED` and stock movement together. Since `10.14`, foodpanda uses
  OAuth client credentials with an encrypted shared-
  Redis token cache and one bounded 401 refresh; logical webhook identity is separate from its
  canonical payload hash; the worker re-locks and rechecks integration config/health after fetch;
  provider/config currency and verified mapping price snapshots must match local authority; and
  typed transport decides the only outbound lifecycle transition (`LOGISTICS_DELIVERY` ready,
  `VENDOR_DELIVERY` dispatched only from committed handoff). Unknown transport or changed identity
  is action-required, never inferred. GrabFood/LINE MAN remain
  contract-blocked until official partner webhook/onboarding contracts are reviewed; no live-ready
  claim is valid before sandbox, shadow, tax approval and a real settlement cycle. Provider
  analytics keeps BMS sales/refund dates separate from statement payout, treats missing actual payout
  as unknown, never sums mixed currencies and never allocates statement-wide fees to a branch without
  provider evidence. Full detail:
  [integrations/delivery-platforms.md](integrations/delivery-platforms.md).
- **Social Login (`10.22`)** — Google/Facebook availability is a platform-admin switch per surface
  (`PUBLIC_LOGIN`, `ADMIN_LOGIN`, `SHOP_SIGNUP`, all default off) in `bms_social_auth_settings`,
  changed only at `/admin/auth-settings` with an explicit confirm and an append-only event row. A
  surface is available only when its switch is on **and** its runtime config is ready; client
  ids/secrets stay in environment variables, never the database, and each `NEXT_PUBLIC_*` id must
  equal its server twin. One `(lower(provider), provider_id)` maps to one user (partial unique
  index), and the public `socialAuthAvailability` query returns booleans only. Detail:
  [agent-invariants.md § Authentication identity and registration](agent-invariants.md#authentication-identity-and-registration).
- **Sample data is a ledger, not a name prefix (`10.26`, `10.30`)** — `bms_sample_runs` and
  `bms_sample_records` record exactly which root rows a run created; only those rows may be
  removed, and a `FAKE-`/`SAMPLE-` prefix never authorises a delete. One live run per tenant;
  `/api/bms/onboarding/sample-data` requires `product.edit`, its POST seeds `STARTER_CATALOG` only,
  and DELETE requires the typed confirmation `DELETE SAMPLE`. Onboarding seeds accept every
  archetype (`10.30` — restaurant seeding failed before it).
- **Customer chat states published facts only (`10.43`, `10.51`–`10.53`)** — allergen/dietary
  declarations, restaurant table details (`10.51`, per-branch opt-in) and branch parking (`10.52`,
  `bms_locations.parking_info`, every archetype) reach a customer only when the shop published them.
  Unknown/unpublished is "not provided", never "none"; capacity is never vacancy; a truncated list
  never proves absence; no invented wait or preparation time. A chat table request is `REQUESTED`
  until PIN-authenticated `pos.sell` staff accept it. Customer answer evidence (`10.53`) is
  provenance, not audit and not a verdict: exact source messages plus bounded allowlisted tool
  snapshots under forced tenant RLS, written in a savepoint that must never roll back the message
  pair or retry a business action. Detail:
  [agent-invariants.md](agent-invariants.md) and [ai/quality.md](ai/quality.md).
- **Pharmacy customer guidance (`10.44`–`10.47`)** — chat stays non-clinical even with intake off.
  A clinical question gets a pharmacist-approved per-shop body (`10.45`, one row per tenant/question
  code/locale) only while it is `APPROVED`; otherwise the existing fixed handoff, word for word.
  Only a licensed pharmacist approves (no Administrator shortcut), the approval locks the licence row
  through `bms_lock_guidance_pharmacist_license()` until commit (`10.47`), and editing an approved
  body returns it to `DRAFT` (DB trigger). Starting drafts live in code, never seeded as approved.
  Emergency wording is inspected on the raw message **before** any history/profile/identity read
  (`10.46` directory: no customer location, at most three active 24-hour facilities, bounded
  timeouts). Shift evidence is historical, never "a pharmacist is present now". Detail:
  [pharmacy README](../apps/web/lib/bms/pharmacy/README.md).
- **Customer merges are reviewed, web chat sessions are signed (no migration)** —
  `bmsMergeCustomers` requires `customer.edit` and a ten-minute signed preview bound to
  tenant/actor/direction/snapshot plus reason, verification method, evidence reference and explicit
  confirmation; the merge and its `customer.merge` audit commit together. AI proposes ids only and
  never supplies proof. Website chat returns an opaque 30-day signed `sessionId` bound to the URL's
  tenant (`webChatSession.ts`); an unsigned legacy id starts a new identity, an invalid/expired
  signed one is 401, and the bearer never enters CRM or prompts. Never restore an unreviewed merge
  path. Detail: [business/crm.md](business/crm.md).
- **Mail, scheduler and public settings (`10.57`, `10.59`)** — `MAIL_PROVIDER=smtp` uses
  `SMTP_HOST/PORT/USER/PASS` + `MAIL_FROM`; ports 465/2465 are implicit TLS and every other port
  requires STARTTLS — never send credentials or receipts in plaintext. `normalizeReplyTo()` accepts
  one plain address and drops anything else rather than failing a send. Apply `10.59` before
  enabling SMTP or the best-effort mail log silently drops those rows. The opt-in Docker `scheduler`
  service only dispatches the existing authenticated cron APIs (no DB/AI credentials, no host
  ports); exactly one scheduler owner is selected with `BMS_CRON_RUNNER`
  ([architecture/scheduler.md](architecture/scheduler.md)). Homepage app download links
  (`10.57`) are platform-admin settings that accept explicit `https://` URLs only.
- **Native network receipt printing (no migration)** — `apps/mobile` prints server-backed receipt
  paper as an ESC/POS raster to an explicitly configured private-IPv4 TCP printer, checks
  `DLE EOT` online/cover/paper status before sending bytes, and never queues or sends receipts,
  PINs or device tokens; it does not scan the network. Not yet certified on real hardware.
- **Branch inventory ops (`7.98`)** — a transfer is two steps (send, then receive) so goods in
  transit belong to no branch; that is what keeps a count at the source correct while the van moves.
  A send never moves reserved stock, and a short receive books the shortfall as lost in transit at
  the source rather than letting it vanish between two branch totals. A count applies
  `counted − snapshot` (snapshot taken when the line was first entered), never an absolute, so sales
  during the count survive; applying is refused if it would drop stock below what customers reserved.
  `inventory.count` and `inventory.count.apply` are separate on purpose — walking the shelves and
  signing off the shrinkage are different jobs. Native POS operations derive the source/count branch
  from the authenticated device, verify cashier PIN/RBAC, and use the `9.88` transaction-scoped
  idempotency record so an unknown response cannot send, receive, or apply twice.
- **Decision intelligence (`9.12`–`9.14`)** — Q1/Q2 recommendations are advisory: refreshing an
  action never creates a PO or mutates stock, and lost-sale/restock feedback must represent observed
  demand rather than a guess. Q3 retention uses identified customers and paid orders only. A
  next-product suggestion must come from verified basket history; no evidence means no product.
  Treatment is propose-only (`NEW -> ACCEPTED -> CONTACTED`), holdout rows can never be contacted,
  and conversion attribution is bounded to 30 days before open cases expire. Keep `retention.view`
  independent from `followup.view`; sharing a page must not silently widen either permission.
- **Every `/api/**` route carries its own guard** — `middleware.ts` only protects `/admin/**`; the
  other branch returns `NextResponse.next()`, so a REST route with no check of its own is world-
  reachable. Use `authorizeAdminRoute(permission)` (`lib/bms/adminRouteAuth.ts`): it verifies the
  signed session, honours the drill-down cookie, checks RBAC, and returns `tenantId`/`adminId`/`ctx`.
  **Never read the tenant from the request body** — that rebuilds the same hole behind a login. Pass
  `null` as the permission only for a route that genuinely has none in the catalog. A route that is
  public on purpose (customer widget, marketing demo) needs a `rateLimit()` ceiling, because a public
  endpoint that calls a model spends the operator's money, not the caller's. Legacy single-tenant
  mocks that cannot check a session (`/api/bms/{line,tiktok}/webhook` without a `[tenantId]`) are
  404 in production. Guard: `scripts/inventory-tenant-scope-contract.test.mts`.
- **Nothing touches `bms_inventory` without naming the shop** — the table is keyed by
  `(tenant_id, location_id, product_sku, size)`, so a statement filtered by sku + size alone hits that
  product in *every* shop and branch that stocks it, returns success, and leaves no error behind.
  A reservation is also a branch fact, not a shop-wide one, and it writes a `RESERVE` movement in the
  same transaction — the module's rule that every stock change records a movement has no exceptions.
- **Reserved stock has no ledger of ownership** — `reserved_stock` is a running total; nothing records
  which bill owns which unit. Rebuilding "who is holding this" (`listVariantReservations()`) reads the
  `bms_order_stock_lines` view, because a bundle reserves its *components*; counts only bills in
  `PENDING`/`PAID`/`PACKING`, because `SHIP`/cancel release; and reports the part no bill explains
  instead of hiding it, because stock can be locked with no owner to chase.
- **Cross-tenant jobs** — a manual "run now" over a cron/service function that scans all tenants must
  pass the caller's own `tenantId`. A tenant-scoped grant firing a fleet-wide job is a tenancy leak.
- **Redis** backs five separate things (pub/sub, read-through cache, admin session revocation, job
  runs, GraphQL request-latency metrics behind `/admin/system-health`) — do not conflate them or add
  a new client; reuse `sharedRedisClient` from `lib/cache.ts`. The cache is fail-open; **rate limiting
  is not** (it degrades to a per-instance window, never to "allow everything"). Do not cache
  product/catalog reads — they are intentionally always-fresh.
- **Multi-instance** — file bytes go through `lib/storageDrivers/`, fleet-wide state goes to Redis or
  Postgres (never a module-level `Map`), and a scheduled job that reads-then-acts must claim its
  batch (`FOR UPDATE SKIP LOCKED` or compare-and-set) or two schedulers double-fire it.
- **Env knobs** — a new key/model/URL/rate needs an entry in the `web` service `environment:` block of
  **all three** compose files. `--env-file` does not inject it; a missing one reads as `undefined`
  with no error.
- **Realtime invalidation** — an event is written to `bms_realtime_outbox` in the same tenant
  transaction as the aggregate it describes; a leased dispatcher publishes after commit and
  `apps/ws` never touches PostgreSQL. Realtime is a *hint*: Postgres and the existing reads stay
  authoritative, delivery is at-least-once, and polling/focus refresh stays until replay and load
  are proven. New events use the union, rules, topic builders and validators in
  `packages/realtime` — never a new event string or a raw topic. The surface is one generic stream
  plus 18 named views that all reuse `realtimeTopics()` + `canReceiveRealtimeEvent()` and take **no
  arguments**; never give a named subscription its own authorization. `9.70`–`9.74` and `9.84`–`9.86` have local DB
  contract coverage, including exact POS trigger payloads; production migration state is separate,
  so see the migration rules below before touching them, and
  [docs/agent-invariants.md § Realtime invalidation](agent-invariants.md#realtime-invalidation-architecture)
  for the full set.
- **Typed GraphQL client surface** — `schema.graphql` is committed because production disables
  introspection, and `graphql-schema-artifact-contract` fails if it drifts from the executable
  schema: run `npm run schema:export` in the same change. A mobile/POS operation never accepts
  tenant/location/device/shift from the caller, a money/stock/document mutation carries an
  `idempotencyKey`, and superseded fields are `@deprecated` and kept rather than removed. Client
  errors carry `extensions.code`; business rejections (`PAYMENT_MISMATCH`, `SHIFT_NOT_OPEN`,
  `OUT_OF_STOCK`, `SOLD_OUT_TODAY`, …) stay in `data.<operation>.status` and must not become
  GraphQL errors.

## i18n (long form, including dictionary count history)

Operational scripts on Windows, Linux, and macOS use English for prompts, progress, warnings,
errors, and completion messages, including PowerShell, shell entrypoints, and shared release tools.
Keep authored console text ASCII where practical so it remains readable across code pages and fonts.
Preserve Unicode user data and localized OS-output matching; use Unicode escapes for non-ASCII regex
literals where practical. Keep existing UTF-8 BOMs for Windows PowerShell 5.1 and LF line endings for
Unix scripts. Smoke tests must follow the current English prompts and confirmation steps.

Four mechanisms; the first three are real, the fourth is dead:

1. `apps/web/i18n/` + `useI18n()` — the shared dictionary (**84 namespaces / 5,662 leaf keys per language,
   exact th↔en parity** re-counted recursively on 2026-09-24 — the latest net **+13** covers the
   Restaurant POS incoming-order bell, action banner, intake status and provider-manual guidance;
   the preceding net **+9** covers the shared POS
   online/fallback/offline connection control across retail, Restaurant and Board Game; the preceding net **+11** for the Restaurant POS
   other-work hub, direct workflow navigation and consistent restaurant identity; the preceding net **+12** for the shared in-memory
   Restaurant POS operator session, verified employee switching, lock/account menu and shift-status
   guidance in both languages; the preceding net **+3** for the provider-issued POS
   payment-QR configuration guidance; the preceding net **+54** against the same recursive
   count of `HEAD`: board-game automatic pass renewal, typed play-time offers, member-pass payment
   targets and the compact renewal badge in both languages; the preceding net **+4** for visible login and registration
   submit progress; the preceding net **+14** for board-game reservation
   advance-time, request-expiry and deposit-policy controls plus payment-target labels; the preceding net **+50** against the same recursive
   count of `HEAD`: board-game one-group close and close-all, the seating move/merge controls, and the
   member-pass catalogue/sale/cancel screen in both languages;
   the preceding change is net **+2**:
   board-game fake-data guidance and the one-click fixture summary; the preceding change is net **+24**:
   board-game time alerts, member lookup and public nearby-store discovery cover publishing controls,
   coordinates, aggregate availability and public-preview guidance in both languages; the preceding change is net **+120**:
   board-game table operations cover floor status, timed sessions, participant bill groups, game loans,
   rates, library setup, and POS handoff in both languages; the preceding change is net **+4**:
   realtime connection-state banners explain connecting, reconnecting, offline and degraded operation;
   the preceding change is net **+6**:
   global order-action and Inbox alerts explain how to open the work or chat and unblock device audio; the
   preceding change is net **+13**:
   restaurant member-enrollment labels cover the confirmed-not-found state, inline form validation,
   success/already-member outcomes and automatic attachment to the table check; the preceding change
   is net **+5**: both POS surfaces explain the server-derived points result before payment; the
   preceding change is net **+19**: restaurant table-call labels cover the live POS badge, request queue and acknowledge/complete
   workflow in both languages; the preceding change is net **+415**:
   the new `pos_restaurant` namespace makes the full restaurant register bilingual, including floor,
   order, kitchen, queue, QR intake, bills, shift, payment and operational modals; a dedicated contract
   rejects any new hardcoded Thai UI copy while deliberately allowing the shared `฿` currency symbol
   and Thai product-name matcher regexes. The preceding change is net **+9**: the
   `admin_restaurant_floor` namespace adds table-QR issue, print, download and rotation labels; the
   preceding change is net **+54**: the
   `admin_restaurant_floor` namespace adds 53 keys for the branch/area/table/layout editor and
   `admin_nav.restaurant_floor` adds its menu label; the preceding change is net **−23**: the
   new `admin_nav` namespace adds 75 keys (72 for the menu itself, +3 for the command palette:
   search_placeholder, search_hint, search_empty) (task-based sidebar sections, workspace names, and every
   menu label, including the ones that used to be hardcoded English string literals in
   `AdminSidebar.tsx`), and the 40 now-dead `admin.menu_*`/`admin.group_*` keys were deleted rather
   than left behind as a second copy of every menu name — the `admin` namespace is down to 20 keys.
   ⚠️ Menu labels are read as `t(item.labelKey)` from `lib/bms/adminNavigation.ts`, so the literal
   scanner in `i18n-keys-contract` cannot see them — `admin-navigation-contract` resolves every one
   against both dictionaries instead;
   the preceding +2 are signup progress/timeout feedback;
   the preceding +66 are the archetype-aware shop experience,
   human-readable stock-policy, progressive-disclosure, signup and special-mode labels; the preceding +52 are the product catalog draft/readiness,
   sales-surface, duplicate, modifier-group, and quick-ingredient labels; the preceding +2 are the Restaurant permission-group
   and modifier-surcharge labels, the preceding +14 are bilingual shop-archetype labels, the
   preceding +2 are store-archetype lock labels, and the preceding +7 are store-profile receipt-language labels;
   the +20 on 2026-08-25 were `AdminSidebar.tsx`'s Store/Pharmacy
   submenu child labels, which had been plain English string literals inside an otherwise-converted
   file; see [agent-invariants.md § i18n coverage](agent-invariants.md#i18n-coverage-what-bilingual-actually-means-today)).
   This is what the per-user language preference switches.
   **A key must live in the namespace its `t()` prefix names.** `getMessage()` returns the key itself
   on a miss, so a key filed under the wrong section renders `admin_products.col_variant_price` on a
   shop's screen while `tsc`, the build, and every test stay green — it has happened twice in two
   commits. `scripts/i18n-keys-contract.test.mts` resolves every literal `t()` key in both languages
   and checks section-by-section parity; a key built at runtime is invisible to it and still needs
   care.
2. `resolveBilingual()` (`lib/static-page-i18n.ts`) — page-local content objects. Use for new
   prose-heavy public pages.
3. Inline `lang === "en" ? … : …` — used by `/shop/**` and `/checkout` metadata. Fine as-is.
4. `lib/i18n.ts` + `useTranslation()` + `locales/` — **dead**; delete rather than extend.

Coverage: all public/auth/legal pages, storefront, checkout, nav chrome, and **57 of 99** admin
`.tsx` files. The remainder are layout/loading guards and English-only legacy platform pages
(`admin/roles`, `admin/logs`, `admin/files`, `admin/posts`/`post/**`, `admin/operations-schedule`,
`admin/dev/sql-console`) — not Thai leaks.

**Thai a grep will flag but that must NOT be "fixed"**: customer-facing brand voice, regexes matching
a customer's raw typed Thai, CRM tag *values*, the CSV import template's header map,
`admin/playground` sample prompts, `฿`, and `admin/pharmacy-review-mockup`'s mock case data.

Counts are snapshots — re-run
`grep -rl "useI18n\|resolveBilingual" "apps/web/app/(admin)/admin" --include=*.tsx | wc -l` rather
than trusting them, and update this section after any i18n pass. Per-file detail and the reusable
per-user-preference pattern:
[agent-invariants.md § i18n](agent-invariants.md#i18n-coverage-what-bilingual-actually-means-today).

## Testing and verification (long form with suite table)

One command runs the merge gate — typecheck, every database-free contract suite, then a
production build:

```bash
cd apps/web && npm run gate
```

`npm run test:pure` runs only the suites (fast, no database); `npm run test:db` runs the
`-db-contract` suites and refuses a non-local host. The runner walks `scripts/` **and**
`scripts/ai-eval/`, so a contract test placed in either directory runs in CI — a suite that only
runs by hand does not run. `.github/workflows/gate.yml` runs typecheck + pure + build on every
PR. (`apps/ws`, `packages/graphql-core`, `packages/realtime` each have their own `npm run build`.)

- Never claim a check passed unless it was run successfully.
- Schema changes: migration ordering, idempotency, RLS, grants, tenant isolation.
- API changes: authentication, permission denial, invalid input, success path.
- Order/inventory/payment: state transitions, rollback, duplicate requests, stock invariants.
- AI changes: verified facts, missing facts, malformed model output, provider failure, deterministic
  fallback.
- Deterministic contract suites need **no network or database** — run the ones covering what you
  touched (`cd apps/web && npx tsx --test ../../scripts/<path>`):

| Suite | Covers |
| --- | --- |
| `ai-eval/runtime-contract` | tool runtime, RBAC/surface denial, propose-only, usage accounting |
| `ai-eval/slip-reader-contract` | OCR adapters, provider fallback, cost attribution |
| `ai-eval/customer-policy-contract` · `customer-message-routing-contract` | customer reply policy and routing |
| `ai-eval/checkout-token-contract` | signed checkout link scope/tamper/expiry |
| `ai-eval/archetype-policy-contract` · `restock-lifecycle-contract` · `pharmacy-intake-contract` | archetype policy · restock consent · pharmacy intake |
| `ai-eval/work-assistant-knowledge-contract` | catalog ids/bilingual fields, permissions resolve, every guide route renders, Sidebar + Admin page coverage, page context re-ranks but never fabricates a match, register surface excludes back-office guides, capability status honesty |
| `ai-eval/work-assistant-surface-contract` | additive GraphQL surface, page context stays a hint, deterministic help without a provider, tenant-scoped staff lookup, Drawer shows mutation args and reviews an emailed recipient |
| `auth-identity-contract` · `user-admin-contract` | auth identity · staff management |
| `multi-item-request-contract` · `pharmacy-trigger-contract` · `pharmacy-policy-decision-contract` | multi-item message splitting/pack units · pharmacy product-vs-symptom classification · basket-wide policy blockers |
| `pharmacy-approval-reuse-db-contract` | one pharmacist approval backs exactly one order; consumed in the sale's own transaction (creates and drops its own tenant) |
| `pharmacy-clinical-evidence-db-contract` | three evidence kinds, shape CHECK, cross-tenant refusal, soft delete, and `file_id` never reaching a client |
| `file-visibility-contract` | `/api/files` guards, fail-closed visibility check, tenant match on owned files, and every upload site's public/private + owner choice |
| `secret-fallback-contract` | every secret resolver throws in production, none is a module-level const with a string fallback |
| `infra/multi-instance-contract` | storage driver, fleet-wide state, cron claim-before-act |
| `i18n-keys-contract` | every literal `t()` key resolves in th+en; per-section key parity |
| `board-game-cafe-contract` · `board-game-register-contract` · `board-game-pos-parity-contract` | table/seating/billing-group source contracts and derived table status · the register's phone geometry and the money a running table may print · browser REST and native GraphQL reach the same command set through one permission table |
| `board-game-pass-contract` · `board-game-identity-contract` · `board-game-offers-renewals-contract` | pass coverage math and quota spend at close · identity-hold purge/reveal gating · offer selection vs pass coverage, and renewal as one atomic entitlement + payment + credit-ledger write |
| `board-game-waitlist-contract` · `board-game-service-call-contract` · `board-game-readiness-scope-contract` | queue/reservation state before a session, seating in one transaction · the guest bell moves nothing but staff attention · every table path is declared in `schemaReadiness` |
| `pos-route-guard-contract` · `pos-approvals-contract` · `pos-cash-formula-contract` | every `/api/pos` route authenticates the device, writes verify a person's PIN unless the exception carries a live reason, and scope never comes from the body · approver lists match the permission the counter really checks · one drawer-expectation formula |
| `support-diagnostics-contract` · `support-diagnostics-extra-contract` | tenant-scoped append-only events that never trust a tenant from the body, separately authorised export/send, and native POS telemetry attributed to the device and filtered server-side · the RLS/grant shape the fleet-wide retention job depends on, and a caller-supplied range answering 400 instead of paging ops |
| `restaurant-pos-contract` | dine-in check/round/settlement source contracts: one settlement path, atomic round replacement, branch-scoped KDS, restaurant-specific permissions, server-owned modifier pricing |
| `kitchen-board-contract` · `kitchen-station-contract` | ticket grouping/counting/SLA on the register KDS · station master (id-first matching, branch scope, name snapshot, active-but-retiring) |
| `store-capability-gates-contract` | the capability switch list and every `isCapabilityEnabledInTx()` call site match exactly, in both directions |
| `product-catalog-foundation-contract` · `product-policy-reachability-contract` · `non-stock-policy-contract` | catalog variants as serving-option truth, sales-surface channel authority, draft-only new products · every stock policy has a real settings path and matches what readiness/capability gating actually checks · `NON_STOCK` zero-consumption vs. no-snapshot-at-all stays distinct |
| `shop-archetype-coverage-contract` | every archetype's onboarding checklist/AI examples resolve in both languages; no orphaned copy |
| `menu-availability-contract` · `restaurant-online-order-contract` · `restaurant-order-cancellation-contract` | sold-out flag scoping/reset signals · explicit branch+fulfillment+human-accept for online orders · line cancellation reuses the return engine with an immutable cause |
| `order-stock-lines-contract` | every stock-moving write path reads `bms_order_stock_lines`, never `bms_order_items`, for what a bill actually consumed |
| `ar-contract` | credit-sale approval/limit math and ledger transfer of an over-collected credit to the oldest open invoice |
| `inventory-tenant-scope-contract` | every `bms_inventory` statement is tenant-scoped; every `/api/bms` route has a guard; the reserve route never takes a tenant from the body; no guard is skippable when its secret is unset |
| `realtime-event-contract` · `realtime-subscription-auth-contract` | envelope validation, redaction, audience→topic derivation · the one authorizer, fed real cross-tenant/cross-branch/wrong-device/missing-permission/flag-off cases instead of grepping the resolver |
| `realtime-outbox-contract` · `realtime-domain-contract` | leased claim/ack/nack/backoff and the fail-closed dispatch endpoint · trigger shape and in-transaction enqueue |
| `realtime-domain-coverage-contract` | walks every `INSERT`/`UPDATE`/`DELETE` against tables `lib/bms` writes and fails unless that operation has a trigger or an explicit reason — the guard against a whole domain or one write kind going silent; `9.85` closed the prior 20 table gaps and `9.86` closed parked-sale deletion |
| `realtime-named-subscriptions-contract` · `realtime-client-contract` · `realtime-ws-security-contract` · `realtime-ws-ticket-contract` | the 18 named views map to event types and share one authorizer · bounded dedup/batched invalidation/reconnect refetch · origin/size/quota/expiry/one-root-field gateway bounds · ticket minting and claims |
| `mobile-graphql-contract` · `graphql-schema-artifact-contract` | typed inputs/outputs read from the parsed SDL, field↔resolver both ways, no caller-supplied authority, JSON countdown · committed `schema.graphql` matches the executable schema |
| `graphql-action-alias-contract` · `graphql-error-contract` · `react-native-graphql-doc-contract` | named actions delegate to the kept `@deprecated` field with a fixed action and no duplicated service call · every client error carries a code while business status stays in `data` · every documented example validates against the real schema |
| `mobile-transport-compat-contract` | Android reaches HTTP GraphQL and mints a ticket with a Bearer token, user-scope tickets never carry the POS permission set, and the REST routes the browser still depends on exist and still authenticate |
| `tax-leak-contract` · `tax-report-contract` · `tax-document-number-contract` · `vat-contract` | `line_amount` money authority and per-line promotion allocation, full-invoice eligibility, back-office refusal of taxed bills · VAT report arithmetic (base excludes VAT, credit notes negative, exempt/rounding separate, Thai-era dates) · document numbering · VAT rounding against hand-computed golden invoices |
| `expense-documents-contract` | input-VAT eligibility, Thai tax-id checksum, withholding-tax fields, void-not-delete, normalised duplicate invoice key |
| `pos-offline-tender-contract` · `offline-continuity-contract` | Emergency Offline evidence columns and the cash-only, original-idempotency-key replay boundary |
| `delivery-platform-contract` · `delivery-platform-hardening-contract` · `restaurant-delivery-readiness-contract` | capability matrix and verified-mapping intake · OAuth token cache and single 401 refresh, logical webhook id vs payload hash, transport-decided lifecycle · restaurant onboarding defaults to no-recipe menus and delivery reuses flat shipping, prepaid packing and `OTHER` rider tracking |
| `social-auth-settings-contract` · `bms-flow-data-contract` | per-surface switch AND config readiness, env-only secrets · `/how-it-works` flow data (unique ids, edges/scenarios resolve, no unverified provider names) |
| `retail-local-contract` · `retail-local-managed-runtime-contract` · `retail-local-release-download-contract` · `retail-local-release-upload-contract` · `retail-local-request-body` | local profile shape (loopback, no seeded admin, migration ledger) · installer/runtime scripts per platform · public vs onboarding download access · raw streamed release upload · licensing APIs bound chunked JSON before buffering |
| `retail-local-license-control-plane` · `retail-local-license-mailbox` · `retail-local-license-ui` · `retail-local-optional-activation` · `retail-local-activation-retry` · `retail-local-installation-registry` | evidence-only signed licence ingestion · Web-to-host request mailbox · shop licence page · setup never redeems a code · exact code + request-id replay only · instance registry without hardware identity |
| `cloud-tax-request-buyer-contract` · `tax-invoice-pdf-bundle-contract` | receipt-QR buyer shape: legacy/structured/contact fields stay readable and the invoice address is composed server-side · the tax invoice PDF renderer bundled the way the server bundles it, with the Thai font embedded |
| `ai-usage-cost-policy-contract` · `ai-limit-status-contract` · `ai-usage-client-contract` | monthly AI points as entitlement and cost as reporting only · notice levels, personal-notice auth and the Bangkok month boundary · the client refreshes the real server balance after an AI operation instead of guessing |
| `customer-answer-evidence-contract` · `location-parking-contract` · `restaurant-floor-publication` · `ai-eval/parking-reply-contract` | answer provenance capture/status words · published-only parking facts · floor-editor publication keeps unsaved drafts and the saved setting on failure · parking replies grounded in the latest branch facts |
| `ai-eval/board-game-chat-actions-contract` · `ai-eval/contextual-conversation-choices-contract` · `ai-eval/contextual-conversation-pipeline-contract` | chat booking preview/consent/auto-confirm boundaries · server-owned contextual choices across stock, board-game and pharmacy |
| `customer-merge-review-contract` · `web-chat-session-contract` | signed, reviewed customer merges with in-transaction audit · tenant-bound signed web-chat sessions |
| `mailer-smtp-contract` · `central-scheduler-contract` · `scheduler-diagnostics-contract` · `app-download-settings-contract` | SMTP TLS rules and reply-to normalisation · scheduler registry/one-owner dispatch · scheduler diagnostics · HTTPS-only platform download links |
| `installer-reports-contract` · `retail-local-sample-data-contract` | consent-gated, size/rate-bounded, allow-listed installer report intake · versioned archetype manifest, a Starter Catalog per archetype, registry-backed sample cleanup |

  Suites that need a real Postgres **write to it** — dev only, never production. They create and
  remove their own rows (`scripts/variant-reservations-db-contract.test.mts` covers reservation
  attribution incl. bundles and unexplained holds; `scripts/reserve-stock-db-contract.test.mts`
  covers cross-shop/cross-branch reservation, the ledger row, and rollback). Run them from
  `apps/web` with the `next-runtime-shim` import and `--test-concurrency=1`; the exact command lives
  in [CLAUDE.local.md](../CLAUDE.local.md). `gate.yml` does **not** run this mode, so "pure is green"
  never means the database path was exercised. Newer DB suites follow the same rule:
  `tax-backoffice-guards-`, `tax-sales-report-`, `tax-document-numbering-`, `stock-ledger-`,
  `expense-documents-`, `delivery-platform-hardening-`, `retail-local-license-`,
  `retail-local-sample-data-`, `retail-local-onboarding-all-archetypes-`,
  `installer-reports-`, `ai-budget-`, `ai-entitlement-authority-`, `ai-limit-notices-`,
  `retail-local-ai-`, `customer-answer-evidence-` and `board-game-chat-actions-db-contract`.
  Browser smokes (`tax-request-email-`, `tax-request-form-`, `customer-merge-`, `answer-evidence-`,
  `ai-usage-`, `retail-local-ai-browser-smoke.mjs`) run only by hand.

  `realtime-outbox-db-contract` and `realtime-domain-db-contract` additionally need migrations
  `9.70`–`9.74` and `9.84`–`9.86`. They have local DB contract coverage, but production-like rollout still uses the throwaway instance in
  [docs/architecture/realtime-test-database.md](architecture/realtime-test-database.md)
  (separate cluster because the dispatcher role is cluster-scoped, restored from a dump because
  `db/migrations` cannot build an empty database) and record a **baseline before** applying them —
  a suite that was already red is not a regression.

  `apps/mobile` and `apps/desktop` each carry their own suite — Jest for the RN client, `node --test`
  for the desktop pairing/keystore units — and `gate.yml` runs neither, so run them from that app
  when you touch it. `.github/workflows/desktop-{windows,linux,macos}.yml` lint and test the desktop app
  and build that platform's packages on its own runner — NSIS on Windows, AppImage/DEB on Linux,
  the two DMGs on macOS — then upload a 14-day artifact. None signs, notarizes or publishes.

  The contract runner only picks up `*.test.mts`. `.github/workflows/retail-local-managed-runtime.yml`
  runs the Go agent tests (`apps/retail-local-agent`) and the Retail Local shell/Node suites on
  Ubuntu, Windows and macOS runners: `retail-local-bootstrap-behavior.test.mjs`,
  `retail-local-unix-diagnostics.test.mjs`, `retail-local-update-transaction.test.sh` and
  `retail-local-uninstall-container.test.sh`. `retail-local-setup-diagnostics.test.ps1`,
  `retail-local-migration-checksum.test.mjs` and `installer-reports-browser-smoke.mjs` run only by
  hand.

  The **live-model** suite (`scripts/ai-eval/run.mjs`) writes real data — development/sandbox tenants
  only. See [scripts/ai-eval/README.md](../scripts/ai-eval/README.md).

