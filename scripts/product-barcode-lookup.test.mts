import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  parseProductBarcode, productBarcodeAliases, barcodeAutofillPatch, barcodeAutofillRestore, sameProductBarcode,
} from "../apps/web/lib/bms/productBarcodeLookupContract.ts";
import { fetchBarcodeProduct, parseBarcodeProviderProduct } from "../apps/web/lib/bms/productBarcodeProvider.ts";

const code = "036000291452";
const product = {
  barcode_number: code, title: "Example 250 ml", brand: "Example", size: "250 ml",
  description: "Example product", images: ["https://images.barcodelookup.com/test.jpg"],
  stores: [{ price: "199" }], weight: "250 g", multipack: "6",
};
const body = { products: [product] };

test("EAN/UPC and Digital Link are identifiers; arbitrary QR URLs are never followed", () => {
  assert.deepEqual(parseProductBarcode(code), { code, external: true });
  assert.deepEqual(parseProductBarcode(`https://brand.example/01/00${code}/21/SERIAL?lot=1`), {
    code, external: true,
  });
  assert.equal(parseProductBarcode("https://brand.example/01/04006381333931")?.code, "4006381333931");
  assert.equal(parseProductBarcode("https://brand.example/01/10012345000017")?.code, "10012345000017");
  for (const raw of ["https://example.com/promo", "javascript:alert(1)", "https://u:p@x/01/00036000291452",
    "https://x/01/00036000291450", "A\nB", "x".repeat(513)]) assert.equal(parseProductBarcode(raw), null);
  assert.equal(parseProductBarcode("2000000000015")?.external, false);
  assert.equal(parseProductBarcode("02000000000015")?.external, false);
  assert.equal(parseProductBarcode("https://brand.example/01/02000000000015")?.external, false);
  assert.equal(parseProductBarcode("FAKE-ABC")?.external, false);
  assert.equal(parseProductBarcode("036000291450")?.external, false);
});

test("equivalent GTIN aliases preserve zeros and never collapse a case into a unit", () => {
  assert.deepEqual(productBarcodeAliases(code), [code, `00${code}`, `0${code}`]);
  assert.deepEqual(productBarcodeAliases("10012345000017"), ["10012345000017"]);
  assert.deepEqual(productBarcodeAliases("SHOP-01"), ["SHOP-01"]);
});

test("existing custom barcode punctuation and Thai combining marks remain searchable locally", () => {
  for (const code of ["ACME/XL+1", "ชุดที่:๑", "LOT#42", "SKU%10"])
    assert.deepEqual(parseProductBarcode(code), { code, external: false });
  assert.equal(parseProductBarcode("ftp://example.com/file"), null);
});

test("barcode identity treats QR/padded GTIN as the same item, never a different case", () => {
  assert.equal(sameProductBarcode(code, `https://example.com/01/00${code}`), true);
  assert.equal(sameProductBarcode(code, `0${code}`), true);
  assert.equal(sameProductBarcode(code, "4006381333931"), false);
  assert.equal(sameProductBarcode("", ""), false);
  assert.equal(sameProductBarcode("ACME/XL+1", "ACME/XL+1"), true);
});

test("changing barcode restores only unchanged autofill fields, with controlled empty input values", () => {
  const fields = [
    { name: "name", before: undefined, filled: "External name", touched: false },
    { name: "brand", before: "", filled: "External brand", touched: false },
    { name: "description", before: "", filled: "External description", touched: false },
    { name: "variantCodes", before: ["STD"], filled: ["250 ml"], touched: false },
  ];
  assert.deepEqual(barcodeAutofillRestore(fields, {
    name: "External name", brand: "User's brand", description: "External description", variantCodes: ["250 ml"],
  }), [
    { name: "name", value: "", touched: false },
    { name: "description", value: "", touched: false },
    { name: "variantCodes", value: ["STD"], touched: false },
  ]);
  assert.deepEqual(barcodeAutofillRestore(fields, { name: "User name", variantCodes: ["500 ml"] }), []);
});

test("provider requires exactly one exact GTIN match; does not guess related products", () => {
  assert.equal(parseBarcodeProviderProduct(body, `00${code}`)?.name, product.title);
  assert.equal(parseBarcodeProviderProduct(body, "4006381333931"), null);
  assert.equal(parseBarcodeProviderProduct({ products: [product, product] }, code), null);
  assert.equal(parseBarcodeProviderProduct({ products: [{ ...product, title: "" }] }, code), null);
  assert.equal(parseBarcodeProviderProduct({ products: [{ ...product, barcode_number: Number(code) }] }, code), null);
  assert.equal(parseBarcodeProviderProduct(null, code), null);
});

