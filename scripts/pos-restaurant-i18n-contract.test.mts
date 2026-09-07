// =============================================================
// จอเครื่องขายร้านอาหารต้องรองรับสองภาษา — และต้องพิสูจน์ความคืบหน้าได้
// -------------------------------------------------------------
// `i18n-keys-contract` ตรวจได้แค่ว่า **คีย์ที่ถูกเรียก** resolve ได้ทั้ง th/en · มันมองไม่เห็น
// ข้อความไทยที่ยัง hardcode อยู่เลย (โน้ตของ repo เขียนไว้เองว่า "ต้องดูด้วยตา") ผลคือหน้าที่
// แปลไปครึ่งเดียวจะเขียวสนิท และไม่มีอะไรกันการเพิ่มข้อความไทยดิบเข้าไปใหม่
//
// ไฟล์นี้เป็น **ratchet**: นับข้อความไทยที่ผู้ใช้เห็นซึ่งยังไม่ผ่าน t() แล้วบังคับว่าต้องไม่เกิน
// ตัวเลขที่บันทึกไว้ · **แก้ตัวเลขนี้ได้ทางเดียวคือให้น้อยลง** เพิ่มขึ้นเมื่อไรคือถอยหลัง
//
// ที่ไม่นับโดยตั้งใจ:
//   · คอมเมนต์ — เอกสารของไฟล์นี้เป็นภาษาไทยทั้งหมดและต้องอยู่ต่อ
//   · ข้อความที่ server ปฏิเสธมา (describePosFailure / RestaurantCheckError) — เป็นไทยชุดเดียว
//     ที่สองจอขายใช้ร่วมกันโดยตั้งใจ เขียนสองชุดแล้ววันที่แก้ข้างหนึ่ง อีกจอเริ่มโกหกเงียบ ๆ
// =============================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGE = path.join(ROOT, 'apps', 'web', 'app', '(pos)', 'pos', 'restaurant', 'page.tsx');
// ไม่ถือ ฿ เป็นข้อความภาษาไทย — เป็นสัญลักษณ์สกุลเงินที่ต้องอยู่เหมือนกันทั้งสองภาษา
const THAI = /[\u0E01-\u0E3A\u0E40-\u0E5B]/;

/** ตัดคอมเมนต์ทิ้งก่อนนับ — ไม่งั้นเอกสารภาษาไทยของไฟล์จะถูกนับเป็นข้อความบนจอ */
function userVisibleThai(source: string): { doubleQuoted: string[]; template: string[]; jsxText: string[] } {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    [...block].map((char) => (char === '\n' ? '\n' : ' ')).join(''));
  const lines: string[] = [];
  for (let line of noBlocks.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    // ตัดคอมเมนต์ท้ายบรรทัด โดยไม่ตัด // ที่อยู่ในสตริง (เช่น URL)
    let inString = false;
    for (let i = 0; i < line.length - 1; i += 1) {
      if (line[i] === '"') inString = !inString;
      if (!inString && line[i] === '/' && line[i + 1] === '/') { line = line.slice(0, i); break; }
    }
    lines.push(line);
  }
  const code = lines.join('\n');
  const collect = (pattern: RegExp) =>
    [...new Set([...code.matchAll(pattern)].map((match) => match[1].trim()).filter((value) => THAI.test(value)))];
  return {
    doubleQuoted: collect(/"([^"\n]*)"/g),
    template: collect(/`([^`\n]*)`/g),
    jsxText: collect(/>([^<>{}\n]*)</g),
  };
}

/**
 * ⚠️ ตัวเลขนี้ลดได้เท่านั้น
 *
 * ปรับลงทุกครั้งที่แปลอีกส่วนเสร็จ · เป้าคือ 0 = จอนี้ไม่มีข้อความไทยดิบเหลือเลย
 */
const REMAINING_ALLOWED = 0;

test('จอร้านอาหารเดินหน้าเข้าสองภาษาเท่านั้น ไม่ถอยหลัง', () => {
  const found = userVisibleThai(readFileSync(PAGE, 'utf8'));
  const total = new Set([...found.doubleQuoted, ...found.template, ...found.jsxText]).size;
  assert.ok(
    total <= REMAINING_ALLOWED,
    `ข้อความไทยดิบเพิ่มขึ้นเป็น ${total} (เพดาน ${REMAINING_ALLOWED}) — ใช้ t("pos_restaurant.…") แทน`
  );
  if (total < REMAINING_ALLOWED) {
    assert.fail(`เหลือ ${total} แล้ว — ลด REMAINING_ALLOWED ในไฟล์นี้ให้ตรง ไม่งั้นเพดานที่หลวมจะยอมให้ถอยหลังเงียบ ๆ`);
  }
});

test('t ถูกต่อสายจริง และค่าคงที่ที่ถือข้อความรับ t เข้าไป', () => {
  const source = readFileSync(PAGE, 'utf8');
  assert.match(source, /const \{ lang, t \} = useI18n\(\);/);
  // ค่าคงที่ระดับโมดูลที่ถือ label ต้องเป็น factory ที่รับ t — ไม่ใช่เก็บ "คีย์" ไว้แล้วประกอบ
  // ตอนรัน เพราะคีย์ที่ประกอบด้วย template string อยู่นอกสายตาของ i18n-keys-contract
  for (const factory of [/const kitchenLanes = \(t: Translate\)/, /const lineKitchenStates = \(t: Translate\)/]) {
    assert.match(source, factory);
  }
  for (const fn of [/function billHistoryNote\(receipt: RecentReceipt, t: Translate\)/, /t: Translate\r?\n\): \{ key: TableStateKey/]) {
    assert.match(source, fn);
  }
  assert.doesNotMatch(source, /t\(`pos_restaurant\./);
});
