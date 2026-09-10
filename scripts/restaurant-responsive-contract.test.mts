import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * เลย์เอาต์ของ `/pos/restaurant` ที่จอแคบ — ตรึงสิ่งที่ **วัดจริงในเบราว์เซอร์** แล้วพบว่าพัง
 * (2026-09-10 · ไล่ 12 ความกว้าง 320–1440 บนทั้ง 8 จอและกล่องโมดัลทุกใบ)
 *
 * เทสนี้สแกนซอร์ส เพราะรีโปนี้ไม่มี harness ที่วัดเรขาคณิตจริงใน CI (ชุด pure ไม่มีเบราว์เซอร์)
 * ที่ตรึงได้จึงเป็น "กติกาที่ทำให้เรขาคณิตถูก" ไม่ใช่ตัวเลขพิกเซล — ทุกข้อผูกกับอาการที่วัดมาแล้ว
 *
 * ⚠️ ต้องตัดคอมเมนต์ก่อนสแกนทุกครั้ง — คอมเมนต์ในไฟล์นั้นอ้างถึงรูปแบบที่เทสนี้ห้ามไว้เอง
 *   (เช่นอธิบายว่าเดิมเป็น `minmax(260px, 1fr)`) การไม่ตัดจะทำให้แดงด้วยเหตุผลผิด
 * ⚠️ ไฟล์เป็น CRLF — ต้อง split ด้วย /\r?\n/ หรือใช้แฟลก m ไม่งั้น `$` ไปอยู่หลัง \r
 *   แล้ว regex ไม่แมตช์เลย (กับดักเดิมของรีโปนี้ ดู § ตัวกวาดคอมเมนต์พังกับไฟล์ CRLF)
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const CSS_PATH = "apps/web/app/(pos)/pos/restaurant/restaurant.module.css";
const raw = readFileSync(path.join(ROOT, CSS_PATH), "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

/** คืนตัวรูปทรง `selector { body }` ทุกก้อน (ตัดคอมเมนต์แล้ว) รวมก้อนใน @media */
function rules(text: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}@][^{}]*)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    out.push({
      selector: match[1].split(/\r?\n/).join(" ").replace(/\s+/g, " ").trim(),
      body: match[2].split(/\r?\n/).join(" ").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}
const ALL = rules(css);
function ruleFor(selector: string) {
  const hit = ALL.filter((r) => r.selector.split(",").map((s) => s.trim()).includes(selector));
  assert.ok(hit.length > 0, `หา selector ไม่เจอ: ${selector} — anchor ของเทสเลื่อน ไม่ใช่โค้ดถูก`);
  return hit;
}
/**
 * รวม body ของทุกกฎที่เล็ง selector นี้ — selector หนึ่งตัวถูกประกาศได้หลายกฎ
 * (เช่น `.qrDetailHead, .qrTotal, .qrActions` ตั้ง display แล้วอีกกฎเติม flex-wrap ทีหลัง)
 * เทสที่อ่านแค่กฎแรกจะแดงด้วยเหตุผลผิด ซึ่งเป็นกับดัก anchor เดิมของรีโปนี้
 */
function bodyFor(selector: string) {
  return ruleFor(selector).map((r) => r.body).join(" ");
}

test("ปุ่มไอคอนห้ามถูกบีบโดย flex sibling", () => {
  // วัดจริงที่ 320px ก่อนแก้: ปุ่ม ⋯ ของแผงบิล (.checkHeadRow) หดเหลือ 28px
  // ซึ่งเป็นปุ่มที่ถือ "ย้ายโต๊ะ / ยกเลิกบิล" ไว้ — เป้าแตะที่กดไม่โดนเท่ากับไม่มีปุ่ม
  const [rule] = ruleFor(".page .btnIcon");
  assert.match(rule.body, /flex:\s*none/, ".page .btnIcon ต้องประกาศ flex: none");
  // .page นำหน้าเสมอ เพราะ `:where(.pos-root) button:not(.ant-btn)` เป็น (0,1,1)
  assert.ok(rule.selector.startsWith(".page "), "กฎของปุ่มต้องมี .page นำหน้า");
});

test("รางเลนจอครัวต้องกว้างพอสำหรับตั๋วหนึ่งใบ ไม่ใช่บีบตั๋วให้พอราง", () => {
  // วัดจริงที่ 960px ก่อนแก้: minmax(210px, 1fr) ทำให้เลนเหลือ ~212px แล้วตั๋วล้นออกนอกกล่อง
  // (ชื่อเมนู 29px · แถวปุ่ม 5px · หัวตั๋ว 4px) · กระดานยอมให้เลื่อนข้างอยู่แล้ว
  const [rule] = ruleFor(".lanes");
  const minmax = /minmax\(\s*(\d+)px\s*,\s*1fr\s*\)/.exec(rule.body);
  assert.ok(minmax, ".lanes ต้องยังเป็น minmax(<px>, 1fr)");
  assert.ok(
    Number(minmax![1]) >= 260,
    `รางขั้นต่ำของเลนต้องไม่ต่ำกว่า 260px (พบ ${minmax![1]}px) — ต่ำกว่านี้ตั๋วล้นกล่อง`
  );
  assert.match(rule.body, /overflow-x:\s*auto/, "เลื่อนข้างต้องยังทำได้ ไม่งั้นเลนที่เกินจอหายไปเลย");
});

test("input ที่ซ่อนไว้ในกล่องเมนูต้องชนะ .modalGrid input ได้", () => {
  // ⚠️ `.modalGrid input` (0,1,1) ในไฟล์เดียวกันตั้ง width: 100% → ชนะคลาสเดี่ยว ๆ (0,1,0)
  // ก่อนแก้ (วัดจริง): input ที่ควรเป็น 1x1 เรนเดอร์ 374x44 แบบ absolute เทียบ .ant-modal-content
  // แล้วยื่นพ้นกล่อง 195px → .ant-modal-wrap เลื่อนข้างได้จริง 187px = ปัดนิ้วแล้วกล่องไถลออกนอกจอ
  const modalInput = ALL.find((r) => /(^|,\s*)\.modalGrid input(\s|,|$)/.test(r.selector));
  assert.ok(modalInput, "ไม่พบ .modalGrid input — เหตุผลของกฎนี้เปลี่ยนไปแล้ว ให้ทบทวนเทส");
  assert.match(modalInput!.body, /width:\s*100%/, ".modalGrid input ยังตั้ง width: 100% อยู่จริง");

  const hit = ALL.filter((r) => r.selector.includes(".modifierChipInput"));
  assert.equal(hit.length, 1, "กฎของ .modifierChipInput ต้องมีที่เดียว");
  const classCount = (hit[0].selector.match(/\.[A-Za-z][\w-]*/g) ?? []).length;
  assert.ok(
    classCount >= 2,
    `selector ของ .modifierChipInput ต้องมีคลาสอย่างน้อย 2 ตัวถึงจะชนะ (0,1,1) (พบ ${classCount})`
  );
  assert.match(hit[0].body, /width:\s*1px/, "ต้องยังเป็น 1x1");
  // min-height ชนะ height ไม่ว่า specificity เป็นอย่างไร — `.pos-root input` ตั้งไว้ 44px
  assert.match(hit[0].body, /min-height:\s*0/, "ต้องล้าง min-height: 44px ของ pos.css ด้วย");
});

test("แถวปุ่มที่มีหลายปุ่มต้องตกบรรทัดได้ ไม่ใช่ดันปุ่มพ้นกล่อง", () => {
  // .queueActions — วัดจริงที่ 320px: สามปุ่มต้องการ 235px ในกล่อง 208px แล้ว "ยกเลิก" พ้นการ์ด
  for (const selector of [".queueActions", ".qrActions"]) {
    // .qrActions — space-between + ห้ามตกบรรทัด = ปุ่มซ้ายไปอยู่ที่ left -28px ซึ่งเลื่อนไปหาไม่ได้เลย
    const body = bodyFor(selector);
    assert.match(body, /flex-wrap:\s*wrap/, `${selector} ต้องตกบรรทัดได้`);
    assert.doesNotMatch(body, /flex-wrap:\s*nowrap/, `${selector} ต้องไม่มีกฎที่สั่งห้ามตกบรรทัดค้างอยู่`);
  }
  const qrBtn = { body: bodyFor(".qrActions .btn") };
  const minWidth = /min-width:\s*(\d+)px/.exec(qrBtn.body);
  assert.ok(
    !minWidth || Number(minWidth[1]) === 0,
    `.qrActions .btn ห้ามตั้ง min-width เป็น px (พบ ${minWidth?.[1]}px) — เพดานล่างที่หดไม่ได้คือสิ่งที่ดันปุ่มออกนอกกล่อง`
  );
  assert.match(qrBtn.body, /flex:\s*1\s+1\s+\d+px/, "ให้โตได้เมื่อมีที่ และตกบรรทัดเมื่อไม่มี");
});

test("กริด auto-fill ทุกอันต้องยอมแคบกว่ารางขั้นต่ำของตัวเอง", () => {
  // `minmax(240px, 1fr)` เฉย ๆ ยืนกราน 240px แม้กล่องกว้าง 232px = ล้นออกข้าง
  // (วัดจริงที่ 320px: .receiptGrid ล้น 8px · .serviceCallGrid ล้น 28px)
  const offenders: string[] = [];
  for (const rule of ALL) {
    const re = /repeat\(\s*auto-(?:fill|fit)\s*,\s*minmax\(([^,]+),/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rule.body))) {
      const min = m[1].trim();
      if (/^\d+px$/.test(min)) offenders.push(`${rule.selector} → minmax(${min}, …)`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `ต้องใช้ minmax(min(<px>, 100%), 1fr):\n${offenders.join("\n")}`
  );
  // ยืนยันว่าสองอันที่แก้ไปแล้วยังอยู่ในรูปที่ถูก (กันการ "แก้" ด้วยการลบกริดทิ้ง)
  assert.match(ruleFor(".receiptGrid")[0].body, /minmax\(min\(240px,\s*100%\),\s*1fr\)/);
  assert.match(ruleFor(".serviceCallGrid")[0].body, /minmax\(min\(260px,\s*100%\),\s*1fr\)/);
});

test("แผงบิลที่จอแคบมากต้องคืนความกว้างให้ชื่อเมนู", () => {
  // วัดจริงที่ 320px ก่อนแก้: คอลัมน์ชื่อเหลือ 54px และแถวสูง 387px ต่อหนึ่งรายการ
  // (ชื่อไทยตกบรรทัดละ 1-2 ตัวอักษร) เพราะ .itemSide กินคอลัมน์ที่สามตาม min-content
  const blocks = css.split(/@media\s*\(max-width:\s*(\d+)px\)/);
  const widths: number[] = [];
  for (let i = 1; i < blocks.length; i += 2) widths.push(Number(blocks[i]));
  assert.ok(widths.includes(460), "ต้องมีบล็อก @media (max-width: 460px) สำหรับแผงบิล");

  // ⚠️ ลำดับสำคัญ: specificity เท่ากัน ตัวที่อยู่หลังชนะ — ช่วงแคบต้องอยู่ท้ายไฟล์
  const narrowing = widths.filter((_, i) => i > 0).every((w, i) => w < widths[i]);
  assert.ok(narrowing, `@media ต้องเรียงจากกว้างไปแคบ พบลำดับ ${widths.join(" > ")}`);

  const idx = blocks.findIndex((part, i) => i % 2 === 1 && Number(part) === 460);
  const body = blocks[idx + 1];
  const inner = rules(body);
  const item = inner.find((r) => r.selector === ".item");
  const side = inner.find((r) => r.selector === ".itemSide");
  assert.ok(item && side, "บล็อก 460px ต้องแก้ทั้ง .item และ .itemSide");
  assert.match(item!.body, /grid-template-columns:\s*28px\s+minmax\(0,\s*1fr\)/, ".item ต้องเหลือ 2 คอลัมน์");
  assert.match(side!.body, /grid-column:\s*1\s*\/\s*-1/, ".itemSide ต้องลงไปกินแถวของตัวเองเต็มความกว้าง");
});
