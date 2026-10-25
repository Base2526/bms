import { scope, read } from "./bmsOperationChecklists";
import { commandQuality } from "@/lib/bms/operationQuality";
import {
  qualityWorkspace,
  qualityDetail,
  qualityLots,
  readQualityTrace,
  qualityForRun,
} from "@/lib/bms/operationQualityReads";
export const bmsOperationQualityTypeDefs = /* GraphQL */ `
  enum BmsQualityAction {
    CREATE
    HOLD
    ASSIGN_RUN
    SUBMIT
    CLOSE
    REOPEN
    PROPOSE_RELEASE
    PROPOSE_DISPOSE
    APPROVE
    REJECT
    SAVE_TRACE
    UPDATE
  }
  input BmsQualityInput {
    action: BmsQualityAction!
    confirmed: Boolean!
    idempotencyKey: String!
    id: ID
    version: Int
    locationId: ID
    title: String
    category: String
    severity: String
    facts: String
    hypothesis: String
    observedCause: String
    assignedTo: ID
    dueAt: String
    lotId: ID
    expectedQty: Int
    holdId: ID
    holdVersion: Int
    decisionId: ID
    qty: Int
    templateId: ID
    runVersion: Int
    fingerprint: String
    sourceRunId: ID
    sourceInspectionId: ID
    sourceProductionId: ID
    note: String!
  }
  extend type Query {
    bmsQualityWorkspace(filter: BmsMaterialFilter): JSON!
    bmsQualityDetail(id: ID!): JSON!
    bmsQualityLots(locationId: ID!, search: String): JSON!
    bmsQualityTrace(lotId: ID!): JSON!
    bmsQualityForRun(id: ID!): JSON
  }
  extend type Mutation {
    bmsQualityCommand(input: BmsQualityInput!): BmsChecklistCommandResult!
  }
`;
export const bmsOperationQualityResolvers = {
  Query: {
    bmsQualityWorkspace: (_: unknown, a: any, c: any) =>
      read(async () => qualityWorkspace(await scope(c), a.filter ?? {})),
    bmsQualityDetail: (_: unknown, a: any, c: any) =>
      read(async () => qualityDetail(await scope(c), a.id)),
    bmsQualityLots: (_: unknown, a: any, c: any) =>
      read(async () =>
        qualityLots(await scope(c), a.locationId, a.search ?? ""),
      ),
    bmsQualityTrace: (_: unknown, a: any, c: any) =>
      read(async () => readQualityTrace(await scope(c), a.lotId)),
    bmsQualityForRun: (_: unknown, a: any, c: any) =>
      read(async () => qualityForRun(await scope(c), a.id)),
  },
  Mutation: {
    bmsQualityCommand: async (_: unknown, a: any, c: any) =>
      commandQuality(await scope(c), a.input),
  },
};
