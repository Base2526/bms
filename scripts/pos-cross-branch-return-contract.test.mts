import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("cross-branch return schema keeps sale, receiving, and lot provenance separate", async () => {
  const migration = await read("db/migrations/9.34__bms_pos_cross_branch_returns.sql");
  assert.match(migration, /sale_location_id UUID REFERENCES bms_locations/);
  assert.match(migration, /return_location_id UUID REFERENCES bms_locations/);
  assert.match(migration, /restock_lot_id UUID REFERENCES bms_inventory_lots/);
  assert.match(migration, /'pos\.return\.cross_branch'/);
});

test("return service derives receiving stock from the open device shift", async () => {
  const source = await read("apps/web/lib/bms/pos.ts");
  assert.match(source, /JOIN bms_pos_devices d[\s\S]+d\.location_id[\s\S]+status = 'OPEN'/);
  assert.match(source, /const returnLocationId = returnShift\.rows\[0\]\.location_id/);
  assert.match(source, /locationId: returnLocationId/);
  assert.match(source, /FROM bms_order_stock_lines[\s\S]+order_item_id = \$3/);
  assert.doesNotMatch(
    source,
    /SET current_stock = current_stock \+ \$2[\s\S]{0,220}\[input\.tenantId, baseQtyToReturn, item\.location_id/
  );
});

test("counter search exposes non-marketplace completed channels without widening void", async () => {
  const source = await read("apps/web/lib/bms/pos.ts");
  const recentSales = source.slice(
    source.indexOf("export async function listRecentPosSales"),
    source.indexOf("export type PosReturnResult")
  );
  assert.doesNotMatch(recentSales, /o\.channel = 'pos'/);
  assert.match(source, /COUNTER_RETURN_UNSUPPORTED_CHANNELS = new Set\(\["lazada", "shopee"\]\)/);
  assert.match(source, /if \(input\.isVoid && order\.pos_device_id !== input\.deviceId\)/);
});

test("UI discloses cross-branch approval and marketplace ownership", async () => {
  const page = await read("apps/web/app/(pos)/pos/page.tsx");
  assert.match(page, /คืนข้ามสาขาต้องให้ผู้มีสิทธิ์คนที่สองอนุมัติ/);
  assert.match(page, /ต้องคืนผ่าน marketplace ต้นทาง/);
  assert.match(page, /row\.returnEligible !== false/);
});

test("return reports disclose sale and receiving branches", async () => {
  const reports = await read("apps/web/lib/bms/reports.ts");
  const page = await read("apps/web/app/(admin)/admin/reports/page.tsx");
  assert.match(reports, /pr\.sale_location_id/);
  assert.match(reports, /pr\.return_location_id/);
  assert.match(page, /saleLocationName[\s\S]+returnLocationName/);
});
