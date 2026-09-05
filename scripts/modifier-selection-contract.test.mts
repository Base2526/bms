// =============================================================
// กลุ่มตัวเลือกที่ยังไม่ครบขั้นต่ำ — กฎเดียวกับที่ server บังคับ
// -------------------------------------------------------------
// เคสจริงจาก production (2026-09-05): log ของ server มี
// "ต้องเลือก เผ็ดกี่เม็ด อย่างน้อย 1 รายการ" ยิงซ้ำ 4 ครั้งใน 10 นาที — จอปล่อยให้กด
// "เพิ่มในบิล" ทั้งที่ยังไม่ได้แตะชิป แล้วคำตอบไปโผล่เป็น "เซิร์ฟเวอร์ผิดพลาด"
//
//   cd apps/web && npx tsx --test ../../scripts/modifier-selection-contract.test.mts
// =============================================================
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  describeUnmetModifierGroups,
  unmetModifierGroups,
} from "../apps/web/lib/pos/modifierSelection.ts";

const spice = (code: string, min = 1) =>
  ({ code, groupCode: "SPICE", groupName: "เผ็ดกี่เม็ด", minSelect: min });
const extra = (code: string, min = 0) =>
  ({ code, groupCode: "EXTRA", groupName: "ความต้องการพิเศษ", minSelect: min });

test("กลุ่มที่บังคับแต่ยังไม่เลือก ต้องถูกรายงานด้วยชื่อกลุ่ม", () => {
  const menu = [spice("NONE"), spice("HOT1"), extra("NOVEG")];
  assert.deepEqual(unmetModifierGroups(menu, []), ["เผ็ดกี่เม็ด"]);
  assert.deepEqual(unmetModifierGroups(menu, ["HOT1"]), []);
  // กลุ่มที่ไม่บังคับต้องไม่ถูกทวง แม้ไม่เลือกอะไรเลย
  assert.deepEqual(unmetModifierGroups([extra("NOVEG")], []), []);
});

test("ขั้นต่ำมากกว่าหนึ่งนับจำนวนที่เลือกจริง", () => {
  const menu = [spice("A", 2), spice("B", 2), spice("C", 2)];
  assert.deepEqual(unmetModifierGroups(menu, ["A"]), ["เผ็ดกี่เม็ด"]);
  assert.deepEqual(unmetModifierGroups(menu, ["A", "C"]), []);
});

test("หลายกลุ่มที่ยังไม่ครบต้องขึ้นครบทุกกลุ่ม ไม่ใช่กลุ่มแรกกลุ่มเดียว", () => {
  const menu = [spice("HOT1"), extra("NOVEG", 1)];
  assert.deepEqual(unmetModifierGroups(menu, []), ["เผ็ดกี่เม็ด", "ความต้องการพิเศษ"]);
  assert.equal(
    describeUnmetModifierGroups(unmetModifierGroups(menu, [])),
    "ยังต้องเลือก: เผ็ดกี่เม็ด · ความต้องการพิเศษ"
  );
  assert.equal(describeUnmetModifierGroups([]), "");
});

test("ค่าขั้นต่ำที่เพี้ยนถือว่าไม่บังคับ ไม่ใช่ล็อกปุ่มไว้ตลอดกาล", () => {
  const broken = [{ code: "X", groupCode: "G", groupName: "กลุ่ม", minSelect: NaN }];
  assert.deepEqual(unmetModifierGroups(broken, []), []);
  const negative = [{ code: "X", groupCode: "G", groupName: "กลุ่ม", minSelect: -3 }];
  assert.deepEqual(unmetModifierGroups(negative, []), []);
});

test("จอต้องปิดปุ่มและบอกว่าต้องแตะอะไร ไม่ใช่ปล่อยให้ server ปฏิเสธ", async () => {
  const src = await readFile(new URL("../apps/web/app/(pos)/pos/restaurant/page.tsx", import.meta.url), "utf8");
  assert.match(src, /okButtonProps=\{\{ disabled: unmetModifiers\.length > 0 \}\}/,
    "ปุ่มเพิ่มในบิลต้องกดไม่ได้เมื่อกลุ่มบังคับยังว่าง");
  assert.match(src, /describeUnmetModifierGroups\(unmetModifiers\)/,
    "ต้องบอกชื่อกลุ่มที่ยังไม่ได้เลือก ไม่ใช่แค่ปิดปุ่มเงียบ ๆ");
  assert.match(src, /needsPick && <span className=\{styles\.fieldNeeded\}/,
    "เมนูที่มีหลายกลุ่มต้องรู้ว่ากลุ่มไหน");
  assert.match(src, /unmetModifierGroups\(menuHit\.modifiers, modifierCodes\)/,
    "ต้องใช้กฎตัวเดียวกับที่เทสคุม ไม่ใช่เขียนเงื่อนไขซ้ำในหน้า");
});
