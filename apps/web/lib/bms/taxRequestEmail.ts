import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { sendEmail } from "@/lib/mailer";
import { beginTenantTx } from "./tenant";
import { getFullTaxInvoiceView } from "./taxDocuments";
import { renderTaxInvoicePdf } from "./taxInvoicePdf";
import { taxRequestConfiguration } from "./taxRequestToken";

export class TaxRequestEmailError extends Error { readonly status = 409; }

export function isTaxEmailRecipient(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
}

/** Caller owns the request row lock, branch authorization and explicit human confirmation. */
export async function enqueueTaxRequestEmailInTx(client: PoolClient, input: {
  tenantId: string; requestId: string; documentId: string; recipient: string;
  actor: string; key: string; expectedEmailId?: string | null;
}) {
  if (!isTaxEmailRecipient(input.recipient)) throw new TaxRequestEmailError("อีเมลผู้รับไม่ถูกต้อง");
  const prior = await client.query(
    `SELECT id FROM bms_tax_request_emails WHERE tenant_id=$1 AND request_id=$2 AND idempotency_key=$3`,
    [input.tenantId, input.requestId, input.key]);
  if (prior.rows[0]) return prior.rows[0].id as string;
  const latest = await client.query(
    `SELECT id,status FROM bms_tax_request_emails WHERE tenant_id=$1 AND request_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,
    [input.tenantId, input.requestId]);
  if (input.expectedEmailId !== undefined && (latest.rows[0]?.id ?? null) !== input.expectedEmailId)
    throw new TaxRequestEmailError("สถานะอีเมลเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่");
  if (["PENDING", "SENDING"].includes(latest.rows[0]?.status)) throw new TaxRequestEmailError("มีอีเมลรอส่งอยู่แล้ว");
  const document = await client.query(
    `SELECT id FROM bms_tax_documents WHERE tenant_id=$1 AND id=$2 AND doc_type='FULL' AND cancelled_at IS NULL FOR UPDATE`,
    [input.tenantId, input.documentId]);
  if (!document.rowCount) throw new TaxRequestEmailError("เอกสารถูกยกเลิกหรือไม่พบใบกำกับภาษี");
  const snapshot = await getFullTaxInvoiceView(input.tenantId, input.documentId, null, { query: client.query.bind(client) });
  if (!snapshot) throw new TaxRequestEmailError("ไม่พบใบกำกับภาษี");
  const inserted = await client.query(
    `INSERT INTO bms_tax_request_emails(tenant_id,request_id,document_id,idempotency_key,recipient,invoice_snapshot,requested_by)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`,
    [input.tenantId, input.requestId, input.documentId, input.key, input.recipient, JSON.stringify(snapshot), input.actor]);
  await client.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
     VALUES($1,$2,'tax_request.email_queued',$3,$4::jsonb)`,
    [input.tenantId, input.actor, input.requestId, JSON.stringify({ emailId: inserted.rows[0].id })]);
  return inserted.rows[0].id as string;
}

async function inTenant<T>(tenantId: string, work: (client: PoolClient) => Promise<T>) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

