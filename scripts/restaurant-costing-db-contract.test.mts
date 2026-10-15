import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getClient, query } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { listProductRecipes, upsertProductRecipe } from "../apps/web/lib/bms/productRecipes.ts";
import { getRecipeCostEstimate } from "../apps/web/lib/bms/recipeCostEstimates.ts";
import { previewRestaurantPricePlan } from "../apps/web/lib/bms/restaurantPricePlans.ts";
import { previewRestaurantMenuPlan } from "../apps/web/lib/bms/restaurantMenuPlans.ts";
import { getOperatingCostReport, getOperatingCostsInTx, reviewOperatingCost } from "../apps/web/lib/bms/operatingCosts.ts";
import { getCostAllocationReport, getCostAllocationReportInTx, previewCostAllocation, saveCostAllocation } from "../apps/web/lib/bms/costAllocations.ts";
import { getSalesEvidence, scanSalesEvidence } from "../apps/web/lib/bms/salesEvidence.ts";
import { getNetProfitReport } from "../apps/web/lib/bms/netProfit.ts";
import { recordPosSale, returnPosSale, partiallyReturnPosSale, voidPosSale } from "../apps/web/lib/bms/pos.ts";
import { voidExpenseDocument } from "../apps/web/lib/bms/expenseDocuments.ts";
import { createPosExpense } from "../apps/web/lib/bms/posExpenses.ts";
import { bmsOperatingCostResolvers } from "../apps/web/graphql/bmsOperatingCosts.ts";
import { bmsCostAllocationResolvers } from "../apps/web/graphql/bmsCostAllocations.ts";
import { bmsNetProfitResolvers } from "../apps/web/graphql/bmsNetProfit.ts";
import { bmsRestaurantPricePlanResolvers } from "../apps/web/graphql/bmsRestaurantPricePlans.ts";
import { bmsRestaurantMenuPlanResolvers } from "../apps/web/graphql/bmsRestaurantMenuPlans.ts";
import { bmsSalesEvidenceResolvers } from "../apps/web/graphql/bmsSalesEvidence.ts";
import { withCostingFixture, withAuditFailure } from "./testing/restaurantCostingFixture.mts";

// Phase 1's real kitchen-round/split/merge/settlement regression remains in restaurant-pos-db-contract.
// This suite fills phases 2–9 with real service SQL, RLS, transactions and source evidence.
type Fixture = Parameters<Parameters<typeof withCostingFixture>[0]>[0];
const assumptions = { labor: { quantity: 60, rate: 20, source: "FAKE whole batch labor" },
  electricity: { quantity: 2, rate: 5, source: "FAKE kWh" }, gas: { quantity: 1, rate: 10, source: "FAKE kg" } };
const scenario = (label = "Retail", patch: Record<string, unknown> = {}) => ({ label, price: 107,
  vatMode: "INCLUSIVE", vatPercent: 7, gpPercent: 10, gpBasis: "NET_REVENUE", extraUnitCost: 0,
  expectedDailyUnits: 10, targetMarginPercent: 30, ...patch });
const priceInput = (recipeId: string) => ({ recipeId, assumptionSource: "FAKE dated demand",
  dailyFixedCost: 100, dailyTargetProfit: 50, scenarios: [scenario()] });
async function recipe(f: Fixture, sku = "FAKE-MENU", patch: Record<string, unknown> = {}) {
  return upsertProductRecipe(f.tenant, { productSku: sku, size: "BASE", outputQty: 2, active: true,
    directItems: [{ sku: "FAKE-RICE", size: "BASE", qty: 2 }], costAssumptions: assumptions, ...patch }, f.actor);
}
async function recipeFixture(f: Fixture) {
  await query("INSERT INTO bms_store_capabilities(tenant_id,capability,enabled) VALUES ($1,'RECIPE',TRUE)",[f.tenant]);
  for (const sku of ["FAKE-RICE", "FAKE-SAUCE", "FAKE-MENU", "FAKE-SECOND"]) await f.product(sku, sku === "FAKE-RICE" ? 10 : 40);
}
const filter = (f: Fixture) => ({ from: `${f.month}-01`,
  to: new Date(Date.UTC(Number(f.month.slice(0,4)), Number(f.month.slice(5)), 0)).toISOString().slice(0,10) });
async function review(f: Fixture, sourceKey: string, patch: Record<string, unknown> = {}) {
  const row = (await getOperatingCostReport(f.tenant, f.actor, f.month)).rows.find(r => r.key === sourceKey)!;
  assert.ok(row, sourceKey);
  const input = { sourceKey, sourceFingerprint: row.fingerprint, expectedVersion: row.review?.version ?? 0,
    confirmed: true, disposition: "OPERATING", reason: "FAKE reviewed source", ...patch };
  const saved = await reviewOperatingCost(f.tenant, f.actor, input);
  return { input, saved };
}
function allocationInput(f: Fixture, sourceKey: string, method = "DIRECT") {
  return { month: f.month, sourceKey, rule: { method, reason: "FAKE allocation",
    targets: (method === "DIRECT" ? [f.location] : f.locations).map(locationId => ({ locationId, channel: "pos" })) } };
}
async function allocate(f: Fixture, sourceKey: string, method = "DIRECT") {
  const input = allocationInput(f, sourceKey, method);
  const preview = await previewCostAllocation(f.tenant, f.actor, input);
  const request = { ...input, expectedVersion: preview.expectedVersion, previewFingerprint: preview.snapshot.fingerprint, confirmed: true };
  return { input, preview, request, saved: await saveCostAllocation(f.tenant, f.actor, request) };
}
const audits = async (f: Fixture, action: string) => Number((await query(
  "SELECT count(*) AS n FROM bms_audit_log WHERE tenant_id=$1 AND action=$2", [f.tenant, action])).rows[0].n);

