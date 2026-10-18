import assert from "node:assert/strict";
import test from "node:test";
import {
  decimalThbToSatang,
  controlledLaunchPlanV1Schema,
  controlledLaunchWorkbookV1Schema,
  configurationContractV1Schema,
  apiRouteInventoryV1Schema,
  dependencyLicensePolicyV1Schema,
  dispatchPolicyV1Schema,
  driverCurrentAssignmentV1Schema,
  driverOfferFeedV1Schema,
  driverSnapshotV1Schema,
  FINANCE_CAPABILITIES_V1,
  evaluatePilotCertificationWorkbookV1,
  evaluatePilotReadinessV1,
  evaluateControlledLaunchV1,
  evaluateControlledLaunchWorkbookV1,
  engineeringHandoffManifestV1Schema,
  financeCapabilitiesV1Schema,
  integrationEnvelopeV1Schema,
  merchantConfigurationV1Schema,
  orderContextPayloadV1Schema,
  orderContextEnvelopeV1Schema,
  operationsDeliveryFeedV1Schema,
  operationsOverviewV1Schema,
  pilotCertificationWorkbookV1Schema,
  pilotReadinessManifestV1Schema,
  reconciliationIssueFeedV1Schema,
  releaseEvidenceRefSchema,
  reproducibleBuildPolicyV1Schema,
  satangToDecimalThb,
  supplyChainPolicyV1Schema,
  secretScanPolicyV1Schema,
} from "./index.js";

test("release evidence references reject traversal and unverifiable schemes", () => {
  assert.equal(releaseEvidenceRefSchema.parse("docs/delivery/phase-10/README.md"),
    "docs/delivery/phase-10/README.md");
  assert.equal(releaseEvidenceRefSchema.parse("package.json"), "package.json");
  assert.equal(releaseEvidenceRefSchema.parse("https://evidence.example.test/review/123"),
    "https://evidence.example.test/review/123");
  for (const value of [
    "/tmp/evidence.md",
    "../evidence.md",
    "docs/../private.md",
    "docs//evidence.md",
    "http://evidence.example.test/review/123",
    "approval:pilot-ready",
  ]) {
    assert.throws(() => releaseEvidenceRefSchema.parse(value));
  }
});

test("phase 11 engineering handoff is local, unique and never production authorization", () => {
  const manifest = {
    schemaVersion: 1,
    phase: 11,
    mode: "ENGINEERING_HANDOFF",
    generatedAt: "2026-10-18T00:00:00.000Z",
    productionAuthorized: false,
    artifacts: [{
      path: "docs/delivery/phase-10/README.md",
      sha256: "a".repeat(64),
      purpose: "Phase 10 boundary",
    }],
    unresolvedGateRefs: ["docs/delivery/phase-9/readiness-gates.json"],
    verificationCommands: ["npm run handoff:verify"],
  } as const;

  assert.equal(engineeringHandoffManifestV1Schema.parse(manifest).phase, 11);
  assert.throws(() => engineeringHandoffManifestV1Schema.parse({
    ...manifest,
    productionAuthorized: true,
  }));
  assert.throws(() => engineeringHandoffManifestV1Schema.parse({
    ...manifest,
    artifacts: [{ ...manifest.artifacts[0], path: "https://evidence.example.test/file" }],
  }));
  assert.throws(() => engineeringHandoffManifestV1Schema.parse({
    ...manifest,
    artifacts: [manifest.artifacts[0], manifest.artifacts[0]],
  }));
});

test("phase 12 supply-chain policy is exact, HTTPS-only and non-production", () => {
  const policy = {
    schemaVersion: 1,
    phase: 12,
    mode: "SUPPLY_CHAIN_VERIFICATION",
    productionAuthorized: false,
    lockfileVersion: 3,
    allowedRegistryPrefixes: ["https://registry.npmjs.org/"],
    requireExactDirectVersions: true,
    requireSha512Integrity: true,
    auditLevel: "high",
    allowedInstallScripts: [{
      package: "esbuild",
      version: "0.25.12",
      reason: "Downloads the platform-specific compiler binary",
    }],
  } as const;

  assert.equal(supplyChainPolicyV1Schema.parse(policy).phase, 12);
  assert.throws(() => supplyChainPolicyV1Schema.parse({
    ...policy,
    productionAuthorized: true,
  }));
  assert.throws(() => supplyChainPolicyV1Schema.parse({
    ...policy,
    allowedRegistryPrefixes: ["http://registry.npmjs.org/"],
  }));
  assert.throws(() => supplyChainPolicyV1Schema.parse({
    ...policy,
    allowedInstallScripts: [policy.allowedInstallScripts[0], policy.allowedInstallScripts[0]],
  }));
});

