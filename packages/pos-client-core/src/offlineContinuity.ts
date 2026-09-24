/**
 * Platform-neutral state for a cash sale that was accepted while BMS was unreachable.
 *
 * This module owns client recovery mechanics only. It never decides that a sale is valid: the
 * authoritative POS service repeats pricing, stock, tax, shift and permission checks on sync.
 */
export const OFFLINE_QUEUE_SCHEMA_VERSION = 3 as const;

export type OfflineQueueState =
  | "STAGED"
  | "UNKNOWN"
  | "SYNCING"
  | "NEEDS_REVIEW";

export interface OfflineQueueStateRecord {
  id: string;
  tenderedAt: string;
  state: OfflineQueueState;
}

export interface OfflineQueueCounts {
  pending: number;
  syncing: number;
  review: number;
  unresolved: number;
}

/**
 * A process can stop after sending a command but before persisting its response. Both STAGED and
 * SYNCING therefore become UNKNOWN after restart so recovery checks the original key before retry.
 */
export function normalizeOfflineStateAfterRestart<
  T extends OfflineQueueStateRecord
>(record: T): T {
  if (record.state !== "STAGED" && record.state !== "SYNCING") return record;
  return { ...record, state: "UNKNOWN" };
}

export function sortOfflineQueueOldestFirst<T extends OfflineQueueStateRecord>(
  records: T[]
): T[] {
  return [...records].sort((left, right) => {
    const byTime = left.tenderedAt.localeCompare(right.tenderedAt);
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
  });
}

export function countOfflineQueue(
  records: OfflineQueueStateRecord[]
): OfflineQueueCounts {
  const review = records.filter(
    (record) => record.state === "NEEDS_REVIEW"
  ).length;
  const syncing = records.filter((record) => record.state === "SYNCING").length;
  return {
    pending: records.length - review,
    syncing,
    review,
    unresolved: records.length,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

/**
 * Detects accidental mutation/corruption inside the already encrypted queue. This is deliberately
 * not an authentication primitive; server validation and the idempotency request hash remain the
 * security boundary.
 */
export function offlineRequestFingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
