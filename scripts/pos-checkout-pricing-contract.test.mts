import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  cashRoundingDelta,
  cashRoundingForPayments,
} from "../apps/web/lib/pos/cashRounding.ts";
import { cartLineCharge, modifierUnitPriceOf } from "../apps/web/lib/pos/cartCharge.ts";

/**
 * "ยอดที่ต้องเก็บ" ของทุกจอรับเงินต้องเท่ากับที่ `recordPosSale()` คิด
 *
 * server เทียบผลรวมเงินที่จอส่งมากับยอดของตัวเอง ต่างเกิน 1 สตางค์ = ยกเลิกบิลทิ้งทั้งใบ
 * (`PAYMENT_MISMATCH`) ต่อหน้าลูกค้า · จอที่เขียนเงื่อนไขเองคือจุดที่สองสูตรเริ่ม drift
 *
 * สองอย่างที่ไฟล์นี้ตรึงไว้ เพราะเคยหลุดมาแล้วทั้งคู่:
 *   1. ปัดเศษเงินสดเมื่อ **ทุกช่องทาง** เป็นเงินสด — จอร้านอาหารเคยเขียนว่า `length === 1`
 *      แปลว่าบิลที่แบ่งจ่ายเงินสดสองช่องทางจอไม่ปัดแต่ server ปัด
 *   2. ส่วนเพิ่มของตัวเลือก (`price_delta`) เข้ายอดบิล — จอค้าปลีกไม่เคยบวกเลย เพราะ type
 *      ประกาศ `modifiers` ไว้แค่ `{code, name}` พร้อมคอมเมนต์ว่า "มีผลต่อ stock ไม่ใช่ราคา"
 *      ซึ่งเลิกจริงตั้งแต่ 9.45
 */

function read(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(`../${relative}`, import.meta.url)),
    "utf8"
  );
}

function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

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

const REGISTER_SCREENS = [
  "apps/web/app/(pos)/pos/page.tsx",
  "apps/web/app/(pos)/pos/restaurant/page.tsx",
];