test("phase 13 secret-scan policy is bounded, unique and non-production", () => {
  const policy = {
    schemaVersion: 1,
    phase: 13,
    mode: "SECRET_HYGIENE",
    productionAuthorized: false,
    roots: ["apps/fleet-delivery-api"],
    excludedDirectories: ["node_modules", "dist"],
    allowedExtensions: [".ts", ".json"],
    allowedFileNames: ["Dockerfile"],
    maximumFileBytes: 1_000_000,
    rules: ["pem-private-key", "github-token"],
    exceptions: [],
  } as const;

  assert.equal(secretScanPolicyV1Schema.parse(policy).phase, 13);
  assert.throws(() => secretScanPolicyV1Schema.parse({ ...policy, productionAuthorized: true }));
  assert.throws(() => secretScanPolicyV1Schema.parse({ ...policy, roots: ["../outside"] }));
  assert.throws(() => secretScanPolicyV1Schema.parse({
    ...policy,
    rules: ["github-token", "github-token"],
  }));
});

test("phase 14 dependency-license policy is lock-bound and non-production", () => {
  const policy = {
    schemaVersion: 1,
    phase: 14,
    mode: "DEPENDENCY_LICENSE_VERIFICATION",
    productionAuthorized: false,
    lockfileVersion: 3,
    packageLockSha256: "a".repeat(64),
    allowedLicenses: ["MIT", "Apache-2.0"],
    deniedLicenseTokens: ["AGPL", "SSPL"],
    workspacePathPrefixes: ["apps/fleet-delivery-", "packages/fleet-delivery-"],
    allowMissingLicenseForWorkspacePackages: true,
  } as const;

  assert.equal(dependencyLicensePolicyV1Schema.parse(policy).phase, 14);
  assert.throws(() => dependencyLicensePolicyV1Schema.parse({ ...policy, productionAuthorized: true }));
  assert.throws(() => dependencyLicensePolicyV1Schema.parse({
    ...policy,
    allowedLicenses: ["MIT", "MIT"],
  }));
});

test("phase 15 reproducible-build policy fixes command, iterations and output set", () => {
  const policy = {
    schemaVersion: 1,
    phase: 15,
    mode: "REPRODUCIBLE_BUILD_VERIFICATION",
    productionAuthorized: false,
    buildCommand: "npm run build",
    iterations: 2,
    artifacts: ["dist/fleet-delivery-api/main.js"],
    hashAlgorithm: "sha256",
  } as const;

  assert.equal(reproducibleBuildPolicyV1Schema.parse(policy).iterations, 2);
  assert.throws(() => reproducibleBuildPolicyV1Schema.parse({ ...policy, productionAuthorized: true }));
  assert.throws(() => reproducibleBuildPolicyV1Schema.parse({
    ...policy,
    artifacts: ["apps/fleet-delivery-api/src/main.ts"],
  }));
  assert.throws(() => reproducibleBuildPolicyV1Schema.parse({
    ...policy,
    artifacts: [policy.artifacts[0], policy.artifacts[0]],
  }));
});

test("phase 16 configuration contract is complete, unique and non-production", () => {
  const contract = {
    schemaVersion: 1,
    phase: 16,
    mode: "CONFIGURATION_CONTRACT",
    productionAuthorized: false,
    variables: ["FLEET_DELIVERY_DATABASE_URL", "FLEET_DELIVERY_API_PORT"],
    secretVariables: ["FLEET_DELIVERY_DATABASE_URL"],
    productionRequiredVariables: ["FLEET_DELIVERY_DATABASE_URL"],
    composeRequiredVariables: ["FLEET_DELIVERY_DATABASE_URL", "FLEET_DELIVERY_API_PORT"],
  } as const;

  assert.equal(configurationContractV1Schema.parse(contract).phase, 16);
  assert.throws(() => configurationContractV1Schema.parse({ ...contract, productionAuthorized: true }));
  assert.throws(() => configurationContractV1Schema.parse({
    ...contract,
    secretVariables: ["FLEET_DELIVERY_UNKNOWN_SECRET"],
  }));
  assert.throws(() => configurationContractV1Schema.parse({
    ...contract,
    variables: ["FLEET_DELIVERY_API_PORT", "FLEET_DELIVERY_API_PORT"],
  }));
});

