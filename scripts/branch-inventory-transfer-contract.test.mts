import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("branch inventory variants expose location, transit, and quarantine", async () => {
  const [service, schema, page] = await Promise.all([
    read("apps/web/lib/bms/products.ts"),
    read("apps/web/graphql/typeDefs.ts"),
    read("apps/web/app/(admin)/admin/products/page.tsx"),
  ]);
  assert.match(service, /loc\.name AS location_name/);
  assert.match(service, /tr\.status = 'IN_TRANSIT'/);
  assert.match(schema, /locationId: ID[\s\S]*quarantine_stock: Int![\s\S]*inTransitQty: Int!/);
  assert.match(page, /rowKey=\{\(variant: Variant\) => `\$\{variant\.locationId\}:\$\{variant\.size\}`\}/);
});

test("stock adjustments and reorder points require an explicit branch", async () => {
  const [schema, resolver, page] = await Promise.all([
    read("apps/web/graphql/typeDefs.ts"),
    read("apps/web/graphql/bmsProducts.ts"),
    read("apps/web/app/(admin)/admin/products/page.tsx"),
  ]);
  assert.match(schema, /bmsAdjustStock\([^)]*locationId: ID!/);
  assert.match(schema, /bmsSetReorderPoint\([^)]*locationId: ID!/);
  assert.match(resolver, /args\.locationId/);
  assert.match(page, /runAdjust\(v\.locationId, v\.size, delta\)/);
});

test("transfer discrepancy evidence cannot silently become sellable stock", async () => {
  const [migration, service, page] = await Promise.all([
    read("db/migrations/9.35__bms_branch_stock_and_transfer_discrepancies.sql"),
    read("apps/web/lib/bms/stockTransfers.ts"),
    read("apps/web/app/(admin)/admin/stock-transfers/page.tsx"),
  ]);
  assert.match(migration, /quarantine_stock/);
  assert.match(migration, /discrepancy_reason/);
  assert.match(service, /type: "QUARANTINE_IN"/);
  assert.match(service, /มีส่วนต่าง ต้องเลือกสาเหตุและกรอกหมายเหตุ/);
  assert.match(page, /รับสภาพดี/);
  assert.match(page, /เสียหาย\/กักกัน/);
  assert.match(page, /หมายเหตุส่วนต่าง/);
});
