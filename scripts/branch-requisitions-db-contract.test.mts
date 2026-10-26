import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { query, getClient } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import {
  commandBranchRequisition,
  listBranchRequisitions,
  consolidateBranchRequisitions,
  requisitionCatalog,
  requisitionAvailability,
  requisitionEvents,
  requisitionMetrics,
  requisitionDemandRequests,
  requisitionNotices,
} from "../apps/web/lib/bms/branchRequisitions.ts";
import {
  sendStockTransfer,
  receiveStockTransfer,
  cancelStockTransfer,
} from "../apps/web/lib/bms/stockTransfers.ts";
import {
  bmsBranchRequisitionsResolvers,
  bmsBranchRequisitionsTypeDefs,
} from "../apps/web/graphql/bmsBranchRequisitions.ts";
import {
  createPurchaseOrder,
  cancelPurchaseOrder,
} from "../apps/web/lib/bms/purchase.ts";
import { createStockTransfer } from "../apps/web/lib/bms/stockTransfers.ts";
import { listStockTransfers } from "../apps/web/lib/bms/stockTransfers.ts";
import { commandStaffStockTransfer } from "../apps/web/lib/bms/staffStockTransfers.ts";
import { bmsMobileOperationsResolvers } from "../apps/web/graphql/bmsMobileOperations.ts";
import { deleteTenant } from "../apps/web/lib/bms/platform.ts";
import { requisitionNotificationRecipients } from "../apps/web/lib/bms/branchRequisitionNotify.ts";

if (
  !["localhost", "127.0.0.1"].includes(process.env.POSTGRES_HOST ?? "") ||
  process.env.POSTGRES_DB !== "bms_requisition_test"
)
  throw new Error("Use the isolated bms_requisition_test database");
const tenant = randomUUID(),
  otherTenant = randomUUID(),
  actor = randomUUID(),
  restricted = randomUUID(),
  source = randomUUID(),
  destination = randomUUID();
const scope = { tenantId: tenant, actorId: actor };
const { buildSchema, graphql } = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
)("./node_modules/graphql/index.js");
const gqlSchema = buildSchema(
  `type Query { _empty: String } type Mutation { _empty: String } ${bmsBranchRequisitionsTypeDefs}`,
);
const gqlRoot = Object.fromEntries(
  Object.entries({
    ...bmsBranchRequisitionsResolvers.Query,
    ...bmsBranchRequisitionsResolvers.Mutation,
  }).map(([name, resolve]) => [
    name,
    (args: any, ctx: any) => (resolve as any)(null, args, ctx),
  ]),
);
const sku = `FAKE-REQ-${randomUUID().slice(0, 8)}`;
const cmd = (input: any, s = scope) =>
  commandBranchRequisition(s, {
    idempotencyKey: randomUUID(),
    confirmed: true,
    ...input,
  });
const get = async (id: string) =>
  (await listBranchRequisitions(scope, { id }, true)).rows[0];
