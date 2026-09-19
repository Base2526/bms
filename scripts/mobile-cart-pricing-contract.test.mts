import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyPromotion as webApplyPromotion,
  isFixedPricePack as webIsFixedPricePack,
  unitPriceForQty as webUnitPriceForQty,
  type PriceTier as WebPriceTier,
  type Promotion as WebPromotion,
} from "../apps/web/lib/bms/pricing.ts";
import { cashRoundingDelta as webCashRoundingDelta } from "../apps/web/lib/pos/cashRounding.ts";

/**
 * ราคาของตะกร้าบนเครื่องขายมือถือต้องได้เลขเดียวกับที่ `createOrderInTx()` คิดตอน commit
 *
 * `recordPosSale()` เทียบผลรวมเงินที่เครื่องส่งมากับยอดที่ server คิดเอง ต่างกันเกิน 1 สตางค์
 * = ยกเลิกบิลทิ้งทั้งใบ (`PAYMENT_MISMATCH`) ต่อหน้าลูกค้า · ก่อนไฟล์นี้ RN คิด `qty × unitPrice`
 * ล้วน ๆ แปลว่าร้านที่ตั้งราคาส่ง (8.1) โปรโมชัน (8.7) หรือเปิดปัดเศษเงินสด (7.95)
 * **ขายจากมือถือไม่ได้เลยสักบิล**
 *
 * กติกาฝั่ง client อยู่ใน `packages/pos-client-core` และ Mobile re-export จากที่เดียวกันกับ
 * Desktop renderer ส่วนไฟล์นี้ยังเป็นด่านเทียบ core กับกติกา authoritative ฝั่งเว็บโดยป้อน
 * อินพุตชุดเดียวกัน ไม่ใช่สแกนว่า "มีคำนี้อยู่ในไฟล์"
 *
 * ⚠️ ต้องเป็น dynamic import — apps/mobile ไม่ได้ประกาศ "type": "module" ไฟล์จึงถูก tsx
 * แปลงเป็น CJS และ static named import ล้มตอน link ("does not provide an export named")
 */
const mobile = (await import(
  "../apps/mobile/src/lib/cartPricing.ts"
)) as typeof import("../apps/mobile/src/lib/cartPricing.ts");

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

const TIER_SETS: WebPriceTier[][] = [
  [],
  [{ minQty: 5, scope: "PER_VARIANT_FIXED", size: null, unitPrice: 90 }],
  [
    { minQty: 3, scope: "PER_VARIANT_FIXED", size: null, unitPrice: 95 },
    { minQty: 10, scope: "PER_VARIANT_FIXED", size: null, unitPrice: 80 },
  ],
  [{ minQty: 6, scope: "PER_VARIANT_FIXED", size: "L", unitPrice: 88 }],
  [{ minQty: 4, scope: "CROSS_VARIANT_PERCENT", size: null, discountPct: 12.5 }],
  // ขั้นต่ำเท่ากันแต่ scope ต่างกัน — ตัวตัดสินคือลำดับความเฉพาะเจาะจง ไม่ใช่ลำดับแถวจากฐาน
  // (ถ้าไม่มีเคสนี้ การสลับกติกาตัดสินเสมอจะไม่มีอินพุตไหนจับได้เลย)
  [
    { minQty: 5, scope: "PER_VARIANT_FIXED", size: null, unitPrice: 95 },
    { minQty: 5, scope: "PER_VARIANT_FIXED", size: "L", unitPrice: 88 },
  ],
  [
    { minQty: 4, scope: "PER_VARIANT_FIXED", size: null, unitPrice: 97 },
    { minQty: 4, scope: "CROSS_VARIANT_PERCENT", size: null, discountPct: 20 },
  ],
  [
    { minQty: 4, scope: "CROSS_VARIANT_PERCENT", size: null, discountPct: 20 },
    { minQty: 4, scope: "PER_VARIANT_FIXED", size: "L", unitPrice: 70 },
  ],
  // ขั้นที่อ่านไม่ออกต้องถูกทิ้งเหมือนกันทั้งสองฝั่ง ไม่ใช่ฝั่งหนึ่งเดาค่าแทน
  [{ minQty: 1, scope: "PER_VARIANT_FIXED", size: null, unitPrice: 10 }],
  [{ minQty: 5, scope: "CROSS_VARIANT_PERCENT", size: null, discountPct: 0 }],
];

const PROMOTIONS: Array<WebPromotion | null> = [
  null,
  { kind: "BUY_X_GET_Y", buyQty: 3, getQty: 1 },
  { kind: "BUY_X_GET_Y", buyQty: 1, getQty: 1 },
  { kind: "N_FOR_PRICE", buyQty: 3, bundlePrice: 100 },
  // ชุดที่แพงกว่าซื้อแยก — ทั้งสองฝั่งต้องไม่บังคับใช้
  { kind: "N_FOR_PRICE", buyQty: 2, bundlePrice: 500 },
];

