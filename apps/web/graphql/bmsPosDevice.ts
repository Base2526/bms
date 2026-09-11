import { GraphQLError } from "graphql/error";

import {
  AR_RECEIPT_METHODS,
  getArAccountByCustomer,
  getArShiftSummary,
  listArInvoices,
  recordArReceipt,
  type ArReceiptMethod,
} from "@/lib/bms/ar";
import { previewCouponForCustomer } from "@/lib/bms/coupons";
import {
  addToDeposit,
  closeDeposit,
  listDepositCandidateOrders,
  listDeposits,
  searchDeposits,
  takeDeposit,
} from "@/lib/bms/deposits";
import { listKitchenTickets, updateKitchenTicketStatus, updateKitchenTicketsStatus } from "@/lib/bms/kitchen";
import { getKitchenStationSlaMap } from "@/lib/bms/kitchenSla";
import { listKitchenStations } from "@/lib/bms/kitchenStations";
import { getLocation } from "@/lib/bms/locations";
import {
  evaluatePointsEarn,
  enrollMember,
  getLoyaltySettings,
  previewMemberDiscount,
  searchMembers,
  toPosMemberSummary,
} from "@/lib/bms/membership";
import {
  getLatestPosSale,
  getOpenPosShift,
  getPosShiftReport,
  getPosShiftReturnSummary,
  getPosVariantAvailable,
  blindReturnPosSale,
  cancelRestaurantOrderLines,
  cashierHasPermission,
  closePosShift,
  completePosRefundAllocation,
  deleteParkedSale,
  isPosOrderOwnedByDevice,
  listCashMovements,
  listNoSales,
  listParkedSales,
  listPosApprovers,
  listPosCashiers,
  listPosKitchenOperators,
  listPosPurchaseReceivers,
  listPosShiftHistory,
  listRecentPosSales,
  openPosShift,
  parkSale,
  partiallyReturnPosSale,
  recordCashMovement,
  recordNoSale,
  recordPosSale,
  requestPosPharmacyReview,
  resumeParkedSale,
  returnPosSale,
  resolvePosScan,
  settleDepositSale,
  verifyCashierPin,
  voidPosSale,
} from "@/lib/bms/pos";
import {
  decoratePosSale,
  parsePosExtraLines,
  parsePosPayments,
  parsePosSaleLines,
  normalizePosSearchQuery,
  isPosUuid,
} from "@/lib/bms/posRouteHelpers";
import {
  createPosExpense,
  fundPosPettyCash,
  getPosPettyCashWallet,
  listPosExpenses,
  POS_EXPENSE_CATEGORIES,
  settlePosExpense,
  type PosExpenseCategory,
  type PosExpenseFundingSource,
  type PosExpenseKind,
  type PosPettyCashFundingSource,
} from "@/lib/bms/posExpenses";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/bms/payments";
import { listPrimaryProductImages, listSellableProducts } from "@/lib/bms/products";
import {
  getPurchaseOrder,
  listReceivablePurchaseOrders,
  receivePurchaseOrder,
  type ReceiveInput,
} from "@/lib/bms/purchase";
import { sendReceipt } from "@/lib/bms/receiptDelivery";
import {
  acceptIncomingRestaurantOrder,
  getRestaurantOrderingConfig,
  listIncomingRestaurantOrders,
  listPendingRestaurantRefunds,
  setRestaurantOrderingPaused,
} from "@/lib/bms/restaurantOrdering";
import {
  acceptRestaurantQrSubmission,
  addRestaurantCheckItem,
  cancelRestaurantCheck,
  createDefaultRestaurantFloor,
  dropKitchenCancelledLineInTx,
  getRestaurantCheck,
  listRestaurantFloor,
  listRestaurantMenu,
  mergeRestaurantChecks,
  moveRestaurantCheck,
  openRestaurantCheck,
  removeRestaurantCheckItem,
  sendRestaurantKitchenRound,
  settleRestaurantCheck,
  setRestaurantCheckGuestCount,
  splitRestaurantCheck,
} from "@/lib/bms/restaurantPos";
import { listRestaurantQrSubmissions, rejectRestaurantQrSubmission } from "@/lib/bms/restaurantQrOrdering";
import { listRestaurantRequests, reviewRestaurantRequest } from "@/lib/bms/restaurantRequests";
import { listRestaurantServiceCalls, updateRestaurantServiceCall } from "@/lib/bms/restaurantServiceCalls";
import {
  addRestaurantWaitlistEntry,
  callRestaurantWaitlistEntry,
  closeRestaurantWaitlistEntry,
  listRestaurantWaitlist,
  seatRestaurantWaitlistEntry,
} from "@/lib/bms/restaurantWaitlist";
import { setMenuTemporarilyUnavailable } from "@/lib/bms/menuAvailability";
import { findStoreCredit } from "@/lib/bms/storeCredit";
import { getStoreProfile } from "@/lib/bms/storeProfile";
import { getVatSettings } from "@/lib/bms/taxDocuments";

import {
  badPosInput,
  requireOpenPosShift,
  requirePosCashier,
  requirePosDevice,
  requirePosPermissionForActor,
  requirePosSecondPerson,
  verifyOptionalPosPerson,
  type PosCashierCredentials,
} from "./posDeviceAuth";

export const bmsPosDeviceTypeDefs = /* GraphQL */ `
  input BmsPosCredentialsInput {
    cashierUserId: ID!
    pin: String!
  }

  extend type Query {
    bmsPosSession: JSON!
    bmsPosCatalogSearch(q: String!): JSON!
    bmsPosScan(
      code: String!
      size: String
      packCode: String
      surface: String
      withImage: Boolean = false
    ): JSON!
    bmsPosLastSale: JSON
    bmsPosRecentSales(q: String, limit: Int = 5, deviceOnly: Boolean = false): JSON!
    bmsPosParkedSales: JSON!
    bmsPosCashMovements: JSON!
    bmsPosNoSales: JSON!
    bmsPosDeposits(q: String): JSON!
    bmsPosExpenses(credentials: BmsPosCredentialsInput!): JSON!
    bmsPosKitchenTickets(status: String, limit: Int = 100): JSON!
    bmsPosRestaurantFloor: JSON!
    bmsPosRestaurantMenu: JSON!
    bmsPosRestaurantCheck(id: ID!): JSON
    bmsPosRestaurantIncoming: JSON!
    bmsPosRestaurantQrOrders: JSON!
    bmsPosRestaurantServiceCalls: JSON!
    bmsPosRestaurantWaitlist: JSON!
    bmsPosMemberSearch(q: String, amount: Float): JSON!

    bmsPosShiftHistory(credentials: BmsPosCredentialsInput!): JSON!
    bmsPosShiftReport(credentials: BmsPosCredentialsInput!, shiftId: ID): JSON!
    bmsPosArAccount(credentials: BmsPosCredentialsInput!, customerId: ID!): JSON!
    bmsPosStoreCredit(credentials: BmsPosCredentialsInput!, code: String!): JSON!
    bmsPosPurchaseOrders(credentials: BmsPosCredentialsInput!): JSON!
    bmsPosPurchaseOrder(credentials: BmsPosCredentialsInput!, poId: ID!): JSON
    bmsPosRestaurantRequests(credentials: BmsPosCredentialsInput!): JSON!
    bmsPosMemberPreview(input: JSON!): JSON!
  }

  extend type Mutation {
    bmsPosSale(input: JSON!): JSON!
    bmsPosShift(input: JSON!): JSON!
    bmsPosPark(input: JSON!): JSON!
    bmsPosReturn(input: JSON!): JSON!
    bmsPosBlindReturn(input: JSON!): JSON!
    bmsPosVoid(input: JSON!): JSON!
    bmsPosCompleteRefund(input: JSON!): JSON!
    bmsPosCashMovement(input: JSON!): JSON!
    bmsPosNoSale(input: JSON!): JSON!
    bmsPosEnrollMember(input: JSON!): JSON!
    bmsPosCollectAr(input: JSON!): JSON!
    bmsPosReceivePurchase(input: JSON!): JSON!
    bmsPosSendReceipt(input: JSON!): JSON!
    bmsPosDeposit(input: JSON!): JSON!
    bmsPosExpense(input: JSON!): JSON!
    bmsPosRequestPharmacyReview(input: JSON!): JSON!
    bmsPosKitchenTicketStatus(input: JSON!): JSON!
    bmsPosKitchenTicketsStatus(input: JSON!): JSON!
    bmsPosRestaurantFloorSetup(input: JSON!): JSON!
    bmsPosRestaurantMenuAvailability(input: JSON!): JSON!
    bmsPosRestaurantOpenCheck(input: JSON!): JSON!
    bmsPosRestaurantCheckAction(checkId: ID!, input: JSON!): JSON!
    bmsPosRestaurantIncomingAction(input: JSON!): JSON!
    bmsPosRestaurantQrOrderAction(input: JSON!): JSON!
    bmsPosRestaurantRequestAction(input: JSON!): JSON!
    bmsPosRestaurantServiceCallAction(input: JSON!): JSON!
    bmsPosRestaurantWaitlistAction(input: JSON!): JSON!
  }
`;

function recordInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return badPosInput("input ไม่ถูกต้อง");
  return value as Record<string, unknown>;
}

function textInput(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uuidInput(value: unknown, message: string): string {
  const parsed = textInput(value);
  if (!isPosUuid(parsed)) return badPosInput(message);
  return parsed;
}

function optionalUuidInput(value: unknown, message: string): string | null {
  const parsed = textInput(value);
  if (!parsed) return null;
  if (!isPosUuid(parsed)) return badPosInput(message);
  return parsed;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function boundedLimit(value: number | null | undefined, fallback: number, maximum: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), maximum);
}

export const bmsPosDeviceResolvers = {
  Query: {
    async bmsPosSession(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      const [shift, location, cashiers, purchaseReceivers, approvers, kitchenOperators, vat, store] =
        await Promise.all([
          getOpenPosShift(device.tenantId, device.id),
          getLocation(device.tenantId, device.locationId),
          listPosCashiers(device.tenantId),
          listPosPurchaseReceivers(device.tenantId),
          listPosApprovers(device.tenantId),
          listPosKitchenOperators(device.tenantId),
          getVatSettings(device.tenantId),
          getStoreProfile(device.tenantId),
        ]);
      const shiftReturnSummary = shift
        ? await getPosShiftReturnSummary(device.tenantId, device.id, shift.id)
        : { returnCount: 0, returnTotal: 0, settledTotal: 0, pendingTotal: 0, pendingCount: 0 };
      return {
        device: {
          id: device.id,
          code: device.code,
          name: device.name,
          registeredPosNo: device.registeredPosNo,
          scanner: {
            mode: device.scannerMode,
            prefixKey: device.scannerPrefixKey,
            suffixKey: device.scannerSuffixKey,
            maxGapMs: device.scannerMaxGapMs,
          },
        },
        location: location ? {
          id: location.id,
          name: location.name,
          branchCode: location.branchCode,
          vatCode: location.vatCode,
          pharmacistName: location.pharmacistName,
        } : null,
        shift,
        shiftReturnSummary,
        cashiers,
        purchaseReceivers,
        approvers,
        kitchenOperators,
        store: { taxId: store.taxId, receiptLanguageMode: store.receiptLanguageMode },
        surface: store.businessArchetype === "restaurant" ? "restaurant" : "retail",
        businessArchetype: store.businessArchetype ?? null,
        vat: {
          registered: vat.vatRegistered,
          priceIncludesVat: vat.priceIncludesVat,
          rate: vat.vatRate,
          calendarEra: vat.calendarEra,
          cashRounding: vat.cashRounding,
        },
      };
    },

    async bmsPosCatalogSearch(_parent: unknown, args: { q: string }, ctx: any) {
      const device = requirePosDevice(ctx);
      const q = normalizePosSearchQuery(args.q);
      if (!q) return { items: [] };
      const { items } = await listSellableProducts(device.tenantId, {
        search: q,
        inStockOnly: true,
        sort: "relevance",
        limit: 8,
        locationId: device.locationId,
        salesSurface: "RETAIL_POS",
      });
      const imagesBySku = await listPrimaryProductImages(device.tenantId, items.map((item) => item.sku));
      return {
        items: items.map((item) => ({
          sku: item.sku,
          name: item.name,
          price: item.price,
          availableTotal: item.availableTotal,
          availability: item.availability,
          availableSizes: item.availableSizes,
          imageUrl: imagesBySku.get(item.sku) ?? null,
        })),
      };
    },

    async bmsPosScan(_parent: unknown, args: {
      code: string;
      size?: string | null;
      packCode?: string | null;
      surface?: string | null;
      withImage?: boolean | null;
    }, ctx: any) {
      const device = requirePosDevice(ctx);
      const code = String(args.code ?? "").trim();
      if (!code) return badPosInput("ต้องระบุ code");
      const hit = await resolvePosScan(device.tenantId, code, {
        size: args.size?.trim() || null,
        locationId: device.locationId,
        packCode: args.packCode?.trim() || null,
        surface: args.surface?.trim().toUpperCase() === "RESTAURANT_POS"
          ? "RESTAURANT_POS"
          : "RETAIL_POS",
      });
      if (!hit) {
        throw new GraphQLError("ไม่พบสินค้าจากรหัสนี้", {
          extensions: { code: "NOT_FOUND", scanCode: code },
        });
      }
      const [available, imageUrl] = await Promise.all([
        getPosVariantAvailable(device.tenantId, device.locationId, hit.sku, hit.size),
        args.withImage
          ? listPrimaryProductImages(device.tenantId, [hit.sku]).then((images) => images.get(hit.sku) ?? null)
          : Promise.resolve(undefined),
      ]);
      return { ...hit, available, ...(args.withImage ? { imageUrl: imageUrl ?? null } : {}) };
    },

    async bmsPosLastSale(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      const [sale, location, vat] = await Promise.all([
        getLatestPosSale(device.tenantId, device.id),
        getLocation(device.tenantId, device.locationId),
        getVatSettings(device.tenantId),
      ]);
      return sale ? decoratePosSale(sale as Record<string, unknown>, {
        storeName: location?.name ?? null,
        branchCode: location?.branchCode ?? null,
        posLabel: device.registeredPosNo ?? device.code,
        vatRegistered: vat.vatRegistered,
      }) : null;
    },

    async bmsPosRecentSales(_parent: unknown, args: {
      q?: string | null;
      limit?: number | null;
      deviceOnly?: boolean | null;
    }, ctx: any) {
      const device = requirePosDevice(ctx);
      const q = normalizePosSearchQuery(args.q);
      const sales = await listRecentPosSales(
        device.tenantId,
        device.id,
        boundedLimit(args.limit, 5, 50),
        { query: q || null, locationId: device.locationId, deviceOnly: args.deviceOnly === true },
      );
      const depositMatches = sales.length === 0 && q
        ? await searchDeposits(device.tenantId, q, { locationId: device.locationId, limit: 5 })
        : [];
      return { sales, depositMatches };
    },

    async bmsPosParkedSales(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      const shift = await requireOpenPosShift(device);
      return { parked: await listParkedSales(device.tenantId, shift.id) };
    },

    async bmsPosCashMovements(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      const shift = await requireOpenPosShift(device);
      return { movements: await listCashMovements(device.tenantId, shift.id) };
    },

    async bmsPosNoSales(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      const shift = await requireOpenPosShift(device);
      return { noSales: await listNoSales(device.tenantId, shift.id) };
    },

    async bmsPosDeposits(_parent: unknown, args: { q?: string | null }, ctx: any) {
      const device = requirePosDevice(ctx);
      const q = args.q?.trim() ?? "";
      const [deposits, candidateOrders, searchResults] = await Promise.all([
        listDeposits(device.tenantId, "OPEN", { locationId: device.locationId }),
        listDepositCandidateOrders(device.tenantId, device.locationId),
        q ? searchDeposits(device.tenantId, q, { locationId: device.locationId }) : Promise.resolve([]),
      ]);
      return { deposits, candidateOrders, searchResults, searchQuery: q || null };
    },

    async bmsPosExpenses(_parent: unknown, args: { credentials: PosCashierCredentials }, ctx: any) {
      const device = requirePosDevice(ctx);
      const actor = await requirePosCashier(device, args.credentials, "pos.expense.create");
      const shift = await requireOpenPosShift(device);
      const [expenses, wallet, canUsePersonalFunds, canManagePettyCash] = await Promise.all([
        listPosExpenses(device.tenantId, shift.id, device.id),
        getPosPettyCashWallet(device.tenantId, device.locationId),
        cashierHasPermission(device.tenantId, actor.userId, "pos.expense.personal"),
        cashierHasPermission(device.tenantId, actor.userId, "pos.petty_cash.manage"),
      ]);
      return {
        expenses,
        categories: POS_EXPENSE_CATEGORIES,
        canUsePersonalFunds,
        canManagePettyCash,
        pettyCashWallet: wallet,
      };
    },

    async bmsPosKitchenTickets(_parent: unknown, args: { status?: string | null; limit?: number | null }, ctx: any) {
      const device = requirePosDevice(ctx);
      const status = args.status?.trim().toUpperCase() || null;
      const [tickets, stationSlas, stations] = await Promise.all([
        listKitchenTickets(device.tenantId, status, boundedLimit(args.limit, 100, 200), device.locationId),
        getKitchenStationSlaMap(device.tenantId),
        listKitchenStations(device.tenantId, { locationId: device.locationId }).catch(() => []),
      ]);
      return {
        tickets,
        stationSlas,
        stations: stations.map((station) => ({ id: station.id, name: station.name, sortOrder: station.sortOrder })),
        generatedAt: new Date().toISOString(),
      };
    },

    async bmsPosRestaurantFloor(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      return listRestaurantFloor(device.tenantId, device.locationId);
    },

    async bmsPosRestaurantMenu(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      return { items: await listRestaurantMenu(device.tenantId, device.locationId) };
    },

    async bmsPosRestaurantCheck(_parent: unknown, args: { id: string }, ctx: any) {
      const device = requirePosDevice(ctx);
      return getRestaurantCheck(device.tenantId, uuidInput(args.id, "บิลโต๊ะไม่ถูกต้อง"), device.locationId);
    },

    async bmsPosRestaurantIncoming(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      const [orders, refunds, config] = await Promise.all([
        listIncomingRestaurantOrders(device.tenantId, device.locationId),
        listPendingRestaurantRefunds(device.tenantId, device.locationId),
        getRestaurantOrderingConfig(device.tenantId),
      ]);
      return { orders, refunds, config };
    },

    async bmsPosRestaurantQrOrders(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      return { submissions: await listRestaurantQrSubmissions(device.tenantId, device.locationId) };
    },

    async bmsPosRestaurantServiceCalls(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      return { calls: await listRestaurantServiceCalls(device.tenantId, device.locationId) };
    },

    async bmsPosRestaurantWaitlist(_parent: unknown, _args: unknown, ctx: any) {
      const device = requirePosDevice(ctx);
      return listRestaurantWaitlist(device.tenantId, device.locationId);
    },

    async bmsPosMemberSearch(_parent: unknown, args: { q?: string | null; amount?: number | null }, ctx: any) {
      const device = requirePosDevice(ctx);
      const amount = Number.isFinite(args.amount) && Number(args.amount) > 0
        ? Math.round(Number(args.amount) * 100) / 100
        : null;
      const settings = await getLoyaltySettings(device.tenantId);
      const earn = amount == null ? null : evaluatePointsEarn(settings, { netTotal: amount, discountAmount: 0 });
      const loyalty = {
        enabled: settings.enabled,
        pointsForAmount: earn?.points ?? null,
        block: earn?.block ?? null,
      };
      const q = args.q?.trim() ?? "";
      if (q.length < 3) return { members: [], loyalty };
      const members = await searchMembers(device.tenantId, q, 10);
      return { members: members.map(toPosMemberSummary), loyalty };
    },

    async bmsPosShiftHistory(_parent: unknown, args: { credentials: PosCashierCredentials }, ctx: any) {
      const device = requirePosDevice(ctx);
      await requirePosCashier(device, args.credentials, "pos.shift.report");
      return { shifts: await listPosShiftHistory(device.tenantId, device.id, 12) };
    },

    async bmsPosShiftReport(_parent: unknown, args: {
      credentials: PosCashierCredentials;
      shiftId?: string | null;
    }, ctx: any) {
      const device = requirePosDevice(ctx);
      await requirePosCashier(device, args.credentials, "pos.shift.report");
      const shiftId = optionalUuidInput(args.shiftId, "กะไม่ถูกต้อง")
        ?? (await getOpenPosShift(device.tenantId, device.id))?.id
        ?? null;
      if (!shiftId) throw new GraphQLError("ไม่พบกะ", { extensions: { code: "NOT_FOUND" } });
      const report = await getPosShiftReport(device.tenantId, shiftId, device.id);
      if (!report) throw new GraphQLError("ไม่พบกะ", { extensions: { code: "NOT_FOUND" } });
      return { report, receivables: await getArShiftSummary(device.tenantId, shiftId) };
    },

    async bmsPosArAccount(_parent: unknown, args: {
      credentials: PosCashierCredentials;
      customerId: string;
    }, ctx: any) {
      const device = requirePosDevice(ctx);
      await requirePosCashier(device, args.credentials, "ar.view");
      const customerId = uuidInput(args.customerId, "ลูกค้าไม่ถูกต้อง");
      const account = await getArAccountByCustomer(device.tenantId, customerId);
      if (!account) return { account: null, invoices: [] };
      return {
        account,
        invoices: await listArInvoices(device.tenantId, { accountId: account.id, openOnly: true, limit: 50 }),
      };
    },

    async bmsPosStoreCredit(_parent: unknown, args: {
      credentials: PosCashierCredentials;
      code: string;
    }, ctx: any) {
      const device = requirePosDevice(ctx);
      await requirePosCashier(device, args.credentials, "storecredit.redeem");
      if (!args.code.trim()) return badPosInput("ต้องระบุโค้ดบัตร");
      const credit = await findStoreCredit(device.tenantId, args.code);
      if (!credit) throw new GraphQLError("ไม่พบบัตรนี้", { extensions: { code: "NOT_FOUND" } });
      return {
        credit: {
          code: credit.code,
          balance: credit.balance,
          status: credit.status,
          expiresAt: credit.expiresAt,
          customerName: credit.customerName,
        },
      };
    },

    async bmsPosPurchaseOrders(_parent: unknown, args: { credentials: PosCashierCredentials }, ctx: any) {
      const device = requirePosDevice(ctx);
      await requirePosCashier(device, args.credentials, "purchase.receive");
      return { orders: await listReceivablePurchaseOrders(device.tenantId, 50) };
    },

    async bmsPosPurchaseOrder(_parent: unknown, args: {
      credentials: PosCashierCredentials;
      poId: string;
    }, ctx: any) {
      const device = requirePosDevice(ctx);
      await requirePosCashier(device, args.credentials, "purchase.receive");
      const order = await getPurchaseOrder(device.tenantId, uuidInput(args.poId, "ใบสั่งซื้อไม่ถูกต้อง"));
      if (!order) throw new GraphQLError("ไม่พบใบสั่งซื้อ", { extensions: { code: "NOT_FOUND" } });
      if (order.status !== "OPEN" && order.status !== "PARTIAL") {
        throw new GraphQLError(`ใบสั่งซื้อนี้รับต่อไม่ได้ (สถานะ ${order.status})`, {
          extensions: { code: "CONFLICT", reason: "INVALID_STATE" },
        });
      }
      return order;
    },

    async bmsPosRestaurantRequests(_parent: unknown, args: { credentials: PosCashierCredentials }, ctx: any) {
      const device = requirePosDevice(ctx);
      const actor = await requirePosCashier(device, args.credentials, "pos.sell");
      await requireOpenPosShift(device);
      return { requests: await listRestaurantRequests({
        tenantId: device.tenantId,
        locationId: device.locationId,
        actorUserId: actor.userId,
      }) };
    },

    async bmsPosMemberPreview(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const subtotal = Number(input.subtotal);
      if (!Number.isFinite(subtotal) || subtotal < 0) return badPosInput("subtotal ไม่ถูกต้อง");
      const customerId = optionalUuidInput(input.customerId, "ลูกค้าไม่ถูกต้อง");
      const pointsRequested = Number.isFinite(Number(input.pointsToRedeem)) ? Number(input.pointsToRedeem) : 0;
      const couponCode = textInput(input.couponCode);
      const manualRaw = Number(input.manualDiscount);
      const manualDiscount = Number.isFinite(manualRaw) && manualRaw > 0
        ? Math.round(manualRaw * 100) / 100
        : 0;
      let couponDiscount = 0;
      let couponError: string | null = null;
      if (couponCode) {
        const check = await previewCouponForCustomer(
          device.tenantId,
          couponCode,
          customerId,
          subtotal,
          device.locationId,
        );
        if (check.ok) couponDiscount = check.discount;
        else couponError = check.reason;
      }
      const preview = await previewMemberDiscount({
          tenantId: device.tenantId,
          customerId,
          subtotal,
          pointsRequested,
          couponDiscount,
          manualDiscount,
        });
      return {
        ...preview,
        member: preview.member ? toPosMemberSummary(preview.member) : null,
        couponError,
      };
    },
  },

  Mutation: {
    async bmsPosSale(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "pos.sell");
      const idempotencyKey = textInput(input.idempotencyKey);
      if (!idempotencyKey || idempotencyKey.length > 240) {
        return badPosInput("idempotencyKey จำเป็นและต้องยาวไม่เกิน 240 ตัวอักษร");
      }

      const mode = input.mode === "DEPOSIT" ? "DEPOSIT" : "SALE";
      if (mode === "DEPOSIT" && !(await cashierHasPermission(device.tenantId, actor.userId, "pos.deposit.take"))) {
        throw new GraphQLError("ไม่มีสิทธิ์รับมัดจำ", {
          extensions: { code: "FORBIDDEN", permission: "pos.deposit.take" },
        });
      }
      const lines = parsePosSaleLines(input.lines);
      if (!lines.length) return badPosInput("ต้องมีรายการสินค้าอย่างน้อย 1 รายการ");
      const parsedPayments = parsePosPayments(input.payments);
      if (!parsedPayments.ok) return badPosInput(parsedPayments.error);

      let manualApproval: { amount: number; userId: string; reason: string } | null = null;
      const requestedDiscount = Math.round(Number(input.manualDiscount ?? 0) * 100) / 100;
      if (Number.isFinite(requestedDiscount) && requestedDiscount > 0) {
        const reason = textInput(input.discountReason);
        if (!reason) return badPosInput("ส่วนลดหน้าร้านต้องระบุเหตุผล");
        if (reason.length > 200) return badPosInput("เหตุผลส่วนลดยาวเกินไป");
        const approver = await requirePosSecondPerson(
          device,
          actor.userId,
          { userId: input.discountApproverUserId, pin: input.discountApproverPin },
          "pos.discount.approve",
          {
            required: "ส่วนลดหน้าร้านต้องให้ผู้มีสิทธิ์อนุมัติกด PIN",
            samePerson: "ผู้อนุมัติส่วนลดต้องเป็นคนละคนกับพนักงานขาย",
          },
        );
        manualApproval = { amount: requestedDiscount, userId: approver.userId, reason };
      }

      let creditApprovedBy: string | null = null;
      const wantsCredit = parsedPayments.payments.some((payment) => payment.method === "CREDIT");
      if (wantsCredit) {
        if (mode === "DEPOSIT") return badPosInput("มัดจำเป็นการรับเงิน ไม่ใช่การขายเชื่อ");
        if (await cashierHasPermission(device.tenantId, actor.userId, "ar.sell")) {
          creditApprovedBy = actor.userId;
        } else {
          const creditApprover = await requirePosCashier(device, {
            cashierUserId: input.creditApproverUserId,
            pin: input.creditApproverPin,
          }, "ar.sell");
          creditApprovedBy = creditApprover.userId;
        }
      }

      let pharmacistCounterAuthorization: {
        pharmacistUserId: string;
        note?: string | null;
      } | null = null;
      const pharmacistId = optionalUuidInput(input.pharmacistAuthorizerUserId, "เภสัชกรไม่ถูกต้อง");
      if (pharmacistId) {
        const note = textInput(input.pharmacistAuthorizationNote);
        if (note.length > 500) return badPosInput("บันทึกของเภสัชกรยาวเกินไป");
        const pharmacist = pharmacistId === actor.userId
          ? actor
          : await verifyCashierPin(
            device.tenantId,
            pharmacistId,
            typeof input.pharmacistAuthorizerPin === "string" ? input.pharmacistAuthorizerPin : "",
          );
        if (!pharmacist.ok) {
          throw new GraphQLError("PIN ของเภสัชกรไม่ถูกต้อง", {
            extensions: { code: "FORBIDDEN", reason: pharmacist.reason },
          });
        }
        if (!pharmacist.isPharmacist) {
          throw new GraphQLError("คนนี้ไม่ได้บันทึกว่าเป็นเภสัชกรผู้มีใบอนุญาต", {
            extensions: { code: "FORBIDDEN", reason: "NOT_LICENSED_PHARMACIST" },
          });
        }
        pharmacistCounterAuthorization = {
          pharmacistUserId: pharmacist.userId,
          note: note || null,
        };
      }

      // The current shift is authoritative. A supplied shiftId is accepted only as a retry hint
      // after a lost response; recordPosSale rechecks that it belongs to this device and key.
      const currentShift = await getOpenPosShift(device.tenantId, device.id);
      const shiftId = currentShift?.id ?? optionalUuidInput(input.shiftId, "กะไม่ถูกต้อง");
      if (!shiftId) {
        return { status: "SHIFT_NOT_OPEN" };
      }

      return recordPosSale({
        tenantId: device.tenantId,
        deviceId: device.id,
        shiftId,
        cashierUserId: actor.userId,
        idempotencyKey,
        mode,
        lines,
        payments: parsedPayments.payments,
        couponCode: typeof input.couponCode === "string" ? input.couponCode : null,
        depositCustomerNote: textInput(input.depositCustomerNote).slice(0, 200) || null,
        depositDueAt: textInput(input.depositDueAt) || null,
        customerId: optionalUuidInput(input.customerId, "ลูกค้าไม่ถูกต้อง"),
        pointsToRedeem: Number.isFinite(Number(input.pointsToRedeem)) ? Number(input.pointsToRedeem) : null,
        extraLines: parsePosExtraLines(input.extraLines),
        manualDiscount: manualApproval?.amount ?? null,
        discountApprovedBy: manualApproval?.userId ?? null,
        discountReason: manualApproval?.reason ?? null,
        creditApprovedBy,
        pharmacyApprovedAssessmentId: optionalUuidInput(input.pharmacyApprovedAssessmentId, "เคสร้านยาไม่ถูกต้อง"),
        pharmacistCounterAuthorization,
        pharmacyReviewAssessmentId: optionalUuidInput(input.pharmacyReviewAssessmentId, "เคสร้านยาไม่ถูกต้อง"),
      });
    },

    async bmsPosShift(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const action = textInput(input.action).toLowerCase();
      const credentials = {
        cashierUserId: textInput(input.cashierUserId) || textInput(input.userId),
        pin: input.pin,
      };
      if (action === "open") {
        const actor = await requirePosCashier(device, credentials, "pos.shift.open");
        return openPosShift({
          tenantId: device.tenantId,
          deviceId: device.id,
          openedBy: actor.userId,
          openingFloat: Number(input.openingFloat ?? 0),
          pharmacistUserId: actor.isPharmacist ? actor.userId : null,
        });
      }
      if (action === "close") {
        const actor = await requirePosCashier(device, credentials, "pos.shift.close");
        const shift = await requireOpenPosShift(device);
        const countedCash = Number(input.countedCash);
        if (!Number.isFinite(countedCash) || countedCash < 0) return badPosInput("ต้องระบุยอดเงินที่นับได้");
        return closePosShift({
          tenantId: device.tenantId,
          shiftId: shift.id,
          closedBy: actor.userId,
          countedCash,
          note: typeof input.note === "string" ? input.note : null,
        });
      }
      return badPosInput("action ต้องเป็น open หรือ close");
    },

    async bmsPosPark(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const shift = await requireOpenPosShift(device);
      const input = recordInput(args.input);
      const action = textInput(input.action) || "park";
      if (action === "park") {
        const parkedBy = uuidInput(input.cashierUserId, "พนักงานไม่ถูกต้อง");
        return parkSale({
          tenantId: device.tenantId,
          deviceId: device.id,
          shiftId: shift.id,
          parkedBy,
          label: typeof input.label === "string" ? input.label : "",
          cart: input.cart,
          itemCount: Number(input.itemCount ?? 0),
          subtotalHint: Number(input.subtotalHint ?? 0),
        });
      }
      const parkedId = uuidInput(input.parkedId, "บิลที่พักไว้ไม่ถูกต้อง");
      if (action === "resume") return resumeParkedSale(device.tenantId, shift.id, parkedId);
      if (action === "drop") {
        const ok = await deleteParkedSale(device.tenantId, shift.id, parkedId);
        return { status: ok ? "DROPPED" : "NOT_FOUND" };
      }
      return badPosInput("action ไม่ถูกต้อง");
    },

    async bmsPosReturn(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "order.return");
      const orderId = uuidInput(input.orderId, "orderId ไม่ถูกต้อง");
      const mode = textInput(input.mode).toUpperCase();
      const note = textInput(input.note);
      const idempotencyKey = textInput(input.idempotencyKey);
      if (mode !== "FULL" && mode !== "PARTIAL") return badPosInput("mode ต้องเป็น FULL หรือ PARTIAL");
      if (!/^\[(DAMAGED|WRONG_ITEM|CUSTOMER_CHANGE|PRICE_ERROR|QUALITY_ISSUE|OTHER)\]\s+\S/.test(note)) {
        return badPosInput("ต้องเลือกประเภทเหตุผลและระบุรายละเอียดการคืนสินค้า");
      }
      if (!idempotencyKey || idempotencyKey.length > 240) {
        return badPosInput("idempotencyKey จำเป็นและต้องยาวไม่เกิน 240 ตัวอักษร");
      }
      const preferredRaw = textInput(input.preferredRefundMethod).toUpperCase();
      if (preferredRaw && !PAYMENT_METHODS.includes(preferredRaw as PaymentMethod)) {
        return badPosInput("preferredRefundMethod ไม่ใช่วิธีชำระเงินที่รองรับ");
      }
      const approvedByUserId = await verifyOptionalPosPerson(
        device,
        input.approvalUserId,
        input.approvalPin,
      );
      const rawLines = Array.isArray(input.lines) ? input.lines : [];
      const lines = rawLines.map((line: any) => ({
        orderItemId: Number(line?.orderItemId),
        packQty: Number(line?.packQty),
      })).filter((line) => Number.isInteger(line.orderItemId) && Number.isInteger(line.packQty) && line.packQty > 0);
      if (mode === "PARTIAL" && (lines.length === 0 || lines.length !== rawLines.length)) {
        return badPosInput("การคืนบางรายการต้องมี lines ที่ถูกต้องทุกบรรทัด");
      }
      if (mode === "FULL" && rawLines.length > 0) return badPosInput("การคืนทั้งบิลต้องไม่ส่ง lines");
      const shiftId = (await getOpenPosShift(device.tenantId, device.id))?.id ?? null;
      const common = {
        tenantId: device.tenantId,
        deviceId: device.id,
        shiftId,
        orderId,
        actorUserId: actor.userId,
        note,
        approvedByUserId,
        preferredRefundMethod: preferredRaw ? preferredRaw as PaymentMethod : null,
        idempotencyKey,
      };
      return mode === "PARTIAL"
        ? partiallyReturnPosSale({ ...common, lines })
        : returnPosSale(common);
    },

    async bmsPosBlindReturn(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const shift = await requireOpenPosShift(device);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "order.return");
      const approver = await requirePosSecondPerson(
        device,
        actor.userId,
        { userId: input.approverUserId, pin: input.approverPin },
        "pos.return.noreceipt",
        {
          required: "การคืนที่ไม่มีใบเสร็จต้องมีผู้อนุมัติกด PIN",
          samePerson: "ผู้อนุมัติต้องเป็นคนละคนกับพนักงานที่รับคืน",
        },
      );
      const idempotencyKey = textInput(input.idempotencyKey);
      if (!idempotencyKey || idempotencyKey.length > 240) return badPosInput("ต้องมี idempotencyKey");
      return blindReturnPosSale({
        tenantId: device.tenantId,
        deviceId: device.id,
        shiftId: shift.id,
        actorUserId: actor.userId,
        approvedByUserId: approver.userId,
        reason: typeof input.reason === "string" ? input.reason : "",
        customerId: optionalUuidInput(input.customerId, "ลูกค้าไม่ถูกต้อง"),
        customerNote: typeof input.customerNote === "string" ? input.customerNote : null,
        lines: Array.isArray(input.lines) ? input.lines as any[] : [],
        idempotencyKey,
      });
    },

    async bmsPosVoid(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const shift = await requireOpenPosShift(device);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "order.return");
      const approver = await requirePosSecondPerson(
        device,
        actor.userId,
        { userId: input.approverUserId, pin: input.approverPin },
        "pos.void",
        {
          required: "ยกเลิกบิลต้องมีผู้อนุมัติกด PIN",
          samePerson: "ผู้อนุมัติยกเลิกบิลต้องเป็นคนละคนกับพนักงานขาย",
        },
      );
      const orderId = uuidInput(input.orderId, "บิลไม่ถูกต้อง");
      const reason = textInput(input.reason);
      const idempotencyKey = textInput(input.idempotencyKey);
      if (!idempotencyKey) return badPosInput("ต้องระบุบิลและ idempotencyKey");
      if (!reason) return badPosInput("ต้องระบุเหตุผลที่ยกเลิก");
      return voidPosSale({
        tenantId: device.tenantId,
        deviceId: device.id,
        shiftId: shift.id,
        orderId,
        actorUserId: actor.userId,
        approvedByUserId: approver.userId,
        reason,
        idempotencyKey,
      });
    },

    async bmsPosCompleteRefund(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, {
        cashierUserId: textInput(input.cashierUserId) || textInput(input.userId),
        pin: input.pin,
      }, "payment.refund");
      const allocationId = uuidInput(input.allocationId, "allocationId ไม่ถูกต้อง");
      const shiftId = (await getOpenPosShift(device.tenantId, device.id))?.id ?? null;
      return completePosRefundAllocation({
        tenantId: device.tenantId,
        deviceId: device.id,
        locationId: device.locationId,
        shiftId,
        allocationId,
        actorUserId: actor.userId,
        externalRef: typeof input.externalRef === "string" ? input.externalRef : null,
      });
    },

    async bmsPosCashMovement(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const shift = await requireOpenPosShift(device);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "pos.sell");
      const direction = input.direction === "OUT" ? "OUT" : input.direction === "IN" ? "IN" : null;
      if (!direction) return badPosInput("direction ต้องเป็น IN หรือ OUT");
      const idempotencyKey = textInput(input.idempotencyKey);
      if (!idempotencyKey || idempotencyKey.length > 240) {
        return badPosInput("ต้องมี idempotencyKey ที่ยาวไม่เกิน 240 ตัวอักษร");
      }
      let approvedByUserId: string | null = null;
      if (direction === "OUT") {
        const approver = await requirePosSecondPerson(
          device,
          actor.userId,
          { userId: input.approverUserId, pin: input.approverPin },
          "pos.cash.movement",
          {
            required: "เงินออกจากลิ้นชักต้องมีผู้อนุมัติกด PIN",
            samePerson: "ผู้อนุมัติเงินออกต้องเป็นคนละคนกับผู้ทำรายการ",
          },
        );
        approvedByUserId = approver.userId;
      }
      return recordCashMovement({
        tenantId: device.tenantId,
        deviceId: device.id,
        shiftId: shift.id,
        direction,
        amount: Number(input.amount ?? 0),
        reason: typeof input.reason === "string" ? input.reason : "",
        actorUserId: actor.userId,
        approvedByUserId,
        idempotencyKey,
      });
    },

    async bmsPosNoSale(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const shift = await requireOpenPosShift(device);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "pos.nosale");
      return recordNoSale({
        tenantId: device.tenantId,
        deviceId: device.id,
        shiftId: shift.id,
        actorUserId: actor.userId,
        reason: typeof input.reason === "string" ? input.reason : "",
      });
    },

    async bmsPosEnrollMember(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "member.manage");
      const phone = textInput(input.phone);
      if (!phone) return badPosInput("phone จำเป็น");
      const shift = await getOpenPosShift(device.tenantId, device.id);
      const result = await enrollMember(device.tenantId, {
        phone,
        name: typeof input.name === "string" ? input.name : null,
        actorUserId: actor.userId,
        enrollmentChannel: "POS",
        enrolledLocationId: device.locationId,
        enrolledPosDeviceId: device.id,
        enrolledShiftId: shift?.id ?? null,
      });
      return result.status === "INVALID"
        ? { ...result, error: result.reason }
        : { ...result, member: toPosMemberSummary(result.member) };
    },

    async bmsPosCollectAr(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "ar.collect");
      const accountId = uuidInput(input.accountId, "บัญชีลูกหนี้ไม่ถูกต้อง");
      const idempotencyKey = textInput(input.idempotencyKey);
      const method = textInput(input.method).toUpperCase() as ArReceiptMethod;
      if (!idempotencyKey || idempotencyKey.length > 240) {
        return badPosInput("ต้องมี idempotencyKey ที่ยาวไม่เกิน 240 ตัวอักษร");
      }
      if (!AR_RECEIPT_METHODS.includes(method)) return badPosInput(`วิธีรับชำระไม่ถูกต้อง: ${method || "(ว่าง)"}`);
      const shift = await getOpenPosShift(device.tenantId, device.id);
      if (method === "CASH" && !shift) {
        throw new GraphQLError("รับเงินสดต้องเปิดกะก่อน", { extensions: { code: "CONFLICT" } });
      }
      return recordArReceipt({
        tenantId: device.tenantId,
        accountId,
        amount: Number(input.amount),
        method,
        reference: typeof input.reference === "string" ? input.reference : null,
        note: typeof input.note === "string" ? input.note : null,
        receivedBy: actor.userId,
        idempotencyKey,
        locationId: device.locationId,
        deviceId: device.id,
        shiftId: shift?.id ?? null,
      });
    },

    async bmsPosReceivePurchase(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "purchase.receive");
      const poId = uuidInput(input.poId, "ใบสั่งซื้อไม่ถูกต้อง");
      const idempotencyKey = textInput(input.idempotencyKey);
      if (!idempotencyKey || idempotencyKey.length > 200) {
        return badPosInput("idempotencyKey จำเป็นและต้องไม่เกิน 200 ตัวอักษร");
      }
      const rawItems = Array.isArray(input.items) ? input.items : [];
      if (!rawItems.length || rawItems.length > 200) return badPosInput("รับสินค้าได้ 1–200 รายการต่อครั้ง");
      if (rawItems.some((raw: any) =>
        (typeof raw?.sku === "string" && raw.sku.trim().length > 200)
        || (typeof raw?.size === "string" && raw.size.trim().length > 100)
        || (typeof raw?.lotNo === "string" && raw.lotNo.trim().length > 100)
        || (typeof raw?.expiryDate === "string" && raw.expiryDate !== "" && !isIsoDate(raw.expiryDate))
      )) {
        return badPosInput("lot หรือวันหมดอายุไม่ถูกต้อง");
      }
      const items: ReceiveInput[] = rawItems.map((raw: any) => ({
        sku: typeof raw?.sku === "string" ? raw.sku.trim() : "",
        size: typeof raw?.size === "string" ? raw.size.trim() : "",
        qty: Number(raw?.qty),
        lotNo: typeof raw?.lotNo === "string" ? raw.lotNo.trim() || null : null,
        expiryDate: typeof raw?.expiryDate === "string" && isIsoDate(raw.expiryDate) ? raw.expiryDate : null,
      }));
      if (items.some((item) => !item.sku || item.sku.length > 200 || !item.size || item.size.length > 100
        || !Number.isInteger(item.qty) || item.qty <= 0 || (item.expiryDate != null && !item.lotNo))) {
        return badPosInput("รายการรับสินค้าไม่ถูกต้อง");
      }
      return receivePurchaseOrder(device.tenantId, poId, items, actor.userId, actor.userId, {
        locationId: device.locationId,
        idempotency: { deviceId: device.id, actorUserId: actor.userId, key: idempotencyKey },
        audit: { actor: actor.userId, action: "purchase.receive", meta: { surface: "graphql-pos", deviceId: device.id } },
      });
    },

    async bmsPosSendReceipt(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      await requirePosCashier(device, input, "pos.sell");
      const orderId = uuidInput(input.orderId, "บิลไม่ถูกต้อง");
      if (!(await isPosOrderOwnedByDevice(device.tenantId, orderId, device.id))) {
        throw new GraphQLError("ไม่พบบิลนี้ของเครื่องนี้", { extensions: { code: "NOT_FOUND" } });
      }
      return sendReceipt({
        tenantId: device.tenantId,
        orderId,
        channel: input.channel === "line" ? "line" : "email",
        to: typeof input.to === "string" ? input.to : null,
      });
    },

    async bmsPosDeposit(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const action = textInput(input.action).toLowerCase();
      const permission = action === "close" ? "pos.deposit.cancel" : "pos.deposit.take";
      const actor = await requirePosCashier(device, input, permission);
      const openShift = await getOpenPosShift(device.tenantId, device.id);
      const shiftId = openShift?.id ?? optionalUuidInput(input.shiftId, "กะไม่ถูกต้อง");
      if (!shiftId) return { status: "SHIFT_NOT_OPEN" };
      const orderId = textInput(input.orderId);
      if (!isPosUuid(orderId)) {
        return badPosInput("เลขนี้ไม่ใช่บิลในระบบ กรุณาเลือกบิลจากรายการ ไม่ใช่เลขบาร์โค้ดสินค้า");
      }
      const idempotencyKey = textInput(input.idempotencyKey);
      if (action === "take" || action === "add") {
        if (!idempotencyKey) return badPosInput("ต้องมี idempotencyKey");
        const amount = Number(input.amount ?? 0);
        const method = textInput(input.method).toUpperCase() || "CASH";
        const parsed = parsePosPayments([{ method, amount }]);
        if (!parsed.ok) return badPosInput(parsed.error);
        if (method === "STORE_CREDIT") return badPosInput("ยังไม่รองรับเครดิตร้านสำหรับเงินมัดจำ");
        return action === "take"
          ? takeDeposit({
            tenantId: device.tenantId,
            orderId,
            amount,
            method,
            deviceId: device.id,
            shiftId,
            expectedLocationId: device.locationId,
            customerNote: typeof input.customerNote === "string" ? input.customerNote : null,
            dueAt: typeof input.dueAt === "string" ? input.dueAt : null,
            createdBy: actor.userId,
            idempotencyKey,
          })
          : addToDeposit({
            tenantId: device.tenantId,
            orderId,
            amount,
            method,
            actorUserId: actor.userId,
            locationId: device.locationId,
            idempotencyKey,
          });
      }
      if (action === "settle") {
        const parsed = parsePosPayments(input.payments);
        if (!parsed.ok) return badPosInput(parsed.error);
        return settleDepositSale({
          tenantId: device.tenantId,
          deviceId: device.id,
          shiftId,
          cashierUserId: actor.userId,
          orderId,
          payments: parsed.payments,
          serialLines: Array.isArray(input.lines) ? (input.lines as any[]).map((line) => ({
            sku: String(line?.sku ?? "").trim(),
            size: String(line?.size ?? "").trim(),
            serials: Array.isArray(line?.serials)
              ? line.serials.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
              : [],
          })) : [],
        });
      }
      if (action === "close") {
        return closeDeposit({
          tenantId: device.tenantId,
          orderId,
          outcome: input.outcome === "FORFEITED" ? "FORFEITED" : "CANCELLED",
          reason: typeof input.reason === "string" ? input.reason : "",
          actorUserId: actor.userId,
          locationId: device.locationId,
        });
      }
      return badPosInput("action ไม่ถูกต้อง");
    },

    async bmsPosExpense(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const action = textInput(input.action).toLowerCase();
      const permission = action === "fund" ? "pos.petty_cash.manage" : "pos.expense.create";
      const actor = await requirePosCashier(device, input, permission);
      if (action === "fund") {
        const source = input.source === "OWNER_PERSONAL" || input.source === "BUSINESS_ACCOUNT"
          ? input.source as PosPettyCashFundingSource
          : null;
        if (!source) return badPosInput("แหล่งเงินสดย่อยไม่ถูกต้อง");
        return fundPosPettyCash({
          tenantId: device.tenantId,
          locationId: device.locationId,
          source,
          amount: Number(input.amount),
          reason: typeof input.reason === "string" ? input.reason : "",
          evidenceRef: typeof input.evidenceRef === "string" ? input.evidenceRef : "",
          actorUserId: actor.userId,
          idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey : "",
        });
      }
      if (action !== "create" && action !== "settle") return badPosInput("action ต้องเป็น create, settle หรือ fund");
      const openShift = await getOpenPosShift(device.tenantId, device.id);
      const shiftId = openShift?.id ?? optionalUuidInput(input.shiftId, "กะไม่ถูกต้อง");
      if (!shiftId) return { status: "SHIFT_NOT_OPEN" };
      const idempotencyKey = textInput(input.idempotencyKey);
      if (!idempotencyKey || idempotencyKey.length > 180) {
        return badPosInput("idempotencyKey จำเป็นและต้องไม่เกิน 180 ตัวอักษร");
      }
      if (input.fundingSource != null && input.fundingSource !== "DRAWER"
          && input.fundingSource !== "PERSONAL" && input.fundingSource !== "PETTY_CASH") {
        return badPosInput("แหล่งเงินค่าใช้จ่ายไม่ถูกต้อง");
      }
      const fundingSource: PosExpenseFundingSource = input.fundingSource === "PERSONAL"
        ? "PERSONAL"
        : input.fundingSource === "PETTY_CASH"
          ? "PETTY_CASH"
          : "DRAWER";
      let approvedByUserId: string | null = null;
      if (action === "settle" || fundingSource === "DRAWER") {
        const approver = await requirePosSecondPerson(
          device,
          actor.userId,
          { userId: input.approverUserId, pin: input.approverPin },
          "pos.cash.movement",
          {
            required: "เงินออกจากลิ้นชักต้องมีผู้อนุมัติกด PIN",
            samePerson: "ผู้อนุมัติต้องเป็นคนละคนกับผู้ทำรายการ",
          },
        );
        approvedByUserId = approver.userId;
      } else if (fundingSource === "PERSONAL") {
        await requirePosPermissionForActor(device, actor.userId, "pos.expense.personal");
      }
      const receiptRef = typeof input.receiptRef === "string" ? input.receiptRef : null;
      if (action === "create") {
        const kind = input.kind === "DIRECT" || input.kind === "ADVANCE" ? input.kind as PosExpenseKind : null;
        const category = typeof input.category === "string"
          && (POS_EXPENSE_CATEGORIES as readonly string[]).includes(input.category)
          ? input.category as PosExpenseCategory
          : null;
        if (!kind || !category) return badPosInput("รูปแบบหรือหมวดค่าใช้จ่ายไม่ถูกต้อง");
        return createPosExpense({
          tenantId: device.tenantId,
          shiftId,
          deviceId: device.id,
          locationId: device.locationId,
          kind,
          category,
          description: typeof input.description === "string" ? input.description : "",
          payee: typeof input.payee === "string" ? input.payee : null,
          amount: Number(input.amount),
          receiptRef,
          actorUserId: actor.userId,
          fundingSource,
          approvedByUserId,
          idempotencyKey,
        });
      }
      const expenseId = uuidInput(input.expenseId, "รายการค่าใช้จ่ายไม่ถูกต้อง");
      return settlePosExpense({
        tenantId: device.tenantId,
        shiftId,
        deviceId: device.id,
        expenseId,
        actualAmount: Number(input.actualAmount),
        receiptRef,
        actorUserId: actor.userId,
        approvedByUserId: approvedByUserId!,
        idempotencyKey,
      });
    },

    async bmsPosRequestPharmacyReview(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "pos.sell");
      const currentShift = await getOpenPosShift(device.tenantId, device.id);
      const shiftId = currentShift?.id ?? optionalUuidInput(input.shiftId, "กะไม่ถูกต้อง");
      const idempotencyKey = textInput(input.idempotencyKey);
      if (!shiftId || !idempotencyKey) return badPosInput("ต้องเปิดกะและมี idempotencyKey");
      if (idempotencyKey.length > 240) return badPosInput("idempotencyKey ต้องยาวไม่เกิน 240 ตัวอักษร");
      const lines = parsePosSaleLines(input.lines);
      if (!lines.length) return badPosInput("ต้องมีรายการสินค้าอย่างน้อย 1 รายการ");
      return requestPosPharmacyReview({
        tenantId: device.tenantId,
        deviceId: device.id,
        shiftId,
        cashierUserId: actor.userId,
        idempotencyKey,
        customerId: optionalUuidInput(input.customerId, "ลูกค้าไม่ถูกต้อง"),
        label: typeof input.label === "string" ? input.label : "",
        lines,
        parkedCart: input.parkedCart,
        itemCount: Number(input.itemCount ?? 0),
        subtotalHint: Number(input.subtotalHint ?? 0),
      });
    },

    async bmsPosKitchenTicketStatus(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, {
        cashierUserId: textInput(input.cashierUserId) || textInput(input.userId),
        pin: input.pin,
      }, "restaurant.kitchen.update");
      const ticketId = uuidInput(input.ticketId, "ticketId ไม่ถูกต้อง");
      const status = textInput(input.status).toUpperCase();
      if (!status) return badPosInput("ต้องระบุ ticketId และ status");
      return {
        ticket: await updateKitchenTicketStatus({
          tenantId: device.tenantId,
          ticketId,
          status,
          actorUserId: actor.userId,
          expectedLocationId: device.locationId,
          onRestaurantCheckLineCancelled: dropKitchenCancelledLineInTx,
        }),
      };
    },

    async bmsPosKitchenTicketsStatus(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, {
        cashierUserId: textInput(input.cashierUserId) || textInput(input.userId),
        pin: input.pin,
      }, "restaurant.kitchen.update");
      const status = textInput(input.status).toUpperCase();
      const ticketIds = Array.isArray(input.ticketIds)
        ? input.ticketIds.map((id) => uuidInput(id, "ticketIds ไม่ถูกต้อง"))
        : [];
      if (!status || !ticketIds.length) return badPosInput("ต้องระบุ status และ ticketIds");
      return {
        tickets: await updateKitchenTicketsStatus({
          tenantId: device.tenantId,
          ticketIds,
          status,
          actorUserId: actor.userId,
          expectedLocationId: device.locationId,
          onRestaurantCheckLineCancelled: dropKitchenCancelledLineInTx,
        }),
      };
    },

    async bmsPosRestaurantFloorSetup(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "restaurant.floor.manage");
      await requireOpenPosShift(device);
      return createDefaultRestaurantFloor({
        tenantId: device.tenantId,
        locationId: device.locationId,
        actorUserId: actor.userId,
        tableCount: Number(input.tableCount ?? 12),
      });
    },

    async bmsPosRestaurantMenuAvailability(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "pos.sell");
      await requireOpenPosShift(device);
      const productSku = textInput(input.productSku);
      if (!productSku || typeof input.unavailable !== "boolean") {
        return badPosInput("ต้องระบุเมนูและสถานะหมดวันนี้");
      }
      return setMenuTemporarilyUnavailable({
        tenantId: device.tenantId,
        locationId: device.locationId,
        productSku,
        unavailable: input.unavailable,
        actorUserId: actor.userId,
        reason: typeof input.reason === "string" ? input.reason : null,
      });
    },

    async bmsPosRestaurantOpenCheck(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "pos.sell");
      const shift = await requireOpenPosShift(device);
      const tableId = uuidInput(input.tableId, "โต๊ะไม่ถูกต้อง");
      return {
        check: await openRestaurantCheck({
          tenantId: device.tenantId,
          locationId: device.locationId,
          deviceId: device.id,
          shiftId: shift.id,
          tableId,
          guestCount: Number(input.guestCount ?? 1),
          note: typeof input.note === "string" ? input.note : null,
          actorUserId: actor.userId,
        }),
      };
    },

    async bmsPosRestaurantCheckAction(_parent: unknown, args: { checkId: string; input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const action = textInput(input.action).toLowerCase();
      const actor = await requirePosCashier(device, input, "pos.sell");
      if (action === "cancel") {
        await requirePosPermissionForActor(device, actor.userId, "restaurant.check.cancel");
      }
      const shift = await requireOpenPosShift(device);
      const checkId = uuidInput(args.checkId, "บิลโต๊ะไม่ถูกต้อง");
      const common = {
        tenantId: device.tenantId,
        locationId: device.locationId,
        checkId,
        actorUserId: actor.userId,
      };
      if (action === "add_item") {
        return { check: await addRestaurantCheckItem({
          ...common,
          sku: textInput(input.sku),
          size: typeof input.size === "string" ? input.size : null,
          packCode: typeof input.packCode === "string" ? input.packCode : null,
          packQty: Number(input.packQty ?? 1),
          modifierCodes: Array.isArray(input.modifierCodes) ? input.modifierCodes.map(String) : [],
          kitchenNote: typeof input.kitchenNote === "string" ? input.kitchenNote : null,
        }) };
      }
      if (action === "remove_item") {
        return { check: await removeRestaurantCheckItem({
          ...common,
          itemId: uuidInput(input.itemId, "รายการในบิลไม่ถูกต้อง"),
        }) };
      }
      if (action === "set_guest_count") {
        return { check: await setRestaurantCheckGuestCount({ ...common, guestCount: Number(input.guestCount ?? 0) }) };
      }
      if (action === "send_kitchen") {
        return sendRestaurantKitchenRound({ ...common, deviceId: device.id, shiftId: shift.id });
      }
      if (action === "move") {
        return { check: await moveRestaurantCheck({
          ...common,
          targetTableId: uuidInput(input.targetTableId, "โต๊ะปลายทางไม่ถูกต้อง"),
        }) };
      }
      if (action === "split") {
        const itemIds = Array.isArray(input.itemIds)
          ? input.itemIds.map((id) => uuidInput(id, "รายการที่จะแยกไม่ถูกต้อง"))
          : [];
        if (!itemIds.length) return badPosInput("เลือกรายการที่จะแยกไปบิลใหม่ก่อน");
        return splitRestaurantCheck({
          ...common,
          deviceId: device.id,
          shiftId: shift.id,
          itemIds,
          guestCount: input.guestCount == null ? null : Number(input.guestCount),
        });
      }
      if (action === "merge") {
        const targetCheckId = uuidInput(input.targetCheckId, "บิลปลายทางไม่ถูกต้อง");
        return mergeRestaurantChecks({
          tenantId: device.tenantId,
          locationId: device.locationId,
          deviceId: device.id,
          shiftId: shift.id,
          actorUserId: actor.userId,
          sourceCheckId: checkId,
          targetCheckId,
        });
      }
      if (action === "cancel") {
        const reason = textInput(input.reason);
        if (!reason) return badPosInput("ต้องระบุ Note ว่ายกเลิกบิลเพราะอะไร");
        const check = await getRestaurantCheck(device.tenantId, checkId, device.locationId);
        if (!check) throw new GraphQLError("ไม่พบบิลโต๊ะ", { extensions: { code: "NOT_FOUND" } });
        const requiresVoidApproval = ["OPEN", "CLOSING"].includes(check.status)
          && (check.hasCurrentOrder || check.items.some((item) => item.status === "SENT"));
        let approvedByUserId: string | null = null;
        if (requiresVoidApproval) {
          const approver = await requirePosSecondPerson(
            device,
            actor.userId,
            { userId: input.approverUserId, pin: input.approverPin },
            "pos.void",
            {
              required: "บิลที่ส่งครัวแล้วต้องมีผู้อนุมัติกด PIN",
              samePerson: "ผู้อนุมัติยกเลิกบิลต้องเป็นคนละคนกับผู้ปฏิบัติงาน",
            },
          );
          approvedByUserId = approver.userId;
        }
        return cancelRestaurantCheck({ ...common, reason, approvedByUserId });
      }
      if (action === "settle") {
        const parsed = parsePosPayments(input.payments);
        if (!parsed.ok) return badPosInput(parsed.error);
        return settleRestaurantCheck({
          ...common,
          deviceId: device.id,
          shiftId: shift.id,
          customerId: optionalUuidInput(input.customerId, "ลูกค้าไม่ถูกต้อง"),
          payments: parsed.payments,
        });
      }
      return badPosInput("action ไม่ถูกต้อง");
    },

    async bmsPosRestaurantIncomingAction(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const action = textInput(input.action);
      const permission = action === "pause"
        ? "restaurant.floor.manage"
        : action === "cancel_lines"
          ? "order.line.cancel"
          : "restaurant.kitchen.update";
      const actor = await requirePosCashier(device, input, permission);
      await requireOpenPosShift(device);
      if (action === "accept") {
        const orderId = uuidInput(input.orderId, "ออร์เดอร์ไม่ถูกต้อง");
        return acceptIncomingRestaurantOrder({
          tenantId: device.tenantId,
          locationId: device.locationId,
          orderId,
          actorUserId: actor.userId,
        });
      }
      if (action === "pause" && typeof input.paused === "boolean") {
        return setRestaurantOrderingPaused({
          tenantId: device.tenantId,
          paused: input.paused,
          actorUserId: actor.userId,
        });
      }
      if (action === "cancel_lines") {
        const orderId = uuidInput(input.orderId, "ออร์เดอร์ไม่ถูกต้อง");
        const idempotencyKey = textInput(input.idempotencyKey);
        const rawLines = Array.isArray(input.lines) ? input.lines : [];
        const lines = rawLines.map((line: any) => ({
          orderItemId: Number(line?.orderItemId),
          packQty: Number(line?.packQty),
          cause: String(line?.cause ?? ""),
        })).filter((line) => Number.isInteger(line.orderItemId) && Number.isInteger(line.packQty)
          && line.packQty > 0 && ["MERCHANT_OUT_OF_STOCK", "CUSTOMER_CHANGED"].includes(line.cause));
        if (!idempotencyKey || !lines.length || lines.length !== rawLines.length) {
          return badPosInput("ต้องระบุออร์เดอร์ รายการ ต้นเหตุ และ idempotencyKey ให้ถูกต้องทุกบรรทัด");
        }
        let managerApprovedByUserId: string | null = null;
        if (textInput(input.managerUserId) || textInput(input.managerPin)) {
          const manager = await requirePosSecondPerson(
            device,
            actor.userId,
            { userId: input.managerUserId, pin: input.managerPin },
            "restaurant.floor.manage",
            {
              required: "ต้องระบุผู้จัดการและ PIN",
              samePerson: "ผู้ยืนยันต้องเป็นผู้จัดการคนอื่น",
            },
          );
          managerApprovedByUserId = manager.userId;
        }
        return cancelRestaurantOrderLines({
          tenantId: device.tenantId,
          locationId: device.locationId,
          orderId,
          actorUserId: actor.userId,
          lines: lines as any,
          idempotencyKey,
          managerApprovedByUserId,
          note: textInput(input.note) || null,
        });
      }
      return badPosInput("คำสั่งไม่ถูกต้อง");
    },

    async bmsPosRestaurantQrOrderAction(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "pos.sell");
      const shift = await requireOpenPosShift(device);
      const submissionId = uuidInput(input.submissionId, "ออร์เดอร์ QR ไม่ถูกต้อง");
      const action = textInput(input.action);
      if (action === "accept") {
        return acceptRestaurantQrSubmission({
          tenantId: device.tenantId,
          locationId: device.locationId,
          deviceId: device.id,
          shiftId: shift.id,
          submissionId,
          actorUserId: actor.userId,
        });
      }
      if (action === "reject") {
        return rejectRestaurantQrSubmission({
          tenantId: device.tenantId,
          locationId: device.locationId,
          submissionId,
          actorUserId: actor.userId,
          reason: typeof input.reason === "string" ? input.reason : "",
        });
      }
      return badPosInput("คำสั่งไม่ถูกต้อง");
    },

    async bmsPosRestaurantRequestAction(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "pos.sell");
      await requireOpenPosShift(device);
      if (input.action === "list") {
        return { requests: await listRestaurantRequests({
          tenantId: device.tenantId,
          locationId: device.locationId,
          actorUserId: actor.userId,
        }) };
      }
      return reviewRestaurantRequest({
        tenantId: device.tenantId,
        locationId: device.locationId,
        actorUserId: actor.userId,
        id: uuidInput(input.id, "คำขอไม่ถูกต้อง"),
        version: input.version as any,
        action: input.action as any,
        quantities: input.quantities as any,
        note: typeof input.note === "string" ? input.note : "",
        kitchenNote: typeof input.kitchenNote === "string" ? input.kitchenNote : undefined,
        confirmed: input.confirmed === true,
      });
    },

    async bmsPosRestaurantServiceCallAction(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "pos.sell");
      await requireOpenPosShift(device);
      const action = input.action === "acknowledge" || input.action === "complete" ? input.action : null;
      const callId = uuidInput(input.callId, "คำขอไม่ถูกต้อง");
      if (!action) return badPosInput("คำขอหรือการทำงานไม่ถูกต้อง");
      return updateRestaurantServiceCall({
        tenantId: device.tenantId,
        locationId: device.locationId,
        actorUserId: actor.userId,
        callId,
        action,
      });
    },

    async bmsPosRestaurantWaitlistAction(_parent: unknown, args: { input: unknown }, ctx: any) {
      const device = requirePosDevice(ctx);
      const input = recordInput(args.input);
      const actor = await requirePosCashier(device, input, "pos.sell");
      const shift = await requireOpenPosShift(device);
      const action = textInput(input.action).toLowerCase();
      const common = {
        tenantId: device.tenantId,
        locationId: device.locationId,
        actorUserId: actor.userId,
      };
      if (action === "add") {
        return { entry: await addRestaurantWaitlistEntry({
          ...common,
          kind: input.kind === "RESERVATION" ? "RESERVATION" : "WALK_IN",
          partySize: Number(input.partySize ?? 0),
          guestName: typeof input.guestName === "string" ? input.guestName : null,
          guestPhone: typeof input.guestPhone === "string" ? input.guestPhone : null,
          note: typeof input.note === "string" ? input.note : null,
          preferredTableId: optionalUuidInput(input.preferredTableId, "โต๊ะที่ต้องการไม่ถูกต้อง"),
          reservedFor: typeof input.reservedFor === "string" ? input.reservedFor : null,
        }) };
      }
      const entryId = uuidInput(input.entryId, "คิวไม่ถูกต้อง");
      if (action === "call") return { entry: await callRestaurantWaitlistEntry({ ...common, entryId }) };
      if (action === "cancel" || action === "no_show") {
        return { entry: await closeRestaurantWaitlistEntry({
          ...common,
          entryId,
          status: action === "cancel" ? "CANCELLED" : "NO_SHOW",
          reason: typeof input.reason === "string" ? input.reason : null,
        }) };
      }
      if (action === "seat") {
        const tableId = uuidInput(input.tableId, "โต๊ะไม่ถูกต้อง");
        return seatRestaurantWaitlistEntry({
          ...common,
          deviceId: device.id,
          shiftId: shift.id,
          entryId,
          tableId,
        });
      }
      return badPosInput("action ไม่ถูกต้อง");
    },
  },
};
