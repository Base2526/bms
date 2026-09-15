import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * ตะกร้าของ POS มือถือ: บรรทัดถูกระบุด้วย `line.key` (sku + ไซซ์ + หน่วยขาย + ตัวเลือก)
 * ไม่ใช่ด้วย `sku` — การ์ดสินค้าใบเดียวแทนทุกไซซ์ sku จึงไม่ใช่ตัวระบุบรรทัด
 *
 * อาการจริงจากไอแพด 2026-09-14 (สั่งสินค้าตัวเดียวกันสามไซซ์):
 *   · React เตือน duplicate key เพราะ FlatList คีย์ด้วย sku
 *   · การ์ดโชว์จำนวน 1 ทั้งที่ตะกร้ามี 3 (qtyBySku เขียนทับแทนบวกสะสม)
 *   · สามบรรทัดเขียนชื่อเหมือนกันหมด ไม่บอกว่าไซซ์ไหน
 *   · กด − ที่บรรทัดเดียว **ลบทิ้งทั้งสามบรรทัด** (decrementItem แมตช์ด้วย sku)
 *
 * ⚠️ ต้องเป็น dynamic import — apps/mobile ไม่ได้ประกาศ "type": "module" ไฟล์จึงถูก tsx
 * แปลงเป็น CJS และ static named import ล้มตอน link ("does not provide an export named")
 */
const { cartLineKey, cartLineVariantLabel } = (await import(
  "../apps/mobile/src/lib/cartLine.ts"
)) as typeof import("../apps/mobile/src/lib/cartLine.ts");

function read(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(`../${relative}`, import.meta.url)),
    "utf8"
  );
}

/** ตัดคอมเมนต์ออกก่อนสแกน — คอมเมนต์ที่อธิบายรูปแบบเก่าจะถูกจับเป็นของจริง */
function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * ⚠️ ห้ามใช้ assert.match/doesNotMatch กับซอร์สทั้งไฟล์ — ตอนแดง node จะพิมพ์ทั้งไฟล์ลง
 * รายงานจนอ่านอะไรไม่ออก (เจอมาแล้วตอน mutation test) · ด่านที่อ่านไม่ออกตอนแดง = ด่านที่ถูกเมิน
 */
function assertHas(source: string, pattern: RegExp, message: string) {
  assert.ok(pattern.test(source), message);
}
function assertLacks(source: string, pattern: RegExp, message: string) {
  assert.ok(!pattern.test(source), message);
}

function slice(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `ไม่พบ ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `ไม่พบ ${endMarker} หลัง ${startMarker}`);
  return source.slice(start, end);
}

const CART_SCREENS = [
  "apps/mobile/src/screens/sell/MenuScreen.tsx",
  "apps/mobile/src/screens/sell/CheckoutScreen.tsx",
];

/** จอที่แสดง "บรรทัดที่ลูกค้าสั่งไปแล้ว" — บิลโต๊ะของร้านอาหารเป็นอาการเดียวกันคนละจอ */
const LINE_LIST_SCREENS = [
  ...CART_SCREENS,
  "apps/mobile/src/screens/floor/CheckDetailScreen.tsx",
];

test("คีย์ของบรรทัดแยกทุกอย่างที่ทำให้ราคา/ของที่ลูกค้าได้ต่างกัน", () => {
  // เรียกของจริง ไม่ใช่สแกนซอร์ส — "มีคำว่า modifierCodes อยู่ในไฟล์" เขียวได้แม้ถอดออกจากคีย์แล้ว
  assert.notEqual(
    cartLineKey({ sku: "A", size: "S" }),
    cartLineKey({ sku: "A", size: "M" }),
    "ไซซ์ต่างกันต้องเป็นคนละบรรทัด"
  );
  assert.notEqual(
    cartLineKey({ sku: "A", size: "S", packCode: "BOX" }),
    cartLineKey({ sku: "A", size: "S", packCode: "" }),
    "หน่วยขายต่างกันต้องเป็นคนละบรรทัด"
  );
  assert.notEqual(
    cartLineKey({ sku: "TEA", size: "S", modifierCodes: ["SWEET_LOW"] }),
    cartLineKey({ sku: "TEA", size: "S", modifierCodes: ["SWEET_NORMAL"] }),
    "ตัวเลือกต่างกันต้องเป็นคนละบรรทัด — ราคาและของที่ลูกค้าได้ต่างกัน"
  );
  assert.equal(
    cartLineKey({ sku: "TEA", modifierCodes: ["B", "A"] }),
    cartLineKey({ sku: "TEA", modifierCodes: ["A", "B"] }),
    "ลำดับที่แคชเชียร์แตะตัวเลือกไม่ใช่ข้อมูล"
  );
  assert.equal(
    cartLineKey({ sku: "A", size: "S", packCode: "BOX" }),
    cartLineKey({ sku: "A", size: "S", packCode: "BOX" }),
    "ของเดิมทุกอย่างต้องรวมบรรทัด ไม่ใช่แตกจนตะกร้ารก"
  );
});

test("ป้ายรุ่นเงียบเมื่อไม่มีอะไรให้แยก และไม่เขียนค่าแทนว่างให้คนอ่าน", () => {
  assert.equal(cartLineVariantLabel({ size: "BASE", unitName: "" }), "");
  assert.equal(cartLineVariantLabel({ size: "-" }), "");
  assert.equal(cartLineVariantLabel({ size: "S", unitName: "S" }), "ขนาด S");
  assert.equal(
    cartLineVariantLabel({
      size: "L",
      unitName: "กล่อง",
      modifierNames: ["หวานน้อย"],
    }),
    "ขนาด L · กล่อง · หวานน้อย"
  );
});

test("ทุกรายการในตะกร้าถูกระบุด้วย line.key ไม่ใช่ sku", () => {
  for (const path of CART_SCREENS) {
    const source = withoutComments(read(path));
    assertLacks(
      source,
      /decrementItem\(\s*(?:cart\.)?\w+\.sku\s*\)/,
      `${path}: decrementItem ต้องรับ line.key — sku แมตช์ได้หลายบรรทัดพร้อมกัน`
    );
    assertLacks(
      source,
      /keyExtractor=\{\s*\(?\w+,?\s*\w*\)?\s*=>\s*[`'"]?\$?\{?\w+\.sku/,
      `${path}: keyExtractor ของตะกร้าต้องไม่ใช้ sku (สินค้าตัวเดียวหลายไซซ์ = คีย์ซ้ำ)`
    );
  }
});

