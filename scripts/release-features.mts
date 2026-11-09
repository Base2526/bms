// Release inventory is read-only. It describes code at HEAD, never tenant enablement.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_CAPABILITIES } from "../apps/web/lib/bms/assistantKnowledge/capabilities";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "scripts/release-feature-registry.json");
const allowedStatuses = new Set(["AVAILABLE", "CONDITIONAL", "BETA", "MOCK", "PILOT", "WIP"]);
type Feature = {
  id: string; title: string; status: string; source: string;
  tests: string[]; requires: string[];
};
type Registry = { schemaVersion: number; scope: string; notes: string; maxUnmappedTests: number; features: Feature[] };

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
const check = args.includes("--check");
const output = option("--output");
const version = option("--version");
const previous = option("--previous");
const allowDirty = args.includes("--allow-dirty");
const known = new Set(["--check", "--output", "--version", "--previous", "--allow-dirty"]);
for (let i = 0; i < args.length; i++) {
  if (!known.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
  if (["--output", "--version", "--previous"].includes(args[i])) i++;
}
if (check && (output || version || previous || allowDirty)) throw new Error("--check takes no other options");
if (!check && (!output || !version)) throw new Error("Use --check or --version <id> --output <directory>");
if (version && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(version)) throw new Error("Invalid release version");

const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Registry;
if (registry.schemaVersion !== 1 || registry.scope !== "baseline-in-progress" ||
  !Number.isSafeInteger(registry.maxUnmappedTests) || registry.maxUnmappedTests < 0 || !Array.isArray(registry.features)) {
  throw new Error("Unsupported release feature registry");
}
const safeRepoPath = (value: string) => {
  if (!value || path.isAbsolute(value) || value.includes("\\") || value.split("/").includes("..")) {
    throw new Error(`Unsafe repository path: ${value}`);
  }
  const resolved = path.resolve(root, value);
  if (!resolved.startsWith(root + path.sep) || !existsSync(resolved)) throw new Error(`Missing repository path: ${value}`);
  return value;
};
const features: Feature[] = SYSTEM_CAPABILITIES.map(capability => ({
  id: capability.id,
  title: capability.title.en,
  status: capability.status,
  source: "apps/web/lib/bms/assistantKnowledge/capabilities.ts",
  tests: [], // A catalog contract is not proof of each business operation.
  requires: [...capability.configurationDependencies],
}));
features.push(...registry.features);
const ids = new Set<string>();
for (const feature of features) {
  if (!/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(feature.id) || ids.has(feature.id)) {
    throw new Error(`Invalid or duplicate feature ID: ${feature.id}`);
  }
  ids.add(feature.id);
  if (!feature.title.trim() || !allowedStatuses.has(feature.status)) throw new Error(`Invalid feature: ${feature.id}`);
  safeRepoPath(feature.source);
  if (!Array.isArray(feature.tests) || !Array.isArray(feature.requires)) throw new Error(`Invalid evidence: ${feature.id}`);
  for (const test of feature.tests) {
    safeRepoPath(test);
    if (!/\.test\.(mts|mjs|ts|tsx)$/.test(test)) throw new Error(`Not a test file: ${test}`);
  }
}
features.sort((a, b) => a.id.localeCompare(b.id));
const unmappedTests = features.filter(feature => feature.tests.length === 0).map(feature => feature.id);
if (unmappedTests.length > registry.maxUnmappedTests) {
  throw new Error(`Feature-level test-link debt increased from ${registry.maxUnmappedTests} to ${unmappedTests.length}; add evidence before expanding the baseline`);
}
const git = (...command: string[]) => execFileSync("git", command, { cwd: root, encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const dirty = Boolean(git("status", "--porcelain"));
const catalogHash = createHash("sha256").update(JSON.stringify(features)).digest("hex");
console.log(`Registry: ${features.length} known features; ${unmappedTests.length} without feature-level test links; scope=${registry.scope}`);
console.log(`Commit: ${commit}${dirty ? " (working tree has changes)" : ""}`);
if (check) process.exit(0);
if (dirty && !allowDirty) throw new Error("Release manifest requires a clean working tree; use --allow-dirty only for a local draft");

type Previous = { features: Feature[] };
let changes: { added: string[]; changed: string[]; removed: string[] } | null = null;
if (previous) {
  const prior = JSON.parse(readFileSync(path.resolve(previous), "utf8")) as Previous;
  if (!Array.isArray(prior.features)) throw new Error("Previous manifest has no features array");
  const before = new Map(prior.features.map(feature => [feature.id, feature]));
  const after = new Map(features.map(feature => [feature.id, feature]));
  changes = {
    added: features.filter(feature => !before.has(feature.id)).map(feature => feature.id),
    changed: features.filter(feature => before.has(feature.id) && JSON.stringify(before.get(feature.id)) !== JSON.stringify(feature)).map(feature => feature.id),
    removed: prior.features.filter(feature => !after.has(feature.id)).map(feature => feature.id),
  };
}
const manifest = {
  schemaVersion: 1,
  version,
  commit,
  dirty,
  generatedAt: new Date().toISOString(),
  catalogHash,
  scope: registry.scope,
  notes: registry.notes,
  featureCount: features.length,
  unmappedTests,
  changes,
  features,
};
const lines = [
  `# BMS release ${version}`,
  "",
  `Commit: \`${commit}\`${dirty ? " (local draft; working tree has changes)" : ""}`,
  `Scope: **${registry.scope}**. ${registry.notes}`,
  "",
  `Known features: ${features.length}. Feature-level test links missing: ${unmappedTests.length}.`,
  "A test link is evidence of a suite, not a claim that the feature passed in this release.",
  "Production availability additionally depends on the deployed artifact, target migrations, configuration, plan, tenant permissions and rollout evidence.",
  "",
  ...(changes ? ["## Changes from previous manifest", "", ...(["added", "changed", "removed"] as const).map(kind => `- ${kind}: ${changes[kind].length ? changes[kind].join(", ") : "none"}`), ""] : []),
  "## Known features", "",
  "| ID | Feature | Code status | Test links | Requirements |", "| --- | --- | --- | ---: | --- |",
  ...features.map(feature => `| ${feature.id} | ${feature.title.replaceAll("|", "\\|")} | ${feature.status} | ${feature.tests.length} | ${feature.requires.join("; ").replaceAll("|", "\\|")} |`),
  "",
];
const outputDir = path.resolve(output!);
mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, "release-features.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(path.join(outputDir, "release-features.md"), lines.join("\n"));
console.log(`Wrote ${path.join(outputDir, "release-features.json")} and release-features.md`);
