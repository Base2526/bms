import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const graphqlRoute = readFileSync(
  new URL("../apps/web/app/api/graphql/route.ts", import.meta.url),
  "utf8"
);

test("GraphQL rejects stale or no-longer-authorized acting-tenant cookies", () => {
  assert.match(graphqlRoute, /admin\.is_platform_admin === true/);
  assert.match(graphqlRoute, /SELECT id FROM bms_tenants WHERE id = \$1 LIMIT 1/);
  assert.match(graphqlRoute, /cookieStore\.delete\(ACT_TENANT_COOKIE\)/);

  const existenceCheck = graphqlRoute.indexOf("SELECT id FROM bms_tenants");
  const tenantOverride = graphqlRoute.indexOf("__actingTenantId: act!.actTenantId");
  assert.ok(existenceCheck >= 0 && existenceCheck < tenantOverride);
});
