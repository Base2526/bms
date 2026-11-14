import assert from "node:assert/strict";
import test from "node:test";
import { ALL_TOOLS } from "../../apps/web/lib/bms/tools/catalog.ts";
import { shippingEstimateItems } from "../../apps/web/lib/bms/tools/shippingEstimateInput.ts";
import { ToolArgError, type ExecCtx } from "../../apps/web/lib/bms/tools/types.ts";
import { __toolLoopTest } from "../../apps/web/lib/bms/tools/runtime.ts";
import { shippingEstimateReply } from "../../apps/web/lib/bms/pipeline.ts";

test("shipping estimate keeps explicit quantities and separate repeated SKU lines", () => {
  assert.deepEqual(shippingEstimateItems([
    { sku: "  FAKE-RICE ", qty: 2 },
    { sku: "FAKE-RICE", qty: 3 },
  ]), [
    { sku: "FAKE-RICE", qty: 2 },
    { sku: "FAKE-RICE", qty: 3 },
  ]);
  assert.equal(shippingEstimateItems(undefined), null);
  assert.equal(shippingEstimateItems([]), null);
});

test("shipping estimate rejects missing, malformed and silently dropped quote lines", () => {
  for (const input of [
    "FAKE-RICE", {}, [null], [{}], [{ sku: "FAKE-RICE" }],
    [{ sku: "FAKE-RICE", qty: 0 }], [{ sku: "FAKE-RICE", qty: -1 }],
    [{ sku: "FAKE-RICE", qty: 1.5 }], [{ sku: "FAKE-RICE", qty: "2" }],
    [{ sku: "  ", qty: 1 }], [{ sku: "FAKE-RICE", qty: Number.NaN }],
    [{ sku: "FAKE-RICE", qty: 1, price: 0 }],
    Array.from({ length: 21 }, () => ({ sku: "FAKE-RICE", qty: 1 })),
  ]) {
    assert.throws(() => shippingEstimateItems(input), ToolArgError, JSON.stringify(input));
  }
});

test("customer shipping tool rejects model-supplied subtotal and malformed lines before any database read", async () => {
  const tool = ALL_TOOLS.find((item) => item.name === "get_shipping_estimate")!;
  assert.ok(tool.surfaces.includes("customer"));
  assert.ok(!tool.sensitive);
  const ec = { tenantId: "fake-tenant", surface: "customer", actor: "fake-customer" } as ExecCtx;
  for (const args of [
    { subtotal: -1 }, { subtotal: Number.NaN }, { subtotal: 0 }, { subtotal: 5000 },
    { province: "x".repeat(201) },
    { items: [{ sku: "FAKE-RICE" }] },
    { items: [{ sku: "FAKE-RICE", qty: 0 }] },
  ]) {
    await assert.rejects(tool.execute(args, ec), ToolArgError);
  }
});

test("shipping quote runtime rejects tenant injection and audits malformed input", async () => {
  const tool = ALL_TOOLS.find((item) => item.name === "get_shipping_estimate")!;
  const ec = { tenantId: "fake-tenant", surface: "customer", actor: "fake-customer" } as ExecCtx;
  const audits: string[] = [];
  for (const input of [
    { tenantId: "other-tenant", items: [{ sku: "FAKE-RICE", qty: 1 }] },
    { items: [{ sku: "FAKE-RICE" }] },
    { subtotal: 5000 },
  ]) {
    const result = await __toolLoopTest.runApproved(
      { tool, input, execCtx: ec },
      { auditAttempt: async (_ctx, name, outcome) => { audits.push(`${name}:${outcome}`); } },
    );
    assert.equal(result.result.ok, false);
    assert.equal(result.trace.ok, false);
  }
  assert.deepEqual(audits, ["get_shipping_estimate:error", "get_shipping_estimate:error", "get_shipping_estimate:error"]);
});

test("deterministic shipping reply names the unverified basket and keeps all warnings", () => {
  const estimate = {
    configured: true,
    fee: 50,
    currency: "THB",
    estDaysMin: 2,
    estDaysMax: 3,
    warnings: ["ไม่รู้จังหวัดปลายทาง", "carrier mock mode ไม่ใช่เรตจริง"],
  };
  const thai = shippingEstimateReply(estimate, { aiLanguage: "th" } as any, "ค่าส่งเท่าไหร่");
  assert.match(thai, /ค่าส่งตั้งต้น/);
  assert.match(thai, /สินค้า จำนวน และปลายทาง/);
  assert.match(thai, /ไม่รู้จังหวัดปลายทาง/);
  assert.match(thai, /carrier mock mode/);
  const english = shippingEstimateReply(estimate, { aiLanguage: "en" } as any, "shipping price?");
  assert.match(english, /base estimate/);
  assert.match(english, /items, quantities and destination/);
  assert.doesNotMatch(shippingEstimateReply({ configured: false }, { aiLanguage: "th" } as any, "ค่าส่ง"), /ค่าส่งตั้งต้น/);
});
