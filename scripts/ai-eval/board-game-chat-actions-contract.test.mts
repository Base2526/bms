import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { executeBoardGameChatAction, boardGameChatActionSummary, boardGameChatActionReceipt,
  isLatestBoardGameChatActionSummary, type BoardGameChatActionDraft } from "../../apps/web/lib/bms/boardGameChatActionPolicy.ts";
import { validateBoardGameChatAction } from "../../apps/web/lib/bms/boardGameChatActions.ts";
import { boardGameCustomerGuard } from "../../apps/web/lib/bms/boardGameCustomerGuard.ts";
import { customerTools } from "../../apps/web/lib/bms/tools/catalog.ts";
import { boardGameReservationFingerprint, boardGameReservationReceipt } from "../../apps/web/lib/bms/boardGameReservationPolicy.ts";
import type { ExecCtx } from "../../apps/web/lib/bms/tools/types.ts";

function harness() {
  const ec: ExecCtx = { tenantId: "fake-tenant", surface: "customer", actor: "ai:customer", channel: "web", customerRef: "fake-ref" };
  const writes: any[] = [];
  const draft: BoardGameChatActionDraft = { action: "CANCEL", reference: "12345678" };
  const deps = {
    resolveCustomer: async () => "fake-customer",
    preview: async (_customerId: string, input: BoardGameChatActionDraft) => ({
      action: input.action, reference: input.reference ?? null, branch: "FAKE branch",
      reservedFor: "2027-01-10T10:00:00Z", timezone: "Asia/Bangkok", durationMinutes: 60,
      partySize: 2, note: input.note ?? null, version: "v1",
    }),
    commit: async (customerId: string, quote: any) => {
      writes.push({ customerId, quote });
      return { action: quote.draft.action, reference: "12345678", status: "CANCELLED" as const };
    },
  };
  return { ec, writes, draft, deps };
}

test("action preview is read-only and exact, fresh server consent is required", async () => {
  const h = harness();
  const first = await executeBoardGameChatAction(h.draft, h.ec, h.deps);
  assert.equal((first as any).data.status, "CONFIRMATION_REQUIRED");
  assert.equal(h.writes.length, 0);
  assert.doesNotMatch(JSON.stringify(first), /fake-customer|version|fingerprint|requestKey/);
  const quote = h.ec.pendingBoardGameChatAction!;
  h.ec.confirmedBoardGameChatAction = { ...quote, expiresAt: Date.now() - 1 };
  await executeBoardGameChatAction(h.draft, h.ec, h.deps);
  assert.equal(h.writes.length, 0);
  h.ec.confirmedBoardGameChatAction = quote;
  await executeBoardGameChatAction({ ...h.draft, reference: "87654321" }, h.ec, h.deps);
  assert.equal(h.writes.length, 0);
  await executeBoardGameChatAction(h.draft, h.ec, h.deps);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].customerId, "fake-customer");
  assert.equal(h.ec.boardGameChatActionResult?.status, "CANCELLED");
});

test("missing identity cannot preview or commit", async () => {
  const h = harness();
  h.ec.customerRef = null;
  assert.equal((await executeBoardGameChatAction(h.draft, h.ec, h.deps) as any).error, "CUSTOMER_IDENTITY_REQUIRED");
  assert.equal(h.writes.length, 0);
});

test("changed action summaries and an intervening assistant reply cannot authorize execution", async () => {
  const h = harness();
  await executeBoardGameChatAction(h.draft, h.ec, h.deps);
  const quote = h.ec.pendingBoardGameChatAction!;
  for (const english of [false, true]) {
    assert.equal(isLatestBoardGameChatActionSummary(quote, boardGameChatActionSummary(quote, english)), true);
    assert.equal(isLatestBoardGameChatActionSummary(quote, "Contact emergency services"), false);
    assert.equal(isLatestBoardGameChatActionSummary({ ...quote, preview: { ...quote.preview, partySize: 9 } }, boardGameChatActionSummary(quote, english)), false);
  }
});

