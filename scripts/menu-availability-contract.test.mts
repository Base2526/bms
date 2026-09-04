import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  isMenuSellable,
  nextMenuAvailabilityReset,
  resetMenuAvailabilityForLocationInTx,
} from "../apps/web/lib/bms/menuAvailability.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const withoutComments = (text: string) => text
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--.*$/gm, "");

test("ความพร้อมใช้ policy เดียวและธงหมดวันนี้ชนะทุก policy", () => {
  for (const stockPolicy of ["DIRECT", "PACK", "BUNDLE", "WEIGHTED", "RECIPE", "SERIALIZED", "NON_STOCK"] as const) {
    assert.deepEqual(isMenuSellable({ stockPolicy, temporarilyUnavailable: true, available: 99 }), {
      sellable: false, availability: "SOLD_OUT_TODAY",
    });
  }
  assert.equal(isMenuSellable({ stockPolicy: "NON_STOCK", temporarilyUnavailable: false, available: 0 }).sellable, true);
  assert.equal(isMenuSellable({ stockPolicy: "RECIPE", temporarilyUnavailable: false, available: 0 }).sellable, true);
  assert.equal(isMenuSellable({ stockPolicy: "DIRECT", temporarilyUnavailable: false, available: 0 }).sellable, false);
  assert.equal(isMenuSellable({ stockPolicy: "PACK", temporarilyUnavailable: false, available: 1 }).sellable, true);
});

test("ขอบเขตวันร้านอาหารรีเซ็ต 04:00 Asia/Bangkok ไม่ใช่เที่ยงคืน", () => {
  assert.equal(
    nextMenuAvailabilityReset(new Date("2026-09-03T18:00:00.000Z")).toISOString(),
    "2026-09-03T21:00:00.000Z",
    "01:00 เวลาร้านยังอยู่ในรอบบริการเดิมและต้องรอ 04:00"
  );
  assert.equal(
    nextMenuAvailabilityReset(new Date("2026-09-03T22:00:00.000Z")).toISOString(),
    "2026-09-04T21:00:00.000Z",
    "หลัง 04:00 ต้องไปรอบวันถัดไป"
  );
});

test("ทุก surface อ่านธงเดียวกัน และ route mutation มี device+PIN guard", () => {
  const products = withoutComments(source("apps/web/lib/bms/products.ts"));
  const restaurant = withoutComments(source("apps/web/lib/bms/restaurantPos.ts"));
  const route = withoutComments(source("apps/web/app/api/pos/restaurant/menu/route.ts"));
  const shift = withoutComments(source("apps/web/lib/bms/pos.ts"));
  assert.match(products, /bms_product_menu_unavailability/);
  assert.match(products, /isMenuSellable/);
  assert.match(restaurant, /bms_product_menu_unavailability/);
  assert.match(restaurant, /isMenuSellable/);
  assert.match(route, /authenticateRestaurantMutation\(req, body, "pos\.sell"\)/);
  assert.match(shift, /resetMenuAvailabilityForLocationInTx/);
});

test("migration ผูกธงกับสินค้า x สาขา พร้อม RLS และรีเซ็ต 04:00", () => {
  const sql = withoutComments(source("db/migrations/9.55__bms_menu_temporary_unavailability.sql"));
  assert.match(sql, /PRIMARY KEY \(tenant_id, location_id, product_sku\)/);
  assert.match(sql, /menu_availability_reset_time TIME NOT NULL DEFAULT '04:00'/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_menu_unavailability TO bms_app/);
});

test("ตัวตั้งเวลายิง due-reset ถี่พอสำหรับ timezone และเวลารีเซ็ตที่ร้านกำหนดเอง", () => {
  const workflow = source(".github/workflows/bms-cron.yml");
  const operations = source("apps/web/lib/bms/operationsSchedule.ts");
  assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(workflow, /name: menu-availability-reset\s+path: \/api\/bms\/menu-availability\/reset/);
  assert.match(operations, /key: "menu-availability-reset"/);
});

