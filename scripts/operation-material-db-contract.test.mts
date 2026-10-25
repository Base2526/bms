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
import { commandProduction } from "../apps/web/lib/bms/operationProduction";
import {
  commandMaterial,
  runMaterialFollowups,
} from "../apps/web/lib/bms/operationMaterials";
import {
  materialPreview,
  materialDetail,
  materialWorkspace,
  materialCatalog,
  materialForRun,
} from "../apps/web/lib/bms/operationMaterialReads";
import { upsertProductRecipe } from "../apps/web/lib/bms/productRecipes";
import { receivePurchaseOrder } from "../apps/web/lib/bms/purchase";
import { commandBranchRequisition } from "../apps/web/lib/bms/branchRequisitions";
import { operationWeeklyReport } from "../apps/web/lib/bms/operationImprovementReads";
import { deleteTenant } from "../apps/web/lib/bms/platform";
import { bmsOperationMaterialsResolvers } from "../apps/web/graphql/bmsOperationMaterials";
import {
  assertCostingTestDatabase,
  withCostingFixture,
  withAuditFailure,
} from "./testing/restaurantCostingFixture.mts";
test.before(async () => {
  await assertCostingTestDatabase();
  const sql = readFileSync(
    new URL(
      "../db/migrations/10.96__bms_operation_materials.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await query(sql);
  await query(sql);
});
async function materialWriteCounts(tenant: string) {
  const tables = [
    "bms_operation_runs",
    "bms_purchase_orders",
    "bms_operation_material_links",
    "bms_operation_material_inspections",
    "bms_operation_material_events",
    "bms_operation_commands",
    "bms_audit_log",
  ];
  return Promise.all(
    tables.map(
      async (table) =>
        (
          await query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1`, [
            tenant,
          ])
        ).rows[0].count,
    ),
  );
}
test("500th supply link remains readable; 501st is rejected before creating a purchase order", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      d = await f.detail(id);
    // Synthetic history at the boundary: cancelled orders leave no pending supply.
    await query(
      `UPDATE bms_purchase_orders SET status='CANCELLED' WHERE tenant_id=$1 AND id=$2`,
      [f.tenant, d.links[0].po_id],
    );
    await query(
      `INSERT INTO bms_operation_material_links(tenant_id,plan_id,product_sku,size,base_unit,qty,po_id,po_item_id,needed_at,created_by)
      SELECT tenant_id,plan_id,product_sku,size,base_unit,qty,po_id,po_item_id,needed_at,created_by FROM bms_operation_material_links CROSS JOIN generate_series(1,498) WHERE tenant_id=$1 AND id=$2`,
      [f.tenant, d.links[0].id],
    );
    const input = {
      sku: "FAKE-ING",
      size: "BASE",
      qty: 1,
      supplierId: f.supplier,
      unitCost: 2,
      dueAt: f.dueAt,
    };
    assert.equal((await f.act(id, "CREATE_PO", input)).status, "OK");
    const full = await f.detail(id);
    assert.equal(full.links.length, 500);
    const before = await materialWriteCounts(f.tenant);
    assert.equal(
      (await f.act(id, "CREATE_PO", input)).status,
      "REPORT_TOO_LARGE",
    );
    assert.deepEqual(await materialWriteCounts(f.tenant), before);
    assert.equal((await f.detail(id)).version, full.version);
  }));
test("500th inspection remains readable; 501st is rejected before creating a checklist task", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      d = await f.detail(id);
    // Synthetic cancelled inspection history, with a distinct canonical run for each row.
    await query(
      `WITH runs AS (
      INSERT INTO bms_operation_runs(tenant_id,template_id,location_id,snapshot,status,assigned_to,created_by,due_at)
      SELECT tenant_id,template_id,location_id,snapshot,'VOID',assigned_to,created_by,due_at FROM bms_operation_runs CROSS JOIN generate_series(1,499) WHERE tenant_id=$1 AND id=$2 RETURNING tenant_id,id,created_by
    ) INSERT INTO bms_operation_material_inspections(tenant_id,link_id,run_id,accepted_qty,rejected_qty,note,status,created_by)
      SELECT tenant_id,$3,id,0,1,'FAKE boundary history','CANCELLED',created_by FROM runs`,
      [f.tenant, d.run_id, d.links[0].id],
    );
    await f.inspect(id, { acceptedQty: 1, rejectedQty: 0 });
    const full = await f.detail(id);
    assert.equal(full.inspections.length, 500);
    const before = await materialWriteCounts(f.tenant);
    assert.equal(
      (
        await f.act(id, "INSPECT", {
          linkId: d.links[0].id,
          acceptedQty: 1,
          rejectedQty: 0,
          templateId: f.template,
          assignedTo: f.actor,
          dueAt: f.dueAt,
        })
      ).status,
      "REPORT_TOO_LARGE",
    );
    assert.deepEqual(await materialWriteCounts(f.tenant), before);
    assert.equal((await f.detail(id)).version, full.version);
  }));
test("completed canonical review does not receive a spurious review-due notice", () =>
  fixture(async (f) => {
    const id = await f.create();
    await f.act(id, "CONFIRM");
    const d = await f.detail(id);
    await f.approve({ run_id: d.run_id });
    assert.equal((await runMaterialFollowups(f.tenant)).failed, 0);
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_operation_team_notices WHERE tenant_id=$1`,
          [f.tenant],
        )
      ).rows[0].count,
      "0",
    );
  }));
