import { GraphQLError } from "graphql/error";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { listLocationsForUser, userCanAccessLocation } from "@/lib/bms/locations";
import {
  createExpenseDocument, getExpenseTaxSummary, listExpenseDocuments, listExpenseSuppliers, voidExpenseDocument,
  type ExpenseDocumentInput,
} from "@/lib/bms/expenseDocuments";

const badInput = (err: unknown): never => {
  throw new GraphQLError(err instanceof Error ? err.message : "ข้อมูลเอกสารรายจ่ายไม่ถูกต้อง", {
    extensions: { code: "BAD_USER_INPUT" },
  });
};

async function expenseLocationScope(ctx: any) {
  return listLocationsForUser(getTenantId(ctx), String(ctx.admin.id));
}

export const bmsExpenseDocumentsTypeDefs = /* GraphQL */ `
  input BmsExpenseDocumentListInput {
    from: String!
    to: String!
    locationId: ID
    category: String
    search: String
    includeVoid: Boolean
    limit: Int
    offset: Int
  }
  input BmsCreateExpenseDocumentInput {
    locationId: ID!
    category: String!
    documentKind: String!
    supplierId: ID
    payeeName: String
    payeeTaxId: String
    payeeBranchCode: String
    payeeAddress: String
    payeeType: String
    documentNo: String
    documentDate: String!
    paidAt: String
    amountBeforeVat: Float!
    vatAmount: Float
    vatClaimMonth: String
    whtIncomeType: String
    whtRate: Float
    whtAmount: Float
    purchaseOrderId: ID
    evidenceFileId: Int
    note: String
    idempotencyKey: String!
  }
  type BmsExpenseDocument {
    id: ID!
    locationId: ID!
    locationCode: String!
    locationName: String!
    branchCode: String!
    category: String!
    documentKind: String!
    supplierId: ID
    payeeName: String!
    payeeTaxId: String
    payeeBranchCode: String
    payeeAddress: String
    payeeType: String
    documentNo: String
    documentDate: String!
    paidAt: String
    amountBeforeVat: Float!
    vatAmount: Float!
    vatClaimMonth: String
    whtIncomeType: String
    whtRate: Float
    whtAmount: Float!
    purchaseOrderId: ID
    evidenceFileId: Int
    note: String
    status: String!
    voidReason: String
    voidedAt: String
    createdAt: String!
  }
  type BmsExpenseDocumentList { total: Int!, rows: [BmsExpenseDocument!]! }
  type BmsExpenseTaxTotal {
    locationId: ID
    documentCount: Int!
    expenseBase: Float!
    vatPurchase: Float!
    wht: Float!
  }
  type BmsExpenseTaxSummary {
    totals: [BmsExpenseTaxTotal!]!
    grandTotal: BmsExpenseTaxTotal!
  }
  type BmsVoidExpenseDocumentResult { id: ID!, status: String! }
  type BmsExpenseEstablishment { locationId: ID!, code: String!, name: String!, branchCode: String!, isHeadOffice: Boolean! }

  extend type BmsSupplier {
    taxId: String
    branchCode: String
    address: String
    entityType: String
  }
  extend type Query {
    bmsExpenseEstablishments: [BmsExpenseEstablishment!]!
    bmsExpenseSuppliers: [BmsSupplier!]!
    bmsExpenseDocuments(input: BmsExpenseDocumentListInput!): BmsExpenseDocumentList!
    bmsExpenseTaxSummary(from: String!, to: String!, locationId: ID): BmsExpenseTaxSummary!
  }
  extend type Mutation {
    bmsCreateExpenseDocument(input: BmsCreateExpenseDocumentInput!): BmsExpenseDocument!
    bmsVoidExpenseDocument(id: ID!, reason: String!): BmsVoidExpenseDocumentResult!
  }
`;

export const bmsExpenseDocumentsResolvers = {
  Query: {
    async bmsExpenseEstablishments(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "expense.view");
      return (await expenseLocationScope(ctx)).map((l) => ({
        locationId: l.id, code: l.code, name: l.name, branchCode: l.branchCode, isHeadOffice: l.isHeadOffice,
      }));
    },
    async bmsExpenseSuppliers(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "expense.view");
      return listExpenseSuppliers(getTenantId(ctx));
    },
    async bmsExpenseDocuments(_p: unknown, a: { input: any }, ctx: any) {
      await requirePermission(ctx, "expense.view");
      try {
        const locations = await expenseLocationScope(ctx);
        if (a.input.locationId && !locations.some((l) => l.id === a.input.locationId)) throw new Error("ไม่มีสิทธิ์ดูสถานประกอบการนี้");
        return await listExpenseDocuments(getTenantId(ctx), { ...a.input, allowedLocationIds: locations.map((l) => l.id) });
      } catch (err) { badInput(err); }
    },
    async bmsExpenseTaxSummary(_p: unknown, a: { from: string; to: string; locationId?: string | null }, ctx: any) {
      await requirePermission(ctx, "expense.view");
      try {
        const locations = await expenseLocationScope(ctx);
        if (a.locationId && !locations.some((l) => l.id === a.locationId)) throw new Error("ไม่มีสิทธิ์ดูสถานประกอบการนี้");
        return await getExpenseTaxSummary(getTenantId(ctx), { ...a, allowedLocationIds: locations.map((l) => l.id) });
      } catch (err) { badInput(err); }
    },
  },
  Mutation: {
    async bmsCreateExpenseDocument(_p: unknown, a: { input: ExpenseDocumentInput }, ctx: any) {
      await requirePermission(ctx, "expense.manage");
      try {
        if (!(await userCanAccessLocation(getTenantId(ctx), String(ctx.admin.id), a.input.locationId))) throw new Error("ไม่มีสิทธิ์บันทึกที่สถานประกอบการนี้");
        return await createExpenseDocument(getTenantId(ctx), String(ctx.admin.id), a.input);
      } catch (err) { badInput(err); }
    },
    async bmsVoidExpenseDocument(_p: unknown, a: { id: string; reason: string }, ctx: any) {
      await requirePermission(ctx, "expense.manage");
      try {
        const locations = await expenseLocationScope(ctx);
        return await voidExpenseDocument(getTenantId(ctx), String(ctx.admin.id), a.id, a.reason, locations.map((l) => l.id));
      } catch (err) { badInput(err); }
    },
  },
};
