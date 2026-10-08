import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  confirmationChoiceOptions,
  createPendingConversationChoice,
  isConversationChoicePromptCurrent,
  resolveConversationChoice,
} from "../../apps/web/lib/bms/conversationChoices.ts";
import {
  boardGameReservationStatusMenu,
  boardGameReservationSummary,
} from "../../apps/web/lib/bms/boardGameReservationPolicy.ts";
import { boardGameChatActionSummary } from "../../apps/web/lib/bms/boardGameChatActionPolicy.ts";
import { composeOrderQuoteSummary } from "../../apps/web/lib/bms/orderQuote.ts";
import { restaurantRequestSummary } from "../../apps/web/lib/bms/restaurantRequestPolicy.ts";
import { bookingContactNextStepReply } from "../../apps/web/lib/bms/customerReplyPolicy.ts";
import { catalogStockMenu, stockResultMenu, insufficientStockMenu } from "../../apps/web/lib/bms/customerStockChoices.ts";

test("a number resolves only against the exact latest server-rendered menu", () => {
  const prompt = "Please choose\n1. Confirm\n2. Edit";
  const pending = createPendingConversationChoice({
    kind: "ORDER_CONFIRMATION",
    prompt,
    options: confirmationChoiceOptions(true),
    now: 1_000,
  });
  assert.equal(resolveConversationChoice(pending, "1", prompt, 2_000).kind, "matched");
  assert.equal(isConversationChoicePromptCurrent(pending, prompt, 2_000), true);
  assert.equal(resolveConversationChoice(pending, "เลือกข้อ 2 ค่ะ", prompt, 2_000).kind, "matched");
  assert.equal(resolveConversationChoice(pending, "2 คน", prompt, 2_000).kind, "not_choice");
  assert.equal(resolveConversationChoice(pending, "1", "A newer assistant reply", 2_000).kind, "stale");
  assert.equal(isConversationChoicePromptCurrent(pending, "A newer assistant reply", 2_000), false);
  assert.equal(resolveConversationChoice(pending, "3", prompt, 2_000).kind, "invalid");
  assert.equal(resolveConversationChoice(pending, "1", prompt, pending.expiresAt).kind, "expired");
  for (const answer of ["๑", "1)", "1.", "เลือกข้อ ๑ นะครับ"]) {
    assert.equal(resolveConversationChoice(pending, answer, prompt, 2_000).kind, "matched", answer);
  }
  assert.equal(resolveConversationChoice(pending, "123456", prompt, 2_000).kind, "invalid");
  assert.equal(resolveConversationChoice({ ...pending, consumed: true }, "1", prompt, 2_000).kind, "stale");
});

test("all deterministic customer confirmations offer short numbered replies", () => {
  const order = composeOrderQuoteSummary([{ sku: "FAKE-1", name: "FAKE item", size: "M", displayQty: 2 }]);
  const restaurant = restaurantRequestSummary({
    lines: [{ sku: "FAKE-1", name: "FAKE meal", size: "regular", displayQty: 1 }],
    locationName: "FAKE branch", fulfillmentType: "PICKUP", requestedAt: null, note: "",
  });
  const reservation = boardGameReservationSummary({
    draft: { branch: "FAKE branch", reservedLocal: "2027-01-10T18:00", durationMinutes: 120, partySize: 4 },
    preview: { branch: "FAKE branch", locationId: "fake-location", reservedLocal: "2027-01-10T18:00",
      reservedFor: "2027-01-10T11:00:00Z", timezone: "Asia/Bangkok", durationMinutes: 120, partySize: 4 },
    fingerprint: "fake", expiresAt: Date.now() + 60_000,
  }, false);
  const action = boardGameChatActionSummary({
    draft: { action: "CANCEL", reference: "12345678" },
    preview: { action: "CANCEL", reference: "12345678", branch: "FAKE branch",
      reservedFor: "2027-01-10T11:00:00Z", timezone: "Asia/Bangkok", durationMinutes: 120,
      partySize: 4, note: null, version: "fake" },
    fingerprint: "fake", expiresAt: Date.now() + 60_000, requestKey: "fake",
  }, false);
  for (const text of [order, restaurant, reservation, action]) {
    assert.match(text, /\n1\./);
    assert.match(text, /\n2\./);
  }
});

