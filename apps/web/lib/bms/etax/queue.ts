// =============================================================
// e-Tax — คิวนำส่ง (7.94)
// -------------------------------------------------------------
// เป้าหมายเดียวของไฟล์นี้: **ไม่มีใบกำกับไหนหายไปเงียบ ๆ**
//
// ทุกใบที่ออกจะมีแถวในคิว เดินทีละสถานะ และเก็บข้อผิดพลาดไว้อ่าน
//   PENDING → BUILT → SIGNED → SENT → ACCEPTED
//                                  └→ REJECTED   (ปลายทางไม่รับ — ต้องแก้เอกสาร)
//   ล้มระหว่างทาง → FAILED + นับครั้ง + เลื่อนเวลาลองใหม่แบบถอยเพิ่มขึ้น
//
// ทำไมไม่ส่งทันทีตอนขาย: เครื่องหน้าร้านต้องขายต่อได้แม้ RD ล่ม การนำส่งเป็น
// งานเบื้องหลังที่ยอมช้าได้ แต่ยอมหายไม่ได้
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "../tenant";
import { etaxEnabledGlobally, resolveProvider, resolveSigner } from "./providers";
import type { EtaxDocumentData } from "./types";
import { buildEtaxXml, validateEtaxDocument } from "./xml";

const MAX_ATTEMPTS = 6;

export type EtaxStatus = "PENDING" | "BUILT" | "SIGNED" | "SENT" | "ACCEPTED" | "REJECTED" | "FAILED";

export type EtaxSubmission = {
  id: string;
  documentId: string;
  docNo: string | null;
  status: EtaxStatus;
  provider: string | null;
  providerRef: string | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  settledAt: string | null;
};

