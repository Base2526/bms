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
  type ToolResult,
  enumVal,
  optInt,
  optString,
  reqInt,
  reqItems,
  reqString,
} from "./types";

import { listProducts, listVariants, listProductImages, listLowStock } from "../products";
import { checkStock } from "../stock";
import {
  createOrder,
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
import { listCustomers, getCustomer, customerOrders, upsertCustomer, setCustomerTags } from "../customers";
import { getSalesSummary, getInventorySummary, getTopSellingProducts } from "../reports";
import { getDashboard } from "../dashboard";
import { assignConversation, setConversationStatus, setConversationTags, addNote, getConversation, listMessages } from "../inbox";
import { getStoreProfile, estimateShipping } from "../storeProfile";
import { getTenantName } from "../platform";
import { generateInvoice, generateQuotation } from "../documents";
import { forecastDemand, predictStockOut, suggestPurchaseOrder } from "../forecast";
import { understand } from "../nlu";

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

// =============================================================
// A1 — read-only
// =============================================================

const searchProducts: BmsTool = {
  name: "search_products",
  description: "ค้นหาสินค้าจากคำค้น (ชื่อ/keyword/หมวดหมู่) คืนรายการ sku/ชื่อ/ราคา ใช้เมื่อลูกค้าถามว่ามีสินค้าอะไรบ้าง",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "คำค้น เช่นชื่อรุ่น/แบรนด์" },
      category: { type: "string", description: "หมวดหมู่ (ถ้ามี)" },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const search = optString(args, "keyword");
    const category = optString(args, "category") ?? null;
    const { items, total } = await listProducts(ec.tenantId, { search, category, limit: 10 });
    return {
      ok: true,
      data: {
        total,
        products: items.map((p) => ({
          sku: p.sku,
          name: p.name,
          price: Number(p.price),
          category: p.category,
          brand: p.brand,
          active: p.active,
        })),
      },
    };
  },
};