test("phase 17 API inventory separates public health from scoped service routes", () => {
  const inventory = {
    schemaVersion: 1,
    phase: 17,
    mode: "API_AUTHORIZATION_CONTRACT",
    productionAuthorized: false,
    routes: [
      {
        id: "liveness",
        method: "GET",
        pathTemplate: "/livez",
        matcher: { type: "STATIC", literal: "/livez" },
        access: "PUBLIC_HEALTH",
        scope: null,
        idempotencyRequired: false,
      },
      {
        id: "quote-create",
        method: "POST",
        pathTemplate: "/v1/quotes",
        matcher: { type: "STATIC", literal: "/v1/quotes" },
        access: "SERVICE",
        scope: "quotes.create",
        idempotencyRequired: true,
      },
    ],
  } as const;

  assert.equal(apiRouteInventoryV1Schema.parse(inventory).routes.length, 2);
  assert.throws(() => apiRouteInventoryV1Schema.parse({ ...inventory, productionAuthorized: true }));
  assert.throws(() => apiRouteInventoryV1Schema.parse({
    ...inventory,
    routes: [{ ...inventory.routes[1], scope: null }],
  }));
  assert.throws(() => apiRouteInventoryV1Schema.parse({
    ...inventory,
    routes: [inventory.routes[0], inventory.routes[0]],
  }));
});

test("phase 10 launch control remains blocked by phase 9 and missing authorization", () => {
  const pilotManifest = pilotReadinessManifestV1Schema.parse({
    schemaVersion: 1,
    phase: 9,
    mode: "PILOT_CERTIFICATION",
    evaluatedAt: "2026-10-18T00:00:00.000Z",
    productionEnabled: false,
    separateProductionAuthorizationRequired: true,
    gates: [{
      id: "security-review",
      title: "Independent security review",
      status: "BLOCKED",
      ownerRoles: ["Security"],
      requiredApprovals: ["Security"],
      evidence: [],
      blockers: ["Independent review has not occurred"],
      approvals: [],
    }],
  });
  const launchPlan = controlledLaunchPlanV1Schema.parse({
    schemaVersion: 1,
    phase: 10,
    mode: "CONTROLLED_PRODUCTION_LAUNCH",
    evaluatedAt: "2026-10-18T00:00:00.000Z",
    productionEnabled: false,
    separateProductionAuthorizationRequired: true,
    phase9ManifestRef: "docs/delivery/phase-9/readiness-gates.json",
    authorization: { status: "NOT_GRANTED", blockers: ["Phase 9 is NO_GO"] },
    target: { tenantRefs: [], branchRefs: [], capabilities: [] },
    window: { startsAt: null, endsAt: null },
    monitoring: { sloRef: null, thresholds: [] },
    rollback: { authorityRole: null, runbookRef: null, triggers: [] },
    stages: [],
  });

  assert.deepEqual(evaluateControlledLaunchV1(
    pilotManifest,
    launchPlan,
    "2026-10-18T00:00:00.000Z",
  ), {
    decision: "NO_GO",
    blockers: [
      "PHASE_9_NOT_PILOT_READY",
      "PRODUCTION_AUTHORIZATION_NOT_GRANTED",
      "TENANT_COHORT_NOT_DEFINED",
      "BRANCH_COHORT_NOT_DEFINED",
      "CAPABILITY_SET_NOT_DEFINED",
      "LAUNCH_WINDOW_NOT_DEFINED",
      "MONITORING_GATES_NOT_DEFINED",
      "ROLLBACK_CONTROL_NOT_DEFINED",
      "ROLLOUT_STAGES_NOT_DEFINED",
    ],
  });
  assert.throws(() => controlledLaunchPlanV1Schema.parse({
    ...launchPlan,
    productionEnabled: true,
  }));
});

