import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { PosGraphqlError, posGraphqlRequest } from "../apps/web/lib/pos/mobileFlowGraphql.ts";

const selection = { scanCode: "2018443771676", sku: "FAKE-A", productName: "FAKE Product", imageUrl: "/sample/restaurant/pork-garlic.jpg",
  variants: [{ size: "S", price: 100, available: 2, stockTracked: true }, { size: "L", price: 200, available: 0, stockTracked: false }] };
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("GraphQL transport retains only a validated, correctable selection and preserves normal errors", async t => {
  for (const [extensions, expected] of [
    [{ code: "CONFLICT", reason: "VARIANT_SELECTION_REQUIRED", selection }, selection],
    [{ code: "CONFLICT", reason: "OTHER", selection }, null],
    [{ code: "FORBIDDEN", reason: "VARIANT_SELECTION_REQUIRED", selection }, null],
    [{ code: "CONFLICT", reason: "VARIANT_SELECTION_REQUIRED", selection: { ...selection, variants: [] } }, null],
    [{ code: "CONFLICT", reason: "VARIANT_SELECTION_REQUIRED", selection: { ...selection, variants: [{ size: "S", price: "100", available: 1 }] } }, null],
    [{ code: "CONFLICT", reason: "VARIANT_SELECTION_REQUIRED", selection: { ...selection, scanCode: "" } }, null],
  ] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ errors: [{ message: "Choose size", extensions }] }), { status: 200 }));
    await assert.rejects(posGraphqlRequest("FAKE-token", "query Test {}"), (error: any) => {
      assert.ok(error instanceof PosGraphqlError);
      assert.equal(error.code, extensions.code);
      assert.equal(error.httpStatus, 200);
      assert.deepEqual(error.variantSelection, expected);
      return true;
    });
    mock.mock.restore();
  }
});

const graphql = read("apps/web/graphql/bmsPosDevice.ts");
const resolverSource = graphql.slice(graphql.indexOf("    async bmsPosScan("), graphql.indexOf("    async bmsPosLastSale("));
test("GraphQL ambiguous scans return image and choices from authenticated tenant and device branch", async () => {
  const calls: unknown[] = [];
  const deps = {
    requirePosDevice: (ctx: any) => { if (!ctx.device) throw new Error("unauthenticated"); return ctx.device; },
    badPosInput: () => { throw new Error("bad input"); },
    resolvePosScan: async (...args: unknown[]) => { calls.push(args); throw Object.assign(new Error("Choose size"), { sku: selection.sku, productName: selection.productName }); },
    isPosVariantSelectionRequiredError: () => true,
    listPosVariantChoices: async (...args: unknown[]) => { calls.push(args); return selection.variants; },
    listPrimaryProductImages: async (...args: unknown[]) => { calls.push(args); return new Map([[selection.sku, selection.imageUrl]]); },
    mobileGraphqlError: (message: string, code: string, extensions: object) => Object.assign(new Error(message), { extensions: { code, ...extensions } }),
  };
  const resolver = new Function(...Object.keys(deps), compile(`const resolvers = {${resolverSource}}; return resolvers.bmsPosScan;`))(...Object.values(deps));
  await assert.rejects(resolver(null, { code: selection.scanCode, tenantId: "attacker", locationId: "attacker" }, { device: { tenantId: "tenant", locationId: "branch" } }), (error: any) => {
    assert.equal(error.extensions.code, "CONFLICT");
    assert.deepEqual(error.extensions.selection, selection);
    return true;
  });
  assert.deepEqual(calls, [["tenant", selection.scanCode, { size: null, locationId: "branch", packCode: null, surface: "RETAIL_POS" }],
    ["tenant", selection.sku, "branch"], ["tenant", [selection.sku]]]);
  calls.length = 0;
  await assert.rejects(resolver(null, { code: selection.scanCode }, {}), /unauthenticated/);
  assert.deepEqual(calls, []);
});

