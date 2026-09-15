import { cartLineKey, cartLineVariantLabel } from '../src/lib/cartLine';

describe('cart line identity', () => {
  test('ไซซ์ต่างกัน = คนละบรรทัด (อาการที่ทำให้กด − แล้วหายไปทั้งสามบรรทัด)', () => {
    const s = cartLineKey({ sku: 'FAKE-1', size: 'S', packCode: '' });
    const m = cartLineKey({ sku: 'FAKE-1', size: 'M', packCode: '' });
    const l = cartLineKey({ sku: 'FAKE-1', size: 'L', packCode: '' });
    expect(new Set([s, m, l]).size).toBe(3);
  });

  test('หน่วยขายต่างกัน = คนละบรรทัด', () => {
    expect(cartLineKey({ sku: 'A', size: 'S', packCode: 'BOX' })).not.toBe(
      cartLineKey({ sku: 'A', size: 'S', packCode: '' }),
    );
  });

  test('ตัวเลือกต่างกัน = คนละบรรทัด เพราะราคาและของที่ลูกค้าได้ต่างกัน', () => {
    expect(
      cartLineKey({ sku: 'TEA', size: 'S', modifierCodes: ['SWEET_LOW'] }),
    ).not.toBe(
      cartLineKey({ sku: 'TEA', size: 'S', modifierCodes: ['SWEET_NORMAL'] }),
    );
  });

  test('ลำดับที่แคชเชียร์แตะตัวเลือกไม่ใช่ข้อมูล — ชุดเดียวกันต้องได้คีย์เดียวกัน', () => {
    expect(cartLineKey({ sku: 'TEA', modifierCodes: ['B', 'A'] })).toBe(
      cartLineKey({ sku: 'TEA', modifierCodes: ['A', 'B'] }),
    );
  });

  test('สินค้าเดียวกันทุกอย่าง = บรรทัดเดิม (ไม่แตกบรรทัดจนตะกร้ารก)', () => {
    expect(cartLineKey({ sku: 'A', size: 'S', packCode: 'BOX' })).toBe(
      cartLineKey({ sku: 'A', size: 'S', packCode: 'BOX' }),
    );
  });
});

describe('cart line variant label', () => {
  test('บอกไซซ์ หน่วยขาย และตัวเลือก', () => {
    expect(
      cartLineVariantLabel({
        size: 'L',
        unitName: 'กล่อง',
        modifierNames: ['หวานน้อย'],
      }),
    ).toBe('ขนาด L · กล่อง · หวานน้อย');
  });

  test('ไซซ์ที่เป็นแค่ค่าแทน "ไม่มีไซซ์" ต้องไม่ขึ้นเป็นป้าย', () => {
    for (const size of ['', '-', 'BASE', 'base', 'DEFAULT']) {
      expect(cartLineVariantLabel({ size })).toBe('');
    }
  });

  test('หน่วยขายที่ซ้ำกับไซซ์ไม่ถูกเขียนสองครั้ง', () => {
    expect(cartLineVariantLabel({ size: 'S', unitName: 'S' })).toBe('ขนาด S');
  });

  test('ไม่มีอะไรจะแยกก็ต้องไม่มีป้าย', () => {
    expect(cartLineVariantLabel({ size: 'BASE', unitName: '' })).toBe('');
  });
});
