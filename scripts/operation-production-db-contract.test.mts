import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { query, getClient } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { BMS_PERMISSIONS } from "../apps/web/lib/bms/permissions.ts";
import {
  commandChecklist,
  checklistTx,
} from "../apps/web/lib/bms/operationChecklists.ts";
import {
  commandProduction,
  runProductionFollowups,
} from "../apps/web/lib/bms/operationProduction.ts";
import { commandOperationTeam } from "../apps/web/lib/bms/operationTeam";
import { operationWeeklyReport } from "../apps/web/lib/bms/operationImprovementReads";
import {
  productionWorkspace,
  productionDetail,
  productionPreview,
} from "../apps/web/lib/bms/operationProductionReads.ts";
import { upsertProductRecipe } from "../apps/web/lib/bms/productRecipes.ts";
import { upsertProductStockPolicy } from "../apps/web/lib/bms/productStockPolicies.ts";
import { confirmInventoryValue } from "../apps/web/lib/bms/inventoryValuation.ts";
import { receiveLotInTx } from "../apps/web/lib/bms/lots.ts";
import { partiallyReturnPosSale } from "../apps/web/lib/bms/pos.ts";
import { getStockLedger } from "../apps/web/lib/bms/stockLedger";
import { getNetProfitReport } from "../apps/web/lib/bms/netProfit";
import { bmsOperationProductionResolvers } from "../apps/web/graphql/bmsOperationProduction.ts";
import {
  assertCostingTestDatabase,
  withCostingFixture,
  withAuditFailure,
} from "./testing/restaurantCostingFixture.mts";
type Fixture = Parameters<Parameters<typeof withCostingFixture>[0]>[0];
test('weekly production keeps draft out of actual yield and exact waste cost distinct from historical unknown',async()=>fixture(async f=>{
 const p=await f.post(await f.ready());assert.equal(p.status,'OK');await f.create();
 assert.equal((await commandProduction(f.s,{action:'WASTE',id:p.id,version:p.version,qty:2,note:'FAKE waste',confirmed:true,idempotencyKey:randomUUID()})).status,'OK');
 const day=(await query(`SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') d`)).rows[0].d;
 let report=await operationWeeklyReport(f.s,day,f.location),b=report.branches[0];
 assert.equal(b.yields.length,1);assert.equal(b.yields[0].actual,8);assert.equal(b.yields[0].planned,10);
 assert.equal(b.sources.production.length,2);assert.equal(b.wasteValue.total,'10.000000');assert.equal(b.wasteValue.unknown,0);
 assert.ok(b.sources.waste[0].movement_id);
 await query(`UPDATE bms_operation_production_waste SET movement_id=NULL WHERE tenant_id=$1`,[f.tenant]);
 report=await operationWeeklyReport(f.s,day,f.location);assert.equal(report.branches[0].wasteValue.total,null);assert.equal(report.branches[0].wasteValue.unknown,1);assert.equal(report.branches[0].sources.waste[0].qty,2);
}));
test("invalid template identifiers reject before SQL and create no production work", async () =>
  fixture(async (f) => {
    assert.equal(
      (await f.create({ templateId: "not-a-uuid" })).status,
      "INVALID_INPUT",
    );
    assert.equal((await productionWorkspace(f.s)).total, 0);
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_operation_runs WHERE tenant_id=$1`,
          [f.tenant],
        )
      ).rows[0].count,
      "0",
    );
  }));
test("waste rejects changed output base units without moving stock or evidence", async () =>
  fixture(async (f) => {
    const posted = await f.post(await f.ready());
    assert.equal(posted.status, "OK");
    await upsertProductStockPolicy(
      f.tenant,
      { productSku: "FAKE-PREP", baseUnit: "GRAM" },
      f.actor,
    );
    const waste = await commandProduction(f.s, {
      action: "WASTE",
      id: posted.id,
      version: posted.version,
      confirmed: true,
      idempotencyKey: randomUUID(),
      qty: 1,
      note: "FAKE drift",
    });
    assert.equal(waste.status, "OUTPUT_UNIT_MISMATCH");
    const d = await productionDetail(f.s, posted.id);
    assert.equal(d.lot.qty, 8);
    assert.equal(d.waste.length, 0);
    assert.equal(d.version, posted.version);
  }));
test("unsupported valuation currency is a business rejection and leaves no production movements", async () =>
  fixture(async (f) => {
    const ready = await f.ready();
    await query(
      `UPDATE bms_store_profile SET currency='USD' WHERE tenant_id=$1`,
      [f.tenant],
    );
    assert.equal(
      (await f.post(ready)).status,
      "VALUATION_CURRENCY_REVIEW_REQUIRED",
    );
    const d = await productionDetail(f.s, ready.id);
    assert.equal(d.status, "READY");
    assert.equal(d.inputs.length, 0);
  }));
test("catalog searches are independent of batch search and can reach outputs beyond the first hundred", async () =>
  fixture(async (f) => {
    for (let n = 0; n < 101; n++)
      await f.product(`AAA-FAKE-${String(n).padStart(3, "0")}`);
    const initial = await productionWorkspace(f.s);
    assert.equal(initial.outputs.length, 100);
    assert.equal(initial.optionsTruncated, true);
    assert.equal(
      initial.outputs.some((x: any) => x.product_sku === "FAKE-PREP"),
      false,
    );
    const filtered = await productionWorkspace(f.s, {
      search: "no matching batch",
      recipeSearch: "FAKE-RECIPE",
      outputSearch: "FAKE-PREP",
    });
    assert.equal(filtered.total, 0);
    assert.deepEqual(
      filtered.recipes.map((x: any) => x.id),
      [f.recipe.id],
    );
    assert.deepEqual(
      filtered.outputs.map((x: any) => x.product_sku),
      ["FAKE-PREP"],
    );
    assert.equal(filtered.optionsTruncated, false);
    await assert.rejects(
      productionWorkspace(f.s, { outputSearch: "x".repeat(121) }),
      /INVALID_INPUT/,
    );
  }));
test("production detail stays on one snapshot when posting commits between its reads", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    const probe = await getClient();
    const proto = Object.getPrototypeOf(probe),
      original = proto.query;
    probe.release();
    let interleaved = false;
    proto.query = function (...args: any[]) {
      const result = original.apply(this, args);
      if (
        !interleaved &&
        typeof args[0] === "string" &&
        args[0].includes("r.status run_status") &&
        args[1]?.[0] === f.tenant
      ) {
        interleaved = true;
        return result.then(async (row: any) => {
          assert.equal((await f.post(p)).status, "OK");
          return row;
        });
      }
      return result;
    };
    try {
      const d = await productionDetail(f.s, p.id);
      assert.ok(interleaved);
      assert.equal(d.status, "READY");
      assert.equal(
        d.inputs.length,
        0,
        "READY snapshot must not contain later posted inputs",
      );
      assert.equal(d.value, null);
      assert.equal(
        d.events.some((x: any) => x.action === "POST"),
        false,
      );
    } finally {
      proto.query = original;
    }
    assert.equal((await productionDetail(f.s, p.id)).status, "POSTED");
  }));
test("later input-lot failure rolls back an earlier ingredient and its value entry", async () =>
  fixture(async (f) => {
    await f.product("ZZ-FAKE-ING");
    await checklistTx(f.s, (c) =>
      receiveLotInTx(c, {
        tenantId: f.tenant,
        locationId: f.location,
        productSku: "ZZ-FAKE-ING",
        size: "BASE",
        lotNo: "EXPIRED",
        qty: 1000,
        expiryDate: "2000-01-01",
      }),
    );
    const r = await upsertProductRecipe(
      f.tenant,
      {
        id: f.recipe.id,
        productSku: "FAKE-RECIPE",
        size: "BASE",
        outputQty: 10,
        active: true,
        directItems: [
          { sku: "FAKE-ING", size: "BASE", qty: 20 },
          { sku: "ZZ-FAKE-ING", size: "BASE", qty: 5 },
        ],
      },
      f.actor,
    );
    const p = await f.ready({ recipeId: r.id });
    assert.equal(
      (
        await f.post(p, {
          ingredients: [
            { sku: "FAKE-ING", size: "BASE", qty: 20 },
            { sku: "ZZ-FAKE-ING", size: "BASE", qty: 5 },
          ],
        })
      ).status,
      "INSUFFICIENT_USABLE_LOTS",
    );
    assert.equal((await productionDetail(f.s, p.id)).inputs.length, 0);
    assert.equal(
      (
        await query(
          `SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-ING'`,
          [f.tenant, f.location],
        )
      ).rows[0].current_stock,
      1000,
    );
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_inventory_value_entries WHERE tenant_id=$1 AND kind='PRODUCTION_OUT'`,
          [f.tenant],
        )
      ).rows[0].count,
      "0",
    );
  }));
test("production daily list uses Bangkok due dates and bounded inclusive periods", async () =>
  fixture(async (f) => {
    await f.create({ dueAt: "2026-10-24T17:00:00Z" });
    assert.equal(
      (await productionWorkspace(f.s, { from: "2026-10-24", to: "2026-10-24" }))
        .total,
      0,
    );
    assert.equal(
      (await productionWorkspace(f.s, { from: "2026-10-25", to: "2026-10-25" }))
        .total,
      1,
    );
    await assert.rejects(
      productionWorkspace(f.s, { from: "2026-01-01", to: "2026-12-31" }),
      /INVALID_INPUT/,
    );
    assert.equal((await productionWorkspace(f.s, { offset: 25 })).total, 1);
  }));
test("production refuses preexisting output-lot identity and output/source unit drift", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    await checklistTx(f.s, (c) =>
      receiveLotInTx(c, {
        tenantId: f.tenant,
        locationId: f.location,
        productSku: "FAKE-PREP",
        size: "BASE",
        lotNo: `PREP-${p.id}`,
        qty: 0,
      }),
    );
    assert.equal((await f.post(p)).status, "OUTPUT_LOT_ALREADY_EXISTS");
    const b = await f.ready();
    await query(
      `INSERT INTO bms_product_stock_policies(tenant_id,product_sku,stock_policy,base_unit) VALUES($1,'FAKE-ING','DIRECT','GRAM') ON CONFLICT(tenant_id,product_sku) DO UPDATE SET base_unit='GRAM'`,
      [f.tenant],
    );
    assert.equal((await f.post(b)).status, "INGREDIENT_UNIT_CHANGED");
  }));
test.before(async () => {
  await assertCostingTestDatabase();
  await query(
    readFileSync(
      new URL(
        "../db/migrations/10.94__bms_operation_production.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await query(readFileSync(new URL('../db/migrations/10.95__bms_operation_improvement.sql',import.meta.url),'utf8'));
});
test("production ledger treats conversion as physical in/out, not unrecorded opening or expense", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    await f.post(p);
    const day = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
    });
    const ledger = await getStockLedger(f.tenant, {
      from: day,
      to: day,
      locationId: f.location,
    });
    const raw = ledger.rows.find((r) => r.sku === "FAKE-ING")!,
      output = ledger.rows.find((r) => r.sku === "FAKE-PREP")!;
    assert.equal(raw.productionUsed, 20);
    assert.equal(raw.closing, 980);
    assert.equal(raw.openingUnrecorded, 1000);
    assert.equal(output.producedIn, 8);
    assert.equal(output.closing, 8);
    assert.equal(output.openingUnrecorded, 0);
    assert.equal(
      ledger.movements.find((r) => r.movementType === "PRODUCTION_IN")
        ?.received,
      8,
    );
    await f.sale("FAKE-PREP", 1);
    const profit = await getNetProfitReport(f.tenant, f.actor, f.month, true);
    assert.equal(profit.totals.netCost, "5.00");
  }));
test("production immutable evidence grants and waste audit rollback prevent silent history changes", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    await f.post(p);
    await assert.rejects(
      checklistTx(f.s, (c) =>
        c.query(
          `UPDATE bms_operation_production SET snapshot='{}' WHERE tenant_id=$1 AND id=$2`,
          [f.tenant, p.id],
        ),
      ),
      /permission denied/,
    );
    await assert.rejects(
      checklistTx(f.s, (c) =>
        c.query(
          `DELETE FROM bms_operation_production_inputs WHERE tenant_id=$1`,
          [f.tenant],
        ),
      ),
      /permission denied/,
    );
    await withAuditFailure(f.tenant, "operations.production.waste", async () =>
      assert.rejects(
        commandProduction(f.s, {
          action: "WASTE",
          id: p.id,
          version: 3,
          confirmed: true,
          idempotencyKey: randomUUID(),
          qty: 2,
          note: "FAKE audit failure",
        }),
        /TEST_COST_AUDIT_FAILURE/,
      ),
    );
    const d = await productionDetail(f.s, p.id);
    assert.equal(d.lot.qty, 8);
    assert.equal(d.waste.length, 0);
    assert.equal(d.version, 3);
  }));
async function fixture(
  work: (
    f: Fixture & {
      s: any;
      recipe: any;
      template: string;
      create: (extra?: any) => Promise<any>;
      ready: (extra?: any) => Promise<any>;
      post: (p: any, extra?: any) => Promise<any>;
    },
  ) => Promise<void>,
) {
  await withCostingFixture(async (f) => {
    try {
      const s = {
        tenantId: f.tenant,
        actorId: f.actor,
        permissions: new Set(BMS_PERMISSIONS),
      };
      await f.product("FAKE-ING", 2);
      await f.product("FAKE-RECIPE", 10);
      await f.product("FAKE-PREP", 0);
      await query(
        `UPDATE bms_inventory SET current_stock=0 WHERE tenant_id=$1 AND product_sku='FAKE-PREP'`,
        [f.tenant],
      );
      await query(
        `INSERT INTO bms_store_capabilities(tenant_id,capability,enabled) VALUES($1,'RECIPE',true),($1,'WASTAGE',true)`,
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
          sopSteps: ["Mix carefully"],
        },
        f.actor,
      );
      await confirmInventoryValue(f.tenant, f.actor, {
        locationId: f.location,
        sku: "FAKE-ING",
        size: "BASE",
        qty: "1000",
        value: "2000",
        version: "0",
        evidence: "FAKE verified",
        requestId: randomUUID(),
        confirmed: true,
      });
      await checklistTx(s, async (c) =>
        receiveLotInTx(c, {
          tenantId: f.tenant,
          locationId: f.location,
          productSku: "FAKE-ING",
          size: "BASE",
          lotNo: "INPUT",
          qty: 1000,
          expiryDate: "2099-12-31",
        }),
      );
      const template = await commandChecklist(s, {
        action: "SAVE_TEMPLATE",
        idempotencyKey: randomUUID(),
        locationId: f.location,
        name: "FAKE production check",
        category: "PREP",
        separateReviewer: true,
        items: [
          {
            key: "mix",
            label: "Mix",
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
      const create = async (extra: any = {}) =>
        commandProduction(s, {
          action: "CREATE",
          confirmed: true,
          idempotencyKey: randomUUID(),
          locationId: f.location,
          recipeId: recipe.id,
          outputSku: "FAKE-PREP",
          outputSize: "BASE",
          plannedQty: 10,
          templateId: template.id,
          dueAt: new Date(Date.now() + 3600000).toISOString(),
          assignedTo: f.actor,
          ...extra,
        });
      const ready = async (extra: any = {}) => {
        const p = await create(extra);
        assert.equal(p.status, "OK", JSON.stringify(p));
        const r = await commandProduction(s, {
          action: "READY",
          id: p.id,
          version: 1,
          confirmed: true,
          idempotencyKey: randomUUID(),
        });
        assert.equal(r.status, "OK");
        return r;
      };
      const post = async (p: any, extra: any = {}) =>
        commandProduction(s, {
          action: "POST",
          id: p.id,
          version: p.version,
          confirmed: true,
          idempotencyKey: randomUUID(),
          actualQty: 8,
          ingredients: [{ sku: "FAKE-ING", size: "BASE", qty: 20 }],
          producedOn: new Date().toLocaleDateString("en-CA", {
            timeZone: "Asia/Bangkok",
          }),
          expiryDate: "2099-12-31",
          note: "FAKE yield variance",
          ...extra,
        });
      await work({
        ...f,
        s,
        recipe,
        template: template.id!,
        create,
        ready,
        post,
      });
    } finally {
      for (const table of [
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
test("production schema reapplication preserves RLS, grants and movement kinds", async () => {
  await assertCostingTestDatabase();
  const sql = readFileSync(
    new URL(
      "../db/migrations/10.94__bms_operation_production.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await query(sql);
  await query(sql);
  const r = await query(
    `SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('bms_operation_production','bms_operation_production_inputs','bms_operation_production_events','bms_operation_production_waste')`,
  );
  assert.equal(r.rows.length, 4);
  assert.ok(r.rows.every((x) => x.relrowsecurity && x.relforcerowsecurity));
});
test("plan pins BOM/SOP, previews unreserved stock and does not move or reserve anything", async () =>
  fixture(async (f) => {
    const before = (
      await query(
        "SELECT current_stock,reserved_stock FROM bms_inventory WHERE tenant_id=$1 ORDER BY location_id,product_sku",
        [f.tenant],
      )
    ).rows;
    const p = await f.create();
    assert.equal(p.status, "OK");
    await upsertProductRecipe(
      f.tenant,
      {
        id: f.recipe.id,
        productSku: "FAKE-RECIPE",
        size: "BASE",
        outputQty: 10,
        active: true,
        directItems: [{ sku: "FAKE-ING", size: "BASE", qty: 30 }],
        sopSteps: ["Changed"],
      },
      f.actor,
    );
    const d = await productionDetail(f.s, p.id);
    assert.equal(d.snapshot.ingredients[0].qty, 20);
    assert.deepEqual(d.snapshot.sop, ["Mix carefully"]);
    const preview = await productionPreview(f.s, {
      locationId: f.location,
      recipeId: f.recipe.id,
      plannedQty: 10,
      outputSku: "FAKE-PREP",
      outputSize: "BASE",
    });
    assert.equal(preview.ingredients[0].available, 1000);
    assert.deepEqual(
      (
        await query(
          "SELECT current_stock,reserved_stock FROM bms_inventory WHERE tenant_id=$1 ORDER BY location_id,product_sku",
          [f.tenant],
        )
      ).rows,
      before,
    );
    assert.equal((await productionWorkspace(f.s, { mine: true })).total, 1);
  }));
test("post conserves material value, source lot lineage, output yield and independent checklist state", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    assert.equal((await f.post(p)).status, "OK");
    const d = await productionDetail(f.s, p.id);
    assert.equal(d.value, "40.000000");
    assert.equal(d.unitCost, "5.000000");
    assert.equal(d.lot.qty, 8);
    assert.equal(d.inputs[0].lots[0].qty, 20);
    assert.equal(d.run_status, "OPEN");
    const b = (
      await query(
        `SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-ING'`,
        [f.tenant, f.location],
      )
    ).rows[0];
    assert.equal(b.current_stock, 980);
    const sum = (
      await query(
        `SELECT sum(amount)::text n FROM bms_inventory_value_entries WHERE tenant_id=$1 AND kind='PRODUCTION_IN'`,
        [f.tenant],
      )
    ).rows[0];
    assert.equal(sum.n, "40.000000");
    assert.ok(
      Number(
        (
          await query(
            `SELECT count(*) FROM bms_realtime_outbox WHERE tenant_id=$1`,
            [f.tenant],
          )
        ).rows[0].count,
      ) > 0,
    );
  }));
