// =============================================================
// สมัครสมาชิกที่หน้าเคาน์เตอร์ — กฎของเบอร์มีสูตรเดียว และเส้นทางเขียนมีด่านครบ
// -------------------------------------------------------------
// ก่อนรอบนี้กฎ "เบอร์แบบไหนสมัครได้" ถูกเขียนไว้สองที่ที่ไม่รู้จักกัน: `enrollMember()`
// ฝั่ง server (normalize ก่อนเทียบ) กับหน้าค้าปลีกที่เทียบ regex เดียวกัน **กับค่าดิบ** →
// พิมพ์ "089-123-4567" ทำให้ปุ่มตายทั้งที่ server รับเบอร์นั้น · พอหน้าร้านอาหารจะมีเส้นทาง
// สมัครด้วย ก็จะกลายเป็นสูตรที่สาม จึงยุบเป็น `lib/pos/memberEnroll.ts` แล้วตรึงไว้ที่นี่
//
//   cd apps/web && npx tsx --test ../../scripts/member-enroll-contract.test.mts
// =============================================================
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isEnrollablePhone, normalizeEnrollPhone } from "../apps/web/lib/pos/memberEnroll.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

/** ตัดคอมเมนต์ JS/TS และ SQL ออกก่อนสแกน — คอมเมนต์ไม่ใช่พฤติกรรม */
function code(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^[ \t]*--.*$/gm, "");
}

test("ช่องว่างและขีดเป็นการจัดหน้าของคน ไม่ใช่ส่วนของเบอร์", () => {
  assert.equal(normalizeEnrollPhone(" 089-123-4567 "), "0891234567");
  assert.equal(normalizeEnrollPhone("+66 89 123 4567"), "+66891234567");
  // เบอร์ที่คนพิมพ์ตามที่เห็นบนบัตร/ใบเสร็จต้องผ่าน ไม่ใช่บังคับให้พิมพ์ติดกัน
  assert.ok(isEnrollablePhone("089-123-4567"), "เบอร์ที่มีขีดต้องสมัครได้");
  assert.ok(isEnrollablePhone("+66 89 123 4567"), "เบอร์ต่างประเทศที่มีช่องว่างต้องสมัครได้");
});

test("ตัวตรวจของจอต้องรับ-ปฏิเสธชุดเดียวกับ enrollMember()", () => {
  // ขอบล่าง/ขอบบนตามกฎของ service: 8-20 ตัวหลัง normalize
  assert.equal(isEnrollablePhone("1234567"), false, "7 ตัวต้องไม่ผ่าน");
  assert.ok(isEnrollablePhone("12345678"), "8 ตัวต้องผ่าน");
  assert.ok(isEnrollablePhone("1".repeat(20)), "20 ตัวต้องผ่าน");
  assert.equal(isEnrollablePhone("1".repeat(21)), false, "21 ตัวต้องไม่ผ่าน");
  assert.equal(isEnrollablePhone(""), false);
  // คนที่ค้นด้วย "ชื่อ" แล้วกดสมัคร ต้องไม่ได้ชื่อไปเป็นเบอร์
  assert.equal(isEnrollablePhone("สมชาย ใจดี"), false);
  assert.equal(isEnrollablePhone("089123456a"), false);
});

test("กฎของเบอร์ถูกประกาศที่เดียว — ห้ามมี regex ชุดที่สองในแอป", async () => {
  // สแกนไฟล์ที่เคยถือสำเนา + ไฟล์ที่เพิ่งต่อสายเข้ามา · ถ้าใครก็อป regex กลับไปวางเอง
  // ทั้งสองฝั่งจะ drift ได้เงียบ ๆ อีกครั้ง (ซึ่งคือเหตุที่โมดูลนี้เกิด)
  const owners = [
    "apps/web/lib/bms/membership.ts",
    "apps/web/app/(pos)/pos/page.tsx",
    "apps/web/app/(pos)/pos/restaurant/page.tsx",
  ];
  for (const path of owners) {
    const source = code(await read(path));
    assert.ok(
      !/\[0-9\+\]\{8,\s*20\}/.test(source),
      `${path} เขียนกฎเบอร์เอง — ต้องเรียก isEnrollablePhone() จาก lib/pos/memberEnroll.ts`
    );
    assert.match(source, /from "@\/lib\/pos\/memberEnroll"/,
      `${path} ต้อง import กฎเบอร์จากโมดูลกลาง`);
  }
  // และโมดูลกลางต้องเป็น leaf จริง — import อะไรเข้ามาแล้วจอเอาไปใช้ไม่ได้
  const pure = await read("apps/web/lib/pos/memberEnroll.ts");
  assert.ok(!/^\s*import\s/m.test(pure), "lib/pos/memberEnroll.ts ต้องไม่ import อะไรเลย");
});

test("สมัครสมาชิกที่เคาน์เตอร์ยังต้องผ่าน PIN + สิทธิ์ member.manage ที่ route", async () => {
  const route = code(await read("apps/web/app/api/pos/member/route.ts"));
  // tenant มาจากตัวเครื่องเท่านั้น — ห้ามให้ client บอกว่าตัวเองเป็นร้านไหน
  assert.match(route, /authenticatePosDevice\(req\.headers\.get\("x-pos-device-token"\)/);
  assert.ok(!/body\.tenantId/.test(route), "route ต้องไม่รับ tenant จาก body");
  const post = route.slice(route.indexOf("async function handlePOST"));
  assert.match(post, /verifyCashierPin\(/, "สมัครสมาชิกต้องตรวจ PIN");
  assert.match(post, /cashierHasPermission\([^)]*"member\.manage"\)/,
    "สมัครสมาชิกต้องตรวจสิทธิ์ member.manage");
  // ⚠️ INVALID ต้องมี `error` คู่กับ `reason` — ผู้เรียกที่แปลคำตอบด้วย describePosFailure()
  // อ่านเฉพาะ `error` ในกิ่ง default ถ้าไม่มีจะโชว์ "ขายไม่สำเร็จ (INVALID)" ทั้งที่ server
  // รู้เหตุผลอยู่แล้ว และนี่ไม่ใช่การขาย
  assert.match(post, /error:\s*result\.reason/,
    "คำตอบ INVALID ต้องส่ง error คู่กับ reason ไม่งั้นเหตุผลจริงถูกกลบ");
});
