// =============================================================
// Every type-level resolver a GraphQL module exports must actually be attached to the schema.
// -------------------------------------------------------------
// graphql/resolvers.ts lists type resolvers (BmsOrder, BmsPayment, ...) by hand. A module that
// exported e.g. `BmsDashboard.couponSummary` (a permission mask) but was never listed there kept
// compiling and its tests kept passing, while the live schema used the default field resolver:
// roles with report.view but without coupon.view received coupon rows. Found 2026-11-24 with
// BmsShipmentTrackingEvent (snake_case rows into non-null camelCase fields) and the parked-sale
// cart normalizers in the same state.
//
// This builds the real executable schema and requires a resolve function on every such field.
// =============================================================
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";

import { buildBmsGraphqlSchema } from "../apps/web/graphql/schema";

// A bare `graphql` import resolves to apps/web/graphql (tsconfig baseUrl), so use duck typing.
const isScalar = (value: unknown) => typeof (value as any)?.serialize === "function";
const fieldsOf = (type: unknown): Record<string, { resolve?: unknown }> | null =>
  typeof (type as any)?.getFields === "function" && !(type as any)?.getValues ? (type as any).getFields() : null;

const ROOT_TYPES = new Set(["Query", "Mutation", "Subscription"]);
const graphqlDir = new URL("../apps/web/graphql/", import.meta.url);

test("type-level resolvers exported by graphql modules are wired into the executable schema", async () => {
  const schema = buildBmsGraphqlSchema();
  const files = readdirSync(graphqlDir).filter((name) => /\.ts$/.test(name) && !name.endsWith(".d.ts"));
  const missing: string[] = [];
  let checked = 0;
  for (const name of files) {
    const mod = await import(new URL(name, graphqlDir).href);
    for (const [exportName, value] of Object.entries(mod)) {
      if (!/Resolvers$/.test(exportName) || !value || typeof value !== "object") continue;
      if (exportName === "resolvers" || exportName === "mergedResolvers") continue;
      for (const [typeName, fields] of Object.entries(value as Record<string, unknown>)) {
        if (ROOT_TYPES.has(typeName) || !fields || typeof fields !== "object") continue;
        if (isScalar(fields)) continue;
        const schemaFields = fieldsOf(schema.getType(typeName));
        for (const [fieldName, resolver] of Object.entries(fields as Record<string, unknown>)) {
          const fn = typeof resolver === "function" ? resolver : (resolver as any)?.resolve;
          if (typeof fn !== "function") continue;
          checked += 1;
          const field = schemaFields?.[fieldName];
          // An unwired type resolver leaves field.resolve undefined (GraphQL's default property read).
          // Identity is not compared: the schema loads modules through the `@/` alias, which can give
          // a second module instance from the file URL imported here.
          if (typeof field?.resolve !== "function") missing.push(`${name}: ${exportName}.${typeName}.${fieldName}`);
        }
      }
    }
  }
  assert.ok(checked > 20, `expected to inspect the modules' type resolvers, inspected ${checked}`);
  assert.deepEqual(missing, [], "these resolvers compile and are tested in isolation but never run in the live schema");
});
