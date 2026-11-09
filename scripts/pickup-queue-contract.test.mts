import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Pickup queue numbers (`10.112`–`10.113`) — source contract
 *
 * Guards the design decisions that are easy to undo by accident:
 *   1. the number is issued after the sale commits, never inside the money transaction;
 *   2. the call screen sees numbers only, never order ids or customer identity;
 *   3. kitchen readiness and bill voids move the number in their own transaction;
 *   4. every route is device-authenticated and branch-scoped.
 */

const REPO = new URL("../", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, REPO), "utf8");

/** Comments explain the rules in words that would otherwise satisfy or break the scans. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

function sqlCode(source: string): string {
  return source.split(/\r?\n/).map((line) => line.replace(/--.*$/, "")).join("\n");
}

function sliceFrom(source: string, anchor: string, length = 4000): string {
  const index = source.indexOf(anchor);
  assert.ok(index >= 0, `anchor not found: ${anchor}`);
  return source.slice(index, index + length);
}

const SERVICE = code(read("apps/web/lib/bms/pickupQueue.ts"));
const MIGRATION = sqlCode(read("db/migrations/10.112__bms_pickup_queue.sql"));
const SALE_ROUTE = code(read("apps/web/app/api/pos/sale/route.ts"));
const QUEUE_ROUTE = code(read("apps/web/app/api/pos/pickup-queue/route.ts"));
const KITCHEN = code(read("apps/web/lib/bms/kitchen.ts"));
const POS = code(read("apps/web/lib/bms/pos.ts"));
const ORDERS = code(read("apps/web/lib/bms/orders.ts"));
const BOARD_PAGE = code(read("apps/web/app/(pos)/pos/queue-board/page.tsx"));
const POS_PAGE = code(read("apps/web/app/(pos)/pos/page.tsx"));
const ESCPOS = code(read("apps/web/lib/pos/escpos.ts"));
const RESTAURANT_ROUTE = code(read("apps/web/app/api/pos/restaurant/checks/[id]/route.ts"));
const GRAPHQL = code(read("apps/web/graphql/bmsPosDevice.ts"));
const SDL = read("schema.graphql");
const DESKTOP_MAIN = code(read("apps/desktop/src/main.mjs"));
const SALE_RECEIPT = code(read("apps/web/lib/pos/posSaleReceipt.ts"));
const RESTAURANT_PAGE = code(read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
const RESTAURANT_CSS = code(read("apps/web/app/(pos)/pos/restaurant/restaurant.module.css"));
const MOBILE_CHECKOUT = code(read("apps/mobile/src/screens/sell/CheckoutScreen.tsx"));
const MOBILE_OFFLINE = code(read("apps/mobile/src/state/OfflineSalesContext.tsx"));
const MOBILE_OPS = read("apps/mobile/src/graphql/operations.graphql");
const RECEIPT_PAPER = code(read("apps/web/components/pos/ReceiptPaper.tsx"));
const MANAGER = code(read("apps/web/components/pos/PickupQueueManager.tsx"));
const STRIP = code(read("apps/web/components/pos/PickupQueuePanel.tsx"));
const KITCHEN_BOARD = code(read("apps/web/lib/bms/kitchenBoard.ts"));
const KITCHEN_TYPEDEFS = read("apps/web/graphql/typeDefs.ts");
const ADMIN_KITCHEN = code(read("apps/web/app/(admin)/admin/kitchen/page.tsx"));
const MOBILE_STRIP = code(read("apps/mobile/src/components/PickupQueueStrip.tsx"));
const MOBILE_KITCHEN = code(read("apps/mobile/src/state/KitchenContext.tsx"));
const MOBILE_RECEIPT = code(read("apps/mobile/src/screens/sell/ReceiptScreen.tsx"));
const LOCATIONS = code(read("apps/web/lib/bms/locations.ts"));
const LOCATION_PAGE = code(read("apps/web/app/(admin)/admin/locations/page.tsx"));
const QUEUE_DISPLAY_SETTINGS = code(read("apps/web/components/pos-desktop/QueueDisplaySettings.tsx"));
const MANAGED_DISPLAY_SETTINGS = code(read("apps/web/components/pos-desktop/ManagedDisplaySettings.tsx"));
const QUEUE_BOARD_PREFERENCES = code(read("apps/web/components/pos-desktop/QueueBoardPreferenceSettings.tsx"));
const DESKTOP_PRELOAD = code(read("apps/desktop/src/preload.cjs"));
const CUSTOMER_DISPLAY = code(read("apps/web/components/pos/CustomerDisplayView.tsx"));
const EXPERIENCE_MIGRATION = sqlCode(read("db/migrations/10.113__bms_pickup_queue_experience.sql"));
const QUEUE_VOICE = code(read("apps/web/lib/pos/pickupQueueVoice.ts"));
const ALERT_SETTINGS_MODAL = code(read("apps/web/components/pos/OrderAlertSettingsModal.tsx"));
const VOICE_GENERATOR = code(read("scripts/generate-pickup-queue-voice-pack.mjs"));
const STORE_PROFILE = code(read("apps/web/lib/bms/storeProfile.ts"));
const MESSENGER_PROFILE = code(read("apps/web/lib/bms/messengerProfile.ts"));
const KITCHEN_PRINTER = code(read("apps/desktop/src/kitchen-printer.mjs"));
const KITCHEN_PRINTER_SETTINGS = code(read("apps/web/components/pos-desktop/KitchenPrinterSettings.tsx"));
const QUEUE_SOUND_PREFERENCE = code(read("apps/web/lib/pos/queueBoardSoundPreference.ts"));
const QUEUE_AUDIO_PREFERENCE = code(read("apps/web/lib/pos/queueBoardAudioPreference.ts"));

test("migration: tenant isolation, one number per order, unique per branch service day", () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS bms_pickup_queue/);
  assert.match(MIGRATION, /ALTER TABLE bms_pickup_queue ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /ALTER TABLE bms_pickup_queue FORCE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /CREATE POLICY bms_pickup_queue_tenant_isolation/);
  assert.match(MIGRATION, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pickup_queue TO bms_app/);
  assert.match(MIGRATION, /UNIQUE \(tenant_id, order_id\)/);
  assert.match(MIGRATION, /ON bms_pickup_queue \(tenant_id, location_id, service_date, queue_no\)/);
  assert.match(MIGRATION, /REFERENCES bms_orders\(tenant_id, id\) ON DELETE CASCADE/);
  assert.match(MIGRATION, /REFERENCES bms_locations\(tenant_id, id\) ON DELETE CASCADE/);
});

test("migration: the queue row carries no customer identity or money", () => {
  const table = sliceFrom(MIGRATION, "CREATE TABLE IF NOT EXISTS bms_pickup_queue", 2500);
  for (const forbidden of [/\bname\b/i, /phone/i, /email/i, /customer/i, /amount/i, /total/i]) {
    assert.doesNotMatch(table.slice(0, table.indexOf(");\n")), forbidden);
  }
});

test("the number is issued after the sale commits, never inside the money transaction", () => {
  // No sale/order writer touches the queue table.
  assert.doesNotMatch(ORDERS, /bms_pickup_queue|issuePickupQueueNumber/);
  assert.doesNotMatch(POS, /INSERT INTO bms_pickup_queue|issuePickupQueueNumber/);
  // The sale route issues it only after recordPosSale returned SOLD. The wrapper combines the
  // per-device request with the authoritative online branch default.
  const afterSale = SALE_ROUTE.slice(SALE_ROUTE.indexOf("await recordPosSale("));
  assert.ok(afterSale.length > 0 && SALE_ROUTE.indexOf("await recordPosSale(") > 0);
  assert.match(afterSale, /result\.status === "SOLD"/);
  assert.match(afterSale, /issuePickupQueueAfterSale\(/);
  assert.match(afterSale, /requested: body\.pickupQueue === true/);
  assert.match(afterSale, /allowBranchDefault: true/);
  assert.ok(
    SALE_ROUTE.indexOf("issuePickupQueueAfterSale(") > SALE_ROUTE.indexOf("await recordPosSale("),
    "the queue number must be issued after recordPosSale()",
  );
  // Every committed-sale adapter goes through the wrapper that never throws.
  const wrapper = sliceFrom(SERVICE, "export async function issuePickupQueueAfterSale", 1400);
  assert.match(wrapper, /try \{[\s\S]*issuePickupQueueNumber\(input\)[\s\S]*\} catch/);
  assert.match(wrapper, /pickupQueueError:/);
  for (const [name, source, anchor] of [
    ["restaurant settle route", RESTAURANT_ROUTE, "await settleRestaurantCheck("],
    ["GraphQL sale", GRAPHQL, "const saleResult = await recordPosSale("],
    ["GraphQL settle", GRAPHQL, "const settled = await settleRestaurantCheck("],
  ] as const) {
    const at = source.indexOf(anchor);
    assert.ok(at > 0, `${name}: anchor missing`);
    const after = source.slice(at, at + 2500);
    assert.match(after, /\.status === "SOLD"/, name);
    assert.match(after, /issuePickupQueueAfterSale\(/, name);
    assert.match(after, /requested: (body|input)\.pickupQueue === true/, name);
  }
  // The only direct issue call in GraphQL is the explicit staff retry (action "issue").
  const directIssues = [...GRAPHQL.matchAll(/issuePickupQueueNumber\(/g)].map((match) => match.index ?? 0);
  const retryAction = GRAPHQL.indexOf("async bmsPosPickupQueueAction(");
  assert.ok(directIssues.length === 1 && directIssues[0] > retryAction && directIssues[0] < retryAction + 1500,
    "GraphQL may issue directly only inside the staff retry action");
});

test("dine-in checks never get a pickup number; take-away checks do", () => {
  const issue = sliceFrom(SERVICE, "export async function issuePickupQueueNumber", 5000);
  assert.match(issue, /row\.restaurant_check_id && row\.service_mode !== "TAKEAWAY"/);
  assert.match(RESTAURANT_PAGE, /pickupQueue: pickupQueueActive && settledCheck\.serviceMode === "TAKEAWAY"/);
  assert.match(MOBILE_CHECKOUT, /pickupQueueEnabled && check\.serviceMode === 'TAKEAWAY'/);
  const kitchen = sliceFrom(KITCHEN, "async function updateKitchenTicketStatusInTx", 9000);
  assert.match(kitchen, /syncPickupQueueFromRestaurantCheckInTx\(client, input\.tenantId, String\(checkId\)\)/);
});

test("reprints from the server carry the same number", () => {
  assert.match(POS, /LEFT JOIN bms_pickup_queue pq ON pq\.tenant_id = o\.tenant_id AND pq\.order_id = o\.id/);
  assert.match(POS, /pickupQueueLabel: row\.pickup_queue_no == null\s*\? null\s*: formatPickupQueueNo\(Number\(row\.pickup_queue_no\), String\(row\.pickup_queue_prefix/);
  assert.match(SALE_RECEIPT, /pickupQueueLabel: row\.pickupQueueLabel \?\? null/);
  assert.match(SDL, /type BmsPosReceipt \{[\s\S]*?pickupQueueLabel: String/);
  assert.match(MOBILE_OPS, /fragment MobilePosReceiptFields on BmsPosReceipt \{\s*orderId\s*pickupQueueLabel/);
});

test("mobile GraphQL: device-derived scope, PIN on actions, offline replays never ask", () => {
  const action = sliceFrom(GRAPHQL, "async bmsPosPickupQueueAction(", 1500);
  assert.match(action, /requirePosCashier\(device, input, "pos\.sell"\)/);
  assert.match(action, /locationId: device\.locationId/);
  assert.doesNotMatch(action, /input\.(tenantId|locationId|deviceId)/);
  const list = sliceFrom(GRAPHQL, "async bmsPosPickupQueue(", 300);
  assert.match(list, /listPickupQueue\(device\.tenantId, device\.locationId\)/);
  assert.match(SDL, /bmsPosPickupQueueAction\(input: BmsPosPickupQueueActionInput!\): BmsPosPickupQueueEntry!/);
  const entryType = SDL.slice(SDL.indexOf("type BmsPosPickupQueueEntry {"));
  assert.doesNotMatch(entryType.slice(0, entryType.indexOf("}")), /orderId|name|phone|total/i);
  assert.match(MOBILE_OFFLINE, /pickupQueue: false/);
});

test("desktop opens the call screen inside the app but never as a cashier frame", () => {
  assert.match(DESKTOP_MAIN, /target\.pathname === "\/pos\/queue-board"/);
  assert.match(DESKTOP_MAIN, /pathname !== "\/pos\/queue-board"/);
});

test("issuing is idempotent per order and scoped to this device and branch", () => {
  const issue = sliceFrom(SERVICE, "export async function issuePickupQueueNumber", 5000);
  assert.match(issue, /o\.pos_device_id = \$3/);
  assert.match(issue, /String\(row\.location_id\) !== input\.locationId/);
  assert.match(issue, /restaurant_check_id/);
  assert.match(issue, /ON CONFLICT \(tenant_id, order_id\) DO NOTHING/);
  assert.match(issue, /error\?\.code === "23505"/);
  assert.match(issue, /'pos\.pickup_queue\.issue'/);
});

test("status changes are branch-scoped, audited, and never revive a closed number", () => {
  const update = sliceFrom(SERVICE, "export async function updatePickupQueueEntry", 3500);
  assert.match(update, /location_id = \$3/);
  assert.match(update, /FOR UPDATE/);
  assert.match(update, /'pos\.pickup_queue\.status'/);
  const transitions = sliceFrom(SERVICE, "const NEXT_STATUS", 700);
  assert.doesNotMatch(transitions, /"COLLECTED"\s*,|"CANCELLED"\s*,|\["COLLECTED"|\["CANCELLED"/);
});

test("the service stays a leaf module so kitchen.ts can call it without an import cycle", () => {
  const imports = [...SERVICE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports.filter((path) => !["pg", "@/lib/db", "./tenant"].includes(path)), []);
});

test("kitchen readiness syncs the number inside the kitchen ticket transaction", () => {
  const core = sliceFrom(KITCHEN, "async function updateKitchenTicketStatusInTx", 9000);
  const sync = core.indexOf("syncPickupQueueFromKitchenInTx(client");
  const audit = core.indexOf("'kitchen.ticket_status'");
  assert.ok(sync > 0, "kitchen status change must sync the pickup number");
  assert.ok(audit > sync, "sync must run before the audit, inside the same transaction");
  const sql = sliceFrom(SERVICE, "export async function syncPickupQueueFromKitchenInTx", 2000);
  // Only kitchen-set readiness is withdrawn; a number staff called stays called.
  assert.match(sql, /q\.status = 'READY' AND q\.ready_source = 'KITCHEN'/);
});

test("voiding a bill takes its number off the screen in the void transaction", () => {
  const voidHook = sliceFrom(POS, "await cancelKitchenTicketsForOrderInTx(client, input.tenantId, input.orderId);", 400);
  assert.match(voidHook, /await cancelPickupQueueForOrderInTx\(client, input\.tenantId, input\.orderId\)/);
});

test("queue routes are device-authenticated; mutations need cashier PIN and pos.sell", () => {
  assert.match(QUEUE_ROUTE, /authenticateRestaurantRead\(req\)/);
  assert.match(QUEUE_ROUTE, /authenticateRestaurantMutation\(req, body, "pos\.sell"\)/);
  assert.match(QUEUE_ROUTE, /auth\.device\.locationId/);
  assert.doesNotMatch(QUEUE_ROUTE, /body\.(tenantId|locationId|deviceId)/);
});

test("the call screen gets numbers only, never order ids", () => {
  const from = sliceFrom(SERVICE, "export function toBoardEntry", 600);
  const board = from.slice(0, from.indexOf("\n}\n") + 3);
  assert.match(board, /return \{ label: entry\.label/);
  assert.doesNotMatch(board, /orderId|id:/);
  assert.match(QUEUE_ROUTE, /view"\) === "board"[\s\S]*?listPickupQueueBoard\(auth\.device\.tenantId, auth\.device\.locationId\)/);
  const boardList = sliceFrom(SERVICE, "export async function listPickupQueueBoard", 1200);
  assert.match(boardList, /visible\.map\(toBoardEntry\)/);
  assert.match(BOARD_PAGE, /\/api\/pos\/pickup-queue\?view=board/);
  assert.match(BOARD_PAGE, /readPosDeviceToken\(\)/);
});

test("the till asks for a number per device, and the receipt prints it", () => {
  assert.match(POS_PAGE, /pickupQueue: pickupQueueActive/);
  assert.match(POS_PAGE, /pickupQueueLabel: \(!r\.receiptType \|\| r\.receiptType === "sale"\)/);
  assert.match(ESCPOS, /pickupQueueLabel\?: string \| null/);
  assert.match(ESCPOS, /if \(payload\.pickupQueueLabel\)/);
  assert.match(RECEIPT_PAPER, /payload\.pickupQueueLabel &&/);
});

test("branch policy enables every online till and hides stale ready numbers only from the board", () => {
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS pickup_queue_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(MIGRATION, /pickup_queue_auto_hide_minutes INTEGER NOT NULL DEFAULT 30/);
  assert.match(LOCATIONS, /pickupQueue: PickupQueueLocationSettings/);
  assert.match(LOCATION_PAGE, /ออกเลขคิวทุกเครื่องในสาขานี้/);
  const wrapper = sliceFrom(SERVICE, "export async function issuePickupQueueAfterSale", 1800);
  assert.match(wrapper, /input\.allowBranchDefault === true && settings\.enabled/);
  assert.match(GRAPHQL, /allowBranchDefault: !textInput\(input\.offlineTenderedAt\)/);
  const board = sliceFrom(SERVICE, "export async function listPickupQueueBoard", 1500);
  assert.match(board, /settings\.autoHideMinutes/);
  const day = sliceFrom(SERVICE, "export async function listPickupQueueDay", 900);
  assert.doesNotMatch(day, /autoHideMinutes|auto_hide/);
});

test("desktop manages a dedicated queue display without granting it cashier bridges", () => {
  assert.match(DESKTOP_MAIN, /pickup-queue-display\.json/);
  assert.match(DESKTOP_MAIN, /createQueueDisplayWindow/);
  assert.match(DESKTOP_MAIN, /selectQueueDisplay/);
  assert.match(DESKTOP_MAIN, /pathname !== "\/pos\/queue-board"/);
  assert.match(QUEUE_DISPLAY_SETTINGS, /setQueueDisplayConfig/);
  assert.match(QUEUE_DISPLAY_SETTINGS, /openQueueDisplayPreview/);
});

test("desktop assigns customer and queue roles from one external-display control", () => {
  assert.match(POS_PAGE, /<ManagedDisplaySettings \/>/);
  assert.match(POS_PAGE, /!hasDesktopManagedDisplayBridge\(\) && <QueueBoardPreferenceSettings \/>/);
  assert.match(MANAGED_DISPLAY_SETTINGS, /<QueueBoardPreferenceSettings \/>/);
  assert.match(MANAGED_DISPLAY_SETTINGS, /setExternalDisplayRole/);
  assert.match(MANAGED_DISPLAY_SETTINGS, /getCustomerDisplayState/);
  assert.match(MANAGED_DISPLAY_SETTINGS, /getQueueDisplayState/);
  assert.match(MANAGED_DISPLAY_SETTINGS, /openCustomerDisplayPreview/);
  assert.match(MANAGED_DISPLAY_SETTINGS, /openQueueDisplayPreview/);
  assert.match(DESKTOP_PRELOAD, /bms-pos:set-external-display-role/);
  assert.match(DESKTOP_MAIN, /ipcMain\.handle\("bms-pos:set-external-display-role"/);
  assert.match(DESKTOP_MAIN, /writeManagedDisplayConfigs\(nextCustomer, nextQueue, previousCustomer, previousQueue\)/);
  assert.match(DESKTOP_MAIN, /externalDisplays\.length <= 1/);
  assert.match(POS_PAGE, /managedDisplay=\{hasDesktopManagedDisplayBridge\(\)\}/);
  assert.match(STRIP, /!managedDisplay && <button[^>]*onClick=\{openPickupQueueBoard\}/);
  assert.match(STRIP, /เปิดจอจริงหรือหน้าต่างทดสอบได้จากหัวข้อ/);
  assert.match(MANAGED_DISPLAY_SETTINGS, /previewOpenLabel: "เปิดทดสอบจอลูกค้าบนจอนี้"/);
  assert.match(MANAGED_DISPLAY_SETTINGS, /previewOpenLabel: "เปิดทดสอบจอเรียกคิวบนจอนี้"/);
});

test("queue-board sound defaults on, keeps a per-device mute, and desktop permits managed autoplay", () => {
  assert.match(QUEUE_SOUND_PREFERENCE, /!== "0"/);
  assert.match(QUEUE_SOUND_PREFERENCE, /queueBoardSoundStorageKey\(namespace\)/);
  assert.match(QUEUE_BOARD_PREFERENCES, /เปิดเสียงประกาศที่จอเรียกคิว/);
  assert.match(QUEUE_BOARD_PREFERENCES, /writeQueueBoardSoundEnabled\(storageNamespace, checked\)/);
  assert.match(BOARD_PAGE, /readQueueBoardSoundEnabled\(namespace\)/);
  assert.match(BOARD_PAGE, /event\.newValue !== "0"/);
  assert.match(BOARD_PAGE, /ปิดเสียงจากการตั้งค่าเครื่อง/);
  assert.match(DESKTOP_MAIN, /appendSwitch\("autoplay-policy", "no-user-gesture-required"\)/);
});

test("ticker queue board collapses an empty preparing section into an aligned summary rail", () => {
  assert.match(BOARD_PAGE, /pq-ticker-preparing \.pq-preparing\.is-empty/);
  assert.match(BOARD_PAGE, /preparing\.length === 0 \? " is-empty"/);
});

test("queue board turns rejected credentials into the managed-display instruction", () => {
  assert.match(BOARD_PAGE, /res\.status === 401 \|\| res\.status === 403/);
  assert.match(BOARD_PAGE, /setToken\(""\)/);
  assert.match(BOARD_PAGE, /POS → ตั้งค่า → จอภายนอก → จอเรียกคิว/);
  assert.match(BOARD_PAGE, /ไม่ต้องคัดลอก URL นี้ไปเปิดใน Chrome/);
});

test("kitchen readiness alerts the till and the paid customer display shows the queue number", () => {
  assert.match(STRIP, /alerts\.notify\("PICKUP_READY"\)/);
  assert.match(STRIP, /row\.readySource !== "KITCHEN"/);
  assert.match(CUSTOMER_DISPLAY, /เลขคิวรับของ/);
  assert.match(CUSTOMER_DISPLAY, /state\.finished\.pickupQueueLabel/);
  assert.match(POS_PAGE, /pickupQueueLabel: completed\.pickupQueueLabel/);
  assert.match(RESTAURANT_PAGE, /pickupQueueLabel: settlementReceipt\.result\.pickupQueue\?\.label/);
});

test("staff manager: today's list is device-only and the public board view is unchanged", () => {
  assert.match(QUEUE_ROUTE, /view"\) === "day"[\s\S]*?listPickupQueueDay\(auth\.device\.tenantId, auth\.device\.locationId\)/);
  const day = sliceFrom(SERVICE, "export async function listPickupQueueDay", 900);
  assert.match(day, /q\.tenant_id = \$1 AND q\.location_id = \$2/);
  assert.match(day, /q\.service_date = \$\{SERVICE_DATE_SQL\}/);
  assert.doesNotMatch(BOARD_PAGE, /view=day/);
  assert.match(MANAGER, /\/api\/pos\/pickup-queue\?view=day/);
});

test("restaurant floor keeps queue work in one compact toolbar above the table plan", () => {
  assert.match(STRIP, /variant\?: "default" \| "compact"/);
  assert.match(STRIP, /data-pickup-queue-strip data-variant="compact"/);
  assert.match(STRIP, /data-action="collect"/);
  assert.match(STRIP, /data-action="call"/);
  assert.match(STRIP, /data-action="manage"/);
  assert.match(RESTAURANT_PAGE, /<PickupQueueStrip[^>]*variant="compact"/);
  assert.match(RESTAURANT_PAGE, /className=\{styles\.floorStatusDashboard\}/);
  assert.doesNotMatch(RESTAURANT_PAGE, /openPickupQueueBoard/,
    "the floor toolbar must not duplicate the queue-board button owned by the manager/settings");
  assert.match(RESTAURANT_CSS, /\.floorStatusDashboard :global\(\[data-pickup-queue-main\]\)/);
  assert.match(RESTAURANT_CSS, /@media[^}]*max-width:\s*640px[\s\S]*?data-pickup-queue-main/);
});

test("manager: keypad lookup, confirmed cancel and every action carries the cashier PIN", () => {
  assert.match(MANAGER, /export function normalizeQueueInput/);
  assert.match(MANAGER, /actByNumber\("call"\)/);
  assert.match(MANAGER, /actByNumber\("collect"\)/);
  // Cancel is two taps: the first only arms the confirmation.
  assert.match(MANAGER, /onClick=\{\(\) => setConfirmCancel\(row\.id\)\}/);
  const armed = sliceFrom(MANAGER, "confirmCancel === row.id && (", 900);
  assert.match(armed, /onClick=\{\(\) => void act\(row, "cancel"\)\}>ยืนยันยกเลิก</, "the real cancel lives only behind the armed confirmation");
  assert.equal([...MANAGER.matchAll(/act\(row, "cancel"\)/g)].length, 1, "no second, unconfirmed cancel path");
  assert.match(MANAGER, /postPickupQueue\(token, \{ action, entryId: row\.id, cashierUserId, cashierPin \}\)/);
  assert.match(STRIP, /<PickupQueueManager /);
  assert.doesNotMatch(STRIP, /if \(rows\.length === 0 && !error\) return null/, "the strip must stay reachable when empty");
});

test("retry: a committed sale without a number can ask again for the same bill", () => {
  assert.match(MANAGER, /action: "issue", orderId, cashierUserId, cashierPin/);
  assert.match(QUEUE_ROUTE, /action === "issue"[\s\S]*?issuePickupQueueNumber\(/);
  assert.match(POS_PAGE, /<PickupQueueRetryButton[\s\S]{0,200}orderId=\{justSold\.id\}/);
  assert.match(RESTAURANT_PAGE, /<PickupQueueRetryButton[^>]*orderId=\{settlementReceipt\.result\.orderId\}/);
  const retry = sliceFrom(GRAPHQL, "async bmsPosPickupQueueAction(", 1500);
  assert.match(retry, /requested === "issue"[\s\S]*?orderId: uuidInput\(input\.orderId/);
  assert.match(MOBILE_STRIP, /action: 'issue',\s*entryId: null,\s*orderId,/);
  assert.match(MOBILE_RECEIPT, /!receipt\.pickupQueueLabel && route\.params\.pickupQueueError/);
});

test("mobile strip: recall, undo and cancel exist, and cancel asks first", () => {
  assert.match(MOBILE_STRIP, /'unready'/);
  const cancel = sliceFrom(MOBILE_STRIP, "const confirmCancel", 900);
  assert.match(cancel, /Alert\.alert\(`ยกเลิกคิว \$\{label\}\?`/);
  assert.match(cancel, /onPress:[\s\S]{0,160}run\(entryId, label, 'cancel'\)/,
    "the destructive action runs only from the confirmation button");
  assert.equal([...cancel.matchAll(/run\(entryId, label, 'cancel'\)/g)].length, 1,
    "there is no second unconfirmed mobile cancel path");
});

test("kitchen tickets carry the pickup number for counter orders and take-away checks", () => {
  const list = sliceFrom(KITCHEN, "export async function listKitchenTickets", 4500);
  assert.match(list, /LEFT JOIN bms_pickup_queue pq\s+ON pq\.tenant_id = kt\.tenant_id AND pq\.order_id = kt\.order_id AND pq\.status <> 'CANCELLED'/);
  assert.match(list, /so\.restaurant_check_id = rt\.check_id\s+AND rc\.service_mode = 'TAKEAWAY' AND q\.status <> 'CANCELLED'/);
  assert.equal([...list.matchAll(/AS pickup_queue_no/g)].length, 2, "both UNION branches select the number");
  assert.match(KITCHEN, /pickupQueueLabel: row\.pickup_queue_no == null\s*\? null\s*: formatPickupQueueNo\(Number\(row\.pickup_queue_no\), String\(row\.pickup_queue_prefix/);
  const label = sliceFrom(KITCHEN_BOARD, "export function kitchenGroupLabel", 500);
  assert.ok(label.indexOf("pickupQueueLabel") < label.indexOf("tableName"), "the queue number wins over table/bill labels");
  assert.match(KITCHEN_BOARD, /pickupQueueLabel: clean\(ticket\.pickupQueueLabel\)/);
  assert.match(KITCHEN_BOARD, /export function summarizeKitchenPickupQueues/);
  assert.match(RESTAURANT_PAGE, /summarizeKitchenPickupQueues\(groupKitchenTickets\(tickets\)\)/);
  assert.match(RESTAURANT_PAGE, /styles\.kitchenPickupBar/);
  assert.match(RESTAURANT_PAGE, /styles\.ticketQueueBadge/);
  assert.match(RESTAURANT_CSS, /\.kitchenPickupList\s*\{[^}]*overflow-x: auto/);
  assert.match(KITCHEN_TYPEDEFS, /type BmsKitchenTicket \{[\s\S]*?pickupQueueLabel: String/);
  assert.match(ADMIN_KITCHEN, /pickupQueueLabel\n/);
  assert.match(MOBILE_OPS, /fragment MobileKitchenTicketFields on BmsKitchenTicket \{\s*id\s*pickupQueueLabel/);
  assert.match(MOBILE_KITCHEN, /ticket\.pickupQueueLabel\s*\?\s*`คิว \$\{ticket\.pickupQueueLabel\}`/);
});

test("10.113 snapshots the prefix and keeps new branch presentation settings bounded", () => {
  assert.match(EXPERIENCE_MIGRATION, /ADD COLUMN IF NOT EXISTS pickup_queue_prefix/);
  assert.match(EXPERIENCE_MIGRATION, /ADD COLUMN IF NOT EXISTS pickup_queue_start_no/);
  assert.match(EXPERIENCE_MIGRATION, /ADD COLUMN IF NOT EXISTS queue_prefix/);
  assert.match(EXPERIENCE_MIGRATION, /pickup_queue_voice_repeat BETWEEN 1 AND 3/);
  assert.match(EXPERIENCE_MIGRATION, /pickup_queue_voice_volume BETWEEN 0 AND 100/);
  const issue = sliceFrom(SERVICE, "export async function issuePickupQueueNumber", 6000);
  assert.match(issue, /queue_prefix/);
  assert.match(issue, /location\.pickup_queue_start_no/);
  assert.match(SERVICE, /label: formatPickupQueueNo\(queueNo, String\(row\.queue_prefix/);
});

test("AI Studio is release-time only; the call screen has a same-origin voice pack and chime fallback", () => {
  assert.match(VOICE_GENERATOR, /generativelanguage\.googleapis\.com\/v1beta\/interactions/);
  assert.match(VOICE_GENERATOR, /gemini-3\.8-flash-tts/);
  assert.match(VOICE_GENERATOR, /language: "th-TH"/);
  assert.match(QUEUE_VOICE, /\/audio\/pickup-queue\/\$\{language\}/);
  assert.doesNotMatch(QUEUE_VOICE, /googleapis|GEMINI_API_KEY|gemini-/);
  assert.match(QUEUE_VOICE, /fetch\(url, \{ cache: "force-cache" \}\)/);
  assert.match(QUEUE_VOICE, /export async function hasPickupQueueVoicePack/);
  assert.match(QUEUE_VOICE, /pickupQueueVoiceManifestUrl\(language, profile\)/);
  assert.match(QUEUE_BOARD_PREFERENCES, /ยังไม่ได้ติดตั้ง voice-pack AI Studio เสียงนี้/);
  assert.match(BOARD_PAGE, /playPickupQueueAnnouncement/);
  assert.match(QUEUE_VOICE, /const played = await playPickupQueueVoice/);
  assert.match(QUEUE_VOICE, /const usedSystemVoice = !played && speakPickupQueueWithSystemVoice/);
  assert.match(QUEUE_VOICE, /const usedChime = \(!played && !usedSystemVoice\) \|\| mode === "VOICE_CHIME"/);
  assert.match(QUEUE_VOICE, /ขอเชิญคิวหมายเลข/);
  assert.match(QUEUE_VOICE, /กรุณารับที่เคาน์เตอร์ค่ะ/);
  assert.match(MANAGER, /preparePickupQueueAnnouncement\(row\.label, voiceSettings\)/);
  assert.match(MANAGER, /playPickupQueueAnnouncement\(announcement, row\.label, voiceSettings\)/);
  assert.match(STRIP, /preparePickupQueueAnnouncement\(row\.label, voiceSettings\)/);
  assert.match(STRIP, /playPickupQueueAnnouncement\(announcement, row\.label, voiceSettings\)/);
  assert.match(ALERT_SETTINGS_MODAL, /kinds\.includes\("PICKUP_READY"\)/);
  assert.match(ALERT_SETTINGS_MODAL, /preparePickupQueueAnnouncement\("001", voiceSettings\)/);
  assert.match(ALERT_SETTINGS_MODAL, /playPickupQueueAnnouncement\(context, "001", voiceSettings\)/);
  assert.match(QUEUE_AUDIO_PREFERENCE, /AI_STUDIO_BELL/);
  assert.match(QUEUE_AUDIO_PREFERENCE, /AI_STUDIO_BRIGHT/);
  assert.match(QUEUE_AUDIO_PREFERENCE, /AI_STUDIO_MALE_FRIENDLY/);
  assert.match(QUEUE_AUDIO_PREFERENCE, /AI_STUDIO_ANNOUNCER/);
  assert.match(QUEUE_AUDIO_PREFERENCE, /voiceProfile/);
  assert.match(QUEUE_AUDIO_PREFERENCE, /COUNTER_BELL/);
  assert.match(QUEUE_AUDIO_PREFERENCE, /DOUBLE_BEEP/);
  assert.match(QUEUE_AUDIO_PREFERENCE, /SOFT_PING/);
  assert.match(QUEUE_AUDIO_PREFERENCE, /if \(base\.voiceMode === "OFF"\) return base/);
  assert.match(QUEUE_VOICE, /patterns\[tone\]/);
  assert.match(QUEUE_VOICE, /profile\.toLowerCase\(\)/);
  assert.match(QUEUE_VOICE, /AOEDE: \{ rate:/);
  assert.match(QUEUE_VOICE, /PUCK: \{ rate:/);
  assert.match(QUEUE_VOICE, /CHARON: \{ rate:/);
  assert.match(VOICE_GENERATOR, /id: "KORE", voice: "Kore"/);
  assert.match(VOICE_GENERATOR, /id: "AOEDE", voice: "Aoede"/);
  assert.match(VOICE_GENERATOR, /id: "PUCK", voice: "Puck"/);
  assert.match(VOICE_GENERATOR, /id: "CHARON", voice: "Charon"/);
  assert.match(VOICE_GENERATOR, /profiles: selectedProfiles\.map/);
  assert.match(QUEUE_BOARD_PREFERENCES, /aria-label="เลือกเสียงเรียกที่จอคิว"/);
  assert.match(QUEUE_BOARD_PREFERENCES, /ทดลองเสียงคิว 001/);
  assert.match(BOARD_PAGE, /applyQueueBoardAudioStyle\(nextSettings, audioStyle\)/);
  assert.ok(
    MANAGER.indexOf("preparePickupQueueAnnouncement(row.label, voiceSettings)")
      < MANAGER.indexOf("await postPickupQueue("),
    "cashier audio must be unlocked by the click before waiting for the mutation",
  );
});

test("customer-display promotions are bounded and never replace active sale state", () => {
  assert.match(EXPERIENCE_MIGRATION, /customer_display_promo_slides JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(EXPERIENCE_MIGRATION, /jsonb_array_length\(customer_display_promo_slides\) <= 8/);
  assert.match(STORE_PROFILE, /customerDisplayPromoSlides\.length > 8/);
  assert.match(STORE_PROFILE, /customerDisplayPromoSlides\.some/);
  assert.match(CUSTOMER_DISPLAY, /phase === "idle" && <WelcomeBackground/);
  assert.match(CUSTOMER_DISPLAY, /promos=\{brand\?\.customerDisplayPromoSlides\}/);
});

test("Messenger profile publishes only fixed postback payloads and records the draft before provider I/O", () => {
  assert.match(MESSENGER_PROFILE, /META_STARTER_MESSAGES/);
  assert.doesNotMatch(MESSENGER_PROFILE, /payload:\s*(input|starter|row)\./);
  const publish = sliceFrom(MESSENGER_PROFILE, "export async function publishMessengerProfile", 5000);
  assert.ok(publish.indexOf("await saveState(") < publish.indexOf("await fetch("), "draft must commit before provider I/O");
  assert.match(publish, /authorization: `Bearer \$\{channel\.access_token\}`/);
  assert.match(publish, /ice_breakers/);
});

test("Desktop kitchen printing journals one server ticket and refuses automatic uncertain retries", () => {
  assert.match(RESTAURANT_PAGE, /jobId: `\$\{session\?\.device\.id/);
  assert.match(RESTAURANT_PAGE, /:\$\{ticket\.id\}`/);
  assert.match(RESTAURANT_PAGE, /for \(const ticket of tickets\.filter/);
  assert.doesNotMatch(RESTAURANT_PAGE, /jobId: \[\.\.\.group\.ticketIds\]/);
  assert.match(KITCHEN_PRINTER, /prior\?\.status === "PRINTED"/);
  assert.match(KITCHEN_PRINTER, /\["UNCERTAIN", "PRINTING"\]\.includes/);
  assert.match(KITCHEN_PRINTER, /options\.retry !== true/);
  assert.match(KITCHEN_PRINTER, /Content-Security-Policy/);
  assert.doesNotMatch(KITCHEN_PRINTER_SETTINGS, /item\.active !== false/);
});
