import { z } from "zod";

export const CONTRACT_VERSION = 1 as const;
export const THB_CURRENCY = "THB" as const;

export const satangSchema = z.number().int().safe().min(0);
export const canonicalThbDecimalSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.\d{2}$/, "expected canonical THB decimal with two digits");

export function decimalThbToSatang(value: string): number {
  const parsed = canonicalThbDecimalSchema.parse(value);
  const [baht, satang] = parsed.split(".") as [string, string];
  const amount = Number(baht) * 100 + Number(satang);
  return satangSchema.parse(amount);
}

export function satangToDecimalThb(value: number): string {
  const amount = satangSchema.parse(value);
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}

const opaqueRefSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/);

export const integrationEnvelopeV1Schema = z
  .object({
    messageId: z.uuid(),
    messageType: z.string().min(3).max(160).regex(/^[a-z0-9.-]+\.v1$/),
    schemaVersion: z.literal(CONTRACT_VERSION),
    producer: z.enum(["bms", "fleet-delivery", "synthetic-test"]),
    tenantRef: opaqueRefSchema,
    branchRef: opaqueRefSchema,
    aggregateType: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
    aggregateRef: opaqueRefSchema,
    aggregateVersion: z.number().int().positive().safe(),
    occurredAt: z.iso.datetime({ offset: true }),
    correlationId: z.uuid(),
    causationId: z.uuid().nullable(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type IntegrationEnvelopeV1 = z.infer<typeof integrationEnvelopeV1Schema>;

export const serviceAuthClaimsSchema = z.object({
  sub: z.string().min(1).max(160),
  jti: z.string().min(1).max(200),
  scopes: z.array(z.string().min(1).max(100)).max(50),
});

export type ServiceAuthClaims = z.infer<typeof serviceAuthClaimsSchema>;

export type StructuredErrorBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId: string;
  };
};

const coordinateSchema = z.number().finite();

export const weeklyHoursSchema = z
  .array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }).strict())
  .max(14)
  .refine((windows) => windows.every((window) => window.opensAt < window.closesAt), {
    message: "hours must open and close on the same day",
  })
  .refine((windows) => {
    for (let day = 0; day <= 6; day += 1) {
      const sameDay = windows.filter((window) => window.dayOfWeek === day)
        .sort((left, right) => left.opensAt.localeCompare(right.opensAt));
      for (let index = 1; index < sameDay.length; index += 1) {
        if (sameDay[index]!.opensAt < sameDay[index - 1]!.closesAt) return false;
      }
    }
    return true;
  }, {
    message: "hours must not overlap",
  });

export const merchantConfigurationV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  version: z.number().int().positive().safe(),
  enabled: z.boolean(),
  timezone: z.literal("Asia/Bangkok"),
  readinessPolicy: z.literal("EXPLICIT"),
  weeklyHours: weeklyHoursSchema,
  quoteTtlSeconds: z.number().int().min(60).max(1800),
  serviceArea: z.object({
    name: z.string().min(1).max(120),
    geoJson: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(
        z.array(z.tuple([coordinateSchema, coordinateSchema])).min(4).max(5_000),
      ).min(1).max(10),
    }).strict(),
  }).strict(),
  pricing: z.object({
    ruleVersion: z.string().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/),
    baseFareSatang: satangSchema,
    perStartedKmSatang: satangSchema,
    minimumFareSatang: satangSchema.refine((value) => value > 0, "minimum fare must be positive"),
    fixedMerchantSubsidySatang: satangSchema,
    commissionBps: z.number().int().min(0).max(10_000),
  }).strict(),
}).strict().superRefine((configuration, context) => {
  if (configuration.enabled && configuration.weeklyHours.length === 0) {
    context.addIssue({ code: "custom", path: ["weeklyHours"], message: "enabled merchant requires hours" });
  }
});

export type MerchantConfigurationV1 = z.infer<typeof merchantConfigurationV1Schema>;

export const orderContextPayloadV1Schema = z.object({
  fulfillmentType: z.literal("DELIVERY"),
  paymentState: z.enum(["UNPAID", "PENDING", "CONFIRMED"]),
  merchantReadiness: z.enum(["NOT_ACCEPTED", "PREPARING", "READY"]),
  eligibility: z.object({
    version: opaqueRefSchema,
    decision: z.enum(["ELIGIBLE", "INELIGIBLE"]),
    blockers: z.array(z.string().min(1).max(120)).max(50),
    evaluatedAt: z.iso.datetime({ offset: true }),
  }).strict(),
  dropoff: z.object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    confidence: z.number().min(0).max(1),
  }).strict(),
  route: z.object({
    provider: z.literal("synthetic"),
    reference: opaqueRefSchema,
    distanceMeters: z.number().int().positive().max(200_000),
    observedAt: z.iso.datetime({ offset: true }),
  }).strict(),
}).strict().superRefine((payload, context) => {
  if (payload.eligibility.decision === "ELIGIBLE" && payload.eligibility.blockers.length > 0) {
    context.addIssue({ code: "custom", path: ["eligibility", "blockers"], message: "eligible context cannot have blockers" });
  }
  if (payload.eligibility.decision === "INELIGIBLE" && payload.eligibility.blockers.length === 0) {
    context.addIssue({ code: "custom", path: ["eligibility", "blockers"], message: "ineligible context requires a blocker" });
  }
});

export type OrderContextPayloadV1 = z.infer<typeof orderContextPayloadV1Schema>;

export const orderContextEnvelopeV1Schema = integrationEnvelopeV1Schema.extend({
  messageType: z.enum([
    "bms.order-context-changed.v1",
    "bms.order-context-snapshot.v1",
  ]),
  producer: z.enum(["bms", "synthetic-test"]),
  aggregateType: z.literal("bms-order"),
  payload: orderContextPayloadV1Schema,
}).strict();

export type OrderContextEnvelopeV1 = z.infer<typeof orderContextEnvelopeV1Schema>;

export const reconciliationIssueQueryV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(500).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();

export const reconciliationIssueV1Schema = z.object({
  issueId: z.uuid(),
  messageType: z.string().min(3).max(160).regex(/^[a-z0-9.-]+\.v1$/),
  aggregateType: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  aggregateRef: opaqueRefSchema,
  aggregateVersion: z.number().int().positive().safe(),
  reason: z.string().min(1).max(120).regex(/^[A-Z0-9_:-]+$/),
  receivedAt: z.iso.datetime({ offset: true }),
}).strict();

export const reconciliationIssueFeedV1Schema = z.object({
  serverNow: z.iso.datetime({ offset: true }),
  issues: z.array(reconciliationIssueV1Schema).max(100),
  nextCursor: z.string().min(1).max(500).regex(/^[A-Za-z0-9_-]+$/).nullable(),
}).strict();

export type ReconciliationIssueQueryV1 = z.infer<typeof reconciliationIssueQueryV1Schema>;
export type ReconciliationIssueFeedV1 = z.infer<typeof reconciliationIssueFeedV1Schema>;

export const financeCapabilitiesQueryV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
}).strict();

