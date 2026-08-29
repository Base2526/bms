import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as XLSX from "../apps/web/node_modules/xlsx/xlsx.mjs";

import { buildPosShiftWorkbook } from "../apps/web/lib/bms/posShiftExport.ts";

const ROOT = new URL("../", import.meta.url);

function fixture(expectedCashHidden: boolean) {
  return {
    report: {
      shiftId: "00000000-0000-0000-0000-000000000001",
      deviceCode: "POS001", locationName: "HQ", status: "OPEN" as const,
      openedAt: "2026-08-29T01:00:00.000Z", openedByName: "Cashier",
      closedAt: null, closedByName: null, openingFloat: 1000,
      salesTotal: 500, billCount: 1, voidCount: 0, voidTotal: 0,
      returnCount: 0, returnTotal: 0, discountTotal: 0,
      byMethod: [{ method: "CASH", count: 1, amount: 500 }],
      byCashier: [{ cashier: "Cashier", billCount: 1, amount: 500 }],
      cashIn: 0, cashOut: 0, cashRefunds: 0,
      expenseCount: 0, expenseTotal: 0, personalExpenseCount: 0,
      personalExpenseTotal: 0, pettyCashExpenseCount: 0, pettyCashExpenseTotal: 0,
      openExpenseCount: 0, openExpenseAmount: 0, noSaleCount: 0,
      expectedCash: expectedCashHidden ? null : 1500,
      expectedCashHidden, countedCash: null, cashVariance: null,
    },
    bills: [], payments: [], cashMovements: [], refunds: [], expenses: [], noSales: [], creditActivity: [],
  };
}

const ar = {
  creditSalesAmount: 0, creditSalesCount: 0, collectedAmount: 0,
  collectedCount: 0, collectedCashAmount: 0,
};

test("shift workbook exposes audit sheets and keeps blind-close expected cash hidden", () => {
  const workbook = XLSX.read(buildPosShiftWorkbook(fixture(true), ar), { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Summary", "ตรวจสอบยอด"]);
  const summary = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets.Summary, { header: 1 });
  assert.ok(summary.some((row) => row[0] === "เงินสดที่ควรมี" && row[1] === "ซ่อนจนกว่าจะปิดกะ"));
  const reconcile = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets["ตรวจสอบยอด"], { header: 1 });
  assert.ok(reconcile.some((row) => row[0] === "เงินสดที่ควรมี" && row[2] === "ซ่อนจนกว่าจะปิดกะ"));
});

test("closed shift workbook carries the server-stored expected cash", () => {
  const data = fixture(false);
  data.report.status = "CLOSED";
  data.report.closedAt = "2026-08-29T09:00:00.000Z";
  data.report.countedCash = 1490;
  data.report.cashVariance = -10;
  const workbook = XLSX.read(buildPosShiftWorkbook(data, ar), { type: "buffer" });
  const reconcile = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets["ตรวจสอบยอด"], { header: 1 });
  assert.ok(reconcile.some((row) => row[0] === "เงินสดที่ควรมี" && row[2] === 1500));
  assert.ok(reconcile.some((row) => row[0] === "ส่วนต่าง" && row[2] === -10));
});

test("return/refund shift attribution is explicit and report queries prefer it", async () => {
  const migration = await readFile(new URL("db/migrations/9.32__bms_pos_return_shift_attribution.sql", ROOT), "utf8");
  const service = await readFile(new URL("apps/web/lib/bms/pos.ts", ROOT), "utf8");
  const exportRoute = await readFile(new URL("apps/web/app/api/pos/shift-report/export/route.ts", ROOT), "utf8");
  assert.match(migration, /bms_pos_returns[\s\S]*shift_id UUID REFERENCES bms_pos_shifts/);
  assert.match(migration, /completed_shift_id UUID REFERENCES bms_pos_shifts/);
  assert.match(service, /COALESCE\(pr\.shift_id, o\.pos_shift_id\)/);
  assert.match(service, /completed_shift_id = \$5/);
  assert.match(exportRoute, /cashierHasPermission[\s\S]*"pos\.shift\.report"/);
  assert.match(exportRoute, /getPosShiftExportData\(device\.tenantId, shiftId, device\.id\)/);
});
