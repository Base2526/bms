import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import { buildReturnFinancialSnapshot as build, readReturnFinancialSnapshot as parse } from "../apps/web/lib/bms/returnFinancialSnapshot.ts";
import { inspectSalesEvidence } from "../apps/web/lib/bms/salesEvidenceMath.ts";
import { MIGRATIONS } from "./schemaReadiness.mts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const source = { payable: "329.75", shipping: "20.00", rounding: "-0.25", extras: "10.00", extraTaxable: "10.00",
  taxable: "330.00", exempt: "0.00", vat: "21.59" };
const line = (amount = "100.00", patch: any = {}) => ({ orderItemId: "1", amount, vatCategory: "V", ...patch });
const args = (patch: any = {}): Parameters<typeof build>[0] => ({ amount: "100.00", previousRefund: "0.00", source,
  lines: [line()], exactPricing: true, allReturned: false, previous: [], ...patch });
const history = (s: ReturnType<typeof build>) => ({ amount: s.amount, snapshot: s });

test("exact pricing retains shipping, extras and signed cash rounding until final return", () => {
  const first = build(args());
  assert.deepEqual(first.components, { merchandiseGross: "100.00", extrasGross: "0.00", shippingGross: "0.00", rounding: "0.00" });
  assert.equal(first.tax?.vat, "6.54");
  const last = build(args({ amount: "229.75", lines: [line("229.75")], previousRefund: "100.00", previous: [history(first)], allReturned: true }));
  assert.deepEqual(last.components, { merchandiseGross: "200.00", extrasGross: "10.00", shippingGross: "20.00", rounding: "-0.25" });
  assert.deepEqual(last.tax, { taxableGross: "230.00", exemptGross: "0.00", vat: "15.05", exVat: "214.95" });
});

test("three partial returns conserve every component and original VAT rounding", () => {
  const a = build(args());
  const b = build(args({ previousRefund: "100.00", previous: [history(a)] }));
  const c = build(args({ amount: "129.75", lines: [line("129.75")], previousRefund: "200.00", previous: [history(a), history(b)], allReturned: true }));
  assert.equal([a, b, c].reduce((n, s) => n + Math.round(Number(s.tax?.vat) * 100), 0), 2159);
  assert.equal(c.components?.rounding, "-0.25");
  assert.equal(c.components?.merchandiseGross, "100.00");
});

test("legacy proportional policy carries signed rounding with cumulative satang conservation", () => {
  for (const rounding of ["-0.01", "0.01", "-0.25", "0.25"]) {
    const src = { ...source, payable: (330 + Number(rounding)).toFixed(2), rounding };
    const previous: any[] = []; let total = 0;
    for (let i = 0; i < 3; i++) {
      const amount = i < 2 ? "110.00" : (Number(src.payable) - 220).toFixed(2);
      const s = build(args({ amount, source: src, lines: [line(amount)], previousRefund: total.toFixed(2), previous,
        exactPricing: false, allReturned: i === 2 }));
      assert.ok(s.components); assert.ok(s.tax); previous.push(history(s)); total += Number(amount);
    }
    for (const [field, expected] of [["rounding", rounding], ["shippingGross", "20.00"], ["extrasGross", "10.00"], ["merchandiseGross", "300.00"]]) {
      assert.equal(previous.reduce((n, p) => n + Math.round(Number(p.snapshot.components[field]) * 100), 0), Math.round(Number(expected) * 100));
    }
  }
});

test("mixed VAT exempts the returned exempt product, with taxable shipping on the final return", () => {
  const src = { ...source, taxable: "230.00", exempt: "100.00", vat: "15.05" };
  const a = build(args({ source: src, lines: [line("100.00", { vatCategory: "N" })] }));
  assert.equal(a.tax?.vat, "0.00"); assert.equal(a.tax?.exemptGross, "100.00");
  const b = build(args({ source: src, amount: "229.75", lines: [line("229.75")], previousRefund: "100.00", previous: [history(a)], allReturned: true }));
  assert.equal(b.tax?.vat, "15.05"); assert.equal(b.tax?.taxableGross, "230.00");
});

