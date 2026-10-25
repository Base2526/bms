import { scope, read } from "./bmsOperationChecklists";
import { commandMaterial } from "@/lib/bms/operationMaterials";
import {
  materialWorkspace,
  materialDetail,
  materialPreview,
  materialCatalog,
  materialForRun,
} from "@/lib/bms/operationMaterialReads";
export const bmsOperationMaterialsTypeDefs = /* GraphQL */ `
  enum BmsMaterialAction {
    CREATE
    CONFIRM
    REFRESH
    CLOSE
    CANCEL
    CREATE_PO
    LINK_PO
    LINK_REQUISITION
    INSPECT
    RECEIVE
    CANCEL_INSPECTION
  }
  input BmsMaterialSource {
    id: ID!
    priority: Int!
  }
  input BmsMaterialPreview {
    locationId: ID!
    from: String!
    to: String!
    sources: [BmsMaterialSource!]!
  }
  input BmsMaterialInput {
    action: BmsMaterialAction!
    idempotencyKey: String!
    confirmed: Boolean!
    id: ID
    version: Int
    title: String
    locationId: ID
    from: String
    to: String
    sources: [BmsMaterialSource!]
    fingerprint: String
    templateId: ID
    assignedTo: ID
    dueAt: String
    sku: String
    size: String
    qty: Int
    supplierId: ID
    unitCost: Float
    poItemId: ID
    requisitionItemId: ID
    linkId: ID
    inspectionId: ID
    inspectionVersion: Int
    runVersion: Int
    expectedReceived: Int
    acceptedQty: Int
    rejectedQty: Int
    lotNo: String
    expiryDate: String
    note: String
  }
  input BmsMaterialFilter {
    locationId: ID
    search: String
    offset: Int
  }
  extend type Query {
    bmsMaterialWorkspace(filter: BmsMaterialFilter): JSON!
    bmsMaterialDetail(id: ID!): JSON!
    bmsMaterialPreview(input: BmsMaterialPreview!): JSON!
    bmsMaterialCatalog(kind: String!, locationId: ID!, search: String): JSON!
    bmsMaterialForRun(id: ID!): JSON
  }
  extend type Mutation {
    bmsMaterialCommand(input: BmsMaterialInput!): BmsChecklistCommandResult!
  }
`;
export const bmsOperationMaterialsResolvers = {
  Query: {
    bmsMaterialWorkspace: (_: unknown, a: any, c: any) =>
      read(async () => materialWorkspace(await scope(c), a.filter ?? {})),
    bmsMaterialDetail: (_: unknown, a: any, c: any) =>
      read(async () => materialDetail(await scope(c), a.id)),
    bmsMaterialPreview: (_: unknown, a: any, c: any) =>
      read(async () => materialPreview(await scope(c), a.input)),
    bmsMaterialCatalog: (_: unknown, a: any, c: any) =>
      read(async () =>
        materialCatalog(await scope(c), a.kind, a.locationId, a.search ?? ""),
      ),
    bmsMaterialForRun: (_: unknown, a: any, c: any) =>
      read(async () => materialForRun(await scope(c), a.id)),
  },
  Mutation: {
    bmsMaterialCommand: async (_: unknown, a: any, c: any) =>
      commandMaterial(await scope(c), a.input),
  },
};
