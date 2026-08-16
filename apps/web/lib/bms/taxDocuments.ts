// =============================================================
// BMS Tax Documents — ใบกำกับภาษีอย่างย่อ / เต็มรูป / ใบลดหนี้ (7.88)
// -------------------------------------------------------------
// flow ที่ถอดมาจากใบจริงทั้ง 4 ใบ:
//
//   ขายหน้าร้าน → ออกใบย่อทุกบิล (เลขรันต่อเครื่อง)
//        ↓ ลูกค้าขอใบเต็ม (วันไหนก็ได้ ผ่านลิงก์/QR ไม่ต้องกลับมาที่ร้าน)
//   ยกเลิกใบย่อ + ออกใบเต็มที่อ้างอิงเลขใบย่อเดิม
//
// ทุกใบเต็มที่ดูมา (วราภรณ์/KFC/Makro) มีข้อความ "เป็นการยกเลิกใบกำกับภาษี
// อย่างย่อเลขที่ ... และออกใบกำกับภาษีอิเล็กทรอนิกส์ใหม่แทน" → เป็นมาตรฐาน
//
// ⚠️ เลขเอกสารต้องเรียง ห้ามข้าม ห้ามซ้ำ → ตัวนับใช้ UPDATE ... RETURNING
// ในทรานแซกชันเดียวกับการ insert เอกสาร ถ้าทรานแซกชัน rollback เลขจะคืนไปด้วย
// (ยอมให้เลขหายดีกว่าเลขซ้ำ — เลขซ้ำแก้ไม่ได้ เลขหายอธิบายได้)
//
// ⚠️ ไฟล์นี้ไม่ได้ส่งข้อมูลให้กรมสรรพากร — e-Tax Invoice ต้องมีใบรับรอง
// อิเล็กทรอนิกส์และการลงทะเบียนกับสรรพากร เป็นงานแยกต่างหาก
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { computeVat, unresolvedVatSkus, type VatCategory, type VatRounding, type VatSettings } from "./vat";
import { enqueueTaxDocument } from "./etax/queue";

export type TaxDocType = "ABBREVIATED" | "FULL" | "CREDIT_NOTE";

