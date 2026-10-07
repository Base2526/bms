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
const chatMigration = read("db/migrations/10.48__bms_board_game_chat_reservations.sql");
const chatWrite = service.split("export async function requestChatBoardGameReservation")[1].split("export async function listChatBoardGameReservationsForCustomer")[0];

test("CHAT migration binds customer authority and keeps public constraints plus trigger shape", () => {
  assert.match(chatMigration, /FOREIGN KEY \(tenant_id, customer_id\) REFERENCES bms_customers\(tenant_id, id\) ON DELETE CASCADE/);
  assert.match(chatMigration, /source = 'CHAT'[\s\S]*customer_id IS NOT NULL[\s\S]*guest_email IS NULL/);
  assert.match(chatMigration, /source = 'PUBLIC'[\s\S]*guest_email IS NOT NULL/);
  assert.match(chatMigration, /\(tenant_id, chat_request_key_hash\) WHERE source = 'CHAT'/);
  assert.match(chatMigration, /reminder_status = 'NONE' AND decision_notification_status = 'NONE'/);
  assert.doesNotMatch(chatMigration, /DROP TABLE|DISABLE.*TRIGGER|DISABLE ROW LEVEL SECURITY/);
  const realtime = migration.split("CREATE OR REPLACE FUNCTION public.bms_realtime_board_game_waitlist_trigger")[1];
  assert.doesNotMatch(realtime, /customer_id|guest_name|guest_phone|chat_request/);
  for (const column of ["customer_id", "chat_request_key_hash", "chat_request_hash"]) {
    assert.ok(read("scripts/schemaReadiness.mts").includes(`"${column}"`));
    assert.ok(read("db/checks/schema-readiness.sql").includes(column));
  }
});

test("CHAT write inserts only REQUESTED with no table, confirmation, payment or public authority", () => {
  assert.match(chatWrite, /'RESERVATION', 'CHAT'[\s\S]*'REQUESTED'/);
  assert.doesNotMatch(chatWrite, /'CONFIRMED'|reserved_table_id|confirmed_at|reviewPublicBoardGameReservation|bms_payments|bms_orders|guest_email|public_manage_token/);
  assert.match(chatWrite, /FOR UPDATE/);
  assert.ok(chatWrite.indexOf("board_game.chat_reservation_request") < chatWrite.lastIndexOf('client.query("COMMIT")'));
});

test("CHAT status is always customer AND tenant scoped, short and private", () => {
  const status = service.split("export async function listChatBoardGameReservationsForCustomer")[1].split("export async function getPublicBoardGameReservation")[0];
  assert.match(status, /WHERE w.tenant_id = \$1 AND w.customer_id = \$2 AND w.source = 'CHAT'/);
  assert.match(status, /left\(w.id::text, 8\)/);
  assert.match(status, /left\(w.rejection_reason, 300\)/);
  assert.doesNotMatch(status, /guest_name|guest_phone|guest_email|table_id|reviewed_by/);
  assert.match(read("apps/web/lib/bms/customers.ts"), /UPDATE bms_board_game_waitlist SET customer_id = \$3[\s\S]{0,100}WHERE tenant_id = \$1 AND customer_id = \$2 AND source = 'CHAT'/,
    "a CRM merge must not orphan the moved identity's request history");
  assert.match(read("apps/web/lib/bms/customers.ts"), /Number\(chatPending.rows\[0\].count\) > 3/,
    "merging two identities cannot bypass the pending-request cap");
});

test("CHAT review uses the existing locks; notification jobs cannot claim email-less requests", () => {
  const review = service.split("export async function reviewPublicBoardGameReservation")[1].split("async function send")[0];
  assert.match(review, /source IN \('PUBLIC', 'CHAT'\)/);
  assert.match(review, /pg_advisory_xact_lock/);
  assert.match(review, /source === "CHAT" && policy !== "NONE"/);
  assert.match(review, /source = 'CHAT' THEN 'NONE' ELSE 'PENDING'/);
  const reminders = service.split("export async function sendDueBoardGameReservationReminders")[1].split("export async function expireOverdueBoardGameReservations")[0];
  assert.equal((reminders.match(/guest_email IS NOT NULL/g) ?? []).length, 2);
  assert.match(browser, /entry.source === 'CHAT'/);
  assert.match(mobile, /entry.source === 'CHAT'/);
});

