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
import { bahtText, computeVat, unresolvedVatSkus, type VatCategory, type VatRounding, type VatSettings } from "./vat";
import { cashRoundingDelta, isCashRounding, type CashRounding } from "@/lib/pos/cashRounding";
import { invalidateStoreProfileCache } from "./storeProfile";
import { cancelQueuedTaxDocumentInTx, enqueueTaxDocument } from "./etax/queue";
import {
  abbreviatedInvoicePrefix,
  buildTaxDocNo,
  creditNotePrefix,
  fullInvoicePrefix,
  taxClockOf,
  type TaxClock,
  type TaxDocLocation,
} from "./taxDocumentNumber";
import { isValidThaiTaxId } from "./thaiTaxId";

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
  sellerName: string | null;
  sellerTaxId: string | null;
  sellerBranchCode: string | null;
  sellerAddress: string | null;
  sellerPhone: string | null;
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
/**
 * `pg` คืนคอลัมน์ DATE เป็น Date ตอนเที่ยงคืน "เวลาท้องถิ่นของเครื่อง"
 * `.toISOString()` จึงถอยไป 1 วันบนเครื่องที่อยู่ตะวันออกของ UTC (เช่นเครื่องในไทย)
 * ต้องอ่านจากส่วนประกอบท้องถิ่น ไม่ใช่ UTC
 */
export function pgDateToIso(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return String(v).slice(0, 10);
}
const toDate = pgDateToIso;

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
    sellerName: r.seller_name ?? null,
    sellerTaxId: r.seller_tax_id ?? null,
    sellerBranchCode: r.seller_branch_code ?? null,
    sellerAddress: r.seller_address ?? null,
    sellerPhone: r.seller_phone ?? null,
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
 * กันเลขถัดไปแบบ atomic — UPSERT ผูกกับ partial unique index ที่ตรงกับ device_id
 * สองทรานแซกชันที่สร้าง counter แถวแรกพร้อมกันจึงได้คนละเลขและไม่ชน 23505
 */
async function nextSequenceInTx(
  client: PoolClient,
  args: { tenantId: string; locationId: string; deviceId: string | null; docType: TaxDocType; periodKey: string }
): Promise<number> {
  const { tenantId, locationId, deviceId, docType, periodKey } = args;

  // 7.88 has two partial unique indexes because device_id may be NULL. Name the
  // matching predicate in each UPSERT so PostgreSQL can infer the real arbiter;
  // UPDATE-then-INSERT allowed two first issuers to race into 23505.
  const result = deviceId == null
    ? await client.query<{ next_seq: string }>(
        `INSERT INTO bms_document_counters
           (tenant_id, location_id, device_id, doc_type, period_key, next_seq)
         VALUES ($1,$2,NULL,$3,$4,2)
         ON CONFLICT (tenant_id, location_id, doc_type, period_key) WHERE device_id IS NULL
         DO UPDATE SET next_seq = bms_document_counters.next_seq + 1, updated_at = now()
         RETURNING next_seq - 1 AS next_seq`,
        [tenantId, locationId, docType, periodKey]
      )
    : await client.query<{ next_seq: string }>(
        `INSERT INTO bms_document_counters
           (tenant_id, location_id, device_id, doc_type, period_key, next_seq)
         VALUES ($1,$2,$3,$4,$5,2)
         ON CONFLICT (tenant_id, location_id, device_id, doc_type, period_key) WHERE device_id IS NOT NULL
         DO UPDATE SET next_seq = bms_document_counters.next_seq + 1, updated_at = now()
         RETURNING next_seq - 1 AS next_seq`,
        [tenantId, locationId, deviceId, docType, periodKey]
      );
  return Number(result.rows[0].next_seq);
}

/**
 * เวลาของเอกสาร = `now()` ของทรานแซกชันนี้ (ตัวเดียวกับ DEFAULT ของ issued_at)
 * แปลงเป็นวันที่ไทย — ไม่ใช้นาฬิกาของ Node เพราะสองนาฬิกาต่างกันได้ไม่กี่วินาที
 * แล้วบิลตอน 23:59:59 จะได้ issued_at วันหนึ่งแต่ issue_date อีกวัน
 */
async function taxClockInTx(client: PoolClient): Promise<TaxClock> {
  const res = await client.query<{ now: Date }>(`SELECT now() AS now`);
  return taxClockOf(new Date(res.rows[0].now));
}

