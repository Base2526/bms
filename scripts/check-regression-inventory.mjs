// Account for every test/smoke file. A classified file is not necessarily executed by Web gate.
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", ".test-output"]);
function walk(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return [];
    const relative = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(relative) : [relative];
  });
}
const candidates = ["scripts", "apps", "packages"].flatMap(walk).filter(file =>
  /(?:\.test\.(?:mts|mjs|ts|tsx|sh|ps1)|_test\.go|-browser-smoke\.mjs|-smoke\.(?:mts|mjs)|smoke-main\.mjs)$/.test(file)
).sort();
const manualSpecial = new Set([
  "scripts/retail-local-setup-diagnostics.test.ps1",
  "scripts/tax-invoice-pdf-smoke.mts",
  "scripts/realtime-live-smoke.mts",
  "scripts/testing/scheduler-smoke.mjs",
]);
const ciSpecial = new Set([
  "scripts/retail-local-bootstrap-behavior.test.mjs",
  "scripts/retail-local-unix-diagnostics.test.mjs",
  "scripts/retail-local-license-container.test.mjs",
  "scripts/retail-local-update-transaction.test.sh",
  "scripts/retail-local-uninstall-container.test.sh",
]);
function classify(file) {
  if (/^scripts\/(?:[^/]+|ai-eval\/[^/]+|infra\/[^/]+)\.test\.mts$/.test(file)) {
    return file.includes("-db-contract") ? "web-db" : "web-pure";
  }
  if (file === "scripts/retail-local-migration-checksum.test.mjs") return "web-pure";
  if (/^scripts\/[^/]+-browser-smoke\.mjs$/.test(file)) return "browser-manual";
  if (ciSpecial.has(file)) return "retail-local-ci";
  if (manualSpecial.has(file)) return "special-manual";
  if (/^apps\/mobile\/.+\.test\.tsx?$/.test(file)) return "mobile-ci";
  if (/^apps\/desktop\/test\/.+\.test\.mjs$/.test(file)) return "desktop-ci";
  if (file === "apps/desktop/test/smoke-main.mjs") return "desktop-ci";
  if (/^apps\/desktop\/test\/.+-smoke\.mjs$/.test(file)) return "desktop-manual";
  if (/^apps\/retail-local-agent\/.+_test\.go$/.test(file)) return "go-ci";
  return "UNCLASSIFIED";
}
const entries = candidates.map(file => ({ file, group: classify(file) }));
const groups = Object.fromEntries([...new Set(entries.map(entry => entry.group))].sort().map(group =>
  [group, entries.filter(entry => entry.group === group).length]
));
const unknown = entries.filter(entry => entry.group === "UNCLASSIFIED");
for (const [mode, group] of [["pure", "web-pure"], ["db", "web-db"]]) {
  const selected = new Set(JSON.parse(execFileSync(process.execPath,
    [path.join(root, "scripts/run-contract-tests.mjs"), mode, "--list"], { cwd: root, encoding: "utf8" })));
  const classified = new Set(entries.filter(entry => entry.group === group).map(entry => entry.file));
  for (const file of classified) if (!selected.has(file)) unknown.push({ file: `${file} (missing from ${mode} runner)`, group: "UNCLASSIFIED" });
  for (const file of selected) if (!classified.has(file)) unknown.push({ file: `${file} (not classified as ${group})`, group: "UNCLASSIFIED" });
}
const report = { schemaVersion: 1, total: entries.length, groups, unknown: unknown.map(entry => entry.file), entries };
console.log(`Regression inventory: ${entries.length} files`);
for (const [group, count] of Object.entries(groups)) console.log(`  ${group}: ${count}`);
if (unknown.length) console.error(`Unclassified tests:\n${unknown.map(entry => `  ${entry.file}`).join("\n")}`);
if (process.argv.includes("--output")) {
  const target = process.argv[process.argv.indexOf("--output") + 1];
  if (!target) throw new Error("--output requires a path");
  const absolute = path.resolve(target);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify(report, null, 2) + "\n");
}
process.exit(unknown.length ? 2 : 0);