test("phase 10 launch workbook mirrors every live control blocker without granting authority", () => {
  const controlIds = [
    "phase9-readiness",
    "production-authorization",
    "tenant-cohort",
    "branch-cohort",
    "capability-set",
    "launch-window",
    "monitoring-gates",
    "rollback-control",
    "rollout-stages",
  ] as const;
  const workbook = controlledLaunchWorkbookV1Schema.parse({
    schemaVersion: 1,
    phase: 10,
    mode: "CONTROLLED_LAUNCH_WORKBOOK",
    generatedAt: "2026-10-18T00:00:00.000Z",
    productionAuthorized: false,
    operatorChecklistRef: "docs/delivery/phase-10/operator-checklist.md",
    stageGateTemplateRef: "docs/delivery/phase-10/stage-gates-and-rollback.md",
    items: controlIds.map((controlId) => ({
      controlId,
      status: "OPEN",
      ownerRoles: ["Release Authority"],
      planRef: "docs/delivery/phase-10/operator-checklist.md",
      acceptanceCriteria: ["The authorized owner records durable evidence for this launch control"],
      evidenceRefs: [],
      openActions: ["The authorized owner must complete this launch control"],
    })),
  });
  const blockers = [
    "PHASE_9_NOT_PILOT_READY",
    "PRODUCTION_AUTHORIZATION_NOT_GRANTED",
    "TENANT_COHORT_NOT_DEFINED",
    "BRANCH_COHORT_NOT_DEFINED",
    "CAPABILITY_SET_NOT_DEFINED",
    "LAUNCH_WINDOW_NOT_DEFINED",
    "MONITORING_GATES_NOT_DEFINED",
    "ROLLBACK_CONTROL_NOT_DEFINED",
    "ROLLOUT_STAGES_NOT_DEFINED",
  ] as const;

  assert.deepEqual(evaluateControlledLaunchWorkbookV1([...blockers], workbook), {
    aligned: true,
    openControlIds: [...controlIds],
    problems: [],
  });
  assert.throws(() => controlledLaunchWorkbookV1Schema.parse({
    ...workbook,
    productionAuthorized: true,
  }));
  assert.deepEqual(evaluateControlledLaunchWorkbookV1([...blockers], {
    ...workbook,
    items: workbook.items.map((item) => item.controlId === "production-authorization"
      ? { ...item, status: "COMPLETE", evidenceRefs: ["docs/delivery/phase-10/README.md"], openActions: [] }
      : item),
  }).problems, ["BLOCKED_CONTROL_NOT_OPEN:production-authorization"]);
});

test("phase 10 rejects expired authorization and an inactive launch window", () => {
  const pilotManifest = pilotReadinessManifestV1Schema.parse({
    schemaVersion: 1,
    phase: 9,
    mode: "PILOT_CERTIFICATION",
    evaluatedAt: "2026-10-17T00:00:00.000Z",
    productionEnabled: false,
    separateProductionAuthorizationRequired: true,
    gates: [{
      id: "all-certification-gates",
      title: "All certification gates",
      status: "PASS",
      ownerRoles: ["Release Authority"],
      requiredApprovals: ["Release Authority"],
      evidence: ["docs/delivery/phase-9/README.md"],
      blockers: [],
      approvals: [{
        role: "Release Authority",
        approvedBy: "authorized-reviewer",
        approvedAt: "2026-10-17T00:00:00.000Z",
        evidenceRef: "docs/delivery/phase-9/README.md",
      }],
    }],
  });
  const launchPlan = controlledLaunchPlanV1Schema.parse({
    schemaVersion: 1,
    phase: 10,
    mode: "CONTROLLED_PRODUCTION_LAUNCH",
    evaluatedAt: "2026-10-17T00:00:00.000Z",
    productionEnabled: false,
    separateProductionAuthorizationRequired: true,
    phase9ManifestRef: "docs/delivery/phase-9/readiness-gates.json",
    authorization: {
      status: "GRANTED",
      authorizedBy: "authorized-reviewer",
      authorityRole: "Release Authority",
      approvedAt: "2026-10-17T00:00:00.000Z",
      expiresAt: "2026-10-18T00:00:00.000Z",
      evidenceRef: "docs/delivery/phase-10/README.md",
    },
    target: {
      tenantRefs: ["tenant:pilot"],
      branchRefs: ["branch:pilot"],
      capabilities: ["delivery.observe"],
    },
    window: {
      startsAt: "2026-10-17T00:00:00.000Z",
      endsAt: "2026-10-18T00:00:00.000Z",
    },
    monitoring: {
      sloRef: "docs/delivery/phase-10/README.md",
      thresholds: [{
        metric: "error_rate",
        operator: "GTE",
        value: 0.01,
        action: "PAUSE_AND_EVALUATE_ROLLBACK",
      }],
    },
    rollback: {
      authorityRole: "Incident Commander",
      runbookRef: "docs/delivery/phase-8/release-and-recovery-runbook.md",
      triggers: ["Error-rate threshold breached"],
    },
    stages: [{ id: "pilot-one", status: "PLANNED", percentage: 1, minimumObservationMinutes: 60 }],
  });

  assert.deepEqual(evaluateControlledLaunchV1(
    pilotManifest,
    launchPlan,
    "2026-10-18T00:00:00.000Z",
  ), {
    decision: "NO_GO",
    blockers: ["PRODUCTION_AUTHORIZATION_NOT_CURRENT", "LAUNCH_WINDOW_NOT_ACTIVE"],
  });
});