test("duplicate and concurrent post is once only; stale version, confirmation and changed payload reject", async () =>
  fixture(async (f) => {
    const p = await f.ready(),
      key = randomUUID();
    const results = await Promise.all([
      f.post(p, { idempotencyKey: key }),
      f.post(p, { idempotencyKey: key }),
    ]);
    assert.ok(results.every((r) => r.status === "OK"));
    assert.equal(
      (await f.post(p, { idempotencyKey: key, actualQty: 7 })).status,
      "IDEMPOTENCY_CONFLICT",
    );
    assert.equal((await f.post(p)).status, "STALE_VERSION");
    assert.equal(
      (await f.post(p, { confirmed: false })).status,
      "CONFIRMATION_REQUIRED",
    );
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_stock_movements WHERE tenant_id=$1 AND type='PRODUCTION_IN'`,
          [f.tenant],
        )
      ).rows[0].count,
      "1",
    );
  }));
test("post rejects missing reason, changed inputs and insufficient unreserved stock without partial effects", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    assert.equal(
      (await f.post(p, { note: "" })).status,
      "VARIANCE_REASON_REQUIRED",
    );
    assert.equal(
      (
        await f.post(p, {
          ingredients: [{ sku: "FAKE-PREP", size: "BASE", qty: 1 }],
        })
      ).status,
      "INGREDIENT_SET_CHANGED",
    );
    await query(
      `UPDATE bms_inventory SET reserved_stock=990 WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-ING'`,
      [f.tenant, f.location],
    );
    assert.equal((await f.post(p)).status, "INSUFFICIENT_STOCK");
    assert.equal((await productionDetail(f.s, p.id)).status, "READY");
  }));
