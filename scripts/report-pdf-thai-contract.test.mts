import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildPdf, type ReportDoc } from "../apps/web/lib/bms/documentGenerator.ts";

const report = (rows: number): ReportDoc => ({
  title: "Sales / Inventory / Profit / Customer report",
  subtitle: "November 2026 — ร้านตัวอย่าง",
  meta: [{ label: "Branch", value: "สาขากรุงเทพ" }],
  sheets: [{
    name: "สินค้าขายดี / Top products",
    columns: [{ key: "name", label: "Product" }, { key: "amount", label: "Amount" }],
    rows: Array.from({ length: rows }, (_, i) => ({
      name: i === 200 ? "บรรทัดที่ 201 — สินค้าทดสอบไทยและ English ".repeat(10) : `สินค้า ${i + 1}`,
      amount: i + 0.25,
    })),
  }],
});

test("general PDF embeds a Thai-capable font and includes rows beyond the old 200-row cutoff", async () => {
  assert.ok(existsSync(path.join(process.cwd(), "public/fonts/sarabun/Sarabun-Regular.ttf")));
  const first = await buildPdf(report(200), "สรุปยอดขายและกำไร");
  const extended = await buildPdf(report(201), "สรุปยอดขายและกำไร");
  assert.equal(first.subarray(0, 5).toString(), "%PDF-");
  assert.match(extended.toString("latin1"), /Sarabun/);
  assert.match(extended.toString("latin1"), /ToUnicode/);
  assert.ok(extended.length > first.length + 50, "the 201st long row must affect the output");
  if (process.env.BMS_PDF_VISUAL_OUTPUT) writeFileSync(process.env.BMS_PDF_VISUAL_OUTPUT, extended);
});

test("PDF refuses an overlarge report without silently dropping rows", async () => {
  await assert.rejects(buildPdf(report(10_001)), /10,000/);
});
