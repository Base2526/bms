import * as Keychain from 'react-native-keychain';
import {
  OFFLINE_QUEUE_SCHEMA_VERSION,
  offlineRequestFingerprint,
  type OfflineQueueState,
} from './offlineContinuity';

const SERVICE = 'com.bms.pos.offline-sales.v1';
const USERNAME = 'offline-sales';
const MAX_RECORDS = 20;
const MAX_BYTES = 128 * 1024;

export type OfflineSaleQueueState = OfflineQueueState;

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
  /** Integrity signal for the encrypted payload; optional only for v1 queue compatibility. */
  requestFingerprint?: string;
  state: OfflineSaleQueueState;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

interface OfflineSaleEnvelope {
  version: 1 | typeof OFFLINE_QUEUE_SCHEMA_VERSION;
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
    if (
      (parsed.version !== 1 &&
        parsed.version !== OFFLINE_QUEUE_SCHEMA_VERSION) ||
      !Array.isArray(parsed.records)
    ) {
      return [];
    }
    for (const record of parsed.records) {
      if (record.id !== record.payload?.idempotencyKey) {
        throw new Error(
          'คิวออฟไลน์มีรหัสรายการไม่ตรงกัน กรุณาให้ผู้ดูแลตรวจสอบเครื่อง',
        );
      }
      if (
        parsed.version === OFFLINE_QUEUE_SCHEMA_VERSION &&
        !record.requestFingerprint
      ) {
        throw new Error(
          'คิวออฟไลน์ไม่มีข้อมูลตรวจสอบ กรุณาให้ผู้ดูแลตรวจสอบเครื่อง',
        );
      }
      if (
        record.requestFingerprint &&
        record.requestFingerprint !== offlineRequestFingerprint(record.payload)
      ) {
        throw new Error(
          'คิวออฟไลน์มีข้อมูลเปลี่ยนแปลง กรุณาให้ผู้ดูแลตรวจสอบเครื่อง',
        );
      }
    }
    return parsed.records;
  } catch {
    throw new Error('อ่านคิวรายการออฟไลน์ไม่ได้ กรุณาให้ผู้ดูแลตรวจสอบเครื่อง');
  }
}

async function writeUnlocked(
  records: OfflineSaleRecord[],
): Promise<OfflineSaleRecord[]> {
  if (records.length === 0) {
    await Keychain.resetGenericPassword({ service: SERVICE });
    return [];
  }
  const protectedRecords = records.map(record => {
    if (record.id !== record.payload.idempotencyKey) {
      throw new Error('รหัสรายการออฟไลน์ไม่ตรงกับคำขอขาย');
    }
    return {
      ...record,
      requestFingerprint: offlineRequestFingerprint(record.payload),
    };
  });
  const envelope: OfflineSaleEnvelope = {
    version: OFFLINE_QUEUE_SCHEMA_VERSION,
    records: protectedRecords,
  };
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
  return protectedRecords;
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
  if (record.id !== record.payload.idempotencyKey) {
    throw new Error('รหัสรายการออฟไลน์ไม่ตรงกับคำขอขาย');
  }
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
    return writeUnlocked(next);
  });
}

export async function patchOfflineSale(
  id: string,
  patch: Omit<
    Partial<OfflineSaleRecord>,
    'id' | 'payload' | 'requestFingerprint' | 'serverUrl' | 'branchId'
  >,
): Promise<OfflineSaleRecord[]> {
  return locked(async () => {
    const records = await readUnlocked();
    const next = records.map(record =>
      record.id === id
        ? {
            ...record,
            ...patch,
            id: record.id,
            payload: record.payload,
            requestFingerprint:
              record.requestFingerprint ??
              offlineRequestFingerprint(record.payload),
            serverUrl: record.serverUrl,
            branchId: record.branchId,
            updatedAt: new Date().toISOString(),
          }
        : record,
    );
    return writeUnlocked(next);
  });
}

export async function removeOfflineSale(
  id: string,
): Promise<OfflineSaleRecord[]> {
  return locked(async () => {
    const records = await readUnlocked();
    const next = records.filter(record => record.id !== id);
    return writeUnlocked(next);
  });
}

export function unresolvedOfflineSaleCount(
  records: OfflineSaleRecord[],
): number {
  return records.length;
}