function toISO(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapRow(r: any): EtaxSubmission {
  return {
    id: r.id,
    documentId: r.document_id,
    docNo: r.doc_no ?? null,
    status: r.status,
    provider: r.provider ?? null,
    providerRef: r.provider_ref ?? null,
    attempts: Number(r.attempts),
    lastError: r.last_error ?? null,
    nextAttemptAt: toISO(r.next_attempt_at),
    sentAt: toISO(r.sent_at),
    settledAt: toISO(r.settled_at),
  };
}

/** ร้านนี้เปิด e-Tax ไหม — ต้องเปิดทั้ง env และค่าตั้งของร้าน */
export async function etaxEnabledForTenant(tenantId: string): Promise<boolean> {
  if (!etaxEnabledGlobally()) return false;
  const res = await query<{ etax_enabled: boolean }>(
    `SELECT etax_enabled FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  return res.rows[0]?.etax_enabled === true;
}

/**
 * เข้าคิว — เรียกทุกครั้งที่ออกใบกำกับ
 * เอกสารเดิมเข้าซ้ำได้ (ON CONFLICT) เพราะ 1 เอกสาร = 1 แถว ห้ามส่งซ้ำ
 * ปิด e-Tax อยู่ก็ไม่เข้าคิว — เปิดทีหลังแล้วค่อย backfill ได้จาก bms_tax_documents
 */
export async function enqueueTaxDocument(
  tenantId: string,
  documentId: string,
  client?: PoolClient
): Promise<void> {
  if (!(await etaxEnabledForTenant(tenantId))) return;
  const sql = `INSERT INTO bms_etax_submissions (tenant_id, document_id, status)
               VALUES ($1, $2, 'PENDING')
               ON CONFLICT (document_id) DO NOTHING`;
  // ต้องเข้าคิวใน "ทรานแซกชันเดียวกับที่สร้างเอกสาร" เมื่อผู้เรียกอยู่ในทรานแซกชัน
  // ไม่งั้น FK ชี้ไปหาแถวที่ยังไม่ commit → ล้มทุกครั้งอย่างเงียบ ๆ
  // และบิลหน้าร้านจะไม่เคยเข้าคิวเลยสักใบ
  if (client) await client.query(sql, [tenantId, documentId]);
  else await query(sql, [tenantId, documentId]);
}

/** ดึงข้อมูลเอกสาร + รายการ มาประกอบ XML */
async function loadDocumentData(tenantId: string, documentId: string): Promise<EtaxDocumentData | null> {
  const res = await query<any>(
    `SELECT d.id, d.doc_type, d.doc_no, d.issue_date, d.order_id,
            d.buyer_name, d.buyer_tax_id, d.buyer_branch_code, d.buyer_address,
            d.taxable_amount, d.exempt_amount, d.vat_amount, d.vat_rate, d.grand_total,
            prev.doc_no AS replaces_doc_no,
            s.store_name, s.tax_id AS seller_tax_id, s.address AS seller_address,
            s.etax_operator_id,
            l.branch_code
       FROM bms_tax_documents d
       JOIN bms_locations l ON l.id = d.location_id
       LEFT JOIN bms_store_profile s ON s.tenant_id = d.tenant_id
       LEFT JOIN bms_tax_documents prev ON prev.id = d.replaces_document_id
      WHERE d.tenant_id = $1 AND d.id = $2`,
    [tenantId, documentId]
  );
  const d = res.rows[0];
  if (!d) return null;

  const items = await query<any>(
    `SELECT product_sku, product_name, size, qty, unit_price, vat_category,
            pack_unit_name, pack_qty, pack_unit_price
       FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2 ORDER BY id`,
    [tenantId, d.order_id]
  );

  return {
    documentId: d.id,
    docType: d.doc_type,
    docNo: d.doc_no,
    issueDate: String(d.issue_date instanceof Date ? d.issue_date.toISOString().slice(0, 10) : d.issue_date).slice(0, 10),
    operatorId: d.etax_operator_id ?? null,
    seller: {
      name: d.store_name ?? "",
      taxId: d.seller_tax_id ?? "",
      branchCode: d.branch_code ?? "00000",
      address: d.seller_address ?? null,
    },
    buyer: {
      name: d.buyer_name ?? null,
      taxId: d.buyer_tax_id ?? null,
      branchCode: d.buyer_branch_code ?? null,
      address: d.buyer_address ?? null,
    },
    lines: items.rows.map((r: any, i: number) => ({
      lineNo: i + 1,
      sku: r.product_sku,
      name: r.product_name + (r.size && r.size !== "-" ? ` (${r.size})` : ""),
      qty: r.pack_qty ?? Number(r.qty),
      unitName: r.pack_unit_name ?? null,
      unitPrice: Number(r.pack_unit_price ?? r.unit_price),
      amount: Number(r.pack_unit_price ?? r.unit_price) * Number(r.pack_qty ?? r.qty),
      vatCategory: (r.vat_category ?? "UNKNOWN") as "V" | "N" | "UNKNOWN",
    })),
    taxableAmount: Number(d.taxable_amount),
    exemptAmount: Number(d.exempt_amount),
    vatAmount: Number(d.vat_amount),
    vatRate: Number(d.vat_rate),
    grandTotal: Number(d.grand_total),
    replacesDocNo: d.replaces_doc_no ?? null,
  };
}

/** ถอยเพิ่มขึ้นทีละเท่าตัว: 1, 2, 4, 8… นาที — RD ล่มชั่วคราวไม่ควรถูกถล่มซ้ำ */
function backoffMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1), 60);
}

export type ProcessResult = { processed: number; accepted: number; failed: number; rejected: number };

/**
 * เดินคิวหนึ่งรอบ — เรียกจาก cron
 * ล็อกแถวด้วย FOR UPDATE SKIP LOCKED เพื่อให้รันซ้อนกันได้โดยไม่ส่งซ้ำ
 */
export async function processEtaxQueue(tenantId: string, limit = 20): Promise<ProcessResult> {
  const out: ProcessResult = { processed: 0, accepted: 0, failed: 0, rejected: 0 };
  if (!(await etaxEnabledForTenant(tenantId))) return out;

  const signer = resolveSigner();

  for (let i = 0; i < limit; i++) {
    const client = await getClient();
    let claimedId: string | null = null;
    try {
      await beginTenantTx(client, tenantId);
      const claim = await client.query<{ id: string; document_id: string; attempts: number }>(
        `SELECT id, document_id, attempts FROM bms_etax_submissions
          WHERE tenant_id = $1
            AND status IN ('PENDING', 'BUILT', 'SIGNED', 'FAILED')
            AND attempts < $2
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [tenantId, MAX_ATTEMPTS]
      );
      if (!claim.rowCount) {
        await client.query("ROLLBACK");
        break;
      }
      claimedId = claim.rows[0].id;
      // จองไว้ก่อนออกจากทรานแซกชัน — รอบถัดไปจะไม่หยิบซ้ำ
      await client.query(
        `UPDATE bms_etax_submissions
            SET attempts = attempts + 1, next_attempt_at = now() + ($2 || ' minutes')::interval,
                updated_at = now()
          WHERE id = $1`,
        [claimedId, String(backoffMinutes(claim.rows[0].attempts + 1))]
      );
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }

    if (!claimedId) break;
    out.processed++;

    const row = await query<{ document_id: string }>(
      `SELECT document_id FROM bms_etax_submissions WHERE id = $1`,
      [claimedId]
    );
    const documentId = row.rows[0]?.document_id;

    try {
      const doc = await loadDocumentData(tenantId, documentId);
      if (!doc) throw new Error("ไม่พบเอกสารภาษีที่อ้างถึง");

      const problems = validateEtaxDocument(doc);
      if (problems.length > 0) {
        // ข้อมูลผิดตั้งแต่ต้น ลองใหม่กี่ครั้งก็ไม่ผ่าน → REJECTED ไม่ใช่ FAILED
        await query(
          `UPDATE bms_etax_submissions
              SET status = 'REJECTED', last_error = $2, settled_at = now(),
                  next_attempt_at = NULL, updated_at = now()
            WHERE id = $1`,
          [claimedId, problems.join(" · ")]
        );
        out.rejected++;
        continue;
      }

      const xml = buildEtaxXml(doc);
      await query(
        `UPDATE bms_etax_submissions SET xml = $2, status = 'BUILT', built_at = now(), updated_at = now() WHERE id = $1`,
        [claimedId, xml]
      );

      const signed = await signer.sign(xml, tenantId);
      await query(
        `UPDATE bms_etax_submissions
            SET signed_xml = $2, status = 'SIGNED', signed_at = now(), updated_at = now()
          WHERE id = $1`,
        [claimedId, signed.signedXml]
      );

      const provider = resolveProvider(null);
      await query(
        `UPDATE bms_etax_submissions SET provider = $2, status = 'SENT', sent_at = now(), updated_at = now() WHERE id = $1`,
        [claimedId, provider.name]
      );

      const result = await provider.submit(signed.signedXml, doc, tenantId);
      if (result.status === "ACCEPTED") {
        await query(
          `UPDATE bms_etax_submissions
              SET status = 'ACCEPTED', provider_ref = $2, settled_at = now(),
                  next_attempt_at = NULL, last_error = NULL, updated_at = now()
            WHERE id = $1`,
          [claimedId, result.providerRef]
        );
        out.accepted++;
      } else if (result.status === "REJECTED") {
        await query(
          `UPDATE bms_etax_submissions
              SET status = 'REJECTED', provider_ref = $2, last_error = $3,
                  settled_at = now(), next_attempt_at = NULL, updated_at = now()
            WHERE id = $1`,
          [claimedId, result.providerRef, result.reason]
        );
        out.rejected++;
      } else {
        // ส่งแล้วแต่ยังไม่รู้ผล — ปล่อยไว้ที่ SENT แล้วให้ poll ตามทีหลัง
        await query(
          `UPDATE bms_etax_submissions SET provider_ref = $2, updated_at = now() WHERE id = $1`,
          [claimedId, result.providerRef]
        );
      }
    } catch (e: any) {
      const message = String(e?.message ?? e);
      await query(
        `UPDATE bms_etax_submissions SET status = 'FAILED', last_error = $2, updated_at = now() WHERE id = $1`,
        [claimedId, message]
      );
      out.failed++;
    }
  }

  return out;
}