test("board-game status menus bind choices to verified bookings", () => {
  const requests = [
    { reference: "11111111", branch: "FAKE A", status: "CONFIRMED", reservedFor: "2027-01-10T11:00:00Z",
      timezone: "Asia/Bangkok", durationMinutes: 120, partySize: 4, rejectionReason: null },
    { reference: "22222222", branch: "FAKE B", status: "REQUESTED", reservedFor: "2027-01-11T11:00:00Z",
      timezone: "Asia/Bangkok", durationMinutes: 60, partySize: 2, rejectionReason: null },
  ];
  const multiple = boardGameReservationStatusMenu(requests, false);
  assert.equal(multiple.kind, "BOARD_GAME_BOOKING_SELECTION");
  assert.deepEqual(multiple.options.slice(0, 2).map(option => option.booking?.reference), ["11111111", "22222222"]);
  const single = boardGameReservationStatusMenu([requests[0]], false);
  assert.equal(single.kind, "BOARD_GAME_BOOKING_ACTION");
  assert.deepEqual(single.options.map(option => option.value), ["CANCEL_BOOKING", "RESCHEDULE_BOOKING", "KEEP"]);
  const pendingOnly = boardGameReservationStatusMenu([requests[1]], false);
  assert.deepEqual(pendingOnly.options.map(option => option.value), ["CANCEL_BOOKING", "KEEP"]);
});

test("booking contact collection never asks a board-game customer for shipping details", () => {
  const base = { marketplaceManaged: false, hasRecipientName: true, hasPhone: false,
    hasShippingAddress: false, shippingAddressCount: 0, defaultAddressLabel: null,
    missingFields: ["phone", "shippingAddress"] as Array<"phone" | "shippingAddress"> };
  assert.match(bookingContactNextStepReply(base, false), /เบอร์โทร/);
  assert.doesNotMatch(bookingContactNextStepReply(base, false), /ที่อยู่จัดส่ง/);
  assert.match(bookingContactNextStepReply({ ...base, hasPhone: true }, false), /ไม่ต้องแจ้งที่อยู่จัดส่ง/);
});

test("the shared pipeline resolves a stored menu before generic short-number normalization", () => {
  const source = readFileSync(new URL("../../apps/web/lib/bms/pipeline.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("resolveConversationChoice(") < source.indexOf("normalizeShortReplyMessage(interpretedMessage"));
  for (const kind of [
    "ORDER_CONFIRMATION", "RESTAURANT_REQUEST_CONFIRMATION",
    "BOARD_GAME_RESERVATION_CONFIRMATION", "BOARD_GAME_ACTION_CONFIRMATION",
  ]) assert.match(source, new RegExp(`confirmationChoiceState\\(\\"${kind}\\"`));
  assert.match(source, /pending\.kind\.endsWith\("_CONFIRMATION"\)/);
  assert.match(source, /pendingBoardGameReschedule/);
});

test("stock menus bind exact numeric variants, exclude unavailable options and page within nine codes", () => {
  const result = { status: "SIZE_UNKNOWN" as const, sku: "FAKE-SKU", name: "FAKE item", price: 50,
    sizes: Array.from({ length: 12 }, (_, i) => ({ size: String(250 + i), available: i === 0 ? 0 : 4, price: 50 })) };
  for (const english of [false, true]) {
    const first = stockResultMenu(result, english)!;
    assert.equal(first.options.length, 9);
    assert.deepEqual(first.options[0].stockAction, { action: "CHECK", sku: "FAKE-SKU", size: "251" });
    assert.deepEqual(first.options[7].stockAction, { action: "CHECK", sku: "FAKE-SKU", offset: 7 });
    const second = stockResultMenu(result, english, false, 7)!;
    assert.deepEqual(second.options[0].stockAction, { action: "CHECK", sku: "FAKE-SKU", size: "258" });
    assert.doesNotThrow(() => createPendingConversationChoice({ kind: "STOCK_SELECTION", prompt: second.reply, options: second.options }));
  }
});

test("catalog choices are deduplicated, bounded and never claim clinical interchangeability", () => {
  const products = Array.from({ length: 14 }, (_, i) => ({ sku: `FAKE-${Math.floor(i / 2)}`, name: "FAKE item", price: 50 }));
  const menu = catalogStockMenu(products)!;
  assert.equal(menu.options.length, 8);
  assert.equal(menu.options.at(-1)?.value, "KEEP");
  assert.doesNotMatch(menu.reply, /ใช้แทน|เทียบเท่า/);
  assert.equal(catalogStockMenu([]), null);
});

test("stock shortages preserve the whole basket and never reinterpret base availability as packs", () => {
  const result = { status: "INSUFFICIENT" as const, sku: "FAKE-A", size: "M", requested: 8, available: 3 };
  const items = [{ sku: "FAKE-A", size: "M", qty: 8 }, { sku: "FAKE-B", size: "L", qty: 2 }];
  const menu = insufficientStockMenu(result, items)!;
  assert.deepEqual(menu.options[0].stockAction, { action: "REVISE", items: [{ ...items[0], qty: 3 }, items[1]] });
  assert.equal(items[0].qty, 8);
  for (const draft of [[{ ...items[0], packCode: "BOX" }], [items[0], items[0]], []]) {
    assert.equal(insufficientStockMenu(result, draft)!.options.some(option => option.stockAction?.action === "REVISE"), false);
  }
  assert.equal(insufficientStockMenu({ ...result, available: 0 }, items)!.options.some(option => option.stockAction?.action === "REVISE"), false);
});
