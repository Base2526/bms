import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Retail Local releases distinguish combined, server, and POS packages", () => {
  const migration = read("db/migrations/10.20__bms_retail_local_release_package_types.sql");
  const service = read("apps/web/lib/bms/retailLocalReleases.ts");
  const publicPage = read("apps/web/app/(main)/retail-local/RetailLocalPageClient.tsx");
  const adminPage = read("apps/web/app/(admin)/admin/retail-local-releases/page.tsx");
  const adminRoute = read("apps/web/app/api/admin/retail-local/releases/route.ts");

  assert.match(migration, /DEFAULT 'server'/);
  assert.match(migration, /'server-pos', 'server', 'pos'/);
  assert.match(migration, /\(platform, package_type\)[\s\S]*WHERE is_latest/);

  assert.match(service, /packageType === "pos" \? \["\.dmg"\] : \["\.pkg"\]/);
  assert.match(service, /WHERE platform = \$1 AND package_type = \$2/);
  assert.match(adminRoute, /packageType: form\.get\("packageType"\)/);

  for (const packageType of ["server-pos", "server", "pos"]) {
    assert.match(publicPage, new RegExp(`"${packageType}"`));
  }
  assert.match(adminPage, /name="packageType"/);
  assert.match(adminPage, /lower\.endsWith\("\.dmg"\)/);
});