const renderer = read("apps/web/components/pos-desktop/DesktopPosRenderer.tsx");
const addSource = compile(renderer.slice(renderer.indexOf("  const addProduct = async"), renderer.indexOf("  const changeQty =")));
const cartVariantBaseQty = new Function(`${compile(renderer.slice(renderer.indexOf("function cartVariantBaseQty("), renderer.indexOf("function resolvedCartLine(")))}; return cartVariantBaseQty;`)();
const hit = { sku: "FAKE-A", productName: "FAKE Product", size: "S", packCode: "BASE", baseQty: 1,
  packPrice: 100, stockTracked: true, available: 2, modifiers: [], serialTracked: false, scaleBarcode: null };
function harness(response: any, options: { selection?: boolean; pending?: boolean; cart?: any[] } = {}) {
  let finish!: (value: any) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const state = { result: null as any, cart: options.cart ?? [], error: "", notice: "", draft: selection.scanCode };
  const deps = {
    busy: false, addProductPendingRef: { current: false }, scanDraftRevision: { current: 0 }, scanResultVersion: { current: 0 },
    saleAttemptRef: { current: null as unknown }, cartVariantBaseQty,
    tokenRef: { current: "FAKE" }, token: "FAKE", scannedProduct: options.selection ? { kind: "selection", selection } : null,
    setScannedProduct: (value: any) => { state.result = value; }, setAddingProductKey() {},
    setError: (value: string) => { state.error = value; }, setNotice: (value: string) => { state.notice = value; },
    posGraphqlRequest: async () => { if (options.pending) await pending; if (response instanceof Error) throw response; return { bmsPosScan: response }; },
    POS_SCAN_QUERY: "query", PosGraphqlError, cart: state.cart,
    resolvedCartLine: (value: any) => ({ ...value, key: `${value.sku}:${value.size}:${value.packCode}`, qty: 1 }),
    ADVANCED_ITEM_NOTICE: "advanced", messageOf: (error: Error) => error.message,
    setCart: (update: any) => { state.cart = update(state.cart); }, setScanCode: (value: string) => { state.draft = value; },
  };
  const add = new Function(...Object.keys(deps), `${addSource}; return addProduct;`)(...Object.values(deps));
  return { add, deps, state, finish: () => finish(null) };
}

test("ambiguous code adds nothing until a size is explicitly resolved", async () => {
  const h = harness(new PosGraphqlError("Choose size", "CONFLICT", 200, selection));
  await h.add(selection.scanCode, undefined, true);
  assert.deepEqual(h.state.result, { kind: "selection", selection });
  assert.deepEqual(h.state.cart, []);
  assert.equal(h.state.error, "");
  const chosen = harness(hit, { selection: true });
  await chosen.add(selection.scanCode, "S", true);
  assert.equal(chosen.state.cart[0].size, "S");
  assert.equal(chosen.state.result.added, true);
  assert.equal(chosen.state.draft, "");
});

test("wrong size/product, advanced items and stock failures never add or claim success", async () => {
  for (const patch of [{ size: "L" }, { sku: "FAKE-OTHER" }, { available: 0 }, { serialTracked: true }, { modifiers: [{}] }]) {
    const h = harness({ ...hit, ...patch }, { selection: true });
    await h.add(selection.scanCode, "S", true);
    assert.deepEqual(h.state.cart, []);
    assert.notEqual(h.state.result?.added, true);
    assert.ok(h.state.error || h.state.notice);
  }
});

test("a chosen non-stock variant at zero own stock is sellable and preserves a pending scan draft", async () => {
  const h = harness({ ...hit, stockTracked: false, available: 0 }, { selection: true });
  h.state.draft = "NEXT";
  await h.add(selection.scanCode, "S");
  assert.equal(h.state.cart[0].size, "S");
  assert.equal(h.state.result.added, true);
  assert.equal(h.state.draft, "NEXT");
});

test("late requests cannot reopen a dismissed selection or mutate a new operator's cart", async () => {
  for (const response of [hit, new PosGraphqlError("Choose", "CONFLICT", 200, selection)]) {
    const h = harness(response, { pending: true });
    const running = h.add(selection.scanCode, undefined, true);
    h.deps.scanResultVersion.current++;
    h.finish(); await running;
    assert.equal(h.state.result, null);
    assert.deepEqual(h.state.cart, []);
    assert.equal(h.state.error, "");
  }
});