async function taxDocLocationInTx(
  client: PoolClient,
  tenantId: string,
  locationId: string
): Promise<TaxDocLocation> {
  const res = await client.query<{ is_head_office: boolean; branch_code: string | null }>(
    `SELECT is_head_office, branch_code FROM bms_locations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, locationId]
  );
  const r = res.rows[0];
  // ไม่พบสาขา = ปล่อยรูปแบบเดิม ให้ FK ของ INSERT เป็นคนปฏิเสธ
  return { isHeadOffice: r?.is_head_office ?? true, branchCode: r?.branch_code ?? null };
}

async function taxDocumentSellerInTx(client: PoolClient, tenantId: string, locationId: string) {
  const res = await client.query<{
    name: string; tax_id: string | null; branch_code: string; address: string | null; phone: string | null;
  }>(
    `SELECT t.name, s.tax_id, l.branch_code,
            COALESCE(NULLIF(btrim(l.address), ''), NULLIF(btrim(s.address), '')) AS address,
            COALESCE(NULLIF(btrim(l.phone), ''), NULLIF(btrim(s.phone), '')) AS phone
       FROM bms_tenants t
       JOIN bms_locations l ON l.tenant_id = t.id AND l.id = $2
       LEFT JOIN bms_store_profile s ON s.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId, locationId]
  );
  const row = res.rows[0];
  return {
    name: row?.name?.trim() || null,
    taxId: row?.tax_id?.trim() || null,
    branchCode: row?.branch_code?.trim() || null,
    address: row?.address?.trim() || null,
    phone: row?.phone?.trim() || null,
  };
}

// ---------------------------------------------------------------
// อ่านค่าตั้งภาษี + บรรทัดของบิล
// ---------------------------------------------------------------

// กติกาปัดเศษอยู่ที่ lib/pos/cashRounding.ts — จอขายต้อง import ตัวเดียวกันนี้
// (re-export ไว้เพื่อไม่ต้องแก้ผู้เรียกเดิม)
export { cashRoundingDelta, type CashRounding };

export type TenantVatSettings = VatSettings & {
  calendarEra: "BE" | "CE";
  abbreviatedApproved: boolean;
  cashRounding: CashRounding;
  /** true = ไม่บอกยอดเงินที่ควรมีจนกว่าจะปิดกะ (8.0) — คนนับกรอกให้ตรงไม่ได้ */
  blindClose: boolean;
};