test("phase 2: pinned inactive subrecipes compile once; SOP and child edits append versions", async () => {
  await withCostingFixture(async f => {
    await recipeFixture(f);
    const child = await recipe(f, "FAKE-SAUCE", { outputQty: 10, directItems: [{ sku: "FAKE-RICE", size: "BASE", qty: 20 }] });
    const parent = await recipe(f, "FAKE-MENU", { subrecipes: [{ recipeId: child.id, qty: 5 }], sopSteps: ["Mix", "Cook"] });
    assert.deepEqual(parent.items, [{ sku: "FAKE-RICE", size: "BASE", qty: 12 }]);
    await recipe(f, "FAKE-SAUCE", { id: child.id, outputQty: 10, directItems: [{ sku: "FAKE-RICE", size: "BASE", qty: 40 }] });
    const edited = await recipe(f, "FAKE-MENU", { id: parent.id, sopSteps: ["Mix", "Cook", "Serve"] });
    assert.notEqual(edited.id, parent.id);
    assert.deepEqual(edited.items, parent.items);
    assert.equal(edited.subrecipes[0].recipeId, child.id);
    const history = await listProductRecipes(f.tenant, "FAKE-MENU");
    assert.deepEqual(history.find(r => r.id === parent.id)!.sopSteps, ["Mix", "Cook"]);
    assert.equal(await audits(f, "product.recipe_upsert"), 4);
  });
});

test("phase 2: foreign pins, cycles and fractional expansion roll back definition and audit", async () => {
  await withCostingFixture(async f => withCostingFixture(async other => {
    await recipeFixture(f); await recipeFixture(other);
    const child = await recipe(f, "FAKE-SAUCE", { outputQty: 3 });
    const foreign = await recipe(other);
    const initial = await recipe(f);
    const before = await audits(f, "product.recipe_upsert");
    for (const id of [child.id, foreign.id, initial.id]) {
      await assert.rejects(recipe(f, "FAKE-MENU", { id: initial.id, subrecipes: [{ recipeId: id, qty: 1 }] }));
    }
    assert.deepEqual(await listProductRecipes(f.tenant, "FAKE-MENU"), [initial]);
    assert.equal(await audits(f, "product.recipe_upsert"), before);
    const owner = await getClient();
    try {
      await owner.query("BEGIN");
      await assert.rejects(owner.query(`INSERT INTO bms_product_recipe_subrecipes(tenant_id,recipe_id,child_recipe_id,qty)
        VALUES ($1,$2,$3,1)`, [f.tenant, initial.id, foreign.id]), { code: "23503" });
    } finally { await owner.query("ROLLBACK"); owner.release(); }
  }));
});

test("phases 2–3: simultaneous composition saves retain pins and distinct versions without deadlock", async () => {
  await withCostingFixture(async f => {
    await recipeFixture(f);
    const child = await recipe(f, "FAKE-SAUCE");
    const parent = await recipe(f, "FAKE-MENU", { subrecipes: [{ recipeId: child.id, qty: 2 }] });
    const updates = await Promise.all(["A", "B", "C"].map(step => recipe(f, "FAKE-MENU", { id: parent.id, active: false, sopSteps: [step] })));
    assert.deepEqual(updates.map(r => r.version).sort(), [2,3,4]);
    assert.ok(updates.every(r => r.subrecipes[0].recipeId === child.id && r.items[0].qty === 4));
  });
});

test("phase 3: current catalog estimates include whole-batch overhead once and preserve unknown inputs", async () => {
  await withCostingFixture(async f => {
    await recipeFixture(f);
    const saved = await recipe(f);
    const estimate = await getRecipeCostEstimate(f.tenant, saved.id);
    assert.equal(estimate!.totalBatchCost, 60); assert.equal(estimate!.totalUnitCost, 30);
    await query("UPDATE bms_products SET cost_price=15 WHERE tenant_id=$1 AND sku='FAKE-RICE'", [f.tenant]);
    assert.equal((await getRecipeCostEstimate(f.tenant, saved.id))!.totalUnitCost, 35);
    const cleared = await recipe(f, "FAKE-MENU", { id: saved.id, costAssumptions: null });
    assert.notEqual(cleared.id, saved.id);
    assert.equal((await getRecipeCostEstimate(f.tenant, cleared.id))!.totalUnitCost, null);
    assert.equal((await getRecipeCostEstimate(f.tenant, saved.id))!.totalUnitCost, 35);
    await query("UPDATE bms_products SET cost_price=NULL WHERE tenant_id=$1 AND sku='FAKE-RICE'", [f.tenant]);
    const missing = await getRecipeCostEstimate(f.tenant, saved.id);
    assert.equal(missing!.status, "INCOMPLETE"); assert.equal(missing!.knownBatchCost, 40);
    assert.equal(await getRecipeCostEstimate(randomUUID(), saved.id), null);
  });
});

