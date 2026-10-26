import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  commandQuality,
  QUALITY_PERMISSIONS,
} from "../apps/web/lib/bms/operationQuality";
import { usableLotSql, usableStockSql } from "../apps/web/lib/bms/lotQuality";
import { BMS_PERMISSIONS } from "../apps/web/lib/bms/permissions";
test("quality input and confirmation fail before opening a database transaction", async () => {
  const s = {
    tenantId: "fake",
    actorId: "fake",
    permissions: new Set(BMS_PERMISSIONS),
  };
  for (const i of [null, {}, { action: "UNKNOWN" }])
    assert.equal((await commandQuality(s, i as any)).status, "INVALID_INPUT");
  assert.equal(
    (await commandQuality(s, { action: "CREATE" } as any)).status,
    "CONFIRMATION_REQUIRED",
  );
  assert.equal(
    (
      await commandQuality(s, {
        action: "CREATE",
        confirmed: true,
        note: "",
        idempotencyKey: "x",
      } as any)
    ).status,
    "INVALID_INPUT",
  );
  for (const action of Object.keys(QUALITY_PERMISSIONS))
    assert.equal(
      (
        await commandQuality({ ...s, permissions: new Set() }, {
          action,
          confirmed: true,
        } as any)
      ).status,
      "FORBIDDEN",
    );
  for (const [action, permission] of Object.entries(QUALITY_PERMISSIONS)) {
    const permissions = new Set(BMS_PERMISSIONS);
    permissions.delete(permission);
    assert.equal(
      (
        await commandQuality({ ...s, permissions }, {
          action,
          confirmed: true,
          note: "FAKE review",
          idempotencyKey: "fake",
        } as any)
      ).status,
      "FORBIDDEN",
      `${action} must check its own permission`,
    );
  }
});
test("quality SQL fragments are static scoped identifiers, never caller SQL", () => {
  for (const bad of ["a; DROP TABLE x", "x.y", "x  ", "", "A"]) {
    assert.throws(() => usableLotSql(bad));
    assert.throws(() => usableStockSql(bad));
  }
  assert.match(usableLotSql("l"), /qh.tenant_id=l.tenant_id/);
  assert.match(usableLotSql("l"), /status='ACTIVE'/);
  assert.match(usableStockSql("i"), /sum\(ql.qty\)<>i.current_stock THEN 0/);
  assert.match(usableStockSql("i"), /Asia\/Bangkok/);
});
test("quality schema preserves append-only evidence and independent restrictions", () => {
  const sql = readFileSync(
    new URL(
      "../db/migrations/10.98__bms_operation_quality.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE UPDATE,DELETE/);
  assert.match(sql, /WHERE status='ACTIVE'/);
  assert.match(sql, /WHERE status='PENDING'/);
  assert.match(sql, /run_id uuid/);
  assert.doesNotMatch(
    sql,
    /UPDATE bms_inventory SET|DELETE FROM bms_inventory/,
  );
});