export type TaxDocument = {
  id: string;
  locationId: string;
  orderId: string;
  deviceId: string | null;
  docType: TaxDocType;
  docNo: string;
  issuedAt: string;
  issueDate: string;
  replacesDocumentId: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  buyerName: string | null;
  buyerTaxId: string | null;
  buyerBranchCode: string | null;
  buyerAddress: string | null;
  buyerPhone: string | null;
  taxableAmount: number;
  exemptAmount: number;
  vatAmount: number;
  roundingAmount: number;
  grandTotal: number;
  vatRate: number;
};

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
function toDate(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function mapDoc(r: any): TaxDocument {
  return {
    id: r.id,
    locationId: r.location_id,
    orderId: r.order_id,
    deviceId: r.device_id ?? null,
    docType: r.doc_type,
    docNo: r.doc_no,
    issuedAt: toISO(r.issued_at),
    issueDate: toDate(r.issue_date),
    replacesDocumentId: r.replaces_document_id ?? null,
    cancelledAt: r.cancelled_at ? toISO(r.cancelled_at) : null,
    cancelledReason: r.cancelled_reason ?? null,
    buyerName: r.buyer_name ?? null,
    buyerTaxId: r.buyer_tax_id ?? null,
    buyerBranchCode: r.buyer_branch_code ?? null,
    buyerAddress: r.buyer_address ?? null,
    buyerPhone: r.buyer_phone ?? null,
    taxableAmount: Number(r.taxable_amount),
    exemptAmount: Number(r.exempt_amount),
    vatAmount: Number(r.vat_amount),
    roundingAmount: Number(r.rounding_amount),
    grandTotal: Number(r.grand_total),
    vatRate: Number(r.vat_rate),
  };
}

// ---------------------------------------------------------------
// เลขเอกสาร
// ---------------------------------------------------------------

/**
 * กันเลขถัดไปแบบ atomic — UPDATE ... RETURNING ล็อกแถวตัวนับให้เอง
 * สองเครื่องยิงพร้อมกันจะได้คนละเลขเสมอ
 */
async function nextSequenceInTx(
  client: PoolClient,
  args: { tenantId: string; locationId: string; deviceId: string | null; docType: TaxDocType; periodKey: string }
): Promise<number> {
  const { tenantId, locationId, deviceId, docType, periodKey } = args;

  const upd = await client.query<{ next_seq: string }>(
    `UPDATE bms_document_counters
        SET next_seq = next_seq + 1, updated_at = now()
      WHERE tenant_id = $1 AND location_id = $2 AND doc_type = $4 AND period_key = $5
        AND device_id IS NOT DISTINCT FROM $3::uuid
      RETURNING next_seq - 1 AS next_seq`,
    [tenantId, locationId, deviceId, docType, periodKey]
  );
  if (upd.rowCount) return Number(upd.rows[0].next_seq);

  const ins = await client.query<{ next_seq: string }>(
    `INSERT INTO bms_document_counters (tenant_id, location_id, device_id, doc_type, period_key, next_seq)
     VALUES ($1, $2, $3, $4, $5, 2)
     RETURNING 1 AS next_seq`,
    [tenantId, locationId, deviceId, docType, periodKey]
  );
  return Number(ins.rows[0].next_seq);
}

/**
 * ประกอบเลขเอกสาร: prefix + ปี(2หลัก) + เดือน + วัน + ลำดับ 4 หลัก
 * เลียนแบบใบวราภรณ์ (2512010004 = 25/12/01 ลำดับ 0004) เป็นค่าเริ่มต้น
 * ร้านที่มีรูปแบบของตัวเองตั้ง receipt_prefix ทับได้ และคอลัมน์เก็บเป็น TEXT
 * เพราะของจริงมีทั้ง KFC2522205 และ 006/8731
 */
function buildDocNo(prefix: string | null, date: Date, seq: number, era: "BE" | "CE"): string {
  const year = (era === "BE" ? date.getFullYear() + 543 : date.getFullYear()) % 100;
  const stamp = `${String(year).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `${prefix ?? ""}${stamp}${String(seq).padStart(4, "0")}`;
}

// ---------------------------------------------------------------
// อ่านค่าตั้งภาษี + บรรทัดของบิล
// ---------------------------------------------------------------

export type TenantVatSettings = VatSettings & {
  calendarEra: "BE" | "CE";
  abbreviatedApproved: boolean;
};

export async function getVatSettings(tenantId: string): Promise<TenantVatSettings> {
  const res = await query<any>(
    `SELECT vat_registered, price_includes_vat, vat_rate, vat_rounding, calendar_era,
            abbreviated_tax_invoice_approved
       FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  const r = res.rows[0];
  return {
    vatRegistered: r?.vat_registered ?? false,
    priceIncludesVat: r?.price_includes_vat ?? true,
    vatRate: r?.vat_rate == null ? 7 : Number(r.vat_rate),
    vatRounding: (r?.vat_rounding ?? "BASE_FIRST") as VatRounding,
    calendarEra: (r?.calendar_era ?? "BE") as "BE" | "CE",
    abbreviatedApproved: r?.abbreviated_tax_invoice_approved ?? false,
  };
}

type OrderLineForVat = { sku: string; amount: number; vatCategory: VatCategory };

/** ส่วนลดทั้งบิล — ต้องนำไปลดฐานภาษีตามสัดส่วน ไม่งั้นใบกำกับยอดเกินเงินที่รับ */
async function loadOrderDiscountInTx(client: PoolClient, tenantId: string, orderId: string): Promise<number> {
  const res = await client.query<{ discount_amount: string }>(
    `SELECT discount_amount FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId]
  );
  return Number(res.rows[0]?.discount_amount ?? 0);
}

async function loadOrderLinesInTx(client: PoolClient, tenantId: string, orderId: string): Promise<OrderLineForVat[]> {
  const res = await client.query<any>(
    `SELECT product_sku,
            vat_category,
            COALESCE(pack_unit_price * pack_qty, unit_price * qty) AS amount
       FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, orderId]
  );
  return res.rows.map((r: any) => ({
    sku: r.product_sku,
    amount: Number(r.amount),
    vatCategory: (r.vat_category ?? "UNKNOWN") as VatCategory,
  }));
}

/**
 * คิด VAT ของบิลแล้วเขียนยอดแยกกลุ่มกลับลง bms_orders
 * เรียกหลังบิลนิ่งแล้ว (ชำระเงินเสร็จ) — ยอดพวกนี้คือสิ่งที่พิมพ์บนเอกสาร
 */
