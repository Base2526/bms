import * as Keychain from 'react-native-keychain';

export type PendingPurchaseReceipt = {
  poId: string;
  branchId: string;
  cashierUserId: string;
  idempotencyKey: string;
  items: Array<{
    sku: string;
    size: string;
    qty: number;
    lotNo: string | null;
    expiryDate: string | null;
  }>;
};

// This journal holds one submitted request, never a PIN or device token.
export function purchaseReceiptScope(serverUrl: string, deviceId: string) {
  return `com.bms.pos.purchase.${encodeURIComponent(
    serverUrl.replace(/\/$/, ''),
  )}.${deviceId}`;
}

function parse(value: unknown): PendingPurchaseReceipt {
  const r = value as PendingPurchaseReceipt | null;
  if (
    !r ||
    ![r.poId, r.branchId, r.cashierUserId, r.idempotencyKey].every(
      v => typeof v === 'string' && v.length > 0,
    ) ||
    !Array.isArray(r.items) ||
    !r.items.length ||
    r.items.length > 200 ||
    r.items.some(
      i =>
        !i ||
        typeof i.sku !== 'string' ||
        !i.sku ||
        typeof i.size !== 'string' ||
        !i.size ||
        !Number.isInteger(i.qty) ||
        i.qty <= 0 ||
        i.qty > 2147483647 ||
        (i.lotNo !== null && typeof i.lotNo !== 'string') ||
        (i.expiryDate !== null && typeof i.expiryDate !== 'string'),
    )
  ) {
    throw new Error(
      'อ่านรายการรับสินค้าที่ค้างไว้ไม่ได้ กรุณาตรวจประวัติรับสินค้ากับผู้ดูแล',
    );
  }
  return {
    poId: r.poId,
    branchId: r.branchId,
    cashierUserId: r.cashierUserId,
    idempotencyKey: r.idempotencyKey,
    items: r.items.map(i => ({
      sku: i.sku,
      size: i.size,
      qty: i.qty,
      lotNo: i.lotNo,
      expiryDate: i.expiryDate,
    })),
  };
}

export async function loadPendingPurchaseReceipt(
  scope: string,
): Promise<PendingPurchaseReceipt | null> {
  const stored = await Keychain.getGenericPassword({ service: scope });
  return stored ? parse(JSON.parse(stored.password)) : null;
}

let writes: Promise<unknown> = Promise.resolve();
function locked<T>(action: () => Promise<T>): Promise<T> {
  const next = writes.then(action, action);
  writes = next.catch(() => undefined);
  return next;
}

export function savePendingPurchaseReceipt(
  scope: string,
  input: PendingPurchaseReceipt,
): Promise<void> {
  return locked(async () => {
    const receipt = parse(input);
    const current = await loadPendingPurchaseReceipt(scope);
    if (current && JSON.stringify(current) !== JSON.stringify(receipt)) {
      throw new Error('มีรายการรับเดิมรอตรวจผล กรุณาเปิดหน้ารับสินค้าอีกครั้ง');
    }
    const json = JSON.stringify(receipt);
    if (json.length > 64000)
      throw new Error('รายการรับสินค้าใหญ่เกินพื้นที่จัดเก็บ');
    const stored = await Keychain.setGenericPassword('purchase-receipt', json, {
      service: scope,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    });
    if (!stored)
      throw new Error('เก็บรายการป้องกันรับสินค้าซ้ำไม่ได้ กรุณาลองใหม่');
  });
}

export function clearPendingPurchaseReceipt(
  scope: string,
  key: string,
): Promise<void> {
  return locked(async () => {
    const current = await loadPendingPurchaseReceipt(scope);
    if (!current) return;
    if (current.idempotencyKey !== key)
      throw new Error(
        'รายการรับที่เก็บไว้เปลี่ยนไป กรุณาเปิดหน้ารับสินค้าอีกครั้ง',
      );
    if (!(await Keychain.resetGenericPassword({ service: scope })))
      throw new Error(
        'ยังล้างรายการรับที่บันทึกแล้วไม่ได้ กรุณาตรวจรายการเดิมอีกครั้ง',
      );
  });
}
