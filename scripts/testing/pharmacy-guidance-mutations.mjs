// Reversible contract mutations. Commit targets first; never use on an active build/test run.
// node scripts/testing/pharmacy-guidance-mutations.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const store = "apps/web/lib/bms/pharmacy/guidanceTemplateStore.ts";
const pure = "apps/web/lib/bms/pharmacy/guidanceTemplates.ts";
const page = "apps/web/app/(admin)/admin/pharmacy-guidance/page.tsx";
const sql = "db/migrations/10.47__bms_guidance_approval_license_lock.sql";
const replace = (source, from, to) => { assert.ok(source.includes(from), `Missing mutation anchor: ${from}`); return source.replaceAll(from, to); };
const cases = [
  ["DRAFT reaches a customer", store, (s) => replace(s, "AND status = 'APPROVED'", "AND status = 'DRAFT'")],
  ["unlicensed approval bypass", store, (s) => replace(s, "if (license.rows[0]?.ok !== true)", "if (false)")],
  ["raw malformed placeholders", pure, (s) => replace(s, 'return unresolved || /\\{\\{|\\}\\}/.test(filled) ? [] : [filled.trimEnd()];', 'return [filled.trimEnd()];')],
  ["seed is approved", store, (s) => replace(s, "VALUES ($1,$2,$3,$4,'DRAFT',$5)", "VALUES ($1,$2,$3,$4,'APPROVED',$5)")],
  ["starting draft instructs stopping medicine", pure, (s) => replace(s, "Please contact a pharmacist or doctor about the reaction.", "Please stop taking your medicine. Please contact a pharmacist or doctor about the reaction.")],
  ["licence helper loses tenant guard", sql, (s) => replace(s, "IS DISTINCT FROM p_tenant_id", "IS NOT DISTINCT FROM p_tenant_id")],
  ["preview substitutes made-up shop facts", page, (s) => replace(s, "renderPharmacyGuidance(editing.body, previewValues, editing.locale)", 'renderPharmacyGuidance(editing.body, { shop_phone: "02-000-0000" }, editing.locale)')],
];
const targets = [...new Set(cases.map(([, file]) => file))];
const git = spawnSync("git", ["status", "--porcelain", "--", ...targets], { cwd: root, encoding: "utf8" });
assert.equal(git.status, 0); assert.equal(git.stdout.trim(), "", "Commit targets before mutation");
let killed = 0;
for (const [name, file, mutate] of cases) {
  const absolute = path.join(root, file), original = readFileSync(absolute);
  try {
    const changed = mutate(original.toString("utf8"));
    assert.notEqual(changed, original.toString("utf8"));
    writeFileSync(absolute, changed);
    const run = spawnSync(process.execPath, ["scripts/run-contract-tests.mjs", "pure", "pharmacy-guidance"],
      { cwd: root, encoding: "utf8", timeout: 45_000, maxBuffer: 4_000_000 });
    if (run.error) throw run.error;
    assert.notEqual(run.status, 0, `SURVIVED: ${name}`);
    assert.match(run.stdout + run.stderr, /AssertionError|ERR_ASSERTION/, "A compile/import crash is not a killed contract mutation");
    console.log(`KILLED: ${name}`); killed++;
  } finally {
    writeFileSync(absolute, original);
    assert.ok(readFileSync(absolute).equals(original), "Restore must be byte-exact");
  }
}
console.log(`${killed}/${cases.length} killed; original bytes restored.`);
const baseline = spawnSync(process.execPath, ["scripts/run-contract-tests.mjs", "pure", "pharmacy-guidance"],
  { cwd: root, encoding: "utf8", timeout: 45_000, maxBuffer: 4_000_000 });
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
console.log("Restored baseline: PASS");
