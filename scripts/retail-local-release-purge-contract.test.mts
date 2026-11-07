import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Retail Local installer purge is explicit, platform-admin-only, and same-origin", () => {
  const route = read("apps/web/app/api/admin/retail-local/releases/[id]/route.ts");

  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /authorizePlatformAdminRoute\(\)/);
  assert.match(route, /request\.headers\.get\("x-forwarded-host"\)/);
  assert.match(route, /request\.headers\.get\("x-forwarded-proto"\)/);
  assert.match(route, /origin === `\$\{protocol\}:\/\/\$\{host\}`/);
  assert.match(route, /if \(!isSameOrigin\(request\)\)/);
  assert.match(route, /throw new RetailLocalRequestBodyError\("invalid_body", 400\)/);
  assert.match(route, /readRetailLocalJSON\(request, 1024\)/);
  assert.match(route, /PURGE-RETAIL-LOCAL-RELEASE-FILE/);
  assert.match(route, /body\.releaseId !== params\.id/);
  assert.match(route, /tenantId: String\(auth\.admin\.tenant_id \|\| auth\.tenantId\)/);
  assert.match(route, /adminId: auth\.adminId/);
});

test("installer purge removes bytes but retains a guarded audit tombstone", () => {
  const service = read("apps/web/lib/bms/retailLocalReleases.ts");

  assert.match(service, /FOR UPDATE OF a, f/);
  assert.match(service, /row\.is_latest === true \|\| row\.status === "latest"/);
  assert.match(service, /row\.status !== "hidden"/);
  assert.match(service, /const relpath = String\(row\.relpath\);[\s\S]*await deleteStoredFile\(relpath\)/);
  assert.match(service, /if \(await statStoredFile\(relpath\)\)/);
  assert.match(service, /SET deleted_at = COALESCE\(deleted_at, now\(\)\), updated_at = now\(\)/);
  assert.match(service, /platform\.retail_local_release_file\.purge/);
  assert.match(service, /f\.deleted_at AS purged_at/);
  assert.match(service, /release file was permanently deleted/);
  assert.doesNotMatch(service, /DELETE FROM bms_retail_local_release_assets/);
  assert.doesNotMatch(service, /DELETE FROM files/);
});

test("admin UI explains reclaimed space and requires hidden status before purge", () => {
  const page = read("apps/web/app/(admin)/admin/retail-local-releases/page.tsx");

  assert.match(page, /deleteSpace/);
  assert.match(page, /formatBytes\(purging\.size_bytes\)/);
  assert.match(page, /disabled=\{row\.status !== "hidden" \|\| row\.is_latest\}/);
  assert.match(page, /confirmation: "PURGE-RETAIL-LOCAL-RELEASE-FILE"/);
  assert.match(page, /row\.purged_at/);
  assert.match(page, /metadata and audit history remain available/);
});