test("double Enter adds once; a late scan cannot erase the next draft", async () => {
  const h = harness(hit, { pending: true });
  const first = h.add(selection.scanCode, undefined, true);
  await h.add(selection.scanCode, undefined, true);
  h.deps.scanDraftRevision.current++;
  h.state.draft = "NEXT";
  h.finish(); await first;
  assert.equal(h.state.cart.length, 1);
  assert.equal(h.state.cart[0].qty, 1);
  assert.equal(h.state.draft, "NEXT");
  assert.equal(h.state.result, null);
});

test("first pack and mixed packs share the same variant stock ceiling, but different sizes do not", async () => {
  const initial = (patch: object) => ({ ...hit, key: "FAKE-A:S:BASE", qty: 1, ...patch });
  for (const cart of [[], [initial({ qty: 2 })], [initial({ qty: 1, packCode: "BOX", baseQty: 6 })]]) {
    const h = harness({ ...hit, packCode: "CASE", baseQty: 6, available: cart.length ? 7 : 5 }, { cart });
    await h.add("CASE");
    assert.equal(h.state.cart.length, cart.length);
    assert.notEqual(h.state.result?.added, true);
    assert.match(h.state.error, /หน่วยฐาน/);
  }
  const h = harness({ ...hit, packCode: "BOX", baseQty: 6, available: 7 }, { cart: [initial({}), initial({ key: "FAKE-A:L:BASE", size: "L", qty: 99 })] });
  await h.add("BOX");
  assert.equal(h.state.cart.length, 3);
  assert.equal(h.state.result.added, true);
  assert.equal(h.state.cart[0].available, 7);
});

test("quantity edits cannot race an in-flight scan and cannot oversell by mixing packs", () => {
  const body = compile(renderer.slice(renderer.indexOf("  const changeQty ="), renderer.indexOf("  const retailPricing =")));
  const cart = [{ ...hit, key: "BASE", qty: 1, available: 7 }, { ...hit, key: "BOX", qty: 1, baseQty: 6, available: 7 }];
  const state = { error: "", writes: 0 };
  const deps = { saleAttemptRef: { current: null }, addProductPendingRef: { current: true }, cart, cartVariantBaseQty,
    setError: (value: string) => { state.error = value; }, setCart: () => { state.writes++; } };
  const change = new Function(...Object.keys(deps), `${body}; return changeQty;`)(...Object.values(deps));
  change("BASE", -1);
  assert.equal(state.writes, 0);
  deps.addProductPendingRef.current = false;
  change("BASE", 1);
  assert.equal(state.writes, 0);
  assert.match(state.error, /หน่วยฐาน/);
  change("BASE", -1);
  assert.equal(state.writes, 1);
});

test("unresolved payment attempts never accept a new scan", async () => {
  const h = harness(hit);
  h.deps.saleAttemptRef.current = {};
  await h.add(selection.scanCode);
  assert.deepEqual(h.state.cart, []);
  assert.equal(h.state.result, null);
});

test("a refreshed selection cannot inherit a size from the previous selection object", () => {
  let choice: any = null;
  const compiled = ts.transpileModule(read("apps/web/components/pos-desktop/ScannedProductPanel.tsx"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exported: any = {};
  new Function("require", "exports", compiled)((id: string) => {
    if (id === "react") return { useState: () => [choice, (value: any) => { choice = value; }] };
    if (id === "react/jsx-runtime") return require(id);
    if (id === "@ant-design/icons") return { ArrowLeftOutlined: () => null, CheckCircleOutlined: () => null,
      PictureOutlined: () => null, PlusOutlined: () => null };
    if (id.endsWith(".css")) return { default: {} };
    throw new Error(`Unexpected import ${id}`);
  }, exported);
  const inputs = (node: any): any[] => !node || typeof node !== "object" ? []
    : Array.isArray(node) ? node.flatMap(inputs) : node.type === "input" ? [node] : inputs(node.props?.children);
  const render = (value: any) => inputs(exported.default({ result: { kind: "selection", selection: value }, busy: false, onSelect() {}, onClose() {} }));
  render(selection)[0].props.onChange();
  assert.equal(render(selection)[0].props.checked, true);
  assert.ok(render({ ...selection }).every(input => !input.props.checked));
});