export const financeCapabilitiesV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  mode: z.literal("SHADOW_ONLY"),
  currency: z.literal(THB_CURRENCY),
  shadowAllocationJournal: z.literal(true),
  realMoneyEnabled: z.literal(false),
  capabilities: z.object({
    codCollection: z.literal(false),
    commissionRecognition: z.literal(false),
    driverPayableEarnings: z.literal(false),
    settlementPosting: z.literal(false),
    deliveryFeeRefunds: z.literal(false),
    payoutPreparation: z.literal(false),
    payoutApproval: z.literal(false),
    externalTransferConfirmation: z.literal(false),
    taxDocuments: z.literal(false),
  }).strict(),
  policyStatus: z.literal("UNRESOLVED"),
  separateProductionAuthorizationRequired: z.literal(true),
}).strict();

export const FINANCE_CAPABILITIES_V1 = Object.freeze({
  schemaVersion: CONTRACT_VERSION,
  mode: "SHADOW_ONLY" as const,
  currency: THB_CURRENCY,
  shadowAllocationJournal: true as const,
  realMoneyEnabled: false as const,
  capabilities: Object.freeze({
    codCollection: false as const,
    commissionRecognition: false as const,
    driverPayableEarnings: false as const,
    settlementPosting: false as const,
    deliveryFeeRefunds: false as const,
    payoutPreparation: false as const,
    payoutApproval: false as const,
    externalTransferConfirmation: false as const,
    taxDocuments: false as const,
  }),
  policyStatus: "UNRESOLVED" as const,
  separateProductionAuthorizationRequired: true as const,
});

export type FinanceCapabilitiesQueryV1 = z.infer<typeof financeCapabilitiesQueryV1Schema>;
export type FinanceCapabilitiesV1 = z.infer<typeof financeCapabilitiesV1Schema>;

export const operationsDeliveryStateSchema = z.enum([
  "AWAITING_PAYMENT",
  "AWAITING_MERCHANT_ACCEPTANCE",
  "PREPARING",
  "READY_FOR_DISPATCH",
  "SEARCHING_DRIVER",
  "OFFERED",
  "ASSIGNED",
  "EN_ROUTE_PICKUP",
  "AT_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
  "AT_DROPOFF",
  "DELIVERED",
  "COMPLETED",
  "DELIVERY_FAILED",
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "RETURN_IN_TRANSIT",
  "RETURNED_TO_MERCHANT",
  "RETURN_REVIEW",
  "RETURN_RESOLVED",
  "MANUAL_DISPATCH_REQUIRED",
  "CANCELLED",
]);

export const operationsScopeQueryV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
}).strict();

export const operationsOverviewV1Schema = z.object({
  serverNow: z.iso.datetime({ offset: true }),
  deliveryCounts: z.array(z.object({
    state: operationsDeliveryStateSchema,
    count: z.number().int().nonnegative().safe(),
  }).strict()).max(operationsDeliveryStateSchema.options.length),
  openManualDispatchCount: z.number().int().nonnegative().safe(),
  actionRequiredIntegrationCount: z.number().int().nonnegative().safe(),
  lastDeliveryUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export const operationsDeliveryListQueryV1Schema = operationsScopeQueryV1Schema.extend({
  state: operationsDeliveryStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(500).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();

export const operationsDeliveryV1Schema = z.object({
  deliveryId: z.uuid(),
  bmsOrderRef: opaqueRefSchema,
  state: operationsDeliveryStateSchema,
  version: z.number().int().positive().safe(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const operationsDeliveryFeedV1Schema = z.object({
  serverNow: z.iso.datetime({ offset: true }),
  deliveries: z.array(operationsDeliveryV1Schema).max(100),
  nextCursor: z.string().min(1).max(500).regex(/^[A-Za-z0-9_-]+$/).nullable(),
}).strict();

export type OperationsDeliveryState = z.infer<typeof operationsDeliveryStateSchema>;
export type OperationsScopeQueryV1 = z.infer<typeof operationsScopeQueryV1Schema>;
export type OperationsOverviewV1 = z.infer<typeof operationsOverviewV1Schema>;
export type OperationsDeliveryListQueryV1 = z.infer<typeof operationsDeliveryListQueryV1Schema>;
export type OperationsDeliveryFeedV1 = z.infer<typeof operationsDeliveryFeedV1Schema>;

export const deliveryServiceRequirementV1Schema = z.object({
  serviceType: z.literal("ON_DEMAND"),
  requiredVehicleType: z.literal("MOTORCYCLE"),
  requiredCapacityKg: z.number().int().min(1).max(500),
  packageWeightKg: z.number().positive().max(500).multipleOf(0.01),
  packageSizeClass: z.literal("SMALL"),
  specialHandling: z.array(z.never()).max(0),
  requirementVersion: opaqueRefSchema,
}).strict().refine(
  (value) => value.requiredCapacityKg >= value.packageWeightKg,
  { path: ["requiredCapacityKg"], message: "required capacity must cover package weight" },
);

export const createQuoteV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  bmsOrderRef: opaqueRefSchema,
  expectedOrderVersion: z.number().int().positive().safe(),
  serviceRequirement: deliveryServiceRequirementV1Schema,
}).strict();

export const createDeliveryV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  bmsOrderRef: opaqueRefSchema,
  quoteId: z.uuid(),
}).strict();

export const deliveryIdSchema = z.uuid();

export const deliveryActionSchema = z.enum([
  "payment_confirmed",
  "merchant_accepted",
  "merchant_ready",
  "cancel_before_pickup",
  "merchant_handoff",
  "complete_delivery",
  "request_return",
  "approve_return",
  "review_return",
  "resolve_return",
]);

export const transitionDeliveryV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  expectedVersion: z.number().int().positive().safe(),
  reasonCode: z.string().min(1).max(80).regex(/^[A-Z0-9_:-]+$/),
}).strict();

export type CreateQuoteV1 = z.infer<typeof createQuoteV1Schema>;
export type CreateDeliveryV1 = z.infer<typeof createDeliveryV1Schema>;
export type DeliveryServiceRequirementV1 = z.infer<typeof deliveryServiceRequirementV1Schema>;
export type DeliveryAction = z.infer<typeof deliveryActionSchema>;
export type TransitionDeliveryV1 = z.infer<typeof transitionDeliveryV1Schema>;

export const customerGrantRegistrationV1Schema = z.object({
  grantId: z.uuid(),
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  bmsOrderRef: opaqueRefSchema,
  tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
  allowedActions: z.tuple([
    z.literal("QUOTE"),
    z.literal("CREATE_DELIVERY"),
    z.literal("TRACK"),
  ]),
  syntheticOnly: z.literal(true),
}).strict();

export const customerQuoteRequestV1Schema = z.object({
  serviceRequirement: deliveryServiceRequirementV1Schema,
}).strict();

export const customerDeliveryRequestV1Schema = z.object({
  quoteId: z.uuid(),
}).strict();

export const customerQuoteResponseV1Schema = z.object({
  quoteId: z.uuid(),
  currency: z.literal("THB"),
  billableDistanceMeters: z.number().int().positive().safe(),
  startedKilometres: z.number().int().positive().safe(),
  baseFareSatang: satangSchema,
  distanceChargeSatang: satangSchema,
  grossDeliveryFeeSatang: satangSchema,
  customerContributionSatang: satangSchema,
  merchantSubsidySatang: satangSchema,
  explicitDiscountSatang: satangSchema,
  eligibleCommissionFeeSatang: satangSchema,
  commissionSatang: satangSchema,
  commissionBps: z.number().int().min(0).max(10_000),
  pricingRuleVersion: opaqueRefSchema,
  eligibilityVersion: opaqueRefSchema,
  serviceRequirement: deliveryServiceRequirementV1Schema,
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export const customerDeliveryResponseV1Schema = z.object({
  deliveryId: z.uuid(),
  state: z.literal("AWAITING_PAYMENT"),
  version: z.literal(1),
  quoteId: z.uuid(),
  serviceRequirement: deliveryServiceRequirementV1Schema,
}).strict();

export const customerMatchStageV1Schema = z.enum([
  "PAYMENT_REQUIRED",
  "MERCHANT_PREPARING",
  "READY_FOR_SEARCH",
  "SEARCHING",
  "DRIVER_OFFERED",
  "DRIVER_ASSIGNED",
  "PICKUP_IN_PROGRESS",
  "IN_TRANSIT",
  "ARRIVING",
  "DELIVERED",
  "COMPLETED",
  "DELIVERY_EXCEPTION",
  "RETURNING",
  "RETURNED",
  "RETURN_REVIEW",
  "RETURN_RESOLVED",
  "MANUAL_REVIEW",
  "CANCELLED",
]);

export const customerDeliveryStatusV1Schema = z.object({
  serverNow: z.iso.datetime({ offset: true }),
  delivery: z.object({
    deliveryId: z.uuid(),
    quoteId: z.uuid(),
    state: operationsDeliveryStateSchema,
    version: z.number().int().positive().safe(),
    matchStage: customerMatchStageV1Schema,
    currency: z.literal("THB"),
    grossDeliveryFeeSatang: satangSchema,
    customerContributionSatang: satangSchema,
    merchantSubsidySatang: satangSchema,
    updatedAt: z.iso.datetime({ offset: true }),
  }).strict().nullable(),
}).strict();

export type CustomerGrantRegistrationV1 = z.infer<typeof customerGrantRegistrationV1Schema>;
export type CustomerQuoteRequestV1 = z.infer<typeof customerQuoteRequestV1Schema>;
export type CustomerDeliveryRequestV1 = z.infer<typeof customerDeliveryRequestV1Schema>;
export type CustomerQuoteResponseV1 = z.infer<typeof customerQuoteResponseV1Schema>;
export type CustomerDeliveryResponseV1 = z.infer<typeof customerDeliveryResponseV1Schema>;
export type CustomerMatchStageV1 = z.infer<typeof customerMatchStageV1Schema>;
export type CustomerDeliveryStatusV1 = z.infer<typeof customerDeliveryStatusV1Schema>;

export const dispatchPolicyV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  version: z.number().int().positive().safe(),
  pickup: z.object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
  }).strict(),
  initialRadiusM: z.number().int().min(100).max(50_000),
  radiusIncrementM: z.number().int().min(100).max(20_000),
  maximumRadiusM: z.number().int().min(100).max(100_000),
  offerTtlSeconds: z.number().int().min(5).max(300),
  maximumSearchSeconds: z.number().int().min(10).max(3_600),
  driverCooldownSeconds: z.number().int().min(0).max(3_600),
  locationFreshnessSeconds: z.number().int().min(5).max(300),
  maximumLocationAccuracyM: z.number().int().min(5).max(1_000),
  batchSize: z.literal(1),
  fairnessMode: z.literal("DISTANCE_THEN_LONGEST_IDLE"),
}).strict().refine((policy) => policy.maximumRadiusM >= policy.initialRadiusM, {
  path: ["maximumRadiusM"], message: "maximum radius must cover initial radius",
});