export async function listEtaxSubmissions(
  tenantId: string,
  opts: { status?: string | null; limit?: number } = {}
): Promise<EtaxSubmission[]> {
  const res = await query(
    `SELECT s.*, d.doc_no
       FROM bms_etax_submissions s
       JOIN bms_tax_documents d ON d.id = s.document_id
      WHERE s.tenant_id = $1 AND ($2::text IS NULL OR s.status = $2)
      ORDER BY s.created_at DESC
      LIMIT $3`,
    [tenantId, opts.status ?? null, Math.min(Math.max(opts.limit ?? 100, 1), 500)]
  );
  return res.rows.map(mapRow);
}

export type EtaxSummary = {
  enabled: boolean;
  pending: number;
  sent: number;
  accepted: number;
  rejected: number;
  failed: number;
  /** ใบกำกับที่ออกแล้วแต่ยังไม่เคยเข้าคิว — ช่องโหว่ที่ต้องเห็น */
  notQueued: number;
};

export async function getEtaxSummary(tenantId: string): Promise<EtaxSummary> {
  const enabled = await etaxEnabledForTenant(tenantId);
  const res = await query<any>(
    `SELECT
       count(*) FILTER (WHERE s.status IN ('PENDING','BUILT','SIGNED','FAILED')) AS pending,
       count(*) FILTER (WHERE s.status = 'SENT')     AS sent,
       count(*) FILTER (WHERE s.status = 'ACCEPTED') AS accepted,
       count(*) FILTER (WHERE s.status = 'REJECTED') AS rejected,
       count(*) FILTER (WHERE s.status = 'FAILED')   AS failed,
       (SELECT count(*) FROM bms_tax_documents d
         WHERE d.tenant_id = $1 AND d.cancelled_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM bms_etax_submissions x WHERE x.document_id = d.id)
       ) AS not_queued
     FROM bms_etax_submissions s WHERE s.tenant_id = $1`,
    [tenantId]
  );
  const r = res.rows[0] ?? {};
  return {
    enabled,
    pending: Number(r.pending ?? 0),
    sent: Number(r.sent ?? 0),
    accepted: Number(r.accepted ?? 0),
    rejected: Number(r.rejected ?? 0),
    failed: Number(r.failed ?? 0),
    notQueued: Number(r.not_queued ?? 0),
  };
}

/** เอาใบกำกับที่ออกไปก่อนเปิด e-Tax เข้าคิวย้อนหลัง */
export async function backfillEtaxQueue(tenantId: string, limit = 500): Promise<number> {
  if (!(await etaxEnabledForTenant(tenantId))) return 0;
  const res = await query(
    `INSERT INTO bms_etax_submissions (tenant_id, document_id, status)
     SELECT d.tenant_id, d.id, 'PENDING'
       FROM bms_tax_documents d
      WHERE d.tenant_id = $1 AND d.cancelled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM bms_etax_submissions x WHERE x.document_id = d.id)
      ORDER BY d.issued_at
      LIMIT $2
     ON CONFLICT (document_id) DO NOTHING`,
    [tenantId, Math.min(Math.max(limit, 1), 5000)]
  );
  return res.rowCount ?? 0;
}
