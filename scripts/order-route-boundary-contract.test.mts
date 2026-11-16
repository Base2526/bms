import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

for (const [route, service, permission] of [
  ["pack", "packOrder", "order.ship"],
  ["ship", "shipOrder", "order.ship"],
  ["complete", "completeOrder", "order.pay"],
  ["cancel", "cancelOrder", "order.cancel"],
  ["return", "returnOrder", "order.return"],
] as const) {
  test(`${route} REST checks branch and forwards the authenticated actor`, async () => {
    const calls: unknown[][] = [];
    let allowed = false, authenticated = true;
    const mocks: Record<string, unknown> = {
      "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) =>
        ({ body, status: options?.status ?? 200 }) } },
      "@/lib/bms/orders": {
        canAccessOrderBranch: async (...args: unknown[]) => { calls.push(["branch", ...args]); return allowed; },
        [service]: async (...args: unknown[]) => { calls.push(["service", ...args]); return true; },
      },
      "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async (requested: string) => {
        assert.equal(requested, permission);
        return authenticated ? { ok: true, tenantId: "tenant-a", adminId: "actor-a" } : { ok: false, status: 403 };
      } },
      "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    };
    const source = readFileSync(path.join(root, `apps/web/app/api/bms/order/[id]/${route}/route.ts`), "utf8");
    const module = { exports: {} as Record<string, any> };
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "module", "exports", js)((name: string) => {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`);
      return mocks[name];
    }, module, module.exports);
    const post = module.exports.POST as (_req: Request, ctx: { params: { id: string } }) => Promise<any>;
    const request = () => new Request(`https://bms.example.invalid/api/bms/order/order-a/${route}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    });
    authenticated = false;
    assert.equal((await post(request(), { params: { id: "order-a" } })).status, 403);
    assert.deepEqual(calls, []);
    authenticated = true;
    if (route === "cancel" || route === "return") {
      const unconfirmed = new Request(`https://bms.example.invalid/api/bms/order/order-a/${route}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: false }),
      });
      assert.equal((await post(unconfirmed, { params: { id: "order-a" } })).status, 400);
      assert.deepEqual(calls, []);
    }
    assert.equal((await post(request(), { params: { id: "order-a" } })).status, 403);
    assert.deepEqual(calls, [["branch", "tenant-a", "order-a", "actor-a"]]);
    calls.length = 0;
    allowed = true;
    assert.equal((await post(request(), { params: { id: "order-a" } })).status, 200);
    assert.deepEqual(calls, [["branch", "tenant-a", "order-a", "actor-a"],
      ["service", "tenant-a", "order-a", "actor-a"]]);
  });
}

test("GraphQL cancellation and return reject missing confirmation before the order service", () => {
  const resolvers = readFileSync(path.join(root, "apps/web/graphql/bmsOrders.ts"), "utf8");
  const schema = readFileSync(path.join(root, "schema.graphql"), "utf8");
  for (const [name, service] of [["bmsCancelOrder", "cancelOrder"], ["bmsReturnOrder", "returnOrder"]] as const) {
    const body = resolvers.split(`async ${name}(`)[1]?.split("\n    async ")[0] ?? "";
    assert.ok(body.indexOf("args.confirmed !== true") > -1);
    assert.ok(body.indexOf("args.confirmed !== true") < body.indexOf(`${service}(`));
    assert.ok(schema.includes(`${name}(confirmed: Boolean!, id: ID!): Boolean!`));
  }
  const page = readFileSync(path.join(root, "apps/web/app/(admin)/admin/orders/page.tsx"), "utf8");
  const assistant = readFileSync(path.join(root, "apps/web/components/work-assistant/confirmMutations.ts"), "utf8");
  for (const name of ["bmsCancelOrder", "bmsReturnOrder"]) {
    assert.match(page, new RegExp(`${name}\\(id: \\$id, confirmed: true\\)`));
    assert.match(assistant, new RegExp(`${name}\\(id: \\$id, confirmed: true\\)`));
  }
});