export const syntheticDriverV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  driverRef: opaqueRefSchema,
  principalSubject: z.string().min(1).max(160),
  verificationStatus: z.enum(["PENDING", "VERIFIED", "REJECTED"]),
  status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]),
  vehicle: z.object({
    vehicleRef: opaqueRefSchema,
    type: z.literal("MOTORCYCLE"),
    capacityKg: z.number().int().min(1).max(500),
  }).strict(),
}).strict();

export const driverAvailabilityV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  state: z.enum(["ONLINE", "OFFLINE"]),
}).strict();

export const driverLocationV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  sequence: z.number().int().positive().safe(),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  accuracyM: z.number().positive().max(10_000),
  deviceObservedAt: z.iso.datetime({ offset: true }),
  mockLocation: z.boolean(),
}).strict();

export const startDispatchV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  expectedVersion: z.number().int().positive().safe(),
}).strict();

export const offerDecisionV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  expectedOfferVersion: z.number().int().positive().safe(),
}).strict();

export const offerDecisionSchema = z.enum(["accept", "reject"]);

export const driverOfferFeedQueryV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
}).strict();

export const driverOfferV1Schema = z.object({
  offerId: z.uuid(),
  deliveryId: z.uuid(),
  status: z.literal("PENDING"),
  version: z.number().int().positive().safe(),
  offeredAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  pickupDistanceM: z.number().int().nonnegative().safe(),
}).strict();

export const driverOfferFeedV1Schema = z.object({
  serverNow: z.iso.datetime({ offset: true }),
  offers: z.array(driverOfferV1Schema).max(20),
}).strict();

export const driverAssignmentQueryV1Schema = driverOfferFeedQueryV1Schema;

export const driverAssignmentV1Schema = z.object({
  assignmentId: z.uuid(),
  deliveryId: z.uuid(),
  offerId: z.uuid(),
  status: z.literal("ACTIVE"),
  deliveryState: z.enum([
    "ASSIGNED", "EN_ROUTE_PICKUP", "AT_PICKUP", "PICKED_UP", "IN_TRANSIT",
    "AT_DROPOFF", "DELIVERY_FAILED", "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_IN_TRANSIT",
  ]),
  deliveryVersion: z.number().int().positive().safe(),
  assignedAt: z.iso.datetime({ offset: true }),
}).strict();

export const driverCurrentAssignmentV1Schema = z.object({
  serverNow: z.iso.datetime({ offset: true }),
  assignment: driverAssignmentV1Schema.nullable(),
}).strict();

export const driverSnapshotV1Schema = z.object({
  serverNow: z.iso.datetime({ offset: true }),
  availability: z.object({
    state: z.enum(["ONLINE", "OFFLINE", "BUSY"]),
    version: z.number().int().positive().safe(),
  }).strict().nullable(),
  assignment: driverAssignmentV1Schema.nullable(),
  offers: z.array(driverOfferV1Schema).max(20),
}).strict().refine((snapshot) => snapshot.assignment === null || snapshot.offers.length === 0, {
  path: ["offers"],
  message: "active assignment and pending offers cannot coexist in a driver snapshot",
});

export const driverJourneyActionSchema = z.enum([
  "start_pickup",
  "arrive_pickup",
  "start_delivery",
  "arrive_dropoff",
  "deliver_with_pod",
  "report_failure",
  "start_return",
  "arrive_return",
]);

export const syntheticPodDescriptorV1Schema = z.object({
  evidenceRef: z.string().min(24).max(176).regex(/^synthetic-photo:[A-Za-z0-9._:-]{8,160}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.enum(["image/jpeg", "image/png"]),
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024).safe(),
  pixelWidth: z.number().int().min(1).max(12_000).safe(),
  pixelHeight: z.number().int().min(1).max(12_000).safe(),
  syntheticOnly: z.literal(true),
}).strict();

