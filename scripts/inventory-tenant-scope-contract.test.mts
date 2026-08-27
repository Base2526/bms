// =============================================================
// Nothing touches bms_inventory without naming the shop
// -------------------------------------------------------------
// `bms_inventory` is keyed by (tenant_id, location_id, product_sku, size), so a
// statement that filters on sku + size alone matches that product in EVERY shop
// and EVERY branch that stocks it. There is no error, no constraint violation,
// and nothing in the response to reveal it — the writer sees success while
// another shop's shelf changes.
//
// That is not hypothetical: reserveStock() shipped that way, and the dev database
// has `NIKE-AIR/XL` in two different tenants, so one call moved both. It was the
// only such statement in the codebase (16 writes, 1 unscoped), which is exactly
// why a test is worth having — the other 15 are correct, so the next unscoped one
// will look just as ordinary in review as this one did.
//
// RLS is not a substitute. Read paths use query() without SET LOCAL ROLE, so the
// policies do not apply, and a superuser connection bypasses them anyway
// (CLAUDE.local.md § ก่อน production still lists "make the app connect as a
// non-superuser" as open work).
//
// No database. Run from apps/web:
//   npx tsx --test ../../scripts/inventory-tenant-scope-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "../apps/web");

/**
 * path.relative() คืน separator ของ OS — บน Windows จึงได้ `app\api\...` แล้วไม่มีวัน
 * ตรงกับ allowlist ที่เขียนด้วย `/` ผลคือเทสนี้แดงตลอดบนเครื่อง Windows ทั้งที่ route
 * ถูกต้อง และเทสที่แดงเสมอคือเทสที่เลิกมีคนอ่าน — เทียบด้วยรูปแบบเดียวเสมอ
 */
const relPosix = (file: string): string => path.relative(WEB, file).split(path.sep).join("/");

/** ตารางที่ผูกกับร้าน และการลืม tenant_id คือการแตะข้อมูลร้านอื่นเงียบ ๆ */
const TENANT_SCOPED_TABLES = ["bms_inventory", "bms_product_price_tiers", "bms_product_packs"];

/**
 * ไฟล์ที่รันฝั่ง server เท่านั้น — devSeed/สคริปต์ seeder ก็ต้องผูก tenant เหมือนกัน
 * (AGENTS.md: seeder ที่ลืม tenant_id สร้างแถวที่ไม่โผล่ในหน้า admin)
 */
const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
};

/**
 * ตัด statement ออกมาจาก template literal ที่ล้อมอยู่ — โค้ดเบสนี้เขียน SQL ใน
 * backtick ทั้งหมด ถ้าเจอ match ที่ไม่ได้อยู่ใน backtick แปลว่ารูปแบบเปลี่ยนแล้ว
 * และเทสนี้เชื่อไม่ได้อีก จึงต้องฟ้อง ไม่ใช่ปล่อยผ่าน
 */
const enclosingSql = (src: string, at: number) => {
  const open = src.lastIndexOf("`", at);
  const close = src.indexOf("`", at);
  if (open === -1 || close === -1) return null;
  return src.slice(open + 1, close);
};

/**
 * คอมเมนต์ที่อธิบายบั๊กมักอ้างชื่อตารางใน `backtick` ซึ่งหน้าตาเหมือน SQL literal
 * — เทสที่นับคอมเมนต์เป็น statement จะแดงใส่คำอธิบายของตัวเอง
 */
const isInComment = (src: string, at: number) => {
  const lineStart = src.lastIndexOf("\n", at) + 1;
  const before = src.slice(lineStart, at);
  const trimmed = before.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
};

