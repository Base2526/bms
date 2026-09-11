import { requireAuth } from "@/lib/auth";
import {
  deleteCommissionRule,
  getCommissionReport,
  listCommissionRules,
  upsertCommissionRule,
  type CommissionScope,
} from "@/lib/bms/commission";
import { listLocations } from "@/lib/bms/locations";
import { requirePermission } from "@/lib/bms/permissions";
import { getPosReturnAuditSummary, getPosReturnSummary } from "@/lib/bms/reports";
import { listRestaurantRequests, reviewRestaurantRequest } from "@/lib/bms/restaurantRequests";
import {
  applyStockCount,
  cancelStockCount,
  createStockCount,
  listStockCounts,
  recordCountItem,
  type StockCountStatus,
} from "@/lib/bms/stockCounts";
import {
  cancelStockTransfer,
  createStockTransfer,
  listStockTransfers,
  receiveStockTransfer,
  sendStockTransfer,
  type StockTransferStatus,
} from "@/lib/bms/stockTransfers";
import { findStoreCredit, getStoreCreditOutstanding, issueStoreCredit } from "@/lib/bms/storeCredit";
import { getStoreProfile } from "@/lib/bms/storeProfile";
import { getTenantId } from "@/lib/bms/tenant";
import { mobileGraphqlError } from "./mobileErrorContract";

export const bmsMobileOperationsTypeDefs = /* GraphQL */ `
  input BmsStockTransferLineInput {
    sku: String!
    size: String!
    qty: Int!
  }

  input BmsStockTransferReceiptLineInput {
    itemId: Int!
    qty: Int!
    damagedQty: Int
    reason: String
    note: String
  }

  input BmsStockTransferInput {
    action: String!
    fromLocationId: ID
    toLocationId: ID
    items: [BmsStockTransferLineInput!]
    note: String
    transferId: ID
    received: [BmsStockTransferReceiptLineInput!]
    receivingNote: String
  }

  input BmsStockCountInput {
    action: String!
    locationId: ID
    countId: ID
    sku: String
    size: String
    countedQty: Int
    note: String
  }

  input BmsCreateStockTransferInput {
    fromLocationId: ID!
    toLocationId: ID!
    items: [BmsStockTransferLineInput!]!
    note: String
  }

  input BmsReceiveStockTransferInput {
    transferId: ID!
    received: [BmsStockTransferReceiptLineInput!]
    receivingNote: String
  }

  input BmsCreateStockCountInput {
    locationId: ID!
    note: String
  }

  input BmsRecordStockCountItemInput {
    countId: ID!
    sku: String!
    size: String!
    countedQty: Int!
    note: String
  }

  input BmsReviewRestaurantRequestInput {
    locationId: ID!
    id: ID!
    version: Int!
    action: String!
    quantities: [Int!]
    note: String!
    kitchenNote: String
    confirmed: Boolean!
  }

  input BmsIssueStoreCreditInput {
    amount: Float!
    customerId: ID
    code: String
    expiresAt: String
    note: String
  }

  input BmsCommissionRuleInput {
    action: String
    id: Int
    scope: String
    ref: String
    percent: Float
    effectiveFrom: String
    note: String
  }

  extend type Query {
    bmsStockTransfers(status: String): JSON!
    bmsStockCounts(status: String): JSON!
    bmsMobileRestaurantRequests: JSON!
    bmsStoreCredit(code: String): JSON!
    bmsCommissionRules: JSON!
    bmsCommissionReport(from: String!, to: String!): JSON!
    bmsPosReturnSummary(from: String, to: String): JSON!
    bmsPosReturnAuditSummary(from: String, to: String): JSON!
  }

  extend type Mutation {
    bmsCreateStockTransfer(input: BmsCreateStockTransferInput!): JSON!
    bmsSendStockTransfer(transferId: ID!): JSON!
    bmsReceiveStockTransfer(input: BmsReceiveStockTransferInput!): JSON!
    bmsCancelStockTransfer(transferId: ID!): JSON!
    bmsCreateStockCount(input: BmsCreateStockCountInput!): JSON!
    bmsRecordStockCountItem(input: BmsRecordStockCountItemInput!): JSON!
    bmsApplyStockCount(countId: ID!): JSON!
    bmsCancelStockCount(countId: ID!): JSON!
    bmsStockTransfer(input: BmsStockTransferInput!): JSON! @deprecated(reason: "Use the named stock-transfer mutations")
    bmsStockCount(input: BmsStockCountInput!): JSON! @deprecated(reason: "Use the named stock-count mutations")
    bmsReviewRestaurantRequest(input: BmsReviewRestaurantRequestInput!): JSON!
    bmsIssueStoreCredit(input: BmsIssueStoreCreditInput!): JSON!
    bmsCommissionRule(input: BmsCommissionRuleInput!): JSON!
  }
`;

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw mobileGraphqlError("input ไม่ถูกต้อง", "BAD_USER_INPUT");
  }
  return value as Record<string, unknown>;
}