test("expired lots and lot-total drift cannot become prepared output", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    await query(
      `UPDATE bms_inventory_lots SET expiry_date='2000-01-01' WHERE tenant_id=$1`,
      [f.tenant],
    );
    assert.equal((await f.post(p)).status, "INSUFFICIENT_USABLE_LOTS");
    assert.equal((await productionDetail(f.s, p.id)).status, "READY");
    await query(`UPDATE bms_inventory_lots SET qty=999 WHERE tenant_id=$1`, [
      f.tenant,
    ]);
    assert.equal((await f.post(p)).status, "STOCK_RECONCILIATION_REQUIRED");
  }));
test("unknown material value stays unknown, zero does not replace missing evidence", async () =>
  fixture(async (f) => {
    await query(
      `UPDATE bms_inventory_values SET value=NULL WHERE tenant_id=$1`,
      [f.tenant],
    );
    const p = await f.ready();
    assert.equal((await f.post(p)).status, "OK");
    const d = await productionDetail(f.s, p.id);
    assert.equal(d.value, null);
    assert.equal(d.unitCost, null);
  }));
test("audit failure rolls back stock, lot, costs, inputs and post state", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    await withAuditFailure(f.tenant, "operations.production.post", async () =>
      assert.rejects(f.post(p), /TEST_COST_AUDIT_FAILURE/),
    );
    const d = await productionDetail(f.s, p.id);
    assert.equal(d.status, "READY");
    assert.equal(d.inputs.length, 0);
    assert.equal(d.lot, null);
    assert.equal(
      (
        await query(
          `SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-ING'`,
          [f.tenant, f.location],
        )
      ).rows[0].current_stock,
      1000,
    );
  }));
