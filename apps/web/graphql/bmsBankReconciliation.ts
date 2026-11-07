import { GraphQLError } from "graphql/error";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import {
  archiveBankAccount,
  bankReconciliationReadiness,
  closeReconciliationPeriod,
  commitStatementImport,
  confirmReconciliationLink,
  createBankAccount,
  ignoreStatementEntry,
  listBankAccounts,
  listCandidates,
  listPeriods,
  listReconciliationLinks,
  listStatementEntries,
  listStatementImports,
  reconciliationSummary,
  reopenReconciliationPeriod,
  voidReconciliationLink,
  voidStatementImport,
} from "@/lib/bms/bankReconciliation";

function badInput(error: unknown): never {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const unexpectedDatabaseError =
    Boolean(code) &&
    code !== "40001" &&
    !code.startsWith("23") &&
    !code.startsWith("22");
  if (unexpectedDatabaseError) {
    // Never expose relation names, connection details, or SQL fragments to the
    // browser. SQLSTATE alone is enough for container diagnostics.
    console.error("[bank-reconciliation] database operation failed", {
      sqlstate: code.slice(0, 20),
    });
    throw new GraphQLError("ระบบกระทบยอดขัดข้องชั่วคราว กรุณาลองใหม่", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  const safeMessage =
    code === "40001"
      ? "ข้อมูลมีการเปลี่ยนแปลง กรุณาลองใหม่"
      : code.startsWith("23") || code.startsWith("22")
        ? "ข้อมูลขัดแย้งกับรายการที่มีอยู่ กรุณาตรวจสอบแล้วลองใหม่"
        : error instanceof Error
          ? error.message
          : "ข้อมูลกระทบยอดไม่ถูกต้อง";
  throw new GraphQLError(safeMessage, {
    extensions: {
      code:
        error instanceof Error && error.name === "FeatureDisabledError"
          ? "FEATURE_DISABLED"
          : "BAD_USER_INPUT",
    },
  });
}

export const bmsBankReconciliationTypeDefs = /* GraphQL */ `
  input BmsCreateBankAccountInput {
    bankCode: String!
    displayName: String!
    accountNumber: String!
    currency: String
    defaultLocationId: ID
  }
  input BmsBankEntryListInput {
    accountId: ID
    month: String
    status: String
    limit: Int
    offset: Int
  }
  input BmsConfirmBankMatchInput {
    entryId: ID!
    sourceKey: String!
    matchedAmount: String!
    sourceFingerprint: String!
  }
  type BmsBankAccount {
    id: ID!
    bankCode: String!
    displayName: String!
    accountLast4: String!
    currency: String!
    defaultLocationId: ID
    status: String!
    createdAt: String
  }
  type BmsBankStatementImport {
    id: ID!
    bankAccountId: ID!
    accountName: String!
    accountLast4: String!
    originalFilename: String!
    periodStart: String!
    periodEnd: String!
    rowCount: Int!
    status: String!
    createdAt: String!
    committedAt: String
    voidReason: String
  }
  type BmsBankStatementEntry {
    id: ID!
    importId: ID!
    bankAccountId: ID!
    postedOn: String!
    direction: String!
    amount: String!
    balanceAfter: String
    reference: String
    description: String!
    counterpartyMasked: String
    status: String!
    matchedAmount: String!
  }
  type BmsBankMatchCandidate {
    sourceKey: String!
    sourceType: String!
    sourceDate: String!
    amount: String!
    reference: String
    label: String!
    ruleCode: String!
    confidence: Int!
    sourceFingerprint: String!
  }
  type BmsBankReconciliationLink {
    id: ID!
    sourceKey: String!
    matchedAmount: String!
    ruleCode: String!
    confidence: Int!
    status: String!
    stale: Boolean!
    confirmedAt: String!
    voidedAt: String
    voidReason: String
  }
  type BmsBankReconciliationSummary {
    totalCount: Int!
    matchedCount: Int!
    unresolvedCount: Int!
    netMovement: String!
    matchedAmount: String!
  }
  type BmsBankReconciliationPeriod {
    bankAccountId: ID!
    periodMonth: String!
    status: String!
    openingBalance: String
    closingBalance: String
    version: Int!
    closedAt: String
    reopenedAt: String
    reopenReason: String
  }
  type BmsBankMutationResult {
    id: ID!
    status: String!
    replayed: Boolean
  }
  type BmsBankPeriodMutationResult {
    bankAccountId: ID!
    periodMonth: String!
    status: String!
    version: Int!
  }
  type BmsBankReconciliationReadiness {
    enabled: Boolean!
    fileImport: Boolean!
    supportedFormats: [String!]!
    deterministicMatching: Boolean!
    humanConfirmationRequired: Boolean!
    openBanking: String!
    sourceMutation: Boolean!
  }
  extend type Query {
    bmsBankAccounts(includeArchived: Boolean): [BmsBankAccount!]!
    bmsBankStatementImports(
      accountId: ID
      limit: Int
    ): [BmsBankStatementImport!]!
    bmsBankStatementEntries(
      input: BmsBankEntryListInput!
    ): [BmsBankStatementEntry!]!
    bmsBankMatchCandidates(entryId: ID!): [BmsBankMatchCandidate!]!
    bmsBankReconciliationLinks(entryId: ID!): [BmsBankReconciliationLink!]!
    bmsBankReconciliationSummary(
      accountId: ID
      month: String
    ): BmsBankReconciliationSummary!
    bmsBankReconciliationPeriods(accountId: ID): [BmsBankReconciliationPeriod!]!
    bmsBankReconciliationReadiness: BmsBankReconciliationReadiness!
  }
  extend type Mutation {
    bmsCreateBankAccount(input: BmsCreateBankAccountInput!): BmsBankAccount!
    bmsArchiveBankAccount(id: ID!): BmsBankMutationResult!
    bmsCommitBankStatementImport(
      id: ID!
      confirmed: Boolean!
    ): BmsBankMutationResult!
    bmsVoidBankStatementImport(
      id: ID!
      reason: String!
      confirmed: Boolean!
    ): BmsBankMutationResult!
    bmsConfirmBankMatch(
      input: BmsConfirmBankMatchInput!
      confirmed: Boolean!
    ): BmsBankMutationResult!
    bmsVoidBankMatch(
      id: ID!
      reason: String!
      confirmed: Boolean!
    ): BmsBankMutationResult!
    bmsIgnoreBankStatementEntry(
      id: ID!
      reason: String!
      confirmed: Boolean!
    ): BmsBankMutationResult!
    bmsCloseBankReconciliationPeriod(
      accountId: ID!
      month: String!
      confirmed: Boolean!
    ): BmsBankPeriodMutationResult!
    bmsReopenBankReconciliationPeriod(
      accountId: ID!
      month: String!
      reason: String!
      confirmed: Boolean!
    ): BmsBankPeriodMutationResult!
  }
`;

function requireConfirmed(confirmed: boolean) {
  if (confirmed !== true) throw new Error("ต้องยืนยันการทำรายการอย่างชัดเจน");
}
const tenant = (ctx: any) => getTenantId(ctx);
const actor = (ctx: any) => String(ctx.admin.id);

export const bmsBankReconciliationResolvers = {
  Query: {
    async bmsBankAccounts(
      _: unknown,
      a: { includeArchived?: boolean },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.view");
      try {
        return await listBankAccounts(tenant(ctx), a.includeArchived);
      } catch (e) {
        badInput(e);
      }
    },
    async bmsBankStatementImports(
      _: unknown,
      a: { accountId?: string; limit?: number },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.view");
      try {
        return await listStatementImports(tenant(ctx), a.accountId, a.limit);
      } catch (e) {
        badInput(e);
      }
    },
    async bmsBankStatementEntries(_: unknown, a: { input: any }, ctx: any) {
      await requirePermission(ctx, "bank_reconciliation.view");
      try {
        return await listStatementEntries(tenant(ctx), a.input);
      } catch (e) {
        badInput(e);
      }
    },
    async bmsBankMatchCandidates(_: unknown, a: { entryId: string }, ctx: any) {
      await requirePermission(ctx, "bank_reconciliation.review");
      try {
        return await listCandidates(tenant(ctx), a.entryId);
      } catch (e) {
        badInput(e);
      }
    },
    async bmsBankReconciliationLinks(
      _: unknown,
      a: { entryId: string },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.review");
      try {
        return await listReconciliationLinks(tenant(ctx), a.entryId);
      } catch (e) {
        badInput(e);
      }
    },
    async bmsBankReconciliationSummary(
      _: unknown,
      a: { accountId?: string; month?: string },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.view");
      try {
        return await reconciliationSummary(tenant(ctx), a.accountId, a.month);
      } catch (e) {
        badInput(e);
      }
    },
    async bmsBankReconciliationPeriods(
      _: unknown,
      a: { accountId?: string },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.view");
      try {
        return await listPeriods(tenant(ctx), a.accountId);
      } catch (e) {
        badInput(e);
      }
    },
    async bmsBankReconciliationReadiness(_: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "bank_reconciliation.view");
      return bankReconciliationReadiness();
    },
  },
  Mutation: {
    async bmsCreateBankAccount(_: unknown, a: { input: any }, ctx: any) {
      await requirePermission(ctx, "bank_reconciliation.import");
      try {
        return await createBankAccount(tenant(ctx), actor(ctx), a.input);
      } catch (e) {
        badInput(e);
      }
    },
    async bmsArchiveBankAccount(_: unknown, a: { id: string }, ctx: any) {
      await requirePermission(ctx, "bank_reconciliation.import");
      try {
        return await archiveBankAccount(tenant(ctx), actor(ctx), a.id);
      } catch (e) {
        badInput(e);
      }
    },
    async bmsCommitBankStatementImport(
      _: unknown,
      a: { id: string; confirmed: boolean },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.import");
      try {
        requireConfirmed(a.confirmed);
        return await commitStatementImport(tenant(ctx), actor(ctx), a.id);
      } catch (e) {
        badInput(e);
      }
    },
    async bmsVoidBankStatementImport(
      _: unknown,
      a: { id: string; reason: string; confirmed: boolean },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.import");
      try {
        requireConfirmed(a.confirmed);
        return await voidStatementImport(
          tenant(ctx),
          actor(ctx),
          a.id,
          a.reason,
        );
      } catch (e) {
        badInput(e);
      }
    },
    async bmsConfirmBankMatch(
      _: unknown,
      a: { input: any; confirmed: boolean },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.review");
      try {
        requireConfirmed(a.confirmed);
        return await confirmReconciliationLink(
          tenant(ctx),
          actor(ctx),
          a.input,
        );
      } catch (e) {
        badInput(e);
      }
    },
    async bmsVoidBankMatch(
      _: unknown,
      a: { id: string; reason: string; confirmed: boolean },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.review");
      try {
        requireConfirmed(a.confirmed);
        return await voidReconciliationLink(
          tenant(ctx),
          actor(ctx),
          a.id,
          a.reason,
        );
      } catch (e) {
        badInput(e);
      }
    },
    async bmsIgnoreBankStatementEntry(
      _: unknown,
      a: { id: string; reason: string; confirmed: boolean },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.review");
      try {
        requireConfirmed(a.confirmed);
        return await ignoreStatementEntry(
          tenant(ctx),
          actor(ctx),
          a.id,
          a.reason,
        );
      } catch (e) {
        badInput(e);
      }
    },
    async bmsCloseBankReconciliationPeriod(
      _: unknown,
      a: { accountId: string; month: string; confirmed: boolean },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.close");
      try {
        requireConfirmed(a.confirmed);
        return await closeReconciliationPeriod(
          tenant(ctx),
          actor(ctx),
          a.accountId,
          a.month,
        );
      } catch (e) {
        badInput(e);
      }
    },
    async bmsReopenBankReconciliationPeriod(
      _: unknown,
      a: {
        accountId: string;
        month: string;
        reason: string;
        confirmed: boolean;
      },
      ctx: any,
    ) {
      await requirePermission(ctx, "bank_reconciliation.close");
      try {
        requireConfirmed(a.confirmed);
        return await reopenReconciliationPeriod(
          tenant(ctx),
          actor(ctx),
          a.accountId,
          a.month,
          a.reason,
        );
      } catch (e) {
        badInput(e);
      }
    },
  },
};