test("mobile cart pricing mirrors the web pricing rules", async (t) => {
  await t.test("unitPriceForQty agrees on every tier shape", () => {
    let checked = 0;
    for (const tiers of TIER_SETS) {
      for (const basePrice of [0, 12.5, 100, 259.3]) {
        for (const variantQty of [0, 1, 3, 4, 5, 6, 10, 25]) {
          for (const skuQty of [variantQty, variantQty + 7]) {
            for (const size of ["S", "L", ""]) {
              const web = webUnitPriceForQty(
                basePrice,
                tiers,
                variantQty,
                skuQty,
                size
              );
              const rn = mobile.unitPriceForQty(
                basePrice,
                tiers as Parameters<typeof mobile.unitPriceForQty>[1],
                variantQty,
                skuQty,
                size
              );
              assert.equal(
                rn,
                web,
                `ราคาต่อหน่วยไม่ตรงกัน tiers=${JSON.stringify(
                  tiers
                )} base=${basePrice} variantQty=${variantQty} skuQty=${skuQty} size=${size}`
              );
              checked += 1;
            }
          }
        }
      }
    }
    // ตัวเทียบที่ไม่ได้เทียบอะไรเลยจะเขียวโดยไม่ตรวจอะไร
    assert.ok(checked > 500, `เทียบได้แค่ ${checked} เคส`);
  });

  await t.test("applyPromotion agrees on every promotion shape", () => {
    let checked = 0;
    for (const promo of PROMOTIONS) {
      for (const basePrice of [0, 40, 100, 33.33]) {
        for (const qty of [0, 1, 2, 3, 4, 6, 7, 8, 13]) {
          const web = webApplyPromotion(basePrice, qty, promo);
          const rn = mobile.applyPromotion(
            basePrice,
            qty,
            promo as Parameters<typeof mobile.applyPromotion>[2]
          );
          assert.deepEqual(
            rn,
            web,
            `ยอดโปรไม่ตรงกัน promo=${JSON.stringify(
              promo
            )} base=${basePrice} qty=${qty}`
          );
          checked += 1;
        }
      }
    }
    assert.ok(checked > 100, `เทียบได้แค่ ${checked} เคส`);
  });

  await t.test("cash rounding agrees, including the half-step case", () => {
    let checked = 0;
    for (const mode of ["NONE", "0.25", "0.50", "1.00"] as const) {
      for (const amount of [
        0, 0.12, 0.13, 0.125, 1.24, 99.99, 100.4, 100.5, 250.62, 615.37,
      ]) {
        assert.equal(
          mobile.cashRoundingDelta(amount, mode),
          webCashRoundingDelta(amount, mode),
          `ยอดปัดเศษไม่ตรงกัน mode=${mode} amount=${amount}`
        );
        checked += 1;
      }
    }
    assert.ok(checked > 30, `เทียบได้แค่ ${checked} เคส`);
  });

  await t.test("BASE stays priceable while a named pack keeps its own price", () => {
    for (const packCode of ["BASE", "base", "", null, undefined, "BOX", "box12"]) {
      assert.equal(
        mobile.isFixedPricePack(packCode),
        webIsFixedPricePack(packCode),
        `packCode=${String(packCode)} ตัดสินไม่ตรงกัน`
      );
    }
  });
});

