import {
  applyPromotion,
  cartLinePricingSignature,
  cartProductSubtotal,
  cashRoundingDelta,
  cashRoundingForPayments,
  isFixedPricePack,
  normalizePriceTiers,
  normalizePromotion,
  payableWithRounding,
  unitPriceForQty,
} from '../src/lib/cartPricing';

const line = (over: Partial<Parameters<typeof cartProductSubtotal>[0][number]>) => ({
  sku: 'SKU',
  size: 'S',
  packCode: 'BASE',
  qty: 1,
  baseQty: 1,
  basePrice: 100,
  packBasePrice: 100,
  modifierUnitPrice: 0,
  ...over,
});

describe('ราคาส่งตามจำนวน', () => {
  it('ขั้นที่สูงสุดที่ไม่เกินจำนวนที่ซื้อชนะ', () => {
    const tiers = [
      { minQty: 3, unitPrice: 95 },
      { minQty: 10, unitPrice: 80 },
    ];
    expect(unitPriceForQty(100, tiers, 2)).toBe(100);
    expect(unitPriceForQty(100, tiers, 3)).toBe(95);
    expect(unitPriceForQty(100, tiers, 12)).toBe(80);
  });

  it('ขั้นแบบเปอร์เซ็นต์นับจำนวนรวมทั้ง SKU ไม่ใช่ต่อไซซ์', () => {
    const tiers = [
      { minQty: 6, scope: 'CROSS_VARIANT_PERCENT' as const, discountPct: 10 },
    ];
    expect(unitPriceForQty(100, tiers, 2, 2)).toBe(100);
    expect(unitPriceForQty(100, tiers, 2, 8)).toBe(90);
  });

  it('ขั้นเฉพาะไซซ์ชนะขั้นที่ใช้ร่วมทุกไซซ์เมื่อขั้นต่ำเท่ากัน', () => {
    const tiers = [
      { minQty: 5, unitPrice: 95 },
      { minQty: 5, size: 'L', unitPrice: 88 },
    ];
    expect(unitPriceForQty(100, tiers, 5, 5, 'L')).toBe(88);
    expect(unitPriceForQty(100, tiers, 5, 5, 'S')).toBe(95);
  });
});

describe('โปรโมชัน', () => {
  it('ซื้อ X แถม Y จ่ายเฉพาะชิ้นที่ไม่ได้แถม เศษที่ไม่ครบชุดจ่ายเต็ม', () => {
    expect(applyPromotion(100, 4, { kind: 'BUY_X_GET_Y', buyQty: 3, getQty: 1 }).amount).toBe(300);
    expect(applyPromotion(100, 7, { kind: 'BUY_X_GET_Y', buyQty: 3, getQty: 1 }).amount).toBe(600);
  });

  it('N ชิ้นราคาเดียว เศษจ่ายราคาเต็ม', () => {
    expect(applyPromotion(40, 4, { kind: 'N_FOR_PRICE', buyQty: 3, bundlePrice: 100 }).amount).toBe(140);
  });

  it('โปรที่แพงกว่าซื้อแยกไม่ถูกบังคับใช้', () => {
    expect(applyPromotion(40, 2, { kind: 'N_FOR_PRICE', buyQty: 2, bundlePrice: 100 }).amount).toBe(80);
  });
});

describe('ยอดสินค้าในตะกร้า', () => {
  it('รวมจำนวนข้ามบรรทัดก่อนตัดสินขั้นราคาส่ง', () => {
    const priceTiers = [{ minQty: 5, unitPrice: 90 }];
    expect(
      cartProductSubtotal([
        line({ qty: 3, priceTiers }),
        line({ qty: 2, priceTiers }),
      ]),
    ).toBe(450);
  });

  it('คิดโปรครั้งเดียวต่อ SKU+ไซซ์', () => {
    const promotion = { kind: 'N_FOR_PRICE' as const, buyQty: 3, bundlePrice: 250 };
    expect(
      cartProductSubtotal([
        line({ qty: 2, promotion }),
        line({ qty: 2, promotion }),
      ]),
    ).toBe(350);
  });

  it('ตัวเลือกคิดตามจำนวนหน่วยขาย และไม่ถูกลดตามโปร', () => {
    expect(
      cartProductSubtotal([
        line({
          qty: 2,
          modifierUnitPrice: 15,
          promotion: { kind: 'BUY_X_GET_Y', buyQty: 1, getQty: 1 },
        }),
      ]),
    ).toBe(130);
  });

  it('หน่วยขายที่ตั้งราคาเองยึดราคาของตัวเอง', () => {
    expect(
      cartProductSubtotal([
        line({ qty: 2, baseQty: 12, packCode: 'BOX', packBasePrice: 900 }),
      ]),
    ).toBe(1800);
  });
});

