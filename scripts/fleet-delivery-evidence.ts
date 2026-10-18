import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ControlledLaunchPlanV1,
  ControlledLaunchWorkbookV1,
  PilotCertificationWorkbookV1,
  PilotReadinessManifestV1,
} from "../packages/fleet-delivery-contracts/src/index.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export function collectPilotEvidenceRefs(manifest: PilotReadinessManifestV1): string[] {
  return manifest.gates.flatMap((gate) => [
    ...gate.evidence,
    ...gate.approvals.map((approval) => approval.evidenceRef),
  ]);
}

export function collectPilotCertificationRefs(workbook: PilotCertificationWorkbookV1): string[] {
  return workbook.items.flatMap((item) => [item.planRef, ...item.evidenceRefs]);
}

export function collectLaunchEvidenceRefs(plan: ControlledLaunchPlanV1): string[] {
  return [
    plan.phase9ManifestRef,
    ...(plan.authorization.status === "GRANTED" ? [plan.authorization.evidenceRef] : []),
    ...(plan.monitoring.sloRef === null ? [] : [plan.monitoring.sloRef]),
    ...(plan.rollback.runbookRef === null ? [] : [plan.rollback.runbookRef]),
  ];
}

export function collectLaunchWorkbookRefs(workbook: ControlledLaunchWorkbookV1): string[] {
  return [
    workbook.operatorChecklistRef,
    workbook.stageGateTemplateRef,
    ...workbook.items.flatMap((item) => [item.planRef, ...item.evidenceRefs]),
  ];
}

export async function assertLocalEvidenceExists(refs: string[]): Promise<{
  localCount: number;
  externalHttpsCount: number;
}> {
  const root = await realpath(repositoryRoot);
  const uniqueRefs = [...new Set(refs)];
  let localCount = 0;
  let externalHttpsCount = 0;

  for (const ref of uniqueRefs) {
    if (ref.startsWith("https://")) {
      externalHttpsCount += 1;
      continue;
    }
    const candidate = resolve(root, ref);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      throw new Error(`evidence reference escapes repository: ${ref}`);
    }
    const actual = await realpath(candidate);
    if (actual !== root && !actual.startsWith(`${root}${sep}`)) {
      throw new Error(`evidence reference resolves outside repository: ${ref}`);
    }
    localCount += 1;
  }

  return { localCount, externalHttpsCount };
}