export const deliveryFailureDescriptorV1Schema = z.object({
  reasonCode: z.enum([
    "CUSTOMER_UNREACHABLE", "UNSAFE_DROPOFF", "ADDRESS_UNRESOLVED", "DAMAGED", "OTHER",
  ]),
  safetyException: z.boolean(),
  contactAttemptCount: z.literal(0),
  syntheticOnly: z.literal(true),
}).strict();

export const driverJourneyV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  expectedVersion: z.number().int().positive().safe(),
  pod: syntheticPodDescriptorV1Schema.optional(),
  failure: deliveryFailureDescriptorV1Schema.optional(),
}).strict();

export const createSyntheticDisputeV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  expectedDeliveryVersion: z.number().int().positive().safe(),
  category: z.enum([
    "DELIVERY_NOT_RECEIVED", "DAMAGED", "RETURN_EXCEPTION", "FEE_QUESTION", "OTHER",
  ]),
  syntheticOnly: z.literal(true),
}).strict();

export const resolveSyntheticDisputeV1Schema = z.object({
  tenantRef: opaqueRefSchema,
  branchRef: opaqueRefSchema,
  decision: z.enum(["RESOLVED", "REJECTED"]),
  resolutionCode: z.string().min(1).max(80).regex(/^[A-Z0-9_:-]+$/),
  syntheticOnly: z.literal(true),
}).strict();

export type DispatchPolicyV1 = z.infer<typeof dispatchPolicyV1Schema>;
export type SyntheticDriverV1 = z.infer<typeof syntheticDriverV1Schema>;
export type DriverAvailabilityV1 = z.infer<typeof driverAvailabilityV1Schema>;
export type DriverLocationV1 = z.infer<typeof driverLocationV1Schema>;
export type StartDispatchV1 = z.infer<typeof startDispatchV1Schema>;
export type OfferDecisionV1 = z.infer<typeof offerDecisionV1Schema>;
export type OfferDecision = z.infer<typeof offerDecisionSchema>;
export type DriverOfferFeedQueryV1 = z.infer<typeof driverOfferFeedQueryV1Schema>;
export type DriverOfferV1 = z.infer<typeof driverOfferV1Schema>;
export type DriverOfferFeedV1 = z.infer<typeof driverOfferFeedV1Schema>;
export type DriverAssignmentQueryV1 = z.infer<typeof driverAssignmentQueryV1Schema>;
export type DriverAssignmentV1 = z.infer<typeof driverAssignmentV1Schema>;
export type DriverCurrentAssignmentV1 = z.infer<typeof driverCurrentAssignmentV1Schema>;
export type DriverSnapshotV1 = z.infer<typeof driverSnapshotV1Schema>;
export type DriverJourneyAction = z.infer<typeof driverJourneyActionSchema>;
export type DriverJourneyV1 = z.infer<typeof driverJourneyV1Schema>;
export type SyntheticPodDescriptorV1 = z.infer<typeof syntheticPodDescriptorV1Schema>;
export type DeliveryFailureDescriptorV1 = z.infer<typeof deliveryFailureDescriptorV1Schema>;
export type CreateSyntheticDisputeV1 = z.infer<typeof createSyntheticDisputeV1Schema>;
export type ResolveSyntheticDisputeV1 = z.infer<typeof resolveSyntheticDisputeV1Schema>;

function isValidReleaseEvidenceRef(value: string): boolean {
  if (value.startsWith("https://")) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname.length > 0
        && url.username.length === 0 && url.password.length === 0;
    } catch {
      return false;
    }
  }

  if (value.startsWith("/") || value.includes("\\") || !/^[A-Za-z0-9._/-]+$/.test(value)) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export const releaseEvidenceRefSchema = z.string().min(1).max(500).refine(isValidReleaseEvidenceRef, {
  message: "evidence reference must be a safe repository-relative path or HTTPS URL",
});
const releaseOwnerRoleSchema = z.string().min(2).max(120);

export const pilotReadinessApprovalV1Schema = z.object({
  role: releaseOwnerRoleSchema,
  approvedBy: z.string().min(2).max(160),
  approvedAt: z.iso.datetime({ offset: true }),
  evidenceRef: releaseEvidenceRefSchema,
}).strict();

export const pilotReadinessGateV1Schema = z.object({
  id: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/),
  title: z.string().min(3).max(200),
  status: z.enum(["PASS", "BLOCKED"]),
  ownerRoles: z.array(releaseOwnerRoleSchema).min(1).max(12),
  requiredApprovals: z.array(releaseOwnerRoleSchema).max(12),
  evidence: z.array(releaseEvidenceRefSchema).max(40),
  blockers: z.array(z.string().min(3).max(500)).max(40),
  approvals: z.array(pilotReadinessApprovalV1Schema).max(20),
}).strict().superRefine((gate, context) => {
  const uniqueOwnerRoles = new Set(gate.ownerRoles);
  const uniqueRequiredApprovals = new Set(gate.requiredApprovals);
  const approvalRoles = new Set(gate.approvals.map((approval) => approval.role));

  if (uniqueOwnerRoles.size !== gate.ownerRoles.length) {
    context.addIssue({ code: "custom", path: ["ownerRoles"], message: "owner roles must be unique" });
  }
  if (uniqueRequiredApprovals.size !== gate.requiredApprovals.length) {
    context.addIssue({ code: "custom", path: ["requiredApprovals"], message: "required approvals must be unique" });
  }
  for (const role of gate.requiredApprovals) {
    if (!uniqueOwnerRoles.has(role)) {
      context.addIssue({
        code: "custom",
        path: ["requiredApprovals"],
        message: `required approval role is not an owner: ${role}`,
      });
    }
  }
  if (gate.status === "PASS" && gate.blockers.length > 0) {
    context.addIssue({ code: "custom", path: ["blockers"], message: "passing gate cannot have blockers" });
  }
  if (gate.status === "PASS" && gate.evidence.length === 0) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "passing gate requires evidence" });
  }
  if (gate.status === "BLOCKED" && gate.blockers.length === 0) {
    context.addIssue({ code: "custom", path: ["blockers"], message: "blocked gate requires a blocker" });
  }
  if (gate.status === "PASS") {
    for (const role of gate.requiredApprovals) {
      if (!approvalRoles.has(role)) {
        context.addIssue({
          code: "custom",
          path: ["approvals"],
          message: `passing gate is missing approval for role: ${role}`,
        });
      }
    }
  }
});

export const pilotReadinessManifestV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(9),
  mode: z.literal("PILOT_CERTIFICATION"),
  evaluatedAt: z.iso.datetime({ offset: true }),
  productionEnabled: z.literal(false),
  separateProductionAuthorizationRequired: z.literal(true),
  gates: z.array(pilotReadinessGateV1Schema).min(1).max(64),
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>();
  manifest.gates.forEach((gate, index) => {
    if (ids.has(gate.id)) {
      context.addIssue({ code: "custom", path: ["gates", index, "id"], message: "gate id must be unique" });
    }
    ids.add(gate.id);
  });
});

export type PilotReadinessManifestV1 = z.infer<typeof pilotReadinessManifestV1Schema>;

