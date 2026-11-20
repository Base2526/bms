import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const tenantId = "tenant-from-session";
const actorId = "actor-from-session";
const customerId = "00000000-0000-4000-8000-000000000021";
const addressId = "00000000-0000-4000-8000-000000000022";

function harness(options: { auditFails?: boolean; defaultFails?: boolean; points?: number; found?: boolean } = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = { release() {}, async query(sql: string, params: unknown[] = []) {
    statements.push({ sql, params });
    if (sql.includes("INSERT INTO bms_audit_log") && options.auditFails) throw new Error("audit failed");
    if (sql.includes("INSERT INTO bms_customers")) return { rowCount: 1, rows: [{ id: customerId }] };
    if (sql.includes("SELECT customer_id FROM bms_customer_addresses")) {
      return { rowCount: options.found === false ? 0 : 1, rows: options.found === false ? [] : [{ customer_id: customerId }] };
    }
    if (sql.includes("SELECT id FROM bms_customers")) return { rowCount: 1, rows: [{ id: customerId }] };
    if (sql.includes("SUM(l.points - l.consumed_points)")) return { rowCount: 1, rows: [{ usable: String(options.points ?? 0) }] };
    if (sql.includes("SET is_default=true") && options.defaultFails) throw new Error("default failed");
    if (sql.includes("RETURNING id")) return { rowCount: options.found === false ? 0 : 1,
      rows: options.found === false ? [] : [{ id: sql.includes("bms_customer_addresses") ? addressId : customerId }] };
    return { rowCount: 1, rows: [] };
  } };
  const service = loadWithStubs("apps/web/lib/bms/customers.ts", {
    "@/lib/db": { getClient: async () => client, query: async () => { throw new Error("unscoped pool write"); } },
    "./tenant": { beginTenantTx: async (_client: unknown, tenant: string, opts: any) => {
      assert.equal(tenant, tenantId);
      assert.equal(opts.editorId, actorId);
      statements.push({ sql: "BEGIN_TENANT_TX", params: [tenant, opts] });
    } },
    "./shippingZones": {}, "./customerIdentity": {}, "./customerMergeReview": {},
    "./thaiAddress": { resolveThaiAddressCodesInTx: async () => null },
  });
  return { service, statements };
}

test("customer create writes tenant, actor and audit in one transaction", async () => {
  const { service, statements } = harness();
  const saved = await service.upsertCustomer(tenantId, { name: "  FAKE Customer " }, actorId);
  assert.equal(saved.id, customerId);
  assert.deepEqual(statements.find(row => row.sql.includes("INSERT INTO bms_customers"))?.params,
    [tenantId, "FAKE Customer", null, null, []]);
  assert.deepEqual(statements.find(row => row.sql.includes("INSERT INTO bms_audit_log"))?.params,
    [tenantId, actorId, "customer.create", customerId]);
  assert.equal(statements.at(-1)?.sql, "COMMIT");
  const failure = harness({ auditFails: true });
  await assert.rejects(failure.service.upsertCustomer(tenantId, { name: "FAKE" }, actorId), /audit failed/);
  assert.equal(failure.statements.at(-1)?.sql, "ROLLBACK");
});

test("customer edits preserve omitted phone, note and tags; explicit null clears them", async () => {
  const omitted = harness();
  await omitted.service.upsertCustomer(tenantId, { id: customerId, name: "FAKE New Name" }, actorId);
  const update = omitted.statements.find(row => row.sql.includes("UPDATE bms_customers SET name="));
  assert.deepEqual(update?.params, [tenantId, customerId, "FAKE New Name",
    false, null, false, null, false, null]);
  const cleared = harness();
  await cleared.service.upsertCustomer(tenantId,
    { id: customerId, name: "FAKE New Name", phone: null, note: null, tags: null }, actorId);
  assert.deepEqual(cleared.statements.find(row => row.sql.includes("UPDATE bms_customers SET name="))?.params,
    [tenantId, customerId, "FAKE New Name", true, null, true, null, true, []]);
});

