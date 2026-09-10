// =============================================================
// /pos/restaurant — สัญญาความอ่านออกของการ์ดเมนู
// -------------------------------------------------------------
// ไม่ต้องมี DB · ตรึงสิ่งที่ผู้ใช้รายงานจากหน้าร้านจริง 2026-09-10 ("ชื่อกับราคามองไม่ค่อยชัด")
// แล้วแก้ไป — ทั้งสามข้อเป็นเรื่องที่ถอยกลับได้เงียบ ๆ เพราะไม่มีอะไรพังตอนคอมไพล์:
//
//   1. ช่องข้อความต้องมีพื้นของตัวเอง (ชื่อ/ราคาลอยบนขาวเปล่าที่กลืนกับพื้นการ์ด)
//      และพื้นนั้นต้องมาจาก --quiet **ห้ามเป็น --tint-* ตามสถานี** เพราะพื้นสถานีอยู่ที่
//      .dishArt แล้ว การทาซ้ำที่ช่องข้อความทำให้พื้นที่มีสีต่อการ์ดเพิ่มเท่าตัว แล้วกริด
//      40-50 ใบกลายเป็นแถบสีทั้งจอ (กับดักเดิมที่คอมเมนต์ของ --tint-* จดไว้เอง)
//   2. ราคาต้องเป็นตัวเลขที่ใหญ่ที่สุดในการ์ดเสมอ — ทั้งจอปกติและจอมือถือ
//   3. ความสูงของชื่อต้องเป็นหน่วย em ไม่ใช่ px — ไม่งั้นวันที่มีคนขยับขนาดฟอนต์
//      การ์ดในแถวเดียวกันจะสูงไม่เท่ากันแล้วขอบล่างไม่ตรง
//
//   cd apps/web && npx tsx --test ../../scripts/menu-card-legibility-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const CSS = "apps/web/app/(pos)/pos/restaurant/restaurant.module.css";

/** ⚠️ ตัดเฉพาะคอมเมนต์ของ CSS — ห้ามใช้ตัวกวาดที่ตัด `--...` ท้ายบรรทัดแบบของ SQL
 *  ไม่งั้น `background: var(--quiet)` จะถูกกลืนไปทั้งบรรทัดแล้วเทสแดงด้วยเหตุผลผิด */
const cssWithoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

/** ดึงเนื้อในของกฎที่ selector เป็น **ตัวมันเองล้วน ๆ** (ต้นบรรทัด) หลังตำแหน่งที่กำหนด
 *  ⚠️ ห้ามใช้ indexOf(".dishName {") ตรง ๆ — มันไปเจอ `.dishCardUnavailable .dishName {`
 *  ก่อน แล้วเทสจะไปวัดกฎของการ์ดที่ปิดขายแทนการ์ดปกติ (กับดัก substring เดิมของรีโปนี้) */
