import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  isMenuSellable,
  nextMenuAvailabilityReset,
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
