import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  pilotReadinessManifestV1Schema,
  releaseEvidenceRefSchema,
} from "../packages/fleet-delivery-contracts/src/index.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const manifestUrl = new URL("../docs/delivery/phase-9/approval-requests.json", import.meta.url);
const readinessUrl = new URL("../docs/delivery/phase-9/readiness-gates.json", import.meta.url);

const requestSchema = z.object({
  id: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/),
  status: z.literal("READY_TO_SEND"),
  gateIds: z.array(z.string().min(3).max(80).regex(/^[a-z0-9-]+$/)).min(1).max(20),
  recipientRoles: z.array(z.string().min(2).max(120)).min(1).max(20),
  subject: z.string().min(10).max(240),
  packetRef: releaseEvidenceRefSchema,
  requiredOutputs: z.array(z.string().min(10).max(500)).min(1).max(20),
}).strict();

const approvalRequestManifestSchema = z.object({
  schemaVersion: z.literal(1),
  phase: z.literal(9),
  mode: z.literal("APPROVAL_REQUEST_PREPARATION"),
  generatedAt: z.iso.datetime({ offset: true }),
  productionAuthorized: z.literal(false),
  approvalsGrantedByThisManifest: z.literal(false),
  dispatch: z.object({
    status: z.literal("NOT_DISPATCHED"),
    channel: z.literal("GMAIL"),
    draftCount: z.number().int().nonnegative().max(20),
    blockers: z.array(z.string().min(3).max(500)).min(1).max(10),
  }).strict(),
  requests: z.array(requestSchema).min(1).max(20),
}).strict();

const manifest = approvalRequestManifestSchema.parse(JSON.parse(await readFile(manifestUrl, "utf8")));
const readiness = pilotReadinessManifestV1Schema.parse(JSON.parse(await readFile(readinessUrl, "utf8")));
const root = await realpath(repositoryRoot);
const problems: string[] = [];
const requestIds = new Set<string>();
const coveredGateIds = new Set<string>();
const coveredRolesByGate = new Map<string, Set<string>>();
const readinessById = new Map(readiness.gates.map((gate) => [gate.id, gate]));

if (manifest.dispatch.draftCount !== manifest.requests.length) {
  problems.push("draft count must equal approval request count");
}

for (const request of manifest.requests) {
  if (requestIds.has(request.id)) problems.push(`duplicate request id: ${request.id}`);
  requestIds.add(request.id);

  const packetPath = resolve(root, request.packetRef);
  if (packetPath !== root && !packetPath.startsWith(`${root}${sep}`)) {
    problems.push(`packet escapes repository: ${request.packetRef}`);
  } else {
    try {
      const actual = await realpath(packetPath);
      if (actual !== root && !actual.startsWith(`${root}${sep}`)) {
        problems.push(`packet resolves outside repository: ${request.packetRef}`);
      }
    } catch {
      problems.push(`packet does not exist: ${request.packetRef}`);
    }
  }

  for (const gateId of request.gateIds) {
    const gate = readinessById.get(gateId);
    if (!gate) {
      problems.push(`unknown readiness gate: ${gateId}`);
      continue;
    }
    coveredGateIds.add(gateId);
    const coveredRoles = coveredRolesByGate.get(gateId) ?? new Set<string>();
    for (const role of request.recipientRoles) {
      if (gate.ownerRoles.includes(role)) coveredRoles.add(role);
    }
    coveredRolesByGate.set(gateId, coveredRoles);
  }
}

const blockedGates = readiness.gates.filter((gate) => gate.status === "BLOCKED");
for (const gate of blockedGates) {
  if (!coveredGateIds.has(gate.id)) problems.push(`blocked gate has no approval request: ${gate.id}`);
  const roles = coveredRolesByGate.get(gate.id) ?? new Set<string>();
  for (const role of gate.requiredApprovals) {
    if (!roles.has(role)) problems.push(`gate ${gate.id} has no request for required role: ${role}`);
  }
}

const result = {
  phase: manifest.phase,
  mode: manifest.mode,
  generatedAt: manifest.generatedAt,
  dispatchStatus: manifest.dispatch.status,
  dispatchChannel: manifest.dispatch.channel,
  draftCount: manifest.dispatch.draftCount,
  productionAuthorized: manifest.productionAuthorized,
  approvalsGrantedByThisManifest: manifest.approvalsGrantedByThisManifest,
  requestCount: manifest.requests.length,
  coveredBlockedGateCount: [...coveredGateIds].filter((id) => readinessById.get(id)?.status === "BLOCKED").length,
  totalBlockedGateCount: blockedGates.length,
  requiredRoleCount: new Set(blockedGates.flatMap((gate) => gate.requiredApprovals)).size,
  readyToDispatch: problems.length === 0,
  dispatchBlockers: manifest.dispatch.blockers,
  problems,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (problems.length > 0) process.exitCode = 2;