test("prepared stock sells and returns through original POS cost and lot machinery without raw double deduction", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    await f.post(p);
    const sold = await f.sale("FAKE-PREP", 2);
    const raw = (
      await query(
        `SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-ING'`,
        [f.tenant, f.location],
      )
    ).rows[0];
    assert.equal(raw.current_stock, 980);
    const item = (
      await query(
        `SELECT id FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2`,
        [f.tenant, sold.orderId],
      )
    ).rows[0];
    const returned = await partiallyReturnPosSale({
      tenantId: f.tenant,
      deviceId: sold.device,
      shiftId: sold.shift,
      orderId: sold.orderId,
      actorUserId: f.actor,
      approvedByUserId: f.approver,
      note: "[CUSTOMER_CHANGE] FAKE",
      idempotencyKey: randomUUID(),
      lines: [{ orderItemId: Number(item.id), packQty: 1 }],
    });
    assert.equal(returned.status, "PARTIAL_RETURNED");
    const d = await productionDetail(f.s, p.id);
    assert.equal(d.lot.qty, 7);
    const v = (
      await query(
        `SELECT kind,amount::text FROM bms_inventory_value_entries WHERE tenant_id=$1 AND kind IN ('SHIP','RETURN') ORDER BY kind`,
        [f.tenant],
      )
    ).rows;
    assert.deepEqual(v, [
      { kind: "RETURN", amount: "5.000000" },
      { kind: "SHIP", amount: "10.000000" },
    ]);
  }));
