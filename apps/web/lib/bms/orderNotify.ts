// =============================================================
// Order status notification emails — best-effort, never throws
// -------------------------------------------------------------
// เรียกจากทุก call site ที่เปลี่ยนสถานะ order (GraphQL mutation + REST +
// payment confirm) หลังเปลี่ยนสถานะสำเร็จแล้วเท่านั้น ไม่ block การเปลี่ยน
// สถานะเดิมไม่ว่าอีเมล/SendGrid จะล้มยังไง (เหมือน pattern เดิมของ
// notifyMentionedStaff ใน lib/bms/inbox.ts)
//
// ลูกค้าจำนวนมากมาจาก LINE/chat ไม่มีอีเมลเลย — ไม่มีอีเมล = ข้าม เงียบๆ
// ไม่ใช่ error
// =============================================================

import { query } from "@/lib/db";
import { sendEmail } from "@/lib/mailer";
import { getLatestEmailTemplate, renderEmailTemplate } from "@/lib/emailTemplates";
import { getStoreProfile, DEFAULT_EMAIL_THEME_COLOR } from "./storeProfile";
import { getTenantName } from "./platform";

export type OrderEmailKey = "paid" | "packing" | "shipped" | "completed" | "cancelled" | "returned";

const APP_NAME = process.env.NEXT_PUBLIC_WEB_NAME ?? "BMS";
const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL ?? "";

export async function notifyOrderStatusEmail(
  tenantId: string,
  orderId: string,
  statusKey: OrderEmailKey
): Promise<void> {
  try {
    const orderRes = await query(
      `SELECT o.id, o.total_amount, o.shipping_fee,
              cu.name AS customer_name, cu.email AS customer_email, cu.preferred_language
         FROM bms_orders o
         LEFT JOIN bms_customers cu ON cu.id = o.customer_id
        WHERE o.tenant_id = $1 AND o.id = $2`,
      [tenantId, orderId]
    );
    const order = orderRes.rows[0];
    const customerEmail = order?.customer_email?.trim();
    if (!order || !customerEmail) return; // ไม่มีอีเมล = ข้ามเงียบๆ (ปกติมาก ไม่ใช่ error)

    const itemsRes = await query(
      `SELECT oi.size, oi.qty, oi.unit_price, COALESCE(oi.product_name, p.name) AS product_name
         FROM bms_order_items oi
         JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
        WHERE oi.tenant_id = $1 AND oi.order_id = $2`,
      [tenantId, orderId]
    );

    let trackingNo: string | null = null;
    let carrier: string | null = null;
    if (statusKey === "shipped") {
      const shipRes = await query(
        `SELECT carrier, tracking_no FROM bms_shipments
          WHERE tenant_id = $1 AND order_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [tenantId, orderId]
      );
      trackingNo = shipRes.rows[0]?.tracking_no ?? null;
      carrier = shipRes.rows[0]?.carrier ?? null;
    }

    const [profile, tenantName] = await Promise.all([
      getStoreProfile(tenantId),
      getTenantName(tenantId),
    ]);

    const locale = order.preferred_language === "en" ? "en" : "th";
    const currency = profile.currency || "THB";
    const fmt = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

    const shippingFee = Number(order.shipping_fee ?? 0);
    const amountDue = Number(order.total_amount) + shippingFee;

    const data = {
      app_name: APP_NAME,
      year: new Date().getFullYear(),
      support_url: SUPPORT_URL,
      store_name: tenantName || APP_NAME,
      store_logo_url: profile.logoUrl || null,
      order_ref: String(order.id).slice(0, 8).toUpperCase(),
      customer_name: order.customer_name || "",
      currency,
      subtotal: fmt(order.total_amount),
      shipping_fee: fmt(shippingFee),
      total: fmt(amountDue),
      items: itemsRes.rows.map((r: any) => ({
        name: r.product_name, size: r.size, qty: r.qty,
        line_total: fmt(Number(r.unit_price) * Number(r.qty)),
      })),
      tracking_no: trackingNo,
      carrier,
      theme_color: profile.emailThemeColor || DEFAULT_EMAIL_THEME_COLOR,
      email_footer_text: profile.emailFooterText || null,
    };

    const tpl = await getLatestEmailTemplate(`order.${statusKey}`, locale);
    const rendered = renderEmailTemplate(tpl, data);
    await sendEmail(
      { to: customerEmail, subject: rendered.subject, html: rendered.html, text: rendered.text },
      { tenantId, category: "order", triggeredBy: `orderNotify:${statusKey}` }
    );
  } catch (error) {
    // best-effort — อีเมลล้มเหลวต้องไม่ทำให้การเปลี่ยนสถานะออร์เดอร์ล้มตามไปด้วย
    console.error(`[BMS] order.${statusKey} notification email failed:`, error);
  }
}
