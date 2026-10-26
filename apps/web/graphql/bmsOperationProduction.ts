import { scope, read } from "./bmsOperationChecklists";
import { commandProduction } from "@/lib/bms/operationProduction";
import {
  productionWorkspace,
  productionPreview,
  productionDetail,
  productionForRun,
} from "@/lib/bms/operationProductionReads";
export const bmsOperationProductionTypeDefs = /* GraphQL */ `
  enum BmsProductionAction {
    CREATE
    READY
    CANCEL
    POST
    WASTE
  }
  input BmsProductionIngredient {
    sku: String!
    size: String!
    qty: Int!
  }
  input BmsProductionInput {
    action: BmsProductionAction!
    idempotencyKey: String!
    confirmed: Boolean!
    id: ID
    version: Int
    locationId: ID
    recipeId: ID
    outputSku: String
    outputSize: String
    plannedQty: Int
    templateId: ID
    dueAt: String
    assignedTo: ID
    dutyKey: String
    actualQty: Int
    ingredients: [BmsProductionIngredient!]
    producedOn: String
    expiryDate: String
    note: String
    qty: Int
    actionId: ID
  }
  input BmsProductionFilter {
    from: String
    to: String
    locationId: ID
    search: String
    recipeSearch: String
    outputSearch: String
    offset: Int
    mine: Boolean
    status: String
  }
  input BmsProductionPreviewInput {
    locationId: ID!
    recipeId: ID!
    plannedQty: Int!
    outputSku: String!
    outputSize: String!
  }
  extend type Query {
    bmsProductionForRun(id: ID!): ID
    bmsProductionWorkspace(filter: BmsProductionFilter): JSON!
    bmsProductionPreview(input: BmsProductionPreviewInput!): JSON!
    bmsProductionDetail(id: ID!): JSON!
  }
  extend type Mutation {
    bmsProductionCommand(input: BmsProductionInput!): BmsChecklistCommandResult!
  }
`;
export const bmsOperationProductionResolvers = {
  Query: {
    bmsProductionForRun: (_: unknown, a: any, c: any) =>
      read(async () => productionForRun(await scope(c), a.id)),
    bmsProductionWorkspace: (_: unknown, a: any, c: any) =>
      read(async () => productionWorkspace(await scope(c), a.filter ?? {})),
    bmsProductionPreview: (_: unknown, a: any, c: any) =>
      read(async () => productionPreview(await scope(c), a.input)),
    bmsProductionDetail: (_: unknown, a: any, c: any) =>
      read(async () => productionDetail(await scope(c), a.id)),
  },
  Mutation: {
    bmsProductionCommand: async (_: unknown, a: any, c: any) =>
      commandProduction(await scope(c), a.input),
  },
};
