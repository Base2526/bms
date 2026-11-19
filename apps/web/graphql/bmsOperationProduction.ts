import { scope, read } from "./bmsOperationChecklists";
import { commandProduction } from "@/lib/bms/operationProduction";
import { factoryQcPolicy, setFactoryQcPolicy } from "@/lib/bms/factoryQcPolicy";
import { factoryBomDetail, saveFactoryBom } from "@/lib/bms/factoryBoms";
import { commandFactoryDemand, factoryDemandCustomers, factoryDemandWorkspace } from "@/lib/bms/factoryDemands";
import { factoryMachines, saveFactoryMachine } from "@/lib/bms/factoryMachines";
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
    factoryBomId: ID
    factoryDemandId: ID
    machineId: ID
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
    startedAt: String
    endedAt: String
    rejectedQty: Int
    laborMinutes: Int
    energyKwh: Float
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
    recipeId: ID
    factoryBomId: ID
    plannedQty: Int!
    outputSku: String!
    outputSize: String!
  }
  input BmsFactoryQcPolicyInput {
    locationId: ID!
    sku: String!
    size: String!
    version: Int!
    required: Boolean!
    dueMinutes: Int!
    reviewerId: ID
    confirmed: Boolean!
    idempotencyKey: String!
  }
  input BmsFactoryBomInput {
    outputSku: String!
    outputSize: String!
    expectedActiveVersion: Int!
    outputQty: Int!
    ingredients: [BmsProductionIngredient!]!
    sopSteps: [String!]!
    confirmed: Boolean!
    idempotencyKey: String!
  }
  input BmsFactoryDemandInput {
    action: String!
    idempotencyKey: String!
    confirmed: Boolean!
    id: ID
    version: Int
    locationId: ID
    customerId: ID
    outputSku: String
    outputSize: String
    qty: Int
    dueAt: String
    note: String
  }
  input BmsFactoryMachineInput {
    id: ID
    version: Int
    locationId: ID!
    code: String!
    name: String!
    active: Boolean!
    confirmed: Boolean!
    idempotencyKey: String!
  }
  extend type Query {
    bmsProductionForRun(id: ID!): ID
    bmsProductionWorkspace(filter: BmsProductionFilter): JSON!
    bmsProductionPreview(input: BmsProductionPreviewInput!): JSON!
    bmsProductionDetail(id: ID!): JSON!
    bmsFactoryQcPolicy(locationId: ID!, sku: String!, size: String!): JSON!
    bmsFactoryBomDetail(id: ID!): JSON!
    bmsFactoryDemandWorkspace(locationId: ID, search: String, offset: Int): JSON!
    bmsFactoryDemandCustomers(search: String!): JSON!
    bmsFactoryMachines(locationId: ID!, search: String): JSON!
  }
  extend type Mutation {
    bmsProductionCommand(input: BmsProductionInput!): BmsChecklistCommandResult!
    bmsSetFactoryQcPolicy(input: BmsFactoryQcPolicyInput!): BmsChecklistCommandResult!
    bmsSaveFactoryBom(input: BmsFactoryBomInput!): BmsChecklistCommandResult!
    bmsFactoryDemandCommand(input: BmsFactoryDemandInput!): BmsChecklistCommandResult!
    bmsSaveFactoryMachine(input: BmsFactoryMachineInput!): BmsChecklistCommandResult!
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
    bmsFactoryQcPolicy: (_: unknown, a: any, c: any) =>
      read(async () => factoryQcPolicy(await scope(c), a.locationId, a.sku, a.size)),
    bmsFactoryBomDetail: (_: unknown, a: any, c: any) =>
      read(async () => factoryBomDetail(await scope(c), a.id)),
    bmsFactoryDemandWorkspace: (_: unknown, a: any, c: any) =>
      read(async () => factoryDemandWorkspace(await scope(c), a)),
    bmsFactoryDemandCustomers: (_: unknown, a: any, c: any) =>
      read(async () => factoryDemandCustomers(await scope(c), a.search)),
    bmsFactoryMachines: (_: unknown, a: any, c: any) =>
      read(async () => factoryMachines(await scope(c), a.locationId, a.search ?? "")),
  },
  Mutation: {
    bmsProductionCommand: async (_: unknown, a: any, c: any) =>
      commandProduction(await scope(c), a.input),
    bmsSetFactoryQcPolicy: async (_: unknown, a: any, c: any) =>
      setFactoryQcPolicy(await scope(c), a.input),
    bmsSaveFactoryBom: async (_: unknown, a: any, c: any) =>
      saveFactoryBom(await scope(c), a.input),
    bmsFactoryDemandCommand: async (_: unknown, a: any, c: any) =>
      commandFactoryDemand(await scope(c), a.input),
    bmsSaveFactoryMachine: async (_: unknown, a: any, c: any) =>
      saveFactoryMachine(await scope(c), a.input),
  },
};
