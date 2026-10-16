import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../apps/web/app/(pos)/pos/page.tsx", import.meta.url),
  "utf8"
);

test("POS contextual help works with touch and keyboard instead of hover only", () => {
  assert.match(source, /function PosHelp\(/);
  assert.match(source, /<details[\s\S]*className=\{`pos-help/);
  assert.match(source, /<summary aria-label=\{`ดูคำอธิบาย:/);
  assert.match(source, /\.pos-help > summary:focus-visible/);
  assert.match(source, /@media \(max-width: 767px\)[\s\S]*\.pos-help-popover \{ position: fixed/);
});

test("POS contextual help closes on outside click and Escape", () => {
  assert.match(source, /document\.addEventListener\("pointerdown", onPointerDown\)/);
  assert.match(source, /!detailsRef\.current\?\.contains\(target\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /querySelector<HTMLElement>\("summary"\)\?\.focus\(\)/);
  assert.match(source, /document\.removeEventListener\("pointerdown", onPointerDown\)/);
});

test("POS help covers every high-risk workflow without decorating every basic field", () => {
  const uses = source.match(/<PosHelp title=/g) ?? [];
  assert.ok(uses.length >= 20, `expected at least 20 contextual help points, found ${uses.length}`);

  for (const title of [
    "คืนสินค้าและคืนเงินจริง",
    "การรับสินค้าเข้า",
    "วงจรบิลมัดจำ",
    "ค่าใช้จ่ายหน้าร้าน",
    "เงินเข้าออกที่ไม่ใช่ยอดขาย",
    "จ่ายหลายวิธี",
    "ขายเชื่อและเครดิตคืนสินค้า",
    "อนุมัติเฉพาะบิลนี้",
  ]) {
    assert.match(source, new RegExp(`title=\\"${title}\\"`), `missing help topic: ${title}`);
  }
});

test("ambiguous POS fields and deposit commands say exactly what they do", () => {
  assert.match(source, />ยอดที่จะรับครั้งนี้</);
  assert.match(source, />รับมัดจำครั้งแรกจากบิลที่เลือก</);
  assert.match(source, />รับมัดจำเพิ่ม</);
  assert.match(source, /placeholder="ยอดที่แบ่งให้วิธีนี้"/);
  assert.match(source, /placeholder="เงินสดที่ลูกค้ายื่นมา"/);
  assert.match(source, /placeholder="รายละเอียดเหตุผล \(บังคับและแสดงในประวัติ\)"/);
  assert.match(source, /placeholder="ข้อความนี้จะแสดงในประวัติออเดอร์"/);
});

test("POS help flips side instead of being clipped by the work panel edge", () => {
  // The (i) next to "วันรับของ" sits at the right edge of the deposit tab on a 1024px
  // screen; a left-anchored 310px popover was cut by the panel's overflow.
  const help = source.slice(source.indexOf("function PosHelp("), source.indexOf("const LAST_RECEIPT_KEY"));
  assert.ok(help.length > 0, "PosHelp body not found");
  assert.ok(/className=\{`pos-help pos-help--\$\{placement\}`\}/.test(help), "class must follow the measured placement, not the static align");
  assert.ok(/clippingBoundsOf\(details\)/.test(help), "placement must be measured against the clipping ancestor");
  assert.ok(/!fitsLeft && fitsRight\) setPlacement\("right"\)/.test(help), "left-anchored help must flip when it would overflow");
  assert.ok(/overflowX !== "visible"/.test(source), "clipping ancestor is the first non-visible overflow-x box");
});
