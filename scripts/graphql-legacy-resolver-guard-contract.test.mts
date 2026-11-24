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

test("platform-wide dashboard counts and newest users/posts are platform-admin only and bounded", () => {
  // These root queries read users/posts/files/system_logs across every shop. requireAuth() alone
  // accepted shop staff and public web/android accounts, and latestUsers returned name + email.
  for (const name of ["stats", "pending", "latestUsers", "latestPosts"]) {
    assertGuardBeforeFirstQuery(name, /await requirePlatformOnly\(ctx\)/);
  }
  for (const name of ["latestUsers", "latestPosts"]) {
    const body = resolverBody(name);
    assert.match(body, /const boundedLimit = Math\.min\(Math\.max\(Math\.trunc\(Number\(limit\)\) \|\| 5, 1\), 50\)/);
    assert.match(body, /\[boundedLimit\]/);
    assert.doesNotMatch(body, /\[limit\]/);
    // pg returns Date objects; a String field must not receive an epoch number.
    assert.match(body, /created_at: toIso\((u|r)\.created_at\)/);
  }
});

test("global role definitions can only be changed by a platform admin, and activation is audited", () => {
  for (const name of ["createRole", "updateRole", "deleteRole", "setRoleActive"]) {
    assertGuardBeforeFirstQuery(name, /await requirePlatformOnly\(ctx\)/);
  }
  // Switching a global role off hides it from every shop and breaks owner signup for Administrator.
  assert.match(resolverBody("setRoleActive"), /await audit\(ctx, "role\.set_active", id,/);
  // 2026-11-24 recheck: updateRole could set is_active too (and rename/re-describe a role every shop
  // uses) without any audit row, and create/delete left none either.
  assert.match(resolverBody("updateRole"), /await audit\(ctx, "role\.update", id,/);
  assert.match(resolverBody("createRole"), /await audit\(ctx, "role\.create", /);
  assert.match(resolverBody("deleteRole"), /await audit\(ctx, "role\.delete", id,/);
});