/** No provider call runs inside a DB transaction. Uncertain attempts require reviewed retry. */
export async function processTaxRequestEmail(tenantId: string, emailId?: string, delivery = { render: renderTaxInvoicePdf, send: sendEmail }) {
  if (!taxRequestConfiguration().enabled) return null;
  const job = await inTenant(tenantId, async client => {
    await client.query(
      `UPDATE bms_tax_request_emails SET status='UNKNOWN',error_code='INTERRUPTED',finished_at=now()
       WHERE tenant_id=$1 AND status='SENDING' AND started_at < now()-interval '5 minutes'`, [tenantId]);
    const result = await client.query(
      `SELECT * FROM bms_tax_request_emails WHERE tenant_id=$1 AND status='PENDING'
       AND ($2::uuid IS NULL OR id=$2::uuid) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [tenantId, emailId ?? null]);
    const row = result.rows[0];
    if (!row) return null;
    const document = await client.query(
      `SELECT id FROM bms_tax_documents WHERE tenant_id=$1 AND id=$2 AND cancelled_at IS NULL AND doc_type='FULL'`,
      [tenantId, row.document_id]);
    if (!document.rowCount) {
      await client.query(`UPDATE bms_tax_request_emails SET status='CANCELLED',error_code='DOCUMENT_CANCELLED',finished_at=now() WHERE tenant_id=$1 AND id=$2`, [tenantId, row.id]);
      return null;
    }
    await client.query(`UPDATE bms_tax_request_emails SET status='SENDING',started_at=now() WHERE tenant_id=$1 AND id=$2`, [tenantId, row.id]);
    return row;
  });
  if (!job) return null;
  let status = "FAILED", errorCode: string | null = "PDF_FAILED";
  try {
    const content = await delivery.render(job.invoice_snapshot);
    // Rendering may outlive the claim or a document cancellation. Recheck after it,
    // and commit before contacting the provider (never hold a DB lock over network I/O).
    errorCode = "PRE_SEND_CHECK_FAILED";
    const ready = await inTenant(tenantId, async client => {
      const current = await client.query(
        `SELECT status,started_at < now()-interval '5 minutes' AS expired
         FROM bms_tax_request_emails WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, job.id]);
      const attempt = current.rows[0];
      if (!attempt || attempt.status !== "SENDING") return attempt?.status ?? "UNKNOWN";
      const document = await client.query(
        `SELECT id FROM bms_tax_documents WHERE tenant_id=$1 AND id=$2 AND cancelled_at IS NULL AND doc_type='FULL'`,
        [tenantId, job.document_id]);
      if (!document.rowCount || attempt.expired) {
        const next = !document.rowCount ? "CANCELLED" : "UNKNOWN";
        const code = !document.rowCount ? "DOCUMENT_CANCELLED" : "INTERRUPTED";
        await client.query(
          `UPDATE bms_tax_request_emails SET status=$3,error_code=$4,finished_at=now() WHERE tenant_id=$1 AND id=$2`,
          [tenantId, job.id, next, code]);
        await client.query(`INSERT INTO bms_audit_log(tenant_id,action,target,meta) VALUES($1,'tax_request.email_result',$2,$3::jsonb)`,
          [tenantId, job.request_id, JSON.stringify({ emailId: job.id, status: next, errorCode: code })]);
        return next;
      }
      return "SENDING";
    });
    if (ready !== "SENDING") return { id: job.id, status: ready };
    const docNo = String(job.invoice_snapshot.docNo).replace(/[\r\n]/g, "");
    errorCode = "PROVIDER_RESULT_UNKNOWN";
    status = "UNKNOWN";
    await delivery.send({
      to: job.recipient, subject: `สำเนาใบกำกับภาษี ${docNo}`,
      html: "<p>แนบสำเนาใบกำกับภาษีเต็มรูปตามคำขอของคุณ</p><p>เอกสารนี้เป็นสำเนาสำหรับตรวจสอบ ไม่ใช่ e-Tax Invoice กรุณาติดต่อร้านเพื่อรับต้นฉบับ</p>",
      attachments: [{ filename: `tax-invoice-${docNo.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`, content, mimeType: "application/pdf" }],
    }, { tenantId, category: "other", triggeredBy: "tax-request-email" });
    status = "SENT";
    errorCode = null;
  } catch (error: any) {
    // Definite rejections are retryable failures; a connection/timeout may have delivered.
    if (status === "UNKNOWN" && (/^Missing (SENDGRID|GMAIL)_/.test(error?.message ?? "")
      || ["EAUTH", "EENVELOPE"].includes(error?.code)
      || (Number(error?.code) >= 400 && Number(error?.code) <= 599)
      || (Number(error?.responseCode) >= 400 && Number(error?.responseCode) <= 599))) {
      status = "FAILED";
      errorCode = "PROVIDER_REJECTED";
    }
  }
  const recordedStatus = await inTenant(tenantId, async client => {
    const updated = await client.query(`UPDATE bms_tax_request_emails SET status=$3,error_code=$4,finished_at=now() WHERE tenant_id=$1 AND id=$2 AND status='SENDING' RETURNING status`,
      [tenantId, job.id, status, errorCode]);
    if (!updated.rowCount) {
      const current = await client.query(`SELECT status FROM bms_tax_request_emails WHERE tenant_id=$1 AND id=$2`, [tenantId, job.id]);
      return current.rows[0]?.status ?? "UNKNOWN";
    }
    await client.query(`INSERT INTO bms_audit_log(tenant_id,action,target,meta) VALUES($1,'tax_request.email_result',$2,$3::jsonb)`,
      [tenantId, job.request_id, JSON.stringify({ emailId: job.id, status, errorCode })]);
    return updated.rows[0].status;
  });
  return { id: job.id, status: recordedStatus };
}

export async function runTaxRequestEmailQueue() {
  if (!taxRequestConfiguration().enabled) return { processed: 0 };
  const tenants = await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY id`);
  let processed = 0;
  const deadline = Date.now() + 20_000;
  for (const tenant of tenants.rows) {
    if (Date.now() > deadline) break;
    if (await processTaxRequestEmail(tenant.id)) processed++;
  }
  return { processed };
}
