import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("login redirect agrees with the API on revoked and changed admin sessions", () => {
  const login = read("../apps/web/app/(admin)/admin/login/layout.tsx");
  const me = read("../apps/web/app/api/auth/me/route.ts");
  const graphql = read("../apps/web/app/api/graphql/route.ts");

  assert.match(me, /isAdminSessionActive\(adminToken\.jti\)[\s\S]*refreshAdminIdentity\(adminToken\)/);
  assert.match(graphql, /isAdminSessionActive\(admin\.jti\)[\s\S]*refreshAdminIdentity\(admin\)/);
  assert.match(login, /admin && await isAdminSessionActive\(admin\.jti\)/);
  assert.match(login, /activeAdmin = Boolean\(await refreshAdminIdentity\(admin\)\)/);
  assert.match(login, /if \(activeAdmin\)\s*\{\s*redirect\("\/admin"\)/);
  assert.doesNotMatch(login, /if \(admin\)\s*redirect\("\/admin"\)/);
});

test("the admin session bundle and route have visible loading states", () => {
  const providers = read("../apps/web/app/ClientProviders.tsx");
  assert.match(providers, /loading: \(\) => \([\s\S]*role="status"[\s\S]*BMS POS\+ · Loading/);
  const route = read("../apps/web/app/(admin)/admin/loading.tsx");
  assert.match(route, /role="status"[\s\S]*BMS POS\+ · Loading/);
});