test("full return uses remaining mixed tax buckets even when final selected line is exempt", () => {
  const s = build(args({ amount: "329.75", lines: [line("329.75", { vatCategory: "N" })], allReturned: true,
    source: { ...source, taxable: "30.00", exempt: "300.00", vat: "1.96" } }));
  assert.equal(s.tax?.taxableGross, "30.00"); assert.equal(s.tax?.vat, "1.96");
});

test("zero refund after repricing/merchant absorption freezes zero, never creates a cash or VAT refund", () => {
  const s = build(args({ amount: "0.00", lines: [line("0.00")] }));
  assert.equal(s.components?.merchandiseGross, "0.00"); assert.equal(s.tax?.vat, "0.00");
});

test("reconciled non-VAT evidence is zero; default-zero legacy sale VAT is unknown", () => {
  const exempt = build(args({ source: { ...source, taxable: "0.00", exempt: "330.00", vat: "0.00" } }));
  assert.equal(exempt.tax?.vat, "0.00");
  const missing = build(args({ source: { ...source, taxable: "0.00", exempt: "0.00", vat: "0.00" } }));
  assert.equal(missing.tax, null); assert.ok(missing.components);
  assert.deepEqual(missing.issues, ["RETURN_SALE_VAT_UNRECONCILED"]);
});

test("legacy prior returns are not backfilled or inferred from refund sums", () => {
  const s = build(args({ previousRefund: "100.00", previous: [{ amount: "100.00", snapshot: null }] }));
  assert.equal(s.components, null); assert.equal(s.tax, null); assert.deepEqual(s.issues, ["RETURN_PRIOR_COMPONENTS_UNKNOWN"]);
});

test("changed source/policy, over-refund, missing history and capped history stay explicitly unknown", () => {
  const a = build(args());
  const cases: [any, string][] = [
    [{ previousRefund: "100.00" }, "RETURN_HISTORY_AMOUNT_MISMATCH"],
    [{ previousRefund: "100.00", previous: [history(a)], source: { ...source, shipping: "21.00" } }, "RETURN_SOURCE_CHANGED"],
    [{ previousRefund: "100.00", previous: [history(a)], exactPricing: false }, "RETURN_SOURCE_CHANGED"],
    [{ amount: "400.00", lines: [line("400.00")] }, "RETURN_PAYABLE_MISMATCH"],
    [{ allReturned: true }, "RETURN_PAYABLE_MISMATCH"],
    [{ previous: Array(1001).fill(history(a)) }, "RETURN_HISTORY_LIMIT"],
  ];
  for (const [patch, issue] of cases) assert.deepEqual(build(args(patch)).issues, [issue]);
});

test("mixed bucket overflow or unknown line VAT never silently borrows another VAT bucket", () => {
  const src = { ...source, taxable: "300.00", exempt: "30.00", vat: "19.63" };
  for (const [category, issue] of [["N", "RETURN_VAT_BUCKET_EXCEEDED"], ["UNKNOWN", "RETURN_LINE_VAT_UNKNOWN"]]) {
    const s = build(args({ source: src, lines: [line("100.00", { vatCategory: category })] }));
    assert.equal(s.tax, null); assert.ok(s.components); assert.deepEqual(s.issues, [issue]);
  }
});

test("JSON validation rejects malformed, duplicate, mismatched, negative and unsupported evidence", () => {
  const good = build(args()); assert.ok(parse(good, "100.00"));
  for (const patch of [{ version: 2 }, { policy: "guessed" }, { amount: "100.001" }, { amount: 100 }, { lines: [line(), line()] },
    { lines: [line("99.99")] }, { source: null }, { issues: [1] }, { tax: { ...good.tax, vat: "101.00" } },
    { components: { ...good.components, shippingGross: "1.00" } }, { components: undefined }]) {
    assert.equal(parse({ ...good, ...patch }, "100.00"), null);
  }
  assert.equal(parse(good, "100.01"), null);
  assert.throws(() => build(args({ lines: [line("99.00")] })), /INVALID_INPUT/);
});

