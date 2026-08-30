import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { formatCustomerOrderHistoryFallback } from "../apps/web/lib/bms/customerOrderHistoryPresentation.ts";

const customersSource = await readFile(
  new URL("../apps/web/lib/bms/customers.ts", import.meta.url),
  "utf8"
);
const catalogSource = await readFile(
  new URL("../apps/web/lib/bms/tools/catalog.ts", import.meta.url),
  "utf8"
);
const assistantSource = await readFile(
  new URL("../apps/web/graphql/bmsAssistant.ts", import.meta.url),
  "utf8"
);

test("staff customer-order history is bounded without truncating the Customer UI resolver", () => {
  assert.match(customersSource, /export async function customerOrders\([\s\S]*ORDER BY created_at DESC`/);
  assert.match(customersSource, /export async function customerOrderHistory\(/);
  assert.match(customersSource, /Math\.min\(Math\.max\(Math\.trunc\(limit\), 1\), 10\)/);
  assert.match(customersSource, /Math\.min\(Math\.max\(Math\.trunc\(offset\), 0\), 10_000\)/);
  assert.match(customersSource, /COUNT\(\*\)::int AS total_count/);
  assert.match(customersSource, /COUNT\(\*\) FILTER \(WHERE status = ANY\(\$5\)\)::int AS successful_count/);
  assert.match(customersSource, /LEFT JOIN LATERAL/);
  assert.match(customersSource, /LIMIT \$3 OFFSET \$4/);
  assert.match(customersSource, /ORDER BY created_at DESC, id DESC/);
  assert.match(customersSource, /nextOffset: nextOffset < totalCount \? nextOffset : null/);
});

test("customer_orders reports pagination truth and requires a resolved customer id", () => {
  assert.match(catalogSource, /First resolve the customerId with list_customers/);
  assert.match(catalogSource, /customerOrderHistory\(/);
  assert.match(catalogSource, /optInt\(args, "limit", 1, 10\) \?\? 5/);
  assert.match(catalogSource, /optInt\(args, "offset", 0, 10_000\) \?\? 0/);
  assert.match(catalogSource, /successfulCount, nextOffset and truncated/);
  assert.match(catalogSource, /Do not pass a customer name as customerId/);
  assert.match(catalogSource, /more than one plausible customer/);
  assert.match(catalogSource, /Do not confuse totalCount \(all statuses\) with successfulCount/);
  assert.match(catalogSource, /fallbackReply: \(data, ec\)/);
  assert.match(catalogSource, /formatCustomerOrderHistoryFallback\(/);
});

test("staff assistant cannot turn an incomplete customer-history answer into an em dash", () => {
  assert.match(assistantSource, /ให้ใช้ list_customers หา customerId ก่อน แล้วเรียก customer_orders/);
  assert.doesNotMatch(assistantSource, /reply: loop\.reply \|\| "—"/);
  assert.match(assistantSource, /ผู้ช่วยประมวลผลคำตอบที่ยืนยันได้ไม่ครบ/);
});

test("customer_orders fallback gives verified rows and actionable continuation guidance", () => {
  const reply = formatCustomerOrderHistoryFallback(
    {
      orders: [{
        id: "order-123456789",
        channel: "pos",
        status: "COMPLETED",
        total_amount: "3416.20",
        created_at: "2026-08-29T13:24:05.000Z",
      }],
      totalCount: 37,
      successfulCount: 21,
      nextOffset: 5,
    },
    "th"
  );
  assert.match(reply, /คำตอบ AI ถูกตัดก่อนจบ ระบบจึงแสดงผลที่ยืนยันแล้วให้โดยตรง/);
  assert.match(reply, /แสดง 1 จาก 37 รายการ \(สำเร็จ 21 รายการ\)/);
  assert.match(reply, /#order-12 · COMPLETED · 3,416\.20 ฿/);
  assert.match(reply, /พิมพ์ "ดูรายการถัดไป" เพื่อดูต่อจากรายการที่ 6/);
});