const certificationRequirementV1Schema = z.object({
  id: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/),
  description: z.string().min(10).max(500),
  acceptanceCriteria: z.array(z.string().min(10).max(500)).min(1).max(20),
}).strict();

const certificationExerciseV1Schema = certificationRequirementV1Schema.extend({
  environment: z.literal("NON_PRODUCTION"),
}).strict();

export const pilotCertificationWorkbookItemV1Schema = z.object({
  gateId: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/),
  planRef: releaseEvidenceRefSchema,
  status: z.enum(["OPEN", "COMPLETE"]),
  requiredArtifacts: z.array(certificationRequirementV1Schema).min(1).max(40),
  requiredExercises: z.array(certificationExerciseV1Schema).max(40),
  evidenceRefs: z.array(releaseEvidenceRefSchema).max(40),
  openActions: z.array(z.string().min(10).max(500)).max(40),
}).strict().superRefine((item, context) => {
  const requirementIds = [
    ...item.requiredArtifacts.map((requirement) => requirement.id),
    ...item.requiredExercises.map((exercise) => exercise.id),
  ];
  if (new Set(requirementIds).size !== requirementIds.length) {
    context.addIssue({
      code: "custom",
      path: ["requiredArtifacts"],
      message: "artifact and exercise ids must be unique within a gate",
    });
  }
  if (item.status === "OPEN" && item.openActions.length === 0) {
    context.addIssue({ code: "custom", path: ["openActions"], message: "open item requires an action" });
  }
  if (item.status === "COMPLETE" && item.openActions.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["openActions"],
      message: "complete item cannot retain open actions",
    });
  }
  if (item.status === "COMPLETE" && item.evidenceRefs.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["evidenceRefs"],
      message: "complete item requires accepted evidence",
    });
  }
});

export const pilotCertificationWorkbookV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(9),
  mode: z.literal("PILOT_CERTIFICATION_WORKBOOK"),
  generatedAt: z.iso.datetime({ offset: true }),
  productionAuthorized: z.literal(false),
  items: z.array(pilotCertificationWorkbookItemV1Schema).min(1).max(64),
}).strict().superRefine((workbook, context) => {
  const gateIds = new Set<string>();
  workbook.items.forEach((item, index) => {
    if (gateIds.has(item.gateId)) {
      context.addIssue({ code: "custom", path: ["items", index, "gateId"], message: "gate id must be unique" });
    }
    gateIds.add(item.gateId);
  });
});

export type PilotCertificationWorkbookV1 = z.infer<typeof pilotCertificationWorkbookV1Schema>;

export function evaluatePilotCertificationWorkbookV1(
  manifest: PilotReadinessManifestV1,
  workbook: PilotCertificationWorkbookV1,
): {
  aligned: boolean;
  openGateIds: string[];
  problems: string[];
} {
  const parsedManifest = pilotReadinessManifestV1Schema.parse(manifest);
  const parsedWorkbook = pilotCertificationWorkbookV1Schema.parse(workbook);
  const gates = new Map(parsedManifest.gates.map((gate) => [gate.id, gate]));
  const items = new Map(parsedWorkbook.items.map((item) => [item.gateId, item]));
  const problems: string[] = [];

  for (const gate of parsedManifest.gates) {
    const item = items.get(gate.id);
    if (item === undefined) {
      problems.push(`MISSING_WORKBOOK_ITEM:${gate.id}`);
      continue;
    }
    if (gate.status === "PASS" && item.status !== "COMPLETE") {
      problems.push(`PASS_GATE_WORKBOOK_NOT_COMPLETE:${gate.id}`);
    }
    if (gate.status === "BLOCKED" && item.status !== "OPEN") {
      problems.push(`BLOCKED_GATE_WORKBOOK_NOT_OPEN:${gate.id}`);
    }
    for (const evidenceRef of item.evidenceRefs) {
      if (!gate.evidence.includes(evidenceRef)) {
        problems.push(`WORKBOOK_EVIDENCE_NOT_IN_GATE:${gate.id}:${evidenceRef}`);
      }
    }
  }
  for (const item of parsedWorkbook.items) {
    if (!gates.has(item.gateId)) problems.push(`UNKNOWN_WORKBOOK_GATE:${item.gateId}`);
  }

  return {
    aligned: problems.length === 0,
    openGateIds: parsedWorkbook.items.filter((item) => item.status === "OPEN").map((item) => item.gateId),
    problems,
  };
}

export function evaluatePilotReadinessV1(manifest: PilotReadinessManifestV1): {
  decision: "PILOT_READY" | "NO_GO";
  blockedGateIds: string[];
} {
  const parsed = pilotReadinessManifestV1Schema.parse(manifest);
  const blockedGateIds = parsed.gates
    .filter((gate) => gate.status !== "PASS")
    .map((gate) => gate.id);
  return {
    decision: blockedGateIds.length === 0 ? "PILOT_READY" : "NO_GO",
    blockedGateIds,
  };
}

const launchTargetRefSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/);

export const productionLaunchAuthorizationV1Schema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("NOT_GRANTED"),
    blockers: z.array(z.string().min(3).max(500)).min(1).max(20),
  }).strict(),
  z.object({
    status: z.literal("GRANTED"),
    authorizedBy: z.string().min(2).max(160),
    authorityRole: z.string().min(2).max(120),
    approvedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    evidenceRef: releaseEvidenceRefSchema,
  }).strict().refine((authorization) => authorization.approvedAt < authorization.expiresAt, {
    path: ["expiresAt"],
    message: "launch authorization must expire after approval",
  }),
]);

