// =============================================================
// ทุก route ใต้ /api/pos ต้องมีด่านของตัวเอง — source contract (ไม่ต้องมี DB)
// -------------------------------------------------------------
// `middleware.ts` กันแค่ `/admin/**` · `/api/pos/**` ทั้ง 38 route ขยับเงิน สต็อก ลิ้นชัก
// และเอกสารภาษี โดยยืนยันตัวตนด้วย **device token + PIN แคชเชียร์** ไม่ใช่ session ของ
// GraphQL — ไม่มีอะไรนอกจากตัว route เองที่บังคับเรื่องนี้
//
// `inventory-tenant-scope-contract` สแกน `/api/bms` อยู่แล้ว แต่ไม่เคยสแกน `/api/pos` เลย
// route ใหม่ที่ลืม PIN หรือลืมตรวจสิทธิ์จึงผ่านทุกประตูได้เงียบ ๆ (บทเรียนเดียวกับตอนที่
// 26 ไฟล์ใต้ /api/bms หลุดพร้อมกันโดยไม่มีอะไรฟ้อง)
//
// สิ่งที่ตรึงไว้:
//   1. ทุกไฟล์ต้องยืนยันเครื่องก่อน (device token)
//   2. route ที่ "เขียน" ต้องตรวจ PIN ของคน ไม่ใช่แค่เครื่อง — เครื่องที่วางอยู่บนเคาน์เตอร์
//      ไม่ใช่ตัวตนของใคร · ยกเว้นได้เฉพาะที่เขียนเหตุผลไว้ในลิสต์ข้างล่าง
//   3. tenant/สาขา ต้องมาจากเครื่องที่ยืนยันแล้ว ห้ามอ่านจาก body
//
//   cd apps/web && npx tsx --test ../../scripts/pos-route-guard-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web");
const POS_API = path.join(WEB, "app", "api", "pos");

const relPosix = (file: string) => path.relative(WEB, file).split(path.sep).join("/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const routes = walk(POS_API)
  .filter((f) => f.endsWith("route.ts"))
  .sort();

/** ตัดคอมเมนต์ก่อนสแกน — เอกสารที่อธิบายด่านไม่ใช่ด่าน */
const code = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * เขียนได้โดยไม่ต้องมี PIN — ต้องมีเหตุผลที่ยังจริงอยู่ ไม่ใช่ "ยังไม่ได้ทำ"
 *
 * การพักบิลไม่แตะเงิน ไม่แตะสต็อก และไม่สร้างเอกสาร · บังคับ PIN ตรงนั้นจะได้แค่แคชเชียร์
 * ที่เลิกพักบิลแล้วกลับไปจดใส่กระดาษ · ส่วนพรีวิวส่วนลดสมาชิกเป็นการอ่านล้วน ตัวเลขจริง
 * เกิดตอน /api/pos/sale ซึ่งตรวจ PIN และสิทธิ์ผู้อนุมัติเอง
 */
const WRITE_WITHOUT_PIN = new Map([
  ["app/api/pos/park/route.ts", "พักบิล: ไม่แตะเงิน/สต็อก/เอกสาร"],
  ["app/api/pos/member/preview/route.ts", "อ่านอย่างเดียว: พรีวิวส่วนลดก่อนกดขาย"],
]);

test("มี route ให้สแกนจริง (ตัวเดินไดเรกทอรีไม่พลาด)", () => {
  assert.ok(routes.length >= 30, `เจอ ${routes.length} route ซึ่งน้อยผิดปกติ`);
});

test("ทุก route ของเครื่องขายยืนยันเครื่องก่อนทำอะไร", () => {
  const unauthenticated = routes.filter((file) => {
    const src = code(readFileSync(file, "utf8"));
    return !/authenticatePosDevice\(|authenticateRestaurantRead\(|authenticateRestaurantMutation\(/.test(src);
  });
  assert.deepEqual(unauthenticated.map(relPosix), [],
    "route ของเครื่องขายที่ไม่ยืนยัน device token");
});

test("route ที่เขียนต้องตรวจ PIN ของคน ไม่ใช่แค่เครื่อง", () => {
  const missing: string[] = [];
  for (const file of routes) {
    const rel = relPosix(file);
    const src = code(readFileSync(file, "utf8"));
    const writes = /export const (POST|PUT|PATCH|DELETE)\b/.test(src);
    if (!writes) continue;
    if (WRITE_WITHOUT_PIN.has(rel)) continue;
    if (!/verifyCashierPin\(|authenticateRestaurantMutation\(/.test(src)) missing.push(rel);
  }
  assert.deepEqual(missing, [], "route ที่เขียนแต่ไม่ตรวจ PIN");
});

test("ข้อยกเว้นเรื่อง PIN ต้องยังมีอยู่จริงและมีเหตุผลกำกับ", () => {
  for (const [rel, reason] of WRITE_WITHOUT_PIN) {
    assert.ok(routes.some((file) => relPosix(file) === rel), `${rel} หายไปแล้ว — ลบออกจากลิสต์`);
    assert.ok(reason.trim().length > 10, `${rel} ต้องเขียนเหตุผลว่าทำไมไม่ต้องมี PIN`);
  }
});

test("tenant และสาขามาจากเครื่องที่ยืนยันแล้วเสมอ ห้ามอ่านจาก body", () => {
  const leaks: string[] = [];
  for (const file of routes) {
    const src = code(readFileSync(file, "utf8"));
    // `tenantId: body.x` / `locationId: body.x` — สองค่านี้คือขอบเขตของข้อมูลทั้งร้าน
    if (/\b(tenantId|locationId)\s*:\s*(?:String\()?\s*body\b/.test(src)) leaks.push(relPosix(file));
  }
  assert.deepEqual(leaks, [], "route ที่รับ tenant/สาขาจาก body");
});

test("การปฏิเสธตามกฎธุรกิจต้องไม่กลายเป็น 500 ที่ข้อความถูกลบทิ้งบน production", () => {
  const unwrapped = routes.filter((file) => {
    const src = code(readFileSync(file, "utf8"));
    return !/withRouteErrorLog\(/.test(src);
  });
  assert.deepEqual(unwrapped.map(relPosix), [],
    "route ที่ไม่ได้ห่อ withRouteErrorLog — error ที่หลุดจะกลายเป็น 500 ที่ไม่มี body");
});
