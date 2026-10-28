import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ALL_TOOLS } from "../../apps/web/lib/bms/tools/catalog.ts";
import type { ExecCtx } from "../../apps/web/lib/bms/tools/types.ts";

const ctx: ExecCtx = { tenantId: "11111111-1111-4111-8111-111111111111", surface: "staff", actor: "test" };
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/components/work-assistant/confirmMutations.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} as any };
new Function("require", "module", "exports", compiled)(require, module, module.exports);
const { WORK_ASSISTANT_CONFIRM_MUTATIONS } = module.exports;

for (const name of ["create_purchase_order", "propose_stock_transfer"]) {
  test(`${name}: identical new proposals get distinct keys; confirming a saved proposal preserves its key`, async () => {
    const tool = ALL_TOOLS.find((t) => t.name === name)!;
    const args = { fromLocationId: "11111111-1111-4111-8111-111111111111", toLocationId: "22222222-2222-4222-8222-222222222222",
      items: [{ sku: "TEST", size: "M", qty: 5 }] };
    const first = await tool.execute(args, ctx), second = await tool.execute(args, ctx);
    assert.ok(first.ok && first.proposal && second.ok && second.proposal);
    const a = first.proposal, b = second.proposal;
    const key = (p: typeof a) => name === "create_purchase_order" ? p.args.requestId : (p.args.input as any).idempotencyKey;
    assert.notEqual(key(a), key(b));
    const confirm = WORK_ASSISTANT_CONFIRM_MUTATIONS[a.mutation];
    assert.ok(confirm);
    const saved = JSON.parse(JSON.stringify(a.args));
    assert.deepEqual(confirm.vars(saved), JSON.parse(JSON.stringify(confirm.vars(a.args))));
    assert.ok(JSON.stringify(confirm.vars(saved)).includes(String(key(a))));
  });
}

test("staff inventory tools reject a missing actor before any scope or inventory query", async () => {
  const tool = ALL_TOOLS.find((t) => t.name === "get_inventory_intelligence")!;
  await assert.rejects(tool.execute({}, ctx), /ต้องมีบัญชีพนักงาน/);
});
