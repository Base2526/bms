import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { clarifyAmbiguousStaffRequest } from "../../apps/web/lib/bms/staffAssistantClarification.ts";

test("ambiguous Thai all-sales request asks for both period and result shape", () => {
  const reply = clarifyAmbiguousStaffRequest("ขอดูรายการขายที่ขายได้ทั้งหมด");
  assert.match(reply ?? "", /ทุกช่วงเวลา/);
  assert.match(reply ?? "", /สินค้า/);
  assert.match(reply ?? "", /ออร์เดอร์/);
});

test("known result shape still asks which period 'all' means", () => {
  assert.match(
    clarifyAmbiguousStaffRequest("ขอดูสินค้าที่ขายได้ทั้งหมด") ?? "",
    /ยืนยันช่วงเวลา/
  );
});

test("known period still asks whether sales means products, summary, or orders", () => {
  assert.match(
    clarifyAmbiguousStaffRequest("ขอดูรายการขายทั้งหมดเดือนนี้") ?? "",
    /ยืนยันรูปแบบรายการ/
  );
});

test("explicit all-time product request proceeds without clarification", () => {
  assert.equal(
    clarifyAmbiguousStaffRequest("ขอดูสินค้าที่ขายได้ทั้งหมด ตั้งแต่เปิดร้าน"),
    null
  );
});

test("clear bounded report and unrelated catalog request proceed normally", () => {
  assert.equal(clarifyAmbiguousStaffRequest("สรุปยอดขาย 30 วันล่าสุด"), null);
  assert.equal(clarifyAmbiguousStaffRequest("ขอดูสินค้าทั้งหมดในร้าน"), null);
});

test("sales tools expose and validate an explicit all-time scope", () => {
  const catalog = readFileSync(
    new URL("../../apps/web/lib/bms/tools/catalog.ts", import.meta.url),
    "utf8"
  );
  for (const toolName of ["get_sales_summary", "get_top_products"]) {
    const start = catalog.indexOf(`name: "${toolName}"`);
    assert.notEqual(start, -1, `${toolName} must exist`);
    const section = catalog.slice(start, catalog.indexOf("\n};", start) + 3);
    assert.match(section, /enum: \["all_time"\]/);
    assert.match(section, /scope === "all_time"/);
    assert.match(section, /if \(from \|\| to\)/);
  }
});
