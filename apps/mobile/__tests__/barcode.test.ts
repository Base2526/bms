import { resolveMockBarcode } from '../src/lib/barcode';
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
