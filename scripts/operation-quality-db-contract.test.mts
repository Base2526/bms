import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { query, getClient } from "../apps/web/lib/db";
import { BMS_PERMISSIONS } from "../apps/web/lib/bms/permissions";
import {
  commandChecklist,
  checklistTx,
} from "../apps/web/lib/bms/operationChecklists";
import {
  commandQuality,
  runQualityFollowups,
} from "../apps/web/lib/bms/operationQuality";
import {
  qualityDetail,
  qualityWorkspace,
  qualityLots,
  readQualityTrace,
} from "../apps/web/lib/bms/operationQualityReads";
import {
  qualityStock,
  assertNoQualityHold,
} from "../apps/web/lib/bms/lotQuality";
import {
  receiveLotInTx,
  consumeLotsForWastageInTx,
} from "../apps/web/lib/bms/lots";
import { recordPosSale, processPosReturn, getPosVariantAvailable, listPosVariantChoices } from "../apps/web/lib/bms/pos";
import {
  createOrder,
  shipOrder,
  returnOrder,
} from "../apps/web/lib/bms/orders";
import { checkStock } from "../apps/web/lib/bms/stock";
import { availability } from "../apps/web/lib/bms/operationProductionReads";
import { operationWeeklyReport } from "../apps/web/lib/bms/operationImprovementReads";
import { bmsOperationQualityResolvers } from "../apps/web/graphql/bmsOperationQuality";
import {
  commandProduction,
  directProduct,
} from "../apps/web/lib/bms/operationProduction";
import { upsertProductRecipe } from "../apps/web/lib/bms/productRecipes";
import {
  confirmInventoryValue,
  inventoryValuation,
} from "../apps/web/lib/bms/inventoryValuation";
import { adjustStock } from "../apps/web/lib/bms/products";
import { recordInventoryWastage } from "../apps/web/lib/bms/wastage";
import {
  createStockTransfer,
  sendStockTransfer,
} from "../apps/web/lib/bms/stockTransfers";
import {
  createStockCount,
  recordCountItem,
  applyStockCount,
} from "../apps/web/lib/bms/stockCounts";
import {
  withCostingFixture,
  assertCostingTestDatabase,
  withAuditFailure,
} from "./testing/restaurantCostingFixture.mts";
test.before(async () => {
  await assertCostingTestDatabase();
  const sql = readFileSync(
    new URL(
      "../db/migrations/10.98__bms_operation_quality.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await query(sql);
  await query(sql);
});
async function fixture(work: (f: any) => Promise<void>) {
  await withCostingFixture(async (f) => {
    try {
      const s = {
        tenantId: f.tenant,
        actorId: f.actor,
        permissions: new Set(BMS_PERMISSIONS),
      };
      await query(`UPDATE bms_tenants SET plan='business' WHERE id=$1`, [
        f.tenant,
      ]);
      await f.product("FAKE-H", 2);
      await query(
        `INSERT INTO bms_store_capabilities(tenant_id,capability,enabled) VALUES($1,'WASTAGE',true)`,
        [f.tenant],
      );
      const lots = [];
      for (const [lotNo, qty] of [
        ["FAKE-A", 600],
        ["FAKE-B", 400],
      ] as const)
        lots.push(
          await checklistTx(s, (c) =>
            receiveLotInTx(c, {
              tenantId: f.tenant,
              locationId: f.location,
              productSku: "FAKE-H",
              size: "BASE",
              lotNo,
              qty,
              unitCost: 2,
              expiryDate: "2099-01-01",
            }),
          ),
        );
      const t = await commandChecklist(s, {
        action: "SAVE_TEMPLATE",
        idempotencyKey: randomUUID(),
        locationId: f.location,
        name: "FAKE quality",
        category: "PREP",
        separateReviewer: true,
        items: [
          {
            key: "quality",
            label: "Quality",
            type: "PASS_FAIL",
            required: true,
            photoRequired: false,
            allowNa: false,
            instruction: "Inspect",
            choices: [],
          },
        ],
      });
      assert.equal(t.status, "OK", JSON.stringify(t));
      assert.equal(
        (
          await commandChecklist(s, {
            action: "PUBLISH",
            id: t.id,
            version: 1,
            confirmed: true,
            idempotencyKey: randomUUID(),
          })
        ).status,
        "OK",
      );
      const reviewer = { ...s, actorId: f.approver };
      const cmd = (input: any, scope = s) =>
        commandQuality(scope, {
          confirmed: true,
          idempotencyKey: randomUUID(),
          note: "FAKE quality decision",
          ...input,
        });
      const detail = (id: string) => qualityDetail(s, id);
      const act = async (
        id: string,
        action: string,
        input: any = {},
        scope = s,
      ) =>
        cmd(
          { id, version: (await detail(id)).version, action, ...input },
          scope,
        );
      const create = async (extra: any = {}) => {
        const r = await cmd({
          action: "CREATE",
          locationId: f.location,
          title: "FAKE suspect lot",
          category: "QUALITY",
          severity: "URGENT",
          facts: "FAKE damaged packaging",
          assignedTo: f.actor,
          dueAt: new Date(Date.now() - 60000).toISOString(),
          lotId: lots[0],
          expectedQty: 600,
          ...extra,
        });
        assert.equal(r.status, "OK", JSON.stringify(r));
        return r.id;
      };
      const review = async (id: string) => {
        assert.equal(
          (await act(id, "ASSIGN_RUN", { templateId: t.id })).status,
          "OK",
        );
        const d = await detail(id);
        let v = d.run.version;
        for (const action of ["RECORD", "SUBMIT", "APPROVE"]) {
          const r = await commandChecklist(
            action === "APPROVE" ? reviewer : s,
            {
              action,
              id: d.run.id,
              version: v,
              confirmed: true,
              idempotencyKey: randomUUID(),
              note: "FAKE verified",
              ...(action === "RECORD"
                ? { itemKey: "quality", value: "PASS" }
                : {}),
            } as any,
          );
          assert.equal(r.status, "OK", JSON.stringify(r));
          v = r.version!;
        }
        return v;
      };
      const propose = async (id: string, kind = "RELEASE", qty = 0) => {
        const d = await detail(id),
          h = d.holds.find((x: any) => x.status === "ACTIVE");
        const r = await act(id, `PROPOSE_${kind}`, {
          holdId: h.id,
          holdVersion: h.version,
          expectedQty: h.qty,
          qty,
          runVersion: d.run?.version,
        });
        assert.equal(r.status, "OK", JSON.stringify(r));
        return (await detail(id)).decisions[0];
      };
      const stock = () =>
        checklistTx(s, (c) =>
          qualityStock(c, f.tenant, f.location, "FAKE-H", "BASE"),
        );
      await work({
        ...f,
        template: t.id,
        s,
        reviewer,
        lots,
        cmd,
        detail,
        act,
        create,
        review,
        propose,
        stock,
      });
    } finally {
      for (const table of [
        "bms_operation_quality_events",
        "bms_operation_quality_decisions",
        "bms_operation_lot_holds",
        "bms_operation_quality_cases",
        "bms_stock_counts",
        "bms_operation_production_waste",
        "bms_operation_production_events",
        "bms_operation_production_inputs",
        "bms_operation_production",
        "bms_operation_team_notices",
        "bms_operation_notices",
        "bms_operation_escalations",
        "bms_operation_events",
        "bms_operation_results",
        "bms_operation_actions",
        "bms_operation_runs",
        "bms_operation_templates",
        "bms_operation_commands",
      ])
        await query(`DELETE FROM ${table} WHERE tenant_id=$1`, [f.tenant]);
    }
  });
}
test("POS availability and branch invalidation follow committed holds and release", () =>
  fixture(async (f) => {
    assert.equal(await getPosVariantAvailable(f.tenant, f.location, "FAKE-H", "BASE"), 1000);
    const id = await f.create();
    assert.equal(await getPosVariantAvailable(f.tenant, f.location, "FAKE-H", "BASE"), 400);
    assert.equal((await listPosVariantChoices(f.tenant, "FAKE-H", f.location))[0].available, 400);
    const notices = async () => (await query(
      `SELECT location_id, safe_payload FROM bms_realtime_outbox
       WHERE tenant_id=$1 AND entity_id=$2 AND event_type='inventory.changed'
         AND safe_payload->>'source'='operations.quality' ORDER BY id`,
      [f.tenant, f.lots[0]],
    )).rows;
    assert.deepEqual(await notices(), [{ location_id: f.location, safe_payload: { change: "HOLD", source: "operations.quality" } }]);
    await f.review(id);
    const proposal = await f.propose(id);
    assert.equal((await f.act(id, "APPROVE", { decisionId: proposal.id }, f.reviewer)).status, "OK");
    assert.equal(await getPosVariantAvailable(f.tenant, f.location, "FAKE-H", "BASE"), 1000);
    assert.deepEqual((await notices()).map((row: any) => row.safe_payload.change), ["HOLD", "RELEASE"]);
    assert.equal((await f.stock()).stock, 1000);
  }));

test("case findings and ownership remain editable without rewriting approved inspection evidence", () =>
  fixture(async (f) => {
    const id = await f.create();
    await f.review(id);
    const before = await f.detail(id);
    const r = await f.act(id, "UPDATE", {
      assignedTo: f.approver,
      dueAt: new Date(Date.now() + 3600000).toISOString(),
      hypothesis: "FAKE updated hypothesis",
      observedCause: "FAKE verified findings",
    });
    assert.equal(r.status, "OK");
    const after = await f.detail(id);
    assert.equal(after.assigned_to, f.approver);
    assert.equal(after.observed_cause, "FAKE verified findings");
    assert.deepEqual(after.run, before.run);
    const run = (
      await query(
        `SELECT assigned_to FROM bms_operation_runs WHERE tenant_id=$1 AND id=$2`,
        [f.tenant, before.run.id],
      )
    ).rows[0];
    assert.equal(run.assigned_to, f.actor);
  }));

test("stale proposal can be rejected after catalog eligibility changes without releasing or moving stock", () =>
  fixture(async (f) => {
    const id = await f.create();
    await f.review(id);
    const decision = await f.propose(id);
    await query(
      `UPDATE bms_products SET is_bundle=true WHERE tenant_id=$1 AND sku='FAKE-H'`,
      [f.tenant],
    );
    assert.equal(
      (await f.act(id, "APPROVE", { decisionId: decision.id }, f.reviewer))
        .status,
      "DIRECT_STOCK_REQUIRED",
    );
    assert.equal(
      (await f.act(id, "REJECT", { decisionId: decision.id }, f.reviewer))
        .status,
      "OK",
    );
    const d = await f.detail(id);
    assert.equal(d.decisions[0].status, "REJECTED");
    assert.equal(d.holds[0].status, "ACTIVE");
    assert.equal((await f.stock()).stock, 1000);
  }));

test("existing inactive variants can be quarantined and disposed without enabling them for sale", () =>
  fixture(async (f) => {
    await query(
      `UPDATE bms_product_variants SET active=false WHERE tenant_id=$1 AND product_sku='FAKE-H'`,
      [f.tenant],
    );
    await assert.rejects(
      () =>
        checklistTx(f.s, (c: any) =>
          directProduct(c, f.tenant, "FAKE-H", "BASE"),
        ),
      (e: any) => e.status === "DIRECT_STOCK_REQUIRED",
    );
    const id = await f.create();
    await f.review(id);
    const decision = await f.propose(id, "DISPOSE", 20);
    assert.equal(
      (await f.act(id, "APPROVE", { decisionId: decision.id }, f.reviewer))
        .status,
      "OK",
    );
    assert.equal((await f.stock()).stock, 980);
    assert.equal(
      (
        await query(
          `SELECT active FROM bms_product_variants WHERE tenant_id=$1 AND product_sku='FAKE-H'`,
          [f.tenant],
        )
      ).rows[0].active,
      false,
    );
  }));

test("hold changes availability only; POS consumes healthy FEFO and rejects held excess", () =>
  fixture(async (f) => {
    const id = await f.create();
    const st = await f.stock();
    assert.equal(st.stock, 1000);
    assert.equal(st.available, 400);
    assert.equal(st.reconciled, true);
    assert.equal(
      (
        await checklistTx(f.s, (c: any) =>
          availability(c, f.tenant, f.location, "FAKE-H", "BASE"),
        )
      ).available,
      400,
    );
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_stock_movements WHERE tenant_id=$1`,
          [f.tenant],
        )
      ).rows[0].count,
      "0",
    );
    await f.sale("FAKE-H", 2);
    assert.equal((await f.stock()).available, 398);
    assert.equal(
      (
        await query(
          `SELECT qty FROM bms_inventory_lots WHERE tenant_id=$1 AND id=$2`,
          [f.tenant, f.lots[0]],
        )
      ).rows[0].qty,
      600,
    );
    const r = await f.register();
    const denied = await recordPosSale({
      tenantId: f.tenant,
      deviceId: r.device,
      shiftId: r.shift,
      cashierUserId: f.actor,
      idempotencyKey: randomUUID(),
      lines: [{ sku: "FAKE-H", size: "BASE", packQty: 399 }],
      payments: [{ method: "CASH", amount: 42693, cashTendered: 42693 }],
    });
    assert.notEqual(denied.status, "SOLD");
    assert.equal((await f.stock()).stock, 998);
    await assert.rejects(
      () =>
        checklistTx(f.s, (c: any) =>
          assertNoQualityHold(c, f.tenant, f.location, "FAKE-H", "BASE"),
        ),
      /LOT_QUALITY_HOLD/,
    );
    assert.equal((await f.detail(id)).holds[0].status, "ACTIVE");
  }));
test("separate approval, replay and close; released expiry remains unavailable", () =>
  fixture(async (f) => {
    const id = await f.create();
    assert.equal(
      (await f.act(id, "PROPOSE_RELEASE")).status,
      "REVIEW_REQUIRED",
    );
    const version = await f.review(id);
    const d = await f.propose(id);
    assert.equal(
      (await f.act(id, "APPROVE", { decisionId: d.id })).status,
      "SEPARATE_REVIEW_REQUIRED",
    );
    const input = {
      action: "APPROVE",
      id,
      version: (await f.detail(id)).version,
      decisionId: d.id,
      idempotencyKey: randomUUID(),
    };
    const result = await f.cmd(input, f.reviewer);
    assert.equal(result.status, "OK");
    assert.deepEqual(await f.cmd(input, f.reviewer), result);
    assert.equal((await f.stock()).available, 1000);
    assert.equal(
      (
        await f.act(id, "SUBMIT", {
          runVersion: version,
          observedCause: "Verified packaging only",
        })
      ).status,
      "OK",
    );
    assert.equal(
      (await f.act(id, "CLOSE", { runVersion: version }, f.reviewer)).status,
      "OK",
    );
    await query(
      `UPDATE bms_inventory_lots SET expiry_date='2020-01-01' WHERE tenant_id=$1 AND id=$2`,
      [f.tenant, f.lots[0]],
    );
    assert.equal((await f.stock()).available, 400);
  }));
test("disposal uses canonical movement and valuation; audit failure rolls back; permission revoked replay denied", () =>
  fixture(async (f) => {
    const opening = (
      await inventoryValuation(f.tenant, f.actor, f.location)
    ).rows.find((x: any) => x.sku === "FAKE-H")!;
    await confirmInventoryValue(f.tenant, f.actor, {
      locationId: f.location,
      sku: "FAKE-H",
      size: "BASE",
      qty: opening.qty,
      version: opening.version,
      value: "2000",
      evidence: "FAKE opening cost",
      requestId: randomUUID(),
      confirmed: true,
    });
    const id = await f.create();
    await f.review(id);
    const d = await f.propose(id, "DISPOSE", 100);
    const input = {
      action: "APPROVE",
      id,
      version: (await f.detail(id)).version,
      decisionId: d.id,
      idempotencyKey: randomUUID(),
    };
    await withAuditFailure(f.tenant, "operations.quality.approve", () =>
      assert.rejects(() => f.cmd(input, f.reviewer), /TEST_COST_AUDIT_FAILURE/),
    );
    assert.equal((await f.stock()).stock, 1000);
    assert.equal((await f.detail(id)).decisions[0].status, "PENDING");
    const concurrent = await Promise.all([
      f.cmd(input, f.reviewer),
      f.cmd(input, f.reviewer),
    ]);
    assert.ok(concurrent.some((x) => x.status === "OK"));
    assert.ok(
      concurrent.every((x) => ["OK", "RETRY_REQUIRED"].includes(x.status)),
    );
    assert.equal((await f.cmd(input, f.reviewer)).status, "OK");
    const st = await f.stock();
    assert.equal(st.stock, 900);
    assert.equal(st.available, 400);
    assert.equal(st.reconciled, true);
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_stock_movements WHERE tenant_id=$1 AND type='WASTAGE'`,
          [f.tenant],
        )
      ).rows[0].count,
      "1",
    );
    const movement = (await f.detail(id)).decisions[0].movement_id;
    assert.ok(movement);
    assert.equal(
      (
        await query(
          `SELECT amount::text FROM bms_inventory_value_entries WHERE tenant_id=$1 AND movement_id=$2 AND kind='WASTAGE'`,
          [f.tenant, movement],
        )
      ).rows[0].amount,
      "200.000000",
    );
    const day = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
    });
    const report = await operationWeeklyReport(f.s, day, f.location);
    assert.equal(
      report.branches[0].sources.qualityDisposals[0].movement_id,
      movement,
    );
    const permissions = new Set(f.s.permissions);
    permissions.delete("stock.adjust");
    assert.equal(
      (await f.cmd(input, { ...f.reviewer, permissions })).status,
      "FORBIDDEN",
    );
  }));