test("CHAT pending cap and transaction failures execute against the real service with a fake SQL boundary", async () => {
  const globals = globalThis as any;
  const oldPool = globals.__bmsPostgresPool;
  let pending = 3;
  let failAudit = false;
  let bookingEnabled = true;
  let deposit = "NONE";
  const calls: string[] = [];
  const client = { release() {}, query: async (sql: string, args: any[] = []) => {
    calls.push(sql);
    let rows: any[] = [];
    if (sql.includes("SELECT name, phone")) rows = [{ name: "FAKE customer", phone: "0800000000" }];
    else if (sql.includes("SELECT COUNT(*)")) rows = [{ count: pending }];
    else if (sql.includes("FOR SHARE OF profile")) rows = [{ timezone: "Asia/Bangkok", min_advance_minutes: 30,
      request_ttl_minutes: 60, branch: "FAKE", booking_enabled: bookingEnabled, deposit_policy: deposit }];
    else if (sql.includes("AS round_trip")) rows = [{ instant: new Date(Date.now() + 86400000), round_trip: args[0] }];
    else if (sql.includes("INSERT INTO bms_board_game_waitlist")) rows = [{ id: "fake-request", status: "REQUESTED" }];
    else if (sql.includes("INSERT INTO bms_audit_log") && failAudit) throw new Error("FAKE audit failure");
    return { rows, rowCount: rows.length };
  } };
  globals.__bmsPostgresPool = { connect: async () => client };
  try {
    const { requestChatBoardGameReservation: request, ChatBoardGameReservationRejection: Rejection } = await import("../apps/web/lib/bms/boardGameWaitlist.ts");
    const input = { tenantId: "fake-tenant", customerId: "fake-customer", locationId: "fake-location",
      reservedLocal: "2027-01-10T18:00", durationMinutes: 120, partySize: 4, requestKey: "fake-key" };
    await assert.rejects(request(input), e => e instanceof Rejection && e.code === "PENDING_LIMIT");
    assert.ok(!calls.some(sql => sql.includes("INSERT INTO bms_board_game_waitlist")), "CHAT cap prevents the insert");
    assert.ok(calls.includes("ROLLBACK"));
    pending = 0;
    for (const code of ["BOOKING_DISABLED", "DEPOSIT_REQUIRES_STAFF"]) {
      calls.length = 0;
      bookingEnabled = code !== "BOOKING_DISABLED";
      deposit = code === "DEPOSIT_REQUIRES_STAFF" ? "FIXED" : "NONE";
      await assert.rejects(request(input), e => e instanceof Rejection && e.code === code);
      assert.ok(!calls.some(sql => sql.includes("INSERT INTO bms_board_game_waitlist")));
    }
    bookingEnabled = true; deposit = "NONE"; calls.length = 0; failAudit = true;
    await assert.rejects(request(input), /FAKE audit failure/);
    assert.ok(calls.includes("ROLLBACK")); assert.ok(!calls.includes("COMMIT"));
    calls.length = 0; failAudit = false;
    assert.deepEqual(await request(input), { requestId: "fake-request", status: "REQUESTED" });
    assert.ok(calls.includes("COMMIT"));
  } finally { globals.__bmsPostgresPool = oldPool; }
});

test("CHAT typed staff-review refusal is a POS rejection, never a database incident", async () => {
  const { ChatBoardGameReservationRejection } = await import("../apps/web/lib/bms/boardGameWaitlist.ts");
  const { boardGameRejectionFrom } = await import("../apps/web/lib/bms/boardGamePosOperations.ts");
  assert.equal(boardGameRejectionFrom(new ChatBoardGameReservationRejection("DEPOSIT_REQUIRES_STAFF", "deposit requires staff"))?.reason, "REJECTED");
  assert.equal(boardGameRejectionFrom(Object.assign(new Error("missing column"), { code: "42703" })), null);
});

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
  assert.match(dbContract, /กรุณายืนยันการใช้โต๊ะเกินความจุ/);
  assert.match(dbContract, /queue_status: "SEATED", session_status: "OPEN"/);
  assert.match(dbContract, /node scripts\/run-contract-tests\.mjs db board-game-waitlist/);
});