test("phases 5–6: price, VAT/GP, break-even and bundles use real recipe costs without saving selling rules", async () => {
  await withCostingFixture(async f => {
    await recipeFixture(f);
    const a = await recipe(f), b = await recipe(f, "FAKE-SECOND");
    const before = await query("SELECT sku,price FROM bms_products WHERE tenant_id=$1 ORDER BY sku", [f.tenant]);
    const price = await previewRestaurantPricePlan(f.tenant, priceInput(a.id));
    assert.equal(price.status, "OK"); assert.equal(price.scenarios[0].contribution, 60);
    assert.equal(price.scenarios[0].breakEvenUnits, 2); assert.equal(price.scenarios[0].targetDailyUnits, 3);
    const input = { assumptionSource: "FAKE demand, same branch/day", dailyFixedCost: 100, dailyTargetProfit: 50,
      items: [{ recipeId: a.id, scenario: scenario("A") }, { recipeId: b.id, scenario: scenario("B") }],
      bundle: { scenario: scenario("Bundle", { price: 160.5 }), parts: [{ recipeId: a.id, qty: 1 }, { recipeId: b.id, qty: 1 }] } };
    const menu = await previewRestaurantMenuPlan(f.tenant, input);
    assert.equal(menu.status, "OK"); assert.equal(menu.analysis!.status, "COMPLETE");
    assert.equal(menu.analysis!.totalContribution, 1200); assert.equal(menu.analysis!.projectedProfit, 1100);
    assert.equal(menu.analysis!.bundle!.recipeCost, 60); assert.equal(menu.analysis!.bundle!.price.contribution, 75);
    assert.deepEqual((await query("SELECT sku,price FROM bms_products WHERE tenant_id=$1 ORDER BY sku", [f.tenant])).rows, before.rows);
    assert.equal((await query("SELECT count(*)::int AS n FROM bms_orders WHERE tenant_id=$1", [f.tenant])).rows[0].n, 0);
    assert.equal((await previewRestaurantPricePlan(randomUUID(), priceInput(a.id))).status, "NOT_FOUND");
    await query("UPDATE bms_products SET cost_price=NULL WHERE tenant_id=$1 AND sku='FAKE-RICE'", [f.tenant]);
    const unknown = await previewRestaurantMenuPlan(f.tenant, input);
    assert.equal(unknown.analysis!.status, "INCOMPLETE_COST");
    assert.ok(unknown.analysis!.rows.every(r => r.classification === "UNCLASSIFIED"));
    assert.equal((await previewRestaurantPricePlan(f.tenant, priceInput(a.id))).scenarios[0].contribution, null);
  });
});

test("phase 4: reviewed expenses replay once, deduplicate by source and detect changed evidence", async () => {
  await withCostingFixture(async f => {
    const a = await f.expense(100), b = await f.expense(100);
    const key = `DOCUMENT:${a.id}`;
    const { input } = await review(f, key);
    assert.deepEqual(await reviewOperatingCost(f.tenant, f.actor, input), { version: 1 });
    assert.equal(await audits(f, "report.operating_cost_review"), 1);
    assert.equal((await getOperatingCostReport(f.tenant, f.actor, f.month)).reviewedTotal, null);
    await review(f, `DOCUMENT:${b.id}`, { disposition: "DUPLICATE", duplicateKey: key });
    const report = await getOperatingCostReport(f.tenant, f.actor, f.month);
    assert.equal(report.reviewedTotal, 100); assert.equal(report.duplicateCount, 1);
    await query("UPDATE bms_expense_documents SET amount_before_vat=101 WHERE tenant_id=$1 AND id=$2", [f.tenant, a.id]);
    assert.equal((await getOperatingCostReport(f.tenant, f.actor, f.month)).reviewedTotal, null);
    await assert.rejects(reviewOperatingCost(f.tenant, f.actor, { ...input, expectedVersion: 1 }), /COST_SOURCE_CHANGED/);
    await assert.rejects(reviewOperatingCost(randomUUID(), f.actor, input), /COST_SOURCE_NOT_FOUND/);
  });
});

test("phase 4: concurrent decisions serialize; audit failure rolls back review and allows clean retry", async () => {
  await withCostingFixture(async f => {
    const doc = await f.expense(); const key = `DOCUMENT:${doc.id}`;
    const row = (await getOperatingCostReport(f.tenant, f.actor, f.month)).rows[0];
    const input = { sourceKey: key, sourceFingerprint: row.fingerprint, expectedVersion: 0, confirmed: true,
      disposition: "OPERATING", reason: "FAKE concurrent" };
    await withAuditFailure(f.tenant, "report.operating_cost_review", async () => {
      await assert.rejects(reviewOperatingCost(f.tenant, f.actor, input), /TEST_COST_AUDIT_FAILURE/);
    });
    assert.equal((await query("SELECT * FROM bms_operating_cost_reviews WHERE tenant_id=$1", [f.tenant])).rowCount, 0);
    const outcomes = await Promise.allSettled([reviewOperatingCost(f.tenant, f.actor, input),
      reviewOperatingCost(f.tenant, f.actor, { ...input, reason: "FAKE competing decision" })]);
    assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
    const failed = outcomes.find(r => r.status === "rejected") as PromiseRejectedResult;
    assert.match(failed.reason.message, /COST_REVIEW_CONFLICT/);
    assert.equal(await audits(f, "report.operating_cost_review"), 1);
  });
});

test("phase 4: depreciation, supplier credits and inventory exclusion use source-backed monthly amounts", async () => {
  await withCostingFixture(async f => {
    const asset = await f.expense(1200, { category: "OTHER" });
    await review(f, `DOCUMENT:${asset.id}`, { disposition: "DEPRECIATION", startMonth: f.month, lifeMonths: 12, residual: 0 });
    const credit = await f.expense(20, { documentKind: "SUPPLIER_CREDIT_NOTE", receivedDate: `${f.month}-01`,
      vatAmount: 1.4, payeeTaxId: "0105555555554", payeeBranchCode: "00000",
      referenceDocumentNo: "FAKE ORIGINAL", adjustmentReason: "FAKE credit", documentNo: randomUUID() });
    await review(f, `DOCUMENT:${credit.id}`);
    const stock = await f.expense(500, { category: "INVENTORY" });
    await assert.rejects(review(f, `DOCUMENT:${stock.id}`), /COST_INVENTORY_ALREADY_IN_COGS/);
    await review(f, `DOCUMENT:${stock.id}`, { disposition: "EXCLUDED" });
    const report = await getOperatingCostReport(f.tenant, f.actor, f.month);
    assert.equal(report.depreciationAmount, 100); assert.equal(report.operatingAmount, -20); assert.equal(report.reviewedTotal, 80);
  });
});