test("customer tags and address deletion use tenant transactions and audit only successful writes", async () => {
  const { service, statements } = harness();
  assert.equal(await service.setCustomerTags(tenantId, customerId, [" retail "], actorId), true);
  assert.deepEqual(statements.find(row => row.sql.includes("SET tags="))?.params,
    [tenantId, customerId, ["retail"]]);
  assert.ok(statements.some(row => row.params[2] === "customer.tags"));
  assert.equal(await service.deleteCustomerAddress(tenantId, addressId, actorId), true);
  assert.ok(statements.some(row => row.params[2] === "customer.address.delete"));
});

test("address update clears structured fields only when the caller explicitly supplies them", async () => {
  const omitted = harness();
  await omitted.service.updateCustomerAddress(tenantId, addressId, null, "FAKE address", actorId);
  const omittedParams = omitted.statements.find(row => row.sql.includes("UPDATE bms_customer_addresses SET label="))?.params;
  assert.deepEqual(omittedParams?.slice(-2), [false, false]);
  const cleared = harness();
  await cleared.service.updateCustomerAddress(tenantId, addressId, null, "FAKE address", actorId,
    { provinceCode: null, districtCode: null, subdistrictCode: null, postcode: null });
  const clearParams = cleared.statements.find(row => row.sql.includes("UPDATE bms_customer_addresses SET label="))?.params;
  assert.deepEqual(clearParams?.slice(-2), [true, true]);
  assert.deepEqual(clearParams?.slice(4, 11), [null, null, null, null, null, null, null]);
});

test("default address failure rolls back clearing the previous default", async () => {
  const { service, statements } = harness({ defaultFails: true });
  await assert.rejects(service.setDefaultCustomerAddress(tenantId, addressId, actorId), /default failed/);
  assert.ok(statements.some(row => row.sql.includes("SET is_default=false")));
  assert.equal(statements.at(-1)?.sql, "ROLLBACK");
  assert.ok(!statements.some(row => row.sql === "COMMIT"));
});

test("customer with usable points cannot be deleted; review and write share serializable tenant scope", async () => {
  const blocked = harness({ points: 12 });
  await assert.rejects(blocked.service.deleteCustomer(tenantId, customerId, actorId), /แต้มใช้ได้ค้างอยู่/);
  assert.equal((blocked.statements[0].params[1] as any).serializable, true);
  assert.ok(!blocked.statements.some(row => row.sql.includes("SET deleted_at=")));
  assert.equal(blocked.statements.at(-1)?.sql, "ROLLBACK");
  const allowed = harness();
  assert.equal(await allowed.service.deleteCustomer(tenantId, customerId, actorId), true);
  assert.ok(allowed.statements.some(row => row.params[2] === "customer.delete"));
  assert.equal(allowed.statements.at(-1)?.sql, "COMMIT");
});

test("GraphQL denies customer writes before service and passes session tenant and actor", async () => {
  let allowed = false;
  const calls: unknown[][] = [];
  const resolvers = loadWithStubs("apps/web/graphql/bmsCustomers.ts", {
    "graphql/error": { GraphQLError: Error },
    "@/lib/bms/customers": {
      upsertCustomer: async (...args: unknown[]) => { calls.push(args); return { id: customerId }; },
      setDefaultCustomerAddress: async (...args: unknown[]) => { calls.push(args); return { id: addressId }; },
    },
    "@/lib/bms/coupons": {}, "@/lib/bms/membership": {},
    "@/lib/bms/permissions": { requirePermission: async (_ctx: unknown, permission: string) => {
      assert.equal(permission, "customer.edit");
      if (!allowed) throw new Error("forbidden");
    } },
    "@/lib/bms/tenant": { getTenantId: () => tenantId },
    "@/lib/bms/audit": {}, "@/lib/bms/locations": {},
    "@/lib/auth": { requireAuth: () => ({ author_id: actorId }) },
    "@/lib/bms/customerMergeReview": {},
  }).bmsCustomersResolvers;
  await assert.rejects(resolvers.Mutation.bmsUpsertCustomer(null, { input: { name: "FAKE" } }, {}), /forbidden/);
  assert.equal(calls.length, 0);
  allowed = true;
  await resolvers.Mutation.bmsUpsertCustomer(null, { input: { name: "FAKE" } }, {});
  await resolvers.Mutation.bmsSetDefaultCustomerAddress(null, { addressId }, {});
  assert.deepEqual(calls, [[tenantId, { name: "FAKE" }, actorId], [tenantId, addressId, actorId]]);
});