test("report uses persisted components, checks line identity, and does not count allocation as an issued note", () => {
  const snapshot = build(args());
  const event: any = { kind: "RETURN", payload: { amount: "100.00", financialSnapshot: snapshot,
    lines: [{ orderItemId: "1", amount: "100.00", qty: "1", soldQty: "3", priorQty: "0", cost: "30.00", costSource: "CATALOG_AT_SALE" }] } };
  const result = inspectSalesEvidence(event);
  assert.equal(result.amounts.returnKnownMerchandiseGross, 10000n);
  assert.equal(result.amounts.returnAllocatedVat, 654n);
  assert.equal(result.amounts.taxAdjustmentGross, 0n);
  assert.equal(result.amounts.refundCompleted, 0n);
  assert.ok(result.issues.includes("RETURN_VAT_IS_SALE_ALLOCATION"));
  assert.ok(!result.issues.includes("RETURN_COMPONENTS_UNALLOCATED"));
  event.payload.lines[0].orderItemId = "2";
  assert.equal(inspectSalesEvidence(event).amounts.returnAllocatedVat, 0n);
  assert.ok(inspectSalesEvidence(event).issues.includes("RETURN_SNAPSHOT_INVALID"));
});

test("migration is additive, immutable, rerunnable, no backfill; readiness covers common return writes", () => {
  const sql = read("db/migrations/10.65__bms_pos_return_financial_snapshots.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS financial_snapshot JSONB/);
  assert.match(sql, /IF NOT EXISTS.*SELECT 1 FROM pg_constraint/s);
  assert.match(sql, /BEFORE UPDATE OF financial_snapshot/);
  assert.match(sql, /NEW.financial_snapshot IS DISTINCT FROM OLD.financial_snapshot/);
  assert.doesNotMatch(sql, /SECURITY DEFINER|UPDATE bms_pos_returns SET|CREATE TABLE/);
  assert.match(sql, /ROLLBACK:/);
  assert.ok(MIGRATIONS.some(m => m.needs.some(n => n.kind === "column" && n.table === "bms_pos_returns" && n.name === "financial_snapshot")));
});

// Execute the actual exported processPosReturn body, with strict SQL/dependency doubles.
// This proves orchestration/rollback requests, not PostgreSQL locking or RLS.
function harness() {
  const controls = { fail: "", exact: true, online: false, method: "CARD", noPayments: false, returnBranch: "branch-a", drawer: 1000 };
  let state: any = { returns: [], items: [], allocations: [], audits: [], movements: [] }, backup: any = null;
  const calls: string[] = []; let releases = 0, credits = 0;
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const input: any = { tenantId: "tenant-a", orderId: "order-a", deviceId: "device-a", shiftId: "shift-a", actorUserId: "user-a",
    mode: "PARTIAL", lines: [{ orderItemId: 1, packQty: 1 }], idempotencyKey: "key-a" };
  const client = { release() { releases++; calls.push("RELEASE"); }, async query(sql: string, p: any[] = []) {
    calls.push(sql);
    if (sql === "BEGIN") { backup = structuredClone(state); return result(); }
    if (sql === "COMMIT") { backup = null; return result(); }
    if (sql === "ROLLBACK") { state = backup; backup = null; return result(); }
    if (sql.includes("pg_advisory_xact_lock")) return result();
    if (sql.includes("FROM bms_pos_returns") && sql.includes("idempotency_key = $2")) return result(state.returns.filter((r: any) => r.key === p[1]));
    if (sql.includes("FROM bms_pos_shifts")) return result([{ id: "shift-a", opening_float: "1000.00", location_id: controls.returnBranch }]);
    if (sql.includes("FROM bms_orders") && sql.includes("FOR UPDATE")) return result([{ id: input.orderId, status: controls.online ? "PAID" : "COMPLETED", channel: "pos",
      pos_device_id: input.deviceId, location_id: "branch-a", total_amount: "310.00", shipping_fee: "20.00", rounding_amount: "-0.25", discount_amount: "0.00",
      coupon_id: null, fulfillment_type: "DELIVERY", extra_total: "10.00", extra_taxable: "10.00", taxable_amount: "330.00", exempt_amount: "0.00", vat_amount: "21.59" }]);
    if (sql.includes("FROM bms_tax_documents") && sql.includes("adjustment_kind")) return result();
    if (sql.includes("FROM bms_order_items oi") && sql.includes("FOR UPDATE")) return result([{ id: "1", qty: 3, pack_qty: null, pack_unit_price: null,
      product_sku: "MEAL", size: "BOWL", unit_price: "100.00", receipt_unit_price: "100.00", line_amount: "300.00", pricing_snapshot: {}, vat_category: "V",
      stock_consumption_version: 2, restaurant_check_item_id: "check-item", returned_pack_qty: String(state.items.reduce((a: number, r: any) => a + r.pack_qty, 0)),
      returned_refund_amount: String(state.items.reduce((a: number, r: any) => a + r.refund_amount, 0)) }]);
    if (sql.includes("FROM bms_product_menu_unavailability")) return result();
    if (sql.includes("financial_snapshot AS snapshot")) {
      assert.deepEqual(p, ["tenant-a", "order-a"]); assert.match(sql, /LIMIT 1001/);
      return result(state.returns.map((r: any) => ({ amount: String(r.refund_amount), snapshot: r.financial_snapshot })));
    }
    if (sql.includes("INSERT INTO bms_pos_returns")) {
      if (controls.fail === "snapshot") throw new Error("snapshot write failed");
      const r = { id: `return-${state.returns.length + 1}`, key: p[8], order_id: p[1], pos_device_id: p[2], shift_id: p[3], return_mode: p[6], refund_amount: p[7],
        created_at: "2026-10-15T00:00:00Z", preferred_refund_method: p[14], sale_location_id: p[16], return_location_id: p[17], cross_branch: p[18], financial_snapshot: JSON.parse(p[19]) };
      assert.ok(backup); assert.ok(parse(r.financial_snapshot, r.refund_amount.toFixed(2))); state.returns.push(r); return result([r]);
    }
    if (sql.includes("INSERT INTO bms_pos_return_items")) {
      if (controls.fail === "items") throw new Error("items write failed");
      const r = { id: String(state.items.length + 1), pos_return_id: p[1], order_item_id: p[2], qty: p[3], pack_qty: p[4], refund_amount: p[5] };
      state.items.push(r); return result([r]);
    }
    if (sql.includes("SELECT order_item_id, pack_qty, refund_amount FROM bms_pos_return_items")) return result(state.items.filter((r: any) => r.pos_return_id === p[1]));
    if (sql.includes("FROM bms_pos_refund_allocations") && !sql.includes("FROM bms_payments")) return result(state.allocations.filter((r: any) => r.pos_return_id === p[1]));
    if (sql.includes("FROM bms_order_stock_lines")) return result([{ product_sku: "INGREDIENT", size: "BASE", qty: 3 }]);
    if (sql.includes("INSERT INTO bms_inventory") || sql.includes("UPDATE bms_inventory SET reserved_stock")) return result([{ ok: true }]);
    if (sql.includes("FROM bms_order_item_lots")) return result();
    if (sql.includes("FROM bms_payments p")) return result(controls.noPayments ? [] : [{ id: "payment-a", method: controls.method, amount: "329.75", allocated: String(state.allocations.reduce((a: number, r: any) => a + Number(r.amount), 0)) }]);
    if (sql.includes("INSERT INTO bms_pos_refund_allocations")) {
      const r = { id: `allocation-${state.allocations.length + 1}`, pos_return_id: p[1], payment_id: p[2], method: p[3], amount: p[4], status: p[5], external_ref: null };
      state.allocations.push(r); return result([r]);
    }
    if (sql.includes("UPDATE bms_pos_returns SET settlement_status")) { state.returns.find((r: any) => r.id === p[1]).settlement_status = p[2]; return result(); }
    if (sql.includes("INSERT INTO bms_audit_log")) {
      if (controls.fail === "audit") throw new Error("audit write failed");
      state.audits.push(p); return result();
    }
    if (/UPDATE bms_(orders|payments|product_serials|delivery_order_lines|delivery_orders)/.test(sql)) return result();
    if (sql.includes("UPDATE bms_tax_documents")) return result();
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const deps: any = {
    getClient: async () => client, beginTenantTx: async (c: any, tenant: string, options: any) => {
      assert.equal(tenant, "tenant-a"); assert.equal(options.editorId, "user-a"); await c.query("BEGIN");
    }, COUNTER_RETURN_UNSUPPORTED_CHANNELS: new Set(), cashierHasPermissionInTx: async () => true,
    normalizePricingSnapshot: () => ({}), missingGiftReturns: () => [], isSaleTimePricingSnapshot: () => controls.exact,
    priceRemainingLines: (lines: any[], requested = new Map()) => {
      const priced = lines.map(l => ({ id: l.id, remainingPackQty: l.packQty - l.returnedPackQty - (requested.get(l.id) ?? 0),
        amount: 100 * (l.packQty - l.returnedPackQty - (requested.get(l.id) ?? 0)) }));
      return { lines: priced, pricingSubtotal: priced.reduce((n: number, l: any) => n + l.amount, 0) };
    }, buildReturnFinancialSnapshot: build, approvalRuleForRefundAmount: () => ({ requiredPermission: null }),
    orderRefundPaymentsForAllocation: (rows: any[]) => rows, mapRefundAllocation: (r: any) => r,
    drawerExpectedInTx: async () => controls.drawer, getVatSettings: async () => ({ blindClose: true }),
    recordMovement: async (_c: any, movement: any) => { assert.ok(backup); state.movements.push(movement); },
    reversePointsForReturnInTx: async () => ({ earnedReversed: 0, redeemedReturned: 0 }), reverseCreditForReturnInTx: async () => {}, reduceArForReturnInTx: async () => {},
    cancelKitchenTicketsForOrderInTx: async () => {}, cancelKitchenTicketsForOrderItemsInTx: async () => {},
    RESTAURANT_CANCELLATION_CAUSES: ["CUSTOMER_CHANGED_MIND"],
    ensurePosReturnCreditNote: async () => { assert.equal(backup, null); assert.equal(calls.at(-1), "RELEASE"); credits++; return null; },
    toISO: (v: any) => v,
  };
  const source = read("apps/web/lib/bms/pos.ts");
  const start = source.indexOf("export async function processPosReturn(");
  const body = source.slice(start, source.indexOf("\n}\n", start) + 3);
  assert.ok(body.includes('await client.query("COMMIT")'));
  const exports: any = {};
  new Function("exports", ...Object.keys(deps), ts.transpileModule(body, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports, ...Object.values(deps));
  return { controls, calls, state: () => state, counts: () => ({ releases, credits }),
    run: (patch: any = {}) => exports.processPosReturn({ ...input, ...patch }) };
}

test("real return flow persists snapshot and audit atomically; retries do not write/recalculate", async () => {
  const h = harness();
  const r = await h.run(); assert.equal(r.refundAmount, 100); assert.equal(r.settlementStatus, "PENDING");
  assert.equal(h.state().returns[0].financial_snapshot.tax.vat, "6.54");
  assert.equal(h.state().movements[0].type, "RETURN");
  assert.equal(JSON.parse(h.state().audits[0][4]).financialSnapshotVersion, 1);
  const before = structuredClone(h.state());
  h.controls.fail = "snapshot";
  assert.equal((await h.run()).replayed, true); assert.deepEqual(h.state(), before);
  assert.deepEqual(h.counts(), { releases: 2, credits: 2 });
});

test("real partial then full return preserves refunded money and freezes auxiliaries exactly once", async () => {
  const h = harness(); await h.run();
  const r = await h.run({ mode: "FULL", lines: [], idempotencyKey: "key-b" });
  assert.equal(r.refundAmount, 229.75);
  assert.deepEqual(h.state().returns[1].financial_snapshot.components, { merchandiseGross: "200.00", extrasGross: "10.00", shippingGross: "20.00", rounding: "-0.25" });
  assert.equal(h.state().allocations.reduce((n: number, r: any) => n + r.amount, 0), 329.75);
});

for (const failure of ["snapshot", "items", "audit"]) test(`real ${failure} failure requests rollback of return/snapshot/stock/refund/audit`, async () => {
  const h = harness(); const before = structuredClone(h.state()); h.controls.fail = failure;
  await assert.rejects(h.run(), /write failed/); assert.deepEqual(h.state(), before);
  assert.equal(h.calls.at(-2), "ROLLBACK"); assert.equal(h.counts().credits, 0);
});

test("business rejection after snapshot insert rolls everything back", async () => {
  const h = harness(); const before = structuredClone(h.state()); h.controls.noPayments = true;
  assert.equal((await h.run()).status, "NO_CONFIRMED_PAYMENTS"); assert.deepEqual(h.state(), before);
});

test("void uses the same snapshot and does not issue a credit note", async () => {
  const h = harness(); const r = await h.run({ mode: "FULL", lines: [], isVoid: true, voidReason: "mistake" });
  assert.equal(r.refundAmount, 329.75); assert.equal(h.state().returns[0].financial_snapshot.components.rounding, "-0.25");
  assert.equal(h.counts().credits, 0);
});

test("restaurant cancellation releases reservations, keeps pending refunds and captures same financial evidence", async () => {
  const h = harness(); h.controls.online = true;
  const r = await h.run({ deviceId: null, shiftId: null, restaurantCancellation: { expectedLocationId: "branch-a",
    causes: [{ orderItemId: 1, cause: "CUSTOMER_CHANGED_MIND" }] } });
  assert.equal(r.refundAmount, 100); assert.equal(r.settlementStatus, "PENDING");
  assert.equal(h.state().movements[0].type, "RELEASE");
  assert.equal(h.state().returns[0].financial_snapshot.components.shippingGross, "0.00");
});

test("legacy replay leaves NULL evidence untouched; a later new return records unknown prior components", async () => {
  const h = harness(); await h.run(); h.state().returns[0].financial_snapshot = null;
  assert.equal((await h.run()).replayed, true); assert.equal(h.state().returns[0].financial_snapshot, null);
  await h.run({ mode: "FULL", lines: [], idempotencyKey: "new-key" });
  assert.deepEqual(h.state().returns[1].financial_snapshot.issues, ["RETURN_PRIOR_COMPONENTS_UNKNOWN"]);
  assert.equal(h.state().returns[1].financial_snapshot.components, null);
});

test("legacy pricing new return captures its proportional policy without changing the refund", async () => {
  const h = harness(); h.controls.exact = false;
  const r = await h.run(); assert.equal(r.refundAmount, 109.92);
  const s = h.state().returns[0].financial_snapshot;
  assert.equal(s.policy, "LEGACY_PROPORTIONAL_V1"); assert.equal(s.components.shippingGross, "6.67");
  assert.equal(s.components.rounding, "-0.08");
});

for (const method of ["CASH", "CREDIT"]) test(`${method} completion remains separate from frozen return claim`, async () => {
  const h = harness(); h.controls.method = method;
  assert.equal((await h.run()).settlementStatus, "COMPLETED");
  assert.equal(h.state().returns[0].financial_snapshot.amount, "100.00");
  assert.equal(h.state().allocations[0].method, method);
});

test("insufficient drawer cash rolls back the snapshot and keeps blind cash amount hidden", async () => {
  const h = harness(); h.controls.method = "CASH"; h.controls.drawer = 0;
  const before = structuredClone(h.state()); const r = await h.run();
  assert.equal(r.status, "WOULD_OVERDRAW"); assert.equal(r.available, null); assert.deepEqual(h.state(), before);
});

test("cross-branch return keeps sale and receiving branches, requires distinct approval, and shares snapshot", async () => {
  const h = harness(); h.controls.returnBranch = "branch-b";
  assert.equal((await h.run({ mode: "FULL", lines: [] })).status, "CROSS_BRANCH_APPROVAL_REQUIRED");
  const r = await h.run({ mode: "FULL", lines: [], approvedByUserId: "manager-b" });
  assert.equal(r.saleLocationId, "branch-a"); assert.equal(r.returnLocationId, "branch-b");
  assert.equal(h.state().movements[0].locationId, "branch-b");
  assert.equal(h.state().returns[0].financial_snapshot.components.shippingGross, "20.00");
});

test("replay conflicts cannot replace persisted evidence", async () => {
  const h = harness(); await h.run(); const before = structuredClone(h.state());
  assert.equal((await h.run({ orderId: "foreign-order" })).status, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(h.state(), before);
});

test("free gifts and mixed selected lines do not lose or duplicate a satang", () => {
  const s = build(args({ lines: [line("0.00"), line("60.00", { orderItemId: "2" }), line("40.00", { orderItemId: "3", vatCategory: "N" })],
    source: { ...source, taxable: "230.00", exempt: "100.00", vat: "15.05" } }));
  assert.equal(s.tax?.taxableGross, "60.00"); assert.equal(s.tax?.exemptGross, "40.00");
  assert.equal(s.tax?.vat, "3.93"); assert.ok(parse(s, "100.00"));
});