test("phase 4: settled POS expenses and LIVE statement GP are counted once; retired provider evidence becomes unknown", async () => {
  await withCostingFixture(async f => {
    const reg = await f.register();
    const expense = await createPosExpense({ tenantId:f.tenant,deviceId:reg.device,shiftId:reg.shift,actorUserId:f.actor,
      kind:"DIRECT",category:"OTHER",description:"FAKE paid expense",fundingSource:"PERSONAL",amount:25,
      receiptRef:"FAKE receipt",idempotencyKey:randomUUID() });
    assert.equal(expense.status,"RECORDED",JSON.stringify(expense));
    if(expense.status!=="RECORDED") throw new Error("Fixture expense failed");
    const integration = (await query(`INSERT INTO bms_delivery_integrations(tenant_id,provider,environment)
      VALUES ($1,'FOODPANDA','LIVE') RETURNING id`,[f.tenant])).rows[0].id;
    const statement = (await query(`INSERT INTO bms_delivery_settlements
      (tenant_id,integration_id,provider,period_start,period_end,statement_reference,source,fee_amount,commission_amount,status)
      VALUES ($1,$2,'FOODPANDA',now()-interval '1 second',now(),'FAKE statement','MANUAL',5,10,'MATCHED') RETURNING id`,[f.tenant,integration])).rows[0].id;
    await review(f,`POS_EXPENSE:${expense.expense.id}`);
    await assert.rejects(review(f,`STATEMENT:${statement}`),/COST_STATEMENT_GP_ONLY/);
    await review(f,`STATEMENT:${statement}`,{disposition:"GP"});
    const report = await getOperatingCostReport(f.tenant,f.actor,f.month);
    assert.equal(report.operatingAmount,25); assert.equal(report.gpAmount,15); assert.equal(report.reviewedTotal,40);
    await query("UPDATE bms_delivery_integrations SET environment='SANDBOX' WHERE tenant_id=$1 AND id=$2",[f.tenant,integration]);
    const retired = await getOperatingCostReport(f.tenant,f.actor,f.month);
    assert.equal(retired.reviewedTotal,null);
    assert.equal(retired.rows.find(r=>r.key===`STATEMENT:${statement}`)!.state,"SOURCE_CHANGED");
  });
});

test("phase 8: confirmed allocation conserves cents, appends versions, replays without audit and rolls back audit failure", async () => {
  await withCostingFixture(async f => {
    const key = `DOCUMENT:${(await f.expense(10.01)).id}`; await review(f, key);
    const input = allocationInput(f, key, "EQUAL"), preview = await previewCostAllocation(f.tenant, f.actor, input);
    assert.deepEqual(preview.snapshot.allocations.map(r => r.amount).sort(), ["5.00", "5.01"]);
    const request = { ...input, confirmed: true, expectedVersion: preview.expectedVersion, previewFingerprint: preview.snapshot.fingerprint };
    await assert.rejects(saveCostAllocation(f.tenant, f.actor, { ...request, confirmed: false }), /CONFIRMATION_REQUIRED/);
    await withAuditFailure(f.tenant, "report.cost_allocation", async () => {
      await assert.rejects(saveCostAllocation(f.tenant, f.actor, request), /TEST_COST_AUDIT_FAILURE/);
    });
    assert.equal((await query("SELECT * FROM bms_cost_allocations WHERE tenant_id=$1", [f.tenant])).rowCount, 0);
    assert.equal((await saveCostAllocation(f.tenant, f.actor, request)).version, 1);
    assert.equal((await saveCostAllocation(f.tenant, f.actor, request)).replayed, true);
    assert.equal(await audits(f, "report.cost_allocation"), 1);
    const next = await allocate(f, key);
    assert.equal(next.saved.version, 2);
    assert.equal((await query("SELECT * FROM bms_cost_allocations WHERE tenant_id=$1", [f.tenant])).rowCount, 2);
    assert.equal((await getCostAllocationReport(f.tenant, f.actor, f.month)).allocatedTotal, "10.01");
    await assert.rejects(saveCostAllocation(f.tenant, f.actor, { ...request, rule: { ...request.rule, reason: "stale version" } }), /CONFLICT/);
  });
});

test("phase 8: competing saves have one winner and stale source previews cannot commit", async () => {
  await withCostingFixture(async f => {
    const doc = await f.expense(10); const key = `DOCUMENT:${doc.id}`; await review(f, key);
    const a = allocationInput(f, key), b = allocationInput(f, key, "EQUAL");
    const pa = await previewCostAllocation(f.tenant, f.actor, a), pb = await previewCostAllocation(f.tenant, f.actor, b);
    const results = await Promise.allSettled([[a,pa],[b,pb]].map(([input,p]: any) => saveCostAllocation(f.tenant,f.actor,
      { ...input, expectedVersion:p.expectedVersion, previewFingerprint:p.snapshot.fingerprint, confirmed:true })));
    assert.equal(results.filter(r=>r.status === "fulfilled").length, 1);
    assert.match((results.find(r=>r.status === "rejected") as PromiseRejectedResult).reason.message, /CONFLICT/);
    const fresh = await previewCostAllocation(f.tenant,f.actor,a);
    await review(f,key,{ reason:"Updated allocation basis" });
    await assert.rejects(saveCostAllocation(f.tenant,f.actor,{...a,expectedVersion:fresh.expectedVersion,
      previewFingerprint:fresh.snapshot.fingerprint,confirmed:true}), /PREVIEW_STALE/);
    assert.equal((await getCostAllocationReport(f.tenant,f.actor,f.month)).rows[0].state,"STALE");
    await review(f,key,{disposition:"EXCLUDED"});
    const retired = await getCostAllocationReport(f.tenant,f.actor,f.month);
    assert.equal(retired.rows[0].state,"INACTIVE"); assert.equal(retired.allocatedTotal,"0.00");
  });
});

