import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { engineeringHandoffManifestV1Schema } from "../packages/fleet-delivery-contracts/src/index.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const manifestUrl = new URL("../docs/delivery/phase-11/handoff-manifest.json", import.meta.url);

const manifest = engineeringHandoffManifestV1Schema.parse(
  JSON.parse(await readFile(manifestUrl, "utf8")),
);
const root = await realpath(repositoryRoot);
const failures: Array<{ path: string; expected: string; actual: string }> = [];

for (const artifact of manifest.artifacts) {
  const candidate = resolve(root, artifact.path);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`handoff artifact escapes repository: ${artifact.path}`);
  }
  const actualPath = await realpath(candidate);
  if (actualPath !== root && !actualPath.startsWith(`${root}${sep}`)) {
    throw new Error(`handoff artifact resolves outside repository: ${artifact.path}`);
  }
  const digest = createHash("sha256").update(await readFile(actualPath)).digest("hex");
  if (digest !== artifact.sha256) {
    failures.push({ path: artifact.path, expected: artifact.sha256, actual: digest });
  }
}

process.stdout.write(`${JSON.stringify({
  phase: manifest.phase,
  mode: manifest.mode,
  generatedAt: manifest.generatedAt,
  productionAuthorized: manifest.productionAuthorized,
  artifactCount: manifest.artifacts.length,
  verified: failures.length === 0,
  failures,
  unresolvedGateRefs: manifest.unresolvedGateRefs,
}, null, 2)}\n`);

if (failures.length > 0) process.exitCode = 2;