function actorId(ctx: any): string {
  return String(requireAuth(ctx).author_id);
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidInput(value: unknown, message: string): string {
  const parsed = typeof value === "string" ? value.trim() : "";
  if (!UUID_RE.test(parsed)) {
    throw mobileGraphqlError(message, "BAD_USER_INPUT");
  }
  return parsed;
}

const TRANSFER_STATUSES: StockTransferStatus[] = ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];
const COUNT_STATUSES: StockCountStatus[] = ["DRAFT", "APPLIED", "CANCELLED"];
const COMMISSION_SCOPES: CommissionScope[] = ["DEFAULT", "PRODUCT", "CATEGORY"];

export const bmsMobileOperationsResolvers = {
  Query: {
    async bmsStockTransfers(_parent: unknown, args: { status?: string | null }, ctx: any) {
      await requirePermission(ctx, "inventory.transfer");
      const tenantId = getTenantId(ctx);
      const status = TRANSFER_STATUSES.includes(args.status as StockTransferStatus)
        ? args.status as StockTransferStatus
        : null;
      const [transfers, locations] = await Promise.all([
        listStockTransfers(tenantId, status),
        listLocations(tenantId),
      ]);
      return { transfers, locations };
    },

    async bmsStockCounts(_parent: unknown, args: { status?: string | null }, ctx: any) {
      await requirePermission(ctx, "inventory.count");
      const tenantId = getTenantId(ctx);
      const status = COUNT_STATUSES.includes(args.status as StockCountStatus)
        ? args.status as StockCountStatus
        : null;
      const [counts, locations] = await Promise.all([
        listStockCounts(tenantId, status),
        listLocations(tenantId),
      ]);
      return { counts, locations };
    },

    async bmsMobileRestaurantRequests(_parent: unknown, _args: unknown, ctx: any) {
      await requirePermission(ctx, "order.view");
      const tenantId = getTenantId(ctx);
      const enabled = (await getStoreProfile(tenantId)).businessArchetype === "restaurant";
      return {
        enabled,
        requests: enabled ? await listRestaurantRequests({ tenantId, actorUserId: actorId(ctx) }) : [],
      };
    },

    async bmsStoreCredit(_parent: unknown, args: { code?: string | null }, ctx: any) {
      await requirePermission(ctx, "storecredit.redeem");
      const tenantId = getTenantId(ctx);
      if (args.code?.trim()) return { credit: await findStoreCredit(tenantId, args.code) };
      return { outstanding: await getStoreCreditOutstanding(tenantId) };
    },

    async bmsCommissionRules(_parent: unknown, _args: unknown, ctx: any) {
      await requirePermission(ctx, "commission.view");
      return { rules: await listCommissionRules(getTenantId(ctx)) };
    },

    async bmsCommissionReport(_parent: unknown, args: { from: string; to: string }, ctx: any) {
      await requirePermission(ctx, "commission.view");
      if (!isDate(args.from) || !isDate(args.to) || args.from > args.to) {
        throw mobileGraphqlError("ช่วงวันที่ไม่ถูกต้อง", "BAD_USER_INPUT");
      }
      return { report: await getCommissionReport(getTenantId(ctx), args.from, args.to) };
    },

    async bmsPosReturnSummary(_parent: unknown, args: { from?: string | null; to?: string | null }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getPosReturnSummary(getTenantId(ctx), args.from ?? null, args.to ?? null);
    },

    async bmsPosReturnAuditSummary(_parent: unknown, args: { from?: string | null; to?: string | null }, ctx: any) {
      await requirePermission(ctx, "report.view");
      return getPosReturnAuditSummary(getTenantId(ctx), args.from ?? null, args.to ?? null);
    },
  },

  Mutation: {
    async bmsStockTransfer(_parent: unknown, args: { input: unknown }, ctx: any) {
      await requirePermission(ctx, "inventory.transfer");
      const input = inputRecord(args.input);
      const tenantId = getTenantId(ctx);
      const actingUserId = actorId(ctx);
      const action = String(input.action ?? "");
      if (action === "create") {
        return createStockTransfer({
          tenantId,
          fromLocationId: uuidInput(input.fromLocationId, "สาขาต้นทางไม่ถูกต้อง"),
          toLocationId: uuidInput(input.toLocationId, "สาขาปลายทางไม่ถูกต้อง"),
          items: Array.isArray(input.items) ? input.items as any[] : [],
          note: typeof input.note === "string" ? input.note : null,
          createdBy: actingUserId,
        });
      }
      const transferId = uuidInput(input.transferId, "transferId ไม่ถูกต้อง");
      if (action === "send") return sendStockTransfer({ tenantId, transferId, actorUserId: actingUserId });
      if (action === "receive") return receiveStockTransfer({
        tenantId,
        transferId,
        actorUserId: actingUserId,
        received: Array.isArray(input.received) ? input.received as any[] : undefined,
        receivingNote: typeof input.receivingNote === "string" ? input.receivingNote : null,
      });
      if (action === "cancel") return cancelStockTransfer({ tenantId, transferId, actorUserId: actingUserId });
      throw mobileGraphqlError("action ไม่ถูกต้อง", "BAD_USER_INPUT");
    },

    async bmsStockCount(_parent: unknown, args: { input: unknown }, ctx: any) {
      const input = inputRecord(args.input);
      const action = String(input.action ?? "");
      await requirePermission(ctx, action === "apply" ? "inventory.count.apply" : "inventory.count");
      const tenantId = getTenantId(ctx);
      const actingUserId = actorId(ctx);
      if (action === "create") return createStockCount({
        tenantId,
        locationId: uuidInput(input.locationId, "สาขาไม่ถูกต้อง"),
        note: typeof input.note === "string" ? input.note : null,
        createdBy: actingUserId,
      });
      const countId = uuidInput(input.countId, "countId ไม่ถูกต้อง");
      if (action === "item") return recordCountItem({
        tenantId,
        countId,
        sku: String(input.sku ?? ""),
        size: String(input.size ?? ""),
        countedQty: Number(input.countedQty ?? 0),
        note: typeof input.note === "string" ? input.note : null,
        actorUserId: actingUserId,
      });
      if (action === "apply") return applyStockCount({ tenantId, countId, actorUserId: actingUserId });
      if (action === "cancel") return cancelStockCount({ tenantId, countId, actorUserId: actingUserId });
      throw mobileGraphqlError("action ไม่ถูกต้อง", "BAD_USER_INPUT");
    },

    async bmsReviewRestaurantRequest(_parent: unknown, args: { input: unknown }, ctx: any) {
      await requirePermission(ctx, "order.create");
      const input = inputRecord(args.input);
      return reviewRestaurantRequest({
        tenantId: getTenantId(ctx),
        actorUserId: actorId(ctx),
        locationId: uuidInput(input.locationId, "สาขาไม่ถูกต้อง"),
        id: uuidInput(input.id, "คำขอไม่ถูกต้อง"),
        version: input.version as any,
        action: input.action as any,
        quantities: input.quantities as any,
        note: typeof input.note === "string" ? input.note : "",
        kitchenNote: typeof input.kitchenNote === "string" ? input.kitchenNote : undefined,
        confirmed: input.confirmed === true,
      });
    },

    async bmsIssueStoreCredit(_parent: unknown, args: { input: unknown }, ctx: any) {
      await requirePermission(ctx, "storecredit.issue");
      const input = inputRecord(args.input);
      return issueStoreCredit({
        tenantId: getTenantId(ctx),
        amount: Number(input.amount ?? 0),
        customerId: typeof input.customerId === "string" && input.customerId.trim() ? input.customerId.trim() : null,
        code: typeof input.code === "string" ? input.code : null,
        expiresAt: typeof input.expiresAt === "string" ? input.expiresAt : null,
        note: typeof input.note === "string" ? input.note : null,
        issuedBy: actorId(ctx),
      });
    },

    async bmsCommissionRule(_parent: unknown, args: { input: unknown }, ctx: any) {
      await requirePermission(ctx, "commission.manage");
      const input = inputRecord(args.input);
      const tenantId = getTenantId(ctx);
      if (input.action === "delete") {
        const id = Number(input.id);
        if (!Number.isInteger(id)) throw mobileGraphqlError("id ไม่ถูกต้อง", "BAD_USER_INPUT");
        return { status: await deleteCommissionRule(tenantId, id) ? "DELETED" : "NOT_FOUND" };
      }
      const scope = String(input.scope ?? "").toUpperCase() as CommissionScope;
      if (!COMMISSION_SCOPES.includes(scope)) {
        throw mobileGraphqlError("scope ไม่ถูกต้อง", "BAD_USER_INPUT");
      }
      return upsertCommissionRule({
        tenantId,
        scope,
        ref: typeof input.ref === "string" ? input.ref : null,
        percent: Number(input.percent ?? 0),
        effectiveFrom: String(input.effectiveFrom ?? ""),
        note: typeof input.note === "string" ? input.note : null,
        createdBy: actorId(ctx),
      });
    },
  },
};

