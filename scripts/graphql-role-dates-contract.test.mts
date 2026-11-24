// =============================================================
// Role timestamps leave GraphQL as ISO strings.
// -------------------------------------------------------------
// roles.created_at/updated_at are timestamptz; pg returns JS Dates and GraphQLString serializes a
// Date through valueOf(), i.e. an epoch-millisecond string. /admin/roles renders
// `new Date(value)`, which turns "1764000000000" into "Invalid Date" (CLAUDE.local.md trap 1).
// Found 2026-11-24 (frontend sweep). Executed through the real executable schema.
// =============================================================
import assert from "node:assert/strict";
import test from "node:test";

import { buildBmsGraphqlSchema } from "../apps/web/graphql/schema";

test("Role.created_at and Role.updated_at resolve pg Dates to ISO strings", () => {
  const fields = (buildBmsGraphqlSchema().getType("Role") as any).getFields();
  const created = new Date("2026-11-24T03:04:05.678Z");
  const updated = new Date("2026-11-25T00:00:00.000Z");
  const row = { id: "FAKE-role", name: "FAKE", created_at: created, updated_at: updated };
  assert.equal(typeof fields.created_at.resolve, "function");
  assert.equal(fields.created_at.resolve(row, {}, {}, {}), "2026-11-24T03:04:05.678Z");
  assert.equal(fields.updated_at.resolve(row, {}, {}, {}), "2026-11-25T00:00:00.000Z");
  // A value that is already a string (e.g. a ::text cast) passes through unchanged.
  assert.equal(fields.created_at.resolve({ ...row, created_at: "2026-01-02T03:04:05Z" }, {}, {}, {}), "2026-01-02T03:04:05Z");
});
