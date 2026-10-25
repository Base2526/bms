import { GraphQLError } from "graphql/error";
import { getTenantId } from "@/lib/bms/tenant";
import { loadPermissions, requirePermission } from "@/lib/bms/permissions";
import {
  checklistWorkspace,
  checklistDetail,
  commandChecklist,
} from "@/lib/bms/operationChecklists";
import { ChecklistError } from "@/lib/bms/operationChecklistPolicy";
import {
  checklistMyWork,
  checklistInbox,
  checklistSupervision,
  checklistInspectionReport,
  commandChecklistFollowup,
} from "@/lib/bms/operationChecklistFollowup";

export const bmsOperationChecklistsTypeDefs = /* GraphQL */ `
  enum BmsChecklistFollowupAction {
    SAVE_POLICY
    ESCALATE
    ACKNOWLEDGE
    READ_NOTICE
    REROUTE
  }
  enum BmsChecklistWorkBucket {
    MINE
    UNASSIGNED
    REVIEW
  }
  input BmsChecklistFollowupFilter {
    locationId: ID
    offset: Int
    bucket: BmsChecklistWorkBucket
    unreadOnly: Boolean
  }
  input BmsChecklistReportFilter {
    locationId: ID
    from: String!
    to: String!
  }
  input BmsChecklistFollowupInput {
    action: BmsChecklistFollowupAction!
    idempotencyKey: String!
    id: ID
    version: Int
    locationId: ID
    supervisorId: ID
    reminderMinutes: Int
    escalationMinutes: Int
    enabled: Boolean
    note: String
    confirmed: Boolean
  }
  type BmsChecklistWorkItem {
    id: ID!
    runId: ID!
    kind: String!
    name: String!
    locationId: ID!
    status: String!
    assignedTo: ID
    dueAt: String!
    version: Int!
    overdue: Boolean!
  }
  type BmsChecklistMyWork {
    items: [BmsChecklistWorkItem!]!
    total: Int!
    overdue: Int!
  }
  type BmsChecklistNotice {
    id: ID!
    runId: ID!
    kind: String!
    name: String!
    runStatus: String!
    createdAt: String!
    readAt: String
  }
  type BmsChecklistInbox {
    items: [BmsChecklistNotice!]!
    total: Int!
    unread: Int!
  }
  type BmsChecklistPolicy {
    locationId: ID!
    name: String!
    supervisorId: ID!
    reminderMinutes: Int!
    escalationMinutes: Int!
    enabled: Boolean!
    version: Int!
  }
  type BmsChecklistEscalation {
    id: ID!
    runId: ID!
    locationId: ID!
    name: String!
    recipient: ID!
    reason: String!
    source: String!
    status: String!
    version: Int!
    createdAt: String!
    acknowledgedAt: String
  }
  type BmsChecklistSupervision {
    policies: [BmsChecklistPolicy!]!
    escalations: [BmsChecklistEscalation!]!
    supervisors: [BmsChecklistOption!]!
    total: Int!
  }
  type BmsChecklistBranchReport {
    locationId: ID!
    name: String!
    total: Int!
    voided: Int!
    approved: Int!
    onTime: Int!
    overdue: Int!
    review: Int!
    failedRuns: Int!
    openActions: Int!
  }
  type BmsChecklistRecurringProblem {
    locationId: ID!
    branch: String!
    familyId: ID!
    itemKey: String!
    name: String!
    runs: Int!
    lastDue: String!
  }
  type BmsChecklistInspectionReport {
    from: String!
    to: String!
    timezone: String!
    generatedAt: String!
    branches: [BmsChecklistBranchReport!]!
    problems: [BmsChecklistRecurringProblem!]!
    problemsTruncated: Boolean!
  }
  enum BmsChecklistCommandAction {
    SAVE_TEMPLATE
    PUBLISH
    RETIRE
    CREATE_RUN
    ASSIGN
    START
    RECORD
    SUBMIT
    APPROVE
    REJECT
    VOID
    ACTION_START
    ACTION_RESOLVE
    ACTION_VERIFY
    ACTION_REOPEN
    ACTION_ASSIGN
    SAVE_SCHEDULE
    PAUSE_SCHEDULE
  }
  input BmsChecklistItemInput {
    key: String!
    label: String!
    type: String!
    required: Boolean!
    photoRequired: Boolean!
    allowNa: Boolean!
    min: Float
    max: Float
    unit: String
    choices: [String!]
    instruction: String
  }
  enum BmsChecklistAssignmentMode {
    FIXED
    DUTY
  }
  input BmsChecklistCommandInput {
    assignmentMode: BmsChecklistAssignmentMode
    dutyKey: String
    action: BmsChecklistCommandAction!
    idempotencyKey: String!
    id: ID
    version: Int
    confirmed: Boolean
    templateId: ID
    locationId: ID
    stationId: ID
    name: String
    category: String
    separateReviewer: Boolean
    items: [BmsChecklistItemInput!]
    dueAt: String
    assignedTo: ID
    itemKey: String
    value: JSON
    note: String
    photoIds: [Int!]
    timezone: String
    localTime: String
    weekdays: [Int!]
    dueMinutes: Int
  }
  input BmsChecklistFilter {
    locationId: ID
    search: String
    status: String
    offset: Int
  }
  type BmsChecklistCommandResult {
    status: String!
    id: ID
    version: Int
  }
  type BmsChecklistOption {
    id: ID!
    name: String!
    active: Boolean
    locationId: ID
  }
  type BmsChecklistTemplate {
    id: ID!
    familyId: ID!
    version: Int!
    locationId: ID!
    stationId: ID
    name: String!
    category: String!
    status: String!
    separateReviewer: Boolean!
    items: JSON!
    createdAt: String!
  }
  type BmsChecklistResult {
    id: ID!
    itemKey: String!
    revision: Int!
    value: JSON!
    outcome: String!
    note: String!
    photoIds: [Int!]!
    recordedBy: ID!
    recordedAt: String!
  }
  type BmsChecklistEvent {
    id: ID!
    action: String!
    actor: String!
    note: String!
    createdAt: String!
  }
  type BmsChecklistEvidence {
    fileId: Int!
    itemKey: String!
  }
  type BmsChecklistAction {
    id: ID!
    runId: ID!
    itemKey: String!
    status: String!
    version: Int!
    assignedTo: ID
    dueAt: String!
    instruction: String!
    resolution: String
    resolvedBy: ID
    verifiedBy: ID
    name: String
    locationId: ID
  }
  type BmsChecklistRun {
    assignmentEvidence: JSON!
    id: ID!
    templateId: ID!
    locationId: ID!
    stationId: ID
    snapshot: JSON!
    status: String!
    version: Int!
    assignedTo: ID
    dueAt: String!
    createdBy: String!
    createdAt: String!
    startedAt: String
    submittedAt: String
    reviewedAt: String
    reviewedBy: ID
    results: [BmsChecklistResult!]
    history: [BmsChecklistResult!]
    events: [BmsChecklistEvent!]
    actions: [BmsChecklistAction!]
    evidence: [BmsChecklistEvidence!]
  }
  type BmsChecklistSchedule {
    assignmentMode: BmsChecklistAssignmentMode!
    dutyKey: String
    id: ID!
    templateId: ID!
    name: String!
    assignedTo: ID
    timezone: String!
    localTime: String!
    weekdays: [Int!]!
    dueMinutes: Int!
    nextAt: String!
    active: Boolean!
    version: Int!
  }
  type BmsChecklistMetrics {
    open: Int!
    overdue: Int!
    review: Int!
    actions: Int!
  }
  type BmsChecklistWorkspace {
    locations: [BmsChecklistOption!]!
    stations: [BmsChecklistOption!]!
    staff: [BmsChecklistOption!]!
    templates: [BmsChecklistTemplate!]!
    runs: [BmsChecklistRun!]!
    schedules: [BmsChecklistSchedule!]!
    actions: [BmsChecklistAction!]!
    metrics: BmsChecklistMetrics!
    total: Int!
    actorId: ID!
  }
  extend type Query {
    bmsChecklistMyWork(filter: BmsChecklistFollowupFilter): BmsChecklistMyWork!
    bmsChecklistInbox(filter: BmsChecklistFollowupFilter): BmsChecklistInbox!
    bmsChecklistSupervision(
      filter: BmsChecklistFollowupFilter
    ): BmsChecklistSupervision!
    bmsChecklistInspectionReport(
      filter: BmsChecklistReportFilter!
    ): BmsChecklistInspectionReport!
    bmsChecklistWorkspace(filter: BmsChecklistFilter): BmsChecklistWorkspace!
    bmsChecklistRun(id: ID!): BmsChecklistRun
  }
  extend type Mutation {
    bmsChecklistFollowup(
      input: BmsChecklistFollowupInput!
    ): BmsChecklistCommandResult!
    bmsChecklistCommand(
      input: BmsChecklistCommandInput!
    ): BmsChecklistCommandResult!
  }
`;
export async function scope(ctx: any) {
  await requirePermission(ctx, "operations.checklist.view");
  return {
    tenantId: getTenantId(ctx),
    actorId: String(ctx.admin.id),
    permissions: await loadPermissions(ctx),
  };
}
export async function read<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (e) {
    if (e instanceof ChecklistError)
      throw new GraphQLError(e.status, {
        extensions: {
          code:
            e.status === "NOT_FOUND"
              ? "NOT_FOUND"
              : e.status === "FORBIDDEN"
                ? "FORBIDDEN"
                : "BAD_USER_INPUT",
        },
      });
    throw e;
  }
}
export const bmsOperationChecklistsResolvers = {
  Query: {
    bmsChecklistMyWork: async (_: unknown, args: any, ctx: any) =>
      read(async () => checklistMyWork(await scope(ctx), args.filter ?? {})),
    bmsChecklistInbox: async (_: unknown, args: any, ctx: any) =>
      read(async () => checklistInbox(await scope(ctx), args.filter ?? {})),
    bmsChecklistSupervision: async (_: unknown, args: any, ctx: any) =>
      read(async () =>
        checklistSupervision(await scope(ctx), args.filter ?? {}),
      ),
    bmsChecklistInspectionReport: async (_: unknown, args: any, ctx: any) =>
      read(async () =>
        checklistInspectionReport(await scope(ctx), args.filter),
      ),
    bmsChecklistWorkspace: async (_: unknown, args: any, ctx: any) =>
      read(async () => checklistWorkspace(await scope(ctx), args.filter ?? {})),
    bmsChecklistRun: async (_: unknown, args: any, ctx: any) =>
      read(async () => checklistDetail(await scope(ctx), args.id)),
  },
  Mutation: {
    bmsChecklistFollowup: async (_: unknown, args: any, ctx: any) =>
      commandChecklistFollowup(await scope(ctx), args.input),
    bmsChecklistCommand: async (_: unknown, args: any, ctx: any) =>
      commandChecklist(await scope(ctx), args.input),
  },
};
