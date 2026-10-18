import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  controlledLaunchPlanV1Schema,
  controlledLaunchWorkbookV1Schema,
  evaluateControlledLaunchV1,
  evaluateControlledLaunchWorkbookV1,
  pilotReadinessManifestV1Schema,
} from "../packages/fleet-delivery-contracts/src/index.js";
import {
  assertLocalEvidenceExists,
  collectLaunchEvidenceRefs,
  collectLaunchWorkbookRefs,
  collectPilotEvidenceRefs,
} from "./fleet-delivery-evidence.js";

const pilotManifestUrl = new URL("../docs/delivery/phase-9/readiness-gates.json", import.meta.url);
const launchPlanUrl = new URL("../docs/delivery/phase-10/controlled-launch-plan.json", import.meta.url);
const workbookUrl = new URL("../docs/delivery/phase-10/launch-readiness-workbook.json", import.meta.url);

async function main(): Promise<void> {
  const [pilotRaw, launchRaw, workbookRaw] = await Promise.all([
    readFile(pilotManifestUrl, "utf8"),
    readFile(launchPlanUrl, "utf8"),
    readFile(workbookUrl, "utf8"),
  ]);
  const pilotManifest = pilotReadinessManifestV1Schema.parse(JSON.parse(pilotRaw));
  const launchPlan = controlledLaunchPlanV1Schema.parse(JSON.parse(launchRaw));
  const workbook = controlledLaunchWorkbookV1Schema.parse(JSON.parse(workbookRaw));
  const evidence = await assertLocalEvidenceExists([
    ...collectPilotEvidenceRefs(pilotManifest),
    ...collectLaunchEvidenceRefs(launchPlan),
    ...collectLaunchWorkbookRefs(workbook),
  ]);
  const checkedAt = new Date().toISOString();
  const result = evaluateControlledLaunchV1(pilotManifest, launchPlan, checkedAt);
  const controls = evaluateControlledLaunchWorkbookV1(result.blockers, workbook);

  process.stdout.write(`${JSON.stringify({
    phase: launchPlan.phase,
    planEvaluatedAt: launchPlan.evaluatedAt,
    checkedAt,
    decision: result.decision,
    productionEnabled: launchPlan.productionEnabled,
    authorizationStatus: launchPlan.authorization.status,
    blockers: result.blockers,
    evidence,
    controls,
  }, null, 2)}\n`);

  if (!controls.aligned
    || (process.argv.includes("--require-ready-to-enable") && result.decision !== "READY_TO_ENABLE")) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