test("only allowlisted HTTPS image URLs survive, without price/stock/pack authority", () => {
  for (const image of ["http://images.barcodelookup.com/x", "https://127.0.0.1/x", "https://images.barcodelookup.com.evil.test/x",
    "https://user:pass@images.barcodelookup.com/x", "https://images.barcodelookup.com:444/x", "data:image/svg+xml,x"]) {
    assert.equal(parseBarcodeProviderProduct({ products: [{ ...product, images: [image] }] }, code)?.imageUrl, null);
  }
  const result = parseBarcodeProviderProduct(body, code)!;
  assert.equal(result.imageUrl, product.images[0]);
  assert.equal("price" in result, false);
  assert.equal("multipack" in result, false);
  assert.equal("weight" in result, false);
  assert.equal(parseBarcodeProviderProduct({ products: [{ ...product, size: "x".repeat(65) }] }, code)?.size, null);
});

test("autofill only writes blank descriptive fields and untouched default size", () => {
  const suggestion = parseBarcodeProviderProduct(body, code)!;
  assert.deepEqual(barcodeAutofillPatch(suggestion, { variantCodes: ["STD"] }, false), {
    name: product.title, brand: product.brand, description: product.description, variantCodes: ["250 ml"],
  });
  assert.deepEqual(barcodeAutofillPatch(suggestion, {
    name: "Staff name", brand: "Staff brand", description: "Staff text", variantCodes: ["Small"], price: 25,
  }, false), {});
  assert.equal("variantCodes" in barcodeAutofillPatch(suggestion, { variantCodes: ["STD"] }, true), false);
  const patch = barcodeAutofillPatch(suggestion, { name: "   " }, true);
  assert.equal(patch.name, product.title);
  for (const key of ["sku", "price", "costPrice", "weightGrams", "baseUnit", "vatCategory", "stockPolicy"]) {
    assert.equal(key in patch, false);
  }
});

test("provider transport uses fixed host, no redirects, deadline, and exact barcode", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.barcodelookup.com");
    assert.equal(url.pathname, "/v3/products");
    assert.equal(url.searchParams.get("barcode"), code);
    assert.equal(url.searchParams.get("key"), "test-key");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    return Response.json(body);
  };
  assert.equal((await fetchBarcodeProduct(code, "test-key", fetcher))?.name, product.title);
});

test("not found is distinct from unavailable; malformed, oversized and transport failures are sanitized", async () => {
  assert.equal(await fetchBarcodeProduct(code, "secret", async () => new Response(null, { status: 404 })), null);
  for (const response of [new Response(null, { status: 429 }), new Response("bad json"),
    Response.json({ unexpected: true }), new Response("x".repeat(262145))]) {
    await assert.rejects(() => fetchBarcodeProduct(code, "secret", async () => response),
      { message: "BARCODE_PROVIDER_UNAVAILABLE" });
  }
  await assert.rejects(() => fetchBarcodeProduct(code, "secret", async () => {
    throw new Error("https://provider/?key=secret");
  }), { message: "BARCODE_PROVIDER_UNAVAILABLE" });
});

