import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSupplierFields } from "../apps/web/lib/bms/supplierFields.ts";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const valid = { name: "FAKE Supplier", phone: "021234567", email: "shop@example.test",
  note: null, taxId: "1234567890123", branchCode: "00000", address: "Bangkok", entityType: "JURISTIC" as const };

test("supplier fields preserve omitted values and clear explicit null", () => {
  assert.deepEqual(normalizeSupplierFields({ name: "  New Supplier  " }), {
    name: "New Supplier", phone: null, email: null, note: null, taxId: null,
    branchCode: null, address: null, entityType: null,
  });
  assert.deepEqual(normalizeSupplierFields({ phone: null }, valid), { ...valid, phone: null });
  for (const input of [
    { name: "  " }, { name: "X", taxId: "123" }, { name: "X", branchCode: "12" },
    { name: "X", entityType: "UNKNOWN" as any }, { name: "X", email: "wrong" },
    { name: "X", phone: "123" },
  ]) assert.throws(() => normalizeSupplierFields(input));
});

function serviceHarness(auditFails = false, existing: typeof valid | null = null) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = { release() {}, async query(sql: string, params: unknown[] = []) {
    statements.push({ sql, params });
    if (sql.includes("FROM bms_suppliers") && sql.includes("FOR UPDATE")) {
      return existing ? { rowCount: 1, rows: [existing] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("INSERT INTO bms_suppliers")) return { rowCount: 1, rows: [{ id: "supplier-1" }] };
    if (sql.includes("UPDATE bms_suppliers")) return { rowCount: 1, rows: [{ id: "supplier-1" }] };
    if (sql.includes("INSERT INTO bms_audit_log") && auditFails) throw new Error("audit failed");
    return { rowCount: 1, rows: [] };
  } };
  const service = loadWithStubs("apps/web/lib/bms/purchase.ts", {
    "node:crypto": {},
    "@/lib/db": { getClient: async () => client, query: async () => { throw new Error("unexpected pool query"); } },
    "./movements": {}, "./locations": {}, "./lots": {},
    "./tenant": { beginTenantTx: async (_client: unknown, tenant: string, options: any) => {
      assert.equal(tenant, "tenant-from-session");
      assert.equal(options.editorId, "actor-from-session");
    } },
    "./restockSubscriptions": {}, "./realtimeOutbox": {}, "./idempotencyErrors": {},
    "./inventoryIdempotency": {}, "./supplierFields": { normalizeSupplierFields },
  });
  return { statements, upsertSupplier: service.upsertSupplier as Function };
}

test("supplier save binds tenant and actor; audit failure rolls back the insert", async () => {
  const ok = serviceHarness();
  const saved = await ok.upsertSupplier("tenant-from-session", valid, "actor-from-session");
  assert.equal(saved.id, "supplier-1");
  const insert = ok.statements.find((entry) => entry.sql.includes("INSERT INTO bms_suppliers"));
  assert.deepEqual(insert?.params, ["tenant-from-session", valid.name, valid.phone, valid.email,
    null, valid.taxId, valid.branchCode, valid.address, valid.entityType]);
  assert.match(ok.statements.at(-2)?.sql ?? "", /INSERT INTO bms_audit_log/);
  assert.equal(ok.statements.at(-1)?.sql, "COMMIT");
  const failure = serviceHarness(true);
  await assert.rejects(failure.upsertSupplier("tenant-from-session", valid, "actor-from-session"), /audit failed/);
  assert.equal(failure.statements.at(-1)?.sql, "ROLLBACK");
});

test("supplier updates cannot address another tenant's ID and keep omitted fields", async () => {
  const malformed = serviceHarness();
  await assert.rejects(malformed.upsertSupplier("tenant-from-session", { id: "malformed" }, "actor-from-session"), /รหัสผู้ขายไม่ถูกต้อง/);
  assert.equal(malformed.statements.length, 0);
  const foreign = serviceHarness();
  const foreignId = "00000000-0000-4000-8000-000000000002";
  await assert.rejects(foreign.upsertSupplier("tenant-from-session", { id: foreignId }, "actor-from-session"), /ไม่พบผู้ขาย/);
  assert.deepEqual(foreign.statements.find((entry) => entry.sql.includes("FOR UPDATE"))?.params,
    ["tenant-from-session", foreignId]);
  assert.ok(!foreign.statements.some((entry) => entry.sql.includes("UPDATE bms_suppliers")));
  assert.equal(foreign.statements.at(-1)?.sql, "ROLLBACK");
  const owned = serviceHarness(false, valid);
  const ownedId = "00000000-0000-4000-8000-000000000001";
  const updated = await owned.upsertSupplier("tenant-from-session", { id: ownedId, phone: null }, "actor-from-session");
  assert.equal(updated.phone, null);
  assert.equal(updated.taxId, valid.taxId);
  assert.deepEqual(owned.statements.find((entry) => entry.sql.includes("UPDATE bms_suppliers"))?.params?.at(-1), ownedId);
});

test("GraphQL denies supplier writes before service and derives tenant and actor", async () => {
  let allowed = false;
  const calls: unknown[][] = [];
  const resolvers = loadWithStubs("apps/web/graphql/bmsPurchase.ts", {
    "@/lib/bms/purchase": { upsertSupplier: async (...args: unknown[]) => { calls.push(args); return { id: "saved" }; } },
    "@/lib/bms/permissions": { requirePermission: async (_ctx: unknown, permission: string) => {
      assert.equal(permission, "purchase.edit");
      if (!allowed) throw new Error("forbidden");
    } },
    "@/lib/bms/tenant": { getTenantId: () => "tenant-from-session" },
    "@/lib/bms/audit": {},
    "@/lib/auth": { requireAuth: () => ({ author_id: "actor-from-session" }) },
    "@/lib/bms/locations": {},
  }).bmsPurchaseResolvers;
  await assert.rejects(resolvers.Mutation.bmsUpsertSupplier(null, { input: valid }, {}), /forbidden/);
  assert.equal(calls.length, 0);
  allowed = true;
  await resolvers.Mutation.bmsUpsertSupplier(null, { input: valid }, {});
  assert.deepEqual(calls[0], ["tenant-from-session", valid, "actor-from-session"]);
});