test("phases 7–9: real POS snapshots, sales drivers and reviewed expenses reconcile to recorded profit", async () => {
  await withCostingFixture(async f => {
    await f.product("FAKE-SALE");
    await f.sale("FAKE-SALE", 1); await f.sale("FAKE-SALE", 3, f.locations[1]);
    const key = `DOCUMENT:${(await f.expense(40)).id}`; await review(f,key);
    const saved = await allocate(f,key,"SALES_GROSS");
    assert.equal(saved.preview.snapshot.allocations.find(r=>r.locationId===f.location)!.amount,"10.00");
    assert.equal(saved.preview.snapshot.allocations.find(r=>r.locationId===f.locations[1])!.amount,"30.00");
    const evidence = await getSalesEvidence(f.tenant,f.actor,filter(f));
    assert.equal(evidence.eventCount,2); assert.equal(evidence.truncated,false);
    const profit = await getNetProfitReport(f.tenant,f.actor,f.month);
    assert.equal(profit.totals.netRevenue,"400.00"); assert.equal(profit.totals.netCost,"160.00");
    assert.equal(profit.totals.expenseTotal,"40.00"); assert.equal(profit.totals.netProfit,"200.00");
    assert.equal(profit.branches.find(r=>r.locationId===f.location)!.netProfit,"50.00");
    await query("UPDATE bms_products SET cost_price=999 WHERE tenant_id=$1",[f.tenant]);
    assert.equal((await getNetProfitReport(f.tenant,f.actor,f.month)).totals.netProfit,"200.00");
    await f.sale("FAKE-SALE");
    assert.equal((await getCostAllocationReport(f.tenant,f.actor,f.month)).rows[0].state,"STALE");
  });
});

test("phase 7: partial/full returns freeze VAT, replay once and prevent financial snapshot updates", async () => {
  await withCostingFixture(async f => {
    await f.product("FAKE-SALE"); const sold = await f.sale("FAKE-SALE",2);
    const item = (await query("SELECT id FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2",[f.tenant,sold.orderId])).rows[0];
    const common = { tenantId:f.tenant,deviceId:sold.device,shiftId:sold.shift,orderId:sold.orderId,
      actorUserId:f.actor,approvedByUserId:f.approver,note:"[CUSTOMER_CHANGE] FAKE return" };
    const request = {...common,idempotencyKey:randomUUID(),lines:[{orderItemId:Number(item.id),packQty:1}]};
    const first = await partiallyReturnPosSale(request);
    assert.equal(first.status,"PARTIAL_RETURNED",JSON.stringify(first));
    assert.equal((await partiallyReturnPosSale(request)).status,"PARTIAL_RETURNED");
    const full = await returnPosSale({...common,idempotencyKey:randomUUID()});
    assert.equal(full.status,"RETURNED",JSON.stringify(full));
    const rows = (await query("SELECT id,financial_snapshot FROM bms_pos_returns WHERE tenant_id=$1 ORDER BY created_at",[f.tenant])).rows;
    assert.equal(rows.length,2); assert.ok(rows.every(r=>r.financial_snapshot?.version===1));
    assert.deepEqual(rows.map(r=>r.financial_snapshot.tax.vat),["7.00","7.00"]);
    assert.ok(rows.every(r=>r.financial_snapshot.issues.length===0));
    await assert.rejects(query("UPDATE bms_pos_returns SET financial_snapshot=NULL WHERE tenant_id=$1 AND id=$2",[f.tenant,rows[0].id]), /snapshot is immutable/);
    const events: any[] = []; await scanSalesEvidence(f.tenant,f.actor,filter(f), e => { events.push(e); });
    assert.equal(events.filter(e=>e.kind==="SALE").length,1);
    assert.equal(events.filter(e=>e.kind==="RETURN").length,2);
    const profit = await getNetProfitReport(f.tenant,f.actor,f.month);
    // Real POS returns also issue credit notes. Phase 9 deliberately leaves unreconciled tax
    // adjustments unknown; the separately known sale/return evidence must still balance exactly.
    assert.equal(profit.totals.netRevenue,null); assert.equal(profit.totals.knownReturnRevenue,"200.00");
    assert.equal(profit.totals.knownSalesRevenue,"200.00");
    assert.ok(profit.issues.some(r=>r.code==="TAX_ADJUSTMENT_REQUIRES_RECONCILIATION"));
    assert.equal(profit.totals.refundCompleted,"214.00"); assert.equal(profit.totals.netProfit,null);
    assert.ok(profit.issues.some(r=>r.code==="RETURN_COST_REVERSAL_UNVERIFIED"));
  });
});

test("phase 7: concurrent full-return retry creates one immutable snapshot and one stock recovery", async () => {
  await withCostingFixture(async f => {
    await f.product("FAKE-SALE"); const sold = await f.sale("FAKE-SALE");
    const input = {tenantId:f.tenant,deviceId:sold.device,shiftId:sold.shift,orderId:sold.orderId,actorUserId:f.actor,
      approvedByUserId:f.approver,note:"[CUSTOMER_CHANGE] FAKE concurrent",idempotencyKey:randomUUID()};
    const results = await Promise.all([returnPosSale(input),returnPosSale(input)]);
    assert.ok(results.every(r=>r.status==="RETURNED"),JSON.stringify(results));
    assert.equal((await query("SELECT count(*)::int AS n FROM bms_pos_returns WHERE tenant_id=$1",[f.tenant])).rows[0].n,1);
    assert.equal((await query("SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-SALE'",[f.tenant,f.location])).rows[0].current_stock,1000);
  });
});

test("phase 7: failing the return audit rolls back snapshot, money and stock together", async () => {
  await withCostingFixture(async f => {
    await f.product("FAKE-SALE"); const sold = await f.sale("FAKE-SALE");
    const input = {tenantId:f.tenant,deviceId:sold.device,shiftId:sold.shift,orderId:sold.orderId,actorUserId:f.actor,
      approvedByUserId:f.approver,note:"[CUSTOMER_CHANGE] FAKE rollback",idempotencyKey:randomUUID()};
    const before = (await query("SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2",[f.tenant,f.location])).rows;
    await withAuditFailure(f.tenant,"pos.return",async()=>{
      await assert.rejects(returnPosSale(input),/TEST_COST_AUDIT_FAILURE/);
    });
    for(const table of ["bms_pos_returns","bms_pos_refund_allocations"])
      assert.equal((await query(`SELECT * FROM ${table} WHERE tenant_id=$1`,[f.tenant])).rowCount,0);
    assert.deepEqual((await query("SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2",[f.tenant,f.location])).rows,before);
    assert.equal((await returnPosSale(input)).status,"RETURNED");
    assert.equal(await audits(f,"pos.return"),1);
  });
});