test("cart subtotal follows the createOrderInTx charge order", async (t) => {
  const line = (
    over: Partial<Parameters<typeof mobile.cartProductSubtotal>[0][number]>
  ) => ({
    sku: "SKU",
    size: "S",
    packCode: "BASE",
    qty: 1,
    baseQty: 1,
    basePrice: 100,
    packBasePrice: 100,
    modifierUnitPrice: 0,
    ...over,
  });

  await t.test("ขั้นราคาส่งคิดจากจำนวนรวมทั้งตะกร้า ไม่ใช่ต่อบรรทัด", () => {
    const tiers = [
      { minQty: 5, scope: "PER_VARIANT_FIXED" as const, size: null, unitPrice: 90 },
    ];
    // สองบรรทัดของไซซ์เดียวกัน (คนละตัวเลือก) รวมกันครบขั้น → ทั้งคู่ต้องได้ราคาส่ง
    assert.equal(
      mobile.cartProductSubtotal([
        line({ qty: 3, priceTiers: tiers }),
        line({ qty: 2, priceTiers: tiers, modifierUnitPrice: 5 }),
      ]),
      90 * 5 + 5 * 2
    );
    // ยังไม่ครบขั้น → ราคาป้ายเต็ม
    assert.equal(
      mobile.cartProductSubtotal([line({ qty: 4, priceTiers: tiers })]),
      400
    );
  });

  await t.test("โปรคิดครั้งเดียวต่อ SKU+ไซซ์ ไม่ใช่ต่อบรรทัด", () => {
    const promotion = { kind: "N_FOR_PRICE" as const, buyQty: 3, bundlePrice: 250 };
    // 4 ชิ้นแยกสองบรรทัด: ชุดละ 250 + เศษ 1 ชิ้นราคาเต็ม — ห้ามคิดชุดสองรอบ
    assert.equal(
      mobile.cartProductSubtotal([
        line({ qty: 3, promotion }),
        line({ qty: 1, promotion }),
      ]),
      350
    );
  });

  await t.test("หน่วยขายที่ตั้งราคาเองอยู่นอกโปร แต่ยังนับเข้าขั้นราคาส่ง", () => {
    const tiers = [
      { minQty: 10, scope: "PER_VARIANT_FIXED" as const, size: null, unitPrice: 80 },
    ];
    const promotion = { kind: "BUY_X_GET_Y" as const, buyQty: 3, getQty: 1 };
    // กล่อง 12 ชิ้นราคา 900 (ไม่เข้าโปร ไม่เข้าขั้นราคาส่ง) แต่ปลดขั้นให้บรรทัดหน่วยฐาน
    // ส่วนบรรทัดหน่วยฐาน 4 ชิ้นเข้าโปรของตัวเอง (ซื้อ 3 แถม 1 → จ่าย 3 ที่ราคาป้าย)
    assert.equal(
      mobile.cartProductSubtotal([
        line({ qty: 1, baseQty: 12, packCode: "BOX", packBasePrice: 900, priceTiers: tiers, promotion }),
        line({ qty: 4, priceTiers: tiers, promotion }),
      ]),
      900 + 300
    );
  });

  await t.test("ตัวเลือกบวกท้ายสุด ไม่ถูกลดตามโปร", () => {
    const promotion = { kind: "BUY_X_GET_Y" as const, buyQty: 1, getQty: 1 };
    // 2 ชิ้นจ่าย 1 ที่ราคาป้าย แต่ตัวเลือกคิดครบทั้ง 2 ที่
    assert.equal(
      mobile.cartProductSubtotal([
        line({ qty: 2, promotion, modifierUnitPrice: 15 }),
      ]),
      100 + 30
    );
  });

  await t.test("บรรทัดชั่งขายคิดเป็นหน่วยฐานทั้งบรรทัด", () => {
    // ป้าย 750 กรัม ราคา 0.05/กรัม → packPrice ที่ server คืนมาคือ 37.50 ของทั้งถุง
    assert.equal(
      mobile.cartProductSubtotal([
        line({
          qty: 1,
          baseQty: 750,
          basePrice: 0.05,
          packBasePrice: 37.5,
          scaleBarcode: "2200001007505",
        }),
      ]),
      37.5
    );
    // ⚠️ ไม่มี basePrice ติดมา (บรรทัดยุคก่อน snapshot) ต้องหารกลับ ห้ามคูณราคาทั้งถุง
    // ด้วยจำนวนกรัมอีกรอบ
    assert.equal(
      mobile.cartProductSubtotal([
        line({
          qty: 1,
          baseQty: 750,
          basePrice: undefined,
          packBasePrice: 37.5,
          scaleBarcode: "2200001007505",
        }),
      ]),
      37.5
    );
  });

  await t.test("บรรทัดที่ไม่มี snapshot ยังคิดเท่าเดิม (qty × ราคาหน่วยขาย)", () => {
    assert.equal(
      mobile.cartProductSubtotal([
        {
          sku: "OLD",
          size: "-",
          packCode: "BASE",
          qty: 3,
          baseQty: 1,
          unitPrice: 33.33,
        },
      ]),
      99.99
    );
  });
});

