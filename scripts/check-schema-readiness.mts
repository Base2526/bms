// =============================================================
// ตรวจว่าฐานข้อมูลนี้ apply migration ครบพอที่โค้ดชุดปัจจุบันจะทำงานไหม (read-only)
// -------------------------------------------------------------
// ไม่เขียนอะไรลงฐานเลย · รันกับ production ได้
//
// ทำไมต้องมี: repo นี้ apply migration ด้วยมือตามเลข และ **ไม่มี schema probe ที่ไหน**
// เส้นทางร้อน (สร้างบิล/ขาย/ส่งครัว) อ้างคอลัมน์ใหม่แบบไม่มีเงื่อนไข ฐานที่ตกไปหนึ่งไฟล์
// จึงล้มด้วย 42703/42P01 แล้วโผล่หน้าจอเป็น "เซิร์ฟเวอร์ผิดพลาด" เฉย ๆ (routeError.ts
// redact ข้อความจริงทิ้งบน production) — ตัวนี้แปลอาการนั้นกลับเป็นชื่อไฟล์ที่ต้องรัน
//
// ---- วิธีใช้ ----
// ในคอนเทนเนอร์ (ตรวจฐานที่แอปต่ออยู่จริง ไม่ต้องส่ง env เอง):
//   docker compose ... exec web npx tsx scripts/check-schema-readiness.mts
// local:
//   cd apps/web && POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app \
//     POSTGRES_PASSWORD=... npx tsx ../../scripts/check-schema-readiness.mts
//
// exit 1 = ยังมีของขาด (ใช้ใน CI/ก่อน deploy ได้)
// =============================================================

import { query } from "../apps/web/lib/db.ts";

type Need =
  | { kind: "table"; name: string }
  | { kind: "column"; table: string; name: string };

type Migration = {
  file: string;
  /** พังยังไงถ้าไฟล์นี้ยังไม่ได้รัน — เขียนเป็นอาการที่คนหน้าร้านเจอ ไม่ใช่ชื่อ error */
  impact: string;
  needs: Need[];
};