const line = (qty: number) => ({ sku, size: "BASE", qty });
async function approved(qty = 10) {
  const r = await cmd({
    action: "SAVE",
    locationId: destination,
    items: [line(qty)],
  });
  assert.equal(r.status, "OK");
  assert.equal(
    (await cmd({ action: "SUBMIT", id: r.id, version: 1 })).status,
    "OK",
  );
  assert.equal(
    (await cmd({ action: "REVIEW", id: r.id, version: 2, items: [line(qty)] }))
      .status,
    "OK",
  );
  return r.id!;
}
test.before(async () => {
  await query(
    `INSERT INTO bms_tenants(id,name,slug) VALUES($1,'FAKE requisition test',$2),($3,'FAKE other requisition test',$4)`,
    [tenant, `fake-req-${tenant}`, otherTenant, `fake-req-${otherTenant}`],
  );
  await query(
    `INSERT INTO users(id,tenant_id,name,email,password_hash,role,role_id) SELECT $1,$2,'FAKE request manager',$3,'disabled','Administrator',id FROM roles WHERE name='Administrator'`,
    [actor, tenant, `${actor}@example.invalid`],
  );
  await query(
    `INSERT INTO users(id,tenant_id,name,email,password_hash,role,role_id) SELECT $1,$2,'FAKE request branch user',$3,'disabled','Warehouse',id FROM roles WHERE name='Warehouse'`,
    [restricted, tenant, `${restricted}@example.invalid`],
  );
  await query(
    `INSERT INTO bms_locations(id,tenant_id,code,name,branch_code) VALUES($1,$3,'REQ-SOURCE','FAKE request source','00001'),($2,$3,'REQ-DEST','FAKE request destination','00002')`,
    [source, destination, tenant],
  );
  await query(
    `INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,
    [tenant, restricted, source],
  );
  await query(
    `INSERT INTO bms_products(tenant_id,sku,name,price,active) VALUES($1,$2,'FAKE request goods',10,true)`,
    [tenant, sku],
  );
  await query(
    `INSERT INTO bms_product_variants(tenant_id,product_sku,code) VALUES($1,$2,'BASE') ON CONFLICT DO NOTHING`,
    [tenant, sku],
  );
  await query(
    `INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock) VALUES($1,$2,$3,'BASE',1000,10)`,
    [tenant, source, sku],
  );
});

test("blank or padded-short idempotency keys fail before writing", async () => {
  const before = (await listBranchRequisitions(scope)).total;
  for (const idempotencyKey of ["        ", "       a", "\t\t\t\t\t\t\t\t"]) {
    assert.equal(
      (
        await cmd({
          action: "SAVE",
          locationId: destination,
          items: [line(1)],
          idempotencyKey,
        })
      ).status,
      "INVALID_INPUT",
    );
  }
  assert.equal((await listBranchRequisitions(scope)).total, before);
  const token = randomUUID();
  const input = {
    action: "SAVE",
    locationId: destination,
    items: [line(1)],
    idempotencyKey: ` ${token} `,
  };
  const saved = await cmd(input);
  assert.equal(saved.status, "OK");
  assert.deepEqual(await cmd({ ...input, idempotencyKey: token }), saved);
});

test("cancelled partially-received POs retain irreversible procurement evidence", async () => {
  const id = await approved(4);
  const po = await createPurchaseOrder({
    tenantId: tenant,
    items: [{ ...line(4), unitCost: 10 }],
  });
  if (po.status !== "CREATED") throw new Error("PO fixture failed");
  assert.equal(
    (
      await cmd({
        action: "LINK_PO",
        id,
        version: 3,
        poId: po.poId,
        items: [line(4)],
      })
    ).status,
    "OK",
  );
  // Simulate receipt evidence only; this test does not claim stock movement coverage.
  await query(
    `UPDATE bms_purchase_order_items SET qty_received=2 WHERE tenant_id=$1 AND po_id=$2`,
    [tenant, po.poId],
  );
  await query(
    `UPDATE bms_purchase_orders SET status='PARTIAL' WHERE tenant_id=$1 AND id=$2`,
    [tenant, po.poId],
  );
  assert.equal(await cancelPurchaseOrder(tenant, po.poId, actor), true);
  assert.equal(
    (
      await cmd({
        action: "CANCEL",
        id,
        version: 4,
        note: "FAKE cancel after partial supplier receipt",
      })
    ).status,
    "LINKED_WORK_OPEN",
  );
  const second = await createPurchaseOrder({
    tenantId: tenant,
    items: [{ ...line(4), unitCost: 10 }],
  });
  if (second.status !== "CREATED") throw new Error("PO fixture failed");
  assert.equal(
    (
      await cmd({
        action: "LINK_PO",
        id,
        version: 4,
        poId: second.poId,
        items: [line(1)],
      })
    ).status,
    "OVER_ALLOCATED",
  );
  assert.equal(
    (await get(id)).items[0].received,
    0,
    "Supplier receipt is still not branch delivery",
  );
});

test("transfer writer normalization cannot leave an unlinked draft", async () => {
  const legacySku = `${sku} `,
    legacyLine = { sku: legacySku, size: "BASE", qty: 1 };
  await query(
    `INSERT INTO bms_products(tenant_id,sku,name,price) VALUES($1,$2,'FAKE legacy space SKU',10)`,
    [tenant, legacySku],
  );
  await query(
    `INSERT INTO bms_product_variants(tenant_id,product_sku,code) VALUES($1,$2,'BASE') ON CONFLICT DO NOTHING`,
    [tenant, legacySku],
  );
  await query(
    `INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock) VALUES($1,$2,$3,'BASE',10)`,
    [tenant, source, legacySku],
  );
  const draft = await cmd({
    action: "SAVE",
    locationId: destination,
    items: [legacyLine],
  });
  assert.equal(draft.status, "OK");
  await cmd({ action: "SUBMIT", id: draft.id, version: 1 });
  await cmd({
    action: "REVIEW",
    id: draft.id,
    version: 2,
    items: [legacyLine],
  });
  const count = async () =>
    (
      await query(
        `SELECT count(*)::int n FROM bms_stock_transfers WHERE tenant_id=$1`,
        [tenant],
      )
    ).rows[0].n;
  const before = await count();
  assert.equal(
    (
      await cmd({
        action: "TRANSFER",
        id: draft.id,
        version: 3,
        sourceId: source,
        items: [legacyLine],
      })
    ).status,
    "INVALID_INPUT",
  );
  assert.equal(await count(), before);
  assert.equal((await get(draft.id!)).version, 3);
});

test("draft, submit and partial review are retry-safe, versioned and scoped", async () => {
  const payload = {
    action: "SAVE",
    locationId: destination,
    neededOn: "2026-10-25",
    items: [line(10)],
    idempotencyKey: randomUUID(),
  };
  const created = await cmd(payload);
  assert.equal(created.status, "OK");
  assert.equal((await get(created.id!)).neededOn, "2026-10-25");
  assert.equal(
    (
      await cmd({
        action: "SUBMIT",
        id: created.id,
        version: 1,
        confirmed: false,
      })
    ).status,
    "CONFIRMATION_REQUIRED",
  );
  assert.deepEqual(await cmd(payload), created);
  assert.equal(
    (await cmd({ ...payload, items: [line(11)] })).status,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    (
      await cmd(
        { ...payload, idempotencyKey: randomUUID() },
        { tenantId: tenant, actorId: restricted },
      )
    ).status,
    "NOT_FOUND",
  );
  assert.equal(
    (
      await listBranchRequisitions(
        { tenantId: tenant, actorId: restricted },
        { id: created.id },
      )
    ).total,
    0,
  );
  assert.equal(
    (
      await listBranchRequisitions(
        { tenantId: otherTenant, actorId: actor },
        { id: created.id },
      )
    ).total,
    0,
  );
  assert.equal(
    (await cmd({ action: "SUBMIT", id: created.id, version: 99 })).status,
    "STALE_VERSION",
  );
  assert.equal(
    (await cmd({ action: "SUBMIT", id: created.id, version: 1 })).status,
    "OK",
  );
  assert.equal(
    (
      await cmd({
        action: "REVIEW",
        id: created.id,
        version: 2,
        items: [line(8)],
      })
    ).status,
    "REASON_REQUIRED",
  );
  const reviews = await Promise.all([
    cmd({
      action: "REVIEW",
      id: created.id,
      version: 2,
      items: [line(8)],
      note: "Only eight needed",
    }),
    cmd({ action: "REVIEW", id: created.id, version: 2, items: [line(10)] }),
  ]);
  assert.deepEqual(reviews.map((r) => r.status).sort(), [
    "OK",
    "STALE_VERSION",
  ]);
  assert.equal((await get(created.id!)).status, "APPROVED");
  assert.equal((await requisitionCatalog(scope, sku))[0].size, "BASE");
  assert.equal(
    (await requisitionAvailability(scope, sku, "BASE")).find(
      (l) => l.id === source,
    )?.available,
    990,
  );
});

test("transfer draft and request allocation commit together; receipt updates demand", async () => {
  const id = await approved();
  const payload = {
    action: "TRANSFER",
    id,
    version: 3,
    sourceId: source,
    items: [line(10)],
    idempotencyKey: randomUUID(),
  };
  const transfer = await cmd(payload);
  assert.equal(transfer.status, "OK");
  assert.ok(transfer.transferId);
  assert.deepEqual(await cmd(payload), transfer);
  assert.equal((await get(id)).items[0].drafts, 10);
  assert.equal((await get(id)).items[0].remaining, 0);
  assert.equal(
    (await cmd({ action: "CANCEL", id, version: 4, note: "Stop" })).status,
    "LINKED_WORK_OPEN",
  );
  assert.equal(
    (
      await sendStockTransfer({
        tenantId: tenant,
        transferId: transfer.transferId!,
        actorUserId: actor,
      })
    ).status,
    "OK",
  );
  assert.equal((await get(id)).items[0].transit, 10);
  assert.equal(
    (
      await receiveStockTransfer({
        tenantId: tenant,
        transferId: transfer.transferId!,
        actorUserId: actor,
      })
    ).status,
    "OK",
  );
  const received = await get(id);
  assert.equal(received.items[0].received, 10);
  assert.equal(received.items[0].status, "RECEIVED");
  assert.equal(
    (await cmd({ action: "CLOSE", id, version: 4, note: "Received in full" }))
      .status,
    "OK",
  );
});

test("cancelled transfer releases allocation; shortages create neither draft nor allocation", async () => {
  const id = await approved(1000);
  const failed = await cmd({
    action: "TRANSFER",
    id,
    version: 3,
    sourceId: source,
    items: [line(1000)],
  });
  assert.equal(failed.status, "INSUFFICIENT_STOCK");
  assert.equal((await get(id)).version, 3);
  assert.equal((await get(id)).items[0].transfers.length, 0);
  const t = await cmd({
    action: "TRANSFER",
    id,
    version: 3,
    sourceId: source,
    items: [line(2)],
  });
  assert.equal(t.status, "OK");
  await cancelStockTransfer({
    tenantId: tenant,
    transferId: t.transferId!,
    actorUserId: actor,
  });
  assert.equal((await get(id)).items[0].remaining, 1000);
  const demand = await consolidateBranchRequisitions(scope, sku);
  assert.ok(demand.rows[0].remaining >= 1000);
});

test("damaged/short delivery leaves unmet demand and replacement fulfils only good units", async () => {
  const id = await approved(10);
  const transfer = await cmd({
    action: "TRANSFER",
    id,
    version: 3,
    sourceId: source,
    items: [line(10)],
  });
  assert.equal(transfer.status, "OK");
  await sendStockTransfer({
    tenantId: tenant,
    transferId: transfer.transferId!,
    actorUserId: actor,
  });
  const itemId = (
    await query(
      `SELECT id FROM bms_stock_transfer_items WHERE tenant_id=$1 AND transfer_id=$2`,
      [tenant, transfer.transferId],
    )
  ).rows[0].id;
  const result = await receiveStockTransfer({
    tenantId: tenant,
    transferId: transfer.transferId!,
    actorUserId: actor,
    received: [
      {
        itemId: Number(itemId),
        qty: 7,
        damagedQty: 2,
        reason: "OTHER",
        note: "FAKE damaged and short shipment",
      },
    ],
  });
  assert.equal(result.status, "OK");
  const item = (await get(id)).items[0];
  assert.equal(item.received, 7);
  assert.equal(item.discrepancy, 3);
  assert.equal(item.remaining, 3);
  assert.equal(item.status, "EXCEPTION");
  assert.equal(
    (await requisitionEvents(scope, id)).filter(
      (e) => e.action === "TRANSFER_DISCREPANCY",
    ).length,
    1,
  );
  const replacement = await cmd({
    action: "TRANSFER",
    id,
    version: 4,
    sourceId: source,
    items: [line(3)],
  });
  assert.equal(replacement.status, "OK");
  await sendStockTransfer({
    tenantId: tenant,
    transferId: replacement.transferId!,
    actorUserId: actor,
  });
  await receiveStockTransfer({
    tenantId: tenant,
    transferId: replacement.transferId!,
    actorUserId: actor,
  });
  assert.equal((await get(id)).items[0].received, 10);
  assert.equal((await get(id)).items[0].remaining, 0);
});

test("lot/serial transfer policies fail without allocating stock", async () => {
  const id = await approved(1);
  await query(
    `UPDATE bms_products SET serial_tracked=true WHERE tenant_id=$1 AND sku=$2`,
    [tenant, sku],
  );
  try {
    assert.equal(
      (
        await cmd({
          action: "TRANSFER",
          id,
          version: 3,
          sourceId: source,
          items: [line(1)],
        })
      ).status,
      "UNSUPPORTED_TRANSFER",
    );
    assert.equal((await get(id)).items[0].transfers.length, 0);
  } finally {
    await query(
      `UPDATE bms_products SET serial_tracked=false WHERE tenant_id=$1 AND sku=$2`,
      [tenant, sku],
    );
  }
});

test("PO creation and link are atomic; PO receipts never claim branch fulfilment", async () => {
  const before = (
    await query(
      `SELECT count(*)::int AS n FROM bms_purchase_orders WHERE tenant_id=$1`,
      [tenant],
    )
  ).rows[0].n;
  const id = await approved(4);
  const supplier = (
    await query(
      `INSERT INTO bms_suppliers(tenant_id,name) VALUES($1,'FAKE request supplier') RETURNING id`,
      [tenant],
    )
  ).rows[0].id;
  const bad = await cmd({
    action: "CREATE_PO",
    id,
    version: 3,
    supplierId: supplier,
    items: [{ ...line(5), unitCost: 10 }],
  });
  assert.equal(bad.status, "OVER_ALLOCATED");
  assert.equal(
    (
      await query(
        `SELECT count(*)::int AS n FROM bms_purchase_orders WHERE tenant_id=$1`,
        [tenant],
      )
    ).rows[0].n,
    before,
  );
  const payload = {
    action: "CREATE_PO",
    id,
    version: 3,
    supplierId: supplier,
    items: [{ ...line(4), unitCost: 10 }],
    idempotencyKey: randomUUID(),
  };
  const po = await cmd(payload);
  assert.equal(po.status, "OK");
  assert.deepEqual(await cmd(payload), po);
  assert.equal((await get(id)).items[0].purchases.length, 1);
  assert.equal((await get(id)).items[0].received, 0);
  assert.equal(
    (await listBranchRequisitions(scope, { id })).rows[0].items[0].purchases
      .length,
    0,
  );
  const second = await approved(4);
  const contention = await Promise.all([
    cmd({
      action: "LINK_PO",
      id: second,
      version: 3,
      poId: po.poId,
      items: [line(1)],
    }),
    cmd({
      action: "LINK_PO",
      id: second,
      version: 3,
      poId: po.poId,
      items: [line(1)],
    }),
  ]);
  assert.deepEqual(
    contention.map((r) => r.status),
    ["OVER_ALLOCATED", "OVER_ALLOCATED"],
  );
  assert.equal((await get(second)).version, 3);
  // Extending an existing allocation is audited and bounded, not a unique-key exception.
  const large = await approved(8);
  const partial = await cmd({
    action: "CREATE_PO",
    id: large,
    version: 3,
    supplierId: supplier,
    items: [{ ...line(6), unitCost: 10 }],
  });
  const pi = (
    await query(
      `SELECT id FROM bms_purchase_order_items WHERE tenant_id=$1 AND po_id=$2`,
      [tenant, partial.poId],
    )
  ).rows[0].id;
  await query(
    `UPDATE bms_purchase_order_items SET qty_ordered=8 WHERE tenant_id=$1 AND id=$2`,
    [tenant, pi],
  );
  assert.equal(
    (
      await cmd({
        action: "LINK_PO",
        id: large,
        version: 4,
        poId: partial.poId,
        items: [line(2)],
      })
    ).status,
    "OK",
  );
  assert.equal((await get(large)).items[0].purchases[0].qty, 8);
});

test("invalid purchase precision and aggregate overflow return a business rejection without a PO", async () => {
  const id = await approved(1_000_000);
  const supplier = (
    await query(`SELECT id FROM bms_suppliers WHERE tenant_id=$1 LIMIT 1`, [
      tenant,
    ])
  ).rows[0].id;
  const count = async () =>
    (
      await query(
        `SELECT count(*)::int n FROM bms_purchase_orders WHERE tenant_id=$1`,
        [tenant],
      )
    ).rows[0].n;
  const before = await count();
  for (const [qty, unitCost] of [
    [1, 1.005],
    [1_000_000, 1_000_000],
  ]) {
    assert.equal(
      (
        await cmd({
          action: "CREATE_PO",
          id,
          version: 3,
          supplierId: supplier,
          items: [{ ...line(qty), unitCost }],
        })
      ).status,
      "INVALID_INPUT",
    );
  }
  assert.equal(await count(), before);
  assert.equal((await get(id)).version, 3);
});

test("concurrent PO links cannot exceed a shared PO; legacy creation still works", async () => {
  const a = await approved(4),
    b = await approved(4);
  const po = await createPurchaseOrder({
    tenantId: tenant,
    items: [{ ...line(6), unitCost: 12 }],
  });
  assert.equal(po.status, "CREATED");
  if (po.status !== "CREATED") throw new Error("PO fixture creation failed");
  const outcomes = await Promise.all(
    [a, b].map((id) =>
      cmd({
        action: "LINK_PO",
        id,
        version: 3,
        poId: po.poId,
        items: [line(4)],
      }),
    ),
  );
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [
    "OK",
    "OVER_ALLOCATED",
  ]);
  assert.equal(
    (await get(a)).items[0].purchases.length +
      (await get(b)).items[0].purchases.length,
    1,
  );
  assert.equal(
    (
      await createPurchaseOrder({
        tenantId: tenant,
        items: [{ sku: "FAKE-MISSING-SKU", size: "BASE", qty: 1, unitCost: 1 }],
      })
    ).status,
    "NOT_FOUND",
  );
});

test("RLS fails closed without tenant context and rejects a cross-tenant header", async () => {
  const c = await getClient();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE bms_app");
    assert.equal(
      (await c.query(`SELECT count(*)::int AS n FROM bms_branch_requisitions`))
        .rows[0].n,
      0,
    );
    await c.query("ROLLBACK");
    await beginTenantTx(c, otherTenant);
    await assert.rejects(
      c.query(
        `INSERT INTO bms_branch_requisitions(tenant_id,request_no,location_id,created_by) VALUES($1,'CROSS',$2,$3)`,
        [tenant, destination, actor],
      ),
      /row-level security/,
    );
    await c.query("ROLLBACK");
    await beginTenantTx(c, otherTenant);
    await assert.rejects(
      c.query(
        `INSERT INTO bms_branch_requisitions(tenant_id,request_no,location_id,created_by) VALUES($1,'CROSS-LOCATION',$2,$3)`,
        [otherTenant, destination, actor],
      ),
      /foreign key/,
    );
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});

test("real GraphQL execution preserves input, business status, permissions and read-error contracts", async () => {
  const contextValue = {
    admin: { id: actor, tenant_id: tenant },
    __bmsPerms: new Set([
      "inventory.requisition.view",
      "inventory.requisition.create",
    ]),
  };
  const run = (source: string, variableValues: any = {}) =>
    graphql({
      schema: gqlSchema,
      source,
      variableValues,
      contextValue,
      rootValue: gqlRoot,
    });
  const command = `mutation($input:BmsRequisitionCommandInput!) { bmsBranchRequisitionCommand(input:$input) { status id poId } }`;
  const input = {
    action: "SAVE",
    locationId: destination,
    items: [line(2)],
    idempotencyKey: randomUUID(),
    poId: randomUUID(),
  };
  const created = await run(command, { input });
  assert.equal(created.errors, undefined);
  assert.equal(created.data.bmsBranchRequisitionCommand.status, "OK");
  assert.equal(
    created.data.bmsBranchRequisitionCommand.poId,
    null,
    "An unrelated input cannot fabricate a linked PO result",
  );
  const id = created.data.bmsBranchRequisitionCommand.id;
  const queryText = `query($id:ID!) { bmsBranchRequisitions(filter:{id:$id}) { total rows { id status items { sku approved requested transfers { id } purchases { id } } } } }`;
  const read = await run(queryText, { id });
  assert.equal(read.errors, undefined);
  assert.equal(read.data.bmsBranchRequisitions.rows[0].items[0].approved, null);
  const invalidFilter = await run(queryText, { id: "malformed-id" });
  assert.equal(invalidFilter.errors?.[0]?.extensions.code, "BAD_USER_INPUT");
  const unconfirmed = await run(command, {
    input: { action: "SUBMIT", id, version: 1, idempotencyKey: randomUUID() },
  });
  assert.equal(unconfirmed.errors, undefined);
  assert.equal(
    unconfirmed.data.bmsBranchRequisitionCommand.status,
    "CONFIRMATION_REQUIRED",
  );
  const wrongShape = await run(command, {
    input: {
      ...input,
      items: [{ ...line(2), __typename: "BmsRequisitionProduct" }],
    },
  });
  assert.match(wrongShape.errors?.[0]?.message ?? "", /__typename/);
  const denied = await run(command, {
    input: {
      action: "REVIEW",
      id,
      version: 1,
      confirmed: true,
      idempotencyKey: randomUUID(),
      items: [line(2)],
    },
  });
  assert.equal(denied.errors?.[0]?.extensions.code, "FORBIDDEN");
});

test("resolver denies read and mutation without matching permissions", async () => {
  const ctx = {
    admin: { id: actor, tenant_id: tenant },
    __bmsPerms: new Set<string>(),
  };
  await assert.rejects(
    bmsBranchRequisitionsResolvers.Query.bmsBranchRequisitions(null, {}, ctx),
    /Forbidden|permission|สิทธิ์/i,
  );
  await assert.rejects(
    bmsBranchRequisitionsResolvers.Mutation.bmsBranchRequisitionCommand(
      null,
      { input: { action: "TRANSFER", idempotencyKey: randomUUID() } },
      ctx,
    ),
    /Forbidden|permission|สิทธิ์/i,
  );
});

test("decision audit failure rolls back the document and idempotency receipt", async () => {
  const before = (await listBranchRequisitions(scope)).total;
  // Restrict this temporary trigger to this test actor; it cannot affect another fixture.
  await query(
    `CREATE FUNCTION requisition_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor='${actor}' AND NEW.action='inventory.requisition.save' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$`,
  );
  await query(
    `CREATE TRIGGER requisition_test_fail_audit BEFORE INSERT ON bms_audit_log FOR EACH ROW EXECUTE FUNCTION requisition_test_fail_audit()`,
  );
  try {
    await assert.rejects(
      cmd({ action: "SAVE", locationId: destination, items: [line(1)] }),
      /test audit unavailable/,
    );
    assert.equal((await listBranchRequisitions(scope)).total, before);
  } finally {
    await query(`DROP TRIGGER requisition_test_fail_audit ON bms_audit_log`);
    await query(`DROP FUNCTION requisition_test_fail_audit()`);
  }
});

test("operational filters, metrics, demand drilldown and timeline respect branch scope", async () => {
  const branchScope = { tenantId: tenant, actorId: restricted };
  const empty = await requisitionMetrics(branchScope);
  assert.equal(empty.submittedRequests, 0);
  assert.equal(empty.medianReviewHours, null);
  const request = await cmd({
    action: "SAVE",
    locationId: source,
    neededOn: "2000-01-01",
    priority: "URGENT",
    note: "FAKE urgent",
    items: [line(4)],
  });
  assert.equal(request.status, "OK");
  assert.equal(
    (await cmd({ action: "SUBMIT", id: request.id, version: 1 })).status,
    "OK",
  );
  assert.equal(
    (
      await cmd({
        action: "REVIEW",
        id: request.id,
        version: 2,
        items: [{ ...line(2), note: "FAKE partial" }],
      })
    ).status,
    "OK",
  );
  const filtered = await listBranchRequisitions(branchScope, {
    priority: "URGENT",
    neededFrom: "1999-12-31",
    neededTo: "2000-01-02",
  });
  assert.deepEqual(
    filtered.rows.map((r) => r.id),
    [request.id],
  );
  assert.equal(filtered.rows[0].latestActor, "FAKE request manager");
  for (const f of [
    { neededFrom: "2026-02-30" },
    { neededFrom: "2026-10-24", neededTo: "2026-10-23" },
  ])
    await assert.rejects(() => listBranchRequisitions(scope, f), /date range/);
  const detail = await requisitionDemandRequests(branchScope, sku, "BASE");
  assert.equal(detail.total, 1);
  assert.equal(detail.rows[0].remaining, 2);
  assert.equal(
    (await requisitionDemandRequests(branchScope, sku, "WRONG")).total,
    0,
  );
  assert.equal(
    (await requisitionDemandRequests(branchScope, sku, "BASE", 20)).total,
    1,
  );
  assert.equal(
    (await requisitionDemandRequests(branchScope, sku, "BASE", 20)).rows.length,
    0,
  );
  let m = await requisitionMetrics(branchScope);
  assert.equal(m.submittedRequests, 1);
  assert.equal(m.requestedUnits, 4);
  assert.equal(m.approvedRequests, 1);
  assert.equal(m.partialRequests, 1);
  assert.equal(m.unallocatedUnits, 2);
  assert.equal(m.overdueRequests, 1);
  const beyond=await consolidateBranchRequisitions(branchScope,sku,20);
  assert.equal(beyond.total,1);assert.equal(beyond.rows.length,0);
  await query(
    `UPDATE bms_inventory SET current_stock=current_stock+10 WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='BASE'`,
    [tenant, destination, sku],
  );
  const transfer = await cmd({
    action: "TRANSFER",
    id: request.id,
    version: 3,
    sourceId: destination,
    items: [line(2)],
  });
  assert.equal(transfer.status, "OK");
  assert.equal(
    (
      await sendStockTransfer({
        tenantId: tenant,
        transferId: transfer.transferId!,
        actorUserId: actor,
      })
    ).status,
    "OK",
  );
  assert.equal(
    (
      await receiveStockTransfer({
        tenantId: tenant,
        transferId: transfer.transferId!,
        actorUserId: actor,
      })
    ).status,
    "OK",
  );
  const events = await requisitionEvents(branchScope, request.id!);
  assert.equal(events.filter((e) => e.action === "TRANSFER_SENT").length, 1);
  assert.equal(
    events.filter((e) => e.action === "TRANSFER_RECEIVED").length,
    1,
  );
  assert.equal(
    events.filter((e) => e.action === "TRANSFER_DISCREPANCY").length,
    0,
  );
  assert.equal(
    (
      await requisitionEvents(
        { tenantId: otherTenant, actorId: actor },
        request.id!,
      )
    ).length,
    0,
  );
  m = await requisitionMetrics(branchScope);
  assert.equal(m.receivedUnits, 2);
  assert.equal(m.approvedUnits, 2);
  assert.equal(m.overdueRequests, 0);
  assert.equal(m.unallocatedUnits, 0);
  assert.ok(m.medianFulfilmentHours >= 0);
  assert.equal(
    (await requisitionDemandRequests(branchScope, sku, "BASE")).total,
    0,
  );
  const shortfall=await cmd({action:"SAVE",locationId:source,items:[line(6)]});
  await cmd({action:"SUBMIT",id:shortfall.id,version:1});
  await cmd({action:"REVIEW",id:shortfall.id,version:2,items:[line(6)]});
  assert.equal((await cmd({action:"CLOSE",id:shortfall.id,version:3,note:"FAKE close shortfall"})).status,"OK");
  m=await requisitionMetrics(branchScope);
  assert.equal(m.approvedUnits,8);assert.equal(m.receivedUnits,2);
  assert.equal(m.unallocatedUnits,0);
  const pending=await cmd({action:"SAVE",locationId:source,neededOn:"2000-01-02",items:[line(3)]});
  await cmd({action:"SUBMIT",id:pending.id,version:1});
  m=await requisitionMetrics(branchScope);
  assert.equal(m.pendingReview,1);assert.equal(m.overdueRequests,1);
  await cmd({action:"CANCEL",id:pending.id,version:2,note:"FAKE cancel"});
  m=await requisitionMetrics(branchScope);
  assert.equal(m.pendingReview,0);assert.equal(m.overdueRequests,0);
  const ctx = {
    admin: { id: actor, tenant_id: tenant },
    tenantId: tenant,
    __bmsPerms: new Set(["inventory.requisition.view"]),
  };
  for (const fn of [
    bmsBranchRequisitionsResolvers.Query.bmsBranchRequisitionMetrics,
    bmsBranchRequisitionsResolvers.Query.bmsBranchRequisitionDemandRequests,
  ])
    await assert.rejects(
      () => (fn as any)(null, { sku, size: "BASE" }, ctx),
      (e: any) => e.extensions?.code === "FORBIDDEN",
    );
});

test("notification recipients and persisted reads require current tenant, branch and review access", async () => {
  const sourceRequest = (
    await listBranchRequisitions(scope, { locationId: source })
  ).rows[0];
  const destRequest = (
    await listBranchRequisitions(scope, { locationId: destination })
  ).rows[0];
  const input = {
    tenantId: tenant,
    actorId: actor,
    requestId: sourceRequest.id,
    kind: "SUBMIT" as const,
  };
  assert.deepEqual(await requisitionNotificationRecipients(input), []);
  await query(
    `INSERT INTO bms_role_permissions(tenant_id,role_id,permission)
    SELECT $1,role_id,p FROM users CROSS JOIN unnest(ARRAY['inventory.requisition.view','inventory.requisition.review']) p WHERE id=$2 ON CONFLICT DO NOTHING`,
    [tenant, restricted],
  );
  assert.deepEqual(
    (await requisitionNotificationRecipients(input)).map((r) => r.user_id),
    [restricted],
  );
  assert.deepEqual(
    await requisitionNotificationRecipients({
      ...input,
      requestId: destRequest.id,
    }),
    [],
  );
  assert.deepEqual(
    await requisitionNotificationRecipients({
      ...input,
      tenantId: otherTenant,
    }),
    [],
  );
  const notice = randomUUID();
  await query(
    `INSERT INTO notifications(id,user_id,type,title,message,entity_type,entity_id,data)
    VALUES($1,$2,'BMS_REQUISITION_ACTION','FAKE','FAKE','bms_requisition_action',$3,'{"kind":"SUBMIT"}')`,
    [notice, restricted, sourceRequest.id],
  );
  try {
    assert.deepEqual(
      (await requisitionNotices({ tenantId: tenant, actorId: restricted })).map(
        (n) => n.id,
      ),
      [notice],
    );
    assert.deepEqual(await requisitionNotices(scope), []);
    assert.deepEqual(
      await requisitionNotices({ tenantId: otherTenant, actorId: restricted }),
      [],
    );
  } finally {
    await query(`DELETE FROM notifications WHERE id=$1 AND user_id=$2`, [
      notice,
      restricted,
    ]);
    await query(
      `DELETE FROM bms_role_permissions WHERE tenant_id=$1 AND role_id=(SELECT role_id FROM users WHERE id=$2)`,
      [tenant, restricted],
    );
  }
});

test("authorized test-tenant purge removes only its requisition dependency graph", async () => {
  const user = randomUUID(),
    from = randomUUID(),
    to = randomUUID();
  await query(`UPDATE bms_tenants SET slug=$2 WHERE id=$1`, [
    otherTenant,
    `test-requisition-${otherTenant}`,
  ]);
  await query(
    `INSERT INTO users(id,tenant_id,name,email,password_hash,role,role_id) SELECT $1,$2,'FAKE purge user',$3,'disabled','Administrator',id FROM roles WHERE name='Administrator'`,
    [user, otherTenant, `${user}@example.invalid`],
  );
  await query(
    `INSERT INTO bms_locations(id,tenant_id,code,name,branch_code) VALUES($1,$3,'SOURCE','FAKE source','00001'),($2,$3,'DEST','FAKE destination','00002')`,
    [from, to, otherTenant],
  );
  await query(
    `INSERT INTO bms_products(tenant_id,sku,name,price) VALUES($1,$2,'FAKE purge goods',10)`,
    [otherTenant, sku],
  );
  await query(
    `INSERT INTO bms_product_variants(tenant_id,product_sku,code) VALUES($1,$2,'BASE') ON CONFLICT DO NOTHING`,
    [otherTenant, sku],
  );
  const s = { tenantId: otherTenant, actorId: user };
  const request = await cmd(
    { action: "SAVE", locationId: to, items: [line(4)] },
    s,
  );
  assert.equal(request.status, "OK");
  assert.equal(
    (await cmd({ action: "SUBMIT", id: request.id, version: 1 }, s)).status,
    "OK",
  );
  assert.equal(
    (
      await cmd(
        { action: "REVIEW", id: request.id, version: 2, items: [line(4)] },
        s,
      )
    ).status,
    "OK",
  );
  const po = await createPurchaseOrder({
    tenantId: otherTenant,
    items: [{ ...line(4), unitCost: 1 }],
  });
  if (po.status !== "CREATED") throw new Error("PO fixture failed");
  assert.equal(
    (
      await cmd(
        {
          action: "LINK_PO",
          id: request.id,
          version: 3,
          poId: po.poId,
          items: [line(4)],
        },
        s,
      )
    ).status,
    "OK",
  );
  const transfer = await createStockTransfer({
    tenantId: otherTenant,
    fromLocationId: from,
    toLocationId: to,
    items: [line(4)],
    createdBy: user,
  });
  if (transfer.status !== "CREATED") throw new Error("Transfer fixture failed");
  await query(
    `INSERT INTO bms_branch_requisition_transfers(tenant_id,item_id,transfer_item_id)
    SELECT $1,ri.id,ti.id FROM bms_branch_requisition_items ri CROSS JOIN bms_stock_transfer_items ti
    WHERE ri.tenant_id=$1 AND ri.requisition_id=$2 AND ti.tenant_id=$1 AND ti.transfer_id=$3`,
    [otherTenant, request.id, transfer.transferId],
  );
  const untouched = (await listBranchRequisitions(scope)).total;
  await deleteTenant(otherTenant);
  assert.equal(
    (
      await query(`SELECT count(*)::int AS n FROM bms_tenants WHERE id=$1`, [
        otherTenant,
      ])
    ).rows[0].n,
    0,
  );
  assert.equal((await listBranchRequisitions(scope)).total, untouched);
});

test("staff transfer scope: both ends for create, source for dispatch, destination for receipt, scope rechecked on replay", async () => {
  const user = randomUUID(), third = randomUUID();
  await query(`INSERT INTO users(id,tenant_id,name,email,password_hash,role,role_id)
    SELECT $1,$2,'FAKE scoped transfer user',$3,'disabled','Warehouse',id FROM roles WHERE name='Warehouse'`,
    [user,tenant,`${user}@example.invalid`]);
  await query(`INSERT INTO bms_locations(id,tenant_id,code,name,branch_code) VALUES($1,$2,'TRANSFER-THIRD','FAKE third','00003')`,[third,tenant]);
  await query(`INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,[tenant,user,source]);
  const create = {action:"create",fromLocationId:source,toLocationId:destination,items:[line(3)],idempotencyKey:randomUUID()};
  const run = (input: any, who = user) => commandStaffStockTransfer(tenant,who,input);
  assert.equal((await run(create)).status,"FORBIDDEN");
  const [a,b] = await Promise.all([run(create,actor),run(create,actor)]);
  assert.deepEqual(a,b);
  assert.equal(a.status,"CREATED");
  if(a.status!=="CREATED") throw new Error("fixture");
  const hidden = await run({...create,fromLocationId:destination,toLocationId:third,idempotencyKey:randomUUID()},actor);
  if(hidden.status!=="CREATED") throw new Error("fixture");
  assert.equal((await listStockTransfers(tenant,null,200,a.transferId,null,user)).length,1);
  assert.equal((await listStockTransfers(tenant,null,200,hidden.transferId,null,user)).length,0);
  assert.equal((await listStockTransfers(tenant,null,200,a.transferId,null,actor)).length,1);
  assert.equal((await run({...create,toLocationId:randomUUID()},actor)).status,"FORBIDDEN");
  assert.equal((await commandStaffStockTransfer(randomUUID(),actor,{action:"send",transferId:a.transferId,idempotencyKey:randomUUID()})).status,"NOT_FOUND");
  const transferId=a.transferId;
  const send={action:"send",transferId,idempotencyKey:randomUUID()};
  const receive={action:"receive",transferId,idempotencyKey:randomUUID()};
  assert.equal((await run(receive)).status,"FORBIDDEN");
  const stock = async (location: string) => Number((await query(`SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='BASE'`,[tenant,location,sku])).rows[0]?.current_stock ?? 0);
  const sourceBefore=await stock(source), destBefore=await stock(destination);
  assert.deepEqual(await Promise.all([run(send),run(send)]),[{status:"OK"},{status:"OK"}]);
  assert.equal(await stock(source),sourceBefore-3);
  await query(`UPDATE bms_user_allowed_locations SET location_id=$3 WHERE tenant_id=$1 AND user_id=$2`,[tenant,user,destination]);
  assert.equal((await run(send)).status,"FORBIDDEN","revoked source cannot replay success");
  assert.equal((await run({action:"cancel",transferId:hidden.transferId,idempotencyKey:randomUUID()})).status,"OK");
  assert.deepEqual(await Promise.all([run(receive),run(receive)]),[{status:"OK"},{status:"OK"}]);
  assert.equal(await stock(destination),destBefore+3);
  const audits=await query(`SELECT action,count(*)::int n FROM bms_audit_log WHERE tenant_id=$1 AND target=$2 GROUP BY action`,[tenant,transferId]);
  assert.equal(audits.rows.length,3);
  assert.ok(audits.rows.every(r=>r.n===1),"create/send/receive audited once");
  const movement=await query(`SELECT type,count(*)::int n FROM bms_stock_movements WHERE tenant_id=$1 AND note LIKE $2 GROUP BY type`,[tenant,`%${a.transferNo}%`]);
  assert.equal(movement.rows.length,2);
  assert.ok(movement.rows.every(r=>r.n===1));
  await query(`INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,[tenant,user,source]);
  assert.equal((await run(create)).status,"CONFLICT","another actor cannot reuse successful key");
  assert.equal((await run({...create,items:[line(4)]},actor)).status,"CONFLICT");
  await query(`UPDATE bms_user_allowed_locations SET location_id=$3 WHERE tenant_id=$1 AND user_id=$2 AND location_id=$4`,[tenant,user,third,destination]);
  assert.equal((await run(receive)).status,"FORBIDDEN");
});

test("staff command boundary rejects malformed input and missing retry keys without writing", async () => {
  const count=async()=>Number((await query(`SELECT count(*) n FROM bms_stock_transfers WHERE tenant_id=$1`,[tenant])).rows[0].n);
  const before=await count();
  const create={action:"create",fromLocationId:source,toLocationId:destination,items:[line(1)],idempotencyKey:randomUUID()};
  for(const input of [null,[],{}, {...create,idempotencyKey:"   "},{...create,idempotencyKey:undefined},
    {...create,fromLocationId:"bad"},{...create,items:[null]},{...create,items:[line(1.2)]},
    {...create,items:[{...line(1),sku:5}]}, {action:"receive",transferId:randomUUID(),received:[null],idempotencyKey:randomUUID()}]) {
    assert.equal((await commandStaffStockTransfer(tenant,actor,input)).status,"INVALID");
  }
  assert.equal(await count(),before);
});

test("staff GraphQL named and compatibility adapters share scope, key replay and permission denial", async () => {
  const ctx={scope:"admin",admin:{id:actor,tenant_id:tenant},__bmsPerms:new Set(["inventory.transfer"])};
  const mutations=bmsMobileOperationsResolvers.Mutation as any;
  const input={fromLocationId:source,toLocationId:destination,items:[line(1)],idempotencyKey:randomUUID()};
  const result=await mutations.bmsCreateStockTransfer(null,{input},ctx);
  assert.equal(result.status,"CREATED");
  assert.deepEqual(await mutations.bmsStockTransfer(null,{input:{...input,action:"create"}},ctx),result);
  const cancel={transferId:result.transferId,idempotencyKey:randomUUID()};
  assert.deepEqual(await mutations.bmsCancelStockTransfer(null,cancel,ctx),{status:"OK"});
  assert.deepEqual(await mutations.bmsCancelStockTransfer(null,cancel,ctx),{status:"OK"});
  assert.equal((await mutations.bmsSendStockTransfer(null,{transferId:result.transferId},ctx)).status,"INVALID");
  const scoped={...ctx,admin:{id:restricted,tenant_id:tenant}};
  const {locations}=await bmsMobileOperationsResolvers.Query.bmsStockTransfers(null,{},scoped);
  assert.deepEqual(locations.map(l=>l.id),[source]);
  assert.equal((await mutations.bmsCreateStockTransfer(null,{input:{...input,idempotencyKey:randomUUID()}},scoped)).status,"FORBIDDEN");
  const denied={...ctx,__bmsPerms:new Set()};
  await assert.rejects(()=>mutations.bmsSendStockTransfer(null,cancel,denied),/Forbidden|permission|สิทธิ์/i);
  await assert.rejects(()=>bmsMobileOperationsResolvers.Query.bmsStockTransfers(null,{},denied),/Forbidden|permission|สิทธิ์/i);
});

test("transfer boundary rejects overflow and invalid receipt item identities without changing stock", async () => {
  const run=(input:any)=>commandStaffStockTransfer(tenant,actor,{idempotencyKey:randomUUID(),...input});
  const create={action:"create",fromLocationId:source,toLocationId:destination,items:[line(2)]};
  const before=Number((await query(`SELECT count(*) n FROM bms_stock_transfers WHERE tenant_id=$1`,[tenant])).rows[0].n);
  assert.equal((await run({...create,items:[line(2147483647),{...line(1),size:"base"}]})).status,"INVALID");
  assert.equal(Number((await query(`SELECT count(*) n FROM bms_stock_transfers WHERE tenant_id=$1`,[tenant])).rows[0].n),before);
  const a=await run(create),b=await run(create);
  if(a.status!=="CREATED" || b.status!=="CREATED") throw new Error("fixture");
  const item=Number((await query(`SELECT id FROM bms_stock_transfer_items WHERE tenant_id=$1 AND transfer_id=$2`,[tenant,a.transferId])).rows[0].id);
  const foreign=Number((await query(`SELECT id FROM bms_stock_transfer_items WHERE tenant_id=$1 AND transfer_id=$2`,[tenant,b.transferId])).rows[0].id);
  assert.equal((await run({action:"send",transferId:a.transferId})).status,"OK");
  for(const received of [[{itemId:foreign,qty:0}],[{itemId:item,qty:0},{itemId:item,qty:2}]]) {
    assert.equal((await run({action:"receive",transferId:a.transferId,received})).status,"INVALID");
    assert.equal((await receiveStockTransfer({tenantId:tenant,actorUserId:actor,transferId:a.transferId,received,idempotencyKey:randomUUID()})).status,"INVALID","native/internal callers share the identity guard");
    assert.equal((await listStockTransfers(tenant,null,1,a.transferId))[0].status,"IN_TRANSIT");
    assert.equal(Number((await query(`SELECT count(*) n FROM bms_audit_log WHERE tenant_id=$1 AND target=$2 AND action='inventory.transfer.receive'`,[tenant,a.transferId])).rows[0].n),0);
  }
  assert.equal((await run({action:"receive",transferId:a.transferId,received:[{itemId:item,qty:2}]})).status,"OK");
});

test.after(async () => {
  // Exact disposable tenant IDs only. No application/real tenant data is modified.
  for (const table of [
    "bms_branch_requisition_events",
    "bms_branch_requisition_transfers",
    "bms_branch_requisition_purchases",
    "bms_branch_requisition_items",
    "bms_branch_requisitions",
    "bms_inventory_operation_idempotency",
    "bms_stock_transfer_value_lines",
    "bms_inventory_value_events",
    "bms_inventory_value_balances",
    "bms_stock_movements",
    "bms_stock_transfer_items",
    "bms_stock_transfers",
    "bms_purchase_order_items",
    "bms_purchase_orders",
    "bms_suppliers",
    "bms_inventory",
    "bms_product_variants",
    "bms_products",
    "bms_user_allowed_locations",
    "bms_locations",
    "bms_audit_log",
    "users",
    "bms_realtime_outbox",
  ]) {
    const exists = await query(`SELECT to_regclass($1) AS table`, [table]);
    if (!exists.rows[0].table) continue;
    await query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`, [
      [tenant, otherTenant],
    ]);
  }
  await query(`DELETE FROM bms_tenants WHERE id=ANY($1::uuid[])`, [
    [tenant, otherTenant],
  ]);
});
