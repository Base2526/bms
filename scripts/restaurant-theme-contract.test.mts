// =============================================================
// /pos/restaurant — สัญญาของธีมสว่าง/มืด
// -------------------------------------------------------------
// ไม่ต้องมี DB · ชุดนี้ตรึงสามอย่างที่พังแล้วไม่มีใครเห็นจนกว่าจะมีคนเปิดจอในที่มืด:
//   1. ทุกสีของหน้านี้ต้องมาจากตัวแปร (สีดิบ = สีที่ค้างสว่างในโหมดมืด)
//   2. พาเลตต์สองชุดต้องประกาศชื่อตัวแปรชุดเดียวกัน (ขาดตัวไหน = ค่าโหมดสว่างรั่วเข้ามา)
//   3. คู่สีที่คนต้องอ่านจริงต้องผ่านเกณฑ์ contrast ที่วัดได้ ไม่ใช่ "ดูแล้วโอเค"
//
// เกณฑ์ข้อ 3 คำนวณจาก WCAG 2.x relative luminance ตรง ๆ — โหมดมืดถูกออกแบบด้วยตัวเลข
// ชุดนี้ (ผ่าน 46/47 คู่) ส่วนโหมดสว่างเป็นของเดิมที่ตกอยู่ก่อนแล้วหลายคู่ จึงตรึงไว้
// แค่ว่า **ห้ามแย่ลงกว่าเดิม** ไม่ใช่บังคับให้ผ่านทั้งหมด (การไปแก้ = redesign คนละงาน)
//
//   cd apps/web && npx tsx --test ../../scripts/restaurant-theme-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const CSS = "apps/web/app/(pos)/pos/restaurant/restaurant.module.css";
const PAGE = "apps/web/app/(pos)/pos/restaurant/page.tsx";
const ASSISTANT = "apps/web/components/work-assistant/PosGuideAssistant.tsx";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** ดึงบล็อกประกาศตัวแปรของพาเลตต์หนึ่งชุด (ตัวแรกที่ selector ตรง) */
function palette(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `ไม่พบพาเลตต์ ${selector}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const srgb = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
function luminance(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function contrast(a: string, b: string) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** คู่ที่คนต้องอ่านจริง — [ตัวหน้า, พื้นหลัง, เกณฑ์] */
const PAIRS: Array<[string, string, number]> = [
  ["--ink", "--panel", 7], ["--ink", "--ground", 7], ["--ink", "--quiet", 7],
  ["--ink-2", "--panel", 4.5], ["--ink-2", "--panel-2", 4.5],
  ["--ink-3", "--panel", 3],
  ...(["--accent", "--red", "--amber", "--green", "--grey"] as const).flatMap(
    (c): Array<[string, string, number]> => [
      [c, "--panel", 4.5],
      [c, "--panel-2", 4.5],
      ["--on-solid", c, 4.5],
      [c, "--panel", 3],
    ]
  ),
  ["--red", "--red-bg", 4.5], ["--ink", "--red-bg", 7],
  ["--amber", "--amber-bg", 4.5], ["--ink", "--amber-bg", 7],
  ["--accent", "--green-bg", 4.5], ["--green", "--green-bg", 4.5], ["--ink", "--green-bg", 7],
  ...(["--tint-1", "--tint-2", "--tint-3", "--tint-4"] as const).flatMap(
    (t): Array<[string, string, number]> => [["--ink", t, 7], ["--ink-2", t, 4.5]]
  ),
];

test("ทุกสีของจอร้านอาหารมาจากตัวแปร ไม่มีสีดิบหลงเหลือ", async () => {
  const css = await read(CSS);
  // ตัดคอมเมนต์ + บรรทัดที่ *ประกาศ* ตัวแปรออก แล้วต้องไม่เหลือสีดิบเลย
  const body = stripComments(css).replace(/^\s*--[a-z0-9-]+:.*$/gm, "");
  const raw = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|(?<![-\w])(?:white|black)(?![-\w])/g)]
    .map((m) => m[0]);
  assert.deepEqual(raw, [],
    `สีดิบทำให้โหมดมืดค้างสว่าง — ย้ายเข้าพาเลตต์ก่อน: ${raw.join(", ")}`);
});

test("พาเลตต์สว่างกับมืดประกาศตัวแปรชุดเดียวกันครบ", async () => {
  const css = stripComments(await read(CSS));
  const light = palette(css, ".page {");
  const dark = palette(css, ":global(html.dark) .page,");
  const own = Object.keys(light).filter((k) => !k.startsWith("--pos-"));
  const missing = own.filter((k) => !(k in dark));
  assert.deepEqual(missing, [],
    `ตัวแปรที่โหมดมืดไม่ได้ประกาศจะใช้ค่าของโหมดสว่างต่อ: ${missing.join(", ")}`);

  // pos.css ทาสีปุ่ม/ช่องกรอกจากตัวแปรชุดของมันเอง (0,1,1 ชนะคลาสของโมดูล)
  // ถ้าโหมดมืดไม่ override ปุ่มที่หน้านี้ไม่ได้ทาสีเองจะขาวโพลนบนพื้นมืด
  for (const v of ["--pos-surface", "--pos-text", "--pos-sunken", "--pos-line-strong", "--pos-bg"]) {
    assert.ok(v in dark, `โหมดมืดต้อง override ${v} ของ pos.css`);
  }
});

test("คู่สีที่ต้องอ่านจริงผ่านเกณฑ์ contrast — และโหมดมืดต้องไม่แย่กว่าโหมดสว่าง", async () => {
  const css = stripComments(await read(CSS));
  const light = palette(css, ".page {");
  const dark = palette(css, ":global(html.dark) .page,");
  const resolve = (pal: Record<string, string>, name: string) => {
    const v = pal[name];
    assert.ok(v && v.startsWith("#"), `${name} ต้องเป็นค่าสีตรง ๆ (ได้ ${v})`);
    return v;
  };
  const failures: string[] = [];
  for (const [fg, bg, need] of PAIRS) {
    const dv = contrast(resolve(dark, fg), resolve(dark, bg));
    const lv = contrast(resolve(light, fg), resolve(light, bg));
    // โหมดมืดต้องผ่านเกณฑ์ · ยกเว้นคู่ที่โหมดสว่างก็ไม่ผ่านอยู่แล้ว ซึ่งขอแค่ "ไม่แย่ลง"
    if (dv < need && !(lv < need && dv >= lv)) {
      failures.push(`${fg} บน ${bg}: มืด ${dv.toFixed(2)} · สว่าง ${lv.toFixed(2)} (ต้อง ${need})`);
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("กฎที่ต้องชนะ globals.css ต้องมี html.dark นำหน้า", async () => {
  const css = stripComments(await read(CSS));
  // globals.css: `html.dark .ant-modal-content` = (0,2,1) ชนะ `.page .ant-modal-content` = (0,2,0)
  for (const part of ["ant-modal-content", "ant-modal-header", "ant-modal-title"]) {
    assert.match(css, new RegExp(`:global\\(html\\.dark\\) \\.page :global\\(\\.${part}\\)`),
      `${part} ต้องมีกฎที่ขึ้นต้นด้วย html.dark ไม่งั้นโหมดมืดใช้พื้นของ globals.css`);
  }
});

test("สีที่ประกาศใน page.tsx ต้องเป็นตัวแปร ไม่ใช่ค่าคงที่", async () => {
  const page = stripComments(await read(PAGE));
  const lanes = page.slice(page.indexOf("const LANES = ["), page.indexOf("] as const;", page.indexOf("const LANES = [")));
  assert.doesNotMatch(lanes, /#[0-9a-fA-F]{3,8}/,
    "สีเลนจอครัวถูกใช้เป็นสีตัวหนังสือของ .ticketQty ด้วย — ค่าคงที่จะอ่านไม่ออกในโหมดมืด");
  assert.equal([...lanes.matchAll(/color: "var\(--[a-z-]+\)"/g)].length, 4);

  const tints = page.slice(page.indexOf("const MENU_CARD_TINTS"), page.indexOf("];", page.indexOf("const MENU_CARD_TINTS")));
  // การ์ดเมนูคือพื้นที่ตากวาดผ่าน 40 ใบต่อจอ ห้ามใช้พื้นของกล่องเตือน (--*-bg) ซึ่งต้องดัง
  assert.doesNotMatch(tints, /--(red|amber|green)-bg/,
    "สีการ์ดเมนูต้องใช้ --tint-* ไม่ใช่พื้นของกล่องเตือน");
  assert.equal([...tints.matchAll(/var\(--tint-[1-4]\)/g)].length, 4);
});

test("แผ่นผู้ช่วยคู่มืออ่านตัวแปรของหน้าพร้อมค่าสำรองของจอค้าปลีก", async () => {
  const src = stripComments(await read(ASSISTANT));
  // เรนเดอร์อยู่ใน react tree ของหน้าร้านอาหาร (ไม่ portal) จึงรับตัวแปรของโมดูลได้
  // · ค่าสำรองคือค่าเดิมเป๊ะ ๆ สำหรับ /pos ที่ยังไม่ได้ทำโหมดมืด
  assert.match(src, /background: "var\(--panel, #fff\)"/);
  assert.match(src, /color: "var\(--ink, #1f1f1f\)"/);
  assert.doesNotMatch(src, /background: "#fff"/,
    "พื้นแผ่นห้ามเป็นสีคงที่ ไม่งั้นโหมดมืดได้แผ่นขาวเต็มจอ");
});