function rule(css: string, selector: string, from = 0): string {
  const re = new RegExp(`^[ \t]*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m");
  const rest = css.slice(from);
  const m = re.exec(rest);
  assert.ok(m, `ไม่พบกฎ ${selector} (ต้องเป็น selector เดี่ยวที่ต้นบรรทัด)`);
  const open = from + m!.index + m![0].length - 1;
  const close = css.indexOf("}", open);
  assert.notEqual(close, -1, `กฎ ${selector} ไม่มีวงเล็บปิด`);
  return css.slice(open + 1, close);
}

const px = (body: string, prop: string): number => {
  const m = body.match(new RegExp(`${prop}\\s*:\\s*([0-9.]+)px`));
  assert.ok(m, `กฎนี้ต้องประกาศ ${prop} เป็น px — ได้ ${JSON.stringify(body.trim())}`);
  return Number(m![1]);
};

const readCss = () => cssWithoutComments(readFileSync(path.join(ROOT, CSS), "utf8"));

test("ช่องข้อความของการ์ดเมนูมีพื้นจาง ๆ ของตัวเอง และไม่ใช่สีตามสถานี", () => {
  const css = readCss();
  const body = rule(css, ".dishBody");
  const bg = body.match(/background\s*:\s*([^;]+);/);
  assert.ok(bg, ".dishBody ต้องประกาศพื้นหลัง ไม่ใช่ปล่อยให้กลืนกับพื้นการ์ด");
  assert.equal(bg![1].trim(), "var(--quiet)",
    "พื้นช่องข้อความต้องเป็น --quiet ตามหน้าที่ที่พาเลตต์ประกาศไว้ (พื้นที่ถอยหลังในการ์ด) " +
    "— ค่าอื่นแปลว่ามีสีใหม่เข้าระบบหรือใช้ token ผิดหน้าที่");
  assert.doesNotMatch(bg![1], /--tint-/,
    "ห้ามทาช่องข้อความด้วยสีสถานี — พื้นสถานีอยู่ที่ .dishArt แล้ว ทาซ้ำ = กริดกลายเป็นแถบสีทั้งจอ");
});

test("ราคาเป็นตัวเลขที่ใหญ่ที่สุดในการ์ด ทั้งจอปกติและจอมือถือ", () => {
  const css = readCss();
  // จอปกติ
  const name = rule(css, ".dishName");
  const price = rule(css, ".dishPrice");
  assert.ok(px(name, "font-size") >= 15,
    "ชื่อเมนูต้องไม่เล็กกว่า 15px — อักษรไทยมีสระ/วรรณยุกต์ซ้อนบน-ล่าง เล็กกว่านี้หัวตัวอักษรตัน");
  assert.ok(Number(name.match(/font-weight\s*:\s*(\d+)/)?.[1] ?? 0) >= 700,
    "ชื่อเมนูต้องหนาอย่างน้อย 700");
  assert.ok(px(price, "font-size") > px(name, "font-size"),
    "ราคาต้องใหญ่กว่าชื่อ — เป็นตัวเลขที่คนกดตัดสินใจเร็วที่สุดในการ์ด");
  assert.ok(Number(price.match(/font-weight\s*:\s*(\d+)/)?.[1] ?? 0) >= 800,
    "ราคาต้องหนาอย่างน้อย 800");

  // จอมือถือ (ค่า override ท้ายไฟล์) — ลำดับต้องไม่กลับหัวเพราะแก้ทีหลังแค่ฝั่งเดียว
  const mq = css.indexOf(".dishGrid { grid-template-columns: repeat(auto-fill, minmax(124px");
  assert.notEqual(mq, -1, "ไม่พบบล็อก override ของจอมือถือ");
  const nameM = rule(css, ".dishName", mq);
  const priceM = rule(css, ".dishPrice", mq);
  assert.ok(px(priceM, "font-size") > px(nameM, "font-size"),
    "จอมือถือ: ราคายังต้องใหญ่กว่าชื่อ");
});

test("ความสูงของชื่อผูกกับขนาดฟอนต์ (em) การ์ดในแถวเดียวกันจึงสูงเท่ากันเสมอ", () => {
  const css = readCss();
  for (const [selector, from] of [
    [".dishName", 0],
    [".dishName", css.indexOf(".dishGrid { grid-template-columns: repeat(auto-fill, minmax(124px")],
  ] as const) {
    const body = rule(css, selector, from);
    assert.match(body, /min-height\s*:\s*[0-9.]+em/,
      "min-height ของชื่อต้องเป็น em — เป็น px แล้วขยับขนาดฟอนต์เมื่อไหร่ ขอบล่างของการ์ดในแถวจะไม่ตรงกัน");
  }
  // การคลิปประกาศที่กฎฐานที่เดียว (บล็อกจอมือถือ override แค่ขนาด) — ถ้าหายไปจากที่นั่น
  // ชื่อจะเหลือบรรทัดเดียวทุกจอ แล้วส่วนที่แยกเมนูออกจากกัน (เช่น "สูตรพิเศษ") หายก่อน
  assert.match(rule(css, ".dishName"), /-webkit-line-clamp\s*:\s*2/);
});