export const controlledLaunchPlanV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(10),
  mode: z.literal("CONTROLLED_PRODUCTION_LAUNCH"),
  evaluatedAt: z.iso.datetime({ offset: true }),
  productionEnabled: z.boolean(),
  separateProductionAuthorizationRequired: z.literal(true),
  phase9ManifestRef: releaseEvidenceRefSchema,
  authorization: productionLaunchAuthorizationV1Schema,
  target: z.object({
    tenantRefs: z.array(launchTargetRefSchema).max(20),
    branchRefs: z.array(launchTargetRefSchema).max(100),
    capabilities: z.array(z.string().min(3).max(120).regex(/^[a-z0-9.-]+$/)).max(40),
  }).strict(),
  window: z.object({
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict(),
  monitoring: z.object({
    sloRef: releaseEvidenceRefSchema.nullable(),
    thresholds: z.array(z.object({
      metric: z.string().min(2).max(120).regex(/^[a-z0-9._-]+$/),
      operator: z.enum(["GT", "GTE", "LT", "LTE"]),
      value: z.number().finite(),
      action: z.literal("PAUSE_AND_EVALUATE_ROLLBACK"),
    }).strict()).max(40),
  }).strict(),
  rollback: z.object({
    authorityRole: z.string().min(2).max(120).nullable(),
    runbookRef: releaseEvidenceRefSchema.nullable(),
    triggers: z.array(z.string().min(3).max(300)).max(40),
  }).strict(),
  stages: z.array(z.object({
    id: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/),
    status: z.enum(["PLANNED", "AUTHORIZED", "ACTIVE", "PAUSED", "ROLLED_BACK", "COMPLETE"]),
    percentage: z.number().int().min(1).max(100),
    minimumObservationMinutes: z.number().int().positive().max(43_200),
  }).strict()).max(10),
}).strict().superRefine((plan, context) => {
  const stageIds = new Set<string>();
  let previousPercentage = 0;
  plan.stages.forEach((stage, index) => {
    if (stageIds.has(stage.id)) {
      context.addIssue({ code: "custom", path: ["stages", index, "id"], message: "stage id must be unique" });
    }
    if (stage.percentage <= previousPercentage) {
      context.addIssue({
        code: "custom",
        path: ["stages", index, "percentage"],
        message: "stage percentages must increase",
      });
    }
    stageIds.add(stage.id);
    previousPercentage = stage.percentage;
  });

  if (plan.window.startsAt !== null && plan.window.endsAt !== null
    && plan.window.startsAt >= plan.window.endsAt) {
    context.addIssue({ code: "custom", path: ["window", "endsAt"], message: "launch window must end after it starts" });
  }

  if (plan.productionEnabled && plan.authorization.status !== "GRANTED") {
    context.addIssue({
      code: "custom",
      path: ["productionEnabled"],
      message: "production cannot be enabled without explicit launch authorization",
    });
  }
  if (plan.authorization.status !== "GRANTED"
    && plan.stages.some((stage) => stage.status !== "PLANNED")) {
    context.addIssue({
      code: "custom",
      path: ["stages"],
      message: "unauthorized launch can contain planned stages only",
    });
  }
  if (!plan.productionEnabled && plan.stages.some((stage) => stage.status === "ACTIVE")) {
    context.addIssue({
      code: "custom",
      path: ["stages"],
      message: "active rollout stage requires production enablement",
    });
  }
  if (plan.productionEnabled) {
    const missingControls = [
      plan.target.tenantRefs.length === 0,
      plan.target.branchRefs.length === 0,
      plan.target.capabilities.length === 0,
      plan.window.startsAt === null || plan.window.endsAt === null,
      plan.monitoring.sloRef === null || plan.monitoring.thresholds.length === 0,
      plan.rollback.authorityRole === null || plan.rollback.runbookRef === null
        || plan.rollback.triggers.length === 0,
      plan.stages.length === 0,
    ];
    if (missingControls.some(Boolean)) {
      context.addIssue({
        code: "custom",
        path: ["productionEnabled"],
        message: "production cannot be enabled with incomplete launch controls",
      });
    }
  }
});

export type ControlledLaunchPlanV1 = z.infer<typeof controlledLaunchPlanV1Schema>;

export const controlledLaunchBlockerV1Schema = z.enum([
  "PHASE_9_NOT_PILOT_READY",
  "PRODUCTION_AUTHORIZATION_NOT_GRANTED",
  "PRODUCTION_AUTHORIZATION_NOT_CURRENT",
  "TENANT_COHORT_NOT_DEFINED",
  "BRANCH_COHORT_NOT_DEFINED",
  "CAPABILITY_SET_NOT_DEFINED",
  "LAUNCH_WINDOW_NOT_DEFINED",
  "LAUNCH_WINDOW_NOT_ACTIVE",
  "MONITORING_GATES_NOT_DEFINED",
  "ROLLBACK_CONTROL_NOT_DEFINED",
  "ROLLOUT_STAGES_NOT_DEFINED",
]);

export type ControlledLaunchBlockerV1 = z.infer<typeof controlledLaunchBlockerV1Schema>;

export const controlledLaunchControlIdV1Schema = z.enum([
  "phase9-readiness",
  "production-authorization",
  "tenant-cohort",
  "branch-cohort",
  "capability-set",
  "launch-window",
  "monitoring-gates",
  "rollback-control",
  "rollout-stages",
]);

export type ControlledLaunchControlIdV1 = z.infer<typeof controlledLaunchControlIdV1Schema>;

const launchControlByBlocker: Record<ControlledLaunchBlockerV1, ControlledLaunchControlIdV1> = {
  PHASE_9_NOT_PILOT_READY: "phase9-readiness",
  PRODUCTION_AUTHORIZATION_NOT_GRANTED: "production-authorization",
  PRODUCTION_AUTHORIZATION_NOT_CURRENT: "production-authorization",
  TENANT_COHORT_NOT_DEFINED: "tenant-cohort",
  BRANCH_COHORT_NOT_DEFINED: "branch-cohort",
  CAPABILITY_SET_NOT_DEFINED: "capability-set",
  LAUNCH_WINDOW_NOT_DEFINED: "launch-window",
  LAUNCH_WINDOW_NOT_ACTIVE: "launch-window",
  MONITORING_GATES_NOT_DEFINED: "monitoring-gates",
  ROLLBACK_CONTROL_NOT_DEFINED: "rollback-control",
  ROLLOUT_STAGES_NOT_DEFINED: "rollout-stages",
};

export const controlledLaunchWorkbookItemV1Schema = z.object({
  controlId: controlledLaunchControlIdV1Schema,
  status: z.enum(["OPEN", "COMPLETE"]),
  ownerRoles: z.array(releaseOwnerRoleSchema).min(1).max(12),
  planRef: releaseEvidenceRefSchema,
  acceptanceCriteria: z.array(z.string().min(10).max(500)).min(1).max(20),
  evidenceRefs: z.array(releaseEvidenceRefSchema).max(40),
  openActions: z.array(z.string().min(10).max(500)).max(40),
}).strict().superRefine((item, context) => {
  if (new Set(item.ownerRoles).size !== item.ownerRoles.length) {
    context.addIssue({ code: "custom", path: ["ownerRoles"], message: "owner roles must be unique" });
  }
  if (item.status === "OPEN" && item.openActions.length === 0) {
    context.addIssue({ code: "custom", path: ["openActions"], message: "open control requires an action" });
  }
  if (item.status === "COMPLETE" && item.openActions.length > 0) {
    context.addIssue({ code: "custom", path: ["openActions"], message: "complete control cannot retain open actions" });
  }
  if (item.status === "COMPLETE" && item.evidenceRefs.length === 0) {
    context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "complete control requires evidence" });
  }
});

export const controlledLaunchWorkbookV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(10),
  mode: z.literal("CONTROLLED_LAUNCH_WORKBOOK"),
  generatedAt: z.iso.datetime({ offset: true }),
  productionAuthorized: z.literal(false),
  operatorChecklistRef: releaseEvidenceRefSchema,
  stageGateTemplateRef: releaseEvidenceRefSchema,
  items: z.array(controlledLaunchWorkbookItemV1Schema).length(controlledLaunchControlIdV1Schema.options.length),
}).strict().superRefine((workbook, context) => {
  const controlIds = new Set(workbook.items.map((item) => item.controlId));
  if (controlIds.size !== workbook.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "control ids must be unique" });
  }
  for (const controlId of controlledLaunchControlIdV1Schema.options) {
    if (!controlIds.has(controlId)) {
      context.addIssue({ code: "custom", path: ["items"], message: `missing launch control: ${controlId}` });
    }
  }
});

export type ControlledLaunchWorkbookV1 = z.infer<typeof controlledLaunchWorkbookV1Schema>;

