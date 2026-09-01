// =============================================================
// 9.46 recheck — the three defects a source-scan suite could not see before
// -------------------------------------------------------------
// Kept in its own file rather than appended to support-diagnostics-contract.test.mts
// because each of these guards a boundary that belongs to the whole repo, not just to
// the diagnostics module: which role may touch `files`, which RLS shape a new tenant
// table may use, and what a caller-supplied range is allowed to answer.
// =============================================================

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const code = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/^[ \t]*--.*$/gm, "");

/** Every exported function in `source` as [name, body] — body runs to the next top-level export. */
function exportedFunctions(source: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const match of source.matchAll(/^export (?:async )?function (\w+)/gm)) {
    const rest = source.slice((match.index ?? 0) + 1);
    const next = rest.search(/\nexport /);
    found.push([match[1], next < 0 ? rest : rest.slice(0, next)]);
  }
  return found;
}

async function tsFilesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) found.push(...await tsFilesUnder(`${dir}/${entry.name}`));
    else if (/\.tsx?$/.test(entry.name)) found.push(`${dir}/${entry.name}`);
  }
  return found;
}

test("bms_app never reaches the files table, which 9.28 revoked on purpose", async () => {
  // 9.28 took SELECT on `files` away from bms_app deliberately: files has RLS disabled, so
  // the grant let the constrained role read every shop's file rows. That makes any `files`
  // statement issued on a client already switched to bms_app by beginTenantTx a guaranteed
  // "permission denied for table files" at runtime — which is exactly how the platform
  // Support download broke. Whole-tree scan so the next module cannot repeat it.
  //
  // Note the rule is about the ROLE, not the table: purgeExpiredSupportBundles() joins
  // files on a plain BEGIN (still the app role) and is correct, so keying on `client.query`
  // alone would be wrong. The presence of beginTenantTx in the same function is the signal.
  const offenders: string[] = [];
  for (const file of await tsFilesUnder("apps/web/lib")) {
    const source = code(await read(file));
    for (const [name, body] of exportedFunctions(source)) {
      if (!/beginTenantTx\(/.test(body)) continue;
      for (const statement of body.matchAll(/client\.query[<(][\s\S]{0,900}?\)\s*;/g)) {
        if (/\b(FROM|JOIN|UPDATE|INTO)\s+files\b/i.test(statement[0])) {
          offenders.push(`${file} :: ${name}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `these issue a files statement as bms_app: ${offenders.join(", ")}`);
});

test("the platform bundle reader resolves the object before it opens the tenant tx", async () => {
  const service = code(await read("apps/web/lib/bms/supportDiagnostics.ts"));
  const reader = exportedFunctions(service).find(([name]) => name === "readSupportBundleForPlatform");
  assert.ok(reader, "readSupportBundleForPlatform not found");
  const [, body] = reader;
  const join = body.indexOf("JOIN files");
  const tx = body.indexOf("beginTenantTx");
  assert.ok(join >= 0, "the reader must still resolve relpath from files");
  assert.ok(tx >= 0, "the download must still be audited inside a tenant transaction");
  assert.ok(join < tx, "the files lookup must run on the plain pool, before the tenant tx");
  // Expiry and the audit row are the two guarantees this path exists for.
  assert.ok(body.includes("b.expires_at > now()"));
  assert.ok(body.includes("'support.logs_download'"));
});

test("new diagnostic tables keep the 4.2 RLS shape so fleet-wide retention still runs", async () => {
  // The strict form -- tenant_id = NULLIF(...) with no COALESCE -- matches zero rows once
  // FORCE ROW LEVEL SECURITY applies to the table owner. purgeExpiredSupportBundles() runs
  // fleet-wide on the plain pool with no bms.tenant_id set, so under the strict shape it
  // would claim nothing, purge nothing and report success forever: private bundles that
  // must be deleted at 90 days would simply live on. 4.2 documents the permissive-when-unset
  // shape; bms_app always sets the GUC in beginTenantTx and is NOBYPASSRLS, so a shop is
  // still isolated. Both spellings appear below because 4.2 dollar-quotes its policy body
  // while 9.46 single-quotes it, doubling every inner quote.
  const migration = code(await read("db/migrations/9.46__bms_support_diagnostics.sql"));
  const baseline = code(await read("db/migrations/4.2__bms_rls.sql"));
  const doubled = "COALESCE(NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid, tenant_id)";
  const single = "COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id)";

  assert.ok(baseline.includes(single), "4.2 is the baseline this shape is copied from");
  const start = migration.indexOf("'bms_support_events','bms_support_bundles'");
  assert.ok(start >= 0, "the policy loop for the two new tables must exist");
  const policy = migration.slice(start);
  assert.ok(policy.includes(`USING (tenant_id = ${doubled})`), "USING must be permissive when the GUC is unset");
  assert.ok(policy.includes(`WITH CHECK (tenant_id = ${doubled})`), "WITH CHECK must match USING");
  assert.ok(policy.includes("FORCE ROW LEVEL SECURITY"), "isolation for bms_app is still forced");

  // system_logs predates this feature. Enabling RLS on a shared table must not be able to
  // cut off the log writer or /admin/logs on a deployment where the app role is not the owner.
  assert.ok(migration.includes("CREATE POLICY system_logs_base_app_full ON system_logs"));
  assert.ok(migration.includes("WITH CHECK (NULLIF(current_setting('bms.tenant_id', true), '') IS NULL)"));
  assert.match(migration, /CREATE POLICY system_logs_bms_app_tenant_read[\s\S]*?FOR SELECT TO bms_app/);
});

test("a caller-supplied range answers 400, never a 500 that pages ops", async () => {
  // withRouteErrorLog turns an uncaught throw into an error-level system_logs row, which is
  // a Slack condition. A reversed from/to is bad input, not a server fault.
  const service = code(await read("apps/web/lib/bms/supportDiagnostics.ts"));
  assert.ok(service.includes("export class SupportDiagnosticsInputError extends Error"));
  assert.ok(service.includes("throw new SupportDiagnosticsInputError"));
  for (const file of [
    "apps/web/app/api/bms/support-diagnostics/export/route.ts",
    "apps/web/app/api/bms/support-diagnostics/send/route.ts",
    "apps/web/app/api/pos/support-diagnostics/route.ts",
  ]) {
    const route = code(await read(file));
    assert.ok(route.includes("error instanceof SupportDiagnosticsInputError"), file);
    assert.ok(route.includes("status: 400"), file);
  }
});

test("a shop denied by permission is told which permission it needs", async () => {
  // "unauthorized" alone leaves the shop with nothing to act on, and these are back-office
  // routes — naming the permission is safe here in a way it would not be at the counter.
  for (const [file, permission] of [
    ["apps/web/app/api/bms/support-diagnostics/events/route.ts", "support.logs.view"],
    ["apps/web/app/api/bms/support-diagnostics/export/route.ts", "support.logs.export"],
    ["apps/web/app/api/bms/support-diagnostics/send/route.ts", "support.logs.send"],
  ] as const) {
    const route = code(await read(file));
    assert.ok(route.includes(`requiredPermission: "${permission}"`), file);
    assert.ok(route.includes(`authorizeAdminRoute("${permission}")`), file);
  }
});
