# Board-game manual review — 2026-10-28

Scope: recheck every lesson in the public board-game learning path against implementation,
expand missing operating procedures, and reconcile the older Admin and root setup guides.
No money, inventory, authentication, AI runtime, database or device behavior is changed.

The path now contains **40 bilingual lessons** (24 existing + 16 new). The shared catalogue has
44 unique articles; the restaurant path remains 20 articles. Canonical public entry:
`/learn/board-game`. Content is authored in `apps/web/lib/learning/catalog.ts`; internal sources
listed here are review evidence, not imported into the public bundle.

## Corrections with operational consequences

1. Grace is deducted before rounding and minimum enforcement. With THB 60/hour, minimum 60,
   rounding 30 and grace 5, 4/65/66 minutes produce 60/60/90 before benefit/tax treatment.
   The old root guide incorrectly called grace universally free time.
2. `charge_end_at` is the later of actual departure/close and `planned_end_at`. Purchased time is
   a minimum commitment, not an automatic stop/cap. Alerts do not close a visit; session timing
   changes do not rewrite independently purchased DURATION end times.
3. Billing groups settle independently with separate receipts. The old Admin guide incorrectly
   described multiple groups as time lines on a single receipt. Closing is not payment.
4. Existing participants do not have a general reassign-to-another-bill UI. Group numbers are
   assigned on entry; OPEN groups can merge within a session or detach to a new table subject
   to source-group and loan/hold rules. The old root guide advertised unrestricted later splitting.
5. Queue service day subtracts four hours in the store timezone. Timezone is configured in the
   store profile, not the public branch form. Analytics has effective-dated seven-day hours;
   neither those hours nor descriptive opening-hours text restrict reservation windows.
6. Seating a queue entry already creates the session atomically. Do not instruct staff to open a
   second session after seating. External/phone bookings are not automatically synchronized.
7. Website requests, staff bookings and CHAT bookings have different flows. Website deposit policy
   is frozen at staff confirmation; submitted evidence is not PAID. CHAT is no-deposit only, has
   no public management token/email approval notification, and needs the latest customer consent.
8. The Admin Sell pass form calls `issueBoardGameMemberPass` and records entitlement/price. It has
   no tender/payment confirmation/receipt step. Its stored `price_paid` is not proof of collected
   money. The guide requires a verified payment/accounting process before offering paid passes.
   Automatic renewal is a different path and does create a confirmed payment plus credit redemption.
9. Rates/plans/offers derive codes from names in these forms; purely Thai names can normalize to
   empty codes. Document unique Latin/digit-containing name examples as the current workaround.
   Do not pretend the forms have a separate code input or change the money services in a docs task.
10. Problem returns default to NEEDS_CHECK. The web UI lacks a complete standalone post-repair
    lifecycle editor; supported backend statuses alone do not prove an operator has such a button.
11. Held-document number reveal is optional-number, restricted, audited and back-office only.
    The current reveal button does not ask for a mandatory reason. Release purges holder details.
12. AI usage help is not guaranteed retrieval of every public article. Staff report tools are
    scoped and read only; customer LINE tools cannot access owner reports or approve money changes.

## Coverage and source matrix

Paths below are relative to the repository root. Review both the UI adapter and service;
backend availability alone is not sufficient to publish step-by-step UI instructions.