test("phase 7: mixed-VAT partial/full returns conserve saved tax/extras across branches and event months", async () => {
  await withCostingFixture(async f => {
    await f.product("FAKE-TAXED",40,107); await f.product("FAKE-EXEMPT",20,50);
    await query("UPDATE bms_products SET vat_category='N' WHERE tenant_id=$1 AND sku='FAKE-EXEMPT'",[f.tenant]);
    const reg=await f.register(), receiving=await f.register(f.locations[1]);
    const sold=await recordPosSale({tenantId:f.tenant,deviceId:reg.device,shiftId:reg.shift,cashierUserId:f.actor,
      idempotencyKey:randomUUID(),lines:[{sku:"FAKE-TAXED",size:"BASE",packQty:1},{sku:"FAKE-EXEMPT",size:"BASE",packQty:1}],
      extraLines:[{label:"FAKE packaging",qty:1,unitAmount:7}],manualDiscount:10,discountApprovedBy:f.approver,
      discountReason:"FAKE mixed return",payments:[{method:"CASH",amount:154,cashTendered:154}]});
    assert.equal(sold.status,"SOLD",JSON.stringify(sold)); if(sold.status!=="SOLD") throw new Error("Fixture mixed sale failed");
    assert.ok("orderId" in sold && typeof sold.orderId === "string");
    // Synthetic event clock for this fixture only; never rebuild or alter monetary snapshots.
    const previousMonth=(await query(`UPDATE bms_orders SET paid_at=(date_trunc('month',now() AT TIME ZONE 'Asia/Bangkok')
      - interval '1 day') AT TIME ZONE 'Asia/Bangkok' WHERE tenant_id=$1 AND id=$2
      RETURNING to_char(paid_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM') AS month`,[f.tenant,sold.orderId])).rows[0].month;
    const item=(await query("SELECT id FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2 AND product_sku='FAKE-EXEMPT'",[f.tenant,sold.orderId])).rows[0];
    const common={tenantId:f.tenant,deviceId:receiving.device,shiftId:receiving.shift,orderId:sold.orderId,
      actorUserId:f.actor,approvedByUserId:f.approver,note:"[CUSTOMER_CHANGE] FAKE mixed cross branch"};
    const first=await partiallyReturnPosSale({...common,idempotencyKey:randomUUID(),lines:[{orderItemId:Number(item.id),packQty:1}]});
    assert.equal(first.status,"PARTIAL_RETURNED",JSON.stringify(first));
    assert.equal((await returnPosSale({...common,idempotencyKey:randomUUID()})).status,"RETURNED");
    const snapshots=(await query("SELECT financial_snapshot FROM bms_pos_returns WHERE tenant_id=$1 ORDER BY created_at",[f.tenant])).rows.map(r=>r.financial_snapshot);
    assert.equal(snapshots.length,2); assert.ok(snapshots.every(s=>s.tax && s.issues.length===0),JSON.stringify(snapshots));
    const cents=(v:string)=>Math.round(Number(v)*100);
    assert.equal(snapshots.reduce((n,s)=>n+cents(s.tax.vat),0),cents(snapshots[0].source.vat));
    assert.equal(snapshots.reduce((n,s)=>n+cents(s.tax.exemptGross),0),cents(snapshots[0].source.exempt));
    assert.equal(snapshots[0].components.extrasGross,"0.00"); assert.equal(snapshots[1].components.extrasGross,"7.00");
    const oldEvents:any[]=[],currentEvents:any[]=[];
    await scanSalesEvidence(f.tenant,f.actor,filter({...f,month:previousMonth}),e=>{oldEvents.push(e);});
    await scanSalesEvidence(f.tenant,f.actor,filter(f),e=>{currentEvents.push(e);});
    assert.equal(oldEvents.filter(e=>e.kind==="SALE").length,1);
    assert.equal(currentEvents.filter(e=>e.kind==="SALE").length,0);
    assert.equal(currentEvents.filter(e=>e.kind==="RETURN").length,2);
    assert.ok(currentEvents.filter(e=>e.kind==="RETURN").every(e=>e.locationId===f.locations[1]));
    assert.equal((await getNetProfitReport(f.tenant,f.actor,f.month)).totals.netProfit,null);
  });
});

test("phase 7: void reuses the immutable return snapshot and an exact retry does not refund again", async () => {
  await withCostingFixture(async f => {
    await f.product("FAKE-SALE"); const sold=await f.sale("FAKE-SALE");
    const request={tenantId:f.tenant,deviceId:sold.device,shiftId:sold.shift,orderId:sold.orderId,
      actorUserId:f.actor,approvedByUserId:f.approver,reason:"FAKE incorrect bill",idempotencyKey:randomUUID()};
    assert.equal((await voidPosSale(request)).status,"VOIDED");
    const before=(await query("SELECT id,financial_snapshot FROM bms_pos_returns WHERE tenant_id=$1",[f.tenant])).rows;
    assert.equal(before.length,1); assert.equal(before[0].financial_snapshot.tax.vat,"7.00");
    assert.equal((await voidPosSale(request)).status,"VOIDED");
    assert.deepEqual((await query("SELECT id,financial_snapshot FROM bms_pos_returns WHERE tenant_id=$1",[f.tenant])).rows,before);
  });
});