test("rescheduled production preserves readable evidence but blocks new supply until replanning", () =>
  fixture(async (f) => {
    const id = await f.create();
    await f.act(id, "CONFIRM");
    const d = await f.detail(id);
    const run = (
      await query(
        `SELECT r.id,r.version FROM bms_operation_production p JOIN bms_operation_runs r ON r.tenant_id=p.tenant_id AND r.id=p.run_id WHERE p.tenant_id=$1 AND p.id=$2`,
        [f.tenant, d.live.sources[0].id],
      )
    ).rows[0];
    const reschedule = await commandChecklist(f.s, {
      action: "ASSIGN",
      id: run.id,
      version: run.version,
      assignedTo: f.actor,
      dueAt: new Date(Date.parse(f.dueAt) + 8 * 86400000).toISOString(),
      confirmed: true,
      idempotencyKey: randomUUID(),
      note: "FAKE reschedule",
    });
    assert.equal(reschedule.status, "OK");
    const stale = await f.detail(id);
    assert.equal(stale.live, null);
    assert.equal(stale.liveError, "SOURCE_OUTSIDE_WINDOW");
    assert.equal(stale.changed, true);
    assert.deepEqual(stale.snapshot, d.snapshot);
    const before = await materialWriteCounts(f.tenant);
    assert.equal(
      (
        await f.act(id, "CREATE_PO", {
          sku: "FAKE-ING",
          size: "BASE",
          qty: 1,
          supplierId: f.supplier,
          unitCost: 2,
          dueAt: f.dueAt,
        })
      ).status,
      "SOURCE_OUTSIDE_WINDOW",
    );
    assert.equal((await f.act(id, "REFRESH")).status, "SOURCE_OUTSIDE_WINDOW");
    assert.deepEqual(await materialWriteCounts(f.tenant), before);
    assert.equal((await f.act(id, "CANCEL")).status, "OK");
    assert.equal((await f.detail(id)).status, "CANCELLED");
  }));
