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

test("the admin session bundle and route have visible, localized loading states", async () => {
  const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const providers = stripComments(read("../apps/web/app/ClientProviders.tsx"));
  const route = stripComments(read("../apps/web/app/(admin)/admin/loading.tsx"));
  // The session bundle fallback renders inside I18nProvider, so it follows the chosen language.
  assert.match(providers, /loading: \(\) => <SessionLoading \/>/);
  assert.match(providers, /function SessionLoading\(\)[\s\S]*useI18n\(\)[\s\S]*role="status"[\s\S]*t\("common\.loading_app_label"\)[\s\S]*t\("common\.loading_app"\)/);
  // The route fallback is a server component: it reads the same `lang` cookie as the root layout.
  assert.match(route, /\(await cookies\(\)\)\.get\("lang"\)/);
  assert.match(route, /role="status"[\s\S]*getMessage\(lang, "common\.loading_app_label"\)[\s\S]*getMessage\(lang, "common\.loading_app"\)/);
  for (const source of [providers, route]) assert.doesNotMatch(source, /Loading…|loading"/);

  const { getMessage } = await import("../apps/web/i18n/index.ts");
  assert.equal(getMessage("en", "common.loading_app"), "BMS POS+ · Loading…");
  assert.equal(getMessage("en", "common.loading_app_label"), "BMS POS+ loading");
  assert.match(getMessage("th", "common.loading_app"), /^BMS POS\+ · [ก-๙]/);
  assert.match(getMessage("th", "common.loading_app_label"), /^BMS POS\+ [ก-๙]/);
});
