import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { validateStoreProfileShippingFields } from "../apps/web/lib/bms/storeProfileShippingValidation.ts";
import * as zones from "../apps/web/lib/bms/shippingZones.ts";

const profile = { shippingEstDaysMin: 1, shippingEstDaysMax: 5 };

test("shop shipping values reject negative or rounded money and invalid delivery days", () => {
  assert.doesNotThrow(() => validateStoreProfileShippingFields({ shippingFlatRate: 0, shippingFreeThreshold: 100.25 }, profile));
  assert.doesNotThrow(() => validateStoreProfileShippingFields({ shippingEstDaysMin: null, shippingEstDaysMax: null }, profile));
  for (const value of [-1, 0.001, Number.POSITIVE_INFINITY, 10_000_000_000]) {
    assert.throws(() => validateStoreProfileShippingFields({ shippingFlatRate: value }, profile));
    assert.throws(() => validateStoreProfileShippingFields({ shippingFreeThreshold: value }, profile));
  }
  assert.throws(() => validateStoreProfileShippingFields({ shippingEstDaysMin: -1 }, profile));
  assert.throws(() => validateStoreProfileShippingFields({ shippingEstDaysMax: 1.5 }, profile));
  assert.throws(() => validateStoreProfileShippingFields({ shippingEstDaysMax: 2_147_483_648 }, profile));
  assert.throws(() => validateStoreProfileShippingFields({ shippingEstDaysMin: 6 }, profile));
  assert.throws(() => validateStoreProfileShippingFields({ shippingEstDaysMax: 0 }, profile));
  assert.doesNotThrow(() => validateStoreProfileShippingFields({}, { shippingEstDaysMin: 8, shippingEstDaysMax: 2 }),
    "an unrelated edit must not be blocked by an old inconsistent estimate");
});

test("profile service validates the submitted rates before writing", () => {
  const source = readFileSync(new URL("../apps/web/lib/bms/storeProfile.ts", import.meta.url), "utf8");
  assert.match(source, /validateStoreProfileShippingFields\(input, cur\)/);
  assert.ok(source.indexOf("validateStoreProfileShippingFields(input, cur)") < source.indexOf("INSERT INTO bms_store_profile"));
});

test("an old invalid flat rate cannot become a negative shipping charge", async () => {
  const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const ts = require("typescript") as typeof import("typescript");
  const source = readFileSync(new URL("../apps/web/lib/bms/shippingRates.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, any> };
  const mocks: Record<string, unknown> = {
    "@/lib/db": { query: async () => { throw new Error("unexpected DB read"); } },
    "./storeProfile": { getStoreProfile: async () => ({
      shippingMode: "flat", shippingFlatRate: -20, shippingFreeThreshold: -1,
      shippingZoneRates: [], shippingWeightTiers: [], currency: "THB",
      shippingEstDaysMin: null, shippingEstDaysMax: null,
    }) },
    "./carriers": { getCarrierClient: () => null },
    "./carriers/safeCall": { runCarrierCall: async () => { throw new Error("unexpected carrier call"); } },
    "./carriers/constants": { isCarrier: () => false },
    "./shippingMaster": { resolveShippingZone: async () => null },
    "./shippingZones": zones,
  };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `unexpected dependency ${name}`);
    return mocks[name];
  }, module, module.exports);
  const quote = await module.exports.quoteShipping({ tenantId: "tenant", subtotal: 100 });
  assert.equal(quote.fee, null);
  assert.equal(quote.configured, false);
  assert.equal(quote.freeThreshold, null);
  assert.match(quote.warnings.join(" "), /ค่าส่งเหมาที่บันทึกไว้ไม่ถูกต้อง/);
  assert.match(quote.warnings.join(" "), /ยอดขั้นต่ำส่งฟรีที่บันทึกไว้ไม่ถูกต้อง/);
});
