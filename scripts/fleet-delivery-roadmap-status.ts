import { readFile } from "node:fs/promises";
import {
  controlledLaunchPlanV1Schema,
  evaluateControlledLaunchV1,
  evaluatePilotReadinessV1,
  pilotReadinessManifestV1Schema,
} from "../packages/fleet-delivery-contracts/src/index.js";
import {
  assertLocalEvidenceExists,
  collectLaunchEvidenceRefs,
  collectPilotEvidenceRefs,
} from "./fleet-delivery-evidence.js";

const pilotManifestUrl = new URL("../docs/delivery/phase-9/readiness-gates.json", import.meta.url);
const launchPlanUrl = new URL("../docs/delivery/phase-10/controlled-launch-plan.json", import.meta.url);

const [pilotRaw, launchRaw] = await Promise.all([
  readFile(pilotManifestUrl, "utf8"),
  readFile(launchPlanUrl, "utf8"),
]);
const pilotManifest = pilotReadinessManifestV1Schema.parse(JSON.parse(pilotRaw));
const launchPlan = controlledLaunchPlanV1Schema.parse(JSON.parse(launchRaw));
const checkedAt = new Date().toISOString();
const pilot = evaluatePilotReadinessV1(pilotManifest);
const launch = evaluateControlledLaunchV1(pilotManifest, launchPlan, checkedAt);
const evidence = await assertLocalEvidenceExists([
  ...collectPilotEvidenceRefs(pilotManifest),
  ...collectLaunchEvidenceRefs(launchPlan),
]);

process.stdout.write(`${JSON.stringify({
  roadmap: "BMS_Delivery_Master_Prompt_v2.4",
  highestDefinedPhase: 17,
  checkedAt,
  overallDecision: launch.decision === "ACTIVE" ? "ACTIVE" : "NO_GO",
  productionEnabled: launchPlan.productionEnabled,
  phase9: pilot,
  phase10: launch,
  evidence,
  note: evidence.externalHttpsCount > 0
    ? "HTTPS evidence references are format-checked but not fetched by this local command"
    : "All referenced evidence is repository-local and exists",
}, null, 2)}\n`);
