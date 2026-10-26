import { scope, read } from "./bmsOperationChecklists";
import { commandImprovement } from "@/lib/bms/operationImprovement";
import {
  improvementWorkspace,
  improvementDetail,
  operationReadiness,
  operationWeeklyReport,
  improvementSources,
  improvementCatalog,
  improvementForRun,
} from "@/lib/bms/operationImprovementReads";
export const bmsOperationImprovementTypeDefs = /* GraphQL */ `
  enum BmsImprovementAction {
    PUBLISH_STANDARD
    ACK_STANDARD
    ASSESS_STANDARD
    RECORD_TRAINING
    CREATE_ISSUE
    UPDATE_ISSUE
    LINK_FAILURE
    CREATE_FOLLOWUP
    REOPEN_ISSUE
    CLOSE_ISSUE
    CONFIRM_WEEK
  }
  input BmsImprovementInput {
    action: BmsImprovementAction!
    idempotencyKey: String!
    confirmed: Boolean!
    id: ID
    version: Int
    locationId: ID
    familyId: ID
    dutyKey: String
    title: String
    body: String
    sourceType: String
    sourceId: ID
    trainingRequired: Boolean
    carryAcknowledgement: Boolean
    carryTraining: Boolean
    staffId: ID
    outcome: String
    note: String
    actionId: ID
    category: String
    severity: String
    ownerId: ID
    hypothesis: String
    cause: String
    templateId: ID
    dueAt: String
    assignedTo: ID
    target: String
    weeklyReviewId: ID
    from: String
    fingerprint: String
  }
  input BmsImprovementFilter {
    locationId: ID
    search: String
    offset: Int
  }
  extend type Query {
    bmsImprovementForRun(id: ID!): JSON
    bmsImprovementWorkspace(filter: BmsImprovementFilter): JSON!
    bmsImprovementSources(filter: BmsImprovementFilter): JSON!
    bmsImprovementCatalog(kind: String!, locationId: ID!, search: String): JSON!
    bmsImprovementDetail(id: ID!, kind: String!): JSON!
    bmsOperationReadiness(locationId: ID!, staffId: ID!, dutyKey: String): JSON!
    bmsOperationWeeklyReport(from: String!, locationId: ID): JSON!
  }
  extend type Mutation {
    bmsImprovementCommand(
      input: BmsImprovementInput!
    ): BmsChecklistCommandResult!
  }
`;
export const bmsOperationImprovementResolvers = {
  Query: {
    bmsImprovementForRun: (_: unknown, a: any, c: any) =>
      read(async () => improvementForRun(await scope(c), a.id)),
    bmsImprovementWorkspace: (_: unknown, a: any, c: any) =>
      read(async () => improvementWorkspace(await scope(c), a.filter ?? {})),
    bmsImprovementSources: (_: unknown, a: any, c: any) =>
      read(async () => improvementSources(await scope(c), a.filter ?? {})),
    bmsImprovementCatalog: (_: unknown, a: any, c: any) =>
      read(async () =>
        improvementCatalog(
          await scope(c),
          a.kind,
          a.locationId,
          a.search ?? "",
        ),
      ),
    bmsImprovementDetail: (_: unknown, a: any, c: any) =>
      read(async () => improvementDetail(await scope(c), a.id, a.kind)),
    bmsOperationReadiness: (_: unknown, a: any, c: any) =>
      read(async () =>
        operationReadiness(await scope(c), a.locationId, a.staffId, a.dutyKey),
      ),
    bmsOperationWeeklyReport: (_: unknown, a: any, c: any) =>
      read(async () =>
        operationWeeklyReport(await scope(c), a.from, a.locationId),
      ),
  },
  Mutation: {
    bmsImprovementCommand: async (_: unknown, a: any, c: any) =>
      commandImprovement(await scope(c), a.input),
  },
};