export function evaluateControlledLaunchWorkbookV1(
  blockers: ControlledLaunchBlockerV1[],
  workbook: ControlledLaunchWorkbookV1,
): {
  aligned: boolean;
  openControlIds: ControlledLaunchControlIdV1[];
  problems: string[];
} {
  const parsedBlockers = z.array(controlledLaunchBlockerV1Schema).parse(blockers);
  const parsedWorkbook = controlledLaunchWorkbookV1Schema.parse(workbook);
  const blockedControls = new Set(parsedBlockers.map((blocker) => launchControlByBlocker[blocker]));
  const problems: string[] = [];

  for (const item of parsedWorkbook.items) {
    if (blockedControls.has(item.controlId) && item.status !== "OPEN") {
      problems.push(`BLOCKED_CONTROL_NOT_OPEN:${item.controlId}`);
    }
    if (!blockedControls.has(item.controlId) && item.status !== "COMPLETE") {
      problems.push(`SATISFIED_CONTROL_NOT_COMPLETE:${item.controlId}`);
    }
  }

  return {
    aligned: problems.length === 0,
    openControlIds: parsedWorkbook.items
      .filter((item) => item.status === "OPEN")
      .map((item) => item.controlId),
    problems,
  };
}

export function evaluateControlledLaunchV1(
  pilotManifest: PilotReadinessManifestV1,
  launchPlan: ControlledLaunchPlanV1,
  checkedAt: string,
): {
  decision: "NO_GO" | "READY_TO_ENABLE" | "ACTIVE";
  blockers: ControlledLaunchBlockerV1[];
} {
  const pilot = evaluatePilotReadinessV1(pilotReadinessManifestV1Schema.parse(pilotManifest));
  const plan = controlledLaunchPlanV1Schema.parse(launchPlan);
  const checkedAtInstant = z.iso.datetime({ offset: true }).parse(checkedAt);
  const blockers: ControlledLaunchBlockerV1[] = [];

  if (pilot.decision !== "PILOT_READY") blockers.push("PHASE_9_NOT_PILOT_READY");
  if (plan.authorization.status !== "GRANTED") blockers.push("PRODUCTION_AUTHORIZATION_NOT_GRANTED");
  if (plan.authorization.status === "GRANTED"
    && (checkedAtInstant < plan.authorization.approvedAt
      || checkedAtInstant >= plan.authorization.expiresAt)) {
    blockers.push("PRODUCTION_AUTHORIZATION_NOT_CURRENT");
  }
  if (plan.target.tenantRefs.length === 0) blockers.push("TENANT_COHORT_NOT_DEFINED");
  if (plan.target.branchRefs.length === 0) blockers.push("BRANCH_COHORT_NOT_DEFINED");
  if (plan.target.capabilities.length === 0) blockers.push("CAPABILITY_SET_NOT_DEFINED");
  if (plan.window.startsAt === null || plan.window.endsAt === null) blockers.push("LAUNCH_WINDOW_NOT_DEFINED");
  if (plan.window.startsAt !== null && plan.window.endsAt !== null
    && (checkedAtInstant < plan.window.startsAt || checkedAtInstant >= plan.window.endsAt)) {
    blockers.push("LAUNCH_WINDOW_NOT_ACTIVE");
  }
  if (plan.monitoring.sloRef === null || plan.monitoring.thresholds.length === 0) {
    blockers.push("MONITORING_GATES_NOT_DEFINED");
  }
  if (plan.rollback.authorityRole === null || plan.rollback.runbookRef === null
    || plan.rollback.triggers.length === 0) {
    blockers.push("ROLLBACK_CONTROL_NOT_DEFINED");
  }
  if (plan.stages.length === 0) blockers.push("ROLLOUT_STAGES_NOT_DEFINED");

  if (blockers.length > 0) return { decision: "NO_GO", blockers };
  return { decision: plan.productionEnabled ? "ACTIVE" : "READY_TO_ENABLE", blockers: [] };
}

export const handoffArtifactV1Schema = z.object({
  path: releaseEvidenceRefSchema.refine((value) => !value.startsWith("https://"), {
    message: "handoff artifacts must be repository-local",
  }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  purpose: z.string().min(3).max(240),
}).strict();

export const engineeringHandoffManifestV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(11),
  mode: z.literal("ENGINEERING_HANDOFF"),
  generatedAt: z.iso.datetime({ offset: true }),
  productionAuthorized: z.literal(false),
  artifacts: z.array(handoffArtifactV1Schema).min(1).max(200),
  unresolvedGateRefs: z.array(
    releaseEvidenceRefSchema.refine((value) => !value.startsWith("https://")),
  ).min(1).max(20),
  verificationCommands: z.array(z.string().min(3).max(200)).min(1).max(20),
}).strict().superRefine((manifest, context) => {
  const paths = new Set<string>();
  manifest.artifacts.forEach((artifact, index) => {
    if (paths.has(artifact.path)) {
      context.addIssue({
        code: "custom",
        path: ["artifacts", index, "path"],
        message: "handoff artifact path must be unique",
      });
    }
    paths.add(artifact.path);
  });
});

export type EngineeringHandoffManifestV1 = z.infer<typeof engineeringHandoffManifestV1Schema>;

export const supplyChainPolicyV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(12),
  mode: z.literal("SUPPLY_CHAIN_VERIFICATION"),
  productionAuthorized: z.literal(false),
  lockfileVersion: z.literal(3),
  allowedRegistryPrefixes: z.array(z.string().url().startsWith("https://")).min(1).max(10),
  requireExactDirectVersions: z.literal(true),
  requireSha512Integrity: z.literal(true),
  auditLevel: z.literal("high"),
  allowedInstallScripts: z.array(z.object({
    package: z.string().min(1).max(160),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    reason: z.string().min(10).max(300),
  }).strict()).max(20),
}).strict().superRefine((policy, context) => {
  const keys = new Set<string>();
  policy.allowedInstallScripts.forEach((entry, index) => {
    const key = `${entry.package}@${entry.version}`;
    if (keys.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["allowedInstallScripts", index],
        message: "install-script exception must be unique",
      });
    }
    keys.add(key);
  });
});

export type SupplyChainPolicyV1 = z.infer<typeof supplyChainPolicyV1Schema>;

export const secretScanRuleIdSchema = z.enum([
  "pem-private-key",
  "aws-access-key",
  "github-token",
  "slack-token",
  "stripe-live-secret",
  "google-api-key",
  "npm-token",
]);

export const secretScanPolicyV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(13),
  mode: z.literal("SECRET_HYGIENE"),
  productionAuthorized: z.literal(false),
  roots: z.array(
    releaseEvidenceRefSchema.refine((value) => !value.startsWith("https://")),
  ).min(1).max(100),
  excludedDirectories: z.array(z.string().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/)).max(30),
  allowedExtensions: z.array(z.string().regex(/^\.[A-Za-z0-9]+$/)).min(1).max(30),
  allowedFileNames: z.array(z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/)).max(30),
  maximumFileBytes: z.number().int().positive().max(5_000_000),
  rules: z.array(secretScanRuleIdSchema).min(1).max(secretScanRuleIdSchema.options.length),
  exceptions: z.array(z.object({
    ruleId: secretScanRuleIdSchema,
    path: releaseEvidenceRefSchema.refine((value) => !value.startsWith("https://")),
    matchSha256: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().min(10).max(300),
  }).strict()).max(50),
}).strict().superRefine((policy, context) => {
  for (const [field, values] of [
    ["roots", policy.roots],
    ["excludedDirectories", policy.excludedDirectories],
    ["allowedExtensions", policy.allowedExtensions],
    ["allowedFileNames", policy.allowedFileNames],
    ["rules", policy.rules],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [field], message: `${field} entries must be unique` });
    }
  }
  const exceptionKeys = new Set<string>();
  policy.exceptions.forEach((exception, index) => {
    const key = `${exception.ruleId}:${exception.path}:${exception.matchSha256}`;
    if (exceptionKeys.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["exceptions", index],
        message: "secret-scan exception must be unique",
      });
    }
    exceptionKeys.add(key);
  });
});