test("เปิดกะล้างได้แค่รายการที่หมดรอบบริการแล้ว ไม่ล้างของที่เพิ่งปิดวันนี้", async () => {
  // กะเป็นของ "เครื่อง x คนขาย" ไม่ใช่ของ "วันบริการ" — ร้านสองเครื่องหรือร้านที่เปลี่ยนกะ
  // กลางวันเปิดกะหลายรอบต่อวัน ถ้าเปิดกะล้างทั้งสาขา เมนูที่ครัวเพิ่งบอกว่าหมดจะกลับขึ้นเมนู
  // ตอนเครื่องที่สองเปิดกะ โดยไม่มีอะไรบนจอบอกว่าใครยกเลิกการตัดสินใจนั้น
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const client = {
    query: async (sql: string, params: readonly unknown[]) => {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
  };
  const now = new Date("2026-09-04T05:00:00.000Z");
  const cleared = await resetMenuAvailabilityForLocationInTx(
    client as never, "tenant-1", "location-1", now
  );
  assert.equal(cleared, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /DELETE FROM bms_product_menu_unavailability/);
  assert.match(calls[0].sql, /resets_at <= \$3/,
    "เปิดกะต้องกรองด้วย resets_at ไม่ใช่ลบทุกแถวของสาขา");
  assert.deepEqual(calls[0].params, ["tenant-1", "location-1", now]);
});

test("กวาดรีเซ็ตตามกำหนดต้องข้ามร้านที่ล้ม ไม่ใช่หยุดทั้งรอบ", () => {
  // รูปเดียวกับบั๊ก orders/release-expired: ร้านเดียวที่ข้อมูลเพี้ยนทำให้ร้านที่เหลือ
  // ไม่ถูกกวาดเลย และรอบถัดไปก็เจอแถวเดิมแล้วหยุดอีก = เมนูปิดค้างตลอดไป
  const sweep = withoutComments(source("apps/web/lib/bms/menuAvailability.ts"));
  const body = sweep.slice(sweep.indexOf("export async function resetDueMenuAvailability"));
  assert.doesNotMatch(body, /catch \(error\) \{[\s\S]{0,200}throw error/);
  assert.match(body, /failed\.push\(/);
  assert.match(body, /failedCount: failed\.length/);
});

test("ไม่มี query ไหนอ้าง is_default บน bms_locations (คอลัมน์นั้นไม่มีจริง)", () => {
  // bms_locations (7.84) มีแค่ code / is_head_office — ไม่มี is_default เลย ORDER BY ด้วยชื่อนั้น
  // ทำให้ทุกการเรียกล้มด้วย 42703 ซึ่งแปลว่าออร์เดอร์ร้านอาหารออนไลน์สร้างไม่ได้เลยสักใบ
  const files = [
    "apps/web/lib/bms/orders.ts",
    "apps/web/lib/bms/restaurantOrdering.ts",
    "apps/web/lib/bms/locations.ts",
  ];
  for (const file of files) {
    for (const literal of source(file).split("`").filter((_, index) => index % 2 === 1)) {
      if (!literal.includes("bms_locations")) continue;
      assert.doesNotMatch(literal, /is_default/, `${file} อ้าง is_default บน bms_locations`);
    }
  }
  assert.match(source("apps/web/lib/bms/restaurantOrdering.ts"),
    /ORDER BY \(code = \$2\) DESC, is_head_office DESC, created_at/);
  assert.match(source("apps/web/lib/bms/orders.ts"),
    /ORDER BY \(code = \$2\) DESC, is_head_office DESC, created_at/);
});

test("อ่าน business_archetype แยกคำสั่งจากคอลัมน์ของ 9.56", () => {
  // ฟังก์ชันนี้รันกับทุกออร์เดอร์ที่ไม่ใช่ POS ของทุกร้าน ถ้าคำสั่งเดียวกันเอ่ยคอลัมน์ใหม่ด้วย
  // ฐานที่ยังไม่ apply 9.56 จะขายไม่ได้ทั้งแพลตฟอร์ม ไม่ใช่แค่ร้านอาหาร (บทเรียนเดิมจาก 9.29)
  const service = withoutComments(source("apps/web/lib/bms/restaurantOrdering.ts"));
  const body = service.slice(
    service.indexOf("export async function restaurantOrderingStateInTx"),
    service.indexOf("export async function listRestaurantOrderLocations")
  );
  const literals = body.split("`").filter((_, index) => index % 2 === 1);
  const archetypeSelect = literals.find((literal) => literal.includes("business_archetype"));
  assert.ok(archetypeSelect, "ต้องมีคำสั่งอ่าน business_archetype");
  assert.doesNotMatch(archetypeSelect!, /restaurant_order_hours|restaurant_orders_paused/);
});

test("การ์ดเมนูที่ยังขายได้ต้องไม่มีปุ่มปิดขายเต็มความกว้างใต้การ์ด", () => {
  // แถบแดง "หมดวันนี้" ใต้ทุกการ์ดอ่านเป็น *สถานะ* ไม่ใช่ *ปุ่ม* — พนักงานเข้าใจว่าเมนูปิดอยู่
  // ทั้งที่ยังขายได้ปกติ (รายงานจากหน้าร้านจริง 2026-09-04) และปุ่มที่ย้อนคืนยากไปนั่งติด
  // ปุ่มที่กดบ่อยสุดของจอด้วยขนาดเท่ากัน · กติกาเดียวกับที่ .sheetActions ยุบงานทั้งบิลไป Modal
  const page = withoutComments(source("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.doesNotMatch(page, /dishAvailabilityButton/,
    "ห้ามคืนแถบปิดขายเต็มความกว้างมาอยู่ใต้การ์ดที่ยังขายได้");
  assert.match(page, /styles\.dishKebab/, "การ์ดปกติต้องมีปุ่ม ⋯ แทน");
  assert.match(page, /onClick=\{\(\) => setSoldOutSheet\(item\)\}/,
    "ปุ่ม ⋯ ต้องเปิดแผ่นยืนยันก่อน ไม่ใช่ปิดขายทันทีที่แตะ");
  assert.match(page, /MENU_SOLD_OUT_REASONS\.map/,
    "แผ่นยืนยันต้องให้เลือกสาเหตุจริง ไม่ใช่ส่งคำว่าหมดวันนี้ซ้ำสถานะ");
  assert.match(page, /setMenuAvailability\(item, true, reason\)/);
  // ปุ่มเต็มความกว้างสงวนไว้ให้ "เปิดขาย" บนการ์ดที่ปิดอยู่ ซึ่งตอนนั้นคือสิ่งที่คนอยากทำจริง
  assert.match(page, /className=\{styles\.dishReopen\}[\s\S]{0,160}เปิดขาย/);
});

test("เวลาที่เมนูจะกลับมาขายเองมาจาก server ไม่ใช่จอเดา", () => {
  // เวลารีเซ็ตวันบริการตั้งได้รายร้าน (menu_availability_reset_time + timezone) จอที่เขียน
  // 04:00 ตายตัวจะบอกเวลาผิดให้ร้านที่ตั้งค่าอื่น — และนั่นคือข้อมูลที่พนักงานเอาไปบอกลูกค้า
  const service = withoutComments(source("apps/web/lib/bms/restaurantPos.ts"));
  const menu = service.slice(
    service.indexOf("export async function listRestaurantMenu"),
    service.indexOf("export async function createDefaultRestaurantFloor")
  );
  assert.ok(menu.length > 0, "หา listRestaurantMenu ไม่เจอ");
  assert.match(menu, /unavailable\.resets_at AS unavailable_resets_at/);
  assert.match(menu, /unavailableResetsAt: iso\(row\.unavailable_resets_at\)/);
  assert.match(menu, /unavailableReason: row\.unavailable_reason/);
  const page = withoutComments(source("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.doesNotMatch(page, /04:00/, "จอห้าม hardcode เวลารีเซ็ตของร้าน");
  assert.match(page, /timeOf\(item\.unavailableResetsAt\)/);
});