test("stale quantity and replacement review cannot approve old decision even at identical run version", () =>
  fixture(async (f) => {
    const id = await f.create();
    await f.review(id);
    const d = await f.propose(id);
    await query(
      `UPDATE bms_inventory_lots SET qty=599 WHERE tenant_id=$1 AND id=$2`,
      [f.tenant, f.lots[0]],
    );
    assert.equal(
      (await f.act(id, "APPROVE", { decisionId: d.id }, f.reviewer)).status,
      "STOCK_CHANGED",
    );
    await query(
      `UPDATE bms_inventory_lots SET qty=600 WHERE tenant_id=$1 AND id=$2`,
      [f.tenant, f.lots[0]],
    );
    await f.review(id);
    assert.equal(
      (await f.act(id, "APPROVE", { decisionId: d.id }, f.reviewer)).status,
      "REVIEW_REQUIRED",
    );
    assert.equal(
      (await f.act(id, "REJECT", { decisionId: d.id }, f.reviewer)).status,
      "OK",
    );
  }));
test("zero quantity hold prevents closing; disposal never implicitly releases a lot", () =>
  fixture(async (f) => {
    const id = await f.create();
    const v = await f.review(id);
    const d = await f.propose(id, "DISPOSE", 600);
    assert.equal(
      (await f.act(id, "APPROVE", { decisionId: d.id }, f.reviewer)).status,
      "OK",
    );
    assert.equal(
      (await f.act(id, "SUBMIT", { runVersion: v, observedCause: "Discarded" }))
        .status,
      "OK",
    );
    assert.equal(
      (await f.act(id, "CLOSE", { runVersion: v }, f.reviewer)).status,
      "ACTIVE_HELD_STOCK",
    );
    assert.equal((await f.detail(id)).holds[0].status, "ACTIVE");
  }));