test("ปัดเศษเงินสดใช้กฎเดียวกับ recordPosSale", async (t) => {
  await t.test("ปัดเมื่อทุกช่องทางเป็นเงินสด ไม่ใช่เมื่อมีช่องทางเดียว", () => {
    const splitCash = [
      { method: "CASH", amount: 300 },
      { method: "CASH", amount: 100.4 },
    ];
    // ⚠️ เคสที่บั๊กเดิมทำผิด: แบ่งจ่ายเงินสดสองช่องทางต้องยังปัด เพราะ server ปัด
    assert.equal(
      cashRoundingForPayments(400.4, "0.50", splitCash),
      cashRoundingDelta(400.4, "0.50")
    );
    assert.equal(
      cashRoundingForPayments(400.4, "0.50", [
        { method: "CASH", amount: 300 },
        { method: "QR", amount: 100.4 },
      ]),
      0
    );
    assert.equal(cashRoundingForPayments(400.4, "NONE", splitCash), 0);
  });

  await t.test("ยอดที่ยังไม่กรอกไม่ตัดสินแทนวิธีจ่ายที่เลือกไว้", () => {
    // ก่อนพิมพ์ตัวเลข ยอดทุกช่องเป็น 0 → ต้องใช้ "วิธีจ่ายที่เลือกไว้" ตัดสิน
    // ไม่งั้นยอดที่ต้องเก็บกระพริบตอนแคชเชียร์พิมพ์ตัวแรก
    assert.equal(
      cashRoundingForPayments(100.4, "0.50", [{ method: "CASH", amount: 0 }]),
      cashRoundingDelta(100.4, "0.50")
    );
    assert.equal(
      cashRoundingForPayments(100.4, "0.50", [{ method: "QR", amount: 0 }]),
      0
    );
    // ช่องที่กรอกแล้วชนะช่องที่ยังว่าง — บิลที่เริ่มแบ่งจ่ายแล้วไม่ควรถูกปัดจากช่องที่ยังไม่ใช้
    assert.equal(
      cashRoundingForPayments(100.4, "0.50", [
        { method: "QR", amount: 100.4 },
        { method: "CASH", amount: 0 },
      ]),
      0
    );
  });

  await t.test("รับสตริงจากช่องกรอกได้ ไม่ต้องให้จอแปลงเอง", () => {
    assert.equal(
      cashRoundingForPayments(100.4, "0.50", [
        { method: "CASH", amount: "100.40" },
      ]),
      cashRoundingDelta(100.4, "0.50")
    );
  });

  await t.test("ทุกจอรับเงินเรียกกฎกลาง ไม่เขียนเงื่อนไขเอง", () => {
    for (const relative of REGISTER_SCREENS) {
      const source = withoutComments(read(relative));
      assertHas(
        source,
        /cashRoundingForPayments\(/,
        `${relative} ต้องปัดเศษด้วยกฎกลาง`
      );
      // จอที่ตัดสินเองว่า "มีช่องทางเดียวไหม" คือจอที่จะ drift จาก server อีกครั้ง
      assertLacks(
        source,
        /payments\.length === 1 && payments\[0\]\.method === "CASH"/,
        `${relative} กลับไปตัดสินการปัดเศษจากจำนวนช่องทางแล้ว`
      );
    }
  });
});

const chargeLine = (over: Partial<Parameters<typeof cartLineCharge>[0]> = {}) => ({
  packQty: 1,
  baseQty: 1,
  packPrice: 100,
  basePrice: 100,
  modifierCodes: [] as string[],
  modifiers: [] as Array<{ code: string; priceDelta?: number }>,
  ...over,
});

test("ส่วนเพิ่มของตัวเลือกเข้ายอดบิลที่จอค้าปลีก", async (t) => {
  const source = withoutComments(read("apps/web/app/(pos)/pos/page.tsx"));

  await t.test("ราคาต่อหน่วยของบรรทัดรวมส่วนเพิ่มของตัวเลือก", () => {
    const withModifier = chargeLine({
      packQty: 3,
      modifierCodes: ["EXTRA_SHOT"],
      modifiers: [
        { code: "EXTRA_SHOT", priceDelta: 15 },
        { code: "NO_SUGAR", priceDelta: 5 },
      ],
    });
    assert.equal(modifierUnitPriceOf(withModifier), 15, "นับเฉพาะตัวเลือกที่ถูกเลือก");
    const charge = cartLineCharge(withModifier, undefined);
    assert.equal(charge.unitPrice, 115);
    assert.equal(charge.modifierAmount, 45);
    assert.equal(charge.amount, 345, "ยอดบรรทัดต้องรวมส่วนเพิ่มของตัวเลือก");
    // ไม่ได้เลือกอะไร = ยอดเท่าเดิมทุกบาท (กันการบวกส่วนเพิ่มให้บรรทัดที่ไม่มีตัวเลือก)
    assert.equal(cartLineCharge(chargeLine({ packQty: 3 }), undefined).amount, 300);
  });

  await t.test("ราคาส่งลดเฉพาะตัวสินค้า ไม่ลดส่วนเพิ่มของตัวเลือก", () => {
    const charge = cartLineCharge(
      chargeLine({
        packQty: 5,
        modifierCodes: ["EXTRA_SHOT"],
        modifiers: [{ code: "EXTRA_SHOT", priceDelta: 15 }],
      }),
      90
    );
    assert.equal(charge.amount, 90 * 5 + 15 * 5);
  });

  await t.test("ของชั่งขายคิดส่วนเพิ่มต่อหน่วยฐาน เหมือนที่ createOrderInTx คิด", () => {
    const charge = cartLineCharge(
      chargeLine({
        packQty: 1,
        baseQty: 750,
        basePrice: 0.05,
        packPrice: 37.5,
        scaleBarcode: "2200001007505",
      }),
      undefined
    );
    assert.equal(charge.chargedQty, 750);
    assert.equal(charge.amount, 37.5);
  });

  await t.test("บรรทัดที่เข้าโปรก็ยังถูกบวกส่วนเพิ่มของตัวเลือก", () => {
    const totals = slice(source, "const total = useMemo(() => {", "const itemCount = useMemo(");
    assertHas(
      totals,
      /chargedPromo\.add\(key\);[\s\S]{0,200}charge\.modifierAmount/,
      "กิ่งโปรต้องบวก modifierAmount ด้วย — createOrderInTx บวกทุกบรรทัดไม่ว่าจะเข้าโปรหรือไม่"
    );
  });

  await t.test("type ของ modifiers ต้องมี priceDelta ให้จอคิดได้", () => {
    assertHas(
      source,
      /modifiers\?: Array<\{ code: string; name: string; priceDelta\?: number \}>/,
      "ScanHit.modifiers ต้องพก priceDelta มาด้วย ไม่งั้นจอบวกส่วนเพิ่มไม่ได้เลย"
    );
  });

  await t.test("จอไม่คิดยอดบรรทัดเอง — ใช้ตัวกลางที่เทสได้", () => {
    assertHas(
      source,
      /from "@\/lib\/pos\/cartCharge"/,
      "จอต้อง import cartLineCharge จาก lib ไม่ใช่นิยามสูตรของตัวเองในไฟล์จอ"
    );
    assertLacks(
      source,
      /function cartLineCharge\(/,
      "สูตรยอดบรรทัดกลับไปอยู่ในไฟล์จอแล้ว — เทสเรียกของจริงไม่ได้อีก"
    );
  });

  await t.test("การตรวจราคาซ้ำก่อนรับเงินต้องเห็นราคาตัวเลือกที่เปลี่ยน", () => {
    const signature = slice(
      source,
      "function cartPricingSignature(",
      "const variantPricingKey"
    );
    assertHas(
      signature,
      /modifiers/,
      "ลายนิ้วมือราคาต้องรวมตัวเลือก ไม่งั้นแก้ราคาตัวเลือกกลางบิลแล้วจอไม่รู้ตัว"
    );
  });
});

test("เครื่องขายมือถือตรวจราคาซ้ำก่อนรับเงิน", async (t) => {
  await t.test("ตะกร้ามีทางยิงสแกนซ้ำทุกบรรทัด", () => {
    const source = withoutComments(read("apps/mobile/src/state/CartContext.tsx"));
    assertHas(
      source,
      /refreshPricing/,
      "CartContext ต้องมีทางตรวจราคาซ้ำให้หน้าชำระเงินเรียก"
    );
    assertHas(
      source,
      /cartLinePricingSignature/,
      "ต้องเทียบด้วยลายนิ้วมือของกติกาที่ตัดสินราคา ไม่ใช่เทียบยอดรวม"
    );
    // ⚠️ ต้องตรึง "เงื่อนไขที่ตัดสิน" ไม่ใช่แค่ข้อความที่อยู่ในกิ่งที่ตายแล้ว
    assertHas(
      source,
      /\n\s*if \(closed\) \{/,
      "ตัวเลือกที่ร้านปิดไปแล้วต้องบล็อกจริง ไม่ใช่มีข้อความอยู่ในกิ่งที่ไม่มีวันเข้า"
    );
    assertHas(
      source,
      /ถูกปิดแล้ว/,
      "ตัวเลือกที่ร้านปิดไปแล้วต้องบอกให้ลบรายการ ไม่ใช่ปล่อยให้ไปตายที่ server"
    );
  });

  await t.test("หน้าชำระเงินหยุดรับเงินเมื่อราคาขยับ", () => {
    const source = withoutComments(
      read("apps/mobile/src/screens/sell/CheckoutScreen.tsx")
    );
    const settle = slice(source, "const completeSale = async () => {", "const linesCard");
    assertHas(
      settle,
      /await cart\.refreshPricing\(\)/,
      "ต้องตรวจราคาซ้ำก่อนส่งคำขอขาย"
    );
    // ⚠️ ตรึงเงื่อนไขตรงตัว — `if (false && (recheck...))` ยังมีคำว่า recheck.changed อยู่ครบ
    assertHas(
      settle,
      /\n\s*if \(recheck\.error \|\| recheck\.changed\) \{/,
      "ราคาเปลี่ยนแล้วต้องหยุดรอบนั้น ไม่ใช่ส่งยอดเก่าไปให้ server ปฏิเสธ"
    );
    assertHas(
      settle,
      /recheck\.changed[\s\S]{0,400}return;/,
      "กิ่งที่ราคาเปลี่ยนต้องออกจากฟังก์ชัน ไม่ใช่เตือนแล้วขายต่อ"
    );
    // คีย์กันบิลซ้ำต้องออกหลังด่านนี้ ไม่งั้นคีย์ถูกเผาทิ้งทุกครั้งที่ราคาขยับ
    const guardAt = settle.indexOf("refreshPricing");
    const keyAt = settle.indexOf("createIdempotencyKey('sale')");
    assert.ok(guardAt >= 0 && keyAt > guardAt, "ต้องตรวจราคาก่อนออกคีย์กันบิลซ้ำ");
  });
});