type CompatibilityResolver = (
  parent: unknown,
  args: Record<string, any>,
  ctx: any,
) => Promise<unknown>;

function namedMobileAction(
  resolver: CompatibilityResolver,
  action: string,
  parent: unknown,
  args: Record<string, any>,
  ctx: any,
) {
  return resolver(parent, { input: { ...(args.input ?? {}), action } }, ctx);
}

const compatibilityMutations = bmsMobileOperationsResolvers.Mutation as unknown as Record<string, CompatibilityResolver>;

Object.assign(bmsMobileOperationsResolvers.Mutation, {
    async bmsCreateStockTransfer(parent: unknown, args: Record<string, any>, ctx: any) {
      return namedMobileAction(compatibilityMutations.bmsStockTransfer, "create", parent, args, ctx);
    },
    async bmsSendStockTransfer(parent: unknown, args: Record<string, any>, ctx: any) {
      return namedMobileAction(compatibilityMutations.bmsStockTransfer, "send", parent, {
        input: { transferId: args.transferId },
      }, ctx);
    },
    async bmsReceiveStockTransfer(parent: unknown, args: Record<string, any>, ctx: any) {
      return namedMobileAction(compatibilityMutations.bmsStockTransfer, "receive", parent, args, ctx);
    },
    async bmsCancelStockTransfer(parent: unknown, args: Record<string, any>, ctx: any) {
      return namedMobileAction(compatibilityMutations.bmsStockTransfer, "cancel", parent, {
        input: { transferId: args.transferId },
      }, ctx);
    },
    async bmsCreateStockCount(parent: unknown, args: Record<string, any>, ctx: any) {
      return namedMobileAction(compatibilityMutations.bmsStockCount, "create", parent, args, ctx);
    },
    async bmsRecordStockCountItem(parent: unknown, args: Record<string, any>, ctx: any) {
      return namedMobileAction(compatibilityMutations.bmsStockCount, "item", parent, args, ctx);
    },
    async bmsApplyStockCount(parent: unknown, args: Record<string, any>, ctx: any) {
      return namedMobileAction(compatibilityMutations.bmsStockCount, "apply", parent, {
        input: { countId: args.countId },
      }, ctx);
    },
    async bmsCancelStockCount(parent: unknown, args: Record<string, any>, ctx: any) {
      return namedMobileAction(compatibilityMutations.bmsStockCount, "cancel", parent, {
        input: { countId: args.countId },
      }, ctx);
    },
});
