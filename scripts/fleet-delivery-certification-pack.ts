import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  evaluatePilotCertificationWorkbookV1,
  pilotCertificationWorkbookV1Schema,
  pilotReadinessManifestV1Schema,
} from "../packages/fleet-delivery-contracts/src/index.js";
import {
  assertLocalEvidenceExists,
  collectPilotCertificationRefs,
} from "./fleet-delivery-evidence.js";

const manifestUrl = new URL("../docs/delivery/phase-9/readiness-gates.json", import.meta.url);
const workbookUrl = new URL("../docs/delivery/phase-9/certification-workbook.json", import.meta.url);

async function main(): Promise<void> {
  const [manifestRaw, workbookRaw] = await Promise.all([
    readFile(manifestUrl, "utf8"),
    readFile(workbookUrl, "utf8"),
  ]);
  const manifest = pilotReadinessManifestV1Schema.parse(JSON.parse(manifestRaw));
  const workbook = pilotCertificationWorkbookV1Schema.parse(JSON.parse(workbookRaw));
  const result = evaluatePilotCertificationWorkbookV1(manifest, workbook);
  const references = await assertLocalEvidenceExists(collectPilotCertificationRefs(workbook));
  const exerciseCount = workbook.items.reduce((count, item) => count + item.requiredExercises.length, 0);
  const artifactCount = workbook.items.reduce((count, item) => count + item.requiredArtifacts.length, 0);

  process.stdout.write(`${JSON.stringify({
    phase: workbook.phase,
    mode: workbook.mode,
    productionAuthorized: workbook.productionAuthorized,
    gateCount: workbook.items.length,
    completeGateCount: workbook.items.length - result.openGateIds.length,
    openGateIds: result.openGateIds,
    requiredArtifactCount: artifactCount,
    requiredExerciseCount: exerciseCount,
    references,
    aligned: result.aligned,
    problems: result.problems,
  }, null, 2)}\n`);

  if (!result.aligned) process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