test("every SQL statement touching a tenant-scoped stock table filters by tenant_id", () => {
  const files = walk(path.join(WEB, "lib")).concat(walk(path.join(WEB, "app")));
  assert.ok(files.length > 100, `เจอไฟล์แค่ ${files.length} — การเดิน tree คงพลาด`);

  const unscoped: string[] = [];
  const unparsed: string[] = [];
  let statements = 0;

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const table of TENANT_SCOPED_TABLES) {
      const re = new RegExp(`\\b(?:FROM|UPDATE|INTO|JOIN)\\s+${table}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (isInComment(src, m.index)) continue;
        const sql = enclosingSql(src, m.index);
        const where = `${relPosix(file)}:${src.slice(0, m.index).split("\n").length}`;
        if (sql == null) {
          unparsed.push(where);
          continue;
        }
        statements++;
        if (!/tenant_id/i.test(sql)) unscoped.push(`${where} (${table})`);
      }
    }
  }

  assert.deepEqual(unparsed, [], "SQL ที่ไม่ได้อยู่ใน template literal — เทสนี้อ่านไม่ออก ต้องมาดูด้วยมือ");
  assert.ok(statements > 20, `ตรวจไปแค่ ${statements} statement — regex คงพัง`);
  assert.deepEqual(
    unscoped.sort(),
    [],
    "statement เหล่านี้จะแตะสต็อกของทุกร้านที่ขาย SKU เดียวกัน โดยไม่มี error ให้เห็น"
  );
});

/**
 * ทุก route ใต้ /api/bms ต้องมีการ์ดอย่างใดอย่างหนึ่ง — `middleware.ts` กันแค่ `/admin/**`
 * ทุกอย่างใต้ `/api/**` ที่ไม่ใช่หน้า admin ผ่านฟรี · route ใหม่ที่ลืมการ์ดจึงเปิดโล่ง
 * ทันทีที่ merge โดยไม่มีอะไรฟ้อง (เจอมาแล้ว 26 ไฟล์พร้อมกัน)
 */
const ROUTE_GUARDS = [
  "authorizeAdminRoute",        // แอดมินที่ล็อกอิน + RBAC + tenant จาก session
  "verifyAdminSession",         // role-based gate ที่ไม่ได้ใช้ permission catalog (onboarding/sample-data)
  // จงใจไม่รับ `requireAdminOrInternal` เป็นการ์ดที่ยอมรับได้: มันแค่ยืนยันว่าล็อกอินแล้ว
  // ไม่ดูสิทธิ์เลย — สองที่ที่เคยใช้ (อัปโหลดรูปสินค้า/ไฟล์แนบแชท) ย้ายไปใช้ permission แล้ว
  "requirePlatformAdminSeeder", // seeder ระดับแพลตฟอร์ม
  "authorizeCronRequest",       // helper ที่ fail closed (lib/bms/cronRouteAuth.ts)
  "CRON_SECRET",                // job ที่ cron ยิง
  "BMS_JOB_TOKEN",
  "verifyMetaSignature",        // webhook ที่ verify ลายเซ็น (fail-closed)
  "verifyLineSignature",
  "channel_secret",
  "getCheckoutByToken",         // ลิงก์ checkout ที่เซ็นไว้ (ลูกค้าเปิดเอง ไม่มี session)
  "mockWebhookDisabled",        // mock ยุคร้านเดียว — 404 ใน production ยิงได้แค่ dev
];

/**
 * เปิดสาธารณะโดยตั้งใจ — ต้องมีเหตุผลเขียนไว้ และต้องมีเพดานการใช้ เพราะทั้งสองตัว
 * เรียกโมเดลจริง (ค่า token เป็นของเจ้าของระบบ ไม่ใช่ของผู้ยิง)
 */
const PUBLIC_BY_DESIGN = new Map([
  ["app/api/bms/web/webhook/[tenantId]/route.ts", "วิดเจ็ตแชทบนเว็บของร้าน — ฝั่ง client ไม่มีความลับให้เซ็น"],
  ["app/api/bms/demo-chat/route.ts", "เดโมหน้าขายของ — ใครก็ลองได้โดยตั้งใจ"],
]);

test("every /api/bms route is guarded, or public by design with a rate limit", () => {
  const routes = walk(path.join(WEB, "app/api/bms")).filter((f) => f.endsWith("route.ts"));
  assert.ok(routes.length > 40, `เจอ route แค่ ${routes.length} — การเดิน tree คงพลาด`);

  const unguarded: string[] = [];
  const unlimited: string[] = [];
  for (const file of routes) {
    const rel = relPosix(file);
    const src = readFileSync(file, "utf8");
    const reason = PUBLIC_BY_DESIGN.get(rel);
    if (reason) {
      // เปิดสาธารณะได้ แต่ต้องมีเพดาน ไม่งั้นเป็นช่องเผาเงินค่าโมเดล
      if (!/rateLimit\(/.test(src)) unlimited.push(rel);
      continue;
    }
    if (!ROUTE_GUARDS.some((guard) => src.includes(guard))) unguarded.push(rel);
  }

  assert.deepEqual(unlimited.sort(), [], "route สาธารณะที่ไม่มีเพดานการใช้");
  assert.deepEqual(
    unguarded.sort(),
    [],
    "route เหล่านี้ยิงได้โดยไม่ต้องล็อกอิน — middleware ไม่ได้กัน /api/** ให้"
  );
});

// การ์ดที่ "ข้ามได้เมื่อไม่ตั้ง env" ไม่ใช่การ์ด
//
// รูปแบบ `if (secret && header !== secret)` อ่านผ่าน ๆ เหมือนตรวจ แต่แปลว่า
// ไม่ตั้ง env = ไม่ตรวจอะไรเลย · เกิดจริงกับ cron 9 ตัวที่ส่งอีเมลออก จ่ายค่า AI
// ปล่อยสต็อกที่จองไว้ และทำแต้มลูกค้าหมดอายุ ขณะที่ BMS_CRON_SECRET ยังไม่ได้ตั้ง
//
// เทสก่อนหน้านี้มองไม่เห็นเพราะมันดูแค่ว่า "มีคำว่า CRON_SECRET อยู่ในไฟล์ไหม"
test("no route treats a missing secret as permission to run", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name !== "route.ts") continue;
      // ตัดคอมเมนต์ออกก่อน ไม่งั้นเอกสารที่อธิบายรูปแบบเก่า ("เดิมเขียน if (expected && …)")
      // จะถูกจับเป็นของจริง — เจอมาแล้วตอนเขียนเทสนี้
      const src = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // `if (<secretVar> && ...)` — ตัวแปรความลับเป็นเงื่อนไขนำ = ข้ามได้เมื่อว่าง
      for (const m of src.matchAll(/if \(\s*(secret|expected|token|adminToken)\s*&&/g)) {
        offenders.push(`${relPosix(full)}  →  ${m[0]}`);
      }
    }
  };
  // ทั้ง /api ไม่ใช่แค่ /api/bms — admin/queue/db ก็เคยเป็นแบบนี้
  walk(path.join(WEB, "app", "api"));
  assert.deepEqual(
    [...new Set(offenders)].sort(),
    [],
    "การ์ดต้องปฏิเสธเมื่อไม่ได้ตั้งความลับ ไม่ใช่ปล่อยผ่าน:\n" + offenders.join("\n")
  );
});

test("the reserve route never takes its tenant from the request body", () => {
  const route = readFileSync(path.join(WEB, "app/api/bms/reserve/route.ts"), "utf8");
  assert.match(route, /authorizeAdminRoute\(/, "route ที่เขียนสต็อกต้องยืนยันตัวตนก่อน");
  assert.match(route, /tenantId:\s*auth\.tenantId/, "tenant ต้องมาจาก session ที่เซ็นไว้");
  assert.equal(
    /body\.tenantId|tenantId\s*=\s*(?:String\()?body/.test(route),
    false,
    "รับ tenant จาก body = กลับไปเป็นช่องที่ระบุร้านปลายทางเองได้ แม้จะล็อกอินแล้ว"
  );
});