export async function applyOrderVatInTx(
  client: PoolClient,
  tenantId: string,
  orderId: string,
  settings: VatSettings,
  roundingAmount = 0
) {
  const lines = await loadOrderLinesInTx(client, tenantId, orderId);
  const discountAmount = await loadOrderDiscountInTx(client, tenantId, orderId);
  const breakdown = computeVat(lines, settings, { roundingAmount, discountAmount });
  await client.query(
    `UPDATE bms_orders
        SET taxable_amount = $3, exempt_amount = $4, vat_amount = $5,
            rounding_amount = $6, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId, breakdown.taxableAmount, breakdown.exemptAmount,
      breakdown.vatAmount, breakdown.roundingAmount]
  );
  return { breakdown, lines };
}

// ---------------------------------------------------------------
// ออกใบกำกับอย่างย่อ (ทุกบิลหน้าร้าน)
// ---------------------------------------------------------------

export type IssueResult =
  | { status: "ISSUED"; document: TaxDocument }
  | { status: "ALREADY_ISSUED"; document: TaxDocument }
  | { status: "NOT_VAT_REGISTERED" }
  | { status: "VAT_CATEGORY_MISSING"; skus: string[] }
  | { status: "ORDER_NOT_FOUND" };

/**
 * ออกใบย่อให้บิลหน้าร้าน — เรียกในทรานแซกชันเดียวกับที่ปิดการขาย
 * ใบย่อไม่ต้องแยกยอด VAT บนกระดาษ (หัวใบเขียน "VAT Included" พอ) แต่เก็บ
 * ยอดแยกไว้ในฐานข้อมูล เพราะตอนออกใบเต็มแทนต้องใช้
 */
export async function issueAbbreviatedInvoiceInTx(
  client: PoolClient,
  args: {
    tenantId: string;
    orderId: string;
    locationId: string;
    deviceId: string | null;
    issuedBy?: string | null;
    roundingAmount?: number;
    settings: TenantVatSettings;
  }
): Promise<IssueResult> {
  const { tenantId, orderId, locationId, deviceId, settings } = args;

  const existing = await client.query(
    `SELECT * FROM bms_tax_documents
      WHERE tenant_id = $1 AND order_id = $2 AND doc_type = 'ABBREVIATED' AND cancelled_at IS NULL`,
    [tenantId, orderId]
  );
  if (existing.rowCount) return { status: "ALREADY_ISSUED", document: mapDoc(existing.rows[0]) };

  if (!settings.vatRegistered) return { status: "NOT_VAT_REGISTERED" };

  const { breakdown, lines } = await applyOrderVatInTx(
    client, tenantId, orderId, settings, args.roundingAmount ?? 0
  );

  const missing = unresolvedVatSkus(lines);
  if (missing.length > 0) return { status: "VAT_CATEGORY_MISSING", skus: missing };

  const now = new Date();
  const seq = await nextSequenceInTx(client, {
    tenantId, locationId, deviceId, docType: "ABBREVIATED",
    periodKey: String(now.getFullYear()),
  });

  const prefixRes = deviceId
    ? await client.query<{ receipt_prefix: string | null }>(
        `SELECT receipt_prefix FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2`, [tenantId, deviceId]
      )
    : null;

  const docNo = buildDocNo(prefixRes?.rows[0]?.receipt_prefix ?? null, now, seq, settings.calendarEra);

  const res = await client.query(
    `INSERT INTO bms_tax_documents
       (tenant_id, location_id, order_id, device_id, doc_type, doc_no,
        taxable_amount, exempt_amount, vat_amount, rounding_amount, grand_total, vat_rate, issued_by)
     VALUES ($1, $2, $3, $4, 'ABBREVIATED', $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [tenantId, locationId, orderId, deviceId, docNo,
      breakdown.taxableAmount, breakdown.exemptAmount, breakdown.vatAmount,
      breakdown.roundingAmount, breakdown.grandTotal, breakdown.vatRate, args.issuedBy ?? null]
  );
  const issued = mapDoc(res.rows[0]);
  // เข้าคิวด้วย client ตัวเดียวกับที่เพิ่งสร้างเอกสาร — เอกสารยังไม่ commit
  // การใช้ connection อื่นจะชน FK ทุกครั้ง
  // ไม่ .catch() ทิ้ง: บิลที่ตัดสต็อกแล้วแต่ไม่มีร่องรอยว่าต้องนำส่ง
  // คือช่องโหว่ที่หาไม่เจอทีหลัง — ยอม rollback ทั้งบิลดีกว่า
  await enqueueTaxDocument(tenantId, issued.id, client);
  return { status: "ISSUED", document: issued };
}

// ---------------------------------------------------------------
// ลูกค้าขอใบเต็ม → ยกเลิกใบย่อ + ออกใบเต็มแทน
// ---------------------------------------------------------------

export type FullInvoiceBuyer = {
  name: string;
  taxId: string;
  branchCode?: string | null;
  address?: string | null;
  phone?: string | null;
};

export type IssueFullResult =
  | { status: "ISSUED"; document: TaxDocument; cancelledAbbreviated: TaxDocument | null }
  | { status: "ALREADY_ISSUED"; document: TaxDocument }
  | { status: "NOT_VAT_REGISTERED" }
  | { status: "VAT_CATEGORY_MISSING"; skus: string[] }
  | { status: "ORDER_NOT_FOUND" }
  | { status: "BUYER_INCOMPLETE"; reason: string };

/**
 * ออกใบกำกับเต็มรูปแทนใบย่อ — ทั้งสองขั้นอยู่ในทรานแซกชันเดียว
 * ยกเลิกใบย่อแล้วออกใบเต็มไม่สำเร็จ = ลูกค้าเหลือแค่ใบที่ถูกยกเลิกในมือ
 */
export async function issueFullTaxInvoice(args: {
  tenantId: string;
  orderId: string;
  buyer: FullInvoiceBuyer;
  issuedBy?: string | null;
}): Promise<IssueFullResult> {
  const { tenantId, orderId, buyer } = args;
  if (!buyer?.name?.trim()) return { status: "BUYER_INCOMPLETE", reason: "ต้องระบุชื่อผู้ซื้อ" };
  if (!buyer?.taxId?.trim()) return { status: "BUYER_INCOMPLETE", reason: "ต้องระบุเลขประจำตัวผู้เสียภาษี" };

  const settings = await getVatSettings(tenantId);
  if (!settings.vatRegistered) return { status: "NOT_VAT_REGISTERED" };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: args.issuedBy ?? null });

    const ord = await client.query<{ location_id: string }>(
      `SELECT location_id FROM bms_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, orderId]
    );
    if (!ord.rowCount) {
      await client.query("ROLLBACK");
      return { status: "ORDER_NOT_FOUND" };
    }
    const locationId = ord.rows[0].location_id;

    const already = await client.query(
      `SELECT * FROM bms_tax_documents
        WHERE tenant_id = $1 AND order_id = $2 AND doc_type = 'FULL' AND cancelled_at IS NULL`,
      [tenantId, orderId]
    );
    if (already.rowCount) {
      await client.query("ROLLBACK");
      return { status: "ALREADY_ISSUED", document: mapDoc(already.rows[0]) };
    }

    const { breakdown, lines } = await applyOrderVatInTx(client, tenantId, orderId, settings);
    const missing = unresolvedVatSkus(lines);
    if (missing.length > 0) {
      await client.query("ROLLBACK");
      return { status: "VAT_CATEGORY_MISSING", skus: missing };
    }

    // ยกเลิกใบย่อของบิลนี้ (ถ้ามี) แล้วผูกไว้ให้ใบเต็มอ้างอิงกลับ
    const abbr = await client.query(
      `UPDATE bms_tax_documents
          SET cancelled_at = now(),
              cancelled_reason = 'ออกใบกำกับภาษีเต็มรูปแทนตามคำขอของลูกค้า'
        WHERE tenant_id = $1 AND order_id = $2 AND doc_type = 'ABBREVIATED' AND cancelled_at IS NULL
        RETURNING *`,
      [tenantId, orderId]
    );
    const cancelled = abbr.rowCount ? mapDoc(abbr.rows[0]) : null;

    const now = new Date();
    const seq = await nextSequenceInTx(client, {
      tenantId, locationId, deviceId: null, docType: "FULL",
      periodKey: String(now.getFullYear()),
    });
    const docNo = buildDocNo(null, now, seq, settings.calendarEra);

    const res = await client.query(
      `INSERT INTO bms_tax_documents
         (tenant_id, location_id, order_id, doc_type, doc_no, replaces_document_id,
          buyer_name, buyer_tax_id, buyer_branch_code, buyer_address, buyer_phone,
          taxable_amount, exempt_amount, vat_amount, rounding_amount, grand_total, vat_rate, issued_by)
       VALUES ($1, $2, $3, 'FULL', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [tenantId, locationId, orderId, docNo, cancelled?.id ?? null,
        buyer.name.trim(), buyer.taxId.trim(), buyer.branchCode ?? "00000",
        buyer.address ?? null, buyer.phone ?? null,
        breakdown.taxableAmount, breakdown.exemptAmount, breakdown.vatAmount,
        breakdown.roundingAmount, breakdown.grandTotal, breakdown.vatRate,
        args.issuedBy ?? null]
    );

    const full = mapDoc(res.rows[0]);
    await enqueueTaxDocument(tenantId, full.id, client);
    await client.query("COMMIT");
    return { status: "ISSUED", document: full, cancelledAbbreviated: cancelled };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// อ่าน
// ---------------------------------------------------------------

export async function listTaxDocumentsForOrder(tenantId: string, orderId: string): Promise<TaxDocument[]> {
  const res = await query(
    `SELECT * FROM bms_tax_documents
      WHERE tenant_id = $1 AND order_id = $2 ORDER BY issued_at`,
    [tenantId, orderId]
  );
  return res.rows.map(mapDoc);
}

export async function getTaxDocument(tenantId: string, id: string): Promise<TaxDocument | null> {
  const res = await query(`SELECT * FROM bms_tax_documents WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return res.rowCount ? mapDoc(res.rows[0]) : null;
}