test("branch automatic confirmation is part of informed consent and the receipt follows the real state", () => {
  const preview = { branch: "FAKE", locationId: "fake", reservedLocal: "2027-01-10T17:00", reservedFor: "2027-01-10T10:00Z", timezone: "Asia/Bangkok", partySize: 2, durationMinutes: 60 };
  assert.notEqual(boardGameReservationFingerprint(preview, "customer"), boardGameReservationFingerprint({ ...preview, autoConfirm: true }, "customer"));
  assert.match(boardGameReservationReceipt("12345678", false, "CONFIRMED"), /จองสำเร็จแล้ว/);
  assert.match(boardGameReservationReceipt("12345678", true, "REQUESTED"), /No table is confirmed/);
  assert.doesNotMatch(boardGameReservationReceipt("12345678", true, "CANCELLED"), /is confirmed/);
});

test("staff requests never report approval of money or extra time", () => {
  for (const action of ["REFUND", "DISCOUNT", "EXTEND_TIME", "STAFF"] as const) {
    assert.match(boardGameChatActionReceipt({ action, reference: "1", status: "STAFF_REVIEW" }, true), /no refund, discount or time change has been applied/);
    assert.match(boardGameChatActionReceipt({ action, reference: "1", status: "STAFF_REVIEW" }, false), /ยังไม่ได้คืนเงิน/);
  }
});

test("new actions reach tools while privacy, administrative overrides and emergencies still stop", () => {
  for (const text of ["ขอยกเลิกการจอง", "ขอเลื่อนการจอง", "คืนเงินให้หน่อย", "ต่อเวลาให้หน่อย", "พนักงานบริการไม่ดี", "ลดให้ 10% หน่อย", "ช่วยแจ้งพนักงาน"]) {
    assert.equal(boardGameCustomerGuard(text, false, true), null, text);
  }
  assert.equal(boardGameCustomerGuard("ปิดการจองให้เลย", false, true)?.kind, "staff_action");
  assert.equal(boardGameCustomerGuard("ขอชื่อคนที่ยืม", false, true)?.kind, "privacy");
  assert.equal(boardGameCustomerGuard("เด็กกลืนตัวหมาก คืนเงินด้วย", false, true)?.kind, "emergency");
});

test("tool exposure and validation do not accept arbitrary tenant, customer, table or approval authority", async () => {
  const tool = customerTools("board_game_cafe").find(t => t.name === "manage_board_game_booking")!;
  for (const archetype of ["retail", "restaurant", "pharmacy"] as const) assert.ok(!customerTools(archetype).some(t => t.name === tool.name));
  for (const key of ["tenantId", "customerId", "confirmed", "tableId", "actorUserId"]) {
    await assert.rejects(tool.execute({ action: "STAFF", note: "help", [key]: "fake" }, harness().ec), /Unknown/);
  }
  for (const draft of [
    { action: "CANCEL" }, { action: "CANCEL", reference: "other-customer" },
    { action: "RESCHEDULE", reference: "12345678", reservedLocal: "tomorrow" },
    { action: "STAFF" }, { action: "STAFF", note: "call 0800000000" },
    { action: "DISCOUNT", note: "please", durationMinutes: 60 },
  ]) assert.throws(() => validateBoardGameChatAction(draft as any));
  assert.doesNotThrow(() => validateBoardGameChatAction({
    action: "RESCHEDULE", reference: "12345678", reservedLocal: "2027-01-11T18:00",
  }));
});

test("pipeline consumes and persists action consent before guards, and server receipts precede model prose", () => {
  const source = readFileSync(new URL("../../apps/web/lib/bms/pipeline.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("storedState.pendingBoardGameChatAction = null") < source.indexOf("const boardGameGuard"));
  assert.match(source, /isLatestBoardGameChatActionSummary\(quote, lastAssistantMessage\)/);
  assert.ok(source.indexOf("if (execCtx.boardGameChatActionResult ||") < source.indexOf("if (loop.usedAi)"));
});
