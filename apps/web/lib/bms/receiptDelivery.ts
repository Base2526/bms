// =============================================================
// BMS — ส่งใบเสร็จให้ลูกค้าทางอีเมล / LINE (8.6)
// -------------------------------------------------------------
// ก่อนหน้านี้ใบเสร็จออกได้ทางเดียวคือพิมพ์กระดาษ · ลูกค้าที่ไม่รับกระดาษ (หรือร้าน
// ที่กระดาษหมด) ไม่มีทางได้หลักฐานการซื้อเลย ทั้งที่ระบบมีทั้ง mailer และ LINE
// เชื่อมอยู่แล้ว
//
// สองเรื่องที่ตั้งใจทำแบบนี้:
//
// 1. **อ่านตัวเลขจากเอกสารที่ออกไปแล้ว ไม่คำนวณใหม่**
//    ใบกำกับภาษีอย่างย่อเก็บฐาน/VAT/ยอดยกเว้นของตัวเองไว้บนแถวมันเอง (7.88)
//    ถ้าประกอบใบเสร็จด้วยการคิด total × 7/107 ใหม่ บิลที่มีสินค้ายกเว้น VAT ปน
//    จะได้ตัวเลขไม่ตรงกับที่ยื่นสรรพากร — ลูกค้าถือหลักฐานที่ขัดกับเอกสารจริง
//
// 2. **ส่งไม่สำเร็จต้องไม่ทำให้การขายเสีย**
//    การขายจบไปแล้วตอนกดรับเงิน · อีเมลเด้งหรือ LINE ล่มเป็นเรื่องของการส่งสำเนา
//    ผู้เรียกจึงได้ผลลัพธ์กลับไปแสดง ไม่ใช่ throw ให้จอขายพัง
// =============================================================

import { query } from "@/lib/db";
import { sendEmail } from "@/lib/mailer";
import { deliverToChannel } from "./inbox";

export type ReceiptDeliveryChannel = "email" | "line";

export type ReceiptDeliveryResult =
  | { status: "SENT"; channel: ReceiptDeliveryChannel; to: string }
  | { status: "NO_RECIPIENT"; reason: string }
  | { status: "NOT_FOUND" }
  | { status: "FAILED"; reason: string };

type ReceiptData = {
  orderId: string;
  docNo: string | null;
  soldAt: string;
  total: number;
  storeName: string | null;
  taxId: string | null;
  vat: { rate: number; taxable: number; exempt: number; vat: number; rounding: number } | null;
  lines: Array<{ name: string; size: string | null; qty: number; amount: number }>;
  discountTotal: number;
  customerEmail: string | null;
  customerLineId: string | null;
  customerName: string | null;
};