test("ลายนิ้วมือราคาจับ 'ราคาเปลี่ยน' ได้ทุกแบบที่เข้ายอดบิล", async (t) => {
  const line = (
    over: Partial<Parameters<typeof mobile.cartLinePricingSignature>[0]> = {}
  ) => ({
    sku: "SKU",
    size: "S",
    packCode: "BASE",
    qty: 1,
    baseQty: 1,
    basePrice: 100,
    packBasePrice: 100,
    modifierUnitPrice: 0,
    ...over,
  });

  await t.test("จำนวนที่แคชเชียร์กดไม่ใช่ราคาเปลี่ยน", () => {
    assert.equal(
      mobile.cartLinePricingSignature(line({ qty: 1 })),
      mobile.cartLinePricingSignature(line({ qty: 9 }))
    );
  });

  await t.test("ทุกอย่างที่เข้ายอดบิลต้องนับเป็นราคาเปลี่ยน", () => {
    const base = mobile.cartLinePricingSignature(line());
    const changes: Array<[string, Parameters<typeof line>[0]]> = [
      ["ราคาป้าย", { basePrice: 90 }],
      ["ราคาต่อหน่วยขาย", { packBasePrice: 90 }],
      ["ขั้นราคาส่ง", { priceTiers: [{ minQty: 5, unitPrice: 90 }] }],
      ["โปรโมชัน", { promotion: { kind: "BUY_X_GET_Y", buyQty: 3, getQty: 1 } }],
      ["ราคาตัวเลือก", { modifierUnitPrice: 15 }],
    ];
    for (const [label, patch] of changes) {
      assert.notEqual(
        mobile.cartLinePricingSignature(line(patch)),
        base,
        `${label} เปลี่ยนแล้วลายนิ้วมือต้องไม่เหมือนเดิม`
      );
    }
  });

  await t.test("ลำดับขั้นราคาที่ฐานคืนมาไม่ทำให้อ่านว่าราคาเปลี่ยน", () => {
    const tiers = [
      { minQty: 3, unitPrice: 95 },
      { minQty: 10, unitPrice: 80 },
    ];
    assert.equal(
      mobile.cartLinePricingSignature(line({ priceTiers: tiers })),
      mobile.cartLinePricingSignature(line({ priceTiers: [...tiers].reverse() }))
    );
  });
});

test("the register still routes every money number through the shared rules", async (t) => {
  await t.test("ตะกร้าคิดยอดด้วย cartProductSubtotal ไม่ใช่ qty × unitPrice", () => {
    const source = withoutComments(
      read("apps/mobile/src/state/CartContext.tsx")
    );
    assertHas(
      source,
      /cartProductSubtotal\(lines\)/,
      "CartContext ต้องคิดยอดสินค้าด้วย cartProductSubtotal"
    );
    assert.ok(
      !/subtotal[\s\S]{0,80}reduce\([\s\S]{0,120}qty \* line\.unitPrice/.test(
        source
      ),
      "ยอดสินค้ากลับไปเป็น qty × unitPrice แล้ว — ราคาส่ง/โปรจะหายไปทั้งหมด"
    );
  });

  await t.test("หน้าชำระเงินปัดเศษเงินสดด้วยกฎของ server", () => {
    const source = withoutComments(
      read("apps/mobile/src/screens/sell/CheckoutScreen.tsx")
    );
    assertHas(
      source,
      /cashRoundingForPayments\(/,
      "หน้าชำระเงินต้องคิดยอดปัดเศษก่อนส่งยอดไปให้ server ตรวจ"
    );
    assertHas(
      source,
      /vat\.cashRounding/,
      "โหมดปัดเศษต้องมาจากการตั้งค่าของร้าน ไม่ใช่ค่าคงที่ในจอ"
    );
    assertHas(
      source,
      /source === 'board_game'[\s\S]{0,180}confirmedBoardGamePreview\?\.pointsUsed \?\? 0[\s\S]{0,80}: cart\.pointsUsed/,
      "ต้องส่งแต้มที่พรีวิวบอกว่าหักได้จริง ไม่ใช่ตัวเลขที่แคชเชียร์พิมพ์"
    );
  });

  await t.test("การสแกนต้องดึงขั้นราคาส่งและโปรมาด้วย", () => {
    const operations = read("apps/mobile/src/graphql/operations.graphql");
    const scan = operations.slice(
      operations.indexOf("query MobilePosScan"),
      operations.indexOf("query MobilePosSales")
    );
    assert.ok(scan.length > 0, "ไม่พบ query MobilePosScan");
    for (const field of ["priceTiers", "promotion", "basePrice"]) {
      assertHas(
        scan,
        new RegExp(`\\b${field}\\b`),
        `MobilePosScan ต้องขอ ${field} มาด้วย ไม่งั้นจอคิดราคาเองไม่ได้`
      );
    }
  });

  await t.test("สรุปกะต้องไม่แสดงเงินที่ควรมีเป็น 0 ตอนที่ยังบอกไม่ได้", () => {
    const context = withoutComments(
      read("apps/mobile/src/state/ShiftContext.tsx")
    );
    assert.ok(
      !/expectedCash:[^\n]*\?\?\s*0\b/.test(context),
      "expectedCash ที่เป็น null (โหมดนับปิดตา) ห้ามกลายเป็น ฿0.00"
    );
    assertHas(
      context,
      /expectedCashHidden/,
      "ต้องแยก 'ถูกซ่อน' ออกจาก 'ยังไม่รู้' ให้จอเลือกข้อความได้ถูก"
    );
    const screen = withoutComments(
      read("apps/mobile/src/screens/shift/ShiftScreen.tsx")
    );
    assertHas(
      screen,
      /expectedCashHidden/,
      "จอสรุปกะต้องเคารพโหมดนับปิดตา"
    );
  });
});
