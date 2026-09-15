import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * ⚠️ `ScrollView`/`FlatList` ของ React Native ตั้ง **`flexGrow: 1`** ให้เองทั้งแนวตั้งและแนวนอน
 * (`Libraries/Components/ScrollView/ScrollView.js` → `baseHorizontal`)
 *
 * แถบแนวนอนที่วางอยู่ในคอลัมน์ซึ่ง "มีความสูงแน่นอน" จึงไปแย่งพื้นที่กับพี่น้องที่เป็น `flex: 1`
 * แล้วแบ่งจอกันคนละครึ่ง — ไม่มี error ไม่มี warning เห็นได้ต่อเมื่อมีคนเปิดดูจริง
 *
 * อาการจริงจากไอแพด 2026-09-15 (`/pos/restaurant` ผังโต๊ะบน RN):
 * บิลกลับบ้าน **ใบเดียว** กินครึ่งจอบน · ผังโต๊ะถูกบีบลงครึ่งล่างและถูกย่อสเกลตามไปด้วย
 * (สเกลของผังคิดจาก `onLayout` ของกล่องผัง) · การ์ดบิลถูกยืดเป็นเสาสูงเพราะ content container
 * แนวนอนของ RN ตั้ง `alignItems: stretch`
 *
 * กฎ: แถบแนวนอนทุกตัวต้อง **ประกาศ `flexGrow` เอง** — 0 สำหรับแถบชิป/แถบการ์ด,
 * 1 สำหรับตัวเลื่อนที่ตั้งใจให้กินพื้นที่ที่เหลือ · การรอดเพราะพ่อบังเอิญสูงตามเนื้อหา ไม่ใช่เจตนา
 * และจะพังเงียบ ๆ วันที่มีคนใส่ `flex: 1` ให้พ่อ
 */

const MOBILE_SRC = fileURLToPath(new URL("../apps/mobile/src", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/**
 * อ่านแท็กเปิดตั้งแต่ `<Tag` จนถึง `>` ที่อยู่นอกวงเล็บปีกกา (prop ของ JSX มี `{...}` ซ้อนได้)
 * แล้วคืนมาแบบ **ตัดคอมเมนต์ออกแล้ว**
 *
 * ⚠️ ต้องตัดคอมเมนต์ ไม่งั้นคอมเมนต์ที่อธิบายกฎเอง ("RN ตั้ง flexGrow: 1 มาให้") ถูกนับเป็นสไตล์จริง
 * — เจอมาแล้วตอนรันรอบแรก: แถบที่เป็น flexGrow: 0 ถูกนับเป็น flexGrow: 1 ทั้งสามตัว
 */
function openingTag(source: string, start: number): string {
  let depth = 0;
  let out = "";
  for (let i = start; i < source.length; i += 1) {
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    const char = source[i];
    out += char;
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return out;
  }
  return out;
}

test("แถบแนวนอนทุกตัวประกาศ flexGrow เอง ไม่พึ่งค่าปริยาย flexGrow: 1 ของ RN", () => {
  const offenders: string[] = [];
  let checked = 0;

  for (const file of walk(MOBILE_SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<(ScrollView|FlatList)\b/g)) {
      const tag = openingTag(source, match.index);
      if (!/(^|\s)horizontal(\s|=|\n|$)/.test(tag)) continue;
      checked += 1;
      if (/flexGrow:\s*[01]\b/.test(tag)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(
        `${path.relative(MOBILE_SRC, file)}:${line} <${match[1]} horizontal>`
      );
    }
  }

  assert.ok(checked > 0, "ตัวสแกนหาแถบแนวนอนไม่เจอสักตัว — แปลว่าตัวสแกนพัง ไม่ใช่โค้ดสะอาด");
  assert.deepEqual(
    offenders,
    [],
    `แถบแนวนอนที่ไม่ได้ประกาศ flexGrow (RN จะให้ flexGrow: 1 แล้วไปแย่งที่กับพี่น้องที่เป็น flex: 1):\n${offenders.join("\n")}`
  );
});

test("ผังโต๊ะ: แถบบิลกลับบ้านและแถบเลือกโซนต้องไม่กินพื้นที่ของผัง", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../apps/mobile/src/screens/floor/FloorScreen.tsx", import.meta.url)),
    "utf8"
  );

  // กล่องผังต้องยังเป็นตัวเดียวที่กินพื้นที่ที่เหลือ และต้องวัดความสูงจริงส่งให้สเกลของผัง
  assert.ok(
    /style=\{\{ flex: 1, marginTop: spacing\.md \}\}\s*\n\s*onLayout/.test(source),
    "กล่องผังโต๊ะต้องเป็น flex: 1 และรายงานความสูงจริงผ่าน onLayout (สเกลของผังคิดจากค่านี้)"
  );

  const strips = [...source.matchAll(/<ScrollView\b/g)]
    .map((match) => openingTag(source, match.index))
    .filter((tag) => /horizontal/.test(tag));
  assert.equal(strips.length, 3, "ผังโต๊ะมีแถบแนวนอน 3 ตัว: บิลกลับบ้าน · เลือกโซน · ตัวเลื่อนผัง");
  assert.equal(
    strips.filter((tag) => /flexGrow:\s*0\b/.test(tag)).length,
    2,
    "แถบบิลกลับบ้านและแถบเลือกโซนต้องเป็น flexGrow: 0 ทั้งคู่"
  );
  assert.equal(
    strips.filter((tag) => /flexGrow:\s*1\b/.test(tag)).length,
    1,
    "ตัวเลื่อนผังโต๊ะต้องเป็น flexGrow: 1 — มันคือตัวที่ควรกินพื้นที่ที่เหลือ"
  );
});
