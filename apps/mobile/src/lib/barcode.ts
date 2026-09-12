interface BarcodeCatalogItem {
  sku: string;
  barcode?: string;
  sellable: boolean;
  unavailableNote?: string | null;
}

interface BarcodeCatalog<TItem extends BarcodeCatalogItem> {
  items: TItem[];
}

export type BarcodeResolution<TItem extends BarcodeCatalogItem> =
  | { ok: true; item: TItem }
  | { ok: false; message: string };

/** Mock-only resolver. Production must ask the server catalog and re-check sellability there. */
export function resolveMockBarcode<TItem extends BarcodeCatalogItem>(
  catalog: BarcodeCatalog<TItem>,
  rawCode: string,
): BarcodeResolution<TItem> {
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