test("legacy purchase wrapper rolls back an earlier valid line when a later line is invalid", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      d = await f.detail(id);
    const r = await receivePurchaseOrder(
      f.tenant,
      d.links[0].po_id,
      [
        { sku: "FAKE-ING", size: "BASE", qty: 3 },
        { sku: "MISSING", size: "BASE", qty: 1 },
      ],
      f.actor,
      f.actor,
      { locationId: f.location },
    );
    assert.equal(r.status, "LINE_NOT_FOUND");
    const after = await f.detail(id);
    assert.equal(after.links[0].qty_received, 0);
    assert.equal(after.live.lines[0].available, 0);
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_stock_movements WHERE tenant_id=$1`,
          [f.tenant],
        )
      ).rows[0].count,
      "0",
    );
  }));
test("authorized test-tenant purge unwinds material receipt dependencies without touching another tenant", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      x = await f.inspect(id);
    await f.approve(x);
    await f.receive(id, x);
    await query(`UPDATE bms_tenants SET slug=$2 WHERE id=$1`, [
      f.tenant,
      `test-material-${f.tenant}`,
    ]);
    const before = Number(
      (await query(`SELECT count(*) FROM bms_tenants WHERE id<>$1`, [f.tenant]))
        .rows[0].count,
    );
    await deleteTenant(f.tenant);
    assert.equal(
      (await query(`SELECT count(*) FROM bms_tenants WHERE id<>$1`, [f.tenant]))
        .rows[0].count,
      String(before),
    );
    assert.equal(
      (
        await query(
          `SELECT id FROM bms_operation_material_plans WHERE tenant_id=$1`,
          [f.tenant],
        )
      ).rowCount,
      0,
    );
  }));
test("two concurrent receivers post one inspection only and preserve exact value", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      x = await f.inspect(id);
    await f.approve(x);
    const d = await f.detail(id),
      input = {
        action: "RECEIVE",
        id,
        version: d.version,
        inspectionId: x.id,
        inspectionVersion: 1,
        runVersion: d.inspections[0].run_version,
        expectedReceived: 0,
      };
    const out = await Promise.all([f.cmd(input), f.cmd(input)]);
    assert.equal(out.filter((x) => x.status === "OK").length, 1);
    assert.ok(
      out.every((x) =>
        ["OK", "RETRY_REQUIRED", "STALE_VERSION"].includes(x.status),
      ),
      JSON.stringify(out),
    );
    const after = await f.detail(id);
    assert.equal(after.receipts.length, 1);
    const val = (
      await query(
        `SELECT qty,amount::text FROM bms_inventory_value_entries WHERE tenant_id=$1 AND movement_id=$2`,
        [f.tenant, after.receipts[0].movement_id],
      )
    ).rows[0];
    assert.equal(Number(val.qty), 12);
    assert.equal(val.amount, "24.000000");
  }));
test("full receipt closes supply, can close plan, and weekly evidence distinguishes rejected quantities", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      x = await f.inspect(id, { acceptedQty: 20, rejectedQty: 1 });
    await f.approve(x);
    assert.equal((await f.receive(id, x)).status, "OK");
    assert.equal((await f.act(id, "CANCEL")).status, "SUPPLY_STILL_ACTIVE");
    assert.equal((await f.act(id, "CLOSE")).status, "OK");
    const report = await operationWeeklyReport(f.s, f.day, f.location);
    assert.equal(report.branches[0].sources.materials[0].status, "CLOSED");
    assert.equal(report.branches[0].sources.receiving[0].accepted_qty, 20);
    assert.equal(report.branches[0].sources.receiving[0].rejected_qty, 1);
    assert.equal(report.branches[0].sources.receiving[0].status, "POSTED");
  }));
test("PO allocation cannot also be claimed by branch requisition workflow", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      d = await f.detail(id),
      scope = { tenantId: f.tenant, actorId: f.actor };
    const cmd = (i: any) =>
      commandBranchRequisition(scope, {
        ...i,
        confirmed: true,
        idempotencyKey: randomUUID(),
      });
    const req = await cmd({
      action: "SAVE",
      locationId: f.location,
      items: [{ sku: "FAKE-ING", size: "BASE", qty: 20 }],
      neededOn: f.day,
    });
    assert.equal(req.status, "OK", JSON.stringify(req));
    await cmd({ action: "SUBMIT", id: req.id, version: 1 });
    await cmd({
      action: "REVIEW",
      id: req.id,
      version: 2,
      items: [{ sku: "FAKE-ING", size: "BASE", qty: 20 }],
    });
    assert.equal(
      (
        await cmd({
          action: "LINK_PO",
          id: req.id,
          version: 3,
          poId: d.links[0].po_id,
          items: [{ sku: "FAKE-ING", size: "BASE", qty: 20 }],
        })
      ).status,
      "OVER_ALLOCATED",
    );
  }));
test("approved branch request links only same branch, full approved quantity, and nonlot material", () =>
  fixture(async (f) => {
    const id = await f.create();
    await f.act(id, "CONFIRM");
    const scope = { tenantId: f.tenant, actorId: f.actor },
      cmd = (i: any) =>
        commandBranchRequisition(scope, {
          ...i,
          confirmed: true,
          idempotencyKey: randomUUID(),
        });
    const r = await cmd({
      action: "SAVE",
      locationId: f.location,
      items: [{ sku: "FAKE-ING", size: "BASE", qty: 20 }],
      neededOn: f.day,
    });
    assert.equal(r.status, "OK");
    await cmd({ action: "SUBMIT", id: r.id, version: 1 });
    await cmd({
      action: "REVIEW",
      id: r.id,
      version: 2,
      items: [{ sku: "FAKE-ING", size: "BASE", qty: 20 }],
    });
    const item = String(
      (
        await query(
          `SELECT id FROM bms_branch_requisition_items WHERE tenant_id=$1 AND requisition_id=$2`,
          [f.tenant, r.id],
        )
      ).rows[0].id,
    );
    assert.equal(
      (
        await f.act(id, "LINK_REQUISITION", {
          sku: "FAKE-ING",
          size: "BASE",
          qty: 10,
          requisitionItemId: item,
          dueAt: f.dueAt,
        })
      ).status,
      "INVALID_SOURCE",
    );
    assert.equal(
      (
        await f.act(id, "LINK_REQUISITION", {
          sku: "FAKE-ING",
          size: "BASE",
          qty: 20,
          requisitionItemId: item,
          dueAt: f.dueAt,
        })
      ).status,
      "OK",
    );
    assert.equal((await f.detail(id)).live.lines[0].pending, 20);
  }));
test("changed unit and stale approved run version cannot receive stock", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      x = await f.inspect(id);
    await f.approve(x);
    assert.equal(
      (await f.receive(id, x, { runVersion: 3 })).status,
      "INSPECTION_NOT_APPROVED",
    );
    await query(
      `INSERT INTO bms_product_stock_policies(tenant_id,product_sku,stock_policy,base_unit) VALUES($1,'FAKE-ING','DIRECT','GRAM') ON CONFLICT(tenant_id,product_sku) DO UPDATE SET base_unit='GRAM'`,
      [f.tenant],
    );
    assert.equal((await f.receive(id, x)).status, "SOURCE_UNIT_CHANGED");
    assert.equal((await f.detail(id)).receipts.length, 0);
  }));
test("legacy POS receipt wrapper retains its stable idempotency and audit transaction", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      d = await f.detail(id),
      reg = await f.register(),
      options = {
        locationId: f.location,
        idempotency: {
          deviceId: reg.device,
          actorUserId: f.actor,
          key: randomUUID(),
        },
        audit: { actor: f.actor, meta: { surface: "pos" } },
      },
      lines = [{ sku: "FAKE-ING", size: "BASE", qty: 3 }];
    const a = await receivePurchaseOrder(
      f.tenant,
      d.links[0].po_id,
      lines,
      f.actor,
      f.actor,
      options,
    );
    assert.equal(a.status, "PARTIAL");
    const b = await receivePurchaseOrder(
      f.tenant,
      d.links[0].po_id,
      lines,
      f.actor,
      f.actor,
      options,
    );
    assert.equal(b.replayed, true);
    assert.equal((await f.detail(id)).links[0].qty_received, 3);
    assert.equal((await f.detail(id)).live.lines[0].pending, null);
  }));
async function fixture(work: (f: any) => Promise<void>) {
  await withCostingFixture(async (f) => {
    try {
      const s = {
        tenantId: f.tenant,
        actorId: f.actor,
        permissions: new Set(BMS_PERMISSIONS),
      };
      for (const sku of ["FAKE-ING", "FAKE-RECIPE", "FAKE-PREP"])
        await f.product(sku, 2);
      await query(
        `UPDATE bms_inventory SET current_stock=0 WHERE tenant_id=$1`,
        [f.tenant],
      );
      await query(
        `INSERT INTO bms_store_capabilities(tenant_id,capability,enabled) VALUES($1,'RECIPE',true)`,
        [f.tenant],
      );
      const recipe = await upsertProductRecipe(
        f.tenant,
        {
          productSku: "FAKE-RECIPE",
          size: "BASE",
          outputQty: 10,
          active: true,
          directItems: [{ sku: "FAKE-ING", size: "BASE", qty: 20 }],
          sopSteps: ["Inspect"],
        },
        f.actor,
      );
      const template = await commandChecklist(s, {
        action: "SAVE_TEMPLATE",
        idempotencyKey: randomUUID(),
        locationId: f.location,
        name: "FAKE receiving",
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
          } as any,
        ],
      });
      assert.equal(template.status, "OK");
      assert.equal(
        (
          await commandChecklist(s, {
            action: "PUBLISH",
            id: template.id,
            version: 1,
            confirmed: true,
            idempotencyKey: randomUUID(),
          })
        ).status,
        "OK",
      );
      const dueAt = new Date().toISOString(),
        day = new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Bangkok",
        });
      const supplier = (
        await query(
          `INSERT INTO bms_suppliers(tenant_id,name) VALUES($1,'FAKE supplier') RETURNING id`,
          [f.tenant],
        )
      ).rows[0].id;
      const prod = async () => {
        const p = await commandProduction(s, {
          action: "CREATE",
          confirmed: true,
          idempotencyKey: randomUUID(),
          locationId: f.location,
          recipeId: recipe.id,
          outputSku: "FAKE-PREP",
          outputSize: "BASE",
          plannedQty: 10,
          templateId: template.id,
          dueAt,
          assignedTo: f.actor,
        });
        assert.equal(p.status, "OK", JSON.stringify(p));
        return p.id;
      };
      const cmd = (i: any, scope = s) =>
        commandMaterial(scope, {
          confirmed: true,
          idempotencyKey: randomUUID(),
          note: "FAKE material decision",
          ...i,
        });
      const create = async (extra: any = {}) => {
        const sources = [{ id: await prod(), priority: 2 }],
          input = {
            locationId: f.location,
            from: day,
            to: day,
            sources,
            ...extra,
          };
        const preview = await materialPreview(s, input);
        const r = await cmd({
          action: "CREATE",
          title: "FAKE material plan",
          ...input,
          templateId: template.id,
          assignedTo: f.actor,
          dueAt,
          fingerprint: preview.fingerprint,
        });
        assert.equal(r.status, "OK", JSON.stringify(r));
        return r.id;
      };
      const detail = (id: string) => materialDetail(s, id);
      const act = async (id: string, action: string, extra: any = {}) => {
        const d = await detail(id);
        return cmd({
          id,
          version: d.version,
          action,
          fingerprint: d.live?.fingerprint,
          ...extra,
        });
      };
      const supply = async () => {
        const id = await create();
        assert.equal((await act(id, "CONFIRM")).status, "OK");
        assert.equal(
          (
            await act(id, "CREATE_PO", {
              sku: "FAKE-ING",
              size: "BASE",
              qty: 20,
              supplierId: supplier,
              unitCost: 2,
              dueAt,
            })
          ).status,
          "OK",
        );
        return id;
      };
      const inspect = async (id: string, extra: any = {}) => {
        const d = await detail(id);
        const r = await act(id, "INSPECT", {
          linkId: d.links[0].id,
          acceptedQty: 12,
          rejectedQty: 2,
          templateId: template.id,
          assignedTo: f.actor,
          dueAt,
          lotNo: "FAKE-LOT",
          expiryDate: "2099-12-31",
          ...extra,
        });
        assert.equal(r.status, "OK", JSON.stringify(r));
        return (await detail(id)).inspections[0];
      };
      const approve = async (x: any, value = "PASS") => {
        let v = 1;
        for (const action of ["RECORD", "SUBMIT", "APPROVE"]) {
          const r = await commandChecklist(
            action === "APPROVE" ? { ...s, actorId: f.approver } : s,
            {
              action,
              id: x.run_id,
              version: v,
              confirmed: true,
              idempotencyKey: randomUUID(),
              ...(action === "RECORD" ? { itemKey: "quality", value } : {}),
              note: "FAKE verified",
            } as any,
          );
          assert.equal(r.status, "OK", JSON.stringify(r));
          v = r.version!;
        }
        return v;
      };
      const receive = async (id: string, x: any, extra: any = {}) => {
        const d = await detail(id);
        return act(id, "RECEIVE", {
          inspectionId: x.id,
          inspectionVersion: x.version,
          runVersion: d.inspections.find((a: any) => a.id === x.id).run_version,
          expectedReceived: d.links[0].qty_received,
          ...extra,
        });
      };
      await work({
        ...f,
        s,
        template: template.id,
        supplier,
        day,
        dueAt,
        prod,
        cmd,
        create,
        detail,
        act,
        supply,
        inspect,
        approve,
        receive,
      });
    } finally {
      for (const table of [
        "bms_purchase_receipt_evidence",
        "bms_pos_purchase_receipts",
        "bms_operation_material_events",
        "bms_operation_material_inspections",
        "bms_operation_material_links",
        "bms_operation_material_sources",
        "bms_operation_material_plans",
        "bms_branch_requisition_events",
        "bms_branch_requisition_purchases",
        "bms_branch_requisition_transfers",
        "bms_branch_requisition_items",
        "bms_branch_requisitions",
        "bms_operation_production_waste",
        "bms_operation_production_events",
        "bms_operation_production_inputs",
        "bms_operation_production",
        "bms_operation_team_notices",
        "bms_operation_team_events",
        "bms_operation_handovers",
        "bms_operation_rosters",
        "bms_operation_notices",
        "bms_operation_escalations",
        "bms_operation_policies",
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
test("frozen BOM planning, PO, separate review, exact partial receipt and readiness", () =>
  fixture(async (f) => {
    const id = await f.supply();
    let d = await f.detail(id);
    assert.equal(d.live.lines[0].required, 20);
    assert.equal(d.live.lines[0].available, 0);
    assert.equal(d.live.lines[0].pending, 20);
    assert.equal(d.live.lines[0].uncovered, 0);
    const x = await f.inspect(id);
    assert.equal((await f.receive(id, x)).status, "INSPECTION_NOT_APPROVED");
    await f.approve(x);
    assert.equal((await f.receive(id, x)).status, "OK");
    d = await f.detail(id);
    assert.equal(d.links[0].received, 12);
    assert.equal(d.links[0].pending, 8);
    assert.equal(d.live.lines[0].available, 12);
    assert.equal(d.receipts.length, 1);
    assert.ok(d.receipts[0].movement_id);
    assert.ok(d.receipts[0].lot_id);
    assert.equal(d.inspections[0].status, "POSTED");
    assert.equal(d.inspections[0].rejected_qty, 2);
    const inv = (
      await query(
        `SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-ING'`,
        [f.tenant, f.location],
      )
    ).rows[0];
    assert.equal(inv.current_stock, 12);
    assert.equal(d.events.filter((e: any) => e.details.snapshot).length, 2);
  }));
