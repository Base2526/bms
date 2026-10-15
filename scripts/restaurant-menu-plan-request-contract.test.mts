import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";

const uiPath = "../apps/web/app/(admin)/admin/stock-models/RestaurantMenuPlan.tsx";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const result = (marker: string) => ({ status: "OK", marker, estimates: [], analysis: { status: "COMPLETE", rows: [], bundle: null } });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

/** Execute the real component and async callbacks with a deterministic hook/Form/Apollo seam.
 * This tests request ordering, not React rendering; the browser suite proves actual AntD locking.
 */
function mount() {
  const states: any[] = [], refs: any[] = [], pending: any[] = [];
  let stateIndex = 0, refIndex = 0, cleanup: (() => void) | undefined, writes = 0;
  let values: any = { assumptionSource: "FAKE", dailyFixedCost: 100, dailyTargetProfit: 0,
    items: [{ recipeId: "v7", scenario: { label: "FAKE", price: 100 } }], bundleEnabled: false };
  const Form = Object.assign(() => null, { Item: "Form.Item", List: "Form.List",
    useForm: () => [{ getFieldsValue: () => structuredClone(values) }], useWatch: () => values.bundleEnabled });
  const jsx = (type: any, props: any) => ({ type, props });
  const exports: any = {};
  new Function("require", "exports", ts.transpileModule(read(uiPath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText)((name: string) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (name === "react") return {
      useState: (initial: any) => { const i = stateIndex++; if (!(i in states)) states[i] = initial;
        return [states[i], (value: any) => { writes++; states[i] = value; }]; },
      useRef: (initial: any) => { const i = refIndex++; return refs[i] ??= { current: initial }; },
      useEffect: (effect: () => (() => void)) => { cleanup ??= effect(); },
    };
    if (name === "@apollo/client") return { gql: () => "QUERY", useApolloClient: () => ({ query: (request: any) =>
      new Promise((resolve, reject) => pending.push({ request, resolve: (data: any) => resolve({ data: { bmsRestaurantMenuPlan: data } }), reject })) }) };
    if (name === "@/lib/i18nContext") return { useI18n: () => ({ t: (key: string) => key }) };
    if (name === "./MenuBundlePublish") return {default:()=>null};
    if (name === "./RecipeCostBasis") return {default:()=>null,costSelection:()=>({costBasis:"CATALOG",locationId:null})};
    if (name === "antd") return { Form, Input: { TextArea: "TextArea" }, Typography: { Paragraph: "Paragraph", Title: "Title", Text: "Text" },
      ...Object.fromEntries(["Alert", "Button", "Card", "Checkbox", "InputNumber", "Select", "Space"].map(key => [key, key])) };
    throw new Error(name);
  }, exports);
  function formProps(): any {
    stateIndex = 0; refIndex = 0;
    const tree = exports.default({ recipeSelect: () => null });
    const find = (node: any): any => node?.type === Form ? node.props : Array.isArray(node)
      ? node.map(find).find(Boolean) : node?.props ? find(node.props.children) : undefined;
    return find(tree);
  }
  formProps();
  return { pending, states, formProps, writes: () => writes,
    submit: () => formProps().onFinish(structuredClone(values)),
    edit: (recipeId: string, notify = true) => { values.items[0].recipeId = recipeId; if (notify) formProps().onValuesChange(); },
    unmount: () => cleanup?.() };
}

test("current response is displayed and Form stays disabled until the request completes", async () => {
  const h = mount(); h.submit(); assert.equal(h.formProps().disabled, true);
  h.pending[0].resolve(result("v7")); await flush();
  assert.equal(h.states[0].marker, "v7"); assert.equal(h.states[1], null); assert.equal(h.formProps().disabled, false);
});
test("slow v7 success cannot overwrite v8 after an input edit and newer response", async () => {
  const h = mount(); h.submit(); h.edit("v8"); assert.equal(h.states[0], null); h.submit();
  assert.equal(h.pending[1].request.variables.input.items[0].recipeId, "v8");
  h.pending[1].resolve(result("v8")); await flush();
  h.pending[0].resolve(result("v7")); await flush();
  assert.equal(h.states[0].marker, "v8"); assert.equal(h.states[1], null);
});
test("stale finally cannot unlock a newer in-flight calculation", async () => {
  const h = mount(); h.submit(); h.edit("v8"); h.submit();
  h.pending[0].resolve(result("v7")); await flush();
  assert.equal(h.states[0], null); assert.equal(h.formProps().disabled, true);
  h.pending[1].resolve(result("v8")); await flush(); assert.equal(h.formProps().disabled, false);
});
test("old network errors and business rejections cannot replace current results", async () => {
  for (const rejected of [false, true]) {
    const h = mount(); h.submit(); h.edit("v8"); h.submit();
    h.pending[1].resolve(result("v8")); await flush();
    if (rejected) h.pending[0].reject(new Error("FAKE stale network error"));
    else h.pending[0].resolve({ status: "INVALID_INPUT", errorCode: "FAKE_STALE_REJECTION" });
    await flush(); assert.equal(h.states[0].marker, "v8"); assert.equal(h.states[1], null);
  }
});
test("programmatic Form changes also discard outdated success/error without leaving loading stuck", async () => {
  for (const rejected of [false, true]) {
    const h = mount(); h.submit(); h.edit("v8", false);
    if (rejected) h.pending[0].reject(new Error("FAKE stale")); else h.pending[0].resolve(result("v7"));
    await flush(); assert.deepEqual(h.states, [null, null, false]);
  }
});
test("closing the modal prevents pending success/error/finally from updating an unmounted instance", async () => {
  for (const rejected of [false, true]) {
    const h = mount(); h.submit(); h.unmount(); const before = h.writes();
    if (rejected) h.pending[0].reject(new Error("FAKE late")); else h.pending[0].resolve(result("v7"));
    await flush(); assert.equal(h.writes(), before);
  }
});
test("latest network and business errors are still reported and release loading", async () => {
  for (const rejected of [false, true]) {
    const h = mount(); h.submit();
    if (rejected) h.pending[0].reject(new Error("FAKE current")); else h.pending[0].resolve({ status: "INVALID_INPUT", errorCode: "FAKE_CURRENT" });
    await flush(); assert.equal(h.states[0], null); assert.match(h.states[1], /FAKE/); assert.equal(h.formProps().disabled, false);
  }
});
test("recipe picker inherits disabled Form context after a product is selected", () => {
  const page = read("../apps/web/app/(admin)/admin/stock-models/page.tsx");
  assert.match(page, /disabled=\{!sku \? true : undefined\}/);
  assert.doesNotMatch(page, /disabled=\{!sku\}/);
});
