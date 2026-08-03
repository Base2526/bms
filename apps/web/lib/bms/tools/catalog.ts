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
import { checkStock } from "../stock";
import { CARRIER_CODES } from "../carriers/constants";
import { quoteShipping } from "../shippingRates";
import {
  createOrder,
  recalculateOrderShipping,
  reorderFromOrder,
  getOrderJourney,
  listCustomerOrderStatuses,
  customerOwnsOrder as serviceCustomerOwnsOrder,
} from "../orders";
import { submitPayment, verifyPaymentSlip, listPayments, PAYMENT_METHODS } from "../payments";
import {
  createShipment,
  updateTracking,
  setShipmentStatus,
  listShipments,
  getShipmentLabel,
  CARRIERS,
  SHIPMENT_STATUSES,
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
} from "../customers";
import { getSalesSummary, getInventorySummary, getTopSellingProducts } from "../reports";
import { getDashboard } from "../dashboard";
import { assignConversation, setConversationStatus, setConversationTags, addNote, getConversation, listMessages } from "../inbox";
import { subscribeToRestock } from "../restockSubscriptions";
import { getStoreProfile } from "../storeProfile";
import {
  configuredPaymentAccounts,
  supportsCustomerPaymentMethod,
} from "../paymentConfiguration";
import { getTenantName, getTenantSlug } from "../platform";
import { generateInvoice, generateQuotation } from "../documents";
import { forecastDemand, predictStockOut, suggestPurchaseOrder } from "../forecast";
import { understand } from "../nlu";
import { checkCouponForCustomer, listAvailableCouponsForCustomer, listCustomerCouponWallet } from "../coupons";
import { recordSynonymCandidate } from "../aiSynonyms";

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

const searchProducts: BmsTool = {
  name: "search_products",
  description:
    "Search the shop's current active catalog by name, SKU, barcode, alias, category or brand. Returns verified price, availability, sizes and a public product path. Call this before answering any product question.",
  surfaces: ["customer", "staff"],
  permission: "product.view",
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
    return {
      ok: true,
      data: {
        sku: p.sku,
        name: p.name,
        price: Number(p.price),
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
        })),
      },
    };
  },
};

const listAvailableCouponsTool: BmsTool = {
  name: "list_available_coupons",
  description:
    "List active coupons this customer is genuinely still eligible for, after the time window, quota, per-customer limit and minimum have been checked. Call this before answering when the customer asks about coupons or requests a discount.",
  surfaces: ["customer", "staff"],
  permission: "coupon.view",
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
    "Check stock and price for a product by name and size. Use when the customer asks whether an item is in stock, how many are left, or what it costs.",
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
    return { ok: true, data: res };
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

const getOrderStatus: BmsTool = {
  name: "get_order_status",
  description:
    "Get order status. Customer surface: call it straight away with no orderId — the latest order for this customer is returned automatically. " +
    "Never ask the customer for an order number before calling this; call first, then read the result to see whether an order exists. Staff surface: pass orderId for the full journey.",
  surfaces: ["customer", "staff"],
  permission: "order.view",
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
    "Sales summary for a date range (default: the last 30 days). Revenue counts only orders that reached PAID or later.",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD" },
      to: { type: "string", description: "YYYY-MM-DD" },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const from = optString(args, "from") ?? null;
    const to = optString(args, "to") ?? null;
    return { ok: true, data: await getSalesSummary(ec.tenantId, from, to) };
  },
};

const getTopProductsTool: BmsTool = {
  name: "get_top_products",
  description: "Best-selling products for a date range (by revenue and units sold).",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "integer", description: "How many ranked products to return (default 10)." },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const from = optString(args, "from") ?? null;
    const to = optString(args, "to") ?? null;
    const limit = optInt(args, "limit", 1, 50) ?? 10;
    return { ok: true, data: await getTopSellingProducts(ec.tenantId, from, to, limit) };
  },
};

const getDashboardTool: BmsTool = {
  name: "get_dashboard",
  description:
    "Today's overview: total and today's revenue, order count, products running low, orders broken down by status, and top products and customers.",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => ({ ok: true, data: await getDashboard(ec.tenantId) }),
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
    "Create an order and reserve stock atomically from a list of sku, size and quantity. Use once the customer has confirmed the purchase. The sku must come from search_products or check_stock first.",
  surfaces: ["customer", "staff"],
  permission: "order.create",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "Line items.",
        items: {
          type: "object",
          properties: {
            sku: { type: "string" },
            size: { type: "string" },
            qty: { type: "integer" },
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
    const items = reqItems(args);
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
    "Customer surface: never ask for or pass orderId — leave it empty and the latest order for this customer is used automatically. " +
    "Before suggesting or accepting a customer payment method, call get_payment_info and use only a configured channel returned there. " +
    "You must know `method` (the channel they transferred through) before calling. If the customer did not say which configured channel, ask exactly one confirming question first. Never guess.",
  surfaces: ["customer", "staff"],
  permission: "payment.submit",
  inputSchema: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description:
          "Order id. Customer surface may leave it empty (latest order is used automatically); staff surface must provide it.",
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
      const profile = await getStoreProfile(ec.tenantId);
      if (!supportsCustomerPaymentMethod(profile.paymentAccounts, method)) {
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
    if (!orderId) {
      // ฝั่งลูกค้าไม่รู้/ไม่ต้องบอก orderId เอง — resolve เป็นออร์เดอร์ล่าสุดของลูกค้าคนนี้ในช่องทางนี้
      // (pattern เดียวกับ get_order_status ด้านบน) ฝั่งแอดมินต้องระบุมาตรงๆ เสมอ (ไม่เดาแทนแอดมิน)
      if (ec.surface !== "customer" || !ec.customerRef || !ec.channel) {
        return { ok: false, error: "ต้องระบุ orderId" };
      }
      const [latest] = await listCustomerOrderStatuses(ec.tenantId, ec.channel, ec.customerRef, 1);
      if (!latest) return { ok: false, error: "ไม่พบออร์เดอร์ของคุณ" };
      orderId = latest.orderId;
    }
    if (ec.surface === "customer" && !(await customerOwnsOrder(ec, orderId))) {
      return { ok: false, error: "ไม่พบออร์เดอร์นี้ในบัญชีของคุณ" };
    }
    const amount = typeof args.amount === "number" ? args.amount : undefined;
    const r = await submitPayment({
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
      ec.surface === "staff" ? ec.ctx?.admin?.id ?? null : null
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
    const r = await receivePurchaseOrder(ec.tenantId, poId, items, ec.actor);
    if (r.status === "RECEIVED" || r.status === "PARTIAL") {
      await auditWrite(ec, "purchase.receive", poId, { status: r.status });
    }
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
  searchProducts,
  browseCatalogTool,
  listNewArrivalsTool,
  findAlternativesTool,
  getProduct,
  checkStockTool,
  subscribeRestockNotificationTool,
  listCustomerCouponsTool,
  listAvailableCouponsTool,
  checkCouponTool,
  getOrderStatus,
  getCustomerCheckoutTool,
  listLowStockTool,
  getInventorySummaryTool,
  getSalesSummaryTool,
  getTopProductsTool,
  getDashboardTool,
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
