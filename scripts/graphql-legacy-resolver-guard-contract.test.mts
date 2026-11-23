import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Legacy resolvers in graphql/resolvers.ts predate the per-module BMS permission contracts. This
// file pins the guards found missing in the 2026-11-23 recheck.

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    // Keep "https://" and similar inside strings; drop real line comments.
    .map(line => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const resolvers = stripComments(
  readFileSync(new URL("../apps/web/graphql/resolvers.ts", import.meta.url), "utf8"),
);

/** The body of one `name: async (...) => { ... }` resolver, up to its closing `    },` line. */
function resolverBody(name: string): string {
  const start = resolvers.indexOf(`\n    ${name}: async (`);
  assert.ok(start >= 0, `resolver ${name} must exist in graphql/resolvers.ts`);
  const rest = resolvers.slice(start + 1);
  const end = rest.indexOf("\n    },");
  assert.ok(end > 0, `resolver ${name} must close at the resolver-map indentation`);
  return rest.slice(0, end);
}

function assertGuardBeforeFirstQuery(name: string, guard: RegExp) {
  const body = resolverBody(name);
  const guardAt = body.search(guard);
  assert.ok(guardAt >= 0, `${name} must call ${guard}`);
  const queryAt = body.search(/\bquery\(/);
  assert.ok(queryAt > guardAt, `${name} must authorize before its first SQL statement`);
}

test("global role definitions can only be changed by a platform admin, and activation is audited", () => {
  for (const name of ["createRole", "updateRole", "deleteRole", "setRoleActive"]) {
    assertGuardBeforeFirstQuery(name, /await requirePlatformOnly\(ctx\)/);
  }
  // Switching a global role off hides it from every shop and breaks owner signup for Administrator.
  assert.match(resolverBody("setRoleActive"), /await audit\(ctx, "role\.set_active", id,/);
});