export async function getVatSettings(tenantId: string, reader: { query: typeof query } = { query }): Promise<TenantVatSettings> {
  const res = await reader.query<any>(
    `SELECT vat_registered, price_includes_vat, vat_rate, vat_rounding, calendar_era,
            abbreviated_tax_invoice_approved, cash_rounding, pos_blind_close
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
    cashRounding: (r?.cash_rounding ?? "NONE") as CashRounding,
    // ร้านที่ยังไม่มีแถวโปรไฟล์ = เปิดไว้ ตรงกับ DEFAULT TRUE ของคอลัมน์
    blindClose: r?.pos_blind_close ?? true,
  };
}

export type TenantVatSettingsInput = {
  vatRegistered: boolean;
  priceIncludesVat: boolean;
  vatRate: number;
  vatRounding: VatRounding;
  calendarEra: "BE" | "CE";
  abbreviatedApproved: boolean;
  cashRounding: CashRounding;
  blindClose: boolean;
};

const VAT_ROUNDING_MODES: VatRounding[] = ["BASE_FIRST", "VAT_FIRST_TRUNCATE", "VAT_FIRST_ROUND"];

/**
 * ตั้งค่าภาษีของร้าน — ค่าพวกนี้เปลี่ยนหน้าตาเอกสารที่ออกให้ลูกค้าและฐาน VAT
 * ที่ยื่นสรรพากร จึงตรวจค่าที่รับเข้ามาเองทุกตัว ไม่เชื่อ input จาก client
 *
 * มีผลกับ "บิลใหม่" เท่านั้น เอกสารที่ออกไปแล้วเก็บอัตรา/ยอดของตัวเองไว้ในแถว
 * ของมันเอง (bms_tax_documents.vat_rate) การแก้ตรงนี้จึงไม่ย้อนแก้ของเก่า
 */
export async function updateVatSettings(
  tenantId: string,
  input: TenantVatSettingsInput
): Promise<TenantVatSettings> {
  const rate = Number(input.vatRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error("อัตรา VAT ต้องอยู่ระหว่าง 0–100");
  }
  if (!VAT_ROUNDING_MODES.includes(input.vatRounding)) {
    throw new Error(`วิธีปัดเศษ VAT ไม่ถูกต้อง: ${input.vatRounding}`);
  }
  if (input.calendarEra !== "BE" && input.calendarEra !== "CE") {
    throw new Error(`ปีปฏิทินไม่ถูกต้อง: ${input.calendarEra}`);
  }
  if (!isCashRounding(input.cashRounding)) {
    throw new Error(`วิธีปัดเศษเงินสดไม่ถูกต้อง: ${input.cashRounding}`);
  }
  if (!input.priceIncludesVat) {
    throw new Error("ขณะนี้ระบบรองรับเฉพาะราคาที่รวม VAT แล้ว เพราะทุกช่องทางเก็บเงินตามราคาสินค้าโดยไม่บวก VAT เพิ่ม");
  }

  await query(
    `INSERT INTO bms_store_profile (
       tenant_id, vat_registered, price_includes_vat, vat_rate, vat_rounding,
       calendar_era, abbreviated_tax_invoice_approved, cash_rounding, pos_blind_close
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id) DO UPDATE SET
       vat_registered = EXCLUDED.vat_registered,
       price_includes_vat = EXCLUDED.price_includes_vat,
       vat_rate = EXCLUDED.vat_rate,
       vat_rounding = EXCLUDED.vat_rounding,
       calendar_era = EXCLUDED.calendar_era,
       abbreviated_tax_invoice_approved = EXCLUDED.abbreviated_tax_invoice_approved,
       cash_rounding = EXCLUDED.cash_rounding,
       pos_blind_close = EXCLUDED.pos_blind_close,
       updated_at = now()`,
    [
      tenantId,
      Boolean(input.vatRegistered),
      Boolean(input.priceIncludesVat),
      Math.round(rate * 100) / 100,
      input.vatRounding,
      input.calendarEra,
      Boolean(input.abbreviatedApproved),
      input.cashRounding,
      Boolean(input.blindClose),
    ]
  );
  // โปรไฟล์ร้านอยู่แถวเดียวกันและถูก cache ไว้ — ไม่ล้างแล้วหน้าอื่นจะเห็นค่าเก่า
  await invalidateStoreProfileCache(tenantId);
  return getVatSettings(tenantId);
}

type OrderLineForVat = {
  sku: string;
  amount: number;
  vatCategory: VatCategory;
  discountEligible: boolean;
};

/** ส่วนลดทั้งบิล — ต้องนำไปลดฐานภาษีตามสัดส่วน ไม่งั้นใบกำกับยอดเกินเงินที่รับ */
async function loadOrderAdjustmentsInTx(
  client: PoolClient,
  tenantId: string,
  orderId: string
): Promise<{ discount: number; shipping: number; rounding: number }> {
  const res = await client.query<{ discount_amount: string; shipping_fee: string; rounding_amount: string }>(
    `SELECT discount_amount, shipping_fee, rounding_amount
       FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId]
  );
  const r = res.rows[0];
  return {
    discount: Number(r?.discount_amount ?? 0),
    shipping: Number(r?.shipping_fee ?? 0),
    rounding: Number(r?.rounding_amount ?? 0),
  };
}

