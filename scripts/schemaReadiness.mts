// =============================================================
// ลิสต์ "สิ่งที่โค้ดชุดนี้ต้องมีในฐาน" — แหล่งความจริงชุดเดียว
// -------------------------------------------------------------
// ใช้โดยสองทาง: `scripts/check-schema-readiness.mts` (ต่อฐานแล้วตอบทันที) และไฟล์
// `db/checks/schema-readiness.sql` ที่ generate จากที่นี่สำหรับเซิร์ฟเวอร์ที่ **ไม่มี Node**
// (เจอจริง 2026-09-05: production ตอบว่า `npx: command not found`)
//
// ห้ามแก้ .sql ด้วยมือ — `scripts/schema-readiness-contract.test.mts` เทียบไฟล์กับตัวเรนเดอร์
// ทุกครั้งที่รัน gate ถ้าไม่ตรงจะแดง
// =============================================================

export type Need =
  | { kind: "table"; name: string }
  | { kind: "column"; table: string; name: string };

export type Migration = {
  file: string;
  /** พังยังไงถ้าไฟล์นี้ยังไม่ได้รัน — เขียนเป็นอาการที่คนหน้าร้านเจอ ไม่ใช่ชื่อ error */
  impact: string;
  needs: Need[];
};

// ครอบเฉพาะไฟล์ที่ "โค้ดปัจจุบันอ้างถึงแบบไม่มีเงื่อนไข" — ของเก่ากว่านี้ถ้าขาด ระบบจะพัง
// ตั้งแต่หน้าแรกจนเห็นเองอยู่แล้ว
export const MIGRATIONS: Migration[] = [
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

/** เรนเดอร์ตัวตรวจเป็น SQL ล้วน — ไม่ต่อฐาน ไม่ต้องมี env */
export function renderReadinessSql(): string {
  const lit = (value: string | null) => (value == null ? "NULL" : `'${value.replace(/'/g, "''")}'`);
  const rows: string[] = [];
  for (const migration of MIGRATIONS) {
    for (const need of migration.needs) {
      rows.push(`    (${lit(migration.file)}, ${lit(need.kind)}, `
        + `${lit(need.kind === "table" ? need.name : need.table)}, `
        + `${lit(need.kind === "column" ? need.name : null)}, ${lit(migration.impact)})`);
    }
  }
  return `-- สร้างจาก scripts/check-schema-readiness.mts --sql — อย่าแก้ไฟล์นี้ด้วยมือ
-- บนเซิร์ฟเวอร์:  docker compose ... exec -T postgres psql -U <user> -d <db> < readiness.sql
CREATE TEMP TABLE bms_schema_readiness AS
WITH required(migration, kind, tbl, col, impact) AS (VALUES
${rows.join(",\n")}
)
SELECT r.*,
       CASE WHEN r.kind = 'table' THEN to_regclass('public.' || r.tbl) IS NOT NULL
            -- คอลัมน์ของตารางที่ยังไม่มี ไม่ต้องรายงานซ้ำ — แถวของตารางรายงานไปแล้ว
            ELSE to_regclass('public.' || r.tbl) IS NULL
                 OR EXISTS (SELECT 1 FROM information_schema.columns c
                             WHERE c.table_schema = 'public' AND c.table_name = r.tbl
                               AND c.column_name = r.col)
       END AS ok
  FROM required r;

SELECT migration AS "ไฟล์ที่ยังไม่ได้รัน",
       CASE WHEN kind = 'table' THEN 'ไม่มีตาราง ' || tbl
            ELSE 'ไม่มีคอลัมน์ ' || tbl || '.' || col END AS "ของที่ขาด",
       impact AS "ผลถ้าไม่รัน"
  FROM bms_schema_readiness WHERE NOT ok ORDER BY migration, tbl, col;

SELECT CASE WHEN count(*) = 0
            THEN 'ครบ — อาการ 500 ที่เจอไม่ได้มาจาก migration ที่ขาด ให้ไปดูสาเหตุอื่น'
            ELSE 'ขาด ' || count(DISTINCT migration) || ' ไฟล์ — รันตามลำดับเลข: '
                 || string_agg(DISTINCT 'db/migrations/' || migration, ', ')
       END AS "สรุป"
  FROM bms_schema_readiness WHERE NOT ok;`;
}
