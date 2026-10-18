import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  evaluatePilotCertificationWorkbookV1,
  evaluatePilotReadinessV1,
  pilotCertificationWorkbookV1Schema,
  pilotReadinessManifestV1Schema,
} from "../packages/fleet-delivery-contracts/src/index.js";
import {
  assertLocalEvidenceExists,
  collectPilotCertificationRefs,
  collectPilotEvidenceRefs,
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
  const evidence = await assertLocalEvidenceExists(collectPilotEvidenceRefs(manifest));
  const certificationReferences = await assertLocalEvidenceExists(collectPilotCertificationRefs(workbook));
  const result = evaluatePilotReadinessV1(manifest);
  const certification = evaluatePilotCertificationWorkbookV1(manifest, workbook);

  process.stdout.write(`${JSON.stringify({
    phase: manifest.phase,
    evaluatedAt: manifest.evaluatedAt,
    decision: result.decision,
    productionEnabled: manifest.productionEnabled,
    separateProductionAuthorizationRequired: manifest.separateProductionAuthorizationRequired,
    passedGateCount: manifest.gates.length - result.blockedGateIds.length,
    totalGateCount: manifest.gates.length,
    blockedGateIds: result.blockedGateIds,
    evidence,
    certification: {
      aligned: certification.aligned,
      openGateIds: certification.openGateIds,
      problems: certification.problems,
      references: certificationReferences,
    },
  }, null, 2)}\n`);

  if (!certification.aligned
    || (process.argv.includes("--require-pilot-ready") && result.decision !== "PILOT_READY")) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
