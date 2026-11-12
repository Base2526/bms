/** Review the evidence for an exact release artifact. Never infers production availability. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Gate = "schema" | "configuration" | "web" | "database" | "browser" | "mobile" | "desktop" | "backupRestore";
const GATES: Gate[] = ["schema", "configuration", "web", "database", "browser", "mobile", "desktop", "backupRestore"];
const REQUIRED_PASS_GATES = new Set<Gate>(["schema", "configuration", "web", "database", "backupRestore"]);
type Evidence = { outcome: "PASS" | "FAIL" | "NOT_APPLICABLE"; reference: string; reason?: string };
type Feature = { id: string; requires: string[] };
type Manifest = { commit: string; dirty: boolean; features: Feature[] };
type Record = {
  schemaVersion: 1;
  commit: string;
  artifactDigest: string;
  target: string;
  gates: Partial<{ [K in Gate]: Evidence }>;
  features: { [id: string]: Evidence };
};

export function assessReleaseEvidence(manifest: Manifest, record: Record) {
  const problems: string[] = [];
  if (!/^[0-9a-f]{40}$/.test(manifest.commit) || manifest.dirty) problems.push("manifest must identify a clean commit");
  if (record.schemaVersion !== 1 || record.commit !== manifest.commit) problems.push("record commit must match manifest commit");
  if (!/^sha256:[0-9a-f]{64}$/.test(record.artifactDigest)) problems.push("artifact SHA-256 digest is missing or invalid");
  if (!record.target?.trim()) problems.push("deployment target is missing");

  const check = (name: string, item: Evidence | undefined) => {
    if (!item || !["PASS", "FAIL", "NOT_APPLICABLE"].includes(item.outcome)) {
      problems.push(`${name}: no outcome`);
      return;
    }
    if (!item.reference?.trim()) problems.push(`${name}: no evidence reference`);
    if (item.outcome === "FAIL") problems.push(`${name}: failed`);
    if (item.outcome === "NOT_APPLICABLE" && !item.reason?.trim()) problems.push(`${name}: not-applicable needs a reason`);
  };
  for (const gate of GATES) {
    const item = record.gates?.[gate];
    check(`gate ${gate}`, item);
    if (item?.outcome === "NOT_APPLICABLE" && REQUIRED_PASS_GATES.has(gate)) {
      problems.push(`gate ${gate}: must pass for a release review`);
    }
  }
  const ids = new Set<string>();
  for (const feature of manifest.features ?? []) {
    if (!feature.id || ids.has(feature.id)) problems.push(`duplicate or invalid feature ID: ${feature.id}`);
    ids.add(feature.id);
    check(`feature ${feature.id}`, record.features?.[feature.id]);
  }
  for (const id of Object.keys(record.features ?? {})) {
    if (!ids.has(id)) problems.push(`unknown feature ID: ${id}`);
  }
  return {
    status: problems.length ? "INCOMPLETE" as const : "EVIDENCE_SUBMITTED_FOR_REVIEW" as const,
    commit: manifest.commit,
    target: record.target ?? "",
    featureCount: ids.size,
    problems,
    note: "References and outcomes are self-reported. Review their authenticity and target scope before rollout.",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const templateMode = args.length === 4 && args[0] === "--manifest" && args[2] === "--template";
  const checkMode = args.length === 6 && args[0] === "--manifest" && args[2] === "--record" && args[4] === "--output";
  if (!templateMode && !checkMode) {
    console.error("Usage: release-evidence-check.mts --manifest <release-features.json> --template <evidence.json>\n  or: release-evidence-check.mts --manifest <release-features.json> --record <evidence.json> --output <report.json>");
    process.exit(2);
  }
  try {
    const manifest = JSON.parse(readFileSync(resolve(args[1]), "utf8")) as Manifest;
    if (templateMode) {
      const empty = () => ({ outcome: "", reference: "", reason: "" });
      const template = {
        schemaVersion: 1,
        commit: manifest.commit,
        artifactDigest: "",
        target: "",
        gates: Object.fromEntries(GATES.map((gate) => [gate, empty()])),
        features: Object.fromEntries((manifest.features ?? []).map((feature) => [feature.id, empty()])),
      };
      writeFileSync(resolve(args[3]), JSON.stringify(template, null, 2) + "\n");
      console.log(`Created blank evidence form for ${manifest.features.length} known features; no outcomes have been verified.`);
      process.exit(0);
    }
    const record = JSON.parse(readFileSync(resolve(args[3]), "utf8")) as Record;
    const report = assessReleaseEvidence(manifest, record);
    writeFileSync(resolve(args[5]), JSON.stringify(report, null, 2) + "\n");
    console.log(`${report.status}: ${report.problems.length} missing or failed evidence items`);
    for (const problem of report.problems) console.log(`- ${problem}`);
    process.exitCode = report.problems.length ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
