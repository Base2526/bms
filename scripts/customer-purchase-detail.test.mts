import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pointsEarnMessage } from "../apps/web/lib/pos/pointsEarnMessage.ts";
import { customerOrderDetailInTx } from "../apps/web/lib/bms/customers.ts";
import { customerOrderDetailErrorKey } from "../apps/web/components/customers/customerOrderDetailError.ts";

test("the actual UI query validates against the exported server schema", () => {
  const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const { buildSchema, parse, validate } = require("./node_modules/graphql/index.js");
  const component = readFileSync(new URL("../apps/web/components/customers/CustomerOrderDetail.tsx", import.meta.url), "utf8");
  const query = component.match(/const QUERY = gql`([\s\S]*?)`/)?.[1];
  assert.ok(query);
  const schema = buildSchema(readFileSync(new URL("../schema.graphql", import.meta.url), "utf8"));
  assert.deepEqual(validate(schema, parse(query)), []);
});

test("desktop zero-point messages cover every server reason and unknown/legacy responses", () => {
  const messages = ["PROGRAM_DISABLED", "BELOW_MIN_SPEND", "RATE_TOO_LOW", "NO_VISIT_POINTS"].map(pointsEarnMessage);
  assert.equal(new Set(messages).size, 4);
  for (const text of messages) assert.ok(text.length > 0);
  assert.ok(pointsEarnMessage(null));
  assert.equal(pointsEarnMessage("FUTURE_REASON"), pointsEarnMessage(undefined));
});

test("detail reads saved money and units with customer/tenant scope, not current product prices", async () => {
  let sql = "";
  let params: unknown[] = [];
  const row = { id: "FAKE-order", lines: [{ kind: "PRODUCT", saleQty: 2, qty: 12, lineAmount: 99.99, unitAmount: 50 }], points: [] };
  const client = { query: async (text: string, args: unknown[]) => {
    sql = text; params = args; return { rows: [row] };
  } };
  assert.equal(await customerOrderDetailInTx(client as any, "FAKE-tenant", "FAKE-customer", "FAKE-order"), row);
  assert.deepEqual(params, ["FAKE-tenant", "FAKE-customer", "FAKE-order"]);
  assert.match(sql, /o.tenant_id = \$1 AND o.customer_id = \$2 AND o.id = \$3/);
  assert.match(sql, /c.deleted_at IS NULL/);
  assert.match(sql, /'lineAmount', i.line_amount/);
  assert.match(sql, /'saleQty', COALESCE\(i.pack_qty, i.qty\)/);
  assert.match(sql, /'unitAmount', i.receipt_unit_price/);
  assert.match(sql, /e.tenant_id = o.tenant_id AND e.order_id = o.id/);
  assert.match(sql, /l.customer_id = o.customer_id/);
  assert.doesNotMatch(sql, /JOIN bms_products|i.qty\s*\*\s*i.unit_price/);
});

test("a missing or wrong-owner bill is null, while a database error remains an error", async () => {
  assert.equal(await customerOrderDetailInTx({ query: async () => ({ rows: [] }) } as any, "t", "c", "o"), null);
  await assert.rejects(customerOrderDetailInTx({ query: async () => { throw new Error("FAKE database failure"); } } as any, "t", "c", "o"), /FAKE database failure/);
});

test("detail read establishes tenant RLS, rolls back on failure and always releases", () => {
  const source = readFileSync(new URL("../apps/web/lib/bms/customers.ts", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export async function customerOrderDetail("), source.indexOf("export async function customerOrderDetailInTx("));
  assert.ok(fn.indexOf("beginTenantTx(client, tenantId)") < fn.indexOf("customerOrderDetailInTx(client"));
  assert.match(fn, /client.query\("COMMIT"\)/);
  assert.match(fn, /client.query\("ROLLBACK"\)/);
  assert.match(fn, /finally\s*\{\s*client.release\(\)/);
});

test("error copy distinguishes permission, schema and connection without leaking raw error text", () => {
  const key = (code?: string, networkError: unknown = null) => customerOrderDetailErrorKey({
    graphQLErrors: code ? [{ extensions: { code }, message: "FAKE SQL secret" }] : [], networkError,
  } as any);
  assert.equal(key("FORBIDDEN"), "admin_customers.detail_forbidden");
  assert.equal(key("GRAPHQL_VALIDATION_FAILED"), "admin_customers.detail_version_error");
  assert.equal(key(undefined, new Error("FAKE network failure")), "admin_customers.detail_connection_error");
  assert.equal(key(undefined, { statusCode: 403 }), "admin_customers.detail_forbidden");
  assert.equal(key(undefined, { statusCode: 400, result: { errors: [{ extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] } }), "admin_customers.detail_version_error");
  assert.equal(key("INTERNAL_SERVER_ERROR"), "admin_customers.detail_failed");
});

test("purchase detail is permission-gated, scoped to the authenticated tenant and validated", () => {
  const resolver = readFileSync(new URL("../apps/web/graphql/bmsCustomers.ts", import.meta.url), "utf8");
  const detail = resolver.slice(resolver.indexOf("async bmsCustomerOrderDetail"), resolver.indexOf("Mutation:"));
  assert.match(detail, /requirePermission\(ctx, "customer.view"\)/);
  assert.match(detail, /UUID_RE.test\(args.customerId\)/);
  assert.match(detail, /UUID_RE.test\(args.orderId\)/);
  assert.match(detail, /customerOrderDetail\(getTenantId\(ctx\), args.customerId, args.orderId\)/);
});
