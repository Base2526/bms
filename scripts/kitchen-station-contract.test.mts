// Kitchen station master (9.54) — database-free regression contract.
// Run from apps/web: npx tsx --test ../../scripts/kitchen-station-contract.test.mts
//
// สถานีครัวเคยเป็น "ข้อความอิสระ" บน bms_product_stock_policies.kitchen_station ทุกอย่างที่
// อ้างถึงสถานีจึงอ้างด้วยชื่อที่พิมพ์ตรงกันเป๊ะ · เทสชุดนี้กันไม่ให้ระบบไถลกลับไปที่นั่น

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  KITCHEN_STATION_CODE_MAX,
  KITCHEN_STATION_FALLBACK_CODE,
  isValidKitchenStationCode,
  normalizeKitchenStationCode,
  normalizeKitchenStationName,
} from "../apps/web/lib/bms/kitchenStationCode.ts";
import { kitchenStationColumnsSql } from "../apps/web/lib/bms/kitchenStations.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
// คอมเมนต์ที่อธิบายกฎเก่าต้องไม่ถูกนับเป็นโค้ดจริง (กับดักเดิมของเทสแบบสแกนซอร์สในรีโปนี้ —
// เคยเขียวเพราะคอมเมนต์ที่ตัวเองเขียนอธิบายรูปแบบเก่ามาแล้ว)
const withoutComments = (text: string) => text
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--.*$/gm, "");

const MIGRATION = "db/migrations/9.54__bms_kitchen_station_master.sql";

test("รหัสสถานีเก็บอักษรไทยไว้ ไม่บดทุกชื่อให้เหลือ STATION", () => {
  // ร้านไทยตั้งชื่อครัวเป็นภาษาไทย ถ้าบังคับ A-Z รหัสของทุกสถานีจะกลายเป็น STATION,
  // STATION_2, STATION_3 ซึ่งอ่านไม่ออกและเรียงไม่ได้
  assert.equal(normalizeKitchenStationCode("ครัวร้อน"), "ครัวร้อน");
  assert.equal(normalizeKitchenStationCode("บาร์ เครื่องดื่ม"), "บาร์_เครื่องดื่ม");
  assert.equal(normalizeKitchenStationCode("hot line"), "HOT_LINE");
  assert.equal(normalizeKitchenStationCode("  Cold/Line  "), "COLD_LINE");
  assert.equal(normalizeKitchenStationCode("---"), KITCHEN_STATION_FALLBACK_CODE);
  assert.equal(normalizeKitchenStationCode(""), KITCHEN_STATION_FALLBACK_CODE);
  assert.equal(normalizeKitchenStationCode(null), KITCHEN_STATION_FALLBACK_CODE);
});

test("รหัสถูกตัดที่ 32 แล้วค่อยตัด _ ท้าย ไม่ใช่กลับกัน", () => {
  // กลับลำดับแล้วชื่อยาว ๆ ได้รหัสลงท้ายด้วย `_` ซึ่งผ่าน CHECK แต่คนอ่านว่าพิมพ์ตกหล่น
  // · `9.54` ทำลำดับเดียวกัน (มีเทสคุมนิพจน์นั้นด้านล่าง)
  const code = normalizeKitchenStationCode("A".repeat(31) + " tail");
  assert.equal(code.length <= KITCHEN_STATION_CODE_MAX, true);
  assert.equal(code.endsWith("_"), false);
  assert.equal(code, "A".repeat(31));
});

test("isValidKitchenStationCode ปฏิเสธรูปที่ฐานข้อมูลจะปฏิเสธเช่นกัน", () => {
  assert.equal(isValidKitchenStationCode("HOT"), true);
  assert.equal(isValidKitchenStationCode("ครัวร้อน"), true);
  assert.equal(isValidKitchenStationCode("HOT-1"), true);
  assert.equal(isValidKitchenStationCode("hot"), false, "ต้องเป็นตัวพิมพ์ใหญ่หลัง normalize");
  assert.equal(isValidKitchenStationCode("HOT LINE"), false, "ห้ามมีช่องว่าง");
  assert.equal(isValidKitchenStationCode("_HOT"), false, "ห้ามขึ้นต้นด้วย _");
  assert.equal(isValidKitchenStationCode(""), false);
  assert.equal(isValidKitchenStationCode("A".repeat(33)), false);
});

