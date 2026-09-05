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
//   npx tsx scripts/check-schema-readiness.mts
//
// ไม่ต้องส่ง env เองถ้ามี `.env` (หรือ `.env.prod`/`.env.dev`) อยู่ที่รากโปรเจกต์ — สคริปต์
// อ่านให้ และ **พิมพ์เสมอว่ากำลังตรวจฐานไหน** เพราะการตรวจผิดฐานแล้วรายงานว่า "ครบ"
// อันตรายกว่าไม่ตรวจเลย · ส่ง env เองก็ได้ ค่าที่ส่งมาชนะไฟล์เสมอ:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//     npx tsx scripts/check-schema-readiness.mts
//
// exit 1 = ยังมีของขาด หรือต่อฐานไม่ได้ (ใช้ใน CI/ก่อน deploy ได้)
// =============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_VARS = ["POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"] as const;

// อ่าน .env เฉพาะคีย์ที่ยังไม่ได้ตั้ง — ค่าที่คนส่งมาทางบรรทัดคำสั่งต้องชนะไฟล์เสมอ
let envFileUsed: string | null = null;
if (!DB_VARS.some((name) => process.env[name])) {
  for (const candidate of [".env", ".env.prod", ".env.dev"]) {
    const file = path.join(ROOT, candidate);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, key, raw] = match;
      if ((DB_VARS as readonly string[]).includes(key) && !process.env[key]) {
        process.env[key] = raw.replace(/^["']|["']$/g, "");
      }
    }
    envFileUsed = candidate;
    break;
  }
}

const target = {
  host: process.env.POSTGRES_HOST || "localhost",
  port: process.env.POSTGRES_PORT || "5432",
  db: process.env.POSTGRES_DB || "appdb",
  user: process.env.POSTGRES_USER || "app",
};
console.log(`ฐานที่กำลังตรวจ: ${target.user}@${target.host}:${target.port}/${target.db}`
  + (envFileUsed ? ` (อ่านค่าจาก ${envFileUsed})` : " (จาก env ที่ส่งมา)"));
console.log("");

// import หลังตั้ง env — pool ของ lib/db.ts ถูกสร้างตอน import ค่าที่ตั้งทีหลังจะไม่มีผล
const { query } = await import("../apps/web/lib/db.ts");

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

/** ต่อฐานไม่ได้ ≠ ฐานไม่ครบ — ต้องบอกว่าติดตรงไหนและตั้งอะไร ไม่ใช่โยน stack ของ pg ใส่หน้า */
function explainConnectionFailure(error: any): string[] {
  const code = String(error?.code ?? "");
  if (code === "3D000") return [
    `ไม่มีฐานชื่อ "${target.db}" บนเซิร์ฟเวอร์นี้`,
    `  ถ้ายังไม่ได้ตั้ง env เลย ค่าปริยายของแอปคือ "appdb" ซึ่งมักไม่ใช่ชื่อจริง — ฐานของ dev ชื่อ bms`,
  ];
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return [
    `หา host "${target.host}" ไม่เจอ`,
    `  ถ้าค่านี้มาจาก .env มันคือชื่อ service ใน docker network — รันนอก container ต้องใช้ POSTGRES_HOST=localhost`,
  ];
  if (code === "ECONNREFUSED") return [`ต่อ ${target.host}:${target.port} ไม่ได้ (Postgres ไม่ได้รันอยู่ หรือพอร์ตไม่ตรง)`];
  if (code === "28P01" || code === "28000") return [`รหัสผ่านหรือผู้ใช้ "${target.user}" ไม่ถูกต้อง`];
  return [String(error?.message ?? error)];
}

let tables: Set<string>;
let columns: Set<string>;
try {
  tables = new Set(
    (await query<{ tablename: string }>(
      `SELECT c.relname AS tablename
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')`
    )).rows.map((row) => row.tablename)
  );
  columns = new Set(
    (await query<{ key: string }>(
      `SELECT table_name || '.' || column_name AS key
         FROM information_schema.columns WHERE table_schema = 'public'`
    )).rows.map((row) => row.key)
  );
} catch (error: any) {
  console.log("❌ ต่อฐานข้อมูลไม่ได้ — ยังไม่ได้ตรวจอะไรเลย");
  for (const line of explainConnectionFailure(error)) console.log(`   ${line}`);
  console.log("");
  console.log("   ฐาน dev ในเครื่องนี้ (Postgres อยู่ใน docker แต่ map พอร์ตออกมาแล้ว):");
  console.log("   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app \\");
  console.log("     POSTGRES_PASSWORD=\"$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)\" \\");
  console.log("     npx tsx scripts/check-schema-readiness.mts");
  console.log("");
  console.log("   บนเซิร์ฟเวอร์จริง: รันด้วย env ชุดเดียวกับที่แอปใช้ (ค่าจาก .env ของเครื่องนั้น)");
  process.exit(1);
}

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
