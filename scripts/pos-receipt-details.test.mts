import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { shouldPrintMemberPoints } from "../apps/web/lib/bms/loyaltyMath.ts";
import { receiptPromotionNotes } from "../apps/web/lib/bms/receiptPromotionNotes.ts";
import { boardGameReceiptNotes } from "../apps/web/lib/bms/boardGameReceiptNotes.ts";
import { taxRequestUnavailableReason } from "../apps/web/lib/bms/taxRequestToken.ts";
import { POS_LAST_SALE_QUERY } from "../apps/web/lib/pos/mobileFlowGraphql.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/web/lib/bms/pos.ts", import.meta.url), "utf8");
const body = source.slice(source.indexOf("export async function listRecentPosSales("), source.indexOf("export type PosReturnResult"))
  .replace("export async function", "async function");
const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

async function history(overrides = {}) {
  const sql: string[] = [];
  const deps = {
    query: async (text: string, params: unknown[]) => {
      sql.push(text);
      assert.equal(params[0], "tenant-test", "every receipt lookup remains tenant-scoped");
      if (text.startsWith("SELECT o.id,")) return { rows: [{
        id: "order-test", channel: "pos", location_id: "branch-test", total_amount: "2505",
        discount_amount: "0", extra_total: "2430", status: "COMPLETED", sold_at: "2026-10-04T08:00:00Z",
        member_no: "TEST-001", member_name: "FAKE Member", points_earned: "25", points_balance: 506,
        loyalty_enabled: true, points_expiring: "31", points_expire_at: "2026-12-31T16:59:59Z",
        board_game_charge_snapshot: [{ displayName: "FAKE Player", rateName: "Standard", hourlyRate: 50, billableMinutes: 120, amount: 100 }],
        ...overrides,
      }] };
      if (text.startsWith("SELECT oi.id,")) return { rows: [{
        id: 1, order_id: "order-test", product_sku: "FAKE-SNACK", product_name: "Snack", size: "STD",
        qty: 3, pack_qty: 3, receipt_unit_price: "25", unit_price: "25", pack_unit_price: null,
        pricing_snapshot: { source: "SALE", promotion: null },
      }] };
      if (text.includes("FROM bms_order_extra_lines")) return { rows: [{
        order_id: "order-test", label: "Play time", qty: "1", unit_amount: "2430",
      }] };
      return { rows: [] };
    },
    normalizePosReceiptName: (name: string) => name,
    toISO: (date: string | Date) => new Date(date).toISOString(),
    mapReceiptVat: () => null,
    shouldPrintMemberPoints, receiptPromotionNotes, boardGameReceiptNotes, taxRequestUnavailableReason,
    COUNTER_RETURN_UNSUPPORTED_CHANNELS: new Set(),
  };
  const list = new Function(...Object.keys(deps), `${compiled}; return listRecentPosSales;`)(...Object.values(deps));
  const [receipt] = await list("tenant-test", "device-test", 1);
  return { receipt, sql };
}

test("history returns saved charges, order earnings and the current balance/next expiry", async () => {
  const { receipt, sql } = await history();
  assert.equal(receipt.extraLines[0].amount, 2430);
  assert.ok(receipt.boardGameTimeNotes.some((note: string) => note.includes("50.00 บาท/ชม.")));
  assert.match(sql[0], /bg\.tenant_id = o\.tenant_id AND bg\.id = o\.board_game_billing_group_id/);
  assert.equal(receipt.pointsEarned, 25);
  assert.equal(receipt.pointsBalance, 506);
  assert.equal(receipt.pointsExpiring, 31);
  assert.equal(receipt.pointsExpireAt, "2026-12-31T16:59:59.000Z");
  assert.match(sql[0], /l\.order_id = o\.id AND l\.kind = 'EARN'/);
  assert.match(sql[0], /l\.customer_id = o\.customer_id/);
  assert.match(sql[0], /l\.points > l\.consumed_points AND l\.expires_at > now\(\)/);
  assert.match(sql[0], /GROUP BY l\.expires_at ORDER BY l\.expires_at LIMIT 1/);
});

test("guest and disabled-program bills have no fabricated zero-point block", async () => {
  for (const overrides of [{ member_no: null, points_earned: "0" }, { loyalty_enabled: false, points_earned: "0" }]) {
    const { receipt } = await history(overrides);
    assert.equal(receipt.pointsEarned, null);
    assert.equal(receipt.pointsBalance, null);
    assert.equal(receipt.pointsExpireAt, null);
  }
  const { receipt } = await history({ loyalty_enabled: false });
  assert.equal(receipt.pointsEarned, 25, "disabling loyalty later must not erase earned points");
});

test("desktop GraphQL selects every receipt detail exposed by the shared service", () => {
  for (const field of ["extraLines", "boardGameTimeNotes", "promotionNotes", "pointsEarned", "pointsBalance", "pointsExpiring", "pointsExpireAt"]) {
    assert.ok(POS_LAST_SALE_QUERY.includes(field));
  }
  const { buildSchema, parse, validate } = require(fileURLToPath(new URL("../apps/web/node_modules/graphql/index.js", import.meta.url)));
  const schema = buildSchema(readFileSync(new URL("../schema.graphql", import.meta.url), "utf8"));
  assert.deepEqual(validate(schema, parse(POS_LAST_SALE_QUERY)), []);
});