test("stable replay consumes inspection once; changed key payload and stale versions reject", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      x = await f.inspect(id);
    await f.approve(x);
    const key = randomUUID();
    const d = await f.detail(id);
    const input = {
      action: "RECEIVE",
      id,
      version: d.version,
      inspectionId: x.id,
      inspectionVersion: 1,
      runVersion: d.inspections[0].run_version,
      expectedReceived: 0,
      idempotencyKey: key,
    };
    const first = await f.cmd(input);
    assert.equal(first.status, "OK");
    assert.deepEqual(await f.cmd(input), first);
    assert.equal(
      (await f.cmd({ ...input, note: "changed" })).status,
      "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(
      (await f.cmd({ ...input, idempotencyKey: randomUUID() })).status,
      "STALE_VERSION",
    );
    assert.equal((await f.detail(id)).receipts.length, 1);
  }));
test("audit failure atomically rolls back receipt, stock, lot, value, PO, inspection and version", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      x = await f.inspect(id);
    await f.approve(x);
    const before = await f.detail(id);
    await withAuditFailure(f.tenant, "operations.material.receive", () =>
      assert.rejects(f.receive(id, x), /TEST_COST_AUDIT_FAILURE/),
    );
    const d = await f.detail(id);
    assert.equal(d.version, before.version);
    assert.equal(d.links[0].qty_received, 0);
    assert.equal(d.receipts.length, 0);
    assert.equal(d.inspections[0].status, "PENDING");
    assert.equal(d.live.lines[0].available, 0);
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_inventory_lots WHERE tenant_id=$1`,
          [f.tenant],
        )
      ).rows[0].count,
      "0",
    );
    assert.equal((await f.receive(id, x)).status, "OK");
  }));
test("over-allocation, over-receipt, stale stock preview and source duplication fail closed", () =>
  fixture(async (f) => {
    const id = await f.supply();
    assert.equal(
      (
        await f.act(id, "CREATE_PO", {
          sku: "FAKE-ING",
          size: "BASE",
          qty: 1,
          supplierId: f.supplier,
          unitCost: 2,
          dueAt: f.dueAt,
        })
      ).status,
      "OVER_ALLOCATED",
    );
    const d = await f.detail(id);
    assert.equal(
      (
        await f.act(id, "INSPECT", {
          linkId: d.links[0].id,
          acceptedQty: 21,
          rejectedQty: 0,
          templateId: f.template,
          assignedTo: f.actor,
          dueAt: f.dueAt,
        })
      ).status,
      "OVER_RECEIVE",
    );
    const source = d.live.sources[0];
    await assert.rejects(
      materialPreview(f.s, {
        locationId: f.location,
        from: f.day,
        to: f.day,
        sources: [{ id: source.id, priority: 2 }],
      }),
      /PRODUCTION_ALREADY_PLANNED/,
    );
    await query(
      `UPDATE bms_inventory SET current_stock=1 WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-ING'`,
      [f.tenant, f.location],
    );
    assert.equal(
      (
        await f.cmd({
          action: "REFRESH",
          id,
          version: d.version,
          fingerprint: d.live.fingerprint,
        })
      ).status,
      "SNAPSHOT_CHANGED",
    );
  }));
