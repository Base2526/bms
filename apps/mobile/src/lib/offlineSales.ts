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
  /** Binds new queue rows to the physical POS registration that accepted the cash. */
  deviceId?: string;
  branchId: string;
  /** Original cash-drawer shift; optional only for queues written before schema v3. */
  shiftId?: string;
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
  version: 1 | 2 | typeof OFFLINE_QUEUE_SCHEMA_VERSION;
  records: OfflineSaleRecord[];
}

let storageLock: Promise<unknown> = Promise.resolve();

const QUEUE_STATES = new Set<OfflineSaleQueueState>([
  'STAGED',
  'UNKNOWN',
  'SYNCING',
  'NEEDS_REVIEW',
]);

function isOfflineSaleRecord(value: unknown): value is OfflineSaleRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<OfflineSaleRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.serverUrl === 'string' &&
    (record.deviceId === undefined || typeof record.deviceId === 'string') &&
    typeof record.branchId === 'string' &&
    (record.shiftId === undefined || typeof record.shiftId === 'string') &&
    typeof record.cashierUserId === 'string' &&
    typeof record.tenderedAt === 'string' &&
    typeof record.total === 'number' &&
    Number.isFinite(record.total) &&
    record.total >= 0 &&
    Boolean(record.state && QUEUE_STATES.has(record.state)) &&
    typeof record.attempts === 'number' &&
    Number.isInteger(record.attempts) &&
    record.attempts >= 0 &&
    Boolean(record.payload && typeof record.payload === 'object') &&
    Array.isArray(record.payload?.lines) &&
    Array.isArray(record.payload?.payments)
  );
}

function recordFingerprint(record: OfflineSaleRecord): string {
  return offlineRequestFingerprint({
    id: record.id,
    serverUrl: record.serverUrl,
    deviceId: record.deviceId ?? null,
    branchId: record.branchId,
    shiftId: record.shiftId ?? null,
    cashierUserId: record.cashierUserId,
    tenderedAt: record.tenderedAt,
    total: record.total,
    payload: record.payload,
  });
}

async function readUnlocked(): Promise<OfflineSaleRecord[]> {
  const credential = await Keychain.getGenericPassword({ service: SERVICE });
  if (!credential) return [];
  try {
    const parsed = JSON.parse(
      credential.password,
    ) as Partial<OfflineSaleEnvelope>;
    if (
      parsed.version !== 1 &&
      parsed.version !== 2 &&
      parsed.version !== OFFLINE_QUEUE_SCHEMA_VERSION
    )
      throw new Error('คิวออฟไลน์เป็นรุ่นที่แอปนี้ไม่รองรับ');
    if (!Array.isArray(parsed.records))
      throw new Error('โครงสร้างคิวออฟไลน์ไม่ถูกต้อง');
    for (const value of parsed.records) {
      if (!isOfflineSaleRecord(value))
        throw new Error('ข้อมูลรายการในคิวออฟไลน์ไม่ถูกต้อง');
      const record = value;
      if (record.id !== record.payload?.idempotencyKey) {
        throw new Error(
          'คิวออฟไลน์มีรหัสรายการไม่ตรงกัน กรุณาให้ผู้ดูแลตรวจสอบเครื่อง',
        );
      }
      if (parsed.version !== 1 && !record.requestFingerprint) {
        throw new Error(
          'คิวออฟไลน์ไม่มีข้อมูลตรวจสอบ กรุณาให้ผู้ดูแลตรวจสอบเครื่อง',
        );
      }
      if (
        record.requestFingerprint &&
        record.requestFingerprint !==
          (parsed.version === 2
            ? offlineRequestFingerprint(record.payload)
            : recordFingerprint(record))
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
    const removed = await Keychain.resetGenericPassword({ service: SERVICE });
    if (!removed) throw new Error('ล้างคิวออฟไลน์จากที่เก็บข้อมูลไม่สำเร็จ');
    return [];
  }
  const protectedRecords = records.map(record => {
    if (record.id !== record.payload.idempotencyKey) {
      throw new Error('รหัสรายการออฟไลน์ไม่ตรงกับคำขอขาย');
    }
    return {
      ...record,
      requestFingerprint: recordFingerprint(record),
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
  const stored = await Keychain.setGenericPassword(USERNAME, serialized, {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
  });
  if (!stored) throw new Error('บันทึกคิวออฟไลน์ลงที่เก็บข้อมูลไม่สำเร็จ');
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
    else {
      const existing = records[index];
      if (recordFingerprint(existing) !== recordFingerprint(record)) {
        throw new Error(
          'ห้ามเปลี่ยนข้อมูลรายการออฟไลน์ที่ใช้รหัสเดิม กรุณาให้ผู้ดูแลตรวจสอบเครื่อง',
        );
      }
      next[index] = record;
    }
    return writeUnlocked(next);
  });
}

export async function patchOfflineSale(
  id: string,
  patch: Partial<Pick<OfflineSaleRecord, 'state' | 'attempts' | 'lastError'>>,
): Promise<OfflineSaleRecord[]> {
  return locked(async () => {
    const records = await readUnlocked();
    if (!records.some(record => record.id === id)) {
      throw new Error('ไม่พบรายการที่ต้องแก้ในคิวออฟไลน์');
    }
    const next = records.map(record =>
      record.id === id
        ? {
            ...record,
            ...patch,
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
    if (records.length === 0) return [];
    const next = records.filter(record => record.id !== id);
    if (next.length === records.length) return records;
    return writeUnlocked(next);
  });
}

export function unresolvedOfflineSaleCount(
  records: OfflineSaleRecord[],
): number {
  return records.length;
}
