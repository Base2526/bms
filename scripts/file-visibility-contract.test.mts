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
    /SELECT[^`]*visibility[^`]*FROM files f/s,
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
      /const auth = await requireSession\(\);[\s\S]*?if \(!auth\.scope\) return authError\(auth\.status\);/,
      "ทุก handler ต้องเช็ค session เป็นบรรทัดแรก"
    );
  }
});

test("รายการไฟล์แยก platform inventory จาก personal owner และ upload ต้องมีเพดาน", () => {
  const src = read("app/api/files/route.ts");
  assert.match(src, /authorizePlatformAdminRoute\(\)/,
    "global file inventory ต้องเป็น platform admin เท่านั้น");
  assert.match(src, /owner_user_id = \$\$\{filterArgs\.length\}::uuid/,
    "ผู้ใช้เว็บต้องเห็นเฉพาะไฟล์ที่ตนเป็นเจ้าของ");
  assert.match(src, /scope\.tenantId,[\s\S]*scope\.actorId/,
    "ไฟล์ใหม่ต้องผูกทั้ง tenant และ user จาก session");
  assert.doesNotMatch(src, /tenant_id IS NULL OR tenant_id =/,
    "tenant เดียวกันไม่ใช่สิทธิ์อ่านไฟล์ส่วนตัวของผู้ใช้อื่น");
  assert.match(src, /MAX_FILE_BYTES = 25 \* 1024 \* 1024/,
    "generic upload ต้องมีเพดานที่ยังรองรับเอกสารใช้งานทั่วไป");
  assert.match(src, /rateLimit\(`files-upload:\$\{scope\.rateKey\}`/,
    "upload ต้องจำกัดความถี่ต่อ principal");
  assert.doesNotMatch(src, /SELECT id, filename, original_name, mimetype, size, checksum, relpath/,
    "list API ต้องไม่เปิดเผย storage key ที่ UI ไม่ได้ใช้");
  assert.match(src, /const \{ relpath: _storageKey, \.\.\.safeRow \} = row/,
    "upload response ต้องไม่เปิดเผย storage key");
});

test("ไฟล์ที่เสิร์ฟต้องกัน MIME sniffing และไม่ inline SVG", () => {
  const src = read("app/api/files/[id]/route.ts");
  assert.match(src, /cleanMime !== "image\/svg\+xml"/,
    "SVG ที่ผู้ใช้อัปโหลดต้องถูกบังคับดาวน์โหลดเพื่อกัน stored XSS");
  assert.match(src, /mode === "inline" && inlineSafe/,
    "query mode=inline ต้องข้ามข้อห้ามของ MIME อันตรายไม่ได้");
  assert.match(src, /"X-Content-Type-Options": "nosniff"/,
    "browser ต้องไม่เดา content type ใหม่");
});

test("GraphQL files panel ต้องเป็น platform-only ทั้ง list, rename และ delete", () => {
  const src = read("graphql/resolvers.ts");
  const list = src.slice(src.indexOf("filesPaged:"), src.indexOf("myNotifications:"));
  const mutations = src.slice(src.indexOf("deleteFile:"), src.indexOf("toggleBookmark:"));

  assert.match(list, /await requirePlatformOnly\(ctx\)/,
    "GraphQL global list ต้องเป็น platform admin เท่านั้น");
  assert.match(list, /f\.deleted_at IS NULL/,
    "GraphQL list ต้องไม่คืนไฟล์ที่ลบแล้ว");
  assert.doesNotMatch(list, /f\.\*/,
    "GraphQL list ห้าม SELECT storage metadata ทั้งแถว");
  assert.match(list, /relpath:\s*""/,
    "คง GraphQL shape เดิมแต่ห้ามเปิดเผย storage key");
  assert.equal((mutations.match(/await requirePlatformOnly\(ctx\)/g) ?? []).length, 3,
    "delete, bulk delete และ rename ต้องตรวจ platform admin ทุก mutation");
  assert.equal((mutations.match(/SET deleted_at = NOW\(\), updated_at = NOW\(\)/g) ?? []).length, 2,
    "delete ต้อง soft-delete เพื่อไม่ทำ cascade ลบ reference ของ domain");
});

test("ทุกจุดที่บันทึกไฟล์ระบุ visibility ชัดเจน", () => {
  const expected: Record<string, "public" | "private"> = {
    // หน้าร้านสาธารณะโหลดรูปสินค้าโดยไม่มี session
    "app/api/bms/products/upload/route.ts": "public",
    // โลโก้ร้านแสดงบนใบเสร็จและหน้าร้านสาธารณะ
    "app/api/bms/store-profile/logo/upload/route.ts": "public",
    // พื้นหลังหน้าต้อนรับแสดงบนจอลูกค้าที่จับคู่ด้วย device token
    "app/api/bms/store-profile/customer-display-background/upload/route.ts": "public",
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
      new RegExp(`persistWebFile\\([^;]*"${visibility}"`, "s"),
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
  assert.match(
    src,
    /visibility: options\.visibility \?\? "private"/,
    "GraphQL upload ที่ caller ลืมเลือก visibility ต้อง fail closed เป็น private"
  );
  assert.match(src, /limitUploadStream\(upload\.createReadStream\(\), maxBytes\)/,
    "stream ต้องมี byte limit จริง ไม่เชื่อเฉพาะ metadata จาก client");
});

test("INSERT ลง files ต้องเขียน visibility, tenant_id และ owner_user_id ทุกครั้ง", () => {
  const src = read("lib/storage.ts");
  const inserts = [...src.matchAll(/INSERT INTO files \(([^)]*)\)/g)];
  assert.ok(inserts.length > 0, "ต้องเจอ INSERT INTO files");
  for (const m of inserts) {
    assert.match(m[1], /visibility/, `INSERT ที่ไม่ระบุ visibility จะได้ค่าปริยายเงียบ ๆ: ${m[1]}`);
    assert.match(m[1], /tenant_id/, `INSERT ที่ไม่เขียน tenant_id ทำให้ไฟล์ใหม่ไม่มีเจ้าของ: ${m[1]}`);
    assert.match(m[1], /owner_user_id/, `INSERT ที่ไม่เขียน owner_user_id ทำให้ไฟล์ส่วนตัวหลุดข้าม user: ${m[1]}`);
  }
});

test("chat media ต้อง private และเปิดได้เฉพาะสมาชิกห้อง", () => {
  const route = read("app/api/files/[id]/route.ts");
  const resolvers = read("graphql/resolvers.ts");
  const migration = fs.readFileSync(
    path.resolve(import.meta.dirname, "../db/migrations/10.109__files_user_ownership_and_private_chat.sql"),
    "utf8"
  );
  assert.match(route, /canReadChatFile\(id, actorIds\)/,
    "route ต้องตรวจ chat_members ก่อน stream ไฟล์แชท");
  assert.match(route, /cm\.user_id::text = ANY\(\$2::text\[\]\)/,
    "membership ต้องผูกกับ actor จาก session");
  assert.equal((resolvers.match(/visibility: "private",[\s\S]{0,160}?ownerUserId: author_id/g) ?? []).length, 2,
    "รูปและเสียงแชทใหม่ต้อง private พร้อม owner");
  assert.match(migration, /SELECT file_id FROM message_images/);
  assert.match(migration, /SELECT audio_file_id FROM messages/);
  assert.match(migration, /SET visibility = 'private'/);
});

test("legacy artifact อันตรายต้องไม่ออกทาง generic sequential-id route", () => {
  const route = read("app/api/files/[id]/route.ts");
  const migration = fs.readFileSync(
    path.resolve(import.meta.dirname, "../db/migrations/10.109__files_user_ownership_and_private_chat.sql"),
    "utf8"
  );
  assert.match(route, /BLOCKED_GENERIC_EXTENSIONS/);
  assert.match(route, /isBlockedGenericDownload\(row\)/);
  assert.match(route, /row\.is_pharmacy_evidence/);
  assert.match(route, /row\.is_support_bundle/);
  assert.match(route, /row\.is_release_asset/);
  assert.match(migration, /'%.keystore'/);
  assert.match(migration, /'%.sql'/);
  assert.match(migration, /LIKE '%\.\.\/\%'/);
  assert.match(migration, /unnest\(ARRAY\[original_name, filename, relpath\]\)/,
    "migration ต้องตรวจทุกชื่อและ storage path ไม่ใช่หยุดที่ค่า COALESCE ตัวแรก");
  assert.match(migration, /replace\(candidate\.value, chr\(92\), '\/'\) LIKE '%\.\.\/\%'/,
    "migration ต้อง normalize Windows traversal ก่อนจัดไฟล์เป็น private");
});

test("PATCH/DELETE personal file ต้องเป็น owner และห้ามแก้ domain reference", () => {
  const src = read("app/api/files/[id]/route.ts");
  assert.match(src, /export const PATCH = withRouteErrorLog/);
  assert.match(src, /export const DELETE = withRouteErrorLog/);
  assert.equal((src.match(/current\.is_community_reference/g) ?? []).length, 2);
  assert.equal((src.match(/String\(current\.owner_user_id \|\| ""\) !== auth\.actorId/g) ?? []).length, 2);
  assert.match(src, /authorizePlatformAdminRoute\(\)/,
    "platform file manager ยังจัดการ global inventory ได้");
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
    "app/api/bms/store-profile/logo/upload/route.ts": "auth.tenantId",
    "app/api/bms/store-profile/customer-display-background/upload/route.ts": "auth.tenantId",
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

test("อัปโหลดโลโก้ร้านต้องยืนยัน admin และจำกัดไฟล์รูป", () => {
  const src = read("app/api/bms/store-profile/logo/upload/route.ts");
  assert.match(src, /authorizeTenantSettingsAdminRoute\(\)/, "ต้องใช้ขอบเขต Administrator เดียวกับ store profile mutation");
  assert.match(src, /image\/jpeg/, "ต้องรองรับ JPG");
  assert.match(src, /image\/png/, "ต้องรองรับ PNG");
  assert.match(src, /image\/webp/, "ต้องรองรับ WebP");
  assert.match(src, /5 \* 1024 \* 1024/, "ต้องจำกัดขนาดไฟล์ไว้ที่ 5MB");
  assert.match(src, /await prepareStoreLogo\(/, "ต้องตรวจและ decode รูปจริงก่อนบันทึก");
  assert.match(src, /persistWebFile\(normalizedLogo, undefined, "public", auth.tenantId\)/);
});

test("อัปโหลดพื้นหลังจอลูกค้าต้องยืนยัน admin ตรวจรูป และผูก tenant", () => {
  const src = read("app/api/bms/store-profile/customer-display-background/upload/route.ts");
  assert.match(src, /authorizeTenantSettingsAdminRoute\(\)/);
  assert.match(src, /image\/jpeg/);
  assert.match(src, /image\/png/);
  assert.match(src, /image\/webp/);
  assert.match(src, /5 \* 1024 \* 1024/);
  assert.match(src, /await prepareCustomerDisplayBackground\(/);
  assert.match(src, /persistWebFile\(normalizedBackground, undefined, "public", auth\.tenantId\)/);
});
