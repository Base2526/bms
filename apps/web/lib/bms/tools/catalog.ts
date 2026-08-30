// =============================================================
// BMS AI Tools — catalog (ทูลทุกตัว = wrapper บาง ๆ ของ service เดิม)
// -------------------------------------------------------------
// A1 read-only · A2 write (execute+audit) · A3 sensitive (propose-only)
// customerTools() / staffTools(perms) กรองตาม surface + RBAC
// ยึด docs/AI_GUIDELINES.md — tenant มาจาก server, validate args, bounded output
// =============================================================

import { audit } from "../audit";
import type { Channel } from "../pipeline";
import type { BmsPermission } from "../permissions";
import {
  type BmsTool,
  type ExecCtx,
  ToolArgError,
  type ToolResult,
  assertValidToolRegistry,
  enumVal,
  optInt,
  optString,
  reqInt,
  reqItems,
  reqString,
} from "./types";

import {
  findAlternativeProducts,
  listProducts,
  listSellableProducts,
  listVariants,
  listLowStock,
  type SellableProduct,
} from "../products";
import { checkStock, listVariantReservations } from "../stock";
import { CARRIER_CODES } from "../carriers/constants";
import { quoteShipping } from "../shippingRates";
import {
  createOrder,
  recalculateOrderShipping,
  reorderFromOrder,
  getOrderJourney,
  listCustomerOrderStatuses,
  findCustomerPayableOrder,
  customerOwnsOrder as serviceCustomerOwnsOrder,
  type OrderItemInput,
} from "../orders";
import { resolveSellablePack } from "../productPacks";
import { orderQuoteFingerprint, type OrderQuoteLine } from "../orderQuote";
import { createProductReviewAssessmentOnce } from "../pharmacy/assessments";
import { isPharmacistReviewableBasket } from "../pharmacy/productPolicyDecision";
import { submitPayment, submitPaymentOnce, verifyPaymentSlip, listPayments, PAYMENT_METHODS } from "../payments";
import {
  createShipment,
  updateTracking,
  setShipmentStatus,
  listShipments,
  getShipmentLabel,
  CARRIERS,
  SHIPMENT_STATUSES,
  MARKETPLACE_CHANNELS,
} from "../shipping";
import {
  createPurchaseOrder,
  receivePurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrder,
  listSuppliers,
} from "../purchase";
import {
  listCustomers,
  getCustomer,
  customerOrders,
  upsertCustomer,
  setCustomerTags,
  getCustomerCheckoutStatus,
  saveCustomerCheckoutDetails,
  findCustomerIdByIdentity,
} from "../customers";
import { getLoyaltySettings, getMember, pointsToDiscount } from "../membership";
import {
  getSalesSummary,
  getInventorySummary,
  getTopSellingProducts,
  getLifetimeSalesSummary,
  getLifetimeTopSellingProducts,
} from "../reports";
import {
  findPosShiftOrderReference,
  getPosShiftExportData,
  isPosShiftOverviewDate,
  listPosShiftOverview,
  type PosShiftOverviewRow,
} from "../pos";
import { getDashboard } from "../dashboard";
import { assignConversation, setConversationStatus, setConversationTags, addNote, getConversation, listMessages } from "../inbox";
import { subscribeToRestock } from "../restockSubscriptions";
import { getStoreProfile } from "../storeProfile";
import {
  configuredPaymentAccounts,
  isCustomerPaymentMethod,
  supportsCustomerPaymentMethod,
} from "../paymentConfiguration";
import { getTenantName, getTenantSlug } from "../platform";
import { generateInvoice, generateQuotation } from "../documents";
import { forecastDemand, predictStockOut, suggestPurchaseOrder } from "../forecast";
import { understand } from "../nlu";
import { checkCouponForCustomer, listAvailableCouponsForCustomer, listCustomerCouponWallet } from "../coupons";
import { recordSynonymCandidate } from "../aiSynonyms";
import { generateReport, REPORT_TYPES, REPORT_FORMATS } from "../reportEngine";
import { isKnownReportRecipient } from "../reportEmail";
import { getAssistantSelfProfile, getTenantStaffUserAccess, searchTenantStaffUsers } from "../assistantAccess";
import {
  SYSTEM_CAPABILITIES,
  SYSTEM_GUIDES,
  faqsForGuide,
  limitsForGuide,
  groupPermissionDescriptions,
  searchAssistantKnowledge,
} from "../assistantKnowledge";

const CONV_STATUSES = ["OPEN", "PENDING", "CLOSED"] as const;
const STAFF_CHANNELS = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada"] as const;

// ---- shared helpers ----

/** ctx สังเคราะห์สำหรับ audit ฝั่ง customer (ไม่มี GraphQL ctx) — staff ใช้ ctx จริง */
function auditCtxOf(ec: ExecCtx): any {
  return ec.ctx ?? { tenant_id: ec.tenantId, admin: { email: ec.actor } };
}
async function auditWrite(ec: ExecCtx, action: string, target: string | null, meta: Record<string, unknown>) {
  await audit(auditCtxOf(ec), action, target, { ...meta, via: `ai:${ec.surface}` });
}

/** customer scope guard: order นี้เป็นของลูกค้าคนที่กำลังคุยจริงไหม (กันเดา orderId คนอื่น) */
async function customerOwnsOrder(ec: ExecCtx, orderId: string): Promise<boolean> {
  if (!ec.customerRef || !ec.channel) return false;
  return serviceCustomerOwnsOrder(ec.tenantId, ec.channel, ec.customerRef, orderId);
}

function optMoney(args: Record<string, any>, key: string): number | null {
  const v = args?.[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ToolArgError(`"${key}" ต้องเป็นตัวเลข ≥ 0`);
  return n;
}

function safeCatalogProduct(product: SellableProduct, tenantSlug: string | null) {
  const publicPath = tenantSlug
    ? `/shop/${encodeURIComponent(tenantSlug)}/products/${encodeURIComponent(product.sku)}`
    : null;
  const publicBaseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL || "https://bms.jachoei.com"
  ).replace(/\/$/, "");
  return {
    sku: product.sku,
    name: product.name,
    price: product.price,
    description: product.description?.slice(0, 400) ?? null,
    category: product.category,
    brand: product.brand,
    availableTotal: product.availableTotal,
    availableSizes: product.availableSizes.filter((variant) => variant.available > 0),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    publicPath,
    publicUrl: publicPath ? `${publicBaseUrl}${publicPath}` : null,
  };
}

// เฉพาะ field ที่ใช้ตอบลูกค้าจริง — `state` + `available` + `reason` บอกสถานะได้ครบแล้ว
// (ใช้ได้/หมดอายุ/ยังไม่เริ่ม/ใช้ครบสิทธิ์) ตามที่ description ของทูลสัญญาไว้ ส่วน timestamp
// ภายในกับเลขออเดอร์ที่ผูกอยู่ (reserved*/redeemed*/revokedAt/source/assigned*) ไม่ได้ใช้ทั้งใน
// deterministic reply (couponStateLabel/couponLine ใน pipeline.ts) และในคำตอบที่ลูกค้าควรเห็น
// จึงไม่ส่งเข้า context — payload ต่อคูปองเล็กลง ~43%
function safeCoupon(c: any) {
  return {
    code: c.code,
    type: c.type,
    value: c.value,
    minOrderAmount: c.minOrderAmount,
    startsAt: c.startsAt,
    expiresAt: c.expiresAt,
    remainingRedemptions: c.remainingRedemptions,
    subtotalOk: c.subtotalOk,
    discountPreview: c.discountPreview,
    available: c.available,
    reason: c.reason,
    state: c.state ?? "ASSIGNED",
  };
}

// =============================================================
// A1 — read-only
// =============================================================

const searchSystemCapabilitiesTool: BmsTool = {
  name: "search_system_capabilities",
  description:
    "Search verified BMS capabilities when staff ask whether the system supports something. Returns implementation status, limitations, route, and whether the current actor has the required permissions. Product support is not proof that this tenant enabled or configured the feature.",
  surfaces: ["staff"],
  whenToUse: "The user asks whether BMS can do something, which formats are supported, or whether a named integration is live, conditional, mock, or unavailable.",
  whenNotToUse: "Do not use it for live shop figures, tenant configuration, customer eligibility, or record status; those require the relevant business/configuration tool.",
  commonMistakes: [
    "Do not report CONDITIONAL as enabled for this shop without a configuration tool result.",
    "Do not report MOCK or BETA as live.",
  ],
  example: { input: { query: "export PDF Excel ได้ไหม" }, note: "Capability discovery, not a request to generate a report." },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Capability question in Thai or English." },
      locale: { type: "string", enum: ["th", "en"], description: "Response language (default th)." },
      limit: { type: "integer", description: "Maximum results (default 5, max 10)." },
    },
    required: ["query"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const locale = enumVal(args, "locale", ["th", "en"] as const, false) ?? "th";
    const ranked = searchAssistantKnowledge(reqString(args, "query"), {
      locale,
      currentPath: ec.currentPath,
      pageId: ec.pageId,
      permissions: ec.permissions,
      role: ec.role,
      isPlatformAdmin: ec.isPlatformAdmin,
      kind: "capability",
      limit: 20,
    });
    const rankedIds = ranked.map((result) => result.id);
    const resultById = new Map(ranked.map((result) => [result.id, result]));
    const rank = new Map(rankedIds.map((id, index) => [id, index]));
    const limit = optInt(args, "limit", 1, 10) ?? 5;
    const capabilities = SYSTEM_CAPABILITIES
      .filter((entry) => rank.has(entry.id))
      .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99))
      .slice(0, limit)
      .map((entry) => {
        const match = resultById.get(entry.id);
        const missingPermissions = match?.missingPermissions ?? [];
        return {
          id: entry.id,
          title: entry.title[locale],
          description: entry.description[locale],
          status: entry.status,
          route: entry.route,
          formats: entry.formats ?? [],
          configurationRequired: entry.configurationDependencies.length > 0,
          configurationDependencies: entry.configurationDependencies,
          limitations: entry.limitations[locale],
          requiredPermissions: entry.requiredPermissions,
          anyOfPermissions: entry.anyOfPermissions ?? [],
          missingPermissions,
          accessible: match?.accessible === true,
          accessRequirement: entry.accessRequirement ?? "any_staff",
          accessNote: match?.accessNote ?? null,
        };
      });
    return { ok: true, data: { capabilities } };
  },
};

const searchSystemGuidesTool: BmsTool = {
  name: "search_system_guides",
  description:
    "Search verified bilingual BMS usage guides. Returns prerequisites, steps, warnings, route, verified FAQ answers, and current-actor access. Use this to answer how a page or workflow is used; never invent missing steps, and prefer quoting a matching FAQ answer over composing one from the steps.",
  surfaces: ["staff"],
  whenToUse: "The user asks how to use a page, menu, workflow, button, or why a documented prerequisite is blocking them.",
  whenNotToUse: "Do not use guide text as live business data or proof that the actor is authorized; execution remains backend-gated.",
  commonMistakes: [
    "Current page is only a retrieval hint and never grants permission.",
    "If no verified guide matches, say coverage is unavailable instead of inventing steps.",
  ],
  example: { input: { query: "เปิดกะ POS อย่างไร" }, note: "Returns the verified POS shift guide." },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "How-to question in Thai or English." },
      locale: { type: "string", enum: ["th", "en"], description: "Response language (default th)." },
      limit: { type: "integer", description: "Maximum results (default 5, max 10)." },
    },
    required: ["query"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const locale = enumVal(args, "locale", ["th", "en"] as const, false) ?? "th";
    const ranked = searchAssistantKnowledge(reqString(args, "query"), {
      locale,
      currentPath: ec.currentPath,
      pageId: ec.pageId,
      permissions: ec.permissions,
      role: ec.role,
      isPlatformAdmin: ec.isPlatformAdmin,
      kind: "guide",
      limit: 20,
    });
    const rankedIds = ranked.map((result) => result.id);
    const resultById = new Map(ranked.map((result) => [result.id, result]));
    const rank = new Map(rankedIds.map((id, index) => [id, index]));
    const limit = optInt(args, "limit", 1, 10) ?? 5;
    const guides = SYSTEM_GUIDES
      .filter((entry) => rank.has(entry.id))
      .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99))
      .slice(0, limit)
      .map((entry, index) => {
        const match = resultById.get(entry.id);
        const missingPermissions = match?.missingPermissions ?? [];
        return {
          id: entry.id,
          title: entry.title[locale],
          summary: entry.summary[locale],
          route: entry.route,
          prerequisites: entry.prerequisites[locale],
          steps: entry.steps[locale],
          warnings: entry.warnings[locale],
          requiredPermissions: entry.requiredPermissions,
          anyOfPermissions: entry.anyOfPermissions ?? [],
          missingPermissions,
          accessible: match?.accessible === true,
          accessRequirement: entry.accessRequirement ?? "any_staff",
          accessNote: match?.accessNote ?? null,
          // Verified question/answer pairs owned by this guide. Quote them; do not paraphrase a
          // second version of an answer the shop already publishes in its manual.
          faqs: faqsForGuide(entry.id).map((faq) => ({
            question: faq.question[locale],
            answer: faq.answer[locale],
          })),
          // Verified limits and traps for this workflow. Only the two best-ranked guides carry
          // them: 97 rules across the catalog would crowd out the answer they exist to protect.
          limits: index < 2
            ? limitsForGuide(entry.id).map((group) => ({
                title: group.title[locale],
                items: group.items[locale],
              }))
            : [],
        };
      });
    return { ok: true, data: { guides } };
  },
};

const getMyAccessTool: BmsTool = {
  name: "get_my_access",
  description:
    "Return the current signed-in staff actor's server-derived role, effective permission codes, and POS-only scope. Use it to explain what this actor can do or why a menu/action is unavailable. It does not grant or change access.",
  surfaces: ["staff"],
  inputSchema: {
    type: "object",
    properties: { locale: { type: "string", enum: ["th", "en"], description: "Response language (default th)." } },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const locale = enumVal(args, "locale", ["th", "en"] as const, false) ?? "th";
    const permissions = [...(ec.permissions ?? [])].sort();
    const actorId = ec.ctx?.admin?.id ? String(ec.ctx.admin.id) : null;
    // name / username / pos_only are not session claims — read them, do not infer them from ctx.
    const profile = actorId ? await getAssistantSelfProfile(actorId) : null;
    return { ok: true, data: {
      id: actorId,
      displayName: profile?.displayName ?? null,
      username: profile?.username ?? null,
      role: ec.ctx?.admin?.role ?? null,
      posOnly: profile?.posOnly ?? null,
      permissions,
      permissionGroups: groupPermissionDescriptions(permissions, locale),
    } };
  },
};

