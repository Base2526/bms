import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { InMemoryCache, gql } = require("@apollo/client");
const source = readFileSync(new URL("../apps/web/app/(admin)/admin/restaurant-floor/page.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: any[] = [];
function visit(node: any) { nodes.push(node); ts.forEachChild(node, visit); }
visit(tree);
const compile = (code: string) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const queryNode = nodes.find(n => ts.isVariableDeclaration(n) && n.name.getText(tree) === "Q_FLOOR");
const Q_FLOOR = new Function("gql", compile(`return ${queryNode.initializer.getText(tree)};`))(gql);
const mutationNode = nodes.find(n => ts.isCallExpression(n) && n.expression.getText(tree) === "useMutation"
  && n.arguments[0]?.getText(tree) === "M_SET_CUSTOMER_TABLE_DETAILS");
const options = new Function("Q_FLOOR", compile(`return (${mutationNode.arguments[1].getText(tree)});`))(Q_FLOOR);
const effectNode = nodes.find(n => ts.isCallExpression(n) && n.expression.getText(tree) === "useEffect"
  && n.arguments[0].getText(tree).includes("setPositions(next)"));
const tableNodes = ["tablesSnapshot", "tables"].map(name => nodes.find(n => ts.isVariableDeclaration(n)
  && n.name.getText(tree) === name));
const formEffectNode = nodes.find(n => ts.isCallExpression(n) && n.expression.getText(tree) === "useEffect"
  && n.arguments[0].getText(tree).includes("tableEditForm.setFieldsValue"));
const handlerNode = nodes.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "changeCustomerTableDetails");

function harness() {
  const cache = new InMemoryCache();
  for (const locationId of ["A", "B"]) cache.writeQuery({ query: Q_FLOOR, variables: { locationId }, data: {
    bmsRestaurantFloorAdmin: {
      __typename: "BmsRestaurantFloorAdmin", publishTableDetails: false, areas: [],
      tables: [{ __typename: "BmsRestaurantTableAdmin", id: `FAKE-${locationId}`, areaId: `AREA-${locationId}`,
        code: locationId, name: `FAKE ${locationId}`, seats: 4, shape: "round", positionX: 10, positionY: 20,
        blocked: false, active: true, status: "AVAILABLE" }],
    },
  } });
  let previousDeps: unknown[] = [];
  let previousFormDeps: unknown[] = [];
  let memoDeps: unknown[] = [];
  let memoTables: any[];
  const state = { positions: {} as Record<string, { x: number; y: number }>, dirty: new Set<string>(), form: {} as any };
  const tableEditForm = {
    resetFields: () => { state.form = {}; },
    setFieldsValue: (value: any) => { state.form = value; },
  };
  const read = (locationId: string) => cache.readQuery({ query: Q_FLOOR, variables: { locationId } });
  function render(locationId: string) {
    const floor = { data: read(locationId) };
    const tables = new Function("floor", "useMemo", compile(
      `${tableNodes.map(n => `const ${n.getText(tree)};`).join("\n")} return tables;`
    ))(floor, (run: () => any[], values: unknown[]) => {
      if (!memoTables || values.some((v, i) => !Object.is(v, memoDeps[i]))) memoTables = run();
      memoDeps = values;
      return memoTables;
    });
    const deps = {
      floor, locationId, tables,
      setPositions: (next: typeof state.positions) => { state.positions = next; },
      setDirtyIds: (next: Set<string>) => { state.dirty = next; },
      useEffect: (run: () => void, values: unknown[]) => {
        if (values.some((v, i) => !Object.is(v, previousDeps[i]))) run();
        previousDeps = values;
      },
    };
    new Function(...Object.keys(deps), compile(effectNode.getText(tree)))(...Object.values(deps));
    new Function("selectedTable", "tableEditForm", "useEffect", compile(formEffectNode.getText(tree)))(
      tables[0], tableEditForm, (run: () => void, values: unknown[]) => {
        if (values.some((v, i) => !Object.is(v, previousFormDeps[i]))) run();
        previousFormDeps = values;
      }
    );
    return { ...floor.data, stableTables: tables };
  }
  function handler(locationId: string, send: (args: any) => Promise<unknown>) {
    const deps = {
      locationId, setCustomerTableDetails: send,
      message: { success() {}, error() {} }, t: (key: string) => key,
      errorMessage: (error: Error) => error.message,
      refreshFloor: () => { assert.fail("publication must not reload the floor and discard drafts"); },
    };
    return new Function(...Object.keys(deps), compile(`${handlerNode.getText(tree)}; return changeCustomerTableDetails;`))(...Object.values(deps));
  }
  const update = (locationId: string, value: unknown) => options.update(cache, {
    data: { bmsSetRestaurantCustomerTableDetails: value },
  }, { variables: { locationId } });
  const updateTable = (locationId: string, patch: Record<string, unknown>) => cache.updateQuery({
    query: Q_FLOOR, variables: { locationId },
  }, (current: any) => ({
    ...current, bmsRestaurantFloorAdmin: {
      ...current.bmsRestaurantFloorAdmin,
      tables: current.bmsRestaurantFloorAdmin.tables.map((table: any) => ({ ...table, ...patch })),
    },
  }));
  return { read, render, handler, update, updateTable, state };
}

test("restaurant publication success preserves unsaved positions, dirty ids and table detail identity", async () => {
  const h = harness();
  const before = h.render("A");
  h.state.positions["FAKE-A"] = { x: 500, y: 600 };
  h.state.dirty.add("FAKE-A");
  h.state.form.name = "Unsaved table name";
  await h.handler("A", async ({ variables }: any) => { h.update(variables.locationId, variables.publish); })(true);
  const after = h.render("A");
  assert.equal(after.bmsRestaurantFloorAdmin.publishTableDetails, true);
  assert.equal(after.stableTables, before.stableTables);
  assert.equal(h.state.form.name, "Unsaved table name");
  assert.deepEqual(h.state.positions["FAKE-A"], { x: 500, y: 600 });
  assert.deepEqual([...h.state.dirty], ["FAKE-A"]);
  h.update("A", false);
  h.render("A");
  assert.equal(h.read("A").bmsRestaurantFloorAdmin.publishTableDetails, false);
  assert.ok(h.state.dirty.has("FAKE-A"));
});

test("a late publication response updates its submitted branch without altering the current branch draft", async () => {
  const h = harness();
  h.render("A");
  let finish!: () => void;
  const pending = h.handler("A", ({ variables }: any) => new Promise<void>(resolve => {
    finish = () => { h.update(variables.locationId, variables.publish); resolve(); };
  }))(true);
  h.render("B");
  h.state.positions["FAKE-B"] = { x: 700, y: 800 };
  h.state.dirty.add("FAKE-B");
  finish(); await pending;
  h.render("B");
  assert.equal(h.read("A").bmsRestaurantFloorAdmin.publishTableDetails, true);
  assert.equal(h.read("B").bmsRestaurantFloorAdmin.publishTableDetails, false);
  assert.deepEqual(h.state.positions["FAKE-B"], { x: 700, y: 800 });
  assert.ok(h.state.dirty.has("FAKE-B"));
});

test("failed or missing publication results preserve the saved setting and drafts", async () => {
  const h = harness();
  h.render("A");
  h.state.positions["FAKE-A"] = { x: 900, y: 950 };
  h.state.dirty.add("FAKE-A");
  await h.handler("A", async () => { throw new Error("FAKE permission denial"); })(true);
  h.update("A", undefined);
  h.render("A");
  assert.equal(h.read("A").bmsRestaurantFloorAdmin.publishTableDetails, false);
  assert.deepEqual(h.state.positions["FAKE-A"], { x: 900, y: 950 });
  assert.ok(h.state.dirty.has("FAKE-A"));
});

test("real table changes still refresh saved positions and the selected table form", () => {
  const h = harness();
  const before = h.render("A");
  h.state.positions["FAKE-A"] = { x: 900, y: 950 };
  h.state.dirty.add("FAKE-A");
  h.updateTable("A", { name: "FAKE saved name", positionX: 30, positionY: 40 });
  const after = h.render("A");
  assert.notEqual(after.stableTables, before.stableTables);
  assert.deepEqual(h.state.positions["FAKE-A"], { x: 30, y: 40 });
  assert.equal(h.state.dirty.size, 0);
  assert.equal(h.state.form.name, "FAKE saved name");
});