| Public lesson(s) | Implementation evidence and review focus |
|---|---|
| `start-here` | `apps/web/app/(admin)/admin/settings/StoreProfileCard.tsx`; archetype lock in `db/migrations/9.43*`; setup/cutover ownership remains a shop procedure, not an automatic import |
| `branches-hours`, **`board-game-hours`** | `StoreProfileCard.tsx`; `boardGameWaitlist.ts` SERVICE_DATE_SQL; `boardGameCafe.ts` public profile inputs; `BoardGameAnalyticsPanel.tsx` hours editor; `boardGameAnalytics.ts` upsert/list hours |
| `staff-permissions`, **`board-game-permissions`** | `lib/bms/permissions.ts`, `pos.ts` PIN gates; `boardGamePosOperations.ts` command permission/shift table; Admin UI permission checks; tenant/branch route access |
| `products-import`, `inventory` | Products/stock import, stock-transfer/count service boundaries and existing POS manual; tab add reserves sale stock; library lending does not move it |
| `tax-receipts`, `payments-qr` | POS/manual, `pos.ts` frozen totals, payment/return allocations and receipt extra lines; no claim that PDF delivery is e-Tax or a displayed QR is confirmed payment |
| `pos-devices`, `desktop-hardware` | POS Devices and app-downloads UI; `apps/desktop/README.md`; Desktop display settings/manual release download; physical printing remains an installation acceptance check |
| `board-game-tables` | `boardGameCafe.ts` upsert area/table, open-session, seating reads; Admin settings forms; no invented table maintenance editor |
| `board-game-rates` | `boardGameBillableMinutes`, `prepareParticipantInTx`, `calculateBoardGameGroupCharges`, `adjustBoardGameSessionTiming`; Admin rate form and POS participant time modes |
| **`board-game-offers`** | `boardGameOffers.ts` eligibility, buy/get cycles and best-offer result; `calculateBoardGameGroupCharges` whole-group pass/offer comparison; Admin Offers form and frozen checkout explanations |
| `board-game-library`, **`board-game-game-issues`** | `boardGameCafe.ts` title/copy create, checkout/return; `BoardGamePanel.tsx` normal/problem return; `BoardGameCopyPicker.tsx`, `BoardGameCopyLabels.tsx`, `BoardGameImageEditor.tsx`; no fake post-repair UI |
| **`board-game-public`** | `boardGameCafe.ts` public/chat readers and profile flags; `BoardGameDirectoryView.tsx`; `BookingManageView.tsx`; public booking/payment routes; current staff confirmation and email behavior |
| `members-coupons`, `balances-privacy` | POS member preview/checkout, coupon/loyalty boundaries; member search route; store-credit controls are not universally wired in POS; customer migration/consent are explicit shop procedures |
| **`board-game-passes`** | `boardGameCafe.ts` issue/cancel/pass selection/consume/reversal/outstanding; `boardGamePassCoverage.ts`; `/api/bms/board-game/passes`; Admin pass form; no implied payment from issuance |
| **`board-game-renewals`** | `boardGamePassRenewals.ts` funding-owner checks, due-cycle payment/credit transaction, failure/retry, pause/resume/cancel; Admin renewal forms and scheduler dependency |
| `shifts` | `pos.ts` device-owned shift/drawer/approval workflows; existing POS manual; handoff requires outstanding sessions, bills, loans, holds and refunds |
| **`board-game-waitlist`**, `board-game-reservations` | `boardGameWaitlist.ts` add/call/check-in/seat/update/expiry; `BoardGamePanel.tsx` queue/reservation controls; no guaranteed FIFO or predicted vacancy |
| **`board-game-deposits`** | `reviewPublicBoardGameReservation`, `submitPublicBoardGameReservationDeposit`, arrival gates, cancellation; `pos.ts` original-payment deposit allocation/unused remainder; public management UI |
| `board-game-service`, **`board-game-tab`** | `boardGameCafe.ts` add/leave participant, add/remove tab, stock-reservation rebuild; `BoardGamePanel.tsx` groups/modifiers/serial refusal and timing controls |
| **`board-game-service-qr`** | `boardGameServiceCalls.ts`; POS guest-link and acknowledge/complete controls; session-scoped access, duplicate requests and intent-only food/time/bill calls |
| **`board-game-collateral`** | `boardGameIdentity.ts`; Admin reveal button; POS hold/release; last-group/session-cancel/final-settlement hold gates; release-time erasure |
| `board-game-move-split` | `boardGameCafe.ts` seating move/merge, billing merge/detach; explicit over-capacity decision and selected loan/hold transfer; no general participant reassignment |
| `board-game-checkout`, **`board-game-cancel-errors`** | close group/session, cancellation guards, pass reversal and tab release; POS settlement, receipt evidence and return/void boundaries; CLOSING ≠ PAID |
| `line-ai-booking` | `boardGameReservationPolicy.ts`, `boardGameChatActions.ts`, `boardGameWaitlist.ts` CHAT preview/write; latest consent, 15-minute expiry, three-active-future cap, same-table rescheduling and human handoff |
| `reports-ai`, **`board-game-analytics`**, **`board-game-ai-owner`** | `boardGameAnalytics.ts`, `boardGameOwnerReads.ts`, `tools/boardGameAnalytics.ts`, `graphql/bmsBoardGameAnalytics.ts`, `BoardGameAnalyticsPanel.tsx`, assistant knowledge/runtime coverage; 92-day reports, separate scopes/cost access and XLSX export |
| `returns-recovery`, `outages-support` | POS original-bill return/refund/void/idempotency, cashier approver and active-tax-document gates; no board-game emergency offline or arbitrary reopen promise |
| `launch-checklist`, **`board-game-rehearsal`** | Derived acceptance scenarios from all above; no claim that reading completion verifies actual equipment, accounts or production readiness |

Primary domain source paths above are under `apps/web/lib/bms/`; Board-game Admin UI is under
`apps/web/app/(admin)/admin/board-game/`; POS panel is under `apps/web/components/pos/`.
Supporting schema history: migrations `9.80`, `9.89`–`9.94`, `9.96`, `9.99`, `10.0`–`10.7`,
`10.40`, `10.48`–`10.50`, `10.89`; domain rules: `docs/agent-invariants.md` Board game cafe section.

## Scope limits and remaining product work

The manual describes existing workflows and explicitly marks gaps. This review does not implement:

- General participant reassignment/reopening a frozen bill.
- Complete paid-pass tender/receipt collection in the Admin issue form.
- Full post-repair copy lifecycle or table-maintenance controls in the web UI.
- Automatic holiday/hour booking enforcement or external booking synchronization.
- Generic POS store-credit funding/redemption, stored-card renewal, board-game emergency offline.
- A verified production e-Tax provider, public owner-data chat, or automatic ingestion of all
  public lessons into staff AI knowledge.

Manual updates alone cannot certify installation-specific printing, secondary displays, banking,
email, LINE delivery or scheduling. The launch scenarios require operators to record actual
expected/observed outcomes on their own test installation before go-live.

## Validation

Use the existing learning-centre contract for unique bilingual lessons, valid destinations and
complete track membership. The browser smoke follows all 40 board-game contents links in Thai
and English, checks steps and 320px overflow, and exercises desktop/mobile, print, search,
progress, navigation and anonymous-session isolation. The Admin guide retains its existing
board-game contract coverage. Run the repository gate for type checking, pure contracts and build.

Results for this review:

- `cd apps/web && npm run gate`: passed typecheck, 278 pure suites/files (3,081 passed tests,
  6 skipped, 0 failed), and production build.
- `scripts/learning-center-browser-smoke.mjs`: passed; followed all 40 board-game article URLs
  in each language, with 320px overflow checks and representative 390/1440px screenshots.
  Visually inspected the Thai mobile deposit guide and English desktop rehearsal guide.
- Read-only arithmetic check against the actual `boardGameBillableMinutes`,
  `applyBoardGamePassCoverage` and `applyBestBoardGameOffer` functions passed the published
  60/60/90 grace/minimum examples, THB 30 pass remainder and THB 120 buy/get example.
- `git diff --check`: passed. No database mutation tests, live bank/LINE/email sends or physical
  device validation were performed for this documentation change.