const searchStaffUsersTool: BmsTool = {
  name: "search_staff_users",
  description:
    "Search staff accounts in the current tenant by name or username. Requires user.view. Returns bounded exact/similar matches without email, phone, PIN, tokens, sessions, or platform identities. If the word 'person' could mean staff or customer, clarify before calling.",
  surfaces: ["staff"],
  permission: "user.view",
  whenToUse: "The user explicitly asks whether a named staff/user account exists in this shop or wants to select a staff account for a later access lookup.",
  whenNotToUse: "Do not use for customers; use customer tools after clarifying. Do not infer that a similar match is the requested person.",
  commonMistakes: ["If several or only similar matches return, present choices and do not pick one."],
  example: { input: { query: "suprims", limit: 5 } },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Staff display name or username." },
      limit: { type: "integer", description: "Maximum matches (default 5, max 10)." },
    },
    required: ["query"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const users = await searchTenantStaffUsers(
      ec.tenantId,
      reqString(args, "query"),
      optInt(args, "limit", 1, 10) ?? 5
    );
    return { ok: true, data: { users, count: users.length } };
  },
};

const getStaffUserAccessTool: BmsTool = {
  name: "get_staff_user_access",
  description:
    "Read one selected current-tenant staff account's role and effective permissions. Requires user.view. Call only with an id returned by search_staff_users; never guess an id from a name.",
  surfaces: ["staff"],
  permission: "user.view",
  whenToUse: "After the user selected one unambiguous result from search_staff_users and asks what that account can do.",
  whenNotToUse: "Do not call before resolving duplicate or similar name matches, and do not use it to modify access.",
  commonMistakes: ["A role name alone is not the effective permission list; use this tool result."],
  example: { input: { userId: "selected-user-id" } },
  inputSchema: {
    type: "object",
    properties: {
      userId: { type: "string", description: "Exact id returned by search_staff_users." },
      locale: { type: "string", enum: ["th", "en"], description: "Response language (default th)." },
    },
    required: ["userId"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const user = await getTenantStaffUserAccess(ec.tenantId, reqString(args, "userId"));
    const locale = enumVal(args, "locale", ["th", "en"] as const, false) ?? "th";
    return user
      ? { ok: true, data: { user: { ...user, permissionGroups: groupPermissionDescriptions(user.permissions, locale) } } }
      : { ok: false, error: "ไม่พบบัญชีผู้ใช้ในร้านปัจจุบัน" };
  },
};

const getLoyaltyProgramStatusTool: BmsTool = {
  name: "get_loyalty_program_status",
  description:
    "Read whether this tenant has enabled its loyalty program and the verified earning/redemption settings. Product capability alone is not tenant enablement. Never use this tool as a customer's point balance.",
  surfaces: ["staff"],
  permission: "member.view",
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => {
    const settings = await getLoyaltySettings(ec.tenantId);
    return {
      ok: true,
      data: {
        supported: true,
        enabled: settings.enabled,
        earnMode: settings.earnMode,
        earnBase: settings.earnBase,
        earnPointsPerBaht: settings.earnPointsPerBaht,
        visitPoints: settings.visitPoints,
        earnMinSpend: settings.earnMinSpend,
        redeemPointsPerUnit: settings.redeemPointsPerUnit,
        redeemBahtPerUnit: settings.redeemBahtPerUnit,
        redeemMinPoints: settings.redeemMinPoints,
        maxDiscountPct: settings.maxDiscountPct,
        pointsExpireMonths: settings.pointsExpireMonths,
      },
    };
  },
};

const searchProducts: BmsTool = {
  name: "search_products",
  description:
    "Search the shop's current active catalog by name, SKU, barcode, alias, category or brand. Returns verified price, availability, sizes and a public product path. Call this before answering any product question.",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  whenToUse: "The customer named a specific product/model/SKU/brand and you need to confirm real price/stock before answering or before creating an order.",
  whenNotToUse: "Broad question like 'what do you sell?' → use browse_catalog instead; asking about new items → use list_new_arrivals; the named product/size is out of stock → use find_alternatives.",
  commonMistakes: [
    "Do not fold a size into keyword (e.g. 'shirt XL') — size is checked via check_stock/get_product, not filtered by this tool.",
    "Never guess a sku and skip straight to create_order — always call this tool first to confirm the real sku/price/stock.",
  ],
  example: { input: { keyword: "Nike Air shoes" }, note: "Customer asked for a specific named product/brand." },
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "Search term, e.g. model name or brand." },
      category: { type: "string", description: "Category, if the customer named one." },
      maxPrice: { type: "number", description: "Maximum customer budget, if stated." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const search = optString(args, "keyword");
    const category = optString(args, "category") ?? null;
    const maxPrice = optMoney(args, "maxPrice");
    const [{ items, total }, tenantSlug] = await Promise.all([
      listSellableProducts(ec.tenantId, {
        search,
        category,
        maxPrice,
        inStockOnly: ec.surface === "customer" && !search,
        sort: search || category ? "relevance" : "availability",
        limit: 10,
      }),
      getTenantSlug(ec.tenantId),
    ]);
    if (ec.surface === "customer" && search && total === 0) {
      await recordSynonymCandidate(ec.tenantId, search).catch((error) => {
        console.error("[BMS] synonym candidate capture failed:", error);
      });
    }
    return {
      ok: true,
      data: {
        verifiedAt: new Date().toISOString(),
        total,
        products: items.map((product) => safeCatalogProduct(product, tenantSlug)),
      },
    };
  },
};

const browseCatalogTool: BmsTool = {
  name: "browse_catalog",
  description:
    "Browse real in-stock products in this shop. Use for broad questions such as 'what do you sell?' and return 3-5 concrete choices before asking one narrowing question.",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  whenToUse: "Broad question with no specific product named, e.g. 'what do you sell?', 'do you have men's clothing?'.",
  whenNotToUse: "The customer already named a specific product/model/SKU → use search_products instead (more precise, avoids guessing the wrong sku).",
  example: { input: { keyword: "home decor", limit: 5 }, note: "Customer asked a broad question with no specific product named." },
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "Optional use-case, style, brand or product term." },
      category: { type: "string", description: "Optional exact shop category." },
      limit: { type: "integer", description: "Maximum products (default 5, max 8)." },
      minPrice: { type: "number", description: "Minimum price, if the customer stated one." },
      maxPrice: { type: "number", description: "Maximum budget, if the customer stated one." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const keyword = optString(args, "keyword");
    const category = optString(args, "category") ?? null;
    const limit = optInt(args, "limit", 1, 8) ?? 5;
    const minPrice = optMoney(args, "minPrice");
    const maxPrice = optMoney(args, "maxPrice");
    let { items, total } = await listSellableProducts(ec.tenantId, {
      search: keyword,
      category,
      minPrice,
      maxPrice,
      inStockOnly: true,
      sort: keyword ? "relevance" : "availability",
      limit,
    });
    if (items.length === 0 && keyword) {
      const fallback = await listSellableProducts(ec.tenantId, {
        category,
        minPrice,
        maxPrice,
        inStockOnly: true,
        sort: "availability",
        limit,
      });
      items = fallback.items;
      total = fallback.total;
    }
    const tenantSlug = await getTenantSlug(ec.tenantId);
    return {
      ok: true,
      data: {
        verifiedAt: new Date().toISOString(),
        total,
        products: items.map((product) => safeCatalogProduct(product, tenantSlug)),
      },
    };
  },
};

const listNewArrivalsTool: BmsTool = {
  name: "list_new_arrivals",
  description:
    "List the shop's newest active in-stock products by product creation time. Use whenever the customer asks what is new or just added; results refresh from the database on every call.",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  whenToUse: "The customer asks about new/just-arrived/latest items (e.g. 'anything new?', 'did the new model come in?').",
  whenNotToUse: "The customer asks for a specific product/category by name → use search_products/browse_catalog instead.",
  example: { input: { limit: 5 }, note: "Customer asked whether any new items have arrived." },
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", description: "Optional exact shop category." },
      limit: { type: "integer", description: "Maximum products (default 5, max 8)." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const category = optString(args, "category") ?? null;
    const limit = optInt(args, "limit", 1, 8) ?? 5;
    const [{ items, total }, tenantSlug] = await Promise.all([
      listSellableProducts(ec.tenantId, {
        category,
        inStockOnly: true,
        sort: "newest",
        limit,
      }),
      getTenantSlug(ec.tenantId),
    ]);
    return {
      ok: true,
      data: {
        verifiedAt: new Date().toISOString(),
        basis: "created_at",
        total,
        products: items.map((product) => safeCatalogProduct(product, tenantSlug)),
      },
    };
  },
};

