// =============================================================
// BMS documents — invoice / quotation (สร้างจาก data เดิม ไม่มี schema ใหม่)
// -------------------------------------------------------------
// invoice = จาก order จริง (รายการ + ยอด snapshot) · quotation = จากรายการ
//   ที่ระบุ ตีราคาปัจจุบันของสินค้า (ยังไม่ผูกออร์เดอร์) — เอกสารเชิงอ้างอิง
//   ไม่ได้ persist (ephemeral) tool generate_invoice/generate_quotation ใช้
// =============================================================

import { query } from "@/lib/db";
import { getStoreProfile } from "./storeProfile";
import { quoteShipping } from "./shippingRates";
import { getTenantName } from "./platform";
import { getVariantBasePrice } from "./productPacks";
import { priceLinesByQty } from "./pricing";
import { listPriceTiersForSkus } from "./products";

export type DocLine = { sku: string; name: string; size: string; qty: number; unitPrice: number; amount: number };
export type StoreSummary = { name: string | null; address: string | null; phone: string | null; taxId: string | null };

export type BusinessDoc = {
  type: "INVOICE" | "QUOTATION";
  number: string;
  date: string; // ISO
  store: StoreSummary;
  customerRef: string | null;
  channel: string | null;
  lines: DocLine[];
  subtotal: number;
  discount: number;
  couponCode: string | null;
  shippingFee: number | null;
  total: number;
  paymentStatus?: string | null;
  note: string;
};

async function storeSummary(tenantId: string): Promise<StoreSummary> {
  const p = await getStoreProfile(tenantId);
  // ชื่อร้าน = bms_tenants.name (ชื่อเดียวทั้งระบบ)
  const name = await getTenantName(tenantId);
  return { name, address: p.address, phone: p.phone, taxId: p.taxId };
}

/** ใบแจ้งหนี้/ใบเสร็จจากออร์เดอร์จริง (ใช้ราคา snapshot ณ ตอนสั่ง) */
export async function generateInvoice(tenantId: string, orderId: string): Promise<BusinessDoc | null> {
  const ord = await query<any>(
    `SELECT id, channel, customer_ref, status, total_amount, discount_amount, coupon_code, shipping_fee, created_at
       FROM bms_orders WHERE tenant_id = $1 AND id::text = $2`,
    [tenantId, orderId]
  );
  const o = ord.rows[0];
  if (!o) return null;

  const items = await query<any>(
    `SELECT oi.product_sku, oi.size, oi.qty, oi.unit_price, COALESCE(oi.product_name, p.name) AS product_name
       FROM bms_order_items oi
       JOIN bms_products p ON p.sku = oi.product_sku AND p.tenant_id = $1
      WHERE oi.order_id = $2
      ORDER BY oi.product_sku, oi.size`,
    [tenantId, o.id]
  );

  const lines: DocLine[] = items.rows.map((r) => {
    const unitPrice = Number(r.unit_price);
    const qty = Number(r.qty);
    return { sku: r.product_sku, name: r.product_name ?? r.product_sku, size: r.size, qty, unitPrice, amount: unitPrice * qty };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);

  return {
    type: "INVOICE",
    number: String(o.id).slice(0, 8).toUpperCase(),
    date: new Date(o.created_at).toISOString(),
    store: await storeSummary(tenantId),
    customerRef: o.customer_ref ?? null,
    channel: o.channel ?? null,
    lines,
    subtotal,
    discount: Number(o.discount_amount ?? 0),
    couponCode: o.coupon_code ?? null,
    // ค่าส่งเก็บจริงต่อออร์เดอร์แล้วตั้งแต่ 7.47 · total ของเอกสาร = ยอดที่ลูกค้าต้องจ่าย
    // (bms_orders.total_amount ยังหมายถึงค่าสินค้า−ส่วนลด ไม่รวมค่าส่ง)
    shippingFee: Number(o.shipping_fee ?? 0),
    total: Number(o.total_amount) + Number(o.shipping_fee ?? 0),
    paymentStatus: o.status,
    note: "ยอดรวมอ้างอิงจากออร์เดอร์จริง (ราคา ณ ตอนสั่ง)",
  };
}

/** ใบเสนอราคาจากรายการที่ระบุ — ตีราคาปัจจุบันของสินค้า (สินค้าต้อง active) */
export async function generateQuotation(
  tenantId: string,
  items: Array<{ sku: string; size: string; qty: number }>,
  customerRef?: string | null
): Promise<BusinessDoc> {
  const candidates: Array<{
    sku: string;
    name: string;
    size: string;
    qty: number;
    basePrice: number;
  }> = [];
  for (const it of items) {
    const p = await query<{ name: string }>(
      `SELECT p.name FROM bms_products p
        WHERE p.tenant_id = $1 AND p.sku = $2 AND p.active
          AND EXISTS (
            SELECT 1 FROM bms_inventory i
             WHERE i.tenant_id = p.tenant_id AND i.product_sku = p.sku AND i.size = $3
          )`,
      [tenantId, it.sku, it.size]
    );
    if (p.rowCount === 0) continue; // ข้ามสินค้าที่ไม่พบ/ปิดขาย
    const unitPrice = await getVariantBasePrice(tenantId, it.sku, it.size);
    if (unitPrice == null) continue;
    candidates.push({
      sku: it.sku,
      name: p.rows[0].name,
      size: it.size,
      qty: it.qty,
      basePrice: unitPrice,
    });
  }
  const skus = Array.from(new Set(candidates.map((line) => line.sku)));
  const basePriceByVariant = new Map(
    candidates.map((line) => [`${line.sku}\u0000${line.size}`, line.basePrice])
  );
  const tiersBySku = await listPriceTiersForSkus(tenantId, skus);
  const lines: DocLine[] = priceLinesByQty(candidates, basePriceByVariant, tiersBySku).map((line) => ({
    sku: line.sku,
    name: line.name,
    size: line.size,
    qty: line.qty,
    unitPrice: line.unitPrice,
    amount: Math.round(line.unitPrice * line.qty * 100) / 100,
  }));
  const subtotal = Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  // ใบเสนอราคายังไม่รู้ปลายทาง → ได้เรตเหมา/เรตที่คิดได้จากน้ำหนักเท่านั้น
  const est = await quoteShipping({
    tenantId,
    subtotal,
    items: lines.map((l) => ({ sku: l.sku, qty: l.qty })),
  });
  const shippingFee = est.fee;
  const total = Math.round((subtotal + (shippingFee ?? 0)) * 100) / 100;

  return {
    type: "QUOTATION",
    number: "QT-" + String(Date.now()).slice(-8),
    date: new Date().toISOString(),
    store: await storeSummary(tenantId),
    customerRef: customerRef ?? null,
    channel: null,
    lines,
    subtotal,
    discount: 0,
    couponCode: null,
    shippingFee,
    total,
    note: "ใบเสนอราคา (ยังไม่ผูกออร์เดอร์/ยังไม่จองสต็อก) ใช้ราคาปัจจุบันและราคาส่งตามจำนวน อาจเปลี่ยนได้",
  };
}
