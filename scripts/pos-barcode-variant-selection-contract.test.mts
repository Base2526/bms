import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const REPO = new URL("../", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, REPO), "utf8");

const pos = read("apps/web/lib/bms/pos.ts");
const scanRoute = read("apps/web/app/api/pos/scan/route.ts");
const register = read("apps/web/app/(pos)/pos/page.tsx");
const graphql = read("apps/web/graphql/bmsPosDevice.ts");

test("generic product codes never guess an alphabetical variant", () => {
  const resolve = pos.slice(
    pos.indexOf("export async function resolvePosScan"),
    pos.indexOf("// 9.61:", pos.indexOf("export async function resolvePosScan")),
  );

  assert.match(resolve, /HAVING count\(DISTINCT upper\(variant\.code\)\) = 1/);
  assert.match(resolve, /HAVING count\(DISTINCT upper\(i\.size\)\) = 1/);
  assert.match(resolve, /p\.barcode IS DISTINCT FROM \$2 THEN k\.size/);
  assert.match(resolve, /throw new PosVariantSelectionRequiredError\(row\.sku, row\.name\)/);
  assert.doesNotMatch(
    resolve,
    /k\.size,\s*-- 3/,
    "a legacy product barcode copied to the first pack must not silently select that pack size",
  );
});

test("the scan API returns catalog-authoritative choices and an image for an ambiguous code", () => {
  assert.match(scanRoute, /isPosVariantSelectionRequiredError\(error\)/);
  assert.match(scanRoute, /listPosVariantChoices\(device\.tenantId, error\.sku, device\.locationId\)/);
  assert.match(scanRoute, /listPrimaryProductImages\(device\.tenantId, \[error\.sku\]\)/);
  assert.match(scanRoute, /reason: "VARIANT_SELECTION_REQUIRED"/);
  assert.match(scanRoute, /status: 409/);
});

test("the browser register shows the product and requires an exact size click", () => {
  assert.match(register, /data\?\.reason === "VARIANT_SELECTION_REQUIRED"/);
  assert.match(register, /setVariantSelection\(data\.selection as VariantSelectionPrompt\)/);
  assert.match(register, /<ProductThumb[\s\S]*?variantSelection\.imageUrl/);
  assert.match(register, /enqueueScan\(variantSelection\.sku, "manual", variant\.size\)/);
  assert.match(register, /const disabled = variant\.stockTracked && variant\.available <= 0/);
});

test("GraphQL POS clients receive a correctable conflict instead of an internal error", () => {
  const resolver = graphql.slice(
    graphql.indexOf("async bmsPosScan("),
    graphql.indexOf("async bmsPosLastSale(", graphql.indexOf("async bmsPosScan(")),
  );
  assert.match(resolver, /isPosVariantSelectionRequiredError\(error\)/);
  assert.match(resolver, /mobileGraphqlError\(error\.message, "CONFLICT"/);
  assert.match(resolver, /reason: "VARIANT_SELECTION_REQUIRED"/);
});
