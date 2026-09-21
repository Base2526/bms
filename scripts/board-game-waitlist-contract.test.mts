import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const migration = read("db/migrations/9.99__bms_board_game_waitlist.sql");
const reservationMigration = read("db/migrations/10.0__bms_board_game_advance_reservations.sql");
const publicMigration = read("db/migrations/10.1__bms_board_game_public_reservations.sql");
const completionMigration = read("db/migrations/10.2__bms_board_game_reservation_completion.sql");
const service = read("apps/web/lib/bms/boardGameWaitlist.ts");
const cafe = read("apps/web/lib/bms/boardGameCafe.ts");
const operations = read("apps/web/lib/bms/boardGamePosOperations.ts");
const graphql = read("apps/web/graphql/bmsPosDevice.ts");
const browser = read("apps/web/components/pos/BoardGamePanel.tsx");
const browserCss = read("apps/web/app/(pos)/pos/pos.css");
const mobile = read("apps/mobile/src/screens/boardGame/BoardGameScreen.tsx");
const expiryRoute = read("apps/web/app/api/bms/board-game/reservations/expire/route.ts");
const reminderRoute = read("apps/web/app/api/bms/board-game/reservations/remind/route.ts");
const publicRoute = read("apps/web/app/api/board-game/bookings/route.ts");
const publicManageRoute = read("apps/web/app/api/board-game/bookings/[token]/route.ts");
const publicPaymentRoute = read("apps/web/app/api/board-game/bookings/[token]/payment/route.ts");
const publicDirectory = read("apps/web/app/(main)/board-game/BoardGameDirectoryView.tsx");
const publicManage = read("apps/web/app/(main)/board-game/booking/[token]/BookingManageView.tsx");
const payments = read("apps/web/lib/bms/payments.ts");
const pos = read("apps/web/lib/bms/pos.ts");
const cronWorkflow = read(".github/workflows/bms-cron.yml");
const cleanup = read("apps/web/app/api/dev/fake/cleanup/route.ts");
const platform = read("apps/web/lib/bms/platform.ts");
const dbContract = read("scripts/board-game-waitlist-db-contract.test.mts");

test("9.99 stores one tenant/branch service-day queue with honest terminal shapes", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_board_game_waitlist/);
  assert.match(migration, /UNIQUE \(tenant_id, location_id, service_date, queue_no\)/);
  assert.match(migration, /'WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW'/);
  assert.match(migration, /status = 'SEATED'[\s\S]*seated_table_id IS NOT NULL[\s\S]*seated_session_id IS NOT NULL/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /create_revision_trigger\('bms_board_game_waitlist'\)/);
  assert.match(migration, /'board_game\.waitlist\.changed'/);
});

