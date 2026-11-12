import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeQueueBoardMediaInput } from "../apps/web/lib/bms/queueBoardMedia";

const valid = () => ({ expectedVersion: 0, enabled: true, defaultFileId: 5,
  intervalSeconds: 8, transition: "FADE" as const,
  items: [{ fileId: 6, active: true, startsAt: "2026-11-12T00:00:00+07:00", endsAt: "2026-11-13T00:00:00+07:00" }] });

test("queue-board publication validates dates, versions and bounded unique image IDs", () => {
  const normalized = normalizeQueueBoardMediaInput(valid());
  assert.equal(normalized.items[0].startsAt, "2026-11-11T17:00:00.000Z");
  assert.equal(normalized.items[0].endsAt, "2026-11-12T17:00:00.000Z");
  assert.throws(() => normalizeQueueBoardMediaInput({ ...valid(), expectedVersion: -1 }), /โหลด/);
  assert.throws(() => normalizeQueueBoardMediaInput({ ...valid(), intervalSeconds: 3 }), /4-30/);
  assert.throws(() => normalizeQueueBoardMediaInput({ ...valid(), intervalSeconds: "8" as unknown as number }), /4-30/);
  assert.throws(() => normalizeQueueBoardMediaInput({ ...valid(), defaultFileId: true as unknown as number }), /รูปเริ่มต้น/);
  assert.throws(() => normalizeQueueBoardMediaInput({ ...valid(), items: Array.from({ length: 9 }, (_, i) =>
    ({ fileId: i + 1, active: true, startsAt: null, endsAt: null })) }), /8 รูป/);
  assert.throws(() => normalizeQueueBoardMediaInput({ ...valid(), items: [valid().items[0], valid().items[0]] }), /ซ้ำ/);
  assert.throws(() => normalizeQueueBoardMediaInput({ ...valid(), items: [{ ...valid().items[0], endsAt: "2026-11-11T00:00:00+07:00" }] }), /วันสิ้นสุด/);
  assert.throws(() => normalizeQueueBoardMediaInput({ ...valid(), items: [{ ...valid().items[0], startsAt: "not-a-date" }] }), /วันเริ่ม/);
  assert.throws(() => normalizeQueueBoardMediaInput({ ...valid(), items: [{ ...valid().items[0], startsAt: "2026-02-30T00:00:00+07:00" }] }), /วันเริ่ม/);
});

test("queue-board media migration isolates tenant rows and publication audits in the same transaction", () => {
  const migration = readFileSync(new URL("../db/migrations/10.115__bms_queue_board_media.sql", import.meta.url), "utf8");
  const service = readFileSync(new URL("../apps/web/lib/bms/queueBoardMedia.ts", import.meta.url), "utf8");
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /current_setting\('bms\.tenant_id'/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, location_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, file_id\)/);
  assert.match(service, /beginTenantTx\(client, tenantId, \{ editorId: actorId \}/);
  assert.match(service, /queue_board\.media_published/);
  assert.match(service, /await client\.query\("COMMIT"\)/);
});
