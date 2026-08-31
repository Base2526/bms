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
  assert.match(schema, /locationId: ID[\s\S]*quarantine_stock: Int![\s\S]*inTransitQty: Int![\s\S]*transferLostQty: Int!/);
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
  assert.match(service, /type: "TRANSFER_LOST"/);
  assert.match(service, /มีส่วนต่าง ต้องเลือกสาเหตุและกรอกหมายเหตุ/);
  assert.match(page, /รับสภาพดี/);
  assert.match(page, /เสียหาย\/กักกัน/);
  assert.match(page, /หมายเหตุส่วนต่าง/);
});

test("product inventory separates transfer losses from company-held stock", async () => {
  const [migration, service, schema, page] = await Promise.all([
    read("db/migrations/9.36__bms_stock_transfer_loss_visibility.sql"),
    read("apps/web/lib/bms/products.ts"),
    read("apps/web/graphql/typeDefs.ts"),
    read("apps/web/app/(admin)/admin/products/page.tsx"),
  ]);
  assert.match(migration, /TRANSFER_LOST/);
  assert.match(service, /transfer_lost_qty/);
  assert.match(schema, /transferLostQty: Int!/);
  assert.match(page, /totalOnHand \+ totalQuarantine \+ totalInTransit/);
  assert.match(page, /stat_transfer_lost/);
  assert.match(page, /col_transfer_lost/);
});

test("orders expose and filter by sale branch without borrowing product permissions", async () => {
  const [resolver, schema, page] = await Promise.all([
    read("apps/web/graphql/bmsOrders.ts"),
    read("apps/web/graphql/typeDefs.ts"),
    read("apps/web/app/(admin)/admin/orders/page.tsx"),
  ]);
  assert.match(schema, /bmsOrders\([^)]*locationId: ID/);
  assert.match(schema, /bmsOrderLocations: \[BmsLocation!\]!/);
  assert.match(schema, /bmsCreateOrder\([^)]*locationId: ID/);
  assert.match(schema, /type BmsOrder[\s\S]*locationId: ID[\s\S]*locationName: String[\s\S]*branchCode: String[\s\S]*posDeviceName: String/);
  assert.match(resolver, /listLocationsForUser\(tenantId, userId\)/);
  assert.match(resolver, /resolveWritableLocationId/);
  assert.match(resolver, /LEFT JOIN bms_locations loc/);
  assert.match(resolver, /LEFT JOIN bms_pos_devices pd/);
  assert.match(resolver, /\(\$6::uuid IS NULL OR o\.location_id = \$6\)/);
  assert.match(resolver, /bms_user_allowed_locations/);
  assert.match(resolver, /assertOrderBranchAccess/);
  assert.match(resolver, /locationId,/);
  assert.match(page, /bmsOrderLocations \{ id name branchCode active \}/);
  assert.match(page, /branch_filter_placeholder/);
  assert.match(page, /sale_branch/);
});

test("coupon branch scope is stored, visible, and enforced at POS/order settlement", async () => {
  const [migration, service, orders, posPreview, couponsResolver, schema, page] = await Promise.all([
    read("db/migrations/9.37__bms_branch_visibility_and_policy_scope.sql"),
    read("apps/web/lib/bms/coupons.ts"),
    read("apps/web/lib/bms/orders.ts"),
    read("apps/web/app/api/pos/member/preview/route.ts"),
    read("apps/web/graphql/bmsCoupons.ts"),
    read("apps/web/graphql/typeDefs.ts"),
    read("apps/web/app/(admin)/admin/coupons/page.tsx"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_coupon_locations/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(service, /locationIds: string\[\]/);
  assert.match(service, /location_ids/);
  assert.match(service, /couponAllowsLocation/);
  assert.match(service, /replaceCouponLocationsInTx/);
  assert.match(orders, /applyCouponInTx\(client, tenantId, input\.couponCode, customerId, total, locationId\)/);
  assert.match(posPreview, /previewCouponForCustomer\(device\.tenantId, couponCode, customerId, subtotal, device\.locationId\)/);
  assert.match(couponsResolver, /bmsCouponLocations/);
  assert.match(couponsResolver, /listLocationsForUser\(getTenantId\(ctx\), String\(auth\.author_id \|\| ""\)\)/);
  assert.match(couponsResolver, /ผู้ใช้ที่ถูกจำกัดสาขาต้องเลือกสาขาของคูปองอย่างน้อย 1 สาขา/);
  assert.match(couponsResolver, /ไม่มีสิทธิ์ตั้งคูปองให้สาขานี้/);
  assert.match(schema, /BmsCoupon[\s\S]*locationIds: \[ID!\]!/);
  assert.match(schema, /input BmsCouponInput[\s\S]*locationIds: \[ID!\]/);
  assert.match(page, /bmsCouponLocations \{ id name branchCode active \}/);
  assert.match(page, /form_branch_scope/);
  assert.match(page, /branchScopeLabel/);
});

test("branch access policy has an explicit tenant-scoped foundation", async () => {
  const migration = await read("db/migrations/9.37__bms_branch_visibility_and_policy_scope.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_user_allowed_locations/);
  assert.match(migration, /tenant_id\s+UUID NOT NULL REFERENCES bms_tenants\(id\)/);
  assert.match(migration, /user_id\s+UUID NOT NULL REFERENCES users\(id\)/);
  assert.match(migration, /location_id\s+UUID NOT NULL/);
  assert.match(migration, /bms_user_allowed_locations_tenant_isolation/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_user_allowed_locations TO bms_app/);
  const locations = await read("apps/web/lib/bms/locations.ts");
  assert.match(locations, /userHasLocationScope/);
  assert.match(locations, /listLocationsForUser/);
  assert.match(locations, /userCanAccessLocation/);
});

test("POS member enrollment stores server-derived branch attribution and exposes it in Customers", async () => {
  const [migration, route, service, resolver, schema, page] = await Promise.all([
    read("db/migrations/9.38__bms_member_enrollment_attribution.sql"),
    read("apps/web/app/api/pos/member/route.ts"),
    read("apps/web/lib/bms/membership.ts"),
    read("apps/web/graphql/bmsCustomers.ts"),
    read("apps/web/graphql/typeDefs.ts"),
    read("apps/web/app/(admin)/admin/customers/page.tsx"),
  ]);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS enrollment_channel TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS enrolled_location_id UUID/);
  assert.match(migration, /bms_customers_enrolled_location_fk/);
  assert.match(migration, /bms_customers_pos_enrollment_origin_check/);
  assert.match(route, /getOpenPosShift\(device\.tenantId, device\.id\)/);
  assert.match(route, /enrollmentChannel: "POS"/);
  assert.match(route, /enrolledLocationId: device\.locationId/);
  assert.match(route, /enrolledPosDeviceId: device\.id/);
  assert.match(service, /ข้อมูลสาขา เครื่อง หรือกะที่รับสมัครไม่ตรงกัน/);
  assert.match(service, /enrollment_channel = \$5/);
  assert.match(resolver, /bmsCustomerLocations/);
  assert.match(schema, /bmsCustomers\([^)]*enrolledLocationId: ID/);
  assert.match(schema, /type BmsMember[\s\S]*enrollmentChannel: String[\s\S]*enrolledLocationName: String/);
  assert.match(page, /filter_enrollment_branch/);
  assert.match(page, /enrolledLocationName/);
  assert.match(page, /enrollment_branch_unknown/);
});