test("phase 7: positive and negative cash rounding remain outside frozen return VAT", async () => {
  for(const [price,rounding] of [[107.2,"-0.20"],[106.8,"0.20"]] as const) {
    await withCostingFixture(async f => {
      await query("UPDATE bms_store_profile SET cash_rounding='1.00' WHERE tenant_id=$1",[f.tenant]);
      await f.product("FAKE-SALE",40,price); const sold=await f.sale("FAKE-SALE",1,f.location,107);
      const result=await returnPosSale({tenantId:f.tenant,deviceId:sold.device,shiftId:sold.shift,orderId:sold.orderId,
        actorUserId:f.actor,approvedByUserId:f.approver,note:"[CUSTOMER_CHANGE] FAKE rounding",idempotencyKey:randomUUID()});
      assert.equal(result.status,"RETURNED",JSON.stringify(result));
      const snapshot=(await query("SELECT financial_snapshot FROM bms_pos_returns WHERE tenant_id=$1",[f.tenant])).rows[0].financial_snapshot;
      assert.deepEqual(snapshot.issues,[]); assert.equal(snapshot.amount,"107.00");
      assert.equal(snapshot.components.rounding,rounding); assert.equal(snapshot.source.rounding,rounding);
      assert.equal(snapshot.tax.vat,snapshot.source.vat);
    });
  }
});

test("phases 7–9: keyset pagination loads over 100 real sales without multiplication or skipped events", async () => {
  await withCostingFixture(async f => {
    await f.product("FAKE-SALE");
    for(let i=0;i<101;i++) await f.sale("FAKE-SALE");
    const keys: string[]=[];
    const scan=await scanSalesEvidence(f.tenant,f.actor,filter(f),event=>{keys.push(event.key);});
    assert.equal(scan.eventCount,101); assert.equal(new Set(keys).size,101); assert.equal(scan.truncated,false);
    const profit=await getNetProfitReport(f.tenant,f.actor,f.month);
    assert.equal(profit.totals.netRevenue,"10100.00"); assert.equal(profit.totals.netCost,"4040.00");
    assert.equal(profit.totals.netProfit,"6060.00");
  });
});

test("phases 4/8/9: truncated real expense sources disable complete allocation/profit totals", async () => {
  await withCostingFixture(async f => {
    await query(`INSERT INTO bms_expense_documents
      (tenant_id,location_id,category,document_kind,payee_name,document_date,amount_before_vat,vat_amount,status)
      SELECT $1,$2,'RENT','RECEIPT','FAKE bounded expense',($3||'-01')::date,1,0,'ACTIVE'
      FROM generate_series(1,1001)`,[f.tenant,f.location,f.month]);
    const costs=await getOperatingCostReport(f.tenant,f.actor,f.month);
    assert.equal(costs.truncated,true); assert.equal(costs.reviewedTotal,null);
    const allocations=await getCostAllocationReport(f.tenant,f.actor,f.month);
    assert.equal(allocations.truncated,true); assert.equal(allocations.allocatedTotal,null);
    const profit=await getNetProfitReport(f.tenant,f.actor,f.month);
    assert.equal(profit.truncated,true); assert.equal(profit.totals.netProfit,null);
  });
});

test("phases 7–9: branch scope, currency and foreign references fail closed on real source queries", async () => {
  await withCostingFixture(async f => {
    await f.product("FAKE-SALE"); await f.sale("FAKE-SALE"); await f.sale("FAKE-SALE",1,f.locations[1]);
    await query("INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES ($1,$2,$3)",[f.tenant,f.actor,f.location]);
    assert.equal((await getSalesEvidence(f.tenant,f.actor,filter(f))).eventCount,1);
    await assert.rejects(getSalesEvidence(f.tenant,f.actor,{...filter(f),locationId:f.locations[1]}),/FORBIDDEN/);
    await assert.rejects(getSalesEvidence(f.tenant,f.actor,{...filter(f),locationId:randomUUID()}),/FORBIDDEN/);
    await assert.rejects(getOperatingCostReport(f.tenant,f.actor,f.month),/ALL_BRANCH_ACCESS_REQUIRED/);
    await assert.rejects(getCostAllocationReport(f.tenant,f.actor,f.month),/ALL_BRANCH_ACCESS_REQUIRED/);
    await assert.rejects(getNetProfitReport(f.tenant,f.actor,f.month),/ALL_BRANCH_ACCESS_REQUIRED/);
    await query("DELETE FROM bms_user_allowed_locations WHERE tenant_id=$1",[f.tenant]);
    await query("UPDATE bms_store_profile SET currency='USD' WHERE tenant_id=$1",[f.tenant]);
    await assert.rejects(getSalesEvidence(f.tenant,f.actor,filter(f)),/CURRENCY_REVIEW_REQUIRED/);
    await assert.rejects(getCostAllocationReport(f.tenant,f.actor,f.month),/CURRENCY_REVIEW_REQUIRED/);
    await assert.rejects(getNetProfitReport(f.tenant,f.actor,f.month),/CURRENCY_REVIEW_REQUIRED/);
  });
});

test("phase 9: missing catalog evidence, unreviewed costs and unvalued stock losses remain unknown", async () => {
  await withCostingFixture(async f => {
    await f.product("FAKE-UNKNOWN",null); await f.sale("FAKE-UNKNOWN");
    let report = await getNetProfitReport(f.tenant,f.actor,f.month);
    assert.equal(report.totals.netRevenue,"100.00"); assert.equal(report.totals.netProfit,null);
    await query("UPDATE bms_products SET cost_price=1 WHERE tenant_id=$1",[f.tenant]);
    assert.equal((await getNetProfitReport(f.tenant,f.actor,f.month)).totals.netCost,null);
  });
  await withCostingFixture(async f => {
    await f.product("FAKE-SALE"); await f.sale("FAKE-SALE");
    const doc = await f.expense(10);
    assert.equal((await getNetProfitReport(f.tenant,f.actor,f.month)).totals.netProfit,null);
    await review(f,`DOCUMENT:${doc.id}`);
    assert.equal((await getNetProfitReport(f.tenant,f.actor,f.month)).totals.netProfit,"50.00");
    await query(`INSERT INTO bms_stock_movements(tenant_id,location_id,product_sku,size,type,qty)
      VALUES ($1,$2,'FAKE-SALE','BASE','WASTAGE',1)`,[f.tenant,f.location]);
    const loss = await getNetProfitReport(f.tenant,f.actor,f.month);
    assert.equal(loss.totals.netProfit,null); assert.ok(loss.issues.some(r=>r.code==="INVENTORY_ADJUSTMENT_UNVALUED"));
  });
});