test("disabled wastage is a business rejection with no partial decision or stock change", () =>
  fixture(async (f) => {
    const id = await f.create();
    await f.review(id);
    const decision = await f.propose(id, "DISPOSE", 20);
    await query(
      `UPDATE bms_store_capabilities SET enabled=false WHERE tenant_id=$1 AND capability='WASTAGE'`,
      [f.tenant],
    );
    const before = await f.detail(id);
    assert.equal(
      (await f.act(id, "APPROVE", { decisionId: decision.id }, f.reviewer))
        .status,
      "WASTAGE_DISABLED",
    );
    assert.deepEqual(await f.detail(id), before);
    assert.equal((await f.stock()).stock, 1000);
  }));

test("findings-only edits do not increment the active canonical task; reassignment still uses canonical guards", () =>
  fixture(async (f) => {
    const id = await f.create();
    assert.equal(
      (await f.act(id, "ASSIGN_RUN", { templateId: f.template })).status,
      "OK",
    );
    const before = await f.detail(id);
    const input = {
      assignedTo: before.assigned_to,
      dueAt: new Date(before.due_at).toISOString(),
      observedCause: "FAKE findings",
    };
    assert.equal((await f.act(id, "UPDATE", input)).status, "OK");
    assert.deepEqual((await f.detail(id)).run, before.run);
    assert.equal(
      (await f.act(id, "UPDATE", { ...input, assignedTo: f.approver })).status,
      "OK",
    );
    assert.equal((await f.detail(id)).run.version, before.run.version + 1);
    assert.equal(
      (
        await query(
          `SELECT assigned_to FROM bms_operation_runs WHERE tenant_id=$1 AND id=$2`,
          [f.tenant, before.run.id],
        )
      ).rows[0].assigned_to,
      f.approver,
    );
  }));

