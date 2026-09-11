import type { MockMenuCatalog, MockMenuItem } from '../mocks/menu';

export type BarcodeResolution =
  | { ok: true; item: MockMenuItem }
  | { ok: false; message: string };

/** Mock-only resolver. Production must ask the server catalog and re-check sellability there. */
export function resolveMockBarcode(
  catalog: MockMenuCatalog,
  rawCode: string,
): BarcodeResolution {
  const normalized = rawCode.trim().toLowerCase();
  const item = catalog.items.find(
    candidate =>
      candidate.barcode?.toLowerCase() === normalized ||
      candidate.sku.toLowerCase() === normalized,
  );
  if (!item) {
    return { ok: false, message: 'ไม่พบบาร์โค้ดนี้ในรายการสินค้าทดสอบ' };
  }
  if (!item.sellable) {
    return {
      ok: false,
      message: item.unavailableNote ?? 'สินค้านี้ขายไม่ได้ตอนนี้',
    };
  }
  return { ok: true, item };
}