test("phase 9 pilot readiness is fail-closed and cannot imply production authorization", () => {
  const blockedManifest = {
    schemaVersion: 1,
    phase: 9,
    mode: "PILOT_CERTIFICATION",
    evaluatedAt: "2026-10-18T00:00:00.000Z",
    productionEnabled: false,
    separateProductionAuthorizationRequired: true,
    gates: [{
      id: "security-review",
      title: "Independent security review",
      status: "BLOCKED",
      ownerRoles: ["Security"],
      requiredApprovals: ["Security"],
      evidence: [],
      blockers: ["Independent review has not occurred"],
      approvals: [],
    }],
  } as const;

  const parsed = pilotReadinessManifestV1Schema.parse(blockedManifest);
  assert.deepEqual(evaluatePilotReadinessV1(parsed), {
    decision: "NO_GO",
    blockedGateIds: ["security-review"],
  });
  assert.throws(() => pilotReadinessManifestV1Schema.parse({
    ...blockedManifest,
    productionEnabled: true,
  }));
  assert.throws(() => pilotReadinessManifestV1Schema.parse({
    ...blockedManifest,
    gates: [{ ...blockedManifest.gates[0], status: "PASS", blockers: [] }],
  }));
  assert.throws(() => pilotReadinessManifestV1Schema.parse({
    ...blockedManifest,
    gates: [{
      ...blockedManifest.gates[0],
      status: "PASS",
      blockers: [],
      evidence: ["docs/delivery/phase-9/evidence/security-review.md"],
    }],
  }));
});

test("phase 9 certification workbook covers gates without manufacturing accepted evidence", () => {
  const manifest = pilotReadinessManifestV1Schema.parse({
    schemaVersion: 1,
    phase: 9,
    mode: "PILOT_CERTIFICATION",
    evaluatedAt: "2026-10-18T00:00:00.000Z",
    productionEnabled: false,
    separateProductionAuthorizationRequired: true,
    gates: [{
      id: "security-review",
      title: "Independent security review",
      status: "BLOCKED",
      ownerRoles: ["Security"],
      requiredApprovals: ["Security"],
      evidence: [],
      blockers: ["Independent review has not occurred"],
      approvals: [],
    }],
  });
  const workbook = pilotCertificationWorkbookV1Schema.parse({
    schemaVersion: 1,
    phase: 9,
    mode: "PILOT_CERTIFICATION_WORKBOOK",
    generatedAt: "2026-10-18T00:00:00.000Z",
    productionAuthorized: false,
    items: [{
      gateId: "security-review",
      planRef: "docs/delivery/phase-9/evidence/independent-security-review.md",
      status: "OPEN",
      requiredArtifacts: [{
        id: "review-report",
        description: "Independent security review and remediation report",
        acceptanceCriteria: ["Every high-severity finding is remediated or explicitly accepted"],
      }],
      requiredExercises: [{
        id: "abuse-exercise",
        description: "Exercise authorization and replay-abuse boundaries",
        environment: "NON_PRODUCTION",
        acceptanceCriteria: ["Cross-tenant and replay attempts are denied and recorded"],
      }],
      evidenceRefs: [],
      openActions: ["Security must perform the independent review"],
    }],
  });

  assert.deepEqual(evaluatePilotCertificationWorkbookV1(manifest, workbook), {
    aligned: true,
    openGateIds: ["security-review"],
    problems: [],
  });
  assert.throws(() => pilotCertificationWorkbookV1Schema.parse({
    ...workbook,
    items: [{ ...workbook.items[0]!, status: "COMPLETE", openActions: [], evidenceRefs: [] }],
  }));
  assert.deepEqual(evaluatePilotCertificationWorkbookV1(manifest, {
    ...workbook,
    items: [{
      ...workbook.items[0]!,
      status: "COMPLETE",
      evidenceRefs: ["docs/delivery/phase-9/README.md"],
      openActions: [],
    }],
  }).problems, [
    "BLOCKED_GATE_WORKBOOK_NOT_OPEN:security-review",
    "WORKBOOK_EVIDENCE_NOT_IN_GATE:security-review:docs/delivery/phase-9/README.md",
  ]);
});