const getProduct: BmsTool = {
  name: "get_product",
  description: "ดูรายละเอียดสินค้า 1 ตัวจาก sku พร้อมไซซ์+สต็อกคงเหลือของแต่ละไซซ์",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  inputSchema: {
    type: "object",
    properties: { sku: { type: "string", description: "รหัสสินค้า sku" } },
    required: ["sku"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const sku = reqString(args, "sku");
    const { items } = await listProducts(ec.tenantId, { search: sku, limit: 5 });
    const p = items.find((x) => x.sku === sku) ?? items[0];
    if (!p) return { ok: false, error: `ไม่พบสินค้า sku ${sku}` };
    const variants = await listVariants(ec.tenantId, p.sku);
    const images = await listProductImages(ec.tenantId, p.sku);
    return {
      ok: true,
      data: {
        sku: p.sku,
        name: p.name,
        price: Number(p.price),
        description: p.description,
        category: p.category,
        brand: p.brand,
        active: p.active,
        images: images.map((im) => im.url).filter(Boolean),
        variants: variants.map((v) => ({
          size: v.size,
          available: Math.max(0, v.current_stock - v.reserved_stock),
        })),
      },
    };
  },
};

const checkStockTool: BmsTool = {
  name: "check_stock",
  description: "เช็คสต็อก+ราคาของสินค้าตามชื่อ/ไซซ์ ใช้เมื่อลูกค้าถามว่า 'มีไหม/เหลือกี่ชิ้น/ราคาเท่าไหร่'",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  inputSchema: {
    type: "object",
    properties: {
      product: { type: "string", description: "ชื่อ/คำค้นสินค้า" },
      size: { type: "string", description: "ไซซ์ (ถ้าลูกค้าระบุ)" },
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

const getOrderStatus: BmsTool = {
  name: "get_order_status",
  description:
    "ดูสถานะออร์เดอร์ ฝั่งลูกค้า: คืนออร์เดอร์ล่าสุดของลูกค้าคนนี้ (ไม่ต้องส่ง orderId) · ฝั่งแอดมิน: ส่ง orderId เพื่อดู journey เต็ม",
  surfaces: ["customer", "staff"],
  permission: "order.view",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string", description: "รหัสออร์เดอร์ (แอดมินเท่านั้น)" } },
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

const listLowStockTool: BmsTool = {
  name: "list_low_stock",
  description: "รายการสินค้าที่สต็อกต่ำกว่าจุดสั่งซื้อ (reorder point) — สำหรับแอดมินวางแผนสั่งของ",
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
  description: "สรุปภาพรวมคลัง: จำนวน sku/ไซซ์, หน่วยรวม/จอง/พร้อมขาย, มูลค่าสต็อก, จำนวนสินค้าต่ำ/หมด",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => ({ ok: true, data: await getInventorySummary(ec.tenantId) }),
};

const getSalesSummaryTool: BmsTool = {
  name: "get_sales_summary",
  description: "สรุปยอดขายตามช่วงวัน (default 30 วันล่าสุด) รายได้นับเฉพาะ PAID ขึ้นไป",
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
  description: "สินค้าขายดีตามช่วงวัน (ยอดขาย/จำนวนชิ้น)",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "integer", description: "จำนวนอันดับ (default 10)" },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const from = optString(args, "from") ?? null;
    const to = optString(args, "to") ?? null;
    const limit = optInt(args, "limit") ?? 10;
    return { ok: true, data: await getTopSellingProducts(ec.tenantId, from, to, limit) };
  },
};

const getDashboardTool: BmsTool = {
  name: "get_dashboard",
  description: "ภาพรวมวันนี้: รายได้รวม/วันนี้, จำนวนออร์เดอร์, สินค้าใกล้หมด, ออร์เดอร์แยกสถานะ, สินค้า/ลูกค้าเด่น",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => ({ ok: true, data: await getDashboard(ec.tenantId) }),
};

const getCustomerTool: BmsTool = {
  name: "get_customer",
  description: "ดูข้อมูลลูกค้า 1 คนจาก customerId (ยอดซื้อสะสม/จำนวนออร์เดอร์/แท็ก/โน้ต)",
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
  description: "ค้นหาลูกค้าจากชื่อ/เบอร์โทร",
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
  description: "รายการออร์เดอร์ทั้งหมดของลูกค้า 1 คนจาก customerId",
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
  description: "ค้นหา/ดูรายการการจัดส่ง (กรองด้วย orderId/สถานะได้)",
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
  description: "ข้อมูลสำหรับพิมพ์ใบปะหน้าพัสดุ (ผู้รับ/ที่อยู่/รายการ) จาก shipmentId",
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
  description: "ค้นหา/ดูรายการชำระเงิน (กรองด้วย orderId/สถานะได้)",
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
  description: "ค้นหา/ดูใบสั่งซื้อ (PO) ของร้าน",
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
  description: "ดูรายละเอียดใบสั่งซื้อ 1 ใบจาก poId",
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
  description: "รายชื่อซัพพลายเออร์ + ประวัติสั่งซื้อ",
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
    "สร้างออร์เดอร์ + จองสต็อก (atomic) จากรายการ sku+ไซซ์+จำนวน ใช้เมื่อลูกค้ายืนยันจะสั่งซื้อ ต้องมี sku จาก search_products/check_stock ก่อน",
  surfaces: ["customer", "staff"],
  permission: "order.create",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "รายการสินค้า",
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
      channel: { type: "string", description: "ช่องทาง (แอดมินเท่านั้น, default web)" },
      customerRef: { type: "string", description: "อ้างอิงลูกค้า (แอดมินเท่านั้น)" },
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
    const r = await createOrder({
      tenantId: ec.tenantId,
      channel,
      customerRef,
      items,
      editorId: ec.surface === "staff" ? ec.ctx?.admin?.id ?? null : null,
    });
    if (r.status === "CREATED") {
      await auditWrite(ec, "order.create", r.orderId, { itemCount: items.length, total: r.total });
    }
    return { ok: true, data: r };
  },
};

const submitPaymentTool: BmsTool = {
  name: "submit_payment",
  description:
    "บันทึกการแจ้งชำระเงิน (สถานะ PENDING — ยังไม่ยืนยันเงินเข้า ต้องให้แอดมินตรวจสลิปก่อน) ใช้เมื่อลูกค้าแจ้งว่าโอนแล้ว",
  surfaces: ["customer", "staff"],
  permission: "payment.submit",
  inputSchema: {
    type: "object",
    properties: {
      orderId: { type: "string" },
      method: { type: "string", enum: PAYMENT_METHODS as unknown as string[] },
      amount: { type: "number", description: "ยอดที่โอน (เว้นได้ = ยอดรวมออร์เดอร์)" },
      slipRef: { type: "string", description: "เลขอ้างอิง/เลขที่ธุรกรรม" },
      note: { type: "string" },
    },
    required: ["orderId", "method"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const orderId = reqString(args, "orderId");
    if (ec.surface === "customer" && !(await customerOwnsOrder(ec, orderId))) {
      return { ok: false, error: "ไม่พบออร์เดอร์นี้ในบัญชีของคุณ" };
    }
    const method = enumVal(args, "method", PAYMENT_METHODS)!;
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
  description: "สั่งซื้อซ้ำจากออร์เดอร์เก่า (จองสต็อกใหม่ ใช้ราคาปัจจุบัน) ใช้เมื่อลูกค้าบอก 'สั่งเหมือนเดิม'",
  surfaces: ["customer", "staff"],
  permission: "order.create",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string", description: "รหัสออร์เดอร์เดิมที่จะสั่งซ้ำ" } },
    required: ["orderId"],
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const orderId = reqString(args, "orderId");
    if (ec.surface === "customer" && !(await customerOwnsOrder(ec, orderId))) {
      return { ok: false, error: "ไม่พบออร์เดอร์นี้ในบัญชีของคุณ" };
    }
    const r = await reorderFromOrder(
      ec.tenantId,
      orderId,
      ec.surface === "staff" ? ec.ctx?.admin?.id ?? null : null
    );
    if ((r as any).status === "CREATED") {
      await auditWrite(ec, "order.create", (r as any).orderId, { reorderFrom: orderId });
    }
    return { ok: true, data: r };
  },
};

const createShipmentTool: BmsTool = {
  name: "create_shipment",
  description: "สร้างการจัดส่ง + ผูก carrier/tracking แล้วส่งจริง (order PACKING → SHIPPED + ตัดสต็อก)",
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
  description: "อัปเดตเลขพัสดุ/carrier ของการจัดส่ง",
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
  description: "เปลี่ยนสถานะการจัดส่ง (DELIVERED จะ complete ออร์เดอร์ให้)",
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
  description: "สร้างใบสั่งซื้อ (PO) จากซัพพลายเออร์ (ยังไม่ขยับสต็อกจนกว่าจะ receive)",
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
  description: "รับของเข้าสต็อกจากใบสั่งซื้อ (บางส่วน/ครบ) → เพิ่ม current_stock + STOCK_IN",
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
  description: "สร้าง/แก้ไขข้อมูลลูกค้า (ชื่อ/เบอร์/โน้ต/แท็ก) — ส่ง customerId เพื่อแก้ไข, ไม่ส่ง = สร้างใหม่",
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
  description: "ตั้งแท็กของลูกค้า (แทนที่ชุดเดิมทั้งหมด)",
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
  description: "มอบหมายแชทให้ staff คนหนึ่ง (staff หลัก)",
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
  description: "เปลี่ยนสถานะแชท (OPEN/PENDING/CLOSED)",
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
  description: "ตั้งแท็กของแชท (แทนที่ชุดเดิม)",
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
  description: "เพิ่มโน้ตภายในของแชท (ลูกค้าไม่เห็น)",
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
    "ให้ AI ตรวจสลิป (OCR/vision) เทียบยอด — แนะนำเท่านั้น ไม่เปลี่ยนสถานะเงิน แอดมินยังต้องกดยืนยันเอง",
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
    description: cfg.description + " (ต้องให้มนุษย์กดยืนยันก่อนเสมอ — ทูลนี้แค่เสนอ ไม่ทำทันที)",
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
    description: "ยืนยันการชำระเงิน (PENDING → CONFIRMED + order → PAID)",
    mutation: "bmsConfirmPayment",
    permission: "payment.confirm",
    inputSchema: idSchema("paymentId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `ยืนยันการชำระเงิน #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "reject_payment",
    description: "ปฏิเสธการชำระเงิน (PENDING → REJECTED)",
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
    description: "คืนเงิน (CONFIRMED → REFUNDED)",
    mutation: "bmsRefundPayment",
    permission: "payment.refund",
    inputSchema: idSchema("paymentId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `คืนเงินการชำระ #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "cancel_order",
    description: "ยกเลิกออร์เดอร์ (PENDING/PAID/PACKING → CANCELLED, คืน reserved)",
    mutation: "bmsCancelOrder",
    permission: "order.cancel",
    inputSchema: idSchema("orderId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `ยกเลิกออร์เดอร์ #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "return_order",
    description: "คืนสินค้า (SHIPPED/COMPLETED → RETURNED, คืนสต็อก)",
    mutation: "bmsReturnOrder",
    permission: "order.return",
    inputSchema: idSchema("orderId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `คืนสินค้าออร์เดอร์ #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "adjust_stock",
    description: "ปรับสต็อก (บวก/ลบ) ของ sku+ไซซ์",
    mutation: "bmsAdjustStock",
    permission: "stock.adjust",
    inputSchema: {
      type: "object",
      properties: {
        sku: { type: "string" },
        size: { type: "string" },
        delta: { type: "integer", description: "จำนวนที่ปรับ (+เพิ่ม / -ลด)" },
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
    description: "ผสานลูกค้าซ้ำ (ย้ายทุกอย่างจาก mergeId ไป keepId แล้วลบ mergeId — ย้อนไม่ได้)",
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
    description: "ยกเลิกใบสั่งซื้อ (OPEN/PARTIAL → CANCELLED)",
    mutation: "bmsCancelPurchaseOrder",
    permission: "purchase.cancel",
    inputSchema: idSchema("poId"),
    buildArgs: (a) => ({ id: reqString(a, "id") }),
    summary: (a) => `ยกเลิกใบสั่งซื้อ #${String(a.id).slice(0, 8)}`,
  }),
  proposalTool({
    name: "cancel_shipment",
    description: "ยกเลิกการจัดส่ง",
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
  description: "ข้อมูลร้าน: ชื่อ/รายละเอียด/ที่อยู่/เบอร์โทร/เวลาเปิด-ปิด/นโยบายจัดส่ง-คืนสินค้า ใช้ตอบคำถามทั่วไปของลูกค้า",
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
        about: p.about, address: p.address, phone: p.phone,
        contactEmail: p.contactEmail, website: p.website,
        country: p.country, timezone: p.timezone,
        businessHours: p.businessHours, shippingPolicy: p.shippingPolicy, returnPolicy: p.returnPolicy,
      },
    };
  },
};

const getPaymentInfoTool: BmsTool = {
  name: "get_payment_info",
  description: "ช่องทาง/บัญชีรับชำระเงินของร้าน (โอนธนาคาร/พร้อมเพย์) ใช้เมื่อลูกค้าถามว่าโอนเข้าบัญชีไหน",
  surfaces: ["customer", "staff"],
  inputSchema: { type: "object", properties: {} },
  execute: async (_args, ec): Promise<ToolResult> => {
    const p = await getStoreProfile(ec.tenantId);
    return { ok: true, data: { paymentAccounts: p.paymentAccounts } };
  },
};

const getShippingEstimateTool: BmsTool = {
  name: "get_shipping_estimate",
  description: "ประเมินค่าส่ง/ระยะเวลาจัดส่งโดยประมาณจากที่ร้านตั้งไว้ (ส่งยอดสั่งซื้อมาด้วยเพื่อเช็คโปรส่งฟรี)",
  surfaces: ["customer", "staff"],
  inputSchema: {
    type: "object",
    properties: { subtotal: { type: "number", description: "ยอดสั่งซื้อ (ถ้ามี — ใช้เช็คส่งฟรี)" } },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const subtotal = typeof args.subtotal === "number" ? args.subtotal : null;
    return { ok: true, data: await estimateShipping(ec.tenantId, subtotal) };
  },
};

// =============================================================
// B2 — documents: invoice / quotation (staff)
// =============================================================

const generateInvoiceTool: BmsTool = {
  name: "generate_invoice",
  description: "สร้างใบแจ้งหนี้/ใบเสร็จจากออร์เดอร์จริง (รายการ + ยอด snapshot) จาก orderId",
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
  description: "สร้างใบเสนอราคาจากรายการสินค้า (ตีราคาปัจจุบัน + ค่าส่งประเมิน ยังไม่ผูกออร์เดอร์/ไม่จองสต็อก)",
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
  description: "คาดการณ์ความต้องการสินค้าต่อ sku ในอนาคต (heuristic จากค่าเฉลี่ยยอดขายย้อนหลัง — ไม่ใช่ตัวเลขรับประกัน)",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: {
    type: "object",
    properties: {
      windowDays: { type: "integer", description: "ช่วงข้อมูลย้อนหลัง (default 30)" },
      horizonDays: { type: "integer", description: "คาดการณ์ล่วงหน้ากี่วัน (default 30)" },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const data = await forecastDemand(ec.tenantId, optInt(args, "windowDays") ?? 30, optInt(args, "horizonDays") ?? 30);
    return { ok: true, data };
  },
};

const predictStockOutTool: BmsTool = {
  name: "predict_stockout",
  description: "ประเมินว่าแต่ละไซซ์จะหมดสต็อกในกี่วัน จาก velocity ล่าสุด (heuristic — เรียงเสี่ยงสุดก่อน)",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: { type: "object", properties: { windowDays: { type: "integer" } } },
  execute: async (args, ec): Promise<ToolResult> => {
    const data = await predictStockOut(ec.tenantId, optInt(args, "windowDays") ?? 30);
    return { ok: true, data };
  },
};

const suggestPurchaseOrderTool: BmsTool = {
  name: "suggest_purchase_order",
  description: "เสนอจำนวนที่ควรสั่งซื้อเพื่อให้มีของพอขายตามจำนวนวันที่กำหนด (heuristic — ต้องรีวิวก่อนสั่งจริง)",
  surfaces: ["staff"],
  permission: "report.view",
  inputSchema: {
    type: "object",
    properties: {
      windowDays: { type: "integer" },
      coverageDays: { type: "integer", description: "อยากให้มีของพอขายกี่วัน (default 30)" },
    },
  },
  execute: async (args, ec): Promise<ToolResult> => {
    const data = await suggestPurchaseOrder(ec.tenantId, optInt(args, "windowDays") ?? 30, optInt(args, "coverageDays") ?? 30);
    return { ok: true, data };
  },
};

// =============================================================
// B3 — AI-native (data providers — deterministic, ไม่เรียก Claude ซ้ำ)
// =============================================================

const detectLanguageTool: BmsTool = {
  name: "detect_language",
  description: "ตรวจภาษาของข้อความ (th/en/other) แบบ heuristic",
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
  description: "จำแนกเจตนาของข้อความลูกค้า (CHECK_STOCK/CONFIRM_ORDER/GREETING/UNKNOWN) + entities แบบ rule-based",
  surfaces: ["staff"],
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  execute: async (args): Promise<ToolResult> => {
    const u = understand(reqString(args, "text"));
    return { ok: true, data: { intent: u.intent, entities: u.entities } };
  },
};

const summarizeConversationTool: BmsTool = {
  name: "summarize_conversation",
  description: "ดึงข้อความล่าสุดของแชทหนึ่ง (สำหรับสรุป) จาก conversationId",
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
  description: "ดึงสินค้าที่น่าจะแนะนำ: ถ้ามี keyword ค้นตามคำนั้น ไม่งั้นคืนสินค้าขายดี (ให้ผู้ตอบเลือกแนะนำต่อ)",
  surfaces: ["customer", "staff"],
  permission: "product.view",
  inputSchema: { type: "object", properties: { keyword: { type: "string" } } },
  execute: async (args, ec): Promise<ToolResult> => {
    const keyword = optString(args, "keyword");
    if (keyword) {
      const { items } = await listProducts(ec.tenantId, { search: keyword, limit: 8 });
      return {
        ok: true,
        data: { basis: "keyword", candidates: items.map((p) => ({ sku: p.sku, name: p.name, price: Number(p.price) })) },
      };
    }
    const top = await getTopSellingProducts(ec.tenantId, null, null, 8);
    return { ok: true, data: { basis: "top_sellers", candidates: top } };
  },
};

// =============================================================
// send message (staff, sensitive → propose-only) — LINE/Meta only via bmsSendMessage
// =============================================================

const sendCustomerMessageTool: BmsTool = proposalTool({
  name: "send_customer_message",
  description:
    "ส่งข้อความเชิงรุกหาลูกค้าในแชท (เฉพาะช่องทางที่ push ได้ เช่น LINE/Facebook/Instagram — ช่องอื่นจะบันทึกแต่ไม่ push)",
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
  getProduct,
  checkStockTool,
  getOrderStatus,
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
