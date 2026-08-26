// =============================================================
// ไฟล์อ่อนไหวต้องไม่ถูกเสิร์ฟให้คนที่ไม่ได้ล็อกอิน (9.26)
// -------------------------------------------------------------
// /api/files/[id] ไม่เคยตรวจอะไรเลย และ files.id เป็น integer เรียงลำดับ ใครก็
// ไล่นับขึ้นไปโหลดสลิปโอนเงิน/ไฟล์แนบ Inbox/รายงานของร้านอื่นได้
//
// เทสนี้ไม่ต้องมี DB — อ่านซอร์สแล้วยืนยันสามอย่าง:
//   1. route ที่เสิร์ฟไฟล์เช็ค visibility ก่อนปล่อยผ่าน และ fail closed
//   2. GET/POST /api/files (ไล่รายชื่อ + อัปโหลด) ต้องมี session
//   3. ทุกจุดที่บันทึกไฟล์ระบุ visibility ชัดเจน — ของใหม่ที่ลืมระบุจะได้ private
//      จากค่าปริยาย แต่จุดที่มีอยู่ต้องอ่านออกว่าเลือกอะไรไว้
//
// Run from apps/web:
//   npx tsx --test ../../scripts/file-visibility-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "../apps/web");
const read = (rel: string) => fs.readFileSync(path.join(WEB, rel), "utf8");

test("route ที่เสิร์ฟไฟล์ต้องเช็ค visibility และ fail closed", () => {
  const src = read("app/api/files/[id]/route.ts");
  assert.match(src, /visibility/, "ต้องอ่านคอลัมน์ visibility");
  assert.match(
    src,
    /SELECT[^`]*visibility[^`]*FROM files/s,
    "query ต้องดึง visibility มาด้วย ไม่ใช่เดา"
  );
  assert.match(
    src,
    /String\(row\.visibility \?\? "private"\) !== "public"/,
    "ค่าที่หายไปต้องถือเป็น private (fail closed) ไม่ใช่ปล่อยผ่าน"
  );
  // private ต้องขอ session ทุกเส้นทาง: ไฟล์ที่มีเจ้าของผ่าน authorizeAdminRoute
  // ไฟล์ที่ไม่มีเจ้าของยอมรับ session ของผู้ใช้เว็บได้
  assert.match(src, /authorizeAdminRoute\(null\)/, "private ต้องขอ session");
  assert.match(src, /verifyUserSession\(\)/, "ไฟล์ที่ไม่มีเจ้าของยังรับ session ผู้ใช้เว็บ");
  assert.match(src, /status: 401/, "ไม่มี session ต้องได้ 401");
  assert.match(src, /private, no-store/, "ไฟล์ private ห้ามถูก cache แบบ public");
});

test("ไล่รายชื่อไฟล์และอัปโหลดต้องล็อกอินก่อน", () => {
  const src = read("app/api/files/route.ts");
  const handlers = src.split(/async function handle/).slice(1);
  assert.equal(handlers.length, 2, "ไฟล์นี้ควรมี handleGET และ handlePOST");
  for (const handler of handlers) {
    assert.match(
      handler,
      /if \(!requireSession\(\)\) return UNAUTHORIZED;/,
      "ทุก handler ต้องเช็ค session เป็นบรรทัดแรก"
    );
  }
});

test("ทุกจุดที่บันทึกไฟล์ระบุ visibility ชัดเจน", () => {
  const expected: Record<string, "public" | "private"> = {
    // หน้าร้านสาธารณะโหลดรูปสินค้าโดยไม่มี session
    "app/api/bms/products/upload/route.ts": "public",
    // seeder สร้างโพสต์ปลอมที่แสดงบนหน้าเว็บสาธารณะ
    "app/api/dev/fake/posts/route.ts": "public",
    // สลิปมีชื่อ+เลขบัญชีผู้โอน
    "app/api/bms/checkout/payment/route.ts": "private",
    // ไฟล์แนบในบทสนทนาลูกค้า
    "app/api/bms/inbox/upload/route.ts": "private",
    // รูปใบสั่งยา = ข้อมูลสุขภาพ
    "app/api/bms/pharmacy/evidence/upload/route.ts": "private",
    "app/api/pos/pharmacy-evidence/route.ts": "private",
  };
  for (const [file, visibility] of Object.entries(expected)) {
    const src = read(file);
    assert.match(
      src,
      new RegExp(`persistWebFile\\([^)]*"${visibility}"`, "s"),
      `${file} ต้องระบุ "${visibility}" ตรงจุดที่เรียก persistWebFile`
    );
  }
});