test("บรรทัดตะกร้าบอกได้ว่าเป็นรุ่นไหนของสินค้า", () => {
  for (const path of LINE_LIST_SCREENS) {
    const source = withoutComments(read(path));
    // หาแค่ชื่อฟังก์ชันไม่พอ — เปลี่ยนเงื่อนไขเป็น false แล้วชื่อยังอยู่ในบรรทัดที่ตายแล้ว
    assertHas(
      source,
      /cartLineVariantLabel\(item\)\s*\?\s*\(/,
      `${path}: ต้องมีเงื่อนไขที่ตัดสินว่าจะขึ้นป้ายรุ่นไหม`
    );
    assertHas(
      source,
      /\{cartLineVariantLabel\(item\)\}/,
      `${path}: ป้ายรุ่นต้องถูกเขียนลงจอจริง`
    );
  }
});

test("decrementItem ลดเฉพาะบรรทัดที่ระบุ — ไม่กวาดทุกบรรทัดของ sku เดียวกัน", () => {
  const body = slice(
    withoutComments(read("apps/mobile/src/state/CartContext.tsx")),
    "const decrementItem",
    "const decrementSku"
  );
  assertHas(body, /line\.key === key/, "decrementItem ต้องเทียบ line.key");
  assertLacks(
    body,
    /line\.sku/,
    "decrementItem ห้ามแมตช์ด้วย sku — มันลบทุกไซซ์ของสินค้านั้นพร้อมกัน"
  );
});

test("ปุ่มลดบนการ์ดสินค้ารู้แค่ sku จึงลดบรรทัดเดียว ไม่ใช่ทุกบรรทัด", () => {
  const body = slice(
    withoutComments(read("apps/mobile/src/state/CartContext.tsx")),
    "const decrementSku",
    "const removeLine"
  );
  assertHas(
    body,
    /index === target/,
    "decrementSku ต้องเลือกบรรทัดเป้าหมายก่อน ไม่ใช่ลดทุกบรรทัดที่ sku ตรง"
  );
  assertHas(
    withoutComments(read("apps/mobile/src/screens/sell/MenuScreen.tsx")),
    /onDecrement=\{sku => decrementSku\(sku\)\}/,
    "กริดสินค้าต้องเรียก decrementSku ไม่ใช่ decrementItem(sku)"
  );
});

test("เลขบนการ์ดสินค้าเป็นผลรวมของทุกไซซ์ที่อยู่ในตะกร้า", () => {
  const body = slice(
    withoutComments(read("apps/mobile/src/screens/sell/MenuScreen.tsx")),
    "const qtyBySku",
    "const cartCount"
  );
  assertHas(
    body,
    /map\[l\.sku\]\s*=\s*\(map\[l\.sku\]\s*\?\?\s*0\)\s*\+\s*l\.qty/,
    "qtyBySku ต้องบวกสะสม ไม่ใช่เขียนทับด้วยบรรทัดสุดท้าย"
  );
});

test("คีย์ของบรรทัดมีชุดเดียวทั้งแอป", () => {
  const cart = withoutComments(read("apps/mobile/src/state/CartContext.tsx"));
  assertHas(
    cart,
    /import \{ cartLineKey \} from '\.\.\/lib\/cartLine'/,
    "CartContext ต้องใช้ตัวคิดคีย์กลาง"
  );
  assertLacks(
    cart,
    /`\$\{item\.sku\}:\$\{item\.size\}:\$\{item\.packCode\}`/,
    "ห้ามประกอบคีย์เองในไฟล์นี้ — ตัวเลือกจะหายจากคีย์แล้วสองรุ่นยุบเป็นบรรทัดเดียว"
  );
});

test("กดเพิ่มจากบรรทัดในตะกร้าต้องกลับไปที่บรรทัดเดิม ไม่ใช่สร้างบรรทัดใหม่", () => {
  for (const path of CART_SCREENS) {
    assertHas(
      withoutComments(read(path)),
      /selectedModifierCodes: item\.modifierCodes/,
      `${path}: ปุ่ม + ต้องส่งตัวเลือกเดิมกลับไป ไม่งั้นคีย์ไม่ตรงแล้วได้บรรทัดที่สอง`
    );
  }
});