async function loadOrderLinesInTx(client: PoolClient, tenantId: string, orderId: string): Promise<OrderLineForVat[]> {
  // ค่าบริการ/ค่าถุง (8.6) ต้องรวมมาด้วย — เป็นค่าบริการของผู้ประกอบการที่จด VAT
  // จึงอยู่ในฐานภาษี · ถ้าไม่รวม ใบกำกับจะแสดงฐานน้อยกว่าเงินที่รับจริง แล้วยอด
  // ที่ยื่นสรรพากรต่ำกว่าความจริงตามจำนวนค่าบริการทั้งหมดที่เคยเก็บ
  const res = await client.query<any>(
    `SELECT product_sku,
            vat_category,
            line_amount AS amount,
            TRUE AS discount_eligible
       FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2
     UNION ALL
     SELECT 'EXTRA:' || label AS product_sku,
            vat_category,
            unit_amount * qty AS amount,
            FALSE AS discount_eligible
       FROM bms_order_extra_lines WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, orderId]
  );
  return res.rows.map((r: any) => ({
    sku: r.product_sku,
    amount: Number(r.amount),
    vatCategory: (r.vat_category ?? "UNKNOWN") as VatCategory,
    discountEligible: Boolean(r.discount_eligible),
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
  const adj = await loadOrderAdjustmentsInTx(client, tenantId, orderId);
  // ยอดปัดเศษที่บันทึกไว้กับบิลแล้วมีน้ำหนักกว่าค่าที่ผู้เรียกส่งมา
  const breakdown = computeVat(lines, settings, {
    roundingAmount: adj.rounding || roundingAmount,
    discountAmount: adj.discount,
    shippingAmount: adj.shipping,
  });
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

  const clock = await taxClockInTx(client);
  const seq = await nextSequenceInTx(client, {
    tenantId, locationId, deviceId, docType: "ABBREVIATED",
    periodKey: String(clock.year),
  });

  // เครื่องที่ prefix ซ้ำกับเครื่องอื่นของร้าน (รวมเครื่องที่ปิดไปแล้ว และหลายเครื่องที่
  // ไม่ได้ตั้งเลย) ต้องได้เลขที่ไม่ชนกัน — ดู abbreviatedInvoicePrefix()
  const deviceRes = deviceId
    ? await client.query<{ receipt_prefix: string | null; code: string; shared: boolean }>(
        `SELECT d.receipt_prefix, d.code,
                EXISTS (
                  SELECT 1 FROM bms_pos_devices o
                   WHERE o.tenant_id = d.tenant_id AND o.id <> d.id
                     AND btrim(COALESCE(o.receipt_prefix, '')) = btrim(COALESCE(d.receipt_prefix, ''))
                ) AS shared
           FROM bms_pos_devices d WHERE d.tenant_id = $1 AND d.id = $2`,
        [tenantId, deviceId]
      )
    : null;
  const device = deviceRes?.rows[0];
  const prefix = device
    ? abbreviatedInvoicePrefix({
        receiptPrefix: device.receipt_prefix,
        code: device.code,
        sharedWithAnotherDevice: device.shared,
      })
    : null;

  const docNo = buildTaxDocNo(prefix, clock, seq, settings.calendarEra);
  const seller = await taxDocumentSellerInTx(client, tenantId, locationId);

  const res = await client.query(
    `INSERT INTO bms_tax_documents
       (tenant_id, location_id, order_id, device_id, doc_type, doc_no, issue_date,
        seller_name, seller_tax_id, seller_branch_code, seller_address, seller_phone,
        taxable_amount, exempt_amount, vat_amount, rounding_amount, grand_total, vat_rate, issued_by)
     VALUES ($1, $2, $3, $4, 'ABBREVIATED', $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [tenantId, locationId, orderId, deviceId, docNo, clock.isoDate,
      seller.name, seller.taxId, seller.branchCode, seller.address, seller.phone,
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
  | { status: "ORDER_NOT_INVOICEABLE"; reason: string }
  | { status: "SELLER_INCOMPLETE"; reason: string }
  | { status: "BUYER_INCOMPLETE"; reason: string };

/**
 * ออกใบกำกับเต็มรูปแทนใบย่อ — ทั้งสองขั้นอยู่ในทรานแซกชันเดียว
 * ยกเลิกใบย่อแล้วออกใบเต็มไม่สำเร็จ = ลูกค้าเหลือแค่ใบที่ถูกยกเลิกในมือ
 */
export type IssueFullInvoiceArgs = {
  tenantId: string;
  orderId: string;
  buyer: FullInvoiceBuyer;
  issuedBy?: string | null;
};

export async function issueFullTaxInvoice(args: IssueFullInvoiceArgs): Promise<IssueFullResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, args.tenantId, { editorId: args.issuedBy ?? null });
    const result = await issueFullTaxInvoiceInTx(client, args);
    await client.query(result.status === "ISSUED" ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

/** Caller owns the transaction: request review and tax issuance must commit together. */
export async function issueFullTaxInvoiceInTx(client: PoolClient, args: IssueFullInvoiceArgs): Promise<IssueFullResult> {
  const { tenantId, orderId, buyer } = args;
  if (!buyer?.name?.trim()) return { status: "BUYER_INCOMPLETE", reason: "ต้องระบุชื่อผู้ซื้อ" };
  if (!buyer?.taxId?.trim()) return { status: "BUYER_INCOMPLETE", reason: "ต้องระบุเลขประจำตัวผู้เสียภาษี" };
  if (!isValidThaiTaxId(buyer.taxId.trim())) {
    return { status: "BUYER_INCOMPLETE", reason: "เลขประจำตัวผู้เสียภาษีผู้ซื้อต้องมี 13 หลักและ checksum ถูกต้อง" };
  }
  const buyerBranchCode = buyer.branchCode?.trim() || "00000";
  if (!/^\d{5}$/.test(buyerBranchCode)) {
    return { status: "BUYER_INCOMPLETE", reason: "รหัสสาขาผู้ซื้อต้องมี 5 หลัก (สำนักงานใหญ่ใช้ 00000)" };
  }
  if (!buyer.address?.trim()) {
    return { status: "BUYER_INCOMPLETE", reason: "ต้องระบุที่อยู่ผู้ซื้อสำหรับใบกำกับภาษีเต็มรูป" };
  }

  const settings = await getVatSettings(tenantId, client);
  if (!settings.vatRegistered) return { status: "NOT_VAT_REGISTERED" };


    const ord = await client.query<{ location_id: string; status: string; voided_at: Date | null }>(
      `SELECT location_id, status, voided_at
         FROM bms_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, orderId]
    );
    if (!ord.rowCount) {
      return { status: "ORDER_NOT_FOUND" };
    }
    if (ord.rows[0].status !== "COMPLETED" || ord.rows[0].voided_at != null) {
      return {
        status: "ORDER_NOT_INVOICEABLE",
        reason: ord.rows[0].voided_at != null
          ? "บิลถูก void แล้ว จึงออกใบกำกับภาษีเต็มรูปไม่ได้"
          : `บิลสถานะ ${ord.rows[0].status} ยังไม่ใช่การขายที่เสร็จสมบูรณ์`,
      };
    }
    // A partially returned sale needs credit-note accounting first. Rebuilding a
    // full invoice from the original basket would overstate the remaining sale.
    const returned = await client.query(
      `SELECT 1 FROM bms_pos_returns
        WHERE tenant_id = $1 AND order_id = $2 AND is_void = FALSE LIMIT 1`,
      [tenantId, orderId]
    );
    if (returned.rowCount) {
      return {
        status: "ORDER_NOT_INVOICEABLE",
        reason: "บิลนี้มีการคืนสินค้าบางส่วนแล้ว กรุณาใช้เอกสารเดิมและใบลดหนี้",
      };
    }
    const locationId = ord.rows[0].location_id;

    const sellerIdentity = await taxDocumentSellerInTx(client, tenantId, locationId);
    if (!sellerIdentity.name || !sellerIdentity.address || !sellerIdentity.branchCode
        || !sellerIdentity.taxId || !isValidThaiTaxId(sellerIdentity.taxId)) {
      return {
        status: "SELLER_INCOMPLETE",
        reason: "กรุณาตั้งชื่อ ที่อยู่สถานประกอบการ และเลขผู้เสียภาษีของร้านที่ checksum ถูกต้องก่อนออกใบเต็ม",
      };
    }

    const already = await client.query(
      `SELECT * FROM bms_tax_documents
        WHERE tenant_id = $1 AND order_id = $2 AND doc_type = 'FULL' AND cancelled_at IS NULL`,
      [tenantId, orderId]
    );
    if (already.rowCount) {
      return { status: "ALREADY_ISSUED", document: mapDoc(already.rows[0]) };
    }

    // Replacing an issued receipt must preserve sale-time tax, even if settings changed later.
    const original = await client.query(
      `SELECT * FROM bms_tax_documents WHERE tenant_id=$1 AND order_id=$2
        AND doc_type='ABBREVIATED' AND cancelled_at IS NULL FOR UPDATE`, [tenantId, orderId]
    );
    const { breakdown, lines } = original.rows[0]
      ? { breakdown: mapDoc(original.rows[0]), lines: await loadOrderLinesInTx(client, tenantId, orderId) }
      : await applyOrderVatInTx(client, tenantId, orderId, settings);
    const missing = unresolvedVatSkus(lines);
    if (missing.length > 0) {
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
    if (cancelled) {
      await cancelQueuedTaxDocumentInTx(
        client,
        tenantId,
        cancelled.id,
        "ยกเลิกก่อนนำส่ง: ออกใบกำกับภาษีเต็มรูปแทน"
      );
    }

    const clock = await taxClockInTx(client);
    const seq = await nextSequenceInTx(client, {
      tenantId, locationId, deviceId: null, docType: "FULL",
      periodKey: String(clock.year),
    });
    const location = await taxDocLocationInTx(client, tenantId, locationId);
    const docNo = buildTaxDocNo(fullInvoicePrefix(location), clock, seq, settings.calendarEra);

    const res = await client.query(
      `INSERT INTO bms_tax_documents
         (tenant_id, location_id, order_id, doc_type, doc_no, issue_date, replaces_document_id,
          buyer_name, buyer_tax_id, buyer_branch_code, buyer_address, buyer_phone,
          seller_name, seller_tax_id, seller_branch_code, seller_address, seller_phone,
          taxable_amount, exempt_amount, vat_amount, rounding_amount, grand_total, vat_rate, issued_by)
       VALUES ($1, $2, $3, 'FULL', $4, $23::date, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING *`,
      [tenantId, locationId, orderId, docNo, cancelled?.id ?? null,
        buyer.name.trim(), buyer.taxId.trim(), buyerBranchCode,
        buyer.address?.trim() || null, buyer.phone?.trim() || null,
        sellerIdentity.name, sellerIdentity.taxId, sellerIdentity.branchCode,
        sellerIdentity.address, sellerIdentity.phone,
        breakdown.taxableAmount, breakdown.exemptAmount, breakdown.vatAmount,
        breakdown.roundingAmount, breakdown.grandTotal, breakdown.vatRate,
        args.issuedBy ?? null, clock.isoDate]
    );

    const full = mapDoc(res.rows[0]);
    await enqueueTaxDocument(tenantId, full.id, client);
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'tax.document.issue_full',$3,$4::jsonb)`,
      [tenantId, args.issuedBy ?? "system", full.id, JSON.stringify({
        orderId,
        docNo: full.docNo,
        replaces: cancelled?.docNo ?? null,
      })]
    );
    return { status: "ISSUED", document: full, cancelledAbbreviated: cancelled };
}

// ---------------------------------------------------------------
// ใบลดหนี้ (7.95)
// ---------------------------------------------------------------

export type CreditNoteResult =
  | { status: "ISSUED"; document: TaxDocument }
  | { status: "ALREADY_ISSUED"; document: TaxDocument }
  | { status: "NO_ORIGINAL_DOCUMENT" }
  | { status: "NOT_VAT_REGISTERED" }
  | { status: "BAD_AMOUNT"; reason: string };

/**
 * ออกใบลดหนี้เมื่อรับคืนสินค้า
 *
 * ใบกำกับเดิม **ไม่ถูกยกเลิก** — ของถูกขายไปจริงแล้ว ใบลดหนี้มาลดยอดทีหลัง
 * จึงใช้ references_document_id ไม่ใช่ replaces_document_id (ดูเหตุผลใน 7.95)
 *
 * เลขใบลดหนี้รันคนละชุดกับใบกำกับ ตามที่กฎหมายแยกประเภทเอกสาร
 */
export async function issueCreditNote(args: {
  tenantId: string;
  orderId: string;
  /** ยอดที่คืนให้ลูกค้า (บวกเสมอ — ประเภทเอกสารบอกเองว่าเป็นการลด) */
  amount: number;
  reason: string;
  issuedBy?: string | null;
  /** คืนของหลายครั้งต่อบิลได้ → ใช้แยกว่าเป็นการคืนครั้งไหน */
  returnRef?: string | null;
  /**
   * รายการที่คืนจริง (orderItemId + ยอด) — ถ้าให้มา จะแยก VAT จากของที่คืนจริง
   * ไม่ให้มา = แบ่งตามสัดส่วนของบิลเดิม ซึ่งผิดเมื่อคืนเฉพาะของยกเว้น VAT
   */
  returnedItems?: Array<{ orderItemId: number; refundAmount: number }>;
}): Promise<CreditNoteResult> {
  const { tenantId, orderId } = args;
  const amount = Math.round((Number(args.amount) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: "BAD_AMOUNT", reason: "ยอดลดหนี้ต้องมากกว่า 0" };
  }

  const settings = await getVatSettings(tenantId);
  if (!settings.vatRegistered) return { status: "NOT_VAT_REGISTERED" };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: args.issuedBy ?? null });

    // ใบกำกับที่ยังมีผลของบิลนี้ — ใบเต็มมาก่อนใบย่อถ้ามีทั้งคู่
    const orig = await client.query<any>(
      `SELECT * FROM bms_tax_documents
        WHERE tenant_id = $1 AND order_id = $2 AND cancelled_at IS NULL
          AND doc_type IN ('FULL', 'ABBREVIATED')
        ORDER BY (doc_type = 'FULL') DESC, issued_at DESC
        LIMIT 1
        FOR UPDATE`,
      [tenantId, orderId]
    );
    if (!orig.rowCount) {
      await client.query("ROLLBACK");
      return { status: "NO_ORIGINAL_DOCUMENT" };
    }
    const original = mapDoc(orig.rows[0]);

    if (amount - original.grandTotal > 0.01) {
      await client.query("ROLLBACK");
      return {
        status: "BAD_AMOUNT",
        reason: `ยอดลดหนี้ ${amount} เกินยอดใบกำกับเดิม ${original.grandTotal}`,
      };
    }

    // คืนซ้ำด้วยเหตุเดียวกันต้องไม่ออกใบซ้ำ
    const dupe = await client.query(
      `SELECT * FROM bms_tax_documents
        WHERE tenant_id = $1 AND order_id = $2 AND doc_type = 'CREDIT_NOTE'
          AND cancelled_at IS NULL
          AND credit_reason IS NOT DISTINCT FROM $3
          AND grand_total = $4`,
      [tenantId, orderId, args.returnRef ? `${args.reason} [${args.returnRef}]` : args.reason, amount]
    );
    if (dupe.rowCount) {
      await client.query("ROLLBACK");
      return { status: "ALREADY_ISSUED", document: mapDoc(dupe.rows[0]) };
    }

    // แยก VAT ของยอดที่คืน
    //
    // ถ้ารู้ว่าคืนรายการไหน ให้แยกจากของที่คืนจริง — คืนเฉพาะข้าวสาร (ยกเว้น VAT)
    // ต้องไม่ไปลด VAT ที่เคยแจ้งไว้ การเฉลี่ยตามสัดส่วนบิลจะลดผิด
    // ไม่รู้รายการ (เช่น คืนทั้งบิล) จึงค่อยเฉลี่ยตามสัดส่วน
    let taxable: number;
    let exempt: number;
    let vat: number;

    const itemIds = (args.returnedItems ?? []).map((i) => i.orderItemId);
    const byLine = itemIds.length > 0
      ? await client.query<{ id: number; vat_category: string }>(
          `SELECT id, vat_category FROM bms_order_items
            WHERE tenant_id = $1 AND order_id = $2 AND id = ANY($3::bigint[])`,
          [tenantId, orderId, itemIds]
        )
      : null;

    if (byLine && byLine.rowCount === itemIds.length) {
      const catById = new Map(byLine.rows.map((r) => [Number(r.id), r.vat_category]));
      let taxableGross = 0;
      for (const it of args.returnedItems ?? []) {
        if (catById.get(it.orderItemId) !== "N") taxableGross += Number(it.refundAmount);
      }
      taxable = Math.round(taxableGross * 100) / 100;
      exempt = Math.round((amount - taxable) * 100) / 100;
      const rate = Number(original.vatRate);
      vat = rate > 0 ? Math.round(((taxable * rate) / (100 + rate)) * 100) / 100 : 0;
    } else {
      const share = original.grandTotal > 0 ? amount / original.grandTotal : 0;
      taxable = Math.round(original.taxableAmount * share * 100) / 100;
      exempt = Math.round((amount - taxable) * 100) / 100;
      vat = Math.round(original.vatAmount * share * 100) / 100;
    }

    const clock = await taxClockInTx(client);
    const seq = await nextSequenceInTx(client, {
      tenantId,
      locationId: original.locationId,
      deviceId: null,
      docType: "CREDIT_NOTE",
      periodKey: String(clock.year),
    });
    const location = await taxDocLocationInTx(client, tenantId, original.locationId);
    const docNo = buildTaxDocNo(creditNotePrefix(location), clock, seq, settings.calendarEra);

    const res = await client.query(
      `INSERT INTO bms_tax_documents
         (tenant_id, location_id, order_id, doc_type, doc_no, issue_date, references_document_id,
          credit_reason, original_total,
          buyer_name, buyer_tax_id, buyer_branch_code, buyer_address, buyer_phone,
          seller_name, seller_tax_id, seller_branch_code, seller_address, seller_phone,
          taxable_amount, exempt_amount, vat_amount, grand_total, vat_rate, issued_by)
       VALUES ($1, $2, $3, 'CREDIT_NOTE', $4, $24::date, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       RETURNING *`,
      [tenantId, original.locationId, orderId, docNo, original.id,
        args.returnRef ? `${args.reason} [${args.returnRef}]` : args.reason,
        original.grandTotal,
        original.buyerName, original.buyerTaxId, original.buyerBranchCode,
        original.buyerAddress, original.buyerPhone,
        original.sellerName, original.sellerTaxId, original.sellerBranchCode,
        original.sellerAddress, original.sellerPhone,
        taxable, exempt, vat, amount, original.vatRate, args.issuedBy ?? null, clock.isoDate]
    );

    const note = mapDoc(res.rows[0]);
    await enqueueTaxDocument(tenantId, note.id, client);
    await client.query("COMMIT");
    return { status: "ISSUED", document: note };
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

export type FullTaxInvoiceView = {
  id: string;
  orderId: string;
  docNo: string;
  issueDate: string;
  seller: { name: string; taxId: string; branchCode: string; address: string; phone: string | null; locationName: string };
  buyer: { name: string; taxId: string; branchCode: string; address: string; phone: string | null };
  replacesDocNo: string | null;
  lines: Array<{ sku: string; name: string; size: string; qty: number; unit: string; unitPrice: number; amount: number }>;
  subtotal: number;
  discount: number;
  shipping: number;
  netBeforeVat: number;
  exemptAmount: number;
  vatAmount: number;
  vatRate: number;
  roundingAmount: number;
  grandTotal: number;
  amountText: string;
};

/** ข้อมูลสำหรับ preview/print ใบเต็ม อ่านจาก snapshot ของบิลและเอกสารฝั่ง server เท่านั้น */
export async function getFullTaxInvoiceView(
  tenantId: string,
  documentId: string,
  allowedLocationIds?: string[] | null,
  reader: { query: typeof query } = { query }
): Promise<FullTaxInvoiceView | null> {
  const res = await reader.query<any>(
    `SELECT d.*, prev.doc_no AS replaces_doc_no,
            COALESCE(d.seller_name, t.name) AS seller_name,
            COALESCE(d.seller_tax_id, s.tax_id) AS seller_tax_id,
            COALESCE(d.seller_address, NULLIF(btrim(l.address), ''), NULLIF(btrim(s.address), '')) AS seller_address,
            COALESCE(d.seller_phone, NULLIF(btrim(l.phone), ''), NULLIF(btrim(s.phone), '')) AS seller_phone,
            l.name AS location_name, l.branch_code,
            o.discount_amount, o.shipping_fee
       FROM bms_tax_documents d
       JOIN bms_tenants t ON t.id = d.tenant_id
       JOIN bms_locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
       JOIN bms_orders o ON o.tenant_id = d.tenant_id AND o.id = d.order_id
       LEFT JOIN bms_store_profile s ON s.tenant_id = d.tenant_id
       LEFT JOIN bms_tax_documents prev
              ON prev.tenant_id = d.tenant_id AND prev.id = d.replaces_document_id
      WHERE d.tenant_id = $1 AND d.id = $2 AND d.doc_type = 'FULL'
        AND ($3::uuid[] IS NULL OR d.location_id = ANY($3::uuid[]))`,
    [tenantId, documentId, allowedLocationIds ?? null]
  );
  const d = res.rows[0];
  if (!d) return null;
  const items = await reader.query<any>(
    `SELECT oi.product_sku, oi.size, oi.qty, oi.line_amount, oi.pack_qty, oi.pack_unit_name,
            COALESCE(NULLIF(oi.product_name, ''), oi.product_sku) AS item_name
       FROM bms_order_items oi
      WHERE oi.tenant_id = $1 AND oi.order_id = $2
      ORDER BY oi.id`,
    [tenantId, d.order_id]
  );
  const lines = items.rows.map((row: any) => {
    const qty = Number(row.pack_qty ?? row.qty);
    const amount = Number(row.line_amount);
    return {
      sku: row.product_sku,
      name: row.item_name,
      size: row.size,
      qty,
      unit: row.pack_unit_name ?? "หน่วย",
      unitPrice: qty === 0 ? 0 : Math.round((amount / qty) * 100) / 100,
      amount,
    };
  });
  const extras = await reader.query<any>(
    `SELECT label,qty,unit_amount FROM bms_order_extra_lines
      WHERE tenant_id=$1 AND order_id=$2 ORDER BY id`, [tenantId, d.order_id]
  );
  for (const row of extras.rows) {
    lines.push({ sku: "", name: row.label, size: "", qty: Number(row.qty), unit: "หน่วย",
      unitPrice: Number(row.unit_amount), amount: Math.round(Number(row.qty) * Number(row.unit_amount) * 100) / 100 });
  }
  const subtotal = Math.round(lines.reduce((sum: number, line: any) => sum + line.amount, 0) * 100) / 100;
  const taxableAmount = Number(d.taxable_amount);
  const exemptAmount = Number(d.exempt_amount);
  const vatAmount = Number(d.vat_amount);
  const grandTotal = Number(d.grand_total);
  return {
    id: d.id,
    orderId: d.order_id,
    docNo: d.doc_no,
    issueDate: toDate(d.issue_date),
    seller: {
      name: d.seller_name ?? "",
      taxId: d.seller_tax_id ?? "",
      branchCode: d.seller_branch_code ?? d.branch_code ?? "00000",
      address: d.seller_address ?? "",
      phone: d.seller_phone ?? null,
      locationName: d.location_name ?? "",
    },
    buyer: {
      name: d.buyer_name ?? "",
      taxId: d.buyer_tax_id ?? "",
      branchCode: d.buyer_branch_code ?? "00000",
      address: d.buyer_address ?? "",
      phone: d.buyer_phone ?? null,
    },
    replacesDocNo: d.replaces_doc_no ?? null,
    lines,
    subtotal,
    discount: Number(d.discount_amount ?? 0),
    shipping: Number(d.shipping_fee ?? 0),
    netBeforeVat: Math.round((taxableAmount - vatAmount + exemptAmount) * 100) / 100,
    exemptAmount,
    vatAmount,
    vatRate: Number(d.vat_rate),
    roundingAmount: Number(d.rounding_amount),
    grandTotal,
    amountText: bahtText(grandTotal),
  };
}