const findAlternativesTool: BmsTool = {
  name: "find_alternatives",
  description:
    "Find 2-5 real in-stock alternatives when an exact product or requested size is unavailable. Prefer the same category/brand and a nearby price; never invent substitutes.",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  whenToUse: "After search_products/check_stock has confirmed the requested product/size is out of stock — offer alternatives instead of ending the conversation with 'not available'.",
  whenNotToUse: "Stock has not actually been checked yet — confirm it is really unavailable via check_stock/search_products first, then look for alternatives.",
  commonMistakes: ["Never suggest a substitute from chat memory alone — this tool must confirm real stock before offering it to the customer."],
  example: { input: { sku: "NIKE-AIR-001", size: "XL" }, note: "Size XL of NIKE-AIR-001 is out of stock; customer wants an alternative." },
  inputSchema: {
    type: "object",
    properties: {
      sku: { type: "string", description: "Unavailable product SKU, if known." },
      keyword: { type: "string", description: "Customer's requested product text, if SKU is unknown." },
      category: { type: "string", description: "Known desired category, if any." },
      size: { type: "string", description: "Requested size/variant, if any." },
      limit: { type: "integer", description: "Maximum alternatives (default 3, max 5)." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const sku = optString(args, "sku");
    const keyword = optString(args, "keyword");
    const category = optString(args, "category") ?? null;
    const size = optString(args, "size") ?? null;
    if (!sku && !keyword && !category) {
      throw new ToolArgError('ต้องระบุ "sku", "keyword" หรือ "category" อย่างน้อยหนึ่งค่า');
    }
    const limit = optInt(args, "limit", 1, 5) ?? 3;
    const [result, tenantSlug] = await Promise.all([
      findAlternativeProducts(ec.tenantId, { sku, keyword, category, size, limit }),
      getTenantSlug(ec.tenantId),
    ]);
    return {
      ok: true,
      data: {
        verifiedAt: new Date().toISOString(),
        source: result.source,
        alternatives: result.alternatives.map((product) =>
          safeCatalogProduct(product, tenantSlug)
        ),
      },
    };
  },
};

const getProduct: BmsTool = {
  name: "get_product",
  description:
    "Get one product by sku, including every size, remaining stock, and its customer-safe publicPath/publicUrl for sharing.",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  inputSchema: {
    type: "object",
    properties: { sku: { type: "string", description: "Product sku." } },
    required: ["sku"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const sku = reqString(args, "sku");
    const [{ items }, tenantSlug] = await Promise.all([
      listProducts(ec.tenantId, {
        search: sku,
        activeOnly: ec.surface === "customer",
        limit: 5,
      }),
      getTenantSlug(ec.tenantId),
    ]);
    const p = items.find((x) => x.sku.toLowerCase() === sku.toLowerCase());
    if (!p) return { ok: false, error: `ไม่พบสินค้า sku ${sku}` };
    const variants = await listVariants(ec.tenantId, p.sku);
    const variantPrices = variants.map((variant) => Number(variant.price));
    return {
      ok: true,
      data: {
        verifiedAt: new Date().toISOString(),
        sku: p.sku,
        name: p.name,
        price: variantPrices.length ? Math.min(...variantPrices) : Number(p.price),
        maxPrice: variantPrices.length ? Math.max(...variantPrices) : Number(p.price),
        description: p.description?.slice(0, 800) ?? null,
        category: p.category,
        brand: p.brand,
        active: p.active,
        createdAt: p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at),
        updatedAt: p.updated_at instanceof Date ? p.updated_at.toISOString() : String(p.updated_at),
        availableTotal: variants.reduce(
          (sum, variant) =>
            sum + Math.max(0, variant.current_stock - variant.reserved_stock),
          0
        ),
        publicPath: tenantSlug
          ? `/shop/${encodeURIComponent(tenantSlug)}/products/${encodeURIComponent(p.sku)}`
          : null,
        publicUrl: tenantSlug
          ? `${(process.env.NEXT_PUBLIC_BASE_URL || "https://bms.jachoei.com").replace(/\/$/, "")}/shop/${encodeURIComponent(tenantSlug)}/products/${encodeURIComponent(p.sku)}`
          : null,
        // ไม่ส่ง images[] — โมเดลมองรูปไม่ได้ (เป็นแค่ URL) และลิงก์ที่ลูกค้าควรได้คือหน้า public
        // /shop/{tenantSlug}/products/{sku} ไม่ใช่ URL ไฟล์ใน storage
        variants: variants.map((v) => ({
          size: v.size,
          available: Math.max(0, v.current_stock - v.reserved_stock),
          price: Number(v.price),
        })),
      },
    };
  },
};

const listAvailableCouponsTool: BmsTool = {
  name: "list_available_coupons",
  description:
    "List coupons that are available now after time window, quota and known minimum-spend checks. Customer surface, or staff with channel+customerRef: returns that resolved customer's genuine eligibility/wallet rules. Staff with no customer identity: returns shop-wide generally available coupons only and must not be described as eligibility for a particular customer.",
  surfaces: ["customer", "staff"],
  permission: "coupon.view",
  whenToUse: "Use without customer identity for 'what coupons does the shop have available now'; include channel+customerRef for one customer's eligibility.",
  whenNotToUse: "Do not claim a shop-wide result is usable by a named customer; resolve the customer first.",
  inputSchema: {
    type: "object",
    properties: {
      subtotal: {
        type: "number",
        description:
          "Current cart subtotal, if known, to keep only coupons whose minimum is met and preview the discount.",
      },
      limit: { type: "integer", description: "Maximum coupons to return (default 5, max 20)." },
      channel: { type: "string", description: "Customer channel (staff surface only)." },
      customerRef: { type: "string", description: "Customer reference (staff surface only)." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const channel = ec.surface === "customer" ? ec.channel : (enumVal(args, "channel", STAFF_CHANNELS, false) as Channel | undefined);
    const customerRef = ec.surface === "customer" ? ec.customerRef ?? null : optString(args, "customerRef") ?? null;
    const coupons = await listAvailableCouponsForCustomer(ec.tenantId, {
      channel,
      customerRef,
      subtotal: optMoney(args, "subtotal"),
      limit: optInt(args, "limit", 1, 20) ?? 5,
    });
    return { ok: true, data: { coupons: coupons.map(safeCoupon) } };
  },
};

const listCustomerCouponsTool: BmsTool = {
  name: "list_customer_coupons",
  description:
    "List this customer's own coupon wallet, showing which are usable and which are expired, not yet started or fully used, plus the discount still available. Use when the customer asks what coupons they have or which are expiring soon.",
  surfaces: ["customer", "staff"],
  permission: "coupon.view",
  inputSchema: {
    type: "object",
    properties: {
      subtotal: {
        type: "number",
        description:
          "Current cart subtotal, if known, to check minimums and preview the discount.",
      },
      channel: { type: "string", description: "Customer channel (staff surface only)." },
      customerRef: { type: "string", description: "Customer reference (staff surface only)." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const channel = ec.surface === "customer" ? ec.channel : (enumVal(args, "channel", STAFF_CHANNELS, false) as Channel | undefined);
    const customerRef = ec.surface === "customer" ? ec.customerRef ?? null : optString(args, "customerRef") ?? null;
    const coupons = await listCustomerCouponWallet(ec.tenantId, {
      channel,
      customerRef,
      subtotal: optMoney(args, "subtotal"),
    });
    return { ok: true, data: { coupons: coupons.map(safeCoupon) } };
  },
};

const checkCouponTool: BmsTool = {
  name: "check_coupon",
  description:
    "Check whether a coupon code the customer named is usable by this customer; if it is not, usable alternatives are returned. Never tell the customer a code works until this tool or create_order has approved it, and never treat this check as actually applying the coupon to an order.",
  surfaces: ["customer", "staff"],
  permission: "coupon.view",
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: "The coupon code the customer gave." },
      subtotal: {
        type: "number",
        description:
          "Current cart subtotal, if known, to check the minimum and preview the discount.",
      },
      channel: { type: "string", description: "Customer channel (staff surface only)." },
      customerRef: { type: "string", description: "Customer reference (staff surface only)." },
    },
    required: ["code"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const channel = ec.surface === "customer" ? ec.channel : (enumVal(args, "channel", STAFF_CHANNELS, false) as Channel | undefined);
    const customerRef = ec.surface === "customer" ? ec.customerRef ?? null : optString(args, "customerRef") ?? null;
    const lookup = await checkCouponForCustomer(ec.tenantId, reqString(args, "code"), {
      channel,
      customerRef,
      subtotal: optMoney(args, "subtotal"),
      alternativeLimit: 3,
    });
    return {
      ok: true,
      data: {
        requestedCode: lookup.requestedCode,
        requested: lookup.requested ? safeCoupon(lookup.requested) : null,
        alternatives: lookup.alternatives.map(safeCoupon),
      },
    };
  },
};

const checkStockTool: BmsTool = {
  name: "check_stock",
  description:
    "Check stock and price for a product by name and size. Use when the customer asks whether an item is in stock, how many are left, or what it costs. " +
    "An in-stock result may include `packs` — the selling units this product also comes in (a blister, a bottle, a box) with their code, unit name and pieces per unit. " +
    "Pass a pack's code as `packCode` to create_order when the customer counted in that unit. `available` is always in base pieces, never in packs.",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  inputSchema: {
    type: "object",
    properties: {
      product: { type: "string", description: "Product name or search term." },
      size: { type: "string", description: "Size, if the customer gave one." },
    },
    required: ["product"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const product = reqString(args, "product");
    const size = optString(args, "size") ?? null;
    const res = await checkStock(ec.tenantId, product, size);
    return { ok: true, data: { ...res, verifiedAt: new Date().toISOString() } };
  },
};

const getVariantReservationsTool: BmsTool = {
  name: "get_variant_reservations",
  description:
    "List the active orders that explain reserved stock for one SKU and optional size. " +
    "The result includes totals, bundle sources, branch context, unattributed holds, and over-attribution. " +
    "Use this for 'which order is holding this stock'; never claim the order list explains the full hold when unattributed or overAttributed is non-zero.",
  surfaces: ["staff"],
  permission: "order.view",
  whenToUse: "Staff asks who is holding reserved stock for a known SKU or size.",
  whenNotToUse: "The SKU is unknown -> search_products first. Do not use this as a general stock check.",
  inputSchema: {
    type: "object",
    properties: {
      sku: { type: "string", description: "Exact product SKU from a verified product result." },
      size: { type: "string", description: "Optional size; omit to inspect every size for the SKU." },
    },
    required: ["sku"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const sku = reqString(args, "sku");
    const size = optString(args, "size") ?? null;
    const reservations = await listVariantReservations(ec.tenantId, sku, size);
    return {
      ok: true,
      data: {
        ...reservations,
        // The page resolver may show phone/reference to an authorized human. The Assistant only
        // needs the order and a display name to answer who holds stock, so omit extra PII here.
        orders: reservations.orders.map(({ customerPhone: _phone, customerRef: _ref, ...order }) => order),
        verifiedAt: new Date().toISOString(),
      },
    };
  },
};

const subscribeRestockNotificationTool: BmsTool = {
  name: "subscribe_restock_notification",
  description:
    "Save this customer's explicit opt-in to be notified when one exact out-of-stock SKU and size is available again. " +
    "Call only after the customer clearly says yes or directly asks to be notified; never infer consent. " +
    "The sku must come from a product tool result and the size must be confirmed.",
  surfaces: ["customer"],
  inputSchema: {
    type: "object",
    properties: {
      sku: { type: "string", description: "Exact verified product SKU from a product tool result." },
      size: { type: "string", description: "Exact size or variant confirmed by the customer." },
      requestedQty: { type: "integer", minimum: 1, maximum: 999, description: "Quantity the customer wanted, default 1." },
    },
    required: ["sku", "size"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    if (!ec.channel || !ec.customerRef) {
      return { ok: false, error: "ไม่พบตัวตนลูกค้าจากช่องทางนี้" };
    }
    const result = await subscribeToRestock({
      tenantId: ec.tenantId,
      channel: ec.channel,
      customerRef: ec.customerRef,
      sku: reqString(args, "sku"),
      size: reqString(args, "size"),
      requestedQty: optInt(args, "requestedQty", 1, 999),
      actor: ec.actor,
    });
    return { ok: true, data: result };
  },
};

/**
 * แต้มสะสมของลูกค้า (7.96) — อ่านอย่างเดียว
 *
 * มีทูลนี้เพราะกฎของระบบคือ AI ห้ามเดาตัวเลขแต้ม/สิทธิ์ (docs/AI_GUIDELINES.md)
 * ก่อนหน้านี้ไม่มีทูลให้เรียก ลูกค้าถามว่า "มีแต้มเท่าไร" แล้วโมเดลตอบไม่ได้เลย
 * ตัวเลขที่ตอบได้ต้องมาจากผลลัพธ์ของทูลนี้เท่านั้น
 *
 * ทูลนี้ไม่แลกแต้ม — การแลกเกิดตอนสร้างบิลเท่านั้น (create_order / จอ POS)
 * เพื่อให้แต้มถูกหักในทรานแซกชันเดียวกับที่ออกบิล
 */
const getLoyaltyPointsTool: BmsTool = {
  name: "get_loyalty_points",
  description:
    "Get this customer's membership tier and loyalty point balance. Customer surface: call it with no arguments — the signed-in customer is used. " +
    "Never state a point balance, tier, or discount that did not come from this tool's result, and never promise points the customer has not earned yet. " +
    "This tool only reads: points are deducted when an order is created, so calling it never spends or reserves anything. " +
    "If the customer is not enrolled, say so and offer enrolment at the counter rather than quoting zero points.",
  surfaces: ["customer", "staff"],
  permission: "member.view",
  inputSchema: {
    type: "object",
    properties: {
      channel: { type: "string", description: "Customer channel (staff surface only)." },
      customerRef: { type: "string", description: "Customer reference (staff surface only)." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const channel = ec.surface === "customer" ? ec.channel : (enumVal(args, "channel", STAFF_CHANNELS, false) as Channel | undefined);
    const customerRef = ec.surface === "customer" ? ec.customerRef ?? null : optString(args, "customerRef") ?? null;
    const customerId = await findCustomerIdByIdentity(ec.tenantId, channel ?? null, customerRef);
    if (!customerId) return { ok: false, error: "ไม่พบตัวตนลูกค้าจากช่องทางนี้" };

    const member = await getMember(ec.tenantId, customerId);
    if (!member?.memberNo) {
      return { ok: true, data: { enrolled: false, tier: null, pointsUsable: 0, pointsBalance: 0 } };
    }
    const settings = await getLoyaltySettings(ec.tenantId);
    const redeemable = pointsToDiscount(settings, member.pointsUsable);
    return {
      ok: true,
      data: {
        enrolled: true,
        memberNo: member.memberNo,
        tier: member.tier ? { name: member.tier.name, discountType: member.tier.discountType, discountValue: member.tier.discountValue } : null,
        pointsUsable: member.pointsUsable,
        // ยอดรวมทั้ง ledger ติดลบได้เมื่อคืนของหลังใช้แต้ม — ส่งไปด้วยเพื่อให้
        // โมเดลอธิบายได้ว่าทำไมแลกไม่ได้ แทนที่จะบอกแค่ 0
        pointsBalance: member.pointsBalance,
        redeemableDiscount: redeemable.discount,
        redeemMinPoints: settings.redeemMinPoints,
        programEnabled: settings.enabled,
      },
    };
  },
};

const getOrderStatus: BmsTool = {
  name: "get_order_status",
  description:
    "Get order status. Customer surface: call it straight away with no orderId — the latest order for this customer is returned automatically. " +
    "Never ask the customer for an order number before calling this; call first, then read the result to see whether an order exists. Staff surface: pass orderId for the full journey.",
  surfaces: ["customer", "staff"],
  permission: "order.view",
  whenToUse: "The customer asks about order status or purchase history. On the customer surface, call immediately with no orderId so the backend resolves canonical customer history safely.",
  whenNotToUse: "The customer says they have paid or transferred already -> use submit_payment after verifying the configured payment method; do not use order history to choose a payable order yourself.",
  commonMistakes: [
    "Never ask a customer for orderId before the first call and never pass an orderId on the customer surface; canonical ownership is resolved from the server-established identity.",
  ],
  example: { input: {}, note: "Customer asked for the status of their latest order." },
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string", description: "Order id (staff surface only)." } },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    if (ec.surface === "customer") {
      if (!ec.customerRef || !ec.channel) return { ok: true, data: { orders: [] } };
      const orders = await listCustomerOrderStatuses(ec.tenantId, ec.channel, ec.customerRef, 10);
      return { ok: true, data: { orders } };
    }
    // staff
    const orderId = reqString(args, "orderId");
    const journey = await getOrderJourney(ec.tenantId, orderId);
    if (!journey) return { ok: false, error: `ไม่พบออร์เดอร์ ${orderId}` };
    return { ok: true, data: journey };
  },
};

const getCustomerCheckoutTool: BmsTool = {
  name: "get_customer_checkout",
  description:
    "Check whether this channel customer already has a recipient name, phone and shipping address. " +
    "Call before asking for delivery details. If missingFields is empty, reuse the existing details and do not ask the customer to type them again. " +
    "Lazada/Shopee return marketplaceManaged=true because Seller Center owns delivery and payment details.",
  surfaces: ["customer"],
  whenToUse: "After create_order/reorder, or before asking for recipient name, phone or address, check which delivery fields are already complete.",
  whenNotToUse: "Do not use this to retrieve raw customer PII; it intentionally returns completeness only. Lazada/Shopee delivery remains in Seller Center.",
  commonMistakes: [
    "If missingFields is empty, reuse the saved details and do not ask the customer to type or reconfirm them.",
  ],
  example: { input: {}, note: "Check delivery completeness before asking the customer for any PII." },
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => {
    if (!ec.channel || !ec.customerRef) {
      return { ok: false, error: "ไม่พบตัวตนลูกค้าจากช่องทางนี้" };
    }
    return {
      ok: true,
      data: await getCustomerCheckoutStatus(ec.tenantId, ec.channel, ec.customerRef),
    };
  },
};

const listLowStockTool: BmsTool = {
  name: "list_low_stock",
  description: "List products whose stock is below their reorder point — for staff planning what to restock.",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => {
    const rows = await listLowStock(ec.tenantId);
    return { ok: true, data: { items: rows } };
  },
};

const getInventorySummaryTool: BmsTool = {
  name: "get_inventory_summary",
  description:
    "Inventory overview: number of skus and sizes, total, reserved and available units, stock value, and how many items are low or out of stock.",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => ({ ok: true, data: await getInventorySummary(ec.tenantId) }),
};

const getSalesSummaryTool: BmsTool = {
  name: "get_sales_summary",
  description:
    "Sales summary for a date range (default: the last 30 days). Revenue counts only orders that reached PAID or later. " +
    "If 'all' could mean all time versus all rows, ask the user to clarify before calling; never silently choose the 30-day default.",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD" },
      to: { type: "string", description: "YYYY-MM-DD" },
      scope: {
        type: "string",
        enum: ["all_time"],
        description: "Use all_time only when the user explicitly confirms the period is since the shop began; omit from/to.",
      },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const from = optString(args, "from") ?? null;
    const to = optString(args, "to") ?? null;
    const scope = optString(args, "scope") ?? null;
    if (scope && scope !== "all_time") return { ok: false, error: "scope ไม่ถูกต้อง" };
    if (scope === "all_time") {
      if (from || to) return { ok: false, error: "scope=all_time ห้ามส่ง from/to พร้อมกัน" };
      return { ok: true, data: await getLifetimeSalesSummary(ec.tenantId) };
    }
    return { ok: true, data: await getSalesSummary(ec.tenantId, from, to) };
  },
};

const getTopProductsTool: BmsTool = {
  name: "get_top_products",
  description:
    "Best-selling products for a date range (by revenue and units sold). This is a bounded ranking, not an unlimited sales ledger. " +
    "If 'all' could mean all time versus every product/order, ask the user to clarify before calling.",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "integer", description: "How many ranked products to return (default 10)." },
      scope: {
        type: "string",
        enum: ["all_time"],
        description: "Use all_time only when the user explicitly confirms the period is since the shop began; omit from/to.",
      },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const from = optString(args, "from") ?? null;
    const to = optString(args, "to") ?? null;
    const limit = optInt(args, "limit", 1, 50) ?? 10;
    const scope = optString(args, "scope") ?? null;
    if (scope && scope !== "all_time") return { ok: false, error: "scope ไม่ถูกต้อง" };
    if (scope === "all_time") {
      if (from || to) return { ok: false, error: "scope=all_time ห้ามส่ง from/to พร้อมกัน" };
      return { ok: true, data: await getLifetimeTopSellingProducts(ec.tenantId, limit) };
    }
    return { ok: true, data: await getTopSellingProducts(ec.tenantId, from, to, limit) };
  },
};

const getDashboardTool: BmsTool = {
  name: "get_dashboard",
  description:
    "Live-read store overview: total and today's revenue, order count, products running low, orders broken down by status, and top products and customers. " +
    "Returns fetchedAt, which is the time this tool read the data; it is not the last-change timestamp of every underlying record.",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => ({
    ok: true,
    data: { ...(await getDashboard(ec.tenantId)), fetchedAt: new Date().toISOString(), source: "live_query" },
  }),
};

const generateReportTool: BmsTool = {
  name: "generate_report",
  description:
    "Generate a downloadable report file (Excel/CSV/PDF) for Sales, Inventory, or Profit and return a download link. " +
    "Produces a real file the user can open/download — use this instead of get_sales_summary/get_inventory_summary " +
    "when the user explicitly asks to export/download/generate a document (e.g. 'export sales to Excel', " +
    "'generate a PDF profit report'), not when they're just asking a question you can answer in chat.",
  whenToUse:
    "The user's message asks for a file/export/document (mentions Excel/CSV/PDF, 'export', 'download', 'generate a report').",
  whenNotToUse:
    "The user is just asking a question about numbers ('how much did we sell this month?') — answer that with get_sales_summary/get_inventory_summary/get_top_products instead; those return inline data for you to describe, not a file.",
  example: {
    input: { reportType: "SALES", dateFrom: "2026-01-01", dateTo: "2026-03-31", format: "XLSX" },
    note: "User said 'Export sales from January to March 2026 to Excel.'",
  },
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: {
    type: "object",
    properties: {
      reportType: { type: "string", enum: [...REPORT_TYPES], description: "Which report to generate." },
      dateFrom: { type: "string", description: "YYYY-MM-DD, if the user gave a date range. Not used for INVENTORY." },
      dateTo: { type: "string", description: "YYYY-MM-DD, if the user gave a date range. Not used for INVENTORY." },
      format: { type: "string", enum: [...REPORT_FORMATS], description: "Output file format." },
      includeSummary: { type: "boolean", description: "Include a short AI executive summary (default true)." },
    },
    required: ["reportType", "format"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const result = await generateReport(ec.tenantId, ec.ctx, {
      reportType: enumVal(args, "reportType", REPORT_TYPES) as string,
      dateFrom: optString(args, "dateFrom") ?? null,
      dateTo: optString(args, "dateTo") ?? null,
      format: enumVal(args, "format", REPORT_FORMATS) as string,
      includeSummary: args.includeSummary !== false,
    });
    return { ok: true, data: result };
  },
};

// generate_report เดิม (A1) คืนแค่ลิงก์ดาวน์โหลด — ทูลนี้ต่อยอดให้ "ส่งไฟล์นั้นออกเป็นอีเมล" ด้วย
// แต่ปลายทางเป็น free text ที่ผู้ใช้พิมพ์เอง ไม่ผ่านการยืนยันตัวตนใดๆ (ต่างจาก send_customer_message
// ที่ปลายทางคือ conversationId ที่ระบบรู้จักอยู่แล้ว) จึงต้องเป็น A3 เสมอ — ทูลนี้จึง "ทำงานจริง" แค่
// ครึ่งแรก (generate ไฟล์ผ่าน generateReport() เดิม, ไม่ sensitive) แล้วเสนอครึ่งหลัง (ส่งอีเมล) เป็น
// proposal ให้กด Confirm ยิง bmsEmailReport — ไม่ใช้ proposalTool() helper เพราะต้องมี side effect
// จริง (สร้างไฟล์) ก่อนจะประกอบ proposal ต่างจาก A3_TOOLS ที่ทั้งก้อนเป็นแค่ transform args ล้วนๆ
const emailReportTool: BmsTool = {
  name: "email_report",
  description:
    "Generate a report file (same as generate_report) AND propose emailing it to an address. " +
    "The email is never sent automatically — a human must review the recipient address and press Confirm first, " +
    "because the recipient comes from free text and is never verified. Use this instead of generate_report only " +
    "when the user explicitly asks to email/send the report to an address.",
  whenToUse:
    "The user asks for a report AND explicitly gives an email address to send it to (e.g. 'export sales to Excel and email it to x@y.com').",
  whenNotToUse:
    "The user only asks for a report/export with no email address — use generate_report instead (it just returns a download link, no external send).",
  example: {
    input: { reportType: "SALES", format: "XLSX", to: "owner@example.com" },
    note: "User said 'ขอรายงานยอดขายเดือนนี้เป็นไฟล์ Excel แล้วส่ง email owner@example.com'",
  },
  surfaces: ["staff"],
  permission: "report.email",
  sensitive: true,
  inputSchema: {
    type: "object",
    properties: {
      reportType: { type: "string", enum: [...REPORT_TYPES], description: "Which report to generate." },
      dateFrom: { type: "string", description: "YYYY-MM-DD, if the user gave a date range. Not used for INVENTORY." },
      dateTo: { type: "string", description: "YYYY-MM-DD, if the user gave a date range. Not used for INVENTORY." },
      format: { type: "string", enum: [...REPORT_FORMATS], description: "Output file format." },
      includeSummary: { type: "boolean", description: "Include a short AI executive summary (default true)." },
      to: { type: "string", description: "Destination email address, exactly as given by the user." },
      subject: { type: "string", description: "Optional custom email subject." },
    },
    required: ["reportType", "format", "to"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const to = reqString(args, "to");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new ToolArgError(`"to" ต้องเป็นอีเมลที่ถูกต้อง ได้รับ: ${to}`);
    }
    const reportType = enumVal(args, "reportType", REPORT_TYPES) as string;
    const format = enumVal(args, "format", REPORT_FORMATS) as string;

    // generate ไฟล์จริงตอนนี้เลย (ไม่ sensitive — เหมือน generate_report เดิมทุกประการ, แค่ยังดาวน์โหลด
    // เองได้ปกติแม้จะยกเลิกคำขอส่งอีเมลทีหลัง) มีแค่ "ส่งออกไปที่ไหน" เท่านั้นที่รอการยืนยัน
    const generated = await generateReport(ec.tenantId, ec.ctx, {
      reportType,
      dateFrom: optString(args, "dateFrom") ?? null,
      dateTo: optString(args, "dateTo") ?? null,
      format,
      includeSummary: args.includeSummary !== false,
    });

    const known = await isKnownReportRecipient(ec.tenantId, to);
    const subject = optString(args, "subject") ?? null;

    return {
      ok: true,
      data: generated,
      proposal: {
        tool: "email_report",
        mutation: "bmsEmailReport",
        args: {
          fileId: generated.fileId,
          to,
          subject,
          reportType: generated.reportType,
          format: generated.format,
          isKnownRecipient: known,
        },
        summary: `ส่งรายงาน${generated.reportType === "SALES" ? "ยอดขาย" : generated.reportType === "INVENTORY" ? "สต็อกสินค้า" : "กำไร"} (${generated.format}) ไปที่ ${to}`,
      },
    };
  },
};

const POS_SHIFT_SIGNALS = [
  "ALL",
  "VARIANCE",
  "STALE_OPEN",
  "PENDING_REFUND",
  "OPEN_EXPENSE",
  "RETURN",
  "VOID",
  "NO_SALE",
] as const;

function requireValidDate(value: string | undefined, key: string): string | null {
  if (!value) return null;
  if (!isPosShiftOverviewDate(value)) throw new ToolArgError(`"${key}" ต้องเป็น YYYY-MM-DD`);
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function optUuid(args: Record<string, any>, key: string): string | undefined {
  const value = optString(args, key);
  if (!value) return undefined;
  if (!UUID_RE.test(value)) throw new ToolArgError(`"${key}" ต้องเป็น UUID ที่ถูกต้อง`);
  return value;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function summarizeShiftSignals(row: PosShiftOverviewRow) {
  return {
    hasCashVariance: row.cashVariance != null && Math.abs(row.cashVariance) >= 0.01,
    hasPendingRefunds: row.pendingRefundCount > 0,
    hasOpenExpenses: row.openExpenseCount > 0,
    hasReturns: row.returnCount > 0,
    hasVoids: row.voidCount > 0,
    hasNoSales: row.noSaleCount > 0,
    isStaleOpen: row.isStaleOpen,
  };
}

function compactShiftRow(row: PosShiftOverviewRow) {
  return {
    shiftId: row.id,
    shortShiftId: shortId(row.id),
    status: row.status,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    locationName: row.locationName,
    deviceCode: row.deviceCode,
    deviceName: row.deviceName,
    openedByName: row.openedByName,
    closedByName: row.closedByName,
    cashierNames: row.cashierNames,
    billCount: row.billCount,
    salesTotal: row.salesTotal,
    discountTotal: row.discountTotal,
    voidCount: row.voidCount,
    voidTotal: row.voidTotal,
    returnCount: row.returnCount,
    returnTotal: row.returnTotal,
    cashIn: row.cashIn,
    cashOut: row.cashOut,
    cashRefunds: row.cashRefunds,
    expectedCash: row.expectedCash,
    expectedCashHidden: row.expectedCashHidden,
    countedCash: row.countedCash,
    cashVariance: row.cashVariance,
    pendingRefundCount: row.pendingRefundCount,
    pendingRefundAmount: row.pendingRefundAmount,
    openExpenseCount: row.openExpenseCount,
    openExpenseAmount: row.openExpenseAmount,
    noSaleCount: row.noSaleCount,
    signals: summarizeShiftSignals(row),
  };
}

const analyzePosShiftTool: BmsTool = {
  name: "analyze_pos_shift",
  description:
    "Analyze a POS shift from verified backend data for cash variance, returns, voids, drawer cash movements, pending refunds, expenses, no-sale events, and payment-method totals. Use when staff ask what is wrong in a shift, whether the drawer cash is correct, or which POS shift/order/bill evidence to inspect. If the user gives counted cash, pass countedCash to compare without saving it.",
  surfaces: ["staff"],
  permission: "pos.shift.report.all",
  whenToUse:
    "Staff asks about a POS shift, X/Z report, drawer cash, cash shortage/overage, refunds, voids, no-sales, or asks 'กะนี้ผิดตรงไหน'.",
  whenNotToUse:
    "Do not use for general sales summaries that do not mention POS shifts/drawers; use get_sales_summary. Do not close a shift, approve a refund, or change cash records.",
  commonMistakes: [
    "Do not infer a shift when multiple candidates match; show the candidates and ask which shift to inspect.",
    "Do not reveal expectedCash when expectedCashHidden is true.",
    "Do not treat personal-funded or petty-cash expenses as drawer cash out.",
  ],
  example: {
    input: { openedFrom: "2026-08-29", openedTo: "2026-08-29", deviceCode: "001", latest: true },
    note: "Inspect the latest matching POS shift using backend facts.",
  },
  inputSchema: {
    type: "object",
    properties: {
      shiftId: { type: "string", description: "Exact POS shift UUID when known." },
      orderId: { type: "string", description: "Exact POS order UUID when the user asks about one order/bill." },
      receiptNo: { type: "string", description: "Receipt/tax document number shown on the POS receipt." },
      openedFrom: { type: "string", description: "YYYY-MM-DD in Asia/Bangkok, inclusive." },
      openedTo: { type: "string", description: "YYYY-MM-DD in Asia/Bangkok, inclusive." },
      deviceCode: { type: "string", description: "POS device code shown on screen, e.g. 001." },
      status: { type: "string", enum: ["OPEN", "CLOSED", "ALL"], description: "Shift status filter." },
      signal: {
        type: "string",
        enum: POS_SHIFT_SIGNALS,
        description: "Optional exception filter for finding candidate shifts.",
      },
      latest: { type: "boolean", description: "Use the newest matching shift when the user said latest/current/open shift." },
      countedCash: { type: "number", description: "Cash physically counted by the user; compare only, do not save." },
      detailLimit: { type: "integer", description: "Maximum ledger rows per evidence group (default 12, max 25)." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const shiftId = optUuid(args, "shiftId");
    const orderId = optUuid(args, "orderId");
    const receiptNo = optString(args, "receiptNo");
    const openedFrom = requireValidDate(optString(args, "openedFrom"), "openedFrom");
    const openedTo = requireValidDate(optString(args, "openedTo"), "openedTo");
    if (openedFrom && openedTo && openedFrom > openedTo) {
      return { ok: false, error: "openedFrom ต้องไม่มากกว่า openedTo" };
    }
    const deviceCode = optString(args, "deviceCode");
    const status = enumVal(args, "status", ["OPEN", "CLOSED", "ALL"] as const, false) ?? "ALL";
    const signal = enumVal(args, "signal", POS_SHIFT_SIGNALS, false) ?? "ALL";
    const latest = args.latest === true;
    const countedCash = optMoney(args, "countedCash");
    const detailLimit = optInt(args, "detailLimit", 1, 25) ?? 12;

    let selectedShiftId = shiftId ?? null;
    let candidateNote: unknown = null;

    if (!selectedShiftId && (orderId || receiptNo)) {
      const ref = await findPosShiftOrderReference(ec.tenantId, { orderId, receiptNo });
      if (!ref) {
        return {
          ok: true,
          data: {
            needsSelection: true,
            reason: "ไม่พบบิล POS ตาม orderId หรือเลขใบเสร็จที่ระบุ",
            filters: { orderId, receiptNo },
          },
        };
      }
      if (!ref.shiftId) {
        return {
          ok: true,
          data: {
            needsSelection: true,
            reason: "พบบิล POS แต่ไม่มีข้อมูลกะที่ผูกกับบิลนี้",
            orderReference: ref,
          },
        };
      }
      selectedShiftId = ref.shiftId;
      candidateNote = {
        resolvedFrom: { orderId, receiptNo },
        orderReference: ref,
      };
    }

    if (!selectedShiftId) {
      const firstPass = await listPosShiftOverview(ec.tenantId, {
        openedFrom,
        openedTo,
        status,
        signal,
        limit: 25,
        offset: 0,
      });
      const exactDevice = deviceCode
        ? firstPass.filters.devices.find((device) => device.code.toLowerCase() === deviceCode.toLowerCase())
        : null;
      if (deviceCode && !exactDevice) {
        return {
          ok: true,
          data: {
            needsSelection: true,
            reason: "ไม่พบเครื่อง POS ตาม deviceCode ที่ระบุ",
            filters: { openedFrom, openedTo, deviceCode, status, signal },
            availableDevices: firstPass.filters.devices.map((device) => ({
              deviceId: device.id,
              code: device.code,
              name: device.name,
            })),
          },
        };
      }
      const overview = await listPosShiftOverview(ec.tenantId, {
        openedFrom,
        openedTo,
        deviceId: exactDevice?.id ?? null,
        status,
        signal,
        limit: latest ? 1 : 6,
        offset: 0,
      });
      if (overview.rows.length === 0) {
        return {
          ok: true,
          data: {
            needsSelection: true,
            reason: "ไม่พบกะ POS ตามเงื่อนไขที่ระบุ",
            filters: { openedFrom, openedTo, deviceCode, status, signal },
            summary: overview.summary,
          },
        };
      }
      if (!latest && overview.rows.length !== 1) {
        return {
          ok: true,
          data: {
            needsSelection: true,
            reason: "พบหลายกะ ต้องให้ผู้ใช้เลือก shiftId หรือบอกว่าเอากะล่าสุด",
            filters: { openedFrom, openedTo, deviceCode, status, signal },
            candidates: overview.rows.map(compactShiftRow),
            totalMatches: overview.total,
            summary: overview.summary,
          },
        };
      }
      selectedShiftId = overview.rows[0].id;
      candidateNote = {
        resolvedFrom: { openedFrom, openedTo, deviceCode, status, signal, latest },
        totalMatches: overview.total,
      };
    }

    const data = await getPosShiftExportData(ec.tenantId, selectedShiftId, null);
    if (!data) return { ok: false, error: `ไม่พบกะ POS ${selectedShiftId}` };
    const report = data.report;
    if (report.expectedCashHidden) {
      return {
        ok: true,
        data: {
          source: "backend_pos_shift_report",
          generatedAt: new Date().toISOString(),
          candidateNote,
          report: {
            shiftId: report.shiftId,
            shortShiftId: shortId(report.shiftId),
            deviceCode: report.deviceCode,
            locationName: report.locationName,
            status: report.status,
            openedAt: report.openedAt,
            openedByName: report.openedByName,
            closedAt: report.closedAt,
            closedByName: report.closedByName,
            expectedCash: null,
            expectedCashHidden: true,
            countedCash: report.countedCash,
            cashVariance: report.cashVariance,
          },
          signals: {
            expectedCashHidden: true,
          },
          note:
            "กะนี้ยังเปิดอยู่และร้านใช้ blind close จึงไม่เปิดเผย expected cash หรือรายการประกอบยอดที่ทำให้คำนวณ expected cash ย้อนกลับได้ ต้องปิด/นับกะก่อนจึงวิเคราะห์ยอดเงินสดละเอียดได้",
        },
      };
    }
    const calculatedExpectedCash = report.expectedCashHidden
      ? null
      : Math.round((report.openingFloat + (report.byMethod.find((m) => m.method === "CASH")?.amount ?? 0)
        - report.cashRefunds + report.cashIn - report.cashOut) * 100) / 100;
    const countedCashComparison = countedCash == null || report.expectedCashHidden
      ? null
      : {
          countedCash,
          expectedCash: report.expectedCash,
          difference: report.expectedCash == null
            ? null
            : Math.round((countedCash - report.expectedCash) * 100) / 100,
        };

    const topRefunds = data.refunds
      .slice(0, detailLimit)
      .map((refund) => ({
        returnId: refund.returnId,
        shortReturnId: shortId(refund.returnId),
        orderId: refund.orderId,
        shortOrderId: shortId(refund.orderId),
        receiptNo: refund.receiptNo,
        returnedAt: refund.returnedAt,
        kind: refund.kind,
        returnMode: refund.returnMode,
        returnAmount: refund.returnAmount,
        settlementStatus: refund.settlementStatus,
        method: refund.method,
        allocationAmount: refund.allocationAmount,
        allocationStatus: refund.allocationStatus,
        completedAt: refund.completedAt,
        returnedBy: refund.returnedBy,
        approvedBy: refund.approvedBy,
      }));

    return {
      ok: true,
      data: {
        source: "backend_pos_shift_export",
        generatedAt: new Date().toISOString(),
        candidateNote,
        report: {
          ...report,
          shortShiftId: shortId(report.shiftId),
          calculatedExpectedCash,
          countedCashComparison,
        },
        formulas: {
          expectedCash: report.expectedCashHidden
            ? "hidden by blind-close while shift is open"
            : "openingFloat + CASH payments - completed cash refunds + drawer cash IN - drawer cash OUT",
          countedCashDifference: "countedCash - expectedCash",
          drawerCashExclusions: "personal-funded expenses and branch petty-cash expenses do not change drawer expected cash",
        },
        signals: {
          hasCashVariance: report.cashVariance != null && Math.abs(report.cashVariance) >= 0.01,
          hasPendingRefunds: data.refunds.some((refund) => refund.allocationStatus === "PENDING"),
          hasOpenExpenses: report.openExpenseCount > 0,
          hasReturns: report.returnCount > 0,
          hasVoids: report.voidCount > 0,
          hasNoSales: report.noSaleCount > 0,
        },
        evidence: {
          paymentsByMethod: report.byMethod,
          cashiers: report.byCashier,
          cashMovements: data.cashMovements.slice(0, detailLimit),
          refunds: topRefunds,
          expenses: data.expenses.slice(0, detailLimit),
          noSales: data.noSales.slice(0, detailLimit),
          creditActivity: data.creditActivity.slice(0, detailLimit),
          bills: data.bills.slice(0, detailLimit).map((bill) => ({
            orderId: bill.orderId,
            shortOrderId: shortId(bill.orderId),
            receiptNo: bill.receiptNo,
            soldAt: bill.soldAt,
            cashier: bill.cashier,
            status: bill.status,
            itemCount: bill.itemCount,
            netTotal: bill.netTotal,
            discountTotal: bill.discountTotal,
            voidedAt: bill.voidedAt,
          })),
          truncated: {
            bills: Math.max(0, data.bills.length - detailLimit),
            cashMovements: Math.max(0, data.cashMovements.length - detailLimit),
            refunds: Math.max(0, data.refunds.length - detailLimit),
            expenses: Math.max(0, data.expenses.length - detailLimit),
            noSales: Math.max(0, data.noSales.length - detailLimit),
            creditActivity: Math.max(0, data.creditActivity.length - detailLimit),
          },
        },
      },
    };
  },
};

const getCustomerTool: BmsTool = {
  name: "get_customer",
  description: "Get one customer by customerId (lifetime spend, order count, tags and notes).",
  surfaces: ["staff"],
  permission: "customer.view",
  inputSchema: {
    type: "object",
    properties: { customerId: { type: "string" } },
    required: ["customerId"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const id = reqString(args, "customerId");
    const c = await getCustomer(ec.tenantId, id);
    if (!c) return { ok: false, error: "ไม่พบลูกค้า" };
    return { ok: true, data: c };
  },
};

const listCustomersTool: BmsTool = {
  name: "list_customers",
  description: "Search customers by name or phone number.",
  surfaces: ["staff"],
  permission: "customer.view",
  inputSchema: { type: "object", properties: { keyword: { type: "string" } } },
  execute: async (args, ec): Promise<ToolResult> => {
    const search = optString(args, "keyword") ?? "";
    const rows = await listCustomers(ec.tenantId, search, 20, 0);
    return { ok: true, data: { customers: rows } };
  },
};

const customerOrdersTool: BmsTool = {
  name: "customer_orders",
  description: "List every order belonging to one customer, by customerId.",
  surfaces: ["staff"],
  permission: "customer.view",
  inputSchema: {
    type: "object",
    properties: { customerId: { type: "string" } },
    required: ["customerId"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const id = reqString(args, "customerId");
    return { ok: true, data: { orders: await customerOrders(ec.tenantId, id) } };
  },
};

const listShipmentsTool: BmsTool = {
  name: "list_shipments",
  description: "Search or list shipments (can be filtered by orderId or status).",
  surfaces: ["staff"],
  permission: "shipping.view",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string" },
      orderId: { type: "string" },
      status: { type: "string", enum: SHIPMENT_STATUSES as unknown as string[] },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const rows = await listShipments(ec.tenantId, {
      search: optString(args, "keyword"),
      orderId: optString(args, "orderId"),
      status: enumVal(args, "status", SHIPMENT_STATUSES, false),
      limit: 20,
    });
    return { ok: true, data: { shipments: rows } };
  },
};

const getShipmentLabelTool: BmsTool = {
  name: "get_shipment_label",
  description: "Data for printing a parcel label (recipient, address, items) by shipmentId.",
  surfaces: ["staff"],
  permission: "shipping.view",
  inputSchema: {
    type: "object",
    properties: { shipmentId: { type: "string" } },
    required: ["shipmentId"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const label = await getShipmentLabel(ec.tenantId, reqString(args, "shipmentId"));
    if (!label) return { ok: false, error: "ไม่พบการจัดส่ง" };
    return { ok: true, data: label };
  },
};

const listPaymentsTool: BmsTool = {
  name: "list_payments",
  description: "Search or list payments (can be filtered by orderId or status).",
  surfaces: ["staff"],
  permission: "payment.view",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string" },
      orderId: { type: "string" },
      status: { type: "string" },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const rows = await listPayments(ec.tenantId, {
      search: optString(args, "keyword"),
      orderId: optString(args, "orderId"),
      status: optString(args, "status"),
      limit: 20,
    });
    return { ok: true, data: { payments: rows } };
  },
};

const listPurchaseOrdersTool: BmsTool = {
  name: "list_purchase_orders",
  description: "Search or list the shop's purchase orders (POs).",
  surfaces: ["staff"],
  permission: "purchase.view",
  inputSchema: { type: "object", properties: { keyword: { type: "string" } } },
  execute: async (args, ec): Promise<ToolResult> => {
    const rows = await listPurchaseOrders(ec.tenantId, optString(args, "keyword") ?? "", 20, 0);
    return { ok: true, data: { purchaseOrders: rows } };
  },
};

const getPurchaseOrderTool: BmsTool = {
  name: "get_purchase_order",
  description: "Get the full detail of one purchase order by poId.",
  surfaces: ["staff"],
  permission: "purchase.view",
  inputSchema: {
    type: "object",
    properties: { poId: { type: "string" } },
    required: ["poId"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const po = await getPurchaseOrder(ec.tenantId, reqString(args, "poId"));
    if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อ" };
    return { ok: true, data: po };
  },
};

const listSuppliersTool: BmsTool = {
  name: "list_suppliers",
  description: "List suppliers together with their purchase history.",
  surfaces: ["staff"],
  permission: "purchase.view",
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => ({ ok: true, data: { suppliers: await listSuppliers(ec.tenantId) } }),
};

// =============================================================
// A2 — write, non-sensitive (execute + audit)
// =============================================================

const createOrderTool: BmsTool = {
  name: "create_order",
  description:
    "Create an order and reserve stock atomically from a list of sku, size and quantity. The sku must come from search_products or check_stock first. On the customer surface the first call for a basket NEVER writes: it returns status CONFIRMATION_REQUIRED with the itemised basket, the system shows that list to the customer, and only a call made after the customer has affirmed that exact basket creates the order.",
  surfaces: ["customer", "staff"],
  permission: "order.create",
  whenToUse: "Once product + size + qty are known for every line. On the customer surface, call it to obtain the confirmation summary, then call it again unchanged after the customer says yes.",
  whenNotToUse: "The exact sku isn't known → call search_products/check_stock first.",
  commonMistakes: [
    "Never guess a sku — it must come from a prior search_products/check_stock result only.",
    "status CONFIRMATION_REQUIRED means NOTHING was created and no stock was reserved. Never tell the customer the order is placed, and do not call this tool again until they have answered.",
    "After the customer confirms, send the SAME lines back. Changing any quantity, size or packCode invalidates their confirmation and the system will ask them again.",
    "For pharmacy shops, backend Product Policy may block, require a safety check, pharmacist review, or prescription. Explain that result and never retry to bypass it.",
    "Do not call this repeatedly if the customer hasn't changed their order — the tool loop already suppresses duplicate calls, but avoid calling it needlessly regardless.",
    "preferredCarrier must be a code listed in get_store_info's enabledCarriers only — never guess one.",
  ],
  example: {
    input: { items: [{ sku: "NIKE-AIR-001", size: "XL", qty: 1 }] },
    note: "Customer confirmed buying 1 Nike Air, size XL.",
  },
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "Line items.",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            sku: { type: "string" },
            size: { type: "string" },
            qty: { type: "integer" },
            packCode: {
              type: "string",
              description:
                'Selling-unit code when the customer counted in packs instead of pieces — "2 แผง" is qty 2 with the blister pack code. Omit for base units. Only use a code that appeared in a tool result; never invent one, and never send a price or a pieces-per-pack number: the shop\'s own pack data decides both.',
            },
          },
          required: ["sku", "size", "qty"],
        },
      },
      channel: { type: "string", description: "Channel (staff surface only, default web)." },
      customerRef: { type: "string", description: "Customer reference (staff surface only)." },
      couponCode: { type: "string", description: "Discount code, if the customer gave one." },
      preferredCarrier: {
        type: "string",
        description:
          "Carrier the customer asked for. Only pass a code listed in get_store_info's enabledCarriers, and only if the customer named one — never guess. This is a preference the shop confirms at packing time, not a guarantee, and it does not change the shipping fee.",
      },
    },
    required: ["items"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const requested = reqItems(args);
    if (requested.length > 20) {
      throw new ToolArgError("หนึ่งออร์เดอร์รับได้ไม่เกิน 20 รายการ กรุณาแบ่งเป็นหลายออร์เดอร์");
    }

    // หน่วยขาย (pack) ถูก resolve ที่ฝั่ง server เสมอ: โมเดลบอกได้แค่ "ชื่อหน่วย"
    // จำนวนหน่วยฐานต่อหน่วยขายและราคาต่อหน่วยขายมาจาก bms_product_packs (7.86)
    // เท่านั้น ราคาที่โมเดลนึกขึ้นเองจึงไม่มีทางไปถึงบิลได้
    const items: OrderItemInput[] = [];
    for (const it of requested) {
      if (!it.packCode) {
        items.push({ sku: it.sku, size: it.size, qty: it.qty });
        continue;
      }
      const pack = await resolveSellablePack(ec.tenantId, it.sku, it.size, it.packCode);
      if (!pack) {
        throw new ToolArgError(
          `ไม่พบหน่วยขาย "${it.packCode}" ของสินค้า ${it.sku} (ไซซ์ ${it.size}) — ให้เช็กหน่วยขายที่ร้านมีก่อน หรือสั่งเป็นหน่วยฐานแทน`
        );
      }
      items.push({
        sku: it.sku,
        size: it.size,
        // qty ที่บันทึกลงบิลเป็น "หน่วยฐาน" เสมอ (สต็อกนับหน่วยเดียว) ส่วน packQty
        // คือจำนวนหน่วยขายที่ลูกค้าขอ — ความหมายเดียวกับที่ POS ส่งมา
        qty: pack.baseQty * it.qty,
        packCode: pack.packCode,
        packUnitName: pack.unitName,
        packQty: it.qty,
        packUnitPrice: pack.price,
      });
    }

    // ================= ยืนยันรายการก่อนเขียน (customer surface เท่านั้น) =================
    // เดิม "ให้ลูกค้ายืนยันก่อน" เป็นแค่ประโยคใน description/whenToUse ของทูลนี้ ไม่มีอะไร
    // บังคับ โมเดลจึงสร้างบิลและจองสต็อกได้ทันทีที่มันคิดว่าข้อมูลครบ โดยลูกค้าอาจไม่เคยเห็น
    // รายการทั้งชุดเลย · ตอนนี้เป็นกฎของ server: ถ้าตะกร้าชุดนี้ยังไม่ถูกลูกค้ายืนยัน
    // ทูลนี้ **ไม่เขียนอะไรเลย** แล้วคืนรายการที่ resolve แล้วให้ pipeline เอาไปถามยืนยัน
    //
    // ไม่มีออร์เดอร์ไหนหายจากกฎนี้ — ครั้งแรกกลายเป็นคำถามยืนยัน ครั้งที่สอง (หลังลูกค้าตอบ)
    // เดินเส้นทางเขียนเดิมทั้งเส้น · staff surface ไม่ถูกแตะ (แอดมินเห็นหน้าจอที่ตัวเองกรอกอยู่)
    if (ec.surface === "customer") {
      const fingerprint = orderQuoteFingerprint(requested);
      if (ec.customerConfirmedQuote?.fingerprint !== fingerprint) {
        const quoteLines: OrderQuoteLine[] = [];
        for (const it of requested) {
          const stock = await checkStock(ec.tenantId, it.sku, it.size);
          const name = "name" in stock ? stock.name : it.sku;
          const basePrice = "price" in stock ? Number(stock.price) : null;
          const pack = it.packCode
            ? await resolveSellablePack(ec.tenantId, it.sku, it.size, it.packCode)
            : null;
          quoteLines.push({
            sku: it.sku,
            name,
            size: it.size,
            displayQty: it.qty,
            packUnitName: pack?.unitName ?? null,
            // ราคายกหน่วยที่ร้านตั้งไว้ชนะเสมอ ถ้าไม่ได้ตั้งไว้จึงคิดจากราคาต่อหน่วยฐาน ×
            // baseQty — สูตรเดียวกับที่ stock.ts บอกไว้ที่ StockPackOption.price
            unitPrice: pack
              ? pack.price ?? (basePrice != null ? basePrice * pack.baseQty : null)
              : basePrice,
          });
        }
        ec.pendingOrderQuote = { fingerprint, lines: quoteLines };
        return {
          ok: true,
          data: {
            status: "CONFIRMATION_REQUIRED",
            note: "ยังไม่ได้สร้างออร์เดอร์และยังไม่ได้จองสต็อก — ระบบสรุปรายการให้ลูกค้ายืนยันแล้ว ห้ามบอกลูกค้าว่าสั่งสำเร็จ และห้ามเรียกทูลนี้ซ้ำจนกว่าลูกค้าจะตอบยืนยัน",
            items: quoteLines,
          },
        };
      }
    }

    const channel: Channel =
      ec.surface === "customer"
        ? ec.channel ?? "web"
        : (enumVal(args, "channel", STAFF_CHANNELS, false) as Channel) ?? "web";
    const customerRef = ec.surface === "customer" ? ec.customerRef ?? null : optString(args, "customerRef") ?? null;

    // A carrier preference is only accepted if the shop actually uses that carrier —
    // otherwise reject the argument so the model asks again instead of recording a
    // preference the shop can never honour.
    const requestedCarrier = enumVal(args, "preferredCarrier", CARRIER_CODES, false);
    if (requestedCarrier) {
      const { enabledCarriers } = await getStoreProfile(ec.tenantId);
      if (!enabledCarriers.includes(requestedCarrier)) {
        throw new ToolArgError(
          enabledCarriers.length
            ? `ร้านนี้ส่งได้เฉพาะ: ${enabledCarriers.join(", ")}`
            : "ร้านนี้ยังไม่ได้ระบุขนส่งที่ใช้ อย่าเสนอตัวเลือกขนส่งให้ลูกค้า"
        );
      }
    }

    const r = await createOrder({
      tenantId: ec.tenantId,
      channel,
      customerRef,
      items,
      editorId: ec.surface === "staff" ? ec.ctx?.admin?.id ?? null : null,
      couponCode: optString(args, "couponCode") ?? null,
      preferredCarrier: requestedCarrier ?? null,
    });
    const pharmacyBlockers = "blockers" in r && Array.isArray(r.blockers) ? r.blockers : [];
    // เกณฑ์ "เคสนี้เภสัชกรตัดสินได้ไหม" อยู่ที่ productPolicyDecision.ts ที่เดียว —
    // เดิมสามจุดเขียนรายการสถานะเองแยกกัน ซึ่งเป็นเหตุที่ยาต้องมีใบสั่งขายไม่ได้เลย
    // (ตัวประเมินยอมให้เคสที่ approve แล้วผ่าน แต่ไม่มีใครเปิดเคสให้ตั้งแต่แรก)
    const reviewablePharmacyBasket = isPharmacistReviewableBasket(r.status, pharmacyBlockers);
    if (
      ec.surface === "customer" &&
      ec.conversationId &&
      ec.channel &&
      reviewablePharmacyBasket
    ) {
      try {
        const review = await createProductReviewAssessmentOnce({
          tenantId: ec.tenantId,
          channelId: ec.channel,
          conversationId: ec.conversationId,
          items,
          requiresSafetyCheck: pharmacyBlockers.some(
            (blocker) => blocker.status === "PHARMACY_SAFETY_CHECK_REQUIRED"
          ) || r.status === "PHARMACY_SAFETY_CHECK_REQUIRED",
        });
        ec.pharmacyReviewCaseId = review.assessmentId.slice(0, 8);
        return {
          ok: true,
          data: {
            ...r,
            pharmacyReviewCaseId: ec.pharmacyReviewCaseId,
            pharmacyReviewCreated: review.status === "CREATED",
          },
        };
      } catch (error) {
        console.error("[BMS] pharmacy product review request failed:", error);
        return { ok: true, data: { ...r, pharmacyReviewCaseId: null, pharmacyReviewCreated: false } };
      }
    }
    if (r.status === "CREATED") {
      if (ec.surface === "customer") ec.createdOrderId = r.orderId;
      await auditWrite(ec, "order.create", r.orderId, { itemCount: items.length, total: r.total });
      if (ec.surface === "customer" && ec.channel && ec.customerRef) {
        return {
          ok: true,
          data: {
            ...r,
            checkout: await getCustomerCheckoutStatus(
              ec.tenantId,
              ec.channel,
              ec.customerRef
            ),
          },
        };
      }
    }
    return { ok: true, data: r };
  },
};

const saveCustomerCheckoutDetailsTool: BmsTool = {
  name: "save_customer_checkout_details",
  description:
    "Save delivery details that this customer explicitly supplied for their own channel identity. " +
    "Pass only fields present in the customer's message; omitted fields keep their existing values. " +
    "Never call this merely to reconfirm existing data. After saving, use returned missingFields and ask for only the first remaining field.",
  surfaces: ["customer"],
  whenToUse: "The customer's current message explicitly supplies one or more missing delivery fields returned by get_customer_checkout.",
  whenNotToUse: "Existing fields are already complete, the customer only confirmed them, or the message did not explicitly contain new delivery data.",
  commonMistakes: [
    "Pass only fields explicitly present in the current customer message; omitted fields are preserved and must not be reconstructed from chat memory.",
  ],
  example: {
    input: { phone: "0812345678" },
    note: "The backend requested phone as the first missing field and the customer supplied it in this message.",
  },
  inputSchema: {
    type: "object",
    properties: {
      recipientName: {
        type: "string",
        description: "Recipient name explicitly supplied by the customer.",
      },
      phone: {
        type: "string",
        description: "Contact phone explicitly supplied by the customer.",
      },
      shippingAddress: {
        type: "string",
        description: "Full shipping address explicitly supplied by the customer.",
      },
      addressLabel: {
        type: "string",
        description: "Optional label such as home or office, only when the customer supplied it.",
      },
      province: {
        type: "string",
        description:
          "Destination province, only when the customer stated it. Used to price shipping by zone — never infer it from the address yourself.",
      },
      postcode: {
        type: "string",
        description: "5-digit destination postcode, only when the customer stated it.",
      },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    if (!ec.channel || !ec.customerRef) {
      return { ok: false, error: "ไม่พบตัวตนลูกค้าจากช่องทางนี้" };
    }
    const saved = await saveCustomerCheckoutDetails(
      ec.tenantId,
      ec.channel,
      ec.customerRef,
      {
        recipientName: optString(args, "recipientName") ?? null,
        phone: optString(args, "phone") ?? null,
        shippingAddress: optString(args, "shippingAddress") ?? null,
        addressLabel: optString(args, "addressLabel") ?? null,
        province: optString(args, "province") ?? null,
        postcode: optString(args, "postcode") ?? null,
      }
    );
    // ที่อยู่/จังหวัดเพิ่งมาถึง → คิดค่าส่งของออร์เดอร์ที่ยังไม่จ่ายใหม่ (7.47)
    if (saved.customerId) await recalculateOrderShipping(ec.tenantId, saved.customerId);
    await auditWrite(ec, "customer.checkout_update", saved.customerId, {
      fields: [
        optString(args, "recipientName") ? "recipientName" : null,
        optString(args, "phone") ? "phone" : null,
        optString(args, "shippingAddress") ? "shippingAddress" : null,
        optString(args, "province") ? "province" : null,
        optString(args, "postcode") ? "postcode" : null,
      ].filter(Boolean),
    });
    return { ok: true, data: saved.status };
  },
};

const submitPaymentTool: BmsTool = {
  name: "submit_payment",
  description:
    "Record a customer payment notification (status PENDING — funds are NOT confirmed; an admin must verify the slip first). Use when the customer says they have transferred. " +
    "Customer surface: never ask for or pass orderId — leave it empty and the latest PENDING order on the current channel is used automatically; repeated notices reuse an existing active payment. " +
    "Lazada/Shopee payment stays in Seller Center and must not create a payment here. " +
    "Before suggesting or accepting a customer payment method, call get_payment_info and use only a configured channel returned there. " +
    "You must know `method` (the channel they transferred through) before calling. If the customer did not say which configured channel, ask exactly one confirming question first. Never guess.",
  surfaces: ["customer", "staff"],
  permission: "payment.submit",
  whenToUse: "The customer explicitly says payment was transferred and the exact configured receiving method is known, or staff wants to record a payment against an explicit orderId.",
  whenNotToUse: "The customer is only asking how to pay -> use get_payment_info; the method is unknown/unconfigured; or the channel is Lazada/Shopee where Seller Center owns payment.",
  commonMistakes: [
    "On the customer surface never pass orderId: the backend selects only a PENDING order on the current channel, even though get_order_status can show canonical cross-channel history.",
    "A repeated customer notice may return ALREADY_SUBMITTED; report that the existing payment is awaiting review and never create or claim a duplicate.",
  ],
  example: {
    input: { method: "BANK_TRANSFER", slipRef: "customer-provided-reference" },
    note: "Customer confirmed a transfer to a BANK account returned by get_payment_info; orderId is omitted on the customer surface.",
  },
  inputSchema: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description:
          "Order id. Customer surface leaves it empty (latest PENDING order on the current channel); staff surface must provide it.",
      },
      method: { type: "string", enum: PAYMENT_METHODS as unknown as string[] },
      amount: { type: "number", description: "Amount transferred (omit = order total)." },
      slipRef: { type: "string", description: "Bank reference or transaction id." },
      note: { type: "string" },
    },
    required: ["method"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const method = enumVal(args, "method", PAYMENT_METHODS)!;
    if (ec.surface === "customer") {
      if (ec.channel && MARKETPLACE_CHANNELS.has(ec.channel)) {
        return { ok: true, data: { status: "MARKETPLACE_MANAGED" } };
      }
      const profile = await getStoreProfile(ec.tenantId);
      if (!isCustomerPaymentMethod(method) || !supportsCustomerPaymentMethod(profile.paymentAccounts, method)) {
        return {
          ok: true,
          data: {
            status: "PAYMENT_METHOD_NOT_CONFIGURED",
            configuredMethods: configuredPaymentAccounts(profile.paymentAccounts).map(
              (account) => account.type
            ),
          },
        };
      }
    }
    let orderId = optString(args, "orderId") ?? null;
    if (ec.surface === "customer") {
      if (!ec.customerRef || !ec.channel) {
        return { ok: false, error: "ไม่พบตัวตนลูกค้าจากช่องทางนี้" };
      }
      const payable = await findCustomerPayableOrder(
        ec.tenantId,
        ec.channel,
        ec.customerRef,
        orderId
      );
      if (!payable) return { ok: true, data: { status: "ORDER_NOT_FOUND" } };
      orderId = payable.orderId;
    } else {
      if (!orderId) {
        return { ok: false, error: "ต้องระบุ orderId" };
      }
    }
    const amount = typeof args.amount === "number" ? args.amount : undefined;
    const submit = ec.surface === "customer" ? submitPaymentOnce : submitPayment;
    const r = await submit({
      tenantId: ec.tenantId,
      orderId,
      method,
      amount: amount ?? null,
      slipRef: optString(args, "slipRef") ?? null,
      note: optString(args, "note") ?? null,
      actor: ec.actor,
    });
    if (r.status === "SUBMITTED") await auditWrite(ec, "payment.submit", r.paymentId, { orderId, method });
    return { ok: true, data: r };
  },
};

const reorderTool: BmsTool = {
  name: "reorder",
  description:
    "Repeat a previous order (reserves stock again, at current prices). Use when the customer says to order the same as before. " +
    "Customer surface: never ask for or pass orderId — the customer's latest order is used automatically. Staff surface must pass orderId.",
  surfaces: ["customer", "staff"],
  permission: "order.create",
  whenToUse: "The customer explicitly says 'order again/same as before/repeat my last order' and wants every item from that order, not just some of them.",
  whenNotToUse: "The customer wants to change some items from the previous order → use create_order with the new items instead; don't use reorder expecting to edit it afterward.",
  commonMistakes: ["On the customer surface, never pass orderId even if the customer states an order number themselves — the system always resolves that customer's own latest order, to prevent guessing someone else's orderId."],
  example: { input: {}, note: "Customer surface: customer said 'same as last time', so orderId is omitted." },
  inputSchema: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description:
          "Source order id. Customer surface may leave it empty (latest order is used); staff surface must provide it.",
      },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    let orderId = optString(args, "orderId") ?? null;
    if (!orderId) {
      if (ec.surface !== "customer" || !ec.customerRef || !ec.channel) {
        return { ok: false, error: "ต้องระบุ orderId" };
      }
      const [latest] = await listCustomerOrderStatuses(ec.tenantId, ec.channel, ec.customerRef, 1);
      if (!latest) return { ok: false, error: "ไม่พบออร์เดอร์เดิมของคุณ" };
      orderId = latest.orderId;
    }
    if (ec.surface === "customer" && !(await customerOwnsOrder(ec, orderId))) {
      return { ok: false, error: "ไม่พบออร์เดอร์นี้ในบัญชีของคุณ" };
    }
    const r = await reorderFromOrder(
      ec.tenantId,
      orderId,
      ec.surface === "staff" ? ec.ctx?.admin?.id ?? null : null,
      ec.surface === "customer" && ec.channel && ec.customerRef
        ? { channel: ec.channel, customerRef: ec.customerRef }
        : null
    );
    if ((r as any).status === "CREATED") {
      if (ec.surface === "customer") ec.createdOrderId = (r as any).orderId;
      await auditWrite(ec, "order.create", (r as any).orderId, { reorderFrom: orderId });
    }
    return { ok: true, data: r };
  },
};

const createShipmentTool: BmsTool = {
  name: "create_shipment",
  description:
    "Create a shipment with its carrier and tracking number and actually dispatch it (order PACKING → SHIPPED, and stock is deducted).",
  surfaces: ["staff"],
  permission: "shipping.create",
  inputSchema: {
    type: "object",
    properties: {
      orderId: { type: "string" },
      carrier: { type: "string", enum: CARRIERS as unknown as string[] },
      trackingNo: { type: "string" },
      note: { type: "string" },
    },
    required: ["orderId", "carrier"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const orderId = reqString(args, "orderId");
    const carrier = enumVal(args, "carrier", CARRIERS)!;
    const r = await createShipment({
      tenantId: ec.tenantId,
      orderId,
      carrier,
      trackingNo: optString(args, "trackingNo") ?? null,
      note: optString(args, "note") ?? null,
      actor: ec.actor,
    });
    if (r.status === "CREATED") await auditWrite(ec, "shipping.create", r.shipmentId, { orderId, carrier });
    return { ok: true, data: r };
  },
};

const updateTrackingTool: BmsTool = {
  name: "update_tracking",
  description: "Update a shipment's tracking number or carrier.",
  surfaces: ["staff"],
  permission: "shipping.update",
  inputSchema: {
    type: "object",
    properties: {
      shipmentId: { type: "string" },
      trackingNo: { type: "string" },
      carrier: { type: "string", enum: CARRIERS as unknown as string[] },
    },
    required: ["shipmentId"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const shipmentId = reqString(args, "shipmentId");
    const ok = await updateTracking(
      ec.tenantId,
      shipmentId,
      { trackingNo: optString(args, "trackingNo") ?? null, carrier: enumVal(args, "carrier", CARRIERS, false) ?? null },
      ec.actor
    );
    if (ok) await auditWrite(ec, "shipping.update", shipmentId, { kind: "tracking" });
    return { ok: true, data: { updated: ok } };
  },
};

const setShipmentStatusTool: BmsTool = {
  name: "set_shipment_status",
  description: "Change a shipment's status (DELIVERED also completes the order).",
  surfaces: ["staff"],
  permission: "shipping.update",
  inputSchema: {
    type: "object",
    properties: {
      shipmentId: { type: "string" },
      status: { type: "string", enum: SHIPMENT_STATUSES as unknown as string[] },
    },
    required: ["shipmentId", "status"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const shipmentId = reqString(args, "shipmentId");
    const status = enumVal(args, "status", SHIPMENT_STATUSES)!;
    const ok = await setShipmentStatus(ec.tenantId, shipmentId, status);
    if (ok) await auditWrite(ec, "shipping.update", shipmentId, { status });
    return { ok: true, data: { updated: ok } };
  },
};

const createPurchaseOrderTool: BmsTool = {
  name: "create_purchase_order",
  description: "Create a purchase order (PO) for a supplier (stock does not move until the goods are received).",
  surfaces: ["staff"],
  permission: "purchase.edit",
  inputSchema: {
    type: "object",
    properties: {
      supplierName: { type: "string" },
      supplierId: { type: "string" },
      note: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sku: { type: "string" },
            size: { type: "string" },
            qty: { type: "integer" },
            unitCost: { type: "number" },
            supplierSku: { type: "string" },
            supplierProductName: { type: "string" },
            supplierBarcode: { type: "string" },
          },
          required: ["sku", "size", "qty"],
        },
      },
    },
    required: ["items"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const items = reqItems(args).map((it, i) => ({
      ...it,
      unitCost: typeof (args.items?.[i]?.unitCost) === "number" ? args.items[i].unitCost : undefined,
      supplierSku: typeof (args.items?.[i]?.supplierSku) === "string" ? args.items[i].supplierSku : undefined,
      supplierProductName: typeof (args.items?.[i]?.supplierProductName) === "string" ? args.items[i].supplierProductName : undefined,
      supplierBarcode: typeof (args.items?.[i]?.supplierBarcode) === "string" ? args.items[i].supplierBarcode : undefined,
    }));
    const r = await createPurchaseOrder({
      tenantId: ec.tenantId,
      supplierId: optString(args, "supplierId") ?? null,
      supplierName: optString(args, "supplierName") ?? null,
      note: optString(args, "note") ?? null,
      items,
      actor: ec.actor,
    });
    if (r.status === "CREATED") await auditWrite(ec, "purchase.edit", r.poId, { itemCount: items.length });
    return { ok: true, data: r };
  },
};

const receivePurchaseOrderTool: BmsTool = {
  name: "receive_purchase_order",
  description: "Receive goods from a purchase order into stock, partially or in full → increases current_stock and records STOCK_IN.",
  surfaces: ["staff"],
  permission: "purchase.receive",
  inputSchema: {
    type: "object",
    properties: {
      poId: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { sku: { type: "string" }, size: { type: "string" }, qty: { type: "integer" } },
          required: ["sku", "size", "qty"],
        },
      },
    },
    required: ["poId", "items"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const poId = reqString(args, "poId");
    const items = reqItems(args);
    const r = await receivePurchaseOrder(
      ec.tenantId,
      poId,
      items,
      ec.actor,
      ec.ctx?.admin?.id ?? null,
      { audit: { actor: ec.actor, meta: { surface: `ai:${ec.surface}` } } }
    );
    return { ok: true, data: r };
  },
};

const upsertCustomerTool: BmsTool = {
  name: "upsert_customer",
  description:
    "Create or edit a customer (name, phone, note, tags) — pass customerId to edit an existing one; omit it to create a new one.",
  surfaces: ["staff"],
  permission: "customer.edit",
  inputSchema: {
    type: "object",
    properties: {
      customerId: { type: "string" },
      name: { type: "string" },
      phone: { type: "string" },
      note: { type: "string" },
    },
    required: ["name"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const c = await upsertCustomer(ec.tenantId, {
      id: optString(args, "customerId") ?? null,
      name: reqString(args, "name"),
      phone: optString(args, "phone") ?? null,
      note: optString(args, "note") ?? null,
    });
    await auditWrite(ec, "customer.edit", (c as any)?.id ?? null, { kind: "upsert" });
    return { ok: true, data: c };
  },
};

const setCustomerTagsTool: BmsTool = {
  name: "set_customer_tags",
  description: "Set a customer's tags (replaces the whole existing set).",
  surfaces: ["staff"],
  permission: "customer.edit",
  inputSchema: {
    type: "object",
    properties: {
      customerId: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["customerId", "tags"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const id = reqString(args, "customerId");
    const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
    const ok = await setCustomerTags(ec.tenantId, id, tags);
    if (ok) await auditWrite(ec, "customer.edit", id, { kind: "tags" });
    return { ok: true, data: { updated: ok } };
  },
};

const assignConversationTool: BmsTool = {
  name: "assign_conversation",
  description: "Assign a conversation to one staff member (as its primary owner).",
  surfaces: ["staff"],
  permission: "inbox.assign",
  inputSchema: {
    type: "object",
    properties: { conversationId: { type: "string" }, userId: { type: "string" } },
    required: ["conversationId", "userId"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const id = reqString(args, "conversationId");
    const ok = await assignConversation(ec.tenantId, id, reqString(args, "userId"));
    if (ok) await auditWrite(ec, "inbox.assign", id, {});
    return { ok: true, data: { updated: ok } };
  },
};

const setConversationStatusTool: BmsTool = {
  name: "set_conversation_status",
  description: "Change a conversation's status (OPEN/PENDING/CLOSED).",
  surfaces: ["staff"],
  permission: "inbox.manage",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string" },
      status: { type: "string", enum: CONV_STATUSES as unknown as string[] },
    },
    required: ["conversationId", "status"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const id = reqString(args, "conversationId");
    const status = enumVal(args, "status", CONV_STATUSES)!;
    const ok = await setConversationStatus(ec.tenantId, id, status);
    if (ok) await auditWrite(ec, "inbox.manage", id, { status });
    return { ok: true, data: { updated: ok } };
  },
};

const setConversationTagsTool: BmsTool = {
  name: "set_conversation_tags",
  description: "Set a conversation's tags (replaces the existing set).",
  surfaces: ["staff"],
  permission: "inbox.manage",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["conversationId", "tags"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const id = reqString(args, "conversationId");
    const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
    const ok = await setConversationTags(ec.tenantId, id, tags);
    if (ok) await auditWrite(ec, "inbox.manage", id, { kind: "tags" });
    return { ok: true, data: { updated: ok } };
  },
};

const addNoteTool: BmsTool = {
  name: "add_note",
  description: "Add an internal note to a conversation (the customer never sees it).",
  surfaces: ["staff"],
  permission: "inbox.manage",
  inputSchema: {
    type: "object",
    properties: { conversationId: { type: "string" }, body: { type: "string" } },
    required: ["conversationId", "body"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const id = reqString(args, "conversationId");
    const note = await addNote(ec.tenantId, id, ec.actor, reqString(args, "body"));
    if (note) await auditWrite(ec, "inbox.manage", id, { kind: "note" });
    return { ok: true, data: note ?? { added: false } };
  },
};

const verifyPaymentSlipTool: BmsTool = {
  name: "verify_payment_slip",
  description:
    "Have AI check a payment slip (OCR/vision) against the amount due — advisory only: it does not change the payment status, and an admin must still confirm it themselves.",
  surfaces: ["staff"],
  permission: "payment.confirm",
  inputSchema: {
    type: "object",
    properties: { paymentId: { type: "string" } },
    required: ["paymentId"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const v = await verifyPaymentSlip(ec.tenantId, reqString(args, "paymentId"));
    if (!v) return { ok: false, error: "ไม่พบการชำระเงิน หรือไม่มีสลิปให้ตรวจ" };
    return { ok: true, data: v };
  },
};

// =============================================================
// A3 — sensitive (PROPOSE-ONLY) → ปุ่ม Confirm ยิง mutation เดิม
// =============================================================

function proposalTool(cfg: {
  name: string;
  description: string;
  mutation: string;
  permission: BmsPermission;
  inputSchema: BmsTool["inputSchema"];
  buildArgs: (args: Record<string, any>) => Record<string, unknown>;
  summary: (args: Record<string, any>) => string;
}): BmsTool {
  return {
    name: cfg.name,
    description:
      cfg.description +
      " (A human must always press Confirm first — this tool only proposes the action, it does not perform it immediately.)",
    surfaces: ["staff"],
    permission: cfg.permission,
    sensitive: true,
    inputSchema: cfg.inputSchema,
    execute: async (args): Promise<ToolResult> => ({
      ok: true,
      proposal: {
        tool: cfg.name,
        mutation: cfg.mutation,
        args: cfg.buildArgs(args),
        summary: cfg.summary(args),
      },
    }),
  };
}

const idSchema = (label: string): BmsTool["inputSchema"] => ({
  type: "object",
  properties: { id: { type: "string", description: label } },
  required: ["id"],
});

const A3_TOOLS: BmsTool[] = [
  proposalTool({
    name: "confirm_payment",
    description: "Confirm a payment (PENDING → CONFIRMED, and the order → PAID).",
    mutation: "bmsConfirmPayment",
    permission: "payment.confirm",
    inputSchema: idSchema("paymentId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `ยืนยันการชำระเงิน #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "reject_payment",
    description: "Reject a payment (PENDING → REJECTED).",
    mutation: "bmsRejectPayment",
    permission: "payment.confirm",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, note: { type: "string" } },
      required: ["id"],
    },
    buildArgs: (a) => ({ id: reqString(a, "id"), note: optString(a, "note") ?? null }),
    summary: (a) => `ปฏิเสธการชำระเงิน #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "refund_payment",
    description: "Refund a payment (CONFIRMED → REFUNDED).",
    mutation: "bmsRefundPayment",
    permission: "payment.refund",
    inputSchema: idSchema("paymentId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `คืนเงินการชำระ #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "cancel_order",
    description: "Cancel an order (PENDING/PAID/PACKING → CANCELLED, releasing the reserved stock).",
    mutation: "bmsCancelOrder",
    permission: "order.cancel",
    inputSchema: idSchema("orderId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `ยกเลิกออร์เดอร์ #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "return_order",
    description: "Return the goods of an order (SHIPPED/COMPLETED → RETURNED, putting the stock back).",
    mutation: "bmsReturnOrder",
    permission: "order.return",
    inputSchema: idSchema("orderId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `คืนสินค้าออร์เดอร์ #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "adjust_stock",
    description: "Adjust stock up or down for a sku and size.",
    mutation: "bmsAdjustStock",
    permission: "stock.adjust",
    inputSchema: {
      type: "object",
      properties: {
        sku: { type: "string" },
        size: { type: "string" },
        delta: { type: "integer", description: "Amount to adjust by (+ to add / - to remove)." },
        note: { type: "string" },
      },
      required: ["sku", "size", "delta"],
    },
    buildArgs: (a) => ({
      sku: reqString(a, "sku"),
      size: reqString(a, "size"),
      delta: reqInt(a, "delta", -1_000_000),
      note: optString(a, "note") ?? null,
    }),
    summary: (a) => `ปรับสต็อก ${a.sku} ไซซ์ ${a.size} จำนวน ${a.delta}`,
  }),
  proposalTool({
    name: "merge_customers",
    description:
      "Merge duplicate customers (moves everything from mergeId onto keepId, then deletes mergeId — this cannot be undone).",
    mutation: "bmsMergeCustomers",
    permission: "customer.edit",
    inputSchema: {
      type: "object",
      properties: { keepId: { type: "string" }, mergeId: { type: "string" } },
      required: ["keepId", "mergeId"],
    },
    buildArgs: (a) => ({ keepId: reqString(a, "keepId"), mergeId: reqString(a, "mergeId") }),
    summary: (a) => `ผสานลูกค้า ${String(a.mergeId).slice(0, 8)} → ${String(a.keepId).slice(0, 8)}`,
  }),
  proposalTool({
    name: "cancel_purchase_order",
    description: "Cancel a purchase order (OPEN/PARTIAL → CANCELLED).",
    mutation: "bmsCancelPurchaseOrder",
    permission: "purchase.cancel",
    inputSchema: idSchema("poId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `ยกเลิกใบสั่งซื้อ #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "cancel_shipment",
    description: "Cancel a shipment.",
    mutation: "bmsCancelShipment",
    permission: "shipping.update",
    inputSchema: idSchema("shipmentId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `ยกเลิกการจัดส่ง #${String(a.id).slice(0, 8)}`,
  }),
];

// =============================================================
// B1 — store profile (read, customer + staff)
// =============================================================

const getStoreInfoTool: BmsTool = {
  name: "get_store_info",
  description:
    "Shop information: name, description, address, phone, opening hours, and the shipping and return policies. Use for the general questions customers ask most.",
  surfaces: ["customer", "staff"],
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => {
    const p = await getStoreProfile(ec.tenantId);
    // ชื่อร้าน = bms_tenants.name (ชื่อเดียวทั้งระบบ ไม่ใช้ store_name แล้ว)
    const storeName = await getTenantName(ec.tenantId);
    return {
      ok: true,
      data: {
        storeName,
        businessType: p.businessType,
        about: p.about, address: p.address, phone: p.phone,
        contactEmail: p.contactEmail, website: p.website,
        country: p.country, timezone: p.timezone,
        businessHours: p.businessHours, shippingPolicy: p.shippingPolicy, returnPolicy: p.returnPolicy,
        // Carriers the shop uses. Empty = do not offer the customer any carrier choice.
        // Picking one does not change the fee or delivery estimate (no carrier API is wired up),
        // and the shop confirms the real carrier at packing time.
        enabledCarriers: p.enabledCarriers,
        carrierChoiceNote: p.enabledCarriers.length
          ? "ลูกค้าเลือกขนส่งได้จากรายการนี้ แต่เป็นความต้องการเบื้องต้น ร้านยืนยันอีกครั้งตอนแพ็คของ และไม่มีผลกับค่าส่ง"
          : "ร้านยังไม่ได้ระบุขนส่งที่ใช้ — อย่าเสนอให้ลูกค้าเลือกขนส่ง",
      },
    };
  },
};

const getPaymentInfoTool: BmsTool = {
  name: "get_payment_info",
  description:
    "The shop's configured payment channels and receiving accounts. Call before mentioning payment methods or accounts. If configured=false, do not suggest examples or alternative channels; say the shop has not provided payment details yet.",
  surfaces: ["customer", "staff"],
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => {
    const p = await getStoreProfile(ec.tenantId);
    const paymentAccounts = configuredPaymentAccounts(p.paymentAccounts);
    return {
      ok: true,
      data: {
        configured: paymentAccounts.length > 0,
        paymentAccounts,
      },
    };
  },
};

const getShippingEstimateTool: BmsTool = {
  name: "get_shipping_estimate",
  description:
    "Estimate shipping cost and delivery time from the rates the shop configured. Pass the order subtotal so any free-shipping threshold is applied, " +
    "and pass province when the customer has stated their destination so the zone rate is used instead of the shop's flat rate. " +
    "Read `warnings` before answering: if it says the province was guessed or product weights are missing, tell the customer the fee is an estimate to be confirmed.",
  surfaces: ["customer", "staff"],
  inputSchema: {
    type: "object",
    properties: {
      subtotal: {
        type: "number",
        description: "Order subtotal, if known, used to check free shipping.",
      },
      province: {
        type: "string",
        description: "Destination province, only when the customer stated it. Never invent one.",
      },
      items: {
        type: "array",
        description: "Line items, if known, so parcel weight can be summed for weight-based rates.",
        items: {
          type: "object",
          properties: { sku: { type: "string" }, qty: { type: "integer" } },
          required: ["sku", "qty"],
        },
      },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const subtotal = typeof args.subtotal === "number" ? args.subtotal : null;
    const rawItems = Array.isArray(args.items) ? args.items : null;
    const items = rawItems
      ? rawItems
          .map((r: any) => ({ sku: String(r?.sku ?? "").trim(), qty: Number(r?.qty) || 1 }))
          .filter((r) => r.sku)
      : null;
    return {
      ok: true,
      data: await quoteShipping({
        tenantId: ec.tenantId,
        subtotal,
        province: optString(args, "province") ?? null,
        items: items && items.length ? items : null,
      }),
    };
  },
};

// =============================================================
// B2 — documents: invoice / quotation (staff)
// =============================================================

const generateInvoiceTool: BmsTool = {
  name: "generate_invoice",
  description: "Generate an invoice or receipt from a real order by orderId (line items and totals from the order's snapshot).",
  surfaces: ["staff"],
  permission: "order.view",
  inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
  execute: async (args, ec): Promise<ToolResult> => {
    const doc = await generateInvoice(ec.tenantId, reqString(args, "orderId"));
    if (!doc) return { ok: false, error: "ไม่พบออร์เดอร์" };
    return { ok: true, data: doc };
  },
};

const generateQuotationTool: BmsTool = {
  name: "generate_quotation",
  description:
    "Generate a quotation from a list of items (priced at current prices plus estimated shipping; it is not tied to any order and reserves no stock).",
  surfaces: ["staff"],
  permission: "order.view",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { sku: { type: "string" }, size: { type: "string" }, qty: { type: "integer" } },
          required: ["sku", "size", "qty"],
        },
      },
      customerRef: { type: "string" },
    },
    required: ["items"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const items = reqItems(args);
    const doc = await generateQuotation(ec.tenantId, items, optString(args, "customerRef") ?? null);
    return { ok: true, data: doc };
  },
};

// =============================================================
// B3 — forecast (staff, report.view) · heuristic + uncertainty
// =============================================================

const forecastDemandTool: BmsTool = {
  name: "forecast_demand",
  description:
    "Forecast future demand per sku (heuristic, based on average past sales — not guaranteed figures).",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: {
    type: "object",
    properties: {
      windowDays: { type: "integer", description: "How many days of past data to use (default 30)." },
      horizonDays: { type: "integer", description: "How many days ahead to forecast (default 30)." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const data = await forecastDemand(
      ec.tenantId,
      optInt(args, "windowDays", 1, 365) ?? 30,
      optInt(args, "horizonDays", 1, 365) ?? 30
    );
    return { ok: true, data };
  },
};

const predictStockOutTool: BmsTool = {
  name: "predict_stockout",
  description:
    "Estimate how many days until each size runs out of stock, based on recent sales velocity (heuristic — highest risk listed first).",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: { type: "object", properties: { windowDays: { type: "integer" } } },
  execute: async (args, ec): Promise<ToolResult> => {
    const data = await predictStockOut(ec.tenantId, optInt(args, "windowDays", 1, 365) ?? 30);
    return { ok: true, data };
  },
};

const suggestPurchaseOrderTool: BmsTool = {
  name: "suggest_purchase_order",
  description:
    "Suggest how much to purchase so stock covers a given number of days of sales (heuristic — must be reviewed before ordering for real).",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: {
    type: "object",
    properties: {
      windowDays: { type: "integer" },
      coverageDays: { type: "integer", description: "How many days of sales the stock should cover (default 30)." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const data = await suggestPurchaseOrder(
      ec.tenantId,
      optInt(args, "windowDays", 1, 365) ?? 30,
      optInt(args, "coverageDays", 1, 365) ?? 30
    );
    return { ok: true, data };
  },
};

// =============================================================
// B3 — AI-native (data providers — deterministic, ไม่เรียก Claude ซ้ำ)
// =============================================================

const detectLanguageTool: BmsTool = {
  name: "detect_language",
  description: "Detect the language of a text (th/en/other) heuristically.",
  surfaces: ["customer", "staff"],
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  execute: async (args): Promise<ToolResult> => {
    const text = reqString(args, "text");
    const thai = (text.match(/[฀-๿]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    let language = "other";
    let confidence = 0.3;
    if (thai + latin > 0) {
      language = thai >= latin ? "th" : "en";
      confidence = +(Math.max(thai, latin) / (thai + latin)).toFixed(2);
    }
    return { ok: true, data: { language, confidence } };
  },
};

const classifyIntentTool: BmsTool = {
  name: "classify_intent",
  description:
    "Classify the intent of a customer message (CHECK_STOCK/CONFIRM_ORDER/GREETING/UNKNOWN) and extract entities, rule-based.",
  surfaces: ["staff"],
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  execute: async (args): Promise<ToolResult> => {
    const u = understand(reqString(args, "text"));
    return { ok: true, data: { intent: u.intent, entities: u.entities } };
  },
};

const summarizeConversationTool: BmsTool = {
  name: "summarize_conversation",
  description: "Fetch the latest messages of one conversation by conversationId, for summarizing.",
  surfaces: ["staff"],
  permission: "inbox.view",
  inputSchema: { type: "object", properties: { conversationId: { type: "string" } }, required: ["conversationId"] },
  execute: async (args, ec): Promise<ToolResult> => {
    const id = reqString(args, "conversationId");
    const conv = await getConversation(ec.tenantId, id);
    if (!conv) return { ok: false, error: "ไม่พบแชท" };
    const msgs = await listMessages(ec.tenantId, id, 40);
    return { ok: true, data: { conversation: conv, messages: msgs } };
  },
};

const recommendProductsTool: BmsTool = {
  name: "recommend_products",
  description:
    "Fetch candidate products to recommend: searches by keyword when one is given, otherwise returns best sellers, for the responder to choose from.",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  whenToUse: "You need to recommend products for the customer to choose from (not the customer searching on their own) — e.g. closing out after answering another question, or the customer asked you to pick for them.",
  whenNotToUse: "The customer already stated what they want → use search_products; asked broadly what's sold → use browse_catalog.",
  example: { input: { keyword: "new year gift" }, note: "Customer asked to be recommended something, without naming a product themselves." },
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "Use-case, style, product, brand or customer need." },
      category: { type: "string", description: "Optional exact shop category." },
      minPrice: { type: "number", description: "Minimum desired price." },
      maxPrice: { type: "number", description: "Maximum customer budget." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const keyword = optString(args, "keyword");
    const category = optString(args, "category") ?? null;
    const minPrice = optMoney(args, "minPrice");
    const maxPrice = optMoney(args, "maxPrice");
    if (keyword || category || minPrice !== null || maxPrice !== null) {
      let { items } = await listSellableProducts(ec.tenantId, {
        search: keyword,
        category,
        minPrice,
        maxPrice,
        inStockOnly: true,
        sort: "relevance",
        limit: 8,
      });
      let basis = "customer_need";
      if (items.length === 0 && keyword) {
        items = (
          await listSellableProducts(ec.tenantId, {
            category,
            minPrice,
            maxPrice,
            inStockOnly: true,
            sort: "availability",
            limit: 8,
          })
        ).items;
        basis = "available_fallback";
      }
      const tenantSlug = await getTenantSlug(ec.tenantId);
      return {
        ok: true,
        data: {
          verifiedAt: new Date().toISOString(),
          basis,
          candidates: items.map((product) => safeCatalogProduct(product, tenantSlug)),
        },
      };
    }
    const top = await getTopSellingProducts(ec.tenantId, null, null, 8);
    const [{ items: available }, tenantSlug] = await Promise.all([
      listSellableProducts(ec.tenantId, {
        category,
        minPrice,
        maxPrice,
        inStockOnly: true,
        sort: "availability",
        limit: 20,
      }),
      getTenantSlug(ec.tenantId),
    ]);
    const bySku = new Map(available.map((product) => [product.sku, product]));
    const ranked = top
      .map((product: any) => bySku.get(product.sku))
      .filter((product): product is SellableProduct => Boolean(product));
    const seen = new Set(ranked.map((product) => product.sku));
    for (const product of available) {
      if (ranked.length >= 8) break;
      if (!seen.has(product.sku)) ranked.push(product);
    }
    return {
      ok: true,
      data: {
        verifiedAt: new Date().toISOString(),
        basis: top.length > 0 ? "top_sellers_then_available" : "available",
        candidates: ranked.map((product) => safeCatalogProduct(product, tenantSlug)),
      },
    };
  },
};

// =============================================================
// send message (staff, sensitive → propose-only) — LINE/Meta only via bmsSendMessage
// =============================================================

const sendCustomerMessageTool: BmsTool = proposalTool({
  name: "send_customer_message",
  description:
    "Send a proactive message to the customer in a conversation (only on channels that support push, e.g. LINE/Facebook/Instagram — other channels record the message but do not push it).",
  mutation: "bmsSendMessage",
  permission: "inbox.reply",
  inputSchema: {
    type: "object",
    properties: { conversationId: { type: "string" }, body: { type: "string" } },
    required: ["conversationId", "body"],
  },
  buildArgs: (a) => ({ id: reqString(a, "conversationId"), body: reqString(a, "body") }),
  summary: (a) => `ส่งข้อความหาลูกค้าในแชท #${String(a.conversationId).slice(0, 8)}: "${String(a.body).slice(0, 40)}"`,
});

// =============================================================
// registry
// =============================================================

export const ALL_TOOLS: BmsTool[] = [
  // A1
  searchSystemCapabilitiesTool,
  searchSystemGuidesTool,
  getMyAccessTool,
  searchStaffUsersTool,
  getStaffUserAccessTool,
  getLoyaltyProgramStatusTool,
  searchProducts,
  browseCatalogTool,
  listNewArrivalsTool,
  findAlternativesTool,
  getProduct,
  checkStockTool,
  getVariantReservationsTool,
  subscribeRestockNotificationTool,
  listCustomerCouponsTool,
  listAvailableCouponsTool,
  checkCouponTool,
  getLoyaltyPointsTool,
  getOrderStatus,
  getCustomerCheckoutTool,
  listLowStockTool,
  getInventorySummaryTool,
  getSalesSummaryTool,
  getTopProductsTool,
  getDashboardTool,
  analyzePosShiftTool,
  getCustomerTool,
  listCustomersTool,
  customerOrdersTool,
  listShipmentsTool,
  getShipmentLabelTool,
  listPaymentsTool,
  listPurchaseOrdersTool,
  getPurchaseOrderTool,
  listSuppliersTool,
  // A2
  createOrderTool,
  saveCustomerCheckoutDetailsTool,
  submitPaymentTool,
  reorderTool,
  createShipmentTool,
  updateTrackingTool,
  setShipmentStatusTool,
  createPurchaseOrderTool,
  receivePurchaseOrderTool,
  upsertCustomerTool,
  setCustomerTagsTool,
  assignConversationTool,
  setConversationStatusTool,
  setConversationTagsTool,
  addNoteTool,
  verifyPaymentSlipTool,
  generateReportTool,
  emailReportTool,
  // B1 — store profile (read)
  getStoreInfoTool,
  getPaymentInfoTool,
  getShippingEstimateTool,
  // B2 — documents
  generateInvoiceTool,
  generateQuotationTool,
  // B3 — forecast
  forecastDemandTool,
  predictStockOutTool,
  suggestPurchaseOrderTool,
  // B3 — AI-native
  detectLanguageTool,
  classifyIntentTool,
  summarizeConversationTool,
  recommendProductsTool,
  // send message (propose-only)
  sendCustomerMessageTool,
  // A3
  ...A3_TOOLS,
];

assertValidToolRegistry(ALL_TOOLS);

/** ทูลฝั่งลูกค้า: เฉพาะ surface=customer (ไม่มี A3/A2-staff ตั้งแต่ต้น) */
export function customerTools(): BmsTool[] {
  return ALL_TOOLS.filter((t) => t.surfaces.includes("customer"));
}

/** ทูลฝั่งแอดมิน: surface=staff + ผ่าน RBAC (ทูลที่ role ไม่มีสิทธิ์จะไม่ถูกเสนอให้ AI เลย) */
export function staffTools(perms: Set<string>): BmsTool[] {
  return ALL_TOOLS.filter(
    (t) => t.surfaces.includes("staff") && (!t.permission || perms.has(t.permission))
  );
}