test("waste targets output lot, expires normally, replays once and links same-run corrective action", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    await f.post(p);
    const d = await productionDetail(f.s, p.id);
    await query(
      `UPDATE bms_inventory_lots SET expiry_date='2000-01-01' WHERE tenant_id=$1 AND id=$2`,
      [f.tenant, d.output_lot_id],
    );
    const input = {
      action: "WASTE" as const,
      id: p.id,
      version: 3,
      confirmed: true,
      idempotencyKey: randomUUID(),
      qty: 2,
      note: "FAKE expired",
    };
    assert.equal((await commandProduction(f.s, input)).status, "OK");
    assert.equal((await commandProduction(f.s, input)).status, "OK");
    const after = await productionDetail(f.s, p.id);
    assert.equal(after.lot.qty, 6);
    assert.equal(after.waste.length, 1);
    assert.equal(
      (
        await query(
          `SELECT amount::text FROM bms_inventory_value_entries WHERE tenant_id=$1 AND kind='WASTAGE'`,
          [f.tenant],
        )
      ).rows[0].amount,
      "10.000000",
    );
    assert.equal(
      (
        await commandProduction(f.s, {
          ...input,
          version: 4,
          idempotencyKey: randomUUID(),
          actionId: randomUUID(),
        })
      ).status,
      "NOT_FOUND",
    );
  }));