test("active plans allocate stock once; cancellation releases membership without stock writes", () =>
  fixture(async (f) => {
    await query(
      `UPDATE bms_inventory SET current_stock=25 WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-ING'`,
      [f.tenant, f.location],
    );
    const first = await f.create(),
      second = await f.create();
    const a = await f.detail(first),
      b = await f.detail(second);
    assert.equal(a.live.lines[0].available + b.live.lines[0].available, 25);
    assert.equal((await f.act(first, "CANCEL")).status, "OK");
    assert.equal((await f.detail(second)).live.lines[0].available, 20);
    assert.equal((await f.detail(first)).live, null);
  }));
test("external PO receipt is unknown allocation; stale receiving preview cannot double-receive", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      x = await f.inspect(id);
    await f.approve(x);
    const d = await f.detail(id);
    assert.ok(
      ["PARTIAL", "RECEIVED"].includes(
        (
          await receivePurchaseOrder(
            f.tenant,
            d.links[0].po_id,
            [{ sku: "FAKE-ING", size: "BASE", qty: 10 }],
            f.actor,
            undefined,
            { locationId: f.location },
          )
        ).status,
      ),
    );
    assert.equal(
      (await f.receive(id, x, { expectedReceived: 0 })).status,
      "RECEIPT_CHANGED",
    );
    assert.equal((await f.detail(id)).links[0].unknownReceipts, 10);
    assert.equal(
      (await f.receive(id, x)).status,
      "STOCK_RECONCILIATION_REQUIRED",
    );
  }));
