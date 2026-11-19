import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");
const source = ts.transpileModule(
  readFileSync(new URL("../apps/web/graphql/bmsPos.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function locationResolver(permissions: string[]) {
  let reads = 0;
  const module = { exports: {} as Record<string, any> };
  const mocks: Record<string, unknown> = {
    "@/lib/bms/permissions": {
      loadPermissions: async () => new Set(permissions),
      requirePermission: async (_ctx: unknown, permission: string) => {
        if (!permissions.includes(permission)) throw new Error("FORBIDDEN");
      },
    },
    "@/lib/bms/tenant": { getTenantId: () => "tenant-a" },
    "@/lib/bms/locations": { listLocations: async (tenantId: string) => {
      assert.equal(tenantId, "tenant-a");
      reads++;
      return [{ id: "branch-a" }];
    } },
  };
  new Function("require", "module", "exports", source)((name: string) => mocks[name] ?? {}, module, module.exports);
  return {
    resolve: () => module.exports.bmsPosResolvers.Query.bmsLocations(null, {}, {}),
    reads: () => reads,
  };
}

test("device managers can list branches needed to configure a POS register", async () => {
  const resolver = locationResolver(["pos.device.manage"]);
  assert.deepEqual(await resolver.resolve(), [{ id: "branch-a" }]);
  assert.equal(resolver.reads(), 1);
});

test("location listing still denies staff with neither catalog nor device permission", async () => {
  const resolver = locationResolver([]);
  await assert.rejects(resolver.resolve(), /FORBIDDEN/);
  assert.equal(resolver.reads(), 0);
});