test("cross-branch held return inherits restriction and invalidates prior review", () =>
  fixture(async (f) => {
    const sale = await f.sale("FAKE-H", 2);
    const id = await f.create({
      expectedQty: 598,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await f.review(id);
    const reg = await f.register(f.locations[1]);
    const r = await processPosReturn({
      tenantId: f.tenant,
      deviceId: reg.device,
      shiftId: reg.shift,
      orderId: sale.orderId,
      actorUserId: f.actor,
      approvedByUserId: f.approver,
      mode: "FULL",
      lines: [],
      note: "FAKE returned",
      idempotencyKey: randomUUID(),
    });
    assert.equal(r.status, "PARTIAL_RETURNED", JSON.stringify(r));
    const d = await f.detail(id);
    assert.equal(d.holds.length, 2);
    assert.equal(d.run, null);
    assert.equal(d.status, "OPEN");
    const notice = (
      await query(
        `SELECT count(*) FROM bms_operation_team_notices WHERE tenant_id=$1 AND entity_id=$2 AND kind='QUALITY_CHANGED' AND dedup_key=$3`,
        [f.tenant, id, `QUALITY_CHANGED:${id}:${d.version}`],
      )
    ).rows[0];
    assert.equal(
      notice.count,
      "1",
      "Return invalidation must notify immediately, not only after due time",
    );
    const trace = await readQualityTrace(f.s, f.lots[0]);
    assert.equal(
      (await readQualityTrace(f.s, f.lots[0])).fingerprint,
      trace.fingerprint,
    );
    assert.equal(trace.returns.length, 1);
    assert.equal(trace.sales.length, 1);
    assert.equal(trace.lots.length, 2);
    assert.equal(trace.coverage, "RECORDED_EVIDENCE_ONLY");
    await query(
      `INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,
      [f.tenant, f.actor, f.location],
    );
    const restricted = await readQualityTrace(f.s, f.lots[0]);
    assert.equal(restricted.restricted, true);
    assert.equal(restricted.lots.length, 1);
    assert.equal(restricted.returns.length, 0);
    await query(`DELETE FROM bms_user_allowed_locations WHERE tenant_id=$1`, [
      f.tenant,
    ]);
    assert.equal((await qualityLots(f.s, f.locations[1])).rows[0].held, true);
  }));
test("customer availability and online shipping recheck held lots after reservation; full return restores exact allocation", () =>
  fixture(async (f) => {
    await query(
      `INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface) VALUES($1,'FAKE-H','CUSTOMER_AI'),($1,'FAKE-H','ONLINE_ORDER') ON CONFLICT(tenant_id,product_sku,surface) DO UPDATE SET enabled=true`,
      [f.tenant],
    );
    const input = {
      tenantId: f.tenant,
      channel: "LINE" as const,
      customerRef: "FAKE-H-online",
      locationId: f.location,
      items: [{ sku: "FAKE-H", size: "BASE", qty: 500 }],
    };
    const created = await createOrder(input);
    assert.equal(created.status, "CREATED", JSON.stringify(created));
    const order = (created as any).orderId;
    await query(
      `UPDATE bms_orders SET status='PACKING',fulfillment_type='PICKUP' WHERE tenant_id=$1 AND id=$2`,
      [f.tenant, order],
    );
    const id = await f.create();
    const read = await checkStock(f.tenant, "FAKE-H", "BASE", f.location);
    assert.equal(read.status, "OUT_OF_STOCK");
    await assert.rejects(
      () => shipOrder(f.tenant, order),
      /INSUFFICIENT_USABLE_LOTS/,
    );
    assert.equal((await f.stock()).stock, 1000);
    assert.equal((await f.stock()).reserved, 500);
    await f.review(id);
    const d = await f.propose(id);
    assert.equal(
      (await f.act(id, "APPROVE", { decisionId: d.id }, f.reviewer)).status,
      "OK",
    );
    assert.equal(await shipOrder(f.tenant, order), true);
    assert.equal((await f.stock()).stock, 500);
    assert.equal((await f.stock()).reconciled, true);
    assert.equal(await returnOrder(f.tenant, order), true);
    assert.equal(await returnOrder(f.tenant, order), false);
    assert.equal((await f.stock()).stock, 1000);
    assert.equal((await f.stock()).reconciled, true);
  }));
test("GraphQL requires auth and server permissions before quality service", async () => {
  await assert.rejects(() =>
    bmsOperationQualityResolvers.Query.bmsQualityWorkspace(null, {}, {}),
  );
  await fixture(async (f) => {
    const ctx = {
      scope: "admin",
      admin: { id: f.actor, tenant_id: f.tenant, role: "Administrator" },
    };
    assert.equal(
      (
        await bmsOperationQualityResolvers.Query.bmsQualityWorkspace(
          null,
          {},
          ctx,
        )
      ).total,
      0,
    );
  });
});
test("generic adjustment, transfer and direct wastage cannot bypass an active quality hold", () =>
  fixture(async (f) => {
    await f.create();
    await assert.rejects(
      () =>
        adjustStock(
          f.tenant,
          "FAKE-H",
          "BASE",
          -1,
          "FAKE adjustment",
          f.actor,
          f.actor,
          f.location,
        ),
      /LOT_QUALITY_HOLD/,
    );
    await assert.rejects(() =>
      recordInventoryWastage({
        tenantId: f.tenant,
        locationId: f.location,
        productSku: "FAKE-H",
        size: "BASE",
        qty: 1,
        reason: "FAKE waste",
        actorUserId: f.actor,
        lotId: f.lots[0],
      }),
    );
    const transfer = await createStockTransfer({
      tenantId: f.tenant,
      fromLocationId: f.location,
      toLocationId: f.locations[1],
      createdBy: f.actor,
      items: [{ sku: "FAKE-H", size: "BASE", qty: 1 }],
    });
    assert.equal(transfer.status, "CREATED");
    assert.equal(
      (await sendStockTransfer({
          tenantId: f.tenant,
          transferId: (transfer as any).transferId,
          actorUserId: f.actor,
        })).status,
      "LOT_QUALITY_HOLD",
    );
    assert.equal((await f.stock()).stock, 1000);
    assert.equal((await f.stock()).available, 400);
    const count = await createStockCount({
      tenantId: f.tenant,
      locationId: f.location,
      createdBy: f.actor,
    });
    assert.equal(count.status, "CREATED");
    const countId = (count as any).countId;
    await recordCountItem({
      tenantId: f.tenant,
      countId,
      sku: "FAKE-H",
      size: "BASE",
      countedQty: 999,
      note: "FAKE count",
      actorUserId: f.actor,
    });
    assert.equal(
      (await applyStockCount({ tenantId: f.tenant, countId, actorUserId: f.actor })).status,
      "LOT_QUALITY_HOLD",
    );
    assert.equal((await f.stock()).stock, 1000);
  }));
test("recorded production lineage reaches output sale; held ingredients cannot post and held replenishment invalidates review", () =>
  fixture(async (f) => {
    for (const sku of ["FAKE-MENU", "FAKE-PREP"]) await f.product(sku, 2);
    await query(
      `UPDATE bms_inventory SET current_stock=0 WHERE tenant_id=$1 AND product_sku='FAKE-PREP'`,
      [f.tenant],
    );
    await query(
      `INSERT INTO bms_store_capabilities(tenant_id,capability,enabled) VALUES($1,'RECIPE',true)`,
      [f.tenant],
    );
    const recipe = await upsertProductRecipe(
      f.tenant,
      {
        productSku: "FAKE-MENU",
        size: "BASE",
        outputQty: 10,
        active: true,
        directItems: [{ sku: "FAKE-H", size: "BASE", qty: 20 }],
        sopSteps: ["Inspect"],
      },
      f.actor,
    );
    const pcommand = (i: any) =>
      commandProduction(f.s, {
        confirmed: true,
        idempotencyKey: randomUUID(),
        note: "FAKE production",
        ...i,
      });
    const ready = async (qty: number) => {
      const p = await pcommand({
        action: "CREATE",
        locationId: f.location,
        recipeId: recipe.id,
        outputSku: "FAKE-PREP",
        outputSize: "BASE",
        plannedQty: qty,
        templateId: f.template,
        assignedTo: f.actor,
        dueAt: new Date().toISOString(),
      });
      assert.equal(p.status, "OK", JSON.stringify(p));
      const r = await pcommand({
        action: "READY",
        id: p.id,
        version: p.version,
      });
      assert.equal(r.status, "OK");
      return r;
    };
    const p = await ready(10),
      day = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Bangkok",
      });
    assert.equal(
      (
        await pcommand({
          action: "POST",
          id: p.id,
          version: p.version,
          actualQty: 10,
          ingredients: [{ sku: "FAKE-H", size: "BASE", qty: 20 }],
          producedOn: day,
          expiryDate: "2099-01-01",
        })
      ).status,
      "OK",
    );
    await f.sale("FAKE-PREP", 1);
    const id = await f.create({ expectedQty: 580 });
    const trace = await readQualityTrace(f.s, f.lots[0]);
    assert.equal(trace.productions.length, 1);
    assert.equal(trace.productions[0].id, p.id);
    assert.equal(trace.lots.length, 2);
    assert.equal(trace.sales[0].sold_sku, "FAKE-PREP");
    const next = await ready(300),
      before = (await f.stock()).stock;
    assert.notEqual(
      (
        await pcommand({
          action: "POST",
          id: next.id,
          version: next.version,
          actualQty: 300,
          ingredients: [{ sku: "FAKE-H", size: "BASE", qty: 600 }],
          producedOn: day,
          expiryDate: "2099-01-01",
        })
      ).status,
      "OK",
    );
    assert.equal((await f.stock()).stock, before);
    await f.review(id);
    await checklistTx(f.s, async (c: any) => {
      await c.query(
        `UPDATE bms_inventory SET current_stock=current_stock+1 WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-H'`,
        [f.tenant, f.location],
      );
      await receiveLotInTx(c, {
        tenantId: f.tenant,
        locationId: f.location,
        productSku: "FAKE-H",
        size: "BASE",
        lotNo: "FAKE-A",
        qty: 1,
      });
    });
    assert.equal((await f.detail(id)).run, null);
    assert.equal((await f.stock()).available, 400);
    const latest = await f.detail(id);
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_operation_team_notices WHERE tenant_id=$1 AND entity_id=$2 AND dedup_key=$3`,
          [f.tenant, id, `QUALITY_CHANGED:${id}:${latest.version}`],
        )
      ).rows[0].count,
      "1",
    );
  }));
test("RBAC, malformed input, tenant isolation, notice dedup and saved trace evidence", () =>
  fixture(async (f) => {
    assert.equal(
      (await f.cmd({ action: "CREATE", confirmed: false })).status,
      "CONFIRMATION_REQUIRED",
    );
    assert.equal(
      (
        await f.cmd(
          { action: "CREATE" },
          {
            ...f.s,
            permissions: new Set(["operations.checklist.view", "product.view"]),
          },
        )
      ).status,
      "FORBIDDEN",
    );
    const id = await f.create();
    assert.equal((await qualityWorkspace(f.s)).total, 1);
    const trace = await readQualityTrace(f.s, f.lots[0]);
    assert.equal(
      (
        await f.act(id, "SAVE_TRACE", {
          lotId: f.lots[0],
          fingerprint: "wrong",
        })
      ).status,
      "SNAPSHOT_CHANGED",
    );
    assert.equal(
      (
        await f.act(id, "SAVE_TRACE", {
          lotId: f.lots[0],
          fingerprint: trace.fingerprint,
        })
      ).status,
      "OK",
    );
    assert.ok(
      (await f.detail(id)).events.find((x: any) => x.action === "SAVE_TRACE")
        .trace,
    );
    assert.equal((await runQualityFollowups(f.tenant)).failed, 0);
    await runQualityFollowups(f.tenant);
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_operation_team_notices WHERE tenant_id=$1 AND kind='QUALITY_OVERDUE'`,
          [f.tenant],
        )
      ).rows[0].count,
      "1",
    );
    await assert.rejects(() =>
      qualityDetail({ ...f.s, tenantId: randomUUID() }, id),
    );
    const c = await getClient();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE bms_app");
      await c.query(`SELECT set_config('bms.tenant_id',$1,true)`, [
        randomUUID(),
      ]);
      assert.equal(
        (
          await c.query(
            `SELECT * FROM bms_operation_quality_cases WHERE id=$1`,
            [id],
          )
        ).rowCount,
        0,
      );
      await c.query(`SELECT set_config('bms.tenant_id',$1,true)`, [f.tenant]);
      assert.equal(
        (
          await c.query(
            `SELECT * FROM bms_operation_quality_cases WHERE id=$1`,
            [id],
          )
        ).rowCount,
        1,
      );
      await assert.rejects(
        () =>
          c.query(
            `DELETE FROM bms_operation_quality_events WHERE tenant_id=$1`,
            [f.tenant],
          ),
        /permission denied/,
      );
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }));
