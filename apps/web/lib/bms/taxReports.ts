// =============================================================
// รายงานภาษีขาย + รายการใบกำกับ — อ่านอย่างเดียว
// -------------------------------------------------------------
// ใช้ประกอบการยื่น ภ.พ.30 ของผู้ประกอบการที่จด VAT · แยกตาม "สถานประกอบการ"
// (bms_locations: สำนักงานใหญ่/สาขาที่ + branch_code) เพราะรายงานภาษีต้องทำเป็นราย
// สถานประกอบการ
//
// กติกาการนับ:
//  - แบ่งงวดด้วย issue_date (วันที่ไทย ดู 10.8) ไม่ใช่ issued_at แบบ UTC
//  - ใบกำกับเต็มรูป: หนึ่งแถวต่อหนึ่งใบ
//  - ใบกำกับอย่างย่อ: สรุปรวมรายวัน ต่อเครื่อง เป็นช่วงเลขที่ (เลขแรก–เลขสุดท้าย)
//  - ใบลดหนี้: หนึ่งแถวต่อหนึ่งใบ เป็นยอดลบ อ้างอิงเลขใบกำกับเดิม
//  - ใบที่ถูกยกเลิกไม่นับยอด แต่แยกไว้ในรายการของตัวเอง
//
// ⚠️ รายงานนี้ไม่ใช่การยื่นภาษี และไม่ได้ตัดสินแทนนักบัญชี · ส่วน "ต้องตรวจสอบ" มีไว้
// บอกสิ่งที่ระบบรู้ว่าอาจทำให้ยอดไม่ครบ (บิลที่ชำระแล้วแต่ไม่มีใบกำกับ, คืนของที่ไม่มี
// ใบลดหนี้, ใบเต็มที่ออกแทนใบย่อข้ามเดือน) — ห้ามซ่อนหรือปัดทิ้ง
// =============================================================

import { query } from "@/lib/db";
import { getVatSettings } from "./taxDocuments";
import {
  assertTaxPeriod,
  sumTaxAmounts,
  taxAmountsOf,
  taxMonthOf,
  type TaxAmounts,
  type TaxDocKind,
} from "./taxReportMath";

const PAID_ORDER_STATUSES = ["PAID", "PACKING", "SHIPPED", "COMPLETED", "RETURNED"];
const EXCEPTION_LIMIT = 500;

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

// ---------------------------------------------------------------
// รายการใบกำกับ (หน้า /admin/tax-documents)
// ---------------------------------------------------------------

export type TaxDocumentListFilter = {
  from: string;
  to: string;
  locationId?: string | null;
  docType?: TaxDocKind | null;
  search?: string | null;
  includeCancelled?: boolean;
  limit?: number;
  offset?: number;
};

