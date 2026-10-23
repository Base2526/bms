import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { getTenantId } from "@/lib/bms/tenant";
import { loadPermissions, requirePermission } from "@/lib/bms/permissions";
import {
  getBoardGameAnalytics,
  listBoardGameBranchHours,
  upsertBoardGameBranchHours,
  type BoardGameAnalyticsInput,
  type BoardGameBranchHourInput,
} from "@/lib/bms/boardGameAnalytics";

export const bmsBoardGameAnalyticsTypeDefs = /* GraphQL */ `
  enum BmsBoardGameAnalyticsGranularity { DAY WEEKDAY_HOUR TABLE AREA }

  input BmsBoardGameAnalyticsInput {
    from: String!
    to: String!
    locationId: ID
    areaId: ID
    granularity: BmsBoardGameAnalyticsGranularity = DAY
  }

  type BmsBoardGameAnalyticsRange { from: String!, to: String!, granularity: BmsBoardGameAnalyticsGranularity! }
  type BmsBoardGameAnalyticsIssue { code: String!, message: String!, count: Int! }
  type BmsBoardGameAnalyticsDataQuality { backfilledBefore: String, hoursConfigured: Boolean!, tablesWithoutHours: Int! }
  type BmsBoardGameWaitlistAnalytics {
    entries: Int!, seated: Int!, avgWaitMinutes: Float, noShow: Int!, cancelled: Int!, noShowRatePct: Float
  }
  type BmsBoardGameAnalyticsTotals {
    availableTableHours: Float!
    occupiedTableHours: Float!
    utilizationPct: Float
    seatUtilizationPct: Float
    sessions: Int!
    paidSessions: Int!
    cancelledSessions: Int!
    guests: Int!
    avgPlayMinutes: Float
    turnoverPerTablePerDay: Float
    grossPlay: String!
    offerDiscount: String!
    passCoverage: String!
    netPlay: String!
    playReturns: String!
    tabRevenue: String!
    tabRevenueExVat: String
    tabCost: String
    tabGrossProfit: String
    passSalesRevenue: String!
    passMinutesUsed: Int!
    revPATH: String
    waitlist: BmsBoardGameWaitlistAnalytics!
    depositsForfeited: String!
  }
  type BmsBoardGameTableAnalytics {
    tableId: ID!, code: String!, name: String!, areaName: String!, locationName: String!, seats: Int!
    availableTableHours: Float!, occupiedTableHours: Float!, utilizationPct: Float
    revenue: String!, revPATH: String, grossPlay: String!, offerDiscount: String!, passCoverage: String!, netPlay: String!
    tabRevenue: String!, tabRevenueExVat: String, tabCost: String, tabGrossProfit: String
  }
  type BmsBoardGameAreaAnalytics {
    areaId: ID!, locationId: ID!, name: String!, availableTableHours: Float!, occupiedTableHours: Float!
    utilizationPct: Float, revenue: String!, revPATH: String
  }
  type BmsBoardGameHeatmapCell {
    weekday: Int!, hour: Int!, occupiedTableHours: Float!, availableTableHours: Float!, utilizationPct: Float, revenue: String!
  }
  type BmsBoardGameOfferAnalytics { offerId: ID!, name: String!, uses: Int!, discount: String! }
  type BmsBoardGameTitleAnalytics { titleId: ID!, name: String!, plays: Int!, minutes: Int! }
  type BmsBoardGameLibraryAnalytics {
    titlesPlayed: [BmsBoardGameTitleAnalytics!]!, copiesNeedingAttention: Int!, purchaseCostTotal: String
  }
  type BmsBoardGameAnalytics {
    range: BmsBoardGameAnalyticsRange!
    timezone: String!
    locationScope: [ID!]
    complete: Boolean!
    issues: [BmsBoardGameAnalyticsIssue!]!
    truncated: Boolean!
    dataQuality: BmsBoardGameAnalyticsDataQuality!
    totals: BmsBoardGameAnalyticsTotals!
    byTable: [BmsBoardGameTableAnalytics!]!
    byArea: [BmsBoardGameAreaAnalytics!]!
    heatmap: [BmsBoardGameHeatmapCell!]!
    topOffers: [BmsBoardGameOfferAnalytics!]!
    library: BmsBoardGameLibraryAnalytics!
  }

  type BmsBoardGameBranchHour {
    weekday: Int!, opensAt: String, closesAt: String, closed: Boolean!, effectiveFrom: String!
  }
  input BmsBoardGameBranchHourInput { weekday: Int!, opensAt: String, closesAt: String, closed: Boolean! }
  input BmsUpsertBoardGameBranchHoursInput {
    locationId: ID!, effectiveFrom: String!, hours: [BmsBoardGameBranchHourInput!]!
  }
  type BmsBoardGameAnalyticsResult { status: String!, code: String, report: BmsBoardGameAnalytics }
  type BmsBoardGameBranchHoursResult { status: String!, code: String, locationId: ID, effectiveFrom: String, hours: [BmsBoardGameBranchHour!]! }

  extend type Query {
    bmsBoardGameAnalytics(input: BmsBoardGameAnalyticsInput!): BmsBoardGameAnalyticsResult!
    bmsBoardGameBranchHours(locationId: ID!): BmsBoardGameBranchHoursResult!
  }
  extend type Mutation {
    bmsUpsertBoardGameBranchHours(input: BmsUpsertBoardGameBranchHoursInput!): BmsBoardGameBranchHoursResult!
  }
`;

function graphError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code.endsWith("FORBIDDEN") || code.endsWith("ALL_BRANCH_ACCESS_REQUIRED")) {
    throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
  }
  if (code.startsWith("BOARD_GAME_") || code === "SALES_EVIDENCE_CURRENCY_REVIEW_REQUIRED") {
    return { status: "BAD_USER_INPUT", code, report: null, hours: [] };
  }
  throw error;
}

export const bmsBoardGameAnalyticsResolvers = {
  Query: {
    async bmsBoardGameAnalytics(_parent: unknown, args: { input: BoardGameAnalyticsInput }, ctx: any) {
      await requirePermission(ctx, "report.view");
      const permissions = await loadPermissions(ctx);
      try {
        const report = await getBoardGameAnalytics(
          getTenantId(ctx),
          String(requireAuth(ctx).author_id),
          args.input,
          undefined,
          { includeCosts: permissions.has("product.view") && permissions.has("tax.document.view") },
        );
        return { status: "OK", report };
      } catch (error) { return graphError(error); }
    },
    async bmsBoardGameBranchHours(_parent: unknown, args: { locationId: string }, ctx: any) {
      await requirePermission(ctx, "report.view");
      try { return { status: "OK", locationId: args.locationId, hours: await listBoardGameBranchHours(getTenantId(ctx), String(requireAuth(ctx).author_id), args.locationId) }; }
      catch (error) { return graphError(error); }
    },
  },
  Mutation: {
    async bmsUpsertBoardGameBranchHours(_parent: unknown, args: {
      input: { locationId: string; effectiveFrom: string; hours: BoardGameBranchHourInput[] };
    }, ctx: any) {
      await requirePermission(ctx, "board_game.floor.manage");
      try { return { status: "OK", ...await upsertBoardGameBranchHours(getTenantId(ctx), String(requireAuth(ctx).author_id), args.input) }; }
      catch (error) { return graphError(error); }
    },
  },
};
