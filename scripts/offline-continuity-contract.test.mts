import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  countOfflineQueue,
  normalizeOfflineStateAfterRestart,
  offlineRequestFingerprint,
  sortOfflineQueueOldestFirst,
  type OfflineQueueStateRecord,
} from "../packages/pos-client-core/src/offlineContinuity.ts";

const record = (
  id: string,
  state: OfflineQueueStateRecord["state"],
  tenderedAt = "2026-09-18T10:00:00.000Z"
): OfflineQueueStateRecord => ({ id, state, tenderedAt });

test("a process restart sends unfinished writes through unknown-result recovery", () => {
  assert.equal(
    normalizeOfflineStateAfterRestart(record("staged", "STAGED")).state,
    "UNKNOWN"
  );
  assert.equal(
    normalizeOfflineStateAfterRestart(record("syncing", "SYNCING")).state,
    "UNKNOWN"
  );
  assert.equal(
    normalizeOfflineStateAfterRestart(record("unknown", "UNKNOWN")).state,
    "UNKNOWN"
  );
  assert.equal(
    normalizeOfflineStateAfterRestart(record("review", "NEEDS_REVIEW")).state,
    "NEEDS_REVIEW"
  );
});

test("request fingerprint is canonical and detects a payload change", () => {
  const left = { payment: { amount: 100, method: "CASH" }, lines: ["A"] };
  const reordered = { lines: ["A"], payment: { method: "CASH", amount: 100 } };
  const changed = { lines: ["A"], payment: { method: "CASH", amount: 900 } };

  assert.equal(
    offlineRequestFingerprint(left),
    offlineRequestFingerprint(reordered)
  );
  assert.notEqual(
    offlineRequestFingerprint(left),
    offlineRequestFingerprint(changed)
  );
});

test("queue ordering and counts keep every accepted-cash record visible", () => {
  const rows = [
    record("review", "NEEDS_REVIEW", "2026-09-18T10:02:00.000Z"),
    record("syncing", "SYNCING", "2026-09-18T10:01:00.000Z"),
    record("pending", "UNKNOWN", "2026-09-18T10:00:00.000Z"),
  ];

  assert.deepEqual(
    sortOfflineQueueOldestFirst(rows).map((row) => row.id),
    ["pending", "syncing", "review"]
  );
  assert.deepEqual(countOfflineQueue(rows), {
    pending: 2,
    syncing: 1,
    review: 1,
    unresolved: 3,
  });
});

test("the sync center exposes recovery but no accepted-cash discard action", () => {
  const center = readFileSync(
    new URL(
      "../apps/mobile/src/components/OfflineSyncCenter.tsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(center, /retryRecord/);
  assert.match(center, /retryReview/);
  assert.match(center, /ยังไม่ใช่ใบเสร็จหรือเอกสารภาษี/);
  assert.doesNotMatch(center, /\bdiscard\b|removeOfflineSale|ลบทิ้ง/);
});