// ครอบเฉพาะไฟล์ที่ "โค้ดปัจจุบันอ้างถึงแบบไม่มีเงื่อนไข" — ของเก่ากว่านี้ถ้าขาด ระบบจะพัง
// ตั้งแต่หน้าแรกจนเห็นเองอยู่แล้ว
const MIGRATIONS: Migration[] = [
  {
    file: "9.40__bms_multi_store_stock_capabilities.sql",
    impact: "ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder/POS อ่านรูปแบบสต็อกทุกบิล",
    needs: [
      { kind: "table", name: "bms_store_capabilities" },
      { kind: "table", name: "bms_product_stock_policies" },
      { kind: "table", name: "bms_product_recipes" },
      { kind: "table", name: "bms_product_recipe_items" },
      { kind: "table", name: "bms_product_modifiers" },
      { kind: "table", name: "bms_order_item_stock_consumption" },
      { kind: "column", table: "bms_order_items", name: "stock_modifier_codes" },
    ],
  },
  {
    file: "9.41__bms_weighted_product_scale_mapping.sql",
    impact: "สแกนบาร์โค้ดเครื่องชั่งไม่ได้",
    needs: [{ kind: "column", table: "bms_product_stock_policies", name: "scale_item_code" }],
  },
  {
    file: "9.44__bms_restaurant_pos.sql",
    impact: "POS ร้านอาหารใช้ไม่ได้ทั้งหน้า (ผังโต๊ะ/บิลโต๊ะ/จอครัว)",
    needs: [
      { kind: "table", name: "bms_restaurant_areas" },
      { kind: "table", name: "bms_restaurant_tables" },
      { kind: "table", name: "bms_restaurant_checks" },
      { kind: "table", name: "bms_restaurant_check_items" },
      { kind: "table", name: "bms_restaurant_kitchen_tickets" },
      { kind: "column", table: "bms_orders", name: "restaurant_check_id" },
    ],
  },
  {
    file: "9.45__bms_restaurant_modifier_pricing_rbac.sql",
    impact: "เพิ่มเมนูที่มีตัวเลือกลงบิลโต๊ะไม่ได้ (ราคาส่วนต่างของตัวเลือก)",
    needs: [{ kind: "column", table: "bms_product_modifiers", name: "price_delta" }],
  },
  {
    file: "9.46__bms_support_diagnostics.sql",
    impact: "จอ POS ส่ง diagnostics ไม่ได้ (ไม่บล็อกการขาย แต่ไล่ปัญหาไม่มีข้อมูล)",
    needs: [
      { kind: "table", name: "bms_support_events" },
      { kind: "table", name: "bms_support_bundles" },
    ],
  },
  {
    file: "9.48__bms_restaurant_pos_settlement_claim.sql",
    impact: "คิดเงินบิลโต๊ะไม่ได้ (จองสิทธิ์การรับชำระ)",
    needs: [{ kind: "column", table: "bms_restaurant_checks", name: "settlement_attempt_id" }],
  },
  {
    file: "9.51__bms_product_catalog_foundation.sql",
    impact: "ขายไม่ได้ทั้งระบบ (ทุกร้าน) — ทุกบิลอ่านช่องทางขายของสินค้า",
    needs: [
      { kind: "table", name: "bms_product_variants" },
      { kind: "table", name: "bms_product_sales_surfaces" },
      { kind: "table", name: "bms_product_modifier_groups" },
      { kind: "column", table: "bms_product_modifiers", name: "group_id" },
    ],
  },
  {
    file: "9.53__bms_kitchen_station_sla.sql",
    impact: "ตั้งเกณฑ์เวลาจอครัวไม่ได้",
    needs: [{ kind: "table", name: "bms_kitchen_station_slas" }],
  },
  {
    file: "9.54__bms_kitchen_station_master.sql",
    impact: "บันทึกสินค้าไม่ได้ทั้งระบบ (readiness join ทะเบียนสถานี) + ส่งครัวไม่ได้",
    needs: [
      { kind: "table", name: "bms_kitchen_stations" },
      { kind: "column", table: "bms_product_stock_policies", name: "kitchen_station_id" },
      { kind: "column", table: "bms_kitchen_tickets", name: "station_id" },
      { kind: "column", table: "bms_restaurant_kitchen_tickets", name: "station_id" },
    ],
  },
  {
    file: "9.55__bms_menu_temporary_unavailability.sql",
    impact: "ค้นสินค้า/เช็คสต็อกล้มทั้งระบบ (ทุกร้าน) — เมนูร้านอาหารว่างเปล่า",
    needs: [
      { kind: "table", name: "bms_product_menu_unavailability" },
      { kind: "column", table: "bms_store_profile", name: "menu_availability_reset_time" },
    ],
  },
  {
    file: "9.56__bms_restaurant_online_order_acceptance.sql",
    impact: "สร้างบิลไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — INSERT bms_orders อ้างคอลัมน์นี้ทุกครั้ง",
    needs: [
      { kind: "column", table: "bms_orders", name: "fulfillment_type" },
      { kind: "column", table: "bms_orders", name: "promised_at" },
      { kind: "column", table: "bms_store_profile", name: "restaurant_order_hours" },
      { kind: "column", table: "bms_store_profile", name: "restaurant_orders_paused" },
    ],
  },
  {
    file: "9.57__bms_restaurant_order_line_cancellation.sql",
    impact: "ตัดรายการออกจากออร์เดอร์ออนไลน์ไม่ได้",
    needs: [
      { kind: "column", table: "bms_pos_returns", name: "merchant_absorbed_amount" },
      { kind: "column", table: "bms_pos_return_items", name: "cancellation_cause" },
      { kind: "column", table: "bms_store_profile", name: "restaurant_merchant_absorb_limit" },
    ],
  },
];

const tables = new Set(
  (await query<{ tablename: string }>(
    `SELECT c.relname AS tablename
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')`
  )).rows.map((row) => row.tablename)
);

const columns = new Set(
  (await query<{ key: string }>(
    `SELECT table_name || '.' || column_name AS key
       FROM information_schema.columns WHERE table_schema = 'public'`
  )).rows.map((row) => row.key)
);

const missingFiles: Migration[] = [];
console.log("ตรวจ schema เทียบกับสิ่งที่โค้ดชุดนี้ต้องใช้\n");

for (const migration of MIGRATIONS) {
  const missing = migration.needs.filter((need) =>
    need.kind === "table"
      ? !tables.has(need.name)
      // คอลัมน์ของตารางที่ยังไม่มี ไม่ต้องรายงานซ้ำ — ไฟล์ที่สร้างตารางนั้นจะถูกรายงานเอง
      : tables.has(need.table) && !columns.has(`${need.table}.${need.name}`)
  );
  if (!missing.length) {
    console.log(`✅ ${migration.file}`);
    continue;
  }
  missingFiles.push(migration);
  console.log(`❌ ${migration.file}`);
  console.log(`   ผลถ้าไม่รัน: ${migration.impact}`);
  for (const need of missing) {
    console.log(need.kind === "table" ? `   - ไม่มีตาราง ${need.name}` : `   - ไม่มีคอลัมน์ ${need.table}.${need.name}`);
  }
}

console.log("");
if (!missingFiles.length) {
  console.log("สรุป: ครบ — อาการ 500 ที่เจอไม่ได้มาจาก migration ที่ขาด ให้ไปดูสาเหตุอื่น");
  process.exit(0);
}
console.log(`สรุป: ขาด ${missingFiles.length} ไฟล์ — รันตามลำดับเลขนี้ (psql -1 ทีละไฟล์):`);
for (const migration of missingFiles) console.log(`   psql -1 -f db/migrations/${migration.file}`);
process.exit(1);