test("ชื่อสถานียุบช่องว่างซ้อน — สองชื่อที่คนอ่านว่าเหมือนกันต้องเป็นสถานีเดียว", () => {
  // ดัชนี unique ของชื่อคือสิ่งที่ทำให้ "ชื่อ → เกณฑ์เวลา" มีคำตอบเดียว ถ้าปล่อยให้
  // "บาร์  เครื่องดื่ม" กับ "บาร์ เครื่องดื่ม" อยู่ร่วมกันได้ คำตอบนั้นจะมีสองคำตอบ
  assert.equal(normalizeKitchenStationName("  บาร์   เครื่องดื่ม "), "บาร์ เครื่องดื่ม");
  assert.equal(normalizeKitchenStationName("Hot\tLine"), "Hot Line");
  assert.equal(normalizeKitchenStationName(""), "");
  assert.equal(normalizeKitchenStationName("ก".repeat(80)).length, 64);
});

test("นิพจน์เลือกสถานีเป็นชุดเดียว: กรองสาขา + ตกกลับชื่อเดิมเฉพาะตอนไม่มีแถวหลัก", () => {
  const columns = kitchenStationColumnsSql({ orderLocation: "o.location_id" });
  // สถานีเฉพาะสาขาใช้ได้เฉพาะบิลของสาขานั้น — ขาดเงื่อนไขนี้แปลว่าตั๋วถูกส่งไปครัวที่สาขานั้น
  // ไม่มีอยู่จริง แล้วอาหารจานนั้นไม่มีใครทำโดยไม่มีใครรู้
  for (const sql of [columns.id, columns.name]) {
    assert.match(sql, /st\.location_id IS NULL OR st\.location_id = o\.location_id/);
  }
  // ชื่อเดิมบน stock policy เป็น fallback **เฉพาะตอนไม่มีแถวหลัก** ไม่ใช่ค่าที่ชนะ id
  assert.match(columns.name, /WHEN st\.id IS NULL THEN NULLIF\(btrim\(COALESCE\(sp\.kitchen_station/);
  // id ต้องไม่มีทาง fallback ไปหาชื่อ — id ที่เดามาจากสตริงคือ id ที่ชี้ไปแถวที่ไม่มีอยู่
  assert.doesNotMatch(columns.id, /kitchen_station\b(?!_id)/);
  const scoped = kitchenStationColumnsSql({ policy: "policy", station: "kst", orderLocation: "c.location_id" });
  assert.match(scoped.name, /kst\.id IS NULL THEN NULLIF\(btrim\(COALESCE\(policy\.kitchen_station/);
});

test("ทั้งสองเส้นทางที่ออกตั๋วครัวเขียน station_id และใช้นิพจน์ชุดเดียวกัน", () => {
  // สองสูตรที่ตัดสินเรื่องเดียวกันจะ drift แล้ววันหนึ่งเส้นทางหนึ่งยอมส่งตั๋วข้ามสาขา
  for (const file of ["apps/web/lib/bms/kitchen.ts", "apps/web/lib/bms/restaurantPos.ts"]) {
    const code = withoutComments(source(file));
    assert.match(code, /kitchenStationColumnsSql\(/, `${file} ต้องใช้ตัวตัดสินชุดกลาง`);
  }
  const kitchen = withoutComments(source("apps/web/lib/bms/kitchen.ts"));
  assert.match(kitchen, /INSERT INTO bms_kitchen_tickets[\s\S]{0,200}station, station_id/);
  const restaurant = withoutComments(source("apps/web/lib/bms/restaurantPos.ts"));
  assert.match(restaurant, /INSERT INTO bms_restaurant_kitchen_tickets[\s\S]{0,200}station, station_id/);
});

test("ปิดสถานีคือ active = FALSE — ห้ามมีทางลบถาวรในโค้ด", () => {
  // ตั๋วเก่า ประวัติ และเกณฑ์เวลาอ้างถึงสถานีอยู่ · ลบถาวรแปลว่าใบเสร็จของเมื่อวานตอบไม่ได้
  // ว่าอาหารออกจากครัวไหน
  const service = withoutComments(source("apps/web/lib/bms/kitchenStations.ts"));
  assert.doesNotMatch(service, /DELETE\s+FROM\s+bms_kitchen_stations/i);
  assert.match(service, /UPDATE bms_kitchen_stations SET active = FALSE/);
  // ปิดทั้งที่ยังมีเมนูเปิดขายผูกอยู่ต้องถูกปฏิเสธก่อน แล้วให้คนยืนยันด้วย force
  assert.match(service, /activeProducts > 0 && options\?\.force !== true/);
});

test("เปลี่ยนชื่อสถานีต้องพาเกณฑ์เวลาและสตริง fallback ไปด้วย", () => {
  // เกณฑ์เวลา (9.53) คีย์ด้วยชื่อ · เปลี่ยนชื่อแล้วไม่ย้ายคีย์ = สถานีเงียบ ๆ กลับไปใช้
  // ค่าปริยาย 5/10 กลางกะโดยไม่มีใครสั่ง
  const service = withoutComments(source("apps/web/lib/bms/kitchenStations.ts"));
  assert.match(service, /UPDATE bms_kitchen_station_slas SET station = \$3/);
  assert.match(service, /UPDATE bms_product_stock_policies SET kitchen_station = \$3/);
  // ตั๋วที่ออกไปแล้วห้ามถูกแก้ — ชื่อบนตั๋วคือ snapshot ของสิ่งที่ครัวเห็นจริง
  assert.doesNotMatch(service, /UPDATE bms_kitchen_tickets/);
  assert.doesNotMatch(service, /UPDATE bms_restaurant_kitchen_tickets/);
});

test("ชื่อสถานีที่มาทางเส้นทางเก่าถูกยกขึ้นเป็นแถวหลัก ไม่ปล่อยเป็นสตริงกำพร้า", () => {
  // ฟอร์มสินค้า/ไฟล์นำเข้า/ตัวสร้างข้อมูลตัวอย่าง เขียนชื่อสถานีได้โดยตรง · ถ้าไม่ยกขึ้นเป็น
  // แถวหลัก สถานีเหล่านั้นจะไม่โผล่ในดรอปดาวน์ เปิด/ปิดไม่ได้ และเรียงลำดับไม่ได้
  for (const file of [
    "apps/web/lib/bms/products.ts",
    "apps/web/lib/bms/productStockPolicies.ts",
    "apps/web/lib/bms/devSeed.ts",
  ]) {
    assert.match(
      withoutComments(source(file)),
      /ensureKitchenStationByNameInTx\(/,
      `${file} ต้องยกชื่อสถานีขึ้นเป็นแถวหลัก`
    );
  }
});

test("อ่านสถานีใช้ product.view · จัดการสถานีใช้ product.edit", () => {
  // การซ่อนปุ่มฝั่ง client ไม่ใช่ด่าน — สถานีเปลี่ยนว่าอาหารทั้งร้านไปโผล่ที่ครัวไหน
  const resolvers = withoutComments(source("apps/web/graphql/bmsStockCapabilities.ts"));
  const guardBefore = (resolverName: string, permission: string) => {
    const at = resolvers.indexOf(`async ${resolverName}(`);
    assert.notEqual(at, -1, `ไม่พบ resolver ${resolverName}`);
    const body = resolvers.slice(at, at + 400);
    assert.match(body, new RegExp(`requirePermission\\(ctx, "${permission}"\\)`),
      `${resolverName} ต้อง gate ด้วย ${permission}`);
  };
  guardBefore("bmsKitchenStations", "product.view");
  guardBefore("bmsUnmappedKitchenStationNames", "product.view");
  guardBefore("bmsCreateKitchenStation", "product.edit");
  guardBefore("bmsUpdateKitchenStation", "product.edit");
  guardBefore("bmsArchiveKitchenStation", "product.edit");
});

test("readiness ยังเตือนเมื่อไม่มีสถานี และคำเตือนใหม่ไม่กลายเป็นตัวบล็อก", () => {
  // ปิดการขายเมนูเพราะครัวถูกปิดหรือผูกผิดสาขา = ร้านขายของไม่ได้เพราะการตั้งค่าที่แก้ทีหลังได้
  const config = withoutComments(source("apps/web/lib/bms/productConfiguration.ts"));
  for (const code of ["KITCHEN_STATION_MISSING", "KITCHEN_STATION_INACTIVE", "KITCHEN_STATION_BRANCH_SCOPED"]) {
    const at = config.indexOf(`code: "${code}"`);
    assert.notEqual(at, -1, `ไม่พบ readiness ${code}`);
    const before = config.slice(Math.max(0, at - 200), at);
    assert.match(before, /warnings\.push\(\{\s*$|warnings\.push\(\{[\s\S]*$/,
      `${code} ต้องเป็น warning ไม่ใช่ blocker`);
  }
  assert.doesNotMatch(config, /blockers\.push\(\{[^}]*KITCHEN_STATION/);
});

test("ไมเกรชัน 9.54: RLS, GRANT, revision trigger และดัชนี unique ที่ครอบ NULL ได้จริง", () => {
  const sql = source(MIGRATION);
  assert.match(sql, /ALTER TABLE bms_kitchen_stations ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE bms_kitchen_stations FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_kitchen_stations TO bms_app/);
  assert.match(sql, /create_revision_trigger\('bms_kitchen_stations'\)/);
  // UNIQUE ธรรมดาไม่คุม location_id NULL (NULL ไม่ชนกับ NULL) → ต้องมีดัชนีบางส่วนสองตัว
  // ไม่งั้นสถานีระดับร้านชื่อ/รหัสซ้ำกันได้ไม่จำกัดจำนวน
  assert.match(sql, /uq_bms_kitchen_stations_code_global[\s\S]{0,120}WHERE location_id IS NULL/);
  assert.match(sql, /uq_bms_kitchen_stations_code_branch[\s\S]{0,140}WHERE location_id IS NOT NULL/);
  assert.match(sql, /uq_bms_kitchen_stations_name\b[\s\S]{0,80}\(tenant_id, name\)/);
});

test("ไมเกรชัน 9.54: derive รหัสด้วยลำดับเดียวกับชั้นแอป และไม่ลบสตริงเดิมทิ้ง", () => {
  const sql = source(MIGRATION);
  // ตัดที่ 32 ก่อน แล้วค่อยตัด `_` ท้าย — ลำดับเดียวกับ normalizeKitchenStationCode()
  assert.match(sql, /btrim\(LEFT\(btrim\(regexp_replace\(upper\(name\)[\s\S]{0,80}, '_-'\), 32\), '_-'\)/);
  // สระ/วรรณยุกต์ไทยต้องไม่ถูกบดเป็น `_` — [[:alnum:]] อย่างเดียวขึ้นกับ locale ของเซิร์ฟเวอร์
  // (กับดักเดียวกับที่ \p{M} หายไปจาก regex ฝั่ง JS — เจอด้วยเทส ไม่ใช่ด้วยสายตา)
  assert.match(sql, /\[\^\[:alnum:\]ก-๙_-\]\+/);
  // ต้องกวาดสถานีจากทุกแหล่งที่ถือชื่ออยู่ ไม่ใช่แค่ stock policy — ตกแหล่งไหนแปลว่าสถานีนั้น
  // กลายเป็นชื่อที่ไม่มีเจ้าของ แล้วแก้เกณฑ์เวลาให้ไม่ได้อีก
  for (const table of [
    "bms_product_stock_policies",
    "bms_kitchen_station_slas",
    "bms_kitchen_tickets",
    "bms_restaurant_kitchen_tickets",
  ]) {
    assert.match(sql, new RegExp(`FROM ${table}\\b`), `backfill ต้องอ่าน ${table}`);
  }
  // สตริงเดิมต้องอยู่ต่อ: โค้ดรุ่นก่อน 9.54 ที่ยังรันอยู่ระหว่าง deploy อ่านคอลัมน์นั้น
  assert.doesNotMatch(sql, /DROP COLUMN[\s\S]{0,40}kitchen_station/i);
  assert.doesNotMatch(sql, /DROP COLUMN[\s\S]{0,40}\bstation\b/i);
  // ลบสถานีตรงฐานต้องไม่ลากเมนู/ตั๋วหายไปด้วย
  assert.equal((sql.match(/ON DELETE SET NULL/g) ?? []).length >= 3, true);
});

test("ไมเกรชัน 9.54 ไม่แตะเส้นทางสต็อกหรือเงิน — สถานีไม่ใช่สาขา", () => {
  const sql = source(MIGRATION);
  for (const table of ["bms_inventory", "bms_orders", "bms_payments", "bms_order_items"]) {
    assert.doesNotMatch(sql, new RegExp(`(INSERT INTO|UPDATE|ALTER TABLE)\\s+${table}\\b`),
      `9.54 ต้องไม่แตะ ${table}`);
  }
});