export type TaxDocumentListRow = {
  id: string;
  orderId: string;
  locationId: string;
  locationCode: string;
  branchCode: string;
  deviceCode: string | null;
  docType: TaxDocKind;
  docNo: string;
  issueDate: string;
  issuedAt: string;
  cancelledAt: string | null;
  cancelledReason: string | null;
  buyerName: string | null;
  buyerTaxId: string | null;
  referenceDocNo: string | null;
  channel: string | null;
  base: number;
  exempt: number;
  vat: number;
  total: number;
  rounding: number;
};

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listTaxDocuments(
  tenantId: string,
  filter: TaxDocumentListFilter
): Promise<{ total: number; rows: TaxDocumentListRow[] }> {
  const { from, to } = assertTaxPeriod(filter.from, filter.to);
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);
  const docType = filter.docType ?? null;
  if (docType && !["ABBREVIATED", "FULL", "CREDIT_NOTE"].includes(docType)) {
    throw new Error("ประเภทเอกสารไม่ถูกต้อง");
  }
  const search = filter.search?.trim() ? `%${escapeLike(filter.search.trim())}%` : null;

  const res = await query<any>(
    `SELECT d.id, d.order_id, d.location_id, l.code AS location_code, l.branch_code,
            dev.code AS device_code, d.doc_type, d.doc_no, d.issue_date::text AS issue_date,
            d.issued_at, d.cancelled_at, d.cancelled_reason, d.buyer_name, d.buyer_tax_id,
            ref.doc_no AS reference_doc_no, o.channel,
            d.taxable_amount, d.exempt_amount, d.vat_amount, d.rounding_amount,
            count(*) OVER () AS total_count
       FROM bms_tax_documents d
       JOIN bms_locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
       LEFT JOIN bms_pos_devices dev ON dev.tenant_id = d.tenant_id AND dev.id = d.device_id
       LEFT JOIN bms_tax_documents ref
              ON ref.tenant_id = d.tenant_id AND ref.id = COALESCE(d.references_document_id, d.replaces_document_id)
       LEFT JOIN bms_orders o ON o.tenant_id = d.tenant_id AND o.id = d.order_id
      WHERE d.tenant_id = $1
        AND d.issue_date BETWEEN $2::date AND $3::date
        AND ($4::uuid IS NULL OR d.location_id = $4::uuid)
        AND ($5::text IS NULL OR d.doc_type = $5::text)
        AND ($6::boolean OR d.cancelled_at IS NULL)
        AND ($7::text IS NULL OR d.doc_no ILIKE $7 ESCAPE '\\' OR d.buyer_name ILIKE $7 ESCAPE '\\'
             OR d.buyer_tax_id ILIKE $7 ESCAPE '\\')
      ORDER BY d.issue_date DESC, d.issued_at DESC, d.doc_no DESC
      LIMIT $8 OFFSET $9`,
    [tenantId, from, to, filter.locationId ?? null, docType, Boolean(filter.includeCancelled), search, limit, offset]
  );
  return {
    total: res.rows.length ? Number(res.rows[0].total_count) : 0,
    rows: res.rows.map((r: any) => {
      const amounts = taxAmountsOf({
        docType: r.doc_type,
        taxableAmount: Number(r.taxable_amount),
        exemptAmount: Number(r.exempt_amount),
        vatAmount: Number(r.vat_amount),
        roundingAmount: Number(r.rounding_amount),
      });
      return {
        id: r.id,
        orderId: r.order_id,
        locationId: r.location_id,
        locationCode: r.location_code,
        branchCode: r.branch_code,
        deviceCode: r.device_code ?? null,
        docType: r.doc_type,
        docNo: r.doc_no,
        issueDate: r.issue_date,
        issuedAt: iso(r.issued_at),
        cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null,
        cancelledReason: r.cancelled_reason ?? null,
        buyerName: r.buyer_name ?? null,
        buyerTaxId: r.buyer_tax_id ?? null,
        referenceDocNo: r.reference_doc_no ?? null,
        channel: r.channel ?? null,
        ...amounts,
      };
    }),
  };
}

// ---------------------------------------------------------------
// รายงานภาษีขาย
// ---------------------------------------------------------------

export type SalesTaxEstablishment = {
  locationId: string;
  code: string;
  name: string;
  branchCode: string;
  isHeadOffice: boolean;
  address: string | null;
};

export type SalesTaxRow = TaxAmounts & {
  kind: "FULL" | "ABBREVIATED_DAY" | "CREDIT_NOTE";
  issueDate: string;
  locationId: string;
  branchCode: string;
  deviceCode: string | null;
  docNoFrom: string;
  docNoTo: string;
  /** จำนวนใบที่นับยอด (ใบย่อที่ถูกยกเลิกไม่นับ) */
  docCount: number;
  /** ใบย่อในช่วงเลขนี้ที่ถูกยกเลิก (ส่วนใหญ่ออกใบเต็มแทน) */
  cancelledCount: number;
  buyerName: string | null;
  buyerTaxId: string | null;
  buyerBranchCode: string | null;
  referenceDocNo: string | null;
};

export type SalesTaxEstablishmentTotal = TaxAmounts & {
  locationId: string;
  branchCode: string;
  documentCount: number;
};

export type SalesTaxExceptionKind =
  | "PAID_WITHOUT_TAX_DOCUMENT"
  | "RETURN_WITHOUT_CREDIT_NOTE"
  | "FULL_REPLACES_OTHER_MONTH";

export type SalesTaxException = {
  kind: SalesTaxExceptionKind;
  locationId: string | null;
  orderId: string;
  at: string;
  amount: number;
  reference: string | null;
  detail: string | null;
};

export type CancelledTaxDocument = {
  locationId: string;
  docType: TaxDocKind;
  docNo: string;
  issueDate: string;
  cancelledAt: string;
  reason: string | null;
  grandTotal: number;
};

export type SalesTaxReport = {
  seller: { name: string; taxId: string | null; vatRegistered: boolean; calendarEra: "BE" | "CE" };
  period: { from: string; to: string };
  establishments: SalesTaxEstablishment[];
  rows: SalesTaxRow[];
  totals: SalesTaxEstablishmentTotal[];
  grandTotal: TaxAmounts & { documentCount: number };
  exceptions: SalesTaxException[];
  /** จำนวนจริงก่อนตัดตามเพดาน — ถ้ามากกว่าที่แสดง รายงานต้องบอก */
  exceptionCounts: Record<SalesTaxExceptionKind, number>;
  cancelled: CancelledTaxDocument[];
};