test("permission denial, branch revocation, tenant RLS and redacted cost reads", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    const limited = {
      ...f.s,
      permissions: new Set(["operations.checklist.view", "product.view"]),
    };
    assert.equal(
      (
        await commandProduction(limited, {
          action: "POST",
          id: p.id,
          version: 2,
          confirmed: true,
          idempotencyKey: randomUUID(),
        })
      ).status,
      "FORBIDDEN",
    );
    assert.equal((await productionDetail(limited, p.id)).costVisible, false);
    await assert.rejects(
      productionDetail({ ...f.s, tenantId: randomUUID() }, p.id),
      /NOT_FOUND/,
    );
    const c = await getClient();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE bms_app");
      assert.equal(
        (await c.query("SELECT * FROM bms_operation_production")).rowCount,
        0,
      );
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
    await query(
      `INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,
      [f.tenant, f.actor, f.locations[1]],
    );
    await assert.rejects(productionDetail(f.s, p.id), /NOT_FOUND/);
  }));
test("GraphQL adapter requires auth and rejects unauthorized commands", async () => {
  await assert.rejects(
    bmsOperationProductionResolvers.Query.bmsProductionWorkspace(
      null,
      { filter: {} },
      {},
    ),
  );
});
test("two batches cannot consume the same unreserved stock concurrently", async () =>
  fixture(async (f) => {
    const a = await f.ready({ plannedQty: 300 }),
      b = await f.ready({ plannedQty: 300 });
    const r = await Promise.all(
      [a, b].map((p) =>
        f.post(p, {
          actualQty: 300,
          ingredients: [{ sku: "FAKE-ING", size: "BASE", qty: 600 }],
        }),
      ),
    );
    assert.equal(r.filter((x) => x.status === "OK").length, 1);
    assert.ok(
      r.some((x) =>
        ["INSUFFICIENT_STOCK", "RETRY_REQUIRED"].includes(x.status),
      ),
    );
    const total = (
      await query(
        `SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-ING'`,
        [f.tenant, f.location],
      )
    ).rows[0];
    assert.equal(total.current_stock, 400);
  }));
