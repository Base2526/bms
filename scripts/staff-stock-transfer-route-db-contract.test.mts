import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

if (
  !["127.0.0.1", "localhost"].includes(process.env.POSTGRES_HOST ?? "") ||
  process.env.POSTGRES_DB !== "bms_requisition_test"
)
  throw new Error("Use isolated bms_requisition_test");
(globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url)
);
// Next bundles CJS named exports; native Node ESM needs an equivalent test-only bridge.
const jwtModule = pathToFileURL(require.resolve("jsonwebtoken")).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "jsonwebtoken" && context.conditions.includes("import"))
      return {
        url:
          "data:text/javascript," +
          encodeURIComponent(
            `import jwt from ${JSON.stringify(
              jwtModule
            )}; export default jwt; export const {sign,verify,decode}=jwt;`
          ),
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { GET, POST } = await import(
  "../apps/web/app/api/bms/inventory/transfers/route.ts"
);
const { query } = await import("../apps/web/lib/db.ts");
const { jwtSecret } = await import("../apps/web/lib/auth/token.ts");
const { NextRequest } = require("next/server");
const {
  requestAsyncStorage,
} = require("next/dist/client/components/request-async-storage.external.js");
const jwt = require("jsonwebtoken");
const tenant = randomUUID(),
  actor = randomUUID(),
  source = randomUUID(),
  dest = randomUUID();
const sku = `FAKE-ROUTE-${randomUUID()}`;
const token = (role = "Administrator") =>
  jwt.sign({ id: actor, tenant_id: tenant, role }, jwtSecret(), {
    expiresIn: "5m",
  });
const call = (
  method: "GET" | "POST",
  body?: unknown,
  session: string | null = token(),
  qs = ""
) =>
  requestAsyncStorage.run(
    {
      cookies: {
        get: (name: string) =>
          name === "ADMIN_COOKIE" && session ? { value: session } : undefined,
      },
    },
    () =>
      (method === "GET" ? GET : POST)(
        new NextRequest(`http://localhost/api/bms/inventory/transfers${qs}`, {
          method,
          ...(method === "POST"
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        })
      )
  );
test.before(async () => {
  await query(
    `INSERT INTO bms_tenants(id,name,slug) VALUES($1,'FAKE transfer route',$2)`,
    [tenant, `fake-${tenant}`]
  );
  await query(
    `INSERT INTO users(id,tenant_id,name,email,password_hash,role,role_id) SELECT $1,$2,'FAKE route user',$3,'disabled','Administrator',id FROM roles WHERE name='Administrator'`,
    [actor, tenant, `${actor}@example.invalid`]
  );
  await query(
    `INSERT INTO bms_locations(id,tenant_id,code,name,branch_code) VALUES($1,$3,'SRC','FAKE source','00001'),($2,$3,'DST','FAKE dest','00002')`,
    [source, dest, tenant]
  );
  await query(
    `INSERT INTO bms_products(tenant_id,sku,name,price,active) VALUES($1,$2,'FAKE route goods',1,true)`,
    [tenant, sku]
  );
});
test("REST requires session + permission and validates body before service writes", async () => {
  for (const method of ["GET", "POST"] as const) {
    assert.equal((await call(method, {}, null)).status, 401);
    assert.equal(
      (await call(method, {}, token("FAKE no permissions"))).status,
      403
    );
  }
  assert.equal((await call("POST", null)).status, 400);
  assert.equal((await call("GET", undefined, token(), "?id=bad")).status, 400);
});
test("REST propagates stable keys, actor and branch scope with typed status codes", async () => {
  const input = {
    action: "create",
    fromLocationId: source,
    toLocationId: dest,
    items: [{ sku, size: "BASE", qty: 2 }],
    idempotencyKey: randomUUID(),
    commandScope: `${tenant}:${actor}`,
  };
  const count = async () =>
    Number(
      (
        await query(
          `SELECT count(*) n FROM bms_stock_transfers WHERE tenant_id=$1`,
          [tenant]
        )
      ).rows[0].n
    );
  const before = await count();
  for (const commandScope of [
    `${tenant}:${randomUUID()}`,
    `${randomUUID()}:${actor}`,
    null,
  ]) {
    const stale = await call("POST", { ...input, commandScope });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).status, "SCOPE_CHANGED");
  }
  assert.equal(
    await count(),
    before,
    "stale session preconditions must not write"
  );
  assert.equal(
    (await call("POST", { ...input, idempotencyKey: undefined })).status,
    400
  );
  const first = await call("POST", input);
  assert.equal(first.status, 200);
  const created = await first.json();
  assert.equal(created.status, "CREATED");
  assert.deepEqual(await (await call("POST", input)).json(), created);
  assert.equal(
    (await call("POST", { ...input, items: [{ sku, size: "BASE", qty: 3 }] }))
      .status,
    409
  );
  await query(
    `INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,
    [tenant, actor, dest]
  );
  assert.equal(
    (await call("POST", input)).status,
    403,
    "scope is rechecked on create replay"
  );
  const send = {
    action: "send",
    transferId: created.transferId,
    idempotencyKey: randomUUID(),
  };
  assert.equal(
    (
      await call("POST", {
        ...send,
        staffScope: false,
        actorUserId: randomUUID(),
        tenantId: randomUUID(),
      })
    ).status,
    403
  );
  assert.equal((await call("POST", { ...send, action: "cancel" })).status, 403);
  assert.equal(
    (await call("POST", { ...send, transferId: randomUUID() })).status,
    404
  );
  const listing = await (await call("GET")).json();
  assert.deepEqual(
    listing.locations.map((l: any) => l.id),
    [dest]
  );
  assert.equal(
    listing.transfers.length,
    1,
    "destination can read incoming draft"
  );
  assert.equal(listing.commandScope, `${tenant}:${actor}`);
  await query(
    `UPDATE bms_user_allowed_locations SET location_id=$3 WHERE tenant_id=$1 AND user_id=$2`,
    [tenant, actor, source]
  );
  const cancel = { ...send, action: "cancel", idempotencyKey: randomUUID() };
  assert.deepEqual(await (await call("POST", cancel)).json(), { status: "OK" });
  assert.deepEqual(await (await call("POST", cancel)).json(), { status: "OK" });
});
test.after(async () => {
  for (const table of [
    "bms_inventory_operation_idempotency",
    "bms_stock_transfer_items",
    "bms_stock_transfers",
    "bms_products",
    "bms_user_allowed_locations",
    "bms_locations",
    "bms_audit_log",
    "users",
    "bms_realtime_outbox",
  ])
    await query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
  await query(`DELETE FROM bms_tenants WHERE id=$1`, [tenant]);
});
