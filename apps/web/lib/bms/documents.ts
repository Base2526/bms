// =============================================================
// BMS documents — invoice / quotation (สร้างจาก data เดิม ไม่มี schema ใหม่)
// -------------------------------------------------------------
// invoice = จาก order จริง (รายการ + ยอด snapshot) · quotation = จากรายการ
//   ที่ระบุ ตีราคาปัจจุบันของสินค้า (ยังไม่ผูกออร์เดอร์) — เอกสารเชิงอ้างอิง
//   ไม่ได้ persist (ephemeral) tool generate_invoice/generate_quotation ใช้
// =============================================================

import { query } from "@/lib/db";
import { getStoreProfile, estimateShipping } from "./storeProfile";

export type DocLine = { sku: string; name: string; size: string; qty: number; unitPrice: number; amount: number };
export type StoreSummary = { name: string | null; address: string | null; phone: string | null };

export type BusinessDoc = {
  type: "INVOICE" | "QUOTATION";
  number: string;
  date: string; // ISO
  store: StoreSummary;
  customerRef: string | null;
  channel: string | null;
  lines: DocLine[];
  subtotal: number;
  shippingFee: number | null;
  total: number;
  paymentStatus?: string | null;
  note: string;
};

async function storeSummary(tenantId: string): Promise<StoreSummary> {
  const p = await getStoreProfile(tenantId);
  return { name: p.storeName, address: p.address, phone: p.phone };
}

/** ใบแจ้งหนี้/ใบเสร็จจากออร์เดอร์จริง (ใช้ราคา snapshot ณ ตอนสั่ง) */
export async function generateInvoice(tenantId: string, orderId: string): Promise<BusinessDoc | null> {
  const ord = await query<any>(
    `SELECT id, channel, customer_ref, status, total_amount, created_at
       FROM bms_orders WHERE tenant_id = $1 AND id::text = $2`,
    [tenantId, orderId]
  );
  const o = ord.rows[0];
  if (!o) return null;

  const items = await query<any>(
    `SELECT oi.product_sku, oi.size, oi.qty, oi.unit_price, p.name
       FROM bms_order_items oi
       JOIN bms_products p ON p.sku = oi.product_sku AND p.tenant_id = $1
      WHERE oi.order_id = $2
      ORDER BY oi.product_sku, oi.size`,
    [tenantId, o.id]
  );

  const lines: DocLine[] = items.rows.map((r) => {
    const unitPrice = Number(r.unit_price);
    const qty = Number(r.qty);
    return { sku: r.product_sku, name: r.name ?? r.product_sku, size: r.size, qty, unitPrice, amount: unitPrice * qty };
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
    shippingFee: null, // ระบบยังไม่เก็บค่าส่งแยกต่อออร์เดอร์
    total: Number(o.total_amount),
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
  const lines: DocLine[] = [];
  for (const it of items) {
    const p = await query<{ name: string; price: string }>(
      `SELECT name, price FROM bms_products WHERE tenant_id = $1 AND sku = $2 AND active`,
      [tenantId, it.sku]
    );
    if (p.rowCount === 0) continue; // ข้ามสินค้าที่ไม่พบ/ปิดขาย
    const unitPrice = Number(p.rows[0].price);
    lines.push({ sku: it.sku, name: p.rows[0].name, size: it.size, qty: it.qty, unitPrice, amount: unitPrice * it.qty });
  }
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const est = await estimateShipping(tenantId, subtotal);
  const shippingFee = est.fee;
  const total = subtotal + (shippingFee ?? 0);

  return {
    type: "QUOTATION",
    number: "QT-" + String(Date.now()).slice(-8),
    date: new Date().toISOString(),
    store: await storeSummary(tenantId),
    customerRef: customerRef ?? null,
    channel: null,
    lines,
    subtotal,
    shippingFee,
    total,
    note: "ใบเสนอราคา (ยังไม่ผูกออร์เดอร์/ยังไม่จองสต็อก) ราคาปัจจุบัน อาจเปลี่ยนได้",
  };
}
