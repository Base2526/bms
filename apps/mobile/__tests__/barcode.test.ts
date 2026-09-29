import { resolveMockBarcode } from '../src/lib/barcode';
import {
  containsThaiCharacters,
  scannedItemNeedsOptions,
} from '../src/lib/scannerInput';
import { generalMockCatalog, pharmacyMockCatalog } from '../src/mocks/menu';

describe('mock barcode resolver', () => {
  test('resolves a barcode or SKU from the selected catalog', () => {
    expect(
      resolveMockBarcode(generalMockCatalog, '8851000000001'),
    ).toMatchObject({ ok: true, item: { sku: 'GEN-WATER' } });
    expect(resolveMockBarcode(generalMockCatalog, ' gen-water ')).toMatchObject(
      { ok: true, item: { barcode: '8851000000001' } },
    );
  });

  test('does not add missing or blocked products', () => {
    expect(resolveMockBarcode(generalMockCatalog, 'unknown')).toEqual({
      ok: false,
      message: 'ไม่พบบาร์โค้ดนี้ในรายการสินค้าทดสอบ',
    });
    expect(resolveMockBarcode(pharmacyMockCatalog, '8852000000007')).toEqual({
      ok: false,
      message: 'ตัวอย่าง: รอเภสัชกรตรวจนโยบาย',
    });
  });
});

describe('hardware scanner input', () => {
  test('detects Thai keyboard output without guessing a replacement code', () => {
    expect(containsThaiCharacters('8851000000001')).toBe(false);
    expect(containsThaiCharacters('ABC-123')).toBe(false);
    expect(containsThaiCharacters('ๅ/-ภถ')).toBe(true);
    expect(containsThaiCharacters('8851ก000')).toBe(true);
  });

  test('keeps modifier and pack choices in the existing product options flow', () => {
    expect(scannedItemNeedsOptions({ modifiers: [], packs: [] })).toBe(false);
    expect(
      scannedItemNeedsOptions({
        modifiers: [{ code: 'EXTRA' } as never],
        packs: [],
      }),
    ).toBe(true);
    expect(
      scannedItemNeedsOptions({
        modifiers: [],
        packs: [{ code: 'BASE' } as never, { code: 'BOX' } as never],
      }),
    ).toBe(true);
  });
});