test("phases 4/8/9: source retirement stays visible and serializable readers retain one source snapshot", async () => {
  await withCostingFixture(async f => {
    const doc = await f.expense(10), key=`DOCUMENT:${doc.id}`; await review(f,key); await allocate(f,key);
    const client = await getClient();
    try {
      await beginTenantTx(client,f.tenant,{serializable:true});
      assert.equal((await getOperatingCostsInTx(client,f.tenant,f.month)).reviewedTotal,10);
      await voidExpenseDocument(f.tenant,f.actor,doc.id,"FAKE retirement",f.locations);
      const sameSnapshot = await getCostAllocationReportInTx(client,f.tenant,f.actor,f.month);
      assert.equal(sameSnapshot.allocatedTotal,"10.00");
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally {client.release();}
    const fresh = await getCostAllocationReport(f.tenant,f.actor,f.month);
    assert.equal(fresh.rows[0].state,"STALE"); assert.equal(fresh.allocatedTotal,null);
    assert.equal((await getNetProfitReport(f.tenant,f.actor,f.month)).totals.netProfit,null);
  });
});

test("schema: bms_app RLS isolates recipe pins/reviews/allocations and grants prohibit history rewrites", async () => {
  await withCostingFixture(async f => withCostingFixture(async other => {
    await recipeFixture(f); const child = await recipe(f,"FAKE-SAUCE");
    await recipe(f,"FAKE-MENU",{subrecipes:[{recipeId:child.id,qty:2}]});
    const key=`DOCUMENT:${(await f.expense()).id}`; await review(f,key); await allocate(f,key);
    await assert.rejects(previewCostAllocation(other.tenant,other.actor,allocationInput(other,key)),/SOURCE_REVIEW_REQUIRED/);
    const foreignTarget=allocationInput(f,key);
    foreignTarget.rule.targets[0].locationId=other.location;
    await assert.rejects(previewCostAllocation(f.tenant,f.actor,foreignTarget),/TARGET_NOT_FOUND/);
    const client=await getClient();
    try {
      await beginTenantTx(client,other.tenant);
      for(const table of ["bms_product_recipe_subrecipes","bms_operating_cost_reviews","bms_cost_allocations"])
        assert.equal((await client.query(`SELECT * FROM ${table} WHERE tenant_id=$1`,[f.tenant])).rowCount,0);
      await client.query("ROLLBACK");
      await client.query("BEGIN"); await client.query("SET LOCAL ROLE bms_app");
      for(const table of ["bms_operating_cost_reviews","bms_cost_allocations"])
        assert.equal((await client.query(`SELECT * FROM ${table} WHERE tenant_id=$1`,[f.tenant])).rowCount,0);
      await client.query("ROLLBACK");
      await beginTenantTx(client,f.tenant);
      await assert.rejects(client.query("DELETE FROM bms_cost_allocations WHERE tenant_id=$1",[f.tenant]),{code:"42501"});
      await client.query("ROLLBACK");
      await beginTenantTx(client,other.tenant);
      await assert.rejects(client.query(`INSERT INTO bms_operating_cost_reviews
        (tenant_id,source_key,version,source_fingerprint,decision,request_hash)
        VALUES ($1,$2,1,$3,'{}',$3)`,[f.tenant,`DOCUMENT:${randomUUID()}`,"a".repeat(64)]),{code:"42501"});
    } finally {await client.query("ROLLBACK");client.release();}
  }));
});

test("API: unauthenticated/denied requests fail; real tenant permissions gate report and planning resolvers", async () => {
  await withCostingFixture(async f => {
    await recipeFixture(f); const saved=await recipe(f);
    const calls = [
      (ctx:any)=>bmsOperatingCostResolvers.Query.bmsOperatingCosts(null,{month:f.month},ctx),
      (ctx:any)=>bmsCostAllocationResolvers.Query.bmsCostAllocations(null,{month:f.month},ctx),
      (ctx:any)=>bmsNetProfitResolvers.Query.bmsNetProfit(null,{month:f.month},ctx),
      (ctx:any)=>bmsSalesEvidenceResolvers.Query.bmsSalesEvidence(null,{input:filter(f)},ctx),
      (ctx:any)=>bmsRestaurantPricePlanResolvers.Query.bmsRestaurantPricePlan(null,{input:priceInput(saved.id)},ctx),
      (ctx:any)=>bmsRestaurantMenuPlanResolvers.Query.bmsRestaurantMenuPlan(null,{input:{}},ctx),
    ];
    for(const call of calls) {
      await assert.rejects(call({}),(error:any)=>error.extensions.code==="UNAUTHENTICATED");
      await assert.rejects(call(f.ctx("FAKE no costing permission")),(error:any)=>error.extensions.code==="FORBIDDEN");
      await call(f.ctx());
    }
    assert.equal((await bmsNetProfitResolvers.Query.bmsNetProfit(null,{month:"bad"},f.ctx())).status,"REJECTED");
    const role=(await query("SELECT id FROM roles WHERE name='Cashier' LIMIT 1")).rows[0]; assert.ok(role);
    for(const permission of ["report.view","expense.view","delivery.settlement.view","tax.document.view"])
      await query("INSERT INTO bms_role_permissions(tenant_id,role_id,permission) VALUES ($1,$2,$3)",[f.tenant,role.id,permission]);
    await bmsCostAllocationResolvers.Query.bmsCostAllocations(null,{month:f.month},f.ctx("Cashier"));
    await assert.rejects(bmsCostAllocationResolvers.Mutation.bmsSaveCostAllocation(null,{input:{}},f.ctx("Cashier")),
      (error:any)=>error.extensions.permission==="expense.manage");
  });
});