test("seating a queue row and opening the real session share one transaction", () => {
  assert.match(service, /beginTenantTx\(client, input\.tenantId/);
  assert.match(service, /SELECT party_size, reserved_table_id FROM bms_board_game_waitlist[\s\S]*FOR UPDATE/);
  assert.match(service, /openBoardGameSessionInTx\(client, input\.tenantId/);
  assert.match(service, /SET status = 'SEATED'[\s\S]*seated_session_id = \$5/);
  assert.match(service, /await client\.query\("COMMIT"\)/);
  assert.match(cafe, /export function openBoardGameSessionInTx/);
  assert.doesNotMatch(service, /INSERT INTO bms_board_game_sessions/,
    "the queue must reuse the normal open-session path, not copy its SQL");
});

test("10.0 adds a future table window without creating another session or money path", () => {
  assert.match(reservationMigration, /ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'WALK_IN'/);
  assert.match(reservationMigration, /'CONFIRMED', 'WAITING', 'CALLED', 'SEATED'/);
  assert.match(reservationMigration, /reserved_duration_minutes BETWEEN 30 AND 720/);
  assert.match(reservationMigration, /bms_board_game_waitlist_reserved_table_fk/);
  assert.match(service, /board-game-reservation:\$\{input\.tenantId\}:\$\{input\.locationId\}:\$\{input\.tableId\}/);
  assert.match(service, /reserved_for < \$4::timestamptz \+ make_interval/);
  assert.match(service, /status = 'WAITING', checked_in_at = now\(\)/);
  assert.match(service, /โต๊ะนี้ยังมี session ที่ยืนยันไม่ได้ว่าจะจบก่อนเวลาจอง/);
  assert.doesNotMatch(reservationMigration, /INSERT INTO bms_payments|INSERT INTO bms_orders/,
    "a table reservation must not invent a second payment or order path");
});

test("queue mutations stay in the shared POS command table and both registers expose them", () => {
  for (const action of ["waitlist.add", "waitlist.call", "waitlist.close", "waitlist.seat"]) {
    assert.match(operations, new RegExp(`"${action.replace(".", "\\.")}"`));
  }
  for (const action of ["reservation.add", "reservation.check_in", "reservation.update", "reservation.review"]) {
    assert.match(operations, new RegExp(`"${action.replace(".", "\\.")}"`));
  }
  for (const mutation of [
    "bmsPosAddBoardGameWaitlistEntry", "bmsPosCallBoardGameWaitlistEntry",
    "bmsPosCloseBoardGameWaitlistEntry", "bmsPosSeatBoardGameWaitlistEntry",
    "bmsPosAddBoardGameReservation", "bmsPosCheckInBoardGameReservation",
    "bmsPosUpdateBoardGameReservation", "bmsPosReviewBoardGameReservation",
  ]) {
    assert.match(graphql, new RegExp(mutation));
  }
  assert.match(browser, /action: string/);
  assert.match(browser, /'waitlist\.add'/);
  assert.match(browser, /'waitlist\.seat'/);
  assert.match(mobile, /MobilePosAddBoardGameWaitlistEntryDocument/);
  assert.match(mobile, /MobilePosSeatBoardGameWaitlistEntryDocument/);
  assert.match(browser, /'reservation\.add'/);
  assert.match(browser, /'reservation\.check_in'/);
  assert.match(browser, /'reservation\.update'/);
  assert.match(mobile, /MobilePosAddBoardGameReservationDocument/);
  assert.match(mobile, /MobilePosCheckInBoardGameReservationDocument/);
  assert.match(mobile, /MobilePosUpdateBoardGameReservationDocument/);
  assert.match(browser, /'reservation\.review'/);
  assert.match(mobile, /MobilePosReviewBoardGameReservationDocument/);
});

test("mobile normalizes human booking date/time before POS backend validates the instant", () => {
  assert.match(mobile, /function parseReservationDateInput/);
  assert.match(mobile, /year >= 2400 \? year - 543 : year/);
  assert.match(mobile, /\^\\d\{8\}\$/);
  assert.match(mobile, /function parseReservationTimeInput/);
  assert.match(mobile, /\(\?:\:\|\\\.\)/);
  assert.match(mobile, /วันที่จองไม่ถูกต้อง/);
  assert.match(mobile, /เวลาจองไม่ถูกต้อง/);
  assert.match(mobile, /parseReservationInstant\(\s*reservationStartDate,\s*reservationStartTime/);
  assert.match(mobile, /reservedFor: instant\.toISOString\(\)/);
  assert.match(service, /function reservationInstant\(value: unknown\): Date/);
  assert.match(service, /new Date\(String\(value \?\? ""\)\)/);
  assert.match(service, /เวลาจองต้องเป็นเวลาในอนาคต/);
  assert.match(service, /รับจองล่วงหน้าได้ไม่เกิน 366 วัน/);
});

test("the browser register uses one calendar date for browsing and creating reservations", () => {
  assert.match(service, /w\.service_date::text AS service_date/,
    "a PostgreSQL DATE must stay YYYY-MM-DD so saved bookings match the calendar key");
  assert.doesNotMatch(service, /SELECT_COLUMNS = `[^`]*w\.service_date,/,
    "letting node-postgres parse the service date as Date makes String(...).slice return a weekday label");
  assert.match(browser, /role="grid" aria-label="ปฏิทินการจอง"/);
  assert.match(browser, /calendarDays\(reservationMonth\)/);
  assert.match(browser, /function reservationDateKey/);
  assert.match(browser, /localDateInput\(entry\.reservedFor\)/,
    "the calendar must recover from an old server's malformed service-date during rolling deploys");
  assert.match(browser, /reservationsByDate\.get\(day\.key\)/,
    "month cells must expose the reservations already occupying each day");
  assert.match(browser, /จองแล้ว \{confirmed\}/);
  assert.match(browser, /รอยืนยัน \{requested\}/);
  assert.match(browser, /setReservationDate\(day\.key\)/,
    "clicking a calendar cell must select the day shown in the list and editor");
  assert.ok(
    browser.indexOf('className="pos-bg-reservation-list-head"')
      < browser.indexOf('className="pos-bg-reservation-editor"'),
    "the selected day's booking details must appear before the create form instead of below the fold",
  );
  assert.match(browser, /new Date\(`\$\{reservationDate\}T\$\{reservationTime\}`\)/,
    "the selected calendar day and explicit start time must form the reservation instant");
  assert.doesNotMatch(browser, /type="datetime-local"/,
    "the calendar must replace the ambiguous second date field, not sit beside it");
  assert.match(browser, /setReservationDate\(date\)[\s\S]{0,160}setReservationTime\(localTimeInput/,
    "editing an existing reservation must take the calendar to its day and preserve its time");
  assert.match(browserCss, /\.pos-bg-reservation-calendar\s*\{[\s\S]*?grid-template-columns:\s*repeat\(7,/);
  assert.match(browserCss, /\.pos-bg-reservation-day--selected/);
  assert.match(browser, /pos-bg-reservation-card-status/);
  assert.match(browser, /โทร\. \{entry\.guestPhone \|\| '-'\}/,
    "the selected-day card must expose the contact number instead of hiding it in edit mode");
  assert.match(browser, /aria-expanded=\{reservationEditorOpen\}/);
  assert.match(browser, /เพิ่มการจองใหม่/);
  assert.match(browserCss, /\.pos-bg-reservation-card\s*\{/);
  assert.match(browserCss, /\.pos-bg-reservation-card-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    "reservation actions must stay in a bounded two-column grid instead of overflowing the card");
  assert.doesNotMatch(browserCss, /minmax\(280px,\s*auto\)/,
    "action labels must not set an unbounded intrinsic width that clips the master pane");
  assert.match(browserCss, /\.pos-bg-reservation-add-toggle\s*\{/);
});

test("10.1 public bookings are review requests with opaque management and bounded reminders", () => {
  assert.match(publicMigration, /status = 'REQUESTED'[\s\S]*source = 'PUBLIC'[\s\S]*reserved_table_id IS NULL/);
  assert.match(publicMigration, /public_manage_token_hash/);
  assert.match(publicMigration, /booking_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(service, /requestPublicBoardGameReservation/);
  assert.match(service, /reviewPublicBoardGameReservation/);
  assert.match(service, /status = 'CONFIRMED'[\s\S]*reserved_table_id = \$4/);
  assert.match(service, /FOR UPDATE SKIP LOCKED LIMIT 100/);
  assert.match(service, /reminder_attempts < 3/);
  assert.match(publicRoute, /rateLimit\(`board-game-public-booking:/);
  assert.match(publicManageRoute, /cancelPublicBoardGameReservation/);
  assert.match(reminderRoute, /authorizeCronRequest\(req\)/);
  assert.match(reminderRoute, /recordJobRun\("board-game-reservation-reminders"/);
  assert.match(cronWorkflow, /board-game-reservation-reminders[\s\S]*\/api\/bms\/board-game\/reservations\/remind/);
  assert.doesNotMatch(publicMigration, /INSERT INTO bms_payments|INSERT INTO bms_pos_deposits/,
    "public table requests and reminders must not create a parallel money path");
});

test("10.2 completes deposits, expiry, timezone-safe requests and delivery evidence", () => {
  assert.match(completionMigration, /payable_type = 'BOARD_GAME_RESERVATION'/);
  assert.match(completionMigration, /bms_board_game_reservation_deposit_applications/);
  assert.match(completionMigration, /source_payment_id/);
  assert.match(completionMigration, /refunded_amount/);
  assert.match(service, /reservedLocal/);
  assert.match(service, /AT TIME ZONE \$2/);
  assert.match(service, /request_expires_at/);
  assert.match(service, /decision_notification_status = 'SENDING'/);
  assert.match(service, /submitPublicBoardGameReservationDeposit/);
  assert.match(service, /deposit_refund_eligible_until >= now\(\)[\s\S]*'REFUND_PENDING'/,
    "staff cancellation must leave eligible confirmed deposits in the refund queue");
  assert.match(service, /\$5 = 'NO_SHOW'[\s\S]*deposit_status = 'PAID'[\s\S]*'FORFEITED'/,
    "a staff-recorded no-show must forfeit a paid deposit just like cron expiry");
  assert.match(payments, /payable_type === "BOARD_GAME_RESERVATION"/);
  assert.match(payments, /deposit_status !== "REFUND_PENDING"/,
    "reservation money must be cancelled or left over after settlement before staff can refund it");
  assert.match(pos, /RESERVATION_DEPOSIT/);
  assert.match(pos, /reservationDepositCredit/);
  assert.match(pos, /requestedPayments\.length > 0[\s\S]*requestedPayments\.every\([\s\S]*method === "CASH"/,
    "a fully deposit-funded bill must not be mistaken for a cash-only payment");
  assert.match(pos, /amount: Math\.min\(amountDue, deposit\.remaining\)/,
    "cash rounding must cap the applied deposit at the final rounded order total");
  assert.match(publicPaymentRoute, /persistWebFile[\s\S]*"private"/);
  assert.match(publicPaymentRoute, /rateLimit\(`board-game-public-booking-payment:/);
  assert.match(publicDirectory, /bookingRequestToken \|\| newBookingToken\(\)/);
  assert.match(publicDirectory, /reservedLocal: form\.get\("reservedFor"\)/);
  assert.match(publicManage, /window\.setInterval[\s\S]*15_000/);
  assert.match(publicManage, /type="file"/);
});

test("rescheduling remains serialized and stale confirmed bookings expire through guarded cron", () => {
  assert.match(service, /boardGameIdempotency\("reservation\.update"/);
  assert.match(service, /new Set\(\[current\.rows\[0\]\.reserved_table_id, input\.tableId\]\)\]\.sort\(\)/);
  assert.match(service, /id <> \$4[\s\S]*reserved_for < \$5::timestamptz/);
  assert.match(service, /deposit_refund_eligible_until \+ \(\$5::timestamptz - reserved_for\)/,
    "rescheduling must move the refund cutoff by the same interval as the booking");
  assert.match(service, /FOR UPDATE SKIP LOCKED[\s\S]*SET status = 'NO_SHOW'/);
  assert.match(expiryRoute, /authorizeCronRequest\(req\)/);
  assert.match(expiryRoute, /recordJobRun\("board-game-reservation-expiry"/);
  assert.match(cronWorkflow, /board-game-reservation-expiry[\s\S]*\/api\/bms\/board-game\/reservations\/expire/);
});

test("availability is capacity-aware guidance, not a promise", () => {
  assert.match(service, /t\.seats/);
  assert.match(service, /expected_available_at/);
  assert.match(service, /st\.status = 'ACTIVE'/);
  assert.match(service, /SELECT seats FROM bms_board_game_tables[\s\S]*FOR UPDATE/);
  assert.match(service, /input\.allowOverCapacity !== true/);
  assert.match(service, /กรุณายืนยันการใช้โต๊ะเกินความจุ/);
  assert.match(browser, /table\.seats >= entry\.partySize/);
  assert.match(mobile, /table\.seats >= entry\.partySize/);
});

test("queue history is removed before sessions during fixture and test-tenant cleanup", () => {
  assert.ok(
    cleanup.indexOf("DELETE FROM bms_board_game_reservation_deposit_applications") <
      cleanup.indexOf("DELETE FROM bms_board_game_waitlist w"),
  );
  assert.ok(
    cleanup.indexOf("DELETE FROM bms_board_game_waitlist") <
      cleanup.indexOf("DELETE FROM bms_board_game_sessions"),
  );
  assert.ok(
    platform.indexOf("DELETE FROM bms_board_game_reservation_deposit_applications") <
      platform.indexOf("DELETE FROM bms_board_game_waitlist"),
  );
  assert.ok(
    platform.indexOf("DELETE FROM bms_board_game_waitlist") <
      platform.indexOf("DELETE FROM bms_board_game_sessions"),
  );
});

test("the DB suite exercises concurrency, rollback and the atomic link", () => {
  assert.match(dbContract, /Promise\.all\(\[add\(2\), add\(3\), add\(4\), add\(5\)\]\)/);
  assert.match(dbContract, /isIdempotencyConflictError/);
  assert.match(dbContract, /รองรับจำนวนผู้เล่นจริงไม่พอ/);
  assert.match(dbContract, /queue_status: "SEATED", session_status: "OPEN"/);
  assert.match(dbContract, /node scripts\/run-contract-tests\.mjs db board-game-waitlist/);
});
