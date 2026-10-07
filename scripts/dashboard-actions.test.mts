import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { buildSchema, parse, validate } = require("./node_modules/graphql/index.js");
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const service = read("apps/web/lib/bms/actionCenter.ts");
const ui = read("apps/web/components/dashboard/DashboardActions.tsx");
const resolver = read("apps/web/graphql/bmsDashboard.ts");

function harness() {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const code = service.slice(service.indexOf("export async function listActions("), service.indexOf("export async function getActionMetrics("));
  const js = ts.transpileModule(code.replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const list = new Function("query", "row", `${js}; return listActions;`)(async (sql: string, args: unknown[]) => {
    calls.push({ sql, args }); return { rows: [{ id: "FAKE" }] };
  }, (row: unknown) => row);
  return { calls, list };
}

test("action reads bind tenant, group and offset and preserve bounded legacy defaults", async () => {
  const { calls, list } = harness();
  assert.deepEqual(await list("FAKE-tenant"), [{ id: "FAKE" }]);
  assert.deepEqual(calls[0].args, ["FAKE-tenant", 50, "ALL", 0]);
  await list("FAKE-tenant", 999, "HISTORY", 20);
  assert.deepEqual(calls[1].args, ["FAKE-tenant", 100, "HISTORY", 20]);
  assert.match(calls[1].sql, /a\.tenant_id=\$1/);
  assert.match(calls[1].sql, /a\.status IN \('COMPLETED','DISMISSED','EXPIRED'\)/);
  assert.match(calls[1].sql, /a\.id LIMIT \$2 OFFSET \$4/);
  assert.match(calls[1].sql, /THEN a\.updated_at END DESC/);
});
test("active work is not hidden merely because its due date has passed", async () => {
  const { calls, list } = harness();
  await list("FAKE", 3, "ACCEPTED", 0);
  assert.deepEqual(calls[0].args, ["FAKE", 3, "ACCEPTED", 0]);
  const where = calls[0].sql.split("WHERE")[1].split("ORDER BY")[0];
  assert.doesNotMatch(where, /due_at|now\(|created_at/);
});
test("invalid groups and offsets never reach SQL", async () => {
  const { calls, list } = harness();
  for (const [group, offset] of [["unknown", 0], ["ALL", -1], ["NEW", 1.5]]) {
    await assert.rejects(list("FAKE", 3, group, offset));
  }
  assert.equal(calls.length, 0);
});
test("the UI action query validates against the exported server schema", () => {
  const source = ui.match(/export const Q_ACTION_LIST = gql`([\s\S]*?)`/)![1];
  assert.deepEqual(validate(buildSchema(read("schema.graphql")), parse(source)), []);
  assert.match(resolver, /requirePermission\(ctx, "report.view"\);[\s\S]*?listActions\(getTenantId\(ctx\)/);
  assert.match(resolver, /requirePermission\(ctx, "action.manage"\)/);
});
test("summary is bounded, metrics are deferred and overview precedes tasks", () => {
  assert.match(ui, /group: tab, limit: 3, offset: 0/);
  assert.match(ui, /group, limit: 21, offset: page \* 20/);
  assert.match(ui, /useQuery\(Q_METRICS, \{ skip: !enabled \|\| !open/);
  assert.match(ui, /status === "DISMISSED" && !reason\?\.trim\(\)/);
  assert.match(ui, /status === "COMPLETED" && note === null/);
  const page = read("apps/web/app/(admin)/admin/dashboard/page.tsx");
  assert.ok(page.indexOf('title={t("admin_dashboard.kpi_revenue_today")}') < page.indexOf("<DashboardActions"));
  assert.doesNotMatch(page, /JSON\.stringify\(a\.evidence\)|pagination=\{\{ pageSize: 10 \}\}/);
});