test("phase 7 operations read models are bounded and privacy-minimal", () => {
  const overview = {
    serverNow: "2026-10-18T00:00:00.000Z",
    deliveryCounts: [{ state: "AT_PICKUP", count: 2 }],
    openManualDispatchCount: 1,
    actionRequiredIntegrationCount: 3,
    lastDeliveryUpdatedAt: "2026-10-18T00:00:00.000Z",
  };
  assert.equal(operationsOverviewV1Schema.parse(overview).openManualDispatchCount, 1);
  assert.throws(() => operationsOverviewV1Schema.parse({ ...overview, grossAmountSatang: 100 }));

  const delivery = {
    deliveryId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
    bmsOrderRef: "order:test-1",
    state: "AT_PICKUP",
    version: 8,
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
  };
  assert.equal(operationsDeliveryFeedV1Schema.parse({
    serverNow: overview.serverNow,
    deliveries: [delivery],
    nextCursor: null,
  }).deliveries.length, 1);
  assert.throws(() => operationsDeliveryFeedV1Schema.parse({
    serverNow: overview.serverNow,
    deliveries: [{ ...delivery, customerPhone: "0800000000" }],
    nextCursor: null,
  }));
  assert.throws(() => operationsDeliveryFeedV1Schema.parse({
    serverNow: overview.serverNow,
    deliveries: Array.from({ length: 101 }, () => delivery),
    nextCursor: null,
  }));
});

test("phase 6 finance capability contract is fail-closed", () => {
  assert.deepEqual(financeCapabilitiesV1Schema.parse(FINANCE_CAPABILITIES_V1), FINANCE_CAPABILITIES_V1);
  assert.throws(() => financeCapabilitiesV1Schema.parse({
    ...FINANCE_CAPABILITIES_V1,
    realMoneyEnabled: true,
  }));
  assert.throws(() => financeCapabilitiesV1Schema.parse({
    ...FINANCE_CAPABILITIES_V1,
    capabilities: { ...FINANCE_CAPABILITIES_V1.capabilities, codCollection: true },
  }));
  assert.throws(() => financeCapabilitiesV1Schema.parse({
    ...FINANCE_CAPABILITIES_V1,
    bankAccount: "private",
  }));
});

test("exact THB conversion rejects non-canonical and fractional satang values", () => {
  assert.equal(decimalThbToSatang("10.05"), 1005);
  assert.equal(satangToDecimalThb(1005), "10.05");
  for (const value of ["10", "10.5", "01.00", "1e2", "-1.00", "0.001"]) {
    assert.throws(() => decimalThbToSatang(value));
  }
  assert.throws(() => satangToDecimalThb(1.5));
});

