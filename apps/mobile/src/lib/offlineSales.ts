import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.bms.pos.offline-sales.v1';
const USERNAME = 'offline-sales';
const MAX_RECORDS = 20;
const MAX_BYTES = 128 * 1024;

export type OfflineSaleQueueState = 'STAGED' | 'UNKNOWN' | 'NEEDS_REVIEW';

export interface OfflineSaleLineInput {
  sku: string;
  size: string;
  packCode: string | null;
  packQty: number;
  baseQty: number | null;
  packPrice: number | null;
  unitName: string | null;
  modifierCodes: string[] | null;
  scaleBarcode: string | null;
  serials: string[] | null;
}

export interface OfflineSalePaymentInput {
  method: string;
  amount: number;
  cashTendered: number | null;
  ref: string | null;
}

export interface OfflineSalePayload {
  idempotencyKey: string;
  offlineTenderedAt: string | null;
  mode: 'SALE';
  boardGameBillingGroupId: null;
  lines: OfflineSaleLineInput[];
  payments: OfflineSalePaymentInput[];
  pointsToRedeem: 0;
}

export interface OfflineSaleRecord {
  id: string;
  serverUrl: string;
  branchId: string;
  cashierUserId: string;
  /** Optional for backward compatibility with queue rows written before the label was added. */
  cashierName?: string | null;
  tenderedAt: string;
  total: number;
  payload: OfflineSalePayload;
  state: OfflineSaleQueueState;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

interface OfflineSaleEnvelope {
  version: 1;
  records: OfflineSaleRecord[];
}

let storageLock: Promise<unknown> = Promise.resolve();

async function readUnlocked(): Promise<OfflineSaleRecord[]> {
  const credential = await Keychain.getGenericPassword({ service: SERVICE });
  if (!credential) return [];
  try {
    const parsed = JSON.parse(
      credential.password,
    ) as Partial<OfflineSaleEnvelope>;
    return parsed.version === 1 && Array.isArray(parsed.records)
      ? parsed.records
      : [];
  } catch {
    throw new Error('อ่านคิวรายการออฟไลน์ไม่ได้ กรุณาให้ผู้ดูแลตรวจสอบเครื่อง');
  }
}

async function writeUnlocked(records: OfflineSaleRecord[]): Promise<void> {
  if (records.length === 0) {
    await Keychain.resetGenericPassword({ service: SERVICE });
    return;
  }
  const envelope: OfflineSaleEnvelope = { version: 1, records };
  const serialized = JSON.stringify(envelope);
  if (serialized.length > MAX_BYTES) {
    throw new Error(
      'คิวออฟไลน์มีข้อมูลมากเกินขนาด ต้องซิงก์หรือตรวจสอบก่อนขายต่อ',
    );
  }
  await Keychain.setGenericPassword(USERNAME, serialized, {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
  });
}

async function locked<T>(work: () => Promise<T>): Promise<T> {
  const next = storageLock.then(work, work);
  storageLock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function loadOfflineSales(): Promise<OfflineSaleRecord[]> {
  return locked(readUnlocked);
}

export async function putOfflineSale(
  record: OfflineSaleRecord,
): Promise<OfflineSaleRecord[]> {
  return locked(async () => {
    const records = await readUnlocked();
    const index = records.findIndex(item => item.id === record.id);
    if (index < 0 && records.length >= MAX_RECORDS) {
      throw new Error(
        `คิวออฟไลน์เต็ม ${MAX_RECORDS} รายการ ต้องซิงก์หรือตรวจสอบก่อนขายต่อ`,
      );
    }
    const next = [...records];
    if (index < 0) next.push(record);
    else next[index] = record;
    await writeUnlocked(next);
    return next;
  });
}

export async function patchOfflineSale(
  id: string,
  patch: Partial<OfflineSaleRecord>,
): Promise<OfflineSaleRecord[]> {
  return locked(async () => {
    const records = await readUnlocked();
    const next = records.map(record =>
      record.id === id
        ? {
            ...record,
            ...patch,
            id: record.id,
            updatedAt: new Date().toISOString(),
          }
        : record,
    );
    await writeUnlocked(next);
    return next;
  });
}

export async function removeOfflineSale(
  id: string,
): Promise<OfflineSaleRecord[]> {
  return locked(async () => {
    const records = await readUnlocked();
    const next = records.filter(record => record.id !== id);
    await writeUnlocked(next);
    return next;
  });
}

export function unresolvedOfflineSaleCount(
  records: OfflineSaleRecord[],
): number {
  return records.filter(record => record.state !== 'NEEDS_REVIEW').length;
}