export type SecretScanPolicyV1 = z.infer<typeof secretScanPolicyV1Schema>;
export type SecretScanRuleId = z.infer<typeof secretScanRuleIdSchema>;

export const dependencyLicensePolicyV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(14),
  mode: z.literal("DEPENDENCY_LICENSE_VERIFICATION"),
  productionAuthorized: z.literal(false),
  lockfileVersion: z.literal(3),
  packageLockSha256: z.string().regex(/^[a-f0-9]{64}$/),
  allowedLicenses: z.array(z.string().min(2).max(120)).min(1).max(50),
  deniedLicenseTokens: z.array(z.string().min(2).max(80)).min(1).max(30),
  workspacePathPrefixes: z.array(z.string().min(2).max(160)).min(1).max(30),
  allowMissingLicenseForWorkspacePackages: z.literal(true),
}).strict().superRefine((policy, context) => {
  for (const [field, values] of [
    ["allowedLicenses", policy.allowedLicenses],
    ["deniedLicenseTokens", policy.deniedLicenseTokens],
    ["workspacePathPrefixes", policy.workspacePathPrefixes],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [field], message: `${field} entries must be unique` });
    }
  }
});

export type DependencyLicensePolicyV1 = z.infer<typeof dependencyLicensePolicyV1Schema>;

export const reproducibleBuildPolicyV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(15),
  mode: z.literal("REPRODUCIBLE_BUILD_VERIFICATION"),
  productionAuthorized: z.literal(false),
  buildCommand: z.literal("npm run build"),
  iterations: z.literal(2),
  artifacts: z.array(
    releaseEvidenceRefSchema.refine((value) => value.startsWith("dist/") && !value.startsWith("https://")),
  ).min(1).max(50),
  hashAlgorithm: z.literal("sha256"),
}).strict().superRefine((policy, context) => {
  if (new Set(policy.artifacts).size !== policy.artifacts.length) {
    context.addIssue({ code: "custom", path: ["artifacts"], message: "build artifacts must be unique" });
  }
});

export type ReproducibleBuildPolicyV1 = z.infer<typeof reproducibleBuildPolicyV1Schema>;

const fleetDeliveryEnvNameSchema = z.string().regex(/^FLEET_DELIVERY_[A-Z0-9_]+$/);

export const configurationContractV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(16),
  mode: z.literal("CONFIGURATION_CONTRACT"),
  productionAuthorized: z.literal(false),
  variables: z.array(fleetDeliveryEnvNameSchema).min(1).max(100),
  secretVariables: z.array(fleetDeliveryEnvNameSchema).max(50),
  productionRequiredVariables: z.array(fleetDeliveryEnvNameSchema).max(50),
  composeRequiredVariables: z.array(fleetDeliveryEnvNameSchema).max(100),
}).strict().superRefine((contract, context) => {
  const variables = new Set(contract.variables);
  for (const [field, values] of [
    ["variables", contract.variables],
    ["secretVariables", contract.secretVariables],
    ["productionRequiredVariables", contract.productionRequiredVariables],
    ["composeRequiredVariables", contract.composeRequiredVariables],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [field], message: `${field} entries must be unique` });
    }
    if (field !== "variables") {
      for (const value of values) {
        if (!variables.has(value)) {
          context.addIssue({ code: "custom", path: [field], message: `${value} is not in variables` });
        }
      }
    }
  }
});

export type ConfigurationContractV1 = z.infer<typeof configurationContractV1Schema>;

const apiRouteMatcherV1Schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("STATIC"), literal: z.string().startsWith("/").max(240) }).strict(),
  z.object({
    type: z.literal("DYNAMIC"),
    variable: z.string().regex(/^[a-z][A-Za-z0-9]+Match$/),
    regexSource: z.string().min(3).max(500),
  }).strict(),
]);

export const apiRouteInventoryV1Schema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  phase: z.literal(17),
  mode: z.literal("API_AUTHORIZATION_CONTRACT"),
  productionAuthorized: z.literal(false),
  routes: z.array(z.object({
    id: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    pathTemplate: z.string().startsWith("/").max(240),
    matcher: apiRouteMatcherV1Schema,
    access: z.enum(["PUBLIC_HEALTH", "SERVICE", "CUSTOMER_GRANT"]),
    scope: z.string().min(3).max(120).nullable(),
    idempotencyRequired: z.boolean(),
  }).strict()).min(1).max(100),
}).strict().superRefine((inventory, context) => {
  const ids = new Set<string>();
  const routeKeys = new Set<string>();
  const matcherKeys = new Set<string>();
  inventory.routes.forEach((route, index) => {
    const routeKey = `${route.method} ${route.pathTemplate}`;
    const matcherKey = route.matcher.type === "STATIC"
      ? `STATIC:${route.matcher.literal}`
      : `DYNAMIC:${route.matcher.variable}`;
    if (ids.has(route.id)) {
      context.addIssue({ code: "custom", path: ["routes", index, "id"], message: "route id must be unique" });
    }
    if (routeKeys.has(routeKey)) {
      context.addIssue({ code: "custom", path: ["routes", index, "pathTemplate"], message: "route key must be unique" });
    }
    if (matcherKeys.has(matcherKey)) {
      context.addIssue({ code: "custom", path: ["routes", index, "matcher"], message: "route matcher must be unique" });
    }
    if (route.access === "PUBLIC_HEALTH") {
      if (route.method !== "GET" || route.scope !== null || route.idempotencyRequired
        || !["/livez", "/readyz"].includes(route.pathTemplate)) {
        context.addIssue({ code: "custom", path: ["routes", index], message: "invalid public health route" });
      }
    } else if (route.scope === null || !route.pathTemplate.startsWith("/v1/")) {
      context.addIssue({ code: "custom", path: ["routes", index], message: "service route requires scope and /v1 path" });
    }
    if (route.access === "CUSTOMER_GRANT"
      && (!route.pathTemplate.startsWith("/v1/customer/")
        || !["QUOTE", "CREATE_DELIVERY", "TRACK"].includes(route.scope ?? ""))) {
      context.addIssue({ code: "custom", path: ["routes", index], message: "invalid customer-grant route" });
    }
    if (route.matcher.type === "STATIC" && route.matcher.literal !== route.pathTemplate) {
      context.addIssue({ code: "custom", path: ["routes", index, "matcher"], message: "static matcher must equal path template" });
    }
    ids.add(route.id);
    routeKeys.add(routeKey);
    matcherKeys.add(matcherKey);
  });
});

export type ApiRouteInventoryV1 = z.infer<typeof apiRouteInventoryV1Schema>;
export * from "./rideSandbox.js";
