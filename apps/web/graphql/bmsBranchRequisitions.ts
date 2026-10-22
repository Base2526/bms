import { getTenantId } from "@/lib/bms/tenant";
import { GraphQLError } from "graphql/error";
import { RequisitionFilterError } from "@/lib/bms/branchRequisitions";
import {
  requirePermission,
  loadPermissions,
  type BmsPermission,
} from "@/lib/bms/permissions";
import {
  commandBranchRequisition,
  listBranchRequisitions,
  requisitionEvents,
  requisitionCatalog,
  requisitionAvailability,
  consolidateBranchRequisitions,
  requisitionDemandRequests,
  requisitionMetrics,
  requisitionNotices,
  type RequisitionCommand,
} from "@/lib/bms/branchRequisitions";

export const bmsBranchRequisitionsTypeDefs = /* GraphQL */ `
  enum BmsRequisitionAction {
    SAVE
    SUBMIT
    REVIEW
    CANCEL
    TRANSFER
    LINK_PO
    CREATE_PO
    CLOSE
  }
  enum BmsRequisitionResultStatus {
    OK
    INVALID_INPUT
    INVALID_STATE
    NOT_FOUND
    STALE_VERSION
    CONFIRMATION_REQUIRED
    REASON_REQUIRED
    PRODUCT_NOT_FOUND
    OVER_ALLOCATED
    INSUFFICIENT_STOCK
    UNSUPPORTED_TRANSFER
    LINKED_WORK_OPEN
    IDEMPOTENCY_CONFLICT
  }
  input BmsRequisitionLineInput {
    sku: String!
    size: String!
    qty: Int!
    note: String
    unitCost: Float
  }
  input BmsRequisitionCommandInput {
    action: BmsRequisitionAction!
    id: ID
    version: Int
    idempotencyKey: String!
    confirmed: Boolean
    locationId: ID
    neededOn: String
    priority: String
    note: String
    items: [BmsRequisitionLineInput!]
    sourceId: ID
    poId: ID
    supplierId: ID
  }
  input BmsRequisitionFilter {
    neededFrom: String
    neededTo: String
    search: String
    status: String
    locationId: ID
    priority: String
    limit: Int
    offset: Int
    id: ID
  }
  type BmsRequisitionResult {
    status: BmsRequisitionResultStatus!
    id: ID
    transferId: ID
    poId: ID
  }
  type BmsRequisitionLocation {
    id: ID!
    name: String!
    active: Boolean!
  }
  type BmsRequisitionTransfer {
    id: ID!
    number: String!
    status: String!
    qty: Int!
    received: Int
    damaged: Int
  }
  type BmsRequisitionPurchase {
    id: ID!
    status: String!
    qty: Int!
    ordered: Int!
    received: Int!
  }
  type BmsRequisitionItem {
    id: ID!
    sku: String!
    size: String!
    name: String!
    requested: Int!
    approved: Int
    reviewNote: String!
    drafts: Int!
    transit: Int!
    received: Int!
    discrepancy: Int!
    remaining: Int!
    status: String!
    transfers: [BmsRequisitionTransfer!]!
    purchases: [BmsRequisitionPurchase!]!
  }
  type BmsRequisition {
    id: ID!
    requestNo: String!
    locationId: ID!
    locationName: String!
    status: String!
    version: Int!
    neededOn: String
    priority: String!
    note: String!
    creator: String!
    latestActor: String!
    createdAt: String!
    items: [BmsRequisitionItem!]!
  }
  type BmsRequisitionList {
    total: Int!
    rows: [BmsRequisition!]!
    locations: [BmsRequisitionLocation!]!
  }
  type BmsRequisitionEvent {
    action: String!
    note: String!
    actor: String!
    at: String!
  }
  type BmsRequisitionProduct {
    sku: String!
    size: String!
    name: String!
  }
  type BmsRequisitionAvailability {
    id: ID!
    name: String!
    stock: Int!
    reserved: Int!
    quarantine: Int!
    available: Int!
  }
  type BmsRequisitionDemand {
    sku: String!
    size: String!
    name: String!
    remaining: Float!
    requests: Int!
  }
  type BmsRequisitionDemandList {
    total: Int!
    rows: [BmsRequisitionDemand!]!
  }
  type BmsRequisitionDemandRequest {
    id: ID!
    requestNo: String!
    branch: String!
    neededOn: String
    priority: String!
    remaining: Int!
  }
  type BmsRequisitionDemandRequestList {
    total: Int!
    rows: [BmsRequisitionDemandRequest!]!
  }
  type BmsRequisitionMetrics {
    submittedRequests: Float!
    requestedUnits: Float!
    pendingReview: Float!
    reviewedRequests: Float!
    approvedRequests: Float!
    partialRequests: Float!
    approvedUnits: Float!
    receivedUnits: Float!
    unallocatedUnits: Float!
    overdueRequests: Float!
    discrepancyUnits: Float!
    medianReviewHours: Float
    medianFulfilmentHours: Float
  }
  extend type Query {
    bmsBranchRequisitionNotices: [BmsRequisitionNotice!]!
    bmsBranchRequisitionMetrics: BmsRequisitionMetrics!
    bmsBranchRequisitionDemandRequests(
      sku: String!
      size: String!
      offset: Int
    ): BmsRequisitionDemandRequestList!
    bmsBranchRequisitions(filter: BmsRequisitionFilter): BmsRequisitionList!
    bmsBranchRequisitionEvents(id: ID!): [BmsRequisitionEvent!]!
    bmsBranchRequisitionCatalog(search: String!): [BmsRequisitionProduct!]!
    bmsBranchRequisitionAvailability(
      sku: String!
      size: String!
    ): [BmsRequisitionAvailability!]!
    bmsBranchRequisitionDemand(
      search: String
      offset: Int
    ): BmsRequisitionDemandList!
  }
  extend type Mutation {
    bmsBranchRequisitionCommand(
      input: BmsRequisitionCommandInput!
    ): BmsRequisitionResult!
  }
  type BmsRequisitionNotice {
    id: ID!
    requestId: ID!
    requestNo: String!
    kind: String!
    at: String!
  }
`;
const scope = (ctx: any) => ({
  tenantId: getTenantId(ctx),
  actorId: String(ctx.admin.id),
});
export const bmsBranchRequisitionsResolvers = {
  Query: {
    async bmsBranchRequisitionNotices(_: unknown, _args: unknown, ctx: any) {
      await requirePermission(ctx, "inventory.requisition.view");
      return requisitionNotices(scope(ctx));
    },
    async bmsBranchRequisitionMetrics(_: unknown, _args: unknown, ctx: any) {
      await requirePermission(ctx, "inventory.requisition.view");
      await requirePermission(ctx, "inventory.requisition.review");
      return requisitionMetrics(scope(ctx));
    },
    async bmsBranchRequisitionDemandRequests(
      _: unknown,
      args: { sku: string; size: string; offset?: number },
      ctx: any,
    ) {
      await requirePermission(ctx, "inventory.requisition.view");
      await requirePermission(ctx, "inventory.requisition.review");
      return requisitionDemandRequests(
        scope(ctx),
        args.sku,
        args.size,
        args.offset ?? 0,
      );
    },
    async bmsBranchRequisitions(_: unknown, args: any, ctx: any) {
      await requirePermission(ctx, "inventory.requisition.view");
      try {
        return await listBranchRequisitions(
          scope(ctx),
          args.filter ?? {},
          (await loadPermissions(ctx)).has("purchase.view"),
        );
      } catch (error) {
        if (error instanceof RequisitionFilterError)
          throw new GraphQLError(error.message, {
            extensions: { code: "BAD_USER_INPUT" },
          });
        throw error;
      }
    },
    async bmsBranchRequisitionEvents(
      _: unknown,
      args: { id: string },
      ctx: any,
    ) {
      await requirePermission(ctx, "inventory.requisition.view");
      return requisitionEvents(scope(ctx), args.id);
    },
    async bmsBranchRequisitionCatalog(
      _: unknown,
      args: { search: string },
      ctx: any,
    ) {
      await requirePermission(ctx, "inventory.requisition.create");
      return requisitionCatalog(scope(ctx), args.search);
    },
    async bmsBranchRequisitionAvailability(
      _: unknown,
      args: { sku: string; size: string },
      ctx: any,
    ) {
      await requirePermission(ctx, "inventory.requisition.view");
      return requisitionAvailability(scope(ctx), args.sku, args.size);
    },
    async bmsBranchRequisitionDemand(
      _: unknown,
      args: { search?: string; offset?: number },
      ctx: any,
    ) {
      await requirePermission(ctx, "inventory.requisition.review");
      return consolidateBranchRequisitions(
        scope(ctx),
        args.search ?? "",
        args.offset ?? 0,
      );
    },
  },
  Mutation: {
    async bmsBranchRequisitionCommand(
      _: unknown,
      { input }: { input: RequisitionCommand },
      ctx: any,
    ) {
      await requirePermission(ctx, "inventory.requisition.view");
      const permissions: Record<RequisitionCommand["action"], BmsPermission> = {
        SAVE: "inventory.requisition.create",
        SUBMIT: "inventory.requisition.create",
        REVIEW: "inventory.requisition.review",
        CANCEL: "inventory.requisition.create",
        TRANSFER: "inventory.requisition.review",
        LINK_PO: "inventory.requisition.review",
        CREATE_PO: "inventory.requisition.review",
        CLOSE: "inventory.requisition.review",
      };
      await requirePermission(ctx, permissions[input.action]);
      if (input.action === "TRANSFER")
        await requirePermission(ctx, "inventory.transfer");
      if (input.action === "LINK_PO" || input.action === "CREATE_PO") {
        await requirePermission(ctx, "purchase.edit");
        await requirePermission(ctx, "purchase.view");
      }
      return commandBranchRequisition(scope(ctx), input);
    },
  },
};