type DocRow = {
  doc_type: TaxDocKind;
  location_id: string;
  branch_code: string;
  device_id: string | null;
  device_code: string | null;
  doc_no: string;
  issue_date: string;
  issued_at: Date;
  cancelled_at: Date | null;
  buyer_name: string | null;
  buyer_tax_id: string | null;
  buyer_branch_code: string | null;
  reference_doc_no: string | null;
  taxable_amount: string;
  exempt_amount: string;
  vat_amount: string;
  rounding_amount: string;
  grand_total: string;
  cancelled_reason: string | null;
};

function amountsOfRow(r: DocRow): TaxAmounts {
  return taxAmountsOf({
    docType: r.doc_type,
    taxableAmount: Number(r.taxable_amount),
    exemptAmount: Number(r.exempt_amount),
    vatAmount: Number(r.vat_amount),
    roundingAmount: Number(r.rounding_amount),
  });
}

export async function getSalesTaxReport(
  tenantId: string,
  input: { from: string; to: string; locationId?: string | null }
): Promise<SalesTaxReport> {
  const { from, to } = assertTaxPeriod(input.from, input.to);
  const locationId = input.locationId ?? null;

  const [settings, sellerRes, locRes, docRes] = await Promise.all([
    getVatSettings(tenantId),
    query<{ name: string; tax_id: string | null }>(
      `SELECT t.name, s.tax_id FROM bms_tenants t
         LEFT JOIN bms_store_profile s ON s.tenant_id = t.id
        WHERE t.id = $1`,
      [tenantId]
    ),
    query<any>(
      `SELECT id, code, name, branch_code, is_head_office, address
         FROM bms_locations
        WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
        ORDER BY is_head_office DESC, branch_code, code`,
      [tenantId, locationId]
    ),
    query<DocRow>(
      `SELECT d.doc_type, d.location_id, l.branch_code, d.device_id, dev.code AS device_code,
              d.doc_no, d.issue_date::text AS issue_date, d.issued_at, d.cancelled_at, d.cancelled_reason,
              d.buyer_name, d.buyer_tax_id, d.buyer_branch_code,
              ref.doc_no AS reference_doc_no,
              d.taxable_amount, d.exempt_amount, d.vat_amount, d.rounding_amount, d.grand_total
         FROM bms_tax_documents d
         JOIN bms_locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
         LEFT JOIN bms_pos_devices dev ON dev.tenant_id = d.tenant_id AND dev.id = d.device_id
         LEFT JOIN bms_tax_documents ref ON ref.tenant_id = d.tenant_id AND ref.id = d.references_document_id
        WHERE d.tenant_id = $1
          AND d.issue_date BETWEEN $2::date AND $3::date
          AND ($4::uuid IS NULL OR d.location_id = $4::uuid)
        ORDER BY d.issue_date, l.branch_code, d.issued_at, d.doc_no`,
      [tenantId, from, to, locationId]
    ),
  ]);

  if (locationId && !locRes.rowCount) throw new Error("ไม่พบสาขานี้ หรือสาขาไม่ได้อยู่ในร้านปัจจุบัน");

  const establishments: SalesTaxEstablishment[] = locRes.rows.map((r: any) => ({
    locationId: r.id,
    code: r.code,
    name: r.name,
    branchCode: r.branch_code,
    isHeadOffice: Boolean(r.is_head_office),
    address: r.address ?? null,
  }));

  // ---- แถวของรายงาน ----
  const rows: SalesTaxRow[] = [];
  const cancelled: CancelledTaxDocument[] = [];
  // ใบย่อ: สรุปต่อ (วัน, สาขา, เครื่อง) — เก็บลำดับตามเวลาออก เลขแรก/เลขสุดท้ายจึงเป็นช่วงจริง
  const abbrGroups = new Map<string, { row: SalesTaxRow; amounts: TaxAmounts[] }>();

  for (const r of docRes.rows) {
    if (r.cancelled_at) {
      cancelled.push({
        locationId: r.location_id,
        docType: r.doc_type,
        docNo: r.doc_no,
        issueDate: r.issue_date,
        cancelledAt: iso(r.cancelled_at),
        reason: r.cancelled_reason,
        grandTotal: Number(r.grand_total),
      });
    }

    if (r.doc_type === "ABBREVIATED") {
      const key = `${r.issue_date}|${r.location_id}|${r.device_id ?? ""}`;
      let g = abbrGroups.get(key);
      if (!g) {
        g = {
          row: {
            kind: "ABBREVIATED_DAY",
            issueDate: r.issue_date,
            locationId: r.location_id,
            branchCode: r.branch_code,
            deviceCode: r.device_code,
            docNoFrom: r.doc_no,
            docNoTo: r.doc_no,
            docCount: 0,
            cancelledCount: 0,
            buyerName: null,
            buyerTaxId: null,
            buyerBranchCode: null,
            referenceDocNo: null,
            base: 0, exempt: 0, vat: 0, total: 0, rounding: 0,
          },
          amounts: [],
        };
        abbrGroups.set(key, g);
        rows.push(g.row);
      }
      g.row.docNoTo = r.doc_no;
      if (r.cancelled_at) {
        g.row.cancelledCount += 1;
      } else {
        g.row.docCount += 1;
        g.amounts.push(amountsOfRow(r));
      }
      continue;
    }

    if (r.cancelled_at) continue;
    rows.push({
      kind: r.doc_type === "FULL" ? "FULL" : "CREDIT_NOTE",
      issueDate: r.issue_date,
      locationId: r.location_id,
      branchCode: r.branch_code,
      deviceCode: r.device_code,
      docNoFrom: r.doc_no,
      docNoTo: r.doc_no,
      docCount: 1,
      cancelledCount: 0,
      buyerName: r.buyer_name,
      buyerTaxId: r.buyer_tax_id,
      buyerBranchCode: r.buyer_branch_code,
      referenceDocNo: r.reference_doc_no,
      ...amountsOfRow(r),
    });
  }
  for (const g of abbrGroups.values()) Object.assign(g.row, sumTaxAmounts(g.amounts));
  // วันที่ละวันไม่มีใบย่อที่นับได้เลย (ถูกยกเลิกทั้งหมด) ยังคงแถวไว้ — ช่วงเลขต้องต่อเนื่อง

  // ---- ยอดรวมต่อสถานประกอบการ ----
  const totals: SalesTaxEstablishmentTotal[] = establishments.map((e) => {
    const mine = rows.filter((r) => r.locationId === e.locationId);
    return {
      locationId: e.locationId,
      branchCode: e.branchCode,
      documentCount: mine.reduce((n, r) => n + r.docCount, 0),
      ...sumTaxAmounts(mine),
    };
  });
  const grandTotal = {
    ...sumTaxAmounts(rows),
    documentCount: rows.reduce((n, r) => n + r.docCount, 0),
  };

  // ---- สิ่งที่ต้องตรวจสอบ ----
  const exceptions: SalesTaxException[] = [];
  const exceptionCounts: Record<SalesTaxExceptionKind, number> = {
    PAID_WITHOUT_TAX_DOCUMENT: 0,
    RETURN_WITHOUT_CREDIT_NOTE: 0,
    FULL_REPLACES_OTHER_MONTH: 0,
  };

  if (settings.vatRegistered) {
    const [paid, returns] = await Promise.all([
      query<any>(
        `SELECT o.id, o.location_id, o.channel, o.status, o.total_amount,
                COALESCE(o.paid_at, o.created_at) AS at, count(*) OVER () AS total_count
           FROM bms_orders o
          WHERE o.tenant_id = $1
            AND o.status = ANY($5::text[])
            AND o.total_amount > 0
            AND ($4::uuid IS NULL OR o.location_id = $4::uuid)
            AND COALESCE(o.paid_at, o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND COALESCE(o.paid_at, o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND NOT EXISTS (
              SELECT 1 FROM bms_tax_documents d
               WHERE d.tenant_id = o.tenant_id AND d.order_id = o.id
                 AND d.doc_type IN ('ABBREVIATED', 'FULL') AND d.cancelled_at IS NULL
            )
          ORDER BY at
          LIMIT $6`,
        [tenantId, from, to, locationId, PAID_ORDER_STATUSES, EXCEPTION_LIMIT]
      ),
      // คืนของที่บิลต้นทางมีใบกำกับ แต่ไม่มีใบลดหนี้ของการคืนครั้งนั้น
      // (ensurePosReturnCreditNote ใส่ [posReturnId] ท้าย credit_reason ทุกครั้ง)
      query<any>(
        `SELECT r.id, r.order_id, o.location_id, r.refund_amount, r.created_at AS at,
                count(*) OVER () AS total_count
           FROM bms_pos_returns r
           JOIN bms_orders o ON o.tenant_id = r.tenant_id AND o.id = r.order_id
          WHERE r.tenant_id = $1
            AND r.is_void = FALSE
            AND r.refund_amount > 0
            AND ($4::uuid IS NULL OR o.location_id = $4::uuid)
            AND r.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND r.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND EXISTS (
              SELECT 1 FROM bms_tax_documents d
               WHERE d.tenant_id = r.tenant_id AND d.order_id = r.order_id
                 AND d.doc_type IN ('ABBREVIATED', 'FULL')
            )
            AND NOT EXISTS (
              SELECT 1 FROM bms_tax_documents cn
               WHERE cn.tenant_id = r.tenant_id AND cn.order_id = r.order_id
                 AND cn.doc_type = 'CREDIT_NOTE' AND cn.cancelled_at IS NULL
                 AND cn.credit_reason LIKE '%[' || r.id::text || ']%'
            )
          ORDER BY r.created_at
          LIMIT $5`,
        [tenantId, from, to, locationId, EXCEPTION_LIMIT]
      ),
    ]);

    exceptionCounts.PAID_WITHOUT_TAX_DOCUMENT = paid.rows.length ? Number(paid.rows[0].total_count) : 0;
    for (const r of paid.rows) {
      exceptions.push({
        kind: "PAID_WITHOUT_TAX_DOCUMENT",
        locationId: r.location_id,
        orderId: r.id,
        at: iso(r.at),
        amount: Number(r.total_amount),
        reference: r.channel ?? null,
        detail: r.status,
      });
    }
    exceptionCounts.RETURN_WITHOUT_CREDIT_NOTE = returns.rows.length ? Number(returns.rows[0].total_count) : 0;
    for (const r of returns.rows) {
      exceptions.push({
        kind: "RETURN_WITHOUT_CREDIT_NOTE",
        locationId: r.location_id,
        orderId: r.order_id,
        at: iso(r.at),
        amount: Number(r.refund_amount),
        reference: r.id,
        detail: null,
      });
    }
  }

  // ใบเต็มในงวดนี้ที่ออกแทนใบย่อของเดือนอื่น — ใบย่อนั้นอาจถูกรายงานไปแล้วในงวดก่อน
  // แล้วตอนนี้ถูกยกเลิก ยอดของสองงวดจึงต้องให้นักบัญชีตัดสินว่าจะปรับยังไง
  const replaced = await query<any>(
    `SELECT d.order_id, d.location_id, d.doc_no, d.issue_date::text AS issue_date, d.grand_total,
            a.doc_no AS abbr_doc_no, a.issue_date::text AS abbr_issue_date,
            count(*) OVER () AS total_count
       FROM bms_tax_documents d
       JOIN bms_tax_documents a ON a.tenant_id = d.tenant_id AND a.id = d.replaces_document_id
      WHERE d.tenant_id = $1 AND d.doc_type = 'FULL' AND d.cancelled_at IS NULL
        AND d.issue_date BETWEEN $2::date AND $3::date
        AND ($4::uuid IS NULL OR d.location_id = $4::uuid)
        AND date_trunc('month', a.issue_date) <> date_trunc('month', d.issue_date)
      ORDER BY d.issue_date
      LIMIT $5`,
    [tenantId, from, to, locationId, EXCEPTION_LIMIT]
  );
  exceptionCounts.FULL_REPLACES_OTHER_MONTH = replaced.rows.length ? Number(replaced.rows[0].total_count) : 0;
  for (const r of replaced.rows) {
    exceptions.push({
      kind: "FULL_REPLACES_OTHER_MONTH",
      locationId: r.location_id,
      orderId: r.order_id,
      at: r.issue_date,
      amount: Number(r.grand_total),
      reference: r.doc_no,
      detail: `แทนใบย่อ ${r.abbr_doc_no} ของงวด ${taxMonthOf(r.abbr_issue_date)}`,
    });
  }

  return {
    seller: {
      name: sellerRes.rows[0]?.name ?? "",
      taxId: sellerRes.rows[0]?.tax_id ?? null,
      vatRegistered: settings.vatRegistered,
      calendarEra: settings.calendarEra,
    },
    period: { from, to },
    establishments,
    rows,
    totals,
    grandTotal,
    exceptions,
    exceptionCounts,
    cancelled,
  };
}