test("phase 2 merchant hours and eligibility evidence reject ambiguous shapes", () => {
  const configuration = {
    tenantRef: "tenant:test-a",
    branchRef: "branch:main",
    version: 1,
    enabled: true,
    timezone: "Asia/Bangkok",
    readinessPolicy: "EXPLICIT",
    weeklyHours: [{ dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00" }],
    quoteTtlSeconds: 600,
    serviceArea: {
      name: "test",
      geoJson: { type: "Polygon", coordinates: [[[100, 13], [101, 13], [101, 14], [100, 13]]] },
    },
    pricing: {
      ruleVersion: "v1",
      baseFareSatang: 1_000,
      perStartedKmSatang: 500,
      minimumFareSatang: 1_500,
      fixedMerchantSubsidySatang: 0,
      commissionBps: 500,
    },
  };
  assert.equal(merchantConfigurationV1Schema.parse(configuration).version, 1);
  assert.throws(() => merchantConfigurationV1Schema.parse({ ...configuration, weeklyHours: [] }));
  assert.throws(() => merchantConfigurationV1Schema.parse({
    ...configuration,
    weeklyHours: [
      { dayOfWeek: 1, opensAt: "09:00", closesAt: "12:00" },
      { dayOfWeek: 1, opensAt: "11:00", closesAt: "13:00" },
    ],
  }));

  const context = {
    fulfillmentType: "DELIVERY",
    paymentState: "UNPAID",
    merchantReadiness: "NOT_ACCEPTED",
    eligibility: { version: "v1", decision: "ELIGIBLE", blockers: [], evaluatedAt: "2026-10-18T00:00:00Z" },
    dropoff: { longitude: 100.5, latitude: 13.7, confidence: 0.9 },
    route: { provider: "synthetic", reference: "route:1", distanceMeters: 1000, observedAt: "2026-10-18T00:00:00Z" },
  };
  assert.equal(orderContextPayloadV1Schema.parse(context).eligibility.decision, "ELIGIBLE");
  assert.throws(() => orderContextPayloadV1Schema.parse({
    ...context,
    eligibility: { ...context.eligibility, blockers: ["UNKNOWN"] },
  }));
});

test("integration envelope is strict, versioned, and requires routing refs", () => {
  const envelope = {
    messageId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
    messageType: "bms.order-context-changed.v1",
    schemaVersion: 1,
    producer: "synthetic-test",
    tenantRef: "tenant:test-a",
    branchRef: "branch:main",
    aggregateType: "bms-order",
    aggregateRef: "order:test-1",
    aggregateVersion: 1,
    occurredAt: "2026-10-18T00:00:00.000Z",
    correlationId: "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
    causationId: null,
    payload: { status: "PAID" },
  };
  assert.equal(integrationEnvelopeV1Schema.parse(envelope).schemaVersion, 1);
  assert.throws(() => integrationEnvelopeV1Schema.parse({ ...envelope, tenantId: "caller" }));
  assert.throws(() => integrationEnvelopeV1Schema.parse({ ...envelope, schemaVersion: 2 }));
});

test("phase 5 order-context consumer contract distinguishes changes from reconciliation snapshots", () => {
  const envelope = {
    messageId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
    messageType: "bms.order-context-snapshot.v1",
    schemaVersion: 1,
    producer: "synthetic-test",
    tenantRef: "tenant:test-a",
    branchRef: "branch:main",
    aggregateType: "bms-order",
    aggregateRef: "order:test-1",
    aggregateVersion: 3,
    occurredAt: "2026-10-18T00:00:00.000Z",
    correlationId: "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
    causationId: null,
    payload: {
      fulfillmentType: "DELIVERY",
      paymentState: "CONFIRMED",
      merchantReadiness: "READY",
      eligibility: {
        version: "eligibility:v3",
        decision: "ELIGIBLE",
        blockers: [],
        evaluatedAt: "2026-10-18T00:00:00.000Z",
      },
      dropoff: { longitude: 100.5, latitude: 13.7, confidence: 0.99 },
      route: {
        provider: "synthetic",
        reference: "route:v3",
        distanceMeters: 1_000,
        observedAt: "2026-10-18T00:00:00.000Z",
      },
    },
  };
  assert.equal(orderContextEnvelopeV1Schema.parse(envelope).aggregateVersion, 3);
  assert.throws(() => orderContextEnvelopeV1Schema.parse({ ...envelope, producer: "fleet-delivery" }));
  assert.throws(() => orderContextEnvelopeV1Schema.parse({
    ...envelope,
    payload: { ...envelope.payload, customerPhone: "0800000000" },
  }));
});

test("phase 5 reconciliation feed is bounded and excludes raw event bodies", () => {
  const feed = {
    serverNow: "2026-10-18T00:00:00.000Z",
    issues: [{
      issueId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
      messageType: "bms.order-context-changed.v1",
      aggregateType: "bms-order",
      aggregateRef: "order:test-1",
      aggregateVersion: 3,
      reason: "ORDER_CONTEXT_VERSION_GAP",
      receivedAt: "2026-10-18T00:00:00.000Z",
    }],
    nextCursor: null,
  };
  assert.equal(reconciliationIssueFeedV1Schema.parse(feed).issues.length, 1);
  assert.throws(() => reconciliationIssueFeedV1Schema.parse({
    ...feed,
    issues: [{ ...feed.issues[0], envelope: { customerPhone: "0800000000" } }],
  }));
  assert.throws(() => reconciliationIssueFeedV1Schema.parse({
    ...feed,
    issues: Array.from({ length: 101 }, () => feed.issues[0]),
  }));
});

test("phase 3 dispatch policy is bounded and sequential-only", () => {
  const policy = {
    tenantRef: "tenant:test-a",
    branchRef: "branch:main",
    version: 1,
    pickup: { longitude: 100.5, latitude: 13.7 },
    initialRadiusM: 500,
    radiusIncrementM: 500,
    maximumRadiusM: 2_000,
    offerTtlSeconds: 30,
    maximumSearchSeconds: 300,
    driverCooldownSeconds: 60,
    locationFreshnessSeconds: 120,
    maximumLocationAccuracyM: 100,
    batchSize: 1,
    fairnessMode: "DISTANCE_THEN_LONGEST_IDLE",
  };
  assert.equal(dispatchPolicyV1Schema.parse(policy).batchSize, 1);
  assert.throws(() => dispatchPolicyV1Schema.parse({ ...policy, batchSize: 2 }));
  assert.throws(() => dispatchPolicyV1Schema.parse({ ...policy, maximumRadiusM: 100 }));
  assert.throws(() => dispatchPolicyV1Schema.parse({ ...policy, offerTtlSeconds: 301 }));
});

test("phase 4 synthetic offer feed is bounded and exposes no customer or location PII", () => {
  const feed = {
    serverNow: "2026-10-18T00:00:00.000Z",
    offers: [{
      offerId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
      deliveryId: "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
      status: "PENDING",
      version: 1,
      offeredAt: "2026-10-18T00:00:00.000Z",
      expiresAt: "2026-10-18T00:00:30.000Z",
      pickupDistanceM: 450,
    }],
  };
  assert.equal(driverOfferFeedV1Schema.parse(feed).offers.length, 1);
  assert.throws(() => driverOfferFeedV1Schema.parse({
    ...feed,
    offers: [{ ...feed.offers[0], customerPhone: "0800000000" }],
  }));
  assert.throws(() => driverOfferFeedV1Schema.parse({
    ...feed,
    offers: Array.from({ length: 21 }, () => feed.offers[0]),
  }));
});

test("phase 4 current assignment is restart-safe and privacy minimal", () => {
  const current = {
    serverNow: "2026-10-18T00:00:00.000Z",
    assignment: {
      assignmentId: "b0cc82a3-a056-4600-b413-cc8d54894320",
      deliveryId: "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
      offerId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
      status: "ACTIVE",
      deliveryState: "ASSIGNED",
      deliveryVersion: 6,
      assignedAt: "2026-10-18T00:00:00.000Z",
    },
  };
  assert.equal(driverCurrentAssignmentV1Schema.parse(current).assignment?.deliveryVersion, 6);
  assert.throws(() => driverCurrentAssignmentV1Schema.parse({
    ...current,
    assignment: { ...current.assignment, customerAddress: "private" },
  }));
  assert.equal(driverCurrentAssignmentV1Schema.parse({
    serverNow: current.serverNow,
    assignment: null,
  }).assignment, null);
});

test("phase 4 polling snapshot cannot claim an offer and assignment simultaneously", () => {
  const base = {
    serverNow: "2026-10-18T00:00:00.000Z",
    availability: { state: "BUSY", version: 2 },
    assignment: {
      assignmentId: "b0cc82a3-a056-4600-b413-cc8d54894320",
      deliveryId: "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
      offerId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
      status: "ACTIVE",
      deliveryState: "AT_PICKUP",
      deliveryVersion: 8,
      assignedAt: "2026-10-18T00:00:00.000Z",
    },
    offers: [],
  };
  assert.equal(driverSnapshotV1Schema.parse(base).availability?.state, "BUSY");
  assert.throws(() => driverSnapshotV1Schema.parse({
    ...base,
    offers: [{
      offerId: "07cb3a92-0a6d-47cb-a4b1-f1dba00d770e",
      deliveryId: "3d2547e1-2ed8-42d4-9741-5cafeeb015cd",
      status: "PENDING",
      version: 1,
      offeredAt: "2026-10-18T00:00:00.000Z",
      expiresAt: "2026-10-18T00:00:30.000Z",
      pickupDistanceM: 10,
    }],
  }));
});