describe('ปัดเศษเงินสด', () => {
  it('ปัดเข้าหาค่าที่ใกล้ที่สุด เศษครึ่งพอดีปัดขึ้น', () => {
    expect(cashRoundingDelta(100.4, '0.50')).toBe(0.1);
    expect(cashRoundingDelta(100.25, '0.50')).toBe(0.25);
    expect(cashRoundingDelta(100.24, '0.50')).toBe(-0.24);
    expect(cashRoundingDelta(100.4, 'NONE')).toBe(0);
  });

  it('ปัดเฉพาะบิลที่ทุกช่องทางเป็นเงินสด', () => {
    const cash = [{ method: 'cash', amount: 100.4 }];
    const mixed = [
      { method: 'cash', amount: 50 },
      { method: 'qr', amount: 50.4 },
    ];
    expect(cashRoundingForPayments(100.4, '0.50', cash)).toBe(0.1);
    expect(cashRoundingForPayments(100.4, '0.50', mixed)).toBe(0);
    expect(payableWithRounding(100.4, 0.1)).toBe(100.5);
  });

  it('ยังไม่กรอกจำนวนเงิน ใช้วิธีจ่ายที่เลือกไว้ตัดสิน', () => {
    expect(
      cashRoundingForPayments(100.4, '0.50', [{ method: 'cash', amount: 0 }]),
    ).toBe(0.1);
  });
});

describe('ลายนิ้วมือของกติกาที่ตัดสินราคา', () => {
  it('จำนวนที่กดไม่ใช่ "ราคาเปลี่ยน"', () => {
    expect(cartLinePricingSignature(line({ qty: 1 }))).toBe(
      cartLinePricingSignature(line({ qty: 9 })),
    );
  });

  it('ราคาป้าย ขั้นราคาส่ง โปร และราคาตัวเลือก นับเป็นราคาเปลี่ยนทั้งหมด', () => {
    const base = cartLinePricingSignature(line({}));
    expect(cartLinePricingSignature(line({ basePrice: 90 }))).not.toBe(base);
    expect(
      cartLinePricingSignature(line({ priceTiers: [{ minQty: 5, unitPrice: 90 }] })),
    ).not.toBe(base);
    expect(
      cartLinePricingSignature(
        line({ promotion: { kind: 'BUY_X_GET_Y', buyQty: 3, getQty: 1 } }),
      ),
    ).not.toBe(base);
    expect(cartLinePricingSignature(line({ modifierUnitPrice: 5 }))).not.toBe(base);
  });

  it('ลำดับขั้นราคาที่ฐานคืนมาไม่ทำให้อ่านว่าราคาเปลี่ยน', () => {
    const ascending = [
      { minQty: 3, unitPrice: 95 },
      { minQty: 10, unitPrice: 80 },
    ];
    expect(cartLinePricingSignature(line({ priceTiers: ascending }))).toBe(
      cartLinePricingSignature(line({ priceTiers: [...ascending].reverse() })),
    );
  });
});

describe('การอ่านค่าจากเซิร์ฟเวอร์', () => {
  it('ขั้นราคาที่อ่านไม่ออกถูกทิ้ง ไม่ใช่เดาค่าแทน', () => {
    expect(
      normalizePriceTiers([
        { minQty: 1, unitPrice: 10 },
        { minQty: 5, unitPrice: null, discountPct: null },
        { minQty: 5, unitPrice: 90 },
      ]),
    ).toEqual([
      { minQty: 5, scope: 'PER_VARIANT_FIXED', size: null, unitPrice: 90, discountPct: null },
    ]);
  });

  it('โปรที่รูปไม่ครบถูกทิ้ง', () => {
    expect(normalizePromotion({ kind: 'BUY_X_GET_Y', buyQty: 3 })).toBeNull();
    expect(normalizePromotion({ kind: 'N_FOR_PRICE', buyQty: 3, bundlePrice: 100 })).toEqual({
      kind: 'N_FOR_PRICE',
      buyQty: 3,
      bundlePrice: 100,
    });
  });

  it('BASE เข้ากลไกราคาต่อชิ้น ส่วนหน่วยขายที่ตั้งชื่อเองไม่เข้า', () => {
    expect(isFixedPricePack('BASE')).toBe(false);
    expect(isFixedPricePack(null)).toBe(false);
    expect(isFixedPricePack('BOX')).toBe(true);
  });
});