test("expiry sweep deduplicates concurrent workers and stops after lot is empty", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    await f.post(p);
    const d = await productionDetail(f.s, p.id);
    await query(
      `UPDATE bms_inventory_lots SET expiry_date=CURRENT_DATE WHERE tenant_id=$1 AND id=$2`,
      [f.tenant, d.output_lot_id],
    );
    const swept = await Promise.all([
      runProductionFollowups(f.tenant),
      runProductionFollowups(f.tenant),
    ]);
    assert.ok(swept.every((x) => x.failed === 0));
    await runProductionFollowups(f.tenant);
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_operation_team_notices WHERE tenant_id=$1 AND kind='PRODUCTION_EXPIRY'`,
          [f.tenant],
        )
      ).rows[0].count,
      "1",
    );
    assert.equal(
      (
        await commandProduction(f.s, {
          action: "WASTE",
          id: p.id,
          version: 3,
          confirmed: true,
          idempotencyKey: randomUUID(),
          qty: 8,
          note: "FAKE disposal",
        })
      ).status,
      "OK",
    );
    assert.equal((await runProductionFollowups(f.tenant)).processed, 0);
  }));
test("duty resolves at planned occurrence, remains pinned, and no match stays unassigned", async () =>
  fixture(async (f) => {
    const startsAt = new Date(Date.now() + 3600000).toISOString(),
      endsAt = new Date(Date.now() + 7200000).toISOString();
    const r = await commandOperationTeam(f.s, {
      action: "SAVE_ROSTER",
      locationId: f.location,
      dutyKey: "prep",
      dutyName: "FAKE Prep",
      assignedTo: f.actor,
      startsAt,
      endsAt,
      idempotencyKey: randomUUID(),
      confirmed: true,
    });
    assert.equal(r.status, "OK");
    assert.equal(
      (
        await commandOperationTeam(f.s, {
          action: "PUBLISH_ROSTER",
          id: r.id,
          version: 1,
          idempotencyKey: randomUUID(),
          confirmed: true,
        })
      ).status,
      "OK",
    );
    const p = await f.create({
      assignedTo: null,
      dutyKey: "prep",
      dueAt: startsAt,
    });
    assert.equal(p.status, "OK");
    const d = await productionDetail(f.s, p.id);
    assert.equal(d.assigned_to, f.actor);
    const evidence = (
      await query(
        `SELECT assignment_evidence FROM bms_operation_runs WHERE tenant_id=$1 AND id=$2`,
        [f.tenant, d.run_id],
      )
    ).rows[0];
    assert.equal(evidence.assignment_evidence.effectiveAt, startsAt);
    const missing = await f.create({
      assignedTo: null,
      dutyKey: "missing",
      dueAt: startsAt,
    });
    assert.equal((await productionDetail(f.s, missing.id)).assigned_to, null);
  }));
test("recipe menu consumes prepared stock once, not the original production ingredients", async () =>
  fixture(async (f) => {
    const p = await f.ready();
    await f.post(p);
    await f.product("FAKE-DISH");
    await query(
      `INSERT INTO bms_product_stock_policies(tenant_id,product_sku,stock_policy) VALUES($1,'FAKE-DISH','RECIPE') ON CONFLICT(tenant_id,product_sku) DO UPDATE SET stock_policy='RECIPE'`,
      [f.tenant],
    );
    await upsertProductRecipe(
      f.tenant,
      {
        productSku: "FAKE-DISH",
        size: "BASE",
        outputQty: 1,
        active: true,
        directItems: [{ sku: "FAKE-PREP", size: "BASE", qty: 2 }],
      },
      f.actor,
    );
    await f.sale("FAKE-DISH", 1);
    const rows = (
      await query(
        `SELECT product_sku,current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku IN ('FAKE-ING','FAKE-PREP') ORDER BY product_sku`,
        [f.tenant, f.location],
      )
    ).rows;
    assert.deepEqual(rows, [
      { product_sku: "FAKE-ING", current_stock: 980 },
      { product_sku: "FAKE-PREP", current_stock: 6 },
    ]);
  }));
test("real GraphQL resolvers derive scope, reject denial and read/create with actual services", async () =>
  fixture(async (f) => {
    const ctx = {
      scope: "admin",
      admin: { id: f.actor, tenant_id: f.tenant, role: "Administrator" },
      __bmsPerms: f.s.permissions,
    };
    const p = await f.create();
    const result =
      await bmsOperationProductionResolvers.Query.bmsProductionDetail(
        null,
        { id: p.id },
        ctx,
      );
    assert.equal(result.id, p.id);
    const denied =
      await bmsOperationProductionResolvers.Mutation.bmsProductionCommand(
        null,
        {
          input: {
            action: "READY",
            id: p.id,
            version: 1,
            confirmed: true,
            idempotencyKey: randomUUID(),
          },
        },
        { ...ctx, __bmsPerms: new Set(["operations.checklist.view"]) },
      );
    assert.equal(denied.status, "FORBIDDEN");
    assert.equal(
      (
        await commandProduction(f.s, {
          action: "CANCEL",
          id: p.id,
          version: 1,
          confirmed: true,
          idempotencyKey: randomUUID(),
          note: "FAKE cancelled",
        })
      ).status,
      "OK",
    );
    assert.equal(
      (
        await commandProduction(f.s, {
          action: "READY",
          id: p.id,
          version: 2,
          confirmed: true,
          idempotencyKey: randomUUID(),
        })
      ).status,
      "INVALID_STATE",
    );
  }));