test("route and service guard tenant, permissions and pack lookup before external access", () => {
  const service = readFileSync(new URL("../apps/web/lib/bms/productBarcodeLookup.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../apps/web/app/api/bms/products/barcode-lookup/route.ts", import.meta.url), "utf8");
  assert.match(route, /authorizeAdminRoute\("product.edit"\)/);
  assert.match(route, /lookupProductBarcode\(auth.tenantId, code\)/);
  assert.match(route, /rateLimit\(/);
  assert.match(service, /beginTenantTx\(client, tenantId\)/);
  assert.match(service, /p.tenant_id = \$1/);
  assert.match(service, /k.tenant_id = p.tenant_id/);
  assert.match(service, /bms_product_packs/);
  assert.ok(service.indexOf('status: "LOCAL"') < service.indexOf("fetchBarcodeProduct(code"));
  assert.match(service, /status: "NOT_CONFIGURED"/);
});

test("save rechecks other products and packs under the tenant lock, not just the UI preview", () => {
  const source = readFileSync(new URL("../apps/web/lib/bms/products.ts", import.meta.url), "utf8");
  const upsert = source.slice(source.indexOf("export async function upsertProduct("));
  assert.ok(upsert.indexOf("FOR UPDATE") < upsert.indexOf("const duplicate"));
  assert.match(upsert, /p.tenant_id = \$1 AND p.sku <> \$2/);
  assert.match(upsert, /k.tenant_id = p.tenant_id AND k.product_sku = p.sku/);
  assert.ok(upsert.indexOf("if (duplicate.rowCount)") < upsert.indexOf("INSERT INTO bms_products"));
});

test("the form transmits only the parsed identifier and preserves the unedited default variant", () => {
  const field = readFileSync(new URL("../apps/web/app/(admin)/admin/products/BarcodeLookupField.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../apps/web/app/(admin)/admin/products/page.tsx", import.meta.url), "utf8");
  assert.match(field, /encodeURIComponent\(parsed.code\)/);
  assert.match(field, /e.preventDefault\(\); e.stopPropagation\(\)/);
  assert.match(field, /controller.signal.aborted/);
  assert.match(field, /request.current\?\.controller === controller/);
  assert.match(page, /name: "variantCodes", touched: false/);
});

// Execute the real page callbacks so the regression tests cover their async guards.
function pageCallback(name: string, dependencies: Record<string, unknown>) {
  const ts = createRequire(new URL("../apps/web/package.json", import.meta.url))("typescript");
  const source = readFileSync(new URL("../apps/web/app/(admin)/admin/products/page.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: string | undefined;
  function visit(node: any) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer, `Missing page callback ${name}`);
  const js = ts.transpileModule(`const callback = ${initializer};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${js}; return callback;`)(...Object.values(dependencies));
}

test("late barcode generation never overwrites a changed or closed draft, including stale errors", async () => {
  for (const stale of [false, true]) for (const failure of [false, true]) {
    let finish!: (value: unknown) => void;
    let fail!: (reason: Error) => void;
    const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const draftRevision = { current: 1 };
    const writes: unknown[] = [], errors: string[] = [];
    const generate = pageCallback("generateBarcode", {
      draftRevision, genBarcode: () => pending,
      form: { setFieldsValue: (value: unknown) => writes.push(value) },
      changeBarcodeDraft: (code: string) => { writes.push(code); draftRevision.current++; },
      message: { success() {}, error: (text: string) => errors.push(text) }, t: (key: string) => key,
    });
    const running = generate();
    if (stale) draftRevision.current++;
    if (failure) fail(new Error("generation failed"));
    else finish({ data: { bmsGenerateInStoreBarcode: "2000000000015" } });
    await running;
    assert.equal(writes.length, !stale && !failure ? 2 : 0);
    assert.deepEqual(errors, !stale && failure ? ["generation failed"] : []);
  }
});

test("late open-existing response cannot replace or reopen a different draft", async () => {
  for (const invalidation of ["draft", "request"]) for (const failure of [false, true]) {
    let finish!: (value: unknown) => void;
    let fail!: (reason: Error) => void;
    const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const draftRevision = { current: 0 }, editRequest = { current: 0 };
    const errors: string[] = [];
    const open = pageCallback("openEdit", {
      draftRevision, editRequest, loadProductConfiguration: () => pending,
      message: { error: (text: string) => errors.push(text) }, t: (key: string) => key,
      // Any continuation into form mutation would access an unbound dependency and fail.
    });
    const running = open({ sku: "EXISTING" });
    if (invalidation === "draft") draftRevision.current++;
    else editRequest.current++;
    if (failure) fail(new Error("load failed"));
    else finish({ data: { bmsProductBySku: { sku: "EXISTING" } } });
    await running;
    assert.deepEqual(errors, []);
  }
});

test("changing barcode in the page restores old suggestions but retains manual text and other images", () => {
  const values: Record<string, unknown> = { name: "Old suggestion", brand: "Operator brand", variantCodes: ["250 ml"] };
  let images = ["https://example.test/auto.jpg", "https://example.test/manual.jpg"];
  const barcodeAutofill = { current: {
    code, imageUrl: images[0], fields: [
      { name: "name", before: undefined, filled: "Old suggestion", touched: false },
      { name: "brand", before: "", filled: "Old brand", touched: false },
      { name: "variantCodes", before: ["STD"], filled: ["250 ml"], touched: false },
    ],
  } };
  const change = pageCallback("changeBarcodeDraft", {
    useCallback: (fn: unknown) => fn, draftRevision: { current: 0 }, barcodeAutofill,
    sameProductBarcode, barcodeAutofillRestore,
    form: { getFieldsValue: () => values, setFields: (fields: any[]) => {
      for (const field of fields) values[field.name] = field.value;
    } },
    setImageUrls: (updater: (images: string[]) => string[]) => { images = updater(images); },
    setBarcodeDraft() {},
  });
  change(`00${code}`);
  assert.equal(values.name, "Old suggestion");
  assert.equal(images.length, 2);
  change("4006381333931");
  assert.deepEqual(values, { name: "", brand: "Operator brand", variantCodes: ["STD"] });
  assert.deepEqual(images, ["https://example.test/manual.jpg"]);
  assert.equal(barcodeAutofill.current, null);
});