async function loadReceipt(tenantId: string, orderId: string): Promise<ReceiptData | null> {
  const head = await query<any>(
    `SELECT o.id, o.total_amount, o.shipping_fee, o.discount_amount, o.created_at,
            COALESCE((SELECT SUM(extra.qty * extra.unit_amount)
                        FROM bms_order_extra_lines extra
                       WHERE extra.tenant_id = o.tenant_id AND extra.order_id = o.id), 0) AS extra_total,
            d.doc_no, d.vat_rate, d.taxable_amount, d.exempt_amount, d.vat_amount, d.rounding_amount,
            sp.store_name, sp.tax_id,
            c.email AS customer_email, c.name AS customer_name,
            -- LINE id อยู่ที่ bms_customer_identities ไม่ใช่คอลัมน์บน bms_customers
            -- (7.74 แยก identity ต่อช่องทางออกมา — ลูกค้าคนเดียวมีได้หลายช่องทาง)
            -- เลือกอันล่าสุดเพราะลูกค้าอาจเคยผูก LINE หลายบัญชี
            (SELECT ci.external_ref FROM bms_customer_identities ci
              WHERE ci.tenant_id = o.tenant_id AND ci.customer_id = o.customer_id
                AND ci.channel = 'line'
              ORDER BY ci.updated_at DESC NULLS LAST, ci.created_at DESC
              LIMIT 1) AS customer_line_id
       FROM bms_orders o
       LEFT JOIN bms_tax_documents d
         ON d.tenant_id = o.tenant_id AND d.order_id = o.id
        AND d.doc_type = 'ABBREVIATED' AND d.cancelled_at IS NULL
       LEFT JOIN bms_store_profile sp ON sp.tenant_id = o.tenant_id
       LEFT JOIN bms_customers c ON c.tenant_id = o.tenant_id AND c.id = o.customer_id
      WHERE o.tenant_id = $1 AND o.id = $2`,
    [tenantId, orderId]
  );
  const r = head.rows[0];
  if (!r) return null;

  const items = await query<any>(
    `SELECT product_name, size, qty, unit_price, receipt_unit_price, pack_qty, pack_unit_price
       FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2 ORDER BY id`,
    [tenantId, orderId]
  );

  const receiptGross = items.rows.reduce((sum: number, item: any) =>
    sum + Number(item.receipt_unit_price) * Number(item.pack_qty ?? item.qty), 0);
  const productTotalBeforeOrderDiscount = Number(r.total_amount)
    + Number(r.discount_amount ?? 0)
    - Number(r.extra_total ?? 0);
  const pricingDiscount = Math.round(
    Math.max(0, receiptGross - productTotalBeforeOrderDiscount) * 100
  ) / 100;

  return {
    orderId: r.id,
    docNo: r.doc_no ?? null,
    soldAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    total: Number(r.total_amount) + Number(r.shipping_fee ?? 0),
    storeName: r.store_name ?? null,
    taxId: r.tax_id ?? null,
    // ตัวเลขภาษีมาจากเอกสารที่ออกไปแล้วเท่านั้น — ไม่มีเอกสาร = ไม่พิมพ์บล็อก VAT
    vat: r.doc_no
      ? {
          rate: Number(r.vat_rate ?? 0),
          taxable: Number(r.taxable_amount ?? 0),
          exempt: Number(r.exempt_amount ?? 0),
          vat: Number(r.vat_amount ?? 0),
          rounding: Number(r.rounding_amount ?? 0),
        }
      : null,
    discountTotal: Math.round((Number(r.discount_amount ?? 0) + pricingDiscount) * 100) / 100,
    lines: items.rows.map((i: any) => ({
      name: i.product_name,
      size: i.size && i.size !== "-" ? i.size : null,
      qty: Number(i.pack_qty ?? i.qty),
      amount: Number(i.receipt_unit_price) * Number(i.pack_qty ?? i.qty),
    })),
    customerEmail: r.customer_email ?? null,
    customerLineId: r.customer_line_id ?? null,
    customerName: r.customer_name ?? null,
  };
}

const money = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ข้อความล้วน — ใช้กับ LINE และเป็น text ทางเลือกของอีเมล */
function receiptText(data: ReceiptData): string {
  const lines: string[] = [];
  if (data.storeName) lines.push(data.storeName);
  if (data.taxId) lines.push(`เลขประจำตัวผู้เสียภาษี ${data.taxId}`);
  lines.push(data.docNo ? `ใบกำกับภาษีอย่างย่อ ${data.docNo}` : `ใบเสร็จ ${data.orderId.slice(0, 8)}`);
  lines.push(new Date(data.soldAt).toLocaleString("th-TH"));
  lines.push("");
  for (const line of data.lines) {
    lines.push(`${line.qty}× ${line.name}${line.size ? ` (${line.size})` : ""}  ฿${money(line.amount)}`);
  }
  if (data.discountTotal > 0) lines.push(`ส่วนลด −฿${money(data.discountTotal)}`);
  lines.push("");
  lines.push(`รวม ฿${money(data.total)}`);
  if (data.vat) {
    lines.push(`  มูลค่าสินค้าที่เสีย VAT ฿${money(data.vat.taxable - data.vat.vat)}`);
    if (data.vat.exempt > 0) lines.push(`  สินค้ายกเว้น VAT ฿${money(data.vat.exempt)}`);
    lines.push(`  VAT ${data.vat.rate}% ฿${money(data.vat.vat)}`);
    if (data.vat.rounding !== 0) lines.push(`  ปัดเศษเงินสด ฿${money(data.vat.rounding)}`);
  }
  return lines.join("\n");
}