test("ค่าปริยายของ persistWebFile/persistBuffer คือ private", () => {
  const src = read("lib/storage.ts");
  assert.match(
    src,
    /persistWebFile\([\s\S]{0,200}?visibility: FileVisibility = "private"/,
    "persistWebFile ที่ลืมระบุต้องได้ private"
  );
  assert.match(
    src,
    /persistBuffer\([\s\S]{0,300}?visibility: FileVisibility = "private"/,
    "persistBuffer (ไฟล์รายงาน) ที่ลืมระบุต้องได้ private"
  );
  // ทางเดียวที่ยังเป็น public ปริยายคือ GraphQL upload ของฟีเจอร์ชุมชนเดิม
  // ซึ่งหน้าเว็บโหลดตรงโดยไม่มี session — เปลี่ยนแล้วของเดิมพัง
  assert.match(
    src,
    /persistUploadStream\([\s\S]{0,400}?visibility: FileVisibility = "public"/,
    "persistUploadStream คงเป็น public เพื่อไม่ให้ avatar/โพสต์เดิมพัง"
  );
});

test("INSERT ลง files ต้องเขียน visibility และ tenant_id ทุกครั้ง", () => {
  const src = read("lib/storage.ts");
  const inserts = [...src.matchAll(/INSERT INTO files \(([^)]*)\)/g)];
  assert.ok(inserts.length > 0, "ต้องเจอ INSERT INTO files");
  for (const m of inserts) {
    assert.match(m[1], /visibility/, `INSERT ที่ไม่ระบุ visibility จะได้ค่าปริยายเงียบ ๆ: ${m[1]}`);
    assert.match(m[1], /tenant_id/, `INSERT ที่ไม่เขียน tenant_id ทำให้ไฟล์ใหม่ไม่มีเจ้าของ: ${m[1]}`);
  }
});

// ---------------------------------------------------------------
// เจ้าของไฟล์ (9.27)
// ---------------------------------------------------------------
// 9.26 กันคนที่ไม่ล็อกอินได้ แต่ยังไม่ได้บอกว่าไฟล์เป็นของร้านไหน — ล็อกอินร้าน A
// แล้วเดา id เปิดไฟล์ private ของร้าน B ได้

test("ไฟล์ private ที่มีเจ้าของต้องเทียบ tenant ก่อนปล่อยผ่าน", () => {
  const src = read("app/api/files/[id]/route.ts");
  assert.match(src, /SELECT[^`]*tenant_id[^`]*FROM files/s, "query ต้องดึง tenant_id มาด้วย");
  assert.match(src, /if \(row\.tenant_id\)/, "ต้องแยกเคสไฟล์ที่มีเจ้าของออกจากไฟล์ที่ไม่มี");
  assert.match(
    src,
    /String\(auth\.tenantId\) !== String\(row\.tenant_id\)/,
    "ต้องเทียบ acting tenant กับเจ้าของไฟล์"
  );
  // ตอบ 404 ไม่ใช่ 403 — 403 ยืนยันให้คนนอกร้านรู้ว่า id นี้มีไฟล์อยู่จริง
  const mismatch = src.slice(src.indexOf("String(auth.tenantId) !== String(row.tenant_id)"));
  assert.match(
    mismatch.slice(0, 400),
    /status: 404/,
    "ร้านไม่ตรงต้องได้ 404 ไม่ใช่ 403 (ไม่ยืนยันว่ามีไฟล์อยู่)"
  );
  assert.match(
    src,
    /authorizeAdminRoute\(null\)/,
    "acting tenant ต้องมาจาก authorizeAdminRoute เพื่อรองรับคุกกี้ drill-down ที่เซ็นแล้ว"
  );
});

test("ทุกจุดที่อัปโหลดไฟล์ของร้านต้องผูกเจ้าของ", () => {
  const expected: Record<string, string> = {
    "app/api/bms/products/upload/route.ts": "auth.tenantId",
    "app/api/bms/inbox/upload/route.ts": "auth.tenantId",
    "app/api/bms/pharmacy/evidence/upload/route.ts": "auth.tenantId",
    // POS ใช้ tenant ของเครื่องที่ authenticate แล้ว ไม่ใช่ค่าจาก client
    "app/api/pos/pharmacy-evidence/route.ts": "device.tenantId",
    // สลิปใช้ tenant จาก token ที่เซ็นไว้ ลูกค้าไม่มี session
    "app/api/bms/checkout/payment/route.ts": "current.payload.tenantId",
  };
  for (const [file, source] of Object.entries(expected)) {
    const src = read(file);
    assert.ok(
      src.includes(source),
      `${file} ต้องผูกเจ้าของไฟล์จาก ${source} ไม่ใช่ปล่อยเป็น null`
    );
  }
  // รายงานสร้างจากฝั่ง service ไม่ใช่ route
  assert.match(
    read("lib/bms/reportEngine.ts"),
    /persistBuffer\([^)]*tenantId\)/s,
    "ไฟล์รายงานต้องผูก tenant ของร้านที่สั่งสร้าง"
  );
});