test("expired accepted lot is blocked; rejected-only approved inspection never moves stock", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      x = await f.inspect(id, { expiryDate: "2000-01-01" });
    await f.approve(x);
    assert.equal((await f.receive(id, x)).status, "EXPIRED_LOT");
    assert.equal(
      (
        await f.act(id, "CANCEL_INSPECTION", {
          inspectionId: x.id,
          inspectionVersion: 1,
        })
      ).status,
      "OK",
    );
    const y = await f.inspect(id, { acceptedQty: 0, rejectedQty: 20 });
    await f.approve(y);
    assert.equal((await f.receive(id, y)).status, "OK");
    const d = await f.detail(id);
    assert.equal(
      d.inspections.find((a: any) => a.id === y.id).status,
      "REJECTED",
    );
    assert.equal(d.receipts.length, 0);
    assert.equal(d.live.lines[0].available, 0);
  }));
test("permission, tenant and branch scopes precede reads/replay; cost is redacted", () =>
  fixture(async (f) => {
    const id = await f.supply(),
      d = await f.detail(id);
    const limited = {
      ...f.s,
      permissions: new Set([
        "operations.checklist.view",
        "operations.material.view",
        "product.view",
      ]),
    };
    assert.equal((await materialDetail(limited, id)).links[0].unit_cost, null);
    assert.equal(
      (await f.cmd({ action: "CANCEL", id, version: d.version }, limited))
        .status,
      "FORBIDDEN",
    );
    await assert.rejects(
      materialDetail({ ...f.s, tenantId: randomUUID() }, id),
      /NOT_FOUND/,
    );
    await query(
      `INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,
      [f.tenant, f.actor, f.locations[1]],
    );
    await assert.rejects(materialDetail(f.s, id), /NOT_FOUND/);
  }));
test("RLS hides other tenant rows and receipt evidence is append only to app role", () =>
  fixture(async (f) => {
    const id = await f.create(),
      c = await getClient();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE bms_app");
      await c.query(`SELECT set_config('bms.tenant_id',$1,true)`, [
        randomUUID(),
      ]);
      assert.equal(
        (
          await c.query(
            `SELECT id FROM bms_operation_material_plans WHERE id=$1`,
            [id],
          )
        ).rowCount,
        0,
      );
      await assert.rejects(
        c.query(
          `DELETE FROM bms_purchase_receipt_evidence WHERE tenant_id=$1`,
          [f.tenant],
        ),
        /permission denied/,
      );
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }));
test("catalogs, task context, cron dedupe and GraphQL auth use canonical services", () =>
  fixture(async (f) => {
    const id = await f.supply();
    assert.equal((await materialWorkspace(f.s)).total, 1);
    for (const kind of ["PRODUCTION", "PO", "REQUISITION"])
      assert.ok(
        Array.isArray(
          (await materialCatalog(f.s, kind, f.location, "FAKE")).rows,
        ),
      );
    assert.equal(
      (await materialCatalog(f.s, "SUPPLIER", f.location)).rows[0].id,
      f.supplier,
    );
    const d = await f.detail(id);
    assert.equal((await materialForRun(f.s, d.run_id))?.planId, id);
    assert.equal((await runMaterialFollowups(f.tenant)).failed, 0);
    const count = (
      await query(
        `SELECT count(*) FROM bms_operation_team_notices WHERE tenant_id=$1`,
        [f.tenant],
      )
    ).rows[0].count;
    assert.ok(Number(count) > 0);
    await runMaterialFollowups(f.tenant);
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_operation_team_notices WHERE tenant_id=$1`,
          [f.tenant],
        )
      ).rows[0].count,
      count,
    );
    await assert.rejects(
      bmsOperationMaterialsResolvers.Query.bmsMaterialWorkspace(null, {}, {}),
      /Unauthorized scope/,
    );
    assert.equal(
      (
        await bmsOperationMaterialsResolvers.Query.bmsMaterialWorkspace(
          null,
          {},
          f.ctx(),
        )
      ).total,
      1,
    );
  }));