function receiptHtml(data: ReceiptData): string {
  const rows = data.lines
    .map((l) => `<tr><td>${l.qty}× ${escapeHtml(l.name)}${l.size ? ` <small>(${escapeHtml(l.size)})</small>` : ""}</td>`
      + `<td align="right">฿${money(l.amount)}</td></tr>`)
    .join("");
  const vatBlock = data.vat
    ? `<tr><td colspan="2"><hr></td></tr>`
      + `<tr><td>มูลค่าสินค้าที่เสีย VAT</td><td align="right">฿${money(data.vat.taxable - data.vat.vat)}</td></tr>`
      + (data.vat.exempt > 0 ? `<tr><td>สินค้ายกเว้น VAT</td><td align="right">฿${money(data.vat.exempt)}</td></tr>` : "")
      + `<tr><td>VAT ${data.vat.rate}%</td><td align="right">฿${money(data.vat.vat)}</td></tr>`
      + (data.vat.rounding !== 0 ? `<tr><td>ปัดเศษเงินสด</td><td align="right">฿${money(data.vat.rounding)}</td></tr>` : "")
    : "";

  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px">
    ${data.storeName ? `<h2 style="margin:0 0 4px">${escapeHtml(data.storeName)}</h2>` : ""}
    ${data.taxId ? `<div style="font-size:12px;color:#666">เลขประจำตัวผู้เสียภาษี ${escapeHtml(data.taxId)}</div>` : ""}
    <div style="font-size:13px;margin:8px 0">
      ${data.docNo ? `ใบกำกับภาษีอย่างย่อ <strong>${escapeHtml(data.docNo)}</strong>` : `ใบเสร็จ ${data.orderId.slice(0, 8)}`}<br>
      ${new Date(data.soldAt).toLocaleString("th-TH")}
    </div>
    <table style="width:100%;font-size:13px;border-collapse:collapse">
      ${rows}
      ${data.discountTotal > 0 ? `<tr><td>ส่วนลด</td><td align="right">−฿${money(data.discountTotal)}</td></tr>` : ""}
      <tr><td colspan="2"><hr></td></tr>
      <tr><td><strong>รวม</strong></td><td align="right"><strong>฿${money(data.total)}</strong></td></tr>
      ${vatBlock}
    </table>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string
  ));
}

/**
 * ส่งสำเนาใบเสร็จ
 *
 * `to` ที่ส่งมาชนะข้อมูลของลูกค้าในระบบ (พนักงานถามอีเมลปากเปล่าหน้าเคาน์เตอร์เป็น
 * เรื่องปกติ และบิลอาจไม่ผูกลูกค้าเลย) · ไม่บันทึกอีเมลนั้นกลับเข้าโปรไฟล์ลูกค้า
 * โดยอัตโนมัติ — การพิมพ์อีเมลเพื่อรับใบเสร็จใบเดียวไม่ใช่การยินยอมให้เก็บข้อมูล
 */
export async function sendReceipt(input: {
  tenantId: string;
  orderId: string;
  channel: ReceiptDeliveryChannel;
  to?: string | null;
}): Promise<ReceiptDeliveryResult> {
  const data = await loadReceipt(input.tenantId, input.orderId);
  if (!data) return { status: "NOT_FOUND" };

  const explicit = (input.to ?? "").trim();

  if (input.channel === "email") {
    const to = explicit || data.customerEmail || "";
    if (!to) return { status: "NO_RECIPIENT", reason: "บิลนี้ไม่มีอีเมลลูกค้า — พิมพ์อีเมลที่จะส่งไป" };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return { status: "NO_RECIPIENT", reason: "รูปแบบอีเมลไม่ถูกต้อง" };
    }
    try {
      await sendEmail(
        {
          to,
          subject: data.docNo
            ? `ใบเสร็จ ${data.docNo}${data.storeName ? ` — ${data.storeName}` : ""}`
            : `ใบเสร็จการซื้อ${data.storeName ? ` — ${data.storeName}` : ""}`,
          html: receiptHtml(data),
          text: receiptText(data),
        },
        { tenantId: input.tenantId, category: "order" }
      );
      return { status: "SENT", channel: "email", to };
    } catch (e: any) {
      // การขายจบไปแล้ว การส่งสำเนาล้มต้องไม่ทำให้จอขายพัง
      return { status: "FAILED", reason: String(e?.message ?? e) };
    }
  }

  const to = explicit || data.customerLineId || "";
  if (!to) return { status: "NO_RECIPIENT", reason: "ลูกค้ารายนี้ยังไม่ได้ผูก LINE กับร้าน" };
  const ok = await deliverToChannel(input.tenantId, "line", to, receiptText(data));
  return ok
    ? { status: "SENT", channel: "line", to }
    : { status: "FAILED", reason: "ส่ง LINE ไม่สำเร็จ — ตรวจการเชื่อมต่อ LINE ของร้าน" };
}
