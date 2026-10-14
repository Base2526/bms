import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx, getTenantId } from "./tenant";
import { requirePermission, loadPermissions } from "./permissions";
import { listLocationsForUser } from "./locations";
import { normalizeTaxBuyer } from "./taxBuyer";
import { getFullTaxInvoiceView, getCreditNoteView, nextSequenceInTx, taxClockInTx, taxDocLocationInTx, pgDateToIso } from "./taxDocuments";
import { buildTaxDocNo, creditNotePrefix, fullInvoicePrefix } from "./taxDocumentNumber";
import { getInputVatReport } from "./expenseDocuments";
import { getSalesTaxReport } from "./taxReports";
import { cancelQueuedTaxDocumentInTx } from "./etax/queue";
import { bahtText } from "./vat";

export class TaxControlError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const fail = (message: string): never => { throw new TaxControlError(message, 409); };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function text(value: unknown, max = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value))
    throw new TaxControlError("กรอกข้อมูลให้ครบและไม่เกินกำหนด / Invalid text");
  return value.trim();
}
function cents(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 999999999 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)
    throw new TaxControlError("ยอดต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง / Invalid amount");
  return Math.round(value * 100);
}
export function adjustmentAmounts(input: { base: unknown; exempt: unknown }, rate: number) {
  const base = cents(input.base), exempt = cents(input.exempt);
  const vat = Math.round(base * rate / 100);
  if (base + exempt <= 0 || !Number.isFinite(rate) || rate < 0 || rate > 100) fail("ยอดปรับต้องมากกว่า 0 / Positive adjustment required");
  return { taxable: (base + vat) / 100, exempt: exempt / 100, vat: vat / 100, total: (base + vat + exempt) / 100 };
}
export function assertAdjustmentEventDate(eventDate: unknown, today: string, delayedReason: unknown) {
  const date = typeof eventDate === "string" ? eventDate : "";
  const parsed = new Date(`${date}T00:00:00Z`);
  const previous = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > today || date < previous.toISOString().slice(0, 10))
    fail("วันที่เกิดเหตุต้องอยู่เดือนนี้หรือเดือนก่อนและไม่เป็นอนาคต / Invalid adjustment event date");
  if (date.slice(0, 7) !== today.slice(0, 7)) text(delayedReason);
  return date;
}
function controlBuyer(raw: unknown) {
  try { return normalizeTaxBuyer(raw && typeof raw === "object" ? raw : {}); }
  catch (error) { throw new TaxControlError((error as Error).message); }
}
async function audit(client: PoolClient, tenant: string, actor: string, target: string, action: string) {
  await client.query(`INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
    VALUES ($1,$2,$3,$4,'{}'::jsonb)`, [tenant, actor, `tax.${action}`, target]);
}
async function scope(ctx: any, permission: "tax.document.view" | "tax.document.issue" | "tax.document.adjust" | "tax.period.close") {
  await requirePermission(ctx, permission);
  const tenant = getTenantId(ctx), actor = String(ctx.admin.id);
  return { tenant, actor, locations: (await listLocationsForUser(tenant, actor)).map(l => l.id) };
}

/** Read action/period archives through a tenant transaction: the new ledgers fail closed under RLS. */
export async function listTaxControls(ctx: any, month: string, locationId?: string | null) {
  const { tenant, actor, locations } = await scope(ctx, "tax.document.view");
  const canReadPurchase = (await loadPermissions(ctx)).has("expense.view");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new TaxControlError("Invalid month");
  if (locationId && (!uuid(locationId) || !locations.includes(locationId))) throw new TaxControlError("Not found", 404);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenant, { editorId: actor });
    const actions = await client.query(`SELECT a.id,a.action,a.reason,a.actor_name,a.copy_number,a.issue_date::text,
      d.doc_no,a.result_document_id FROM bms_tax_document_actions a
      JOIN bms_tax_documents d ON d.tenant_id=a.tenant_id AND d.id=a.document_id
      WHERE a.tenant_id=$1 AND a.location_id=ANY($2::uuid[]) AND ($3::uuid IS NULL OR a.location_id=$3)
      AND a.issue_date >= ($4 || '-01')::date AND a.issue_date < (($4 || '-01')::date + interval '1 month')
      ORDER BY a.issued_at DESC,a.id LIMIT 200`, [tenant, locations, locationId ?? null, month]);
    const periods = canReadPurchase ? await client.query(`SELECT id,location_id,tax_month,version,report_hash,reason,created_at
      FROM bms_tax_period_snapshots WHERE tenant_id=$1 AND location_id=ANY($2::uuid[])
      AND ($3::uuid IS NULL OR location_id=$3) AND tax_month=$4 ORDER BY created_at DESC LIMIT 200`, [tenant, locations, locationId ?? null, month]) : { rows: [] };
    await client.query("COMMIT");
    return { actions: actions.rows, periods: periods.rows, limit: 200 };
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
}

export async function readTaxControlArchive(ctx: any, id: string, period: boolean) {
  const { tenant, actor, locations } = await scope(ctx, "tax.document.view");
  if (period) await requirePermission(ctx, "expense.view");
  if (!uuid(id)) throw new TaxControlError("Not found", 404);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenant, { editorId: actor });
    const table = period ? "bms_tax_period_snapshots" : "bms_tax_document_actions";
    const result = await client.query(`SELECT snapshot FROM ${table}
      WHERE tenant_id=$1 AND id=$2 AND location_id=ANY($3::uuid[])`, [tenant, id, locations]);
    if (!result.rows[0]) throw new TaxControlError("Not found", 404);
    const snapshot = result.rows[0].snapshot;
    let drifted = false;
    if (period) {
      const locationId = snapshot.report.establishments[0]?.locationId;
      if (!locations.includes(locationId)) throw new TaxControlError("Not found", 404);
      const input = { from: `${snapshot.month}-01`, to: `${snapshot.month}-01`, locationId, allowedLocationIds: locations };
      const report = await getSalesTaxReport(tenant, input, client);
      const purchaseReport = await getInputVatReport(tenant, input, client);
      drifted = digest({ report, purchaseReport }) !== digest({ report: snapshot.report, purchaseReport: snapshot.purchaseReport });
    }
    await client.query("COMMIT");
    return period ? { ...snapshot, drifted } : snapshot;
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
}

/** Preview and confirmation run the same calculation under locks. No client-computed totals are trusted. */
export async function executeTaxControl(ctx: any, raw: any) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TaxControlError("Invalid request");
  const action = raw.action;
  if (!["SUBSTITUTE", "CORRECT", "CREDIT", "DEBIT", "CLOSE"].includes(action)) throw new TaxControlError("Invalid action");
  const { tenant, actor, locations } = await scope(ctx, action === "CLOSE" ? "tax.period.close" : action === "SUBSTITUTE" ? "tax.document.issue" : "tax.document.adjust");
  if (action === "CLOSE") await requirePermission(ctx, "expense.view");
  const reason = text(raw.reason), key = text(raw.idempotencyKey, 100);
  const input = {
    action, reason, idempotencyKey: key,
    documentId: raw.documentId ?? null, locationId: raw.locationId ?? null, month: raw.month ?? null,
    evidence: action === "CLOSE" ? null : text(raw.evidence),
    buyer: action === "CORRECT" ? controlBuyer(raw.buyer) : null,
    base: raw.base ?? 0, exempt: raw.exempt ?? 0,
    eventDate: raw.eventDate ?? null, delayedReason: raw.delayedReason ?? "",
    originalReturned: raw.originalReturned === true,
  };
  const requestHash = digest(input), client = await getClient();
  try {
    await beginTenantTx(client, tenant, { editorId: actor, serializable: true });
    // Keys span action kinds: retries cannot change document, amounts or operation.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`tax-control:${tenant}:${key}`]);
    const old = await client.query(`SELECT id,request_hash,snapshot,location_id FROM bms_tax_document_actions WHERE tenant_id=$1 AND idempotency_key=$2
      UNION ALL SELECT id,request_hash,snapshot,location_id FROM bms_tax_period_snapshots WHERE tenant_id=$1 AND idempotency_key=$2`, [tenant, key]);
    if (old.rows[0]) {
      if (!locations.includes(old.rows[0].location_id)) throw new TaxControlError("Not found", 404);
      if (old.rows[0].request_hash !== requestHash) fail("คำขอเดิมมีข้อมูลต่างกัน / Idempotency conflict");
      await client.query("COMMIT");
      return { status: "COMPLETED", id: old.rows[0].id, snapshot: old.rows[0].snapshot };
    }
    const clock = await taxClockInTx(client);
    const user = await client.query(`SELECT name FROM users WHERE id=$1`, [actor]);
    const actorName = user.rows[0]?.name || actor;
    let locationId: string, document: any, view: any, copyNumber: number | null = null;
    let proposed: any;
    if (action === "CLOSE") {
      locationId = input.locationId;
      if (!uuid(locationId) || !locations.includes(locationId)) throw new TaxControlError("Not found", 404);
      if (typeof input.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) || input.month >= clock.isoDate.slice(0, 7))
        fail("ปิดได้เฉพาะเดือนที่สิ้นสุดแล้ว / Only completed months can be closed");
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`tax-period:${tenant}:${locationId}:${input.month}`]);
      const report = await getSalesTaxReport(tenant, { from: `${input.month}-01`, to: `${input.month}-01`, locationId, allowedLocationIds: locations }, client);
      if (Object.values(report.exceptionCounts).some(n => n > 0)) fail("กรุณาแก้รายการผิดปกติในรายงานก่อนปิดงวด / Resolve report exceptions first");
      const versions = await client.query(`SELECT COALESCE(MAX(version),0)+1 AS version FROM bms_tax_period_snapshots WHERE tenant_id=$1 AND location_id=$2 AND tax_month=$3`, [tenant, locationId, input.month]);
      const purchaseReport = await getInputVatReport(tenant, { from: `${input.month}-01`, to: `${input.month}-01`, locationId, allowedLocationIds: locations }, client);
      proposed = { action, month: input.month, version: Number(versions.rows[0].version), report, purchaseReport, reason, actorName };
    } else {
      if (!uuid(input.documentId)) throw new TaxControlError("Not found", 404);
      // Same order-first lock order as invoice issuance / POS return.
      const order = await client.query(`SELECT o.id,o.status,o.voided_at FROM bms_orders o
        JOIN bms_tax_documents d ON d.tenant_id=o.tenant_id AND d.order_id=o.id
        WHERE d.tenant_id=$1 AND d.id=$2 AND d.location_id=ANY($3::uuid[]) FOR UPDATE OF o`, [tenant, input.documentId, locations]);
      if (!order.rows[0]) throw new TaxControlError("Not found", 404);
      document = (await client.query(`SELECT * FROM bms_tax_documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenant, input.documentId])).rows[0];
      if (document.cancelled_at || document.doc_type === "ABBREVIATED") fail("ต้องใช้เอกสารเต็มที่ยังใช้งาน / Active full document required");
      locationId = document.location_id;
      view = document.doc_type === "FULL"
        ? await getFullTaxInvoiceView(tenant, document.id, locations, client)
        : document.print_snapshot ?? await getCreditNoteView(tenant, document.id, locations, client);
      if (!view) fail("ไม่พบข้อมูลสำหรับพิมพ์ / Print data unavailable");
      // Paper controls must not silently rewrite externally submitted electronic documents.
      const electronic = await client.query(`SELECT etax_enabled FROM bms_store_profile WHERE tenant_id=$1`, [tenant]);
      if (electronic.rows[0]?.etax_enabled) fail("ร้านเปิด e-Tax กรุณาใช้ขั้นตอนของผู้ให้บริการ / Use the e-Tax provider workflow");
      const external = await client.query(`SELECT 1 FROM bms_etax_submissions WHERE tenant_id=$1 AND document_id=$2 AND status NOT IN ('CANCELLED','REJECTED') LIMIT 1 FOR UPDATE`, [tenant, document.id]);
      if (external.rowCount) fail("เอกสารนำส่ง e-Tax แล้ว ต้องดำเนินการผ่านผู้ให้บริการ / Use the e-Tax provider correction workflow");
      if (action === "SUBSTITUTE") {
        copyNumber = Number((await client.query(`SELECT COALESCE(MAX(copy_number),0)+1 AS n FROM bms_tax_document_actions WHERE tenant_id=$1 AND document_id=$2`, [tenant, document.id])).rows[0].n);
        proposed = { action, documentType: document.doc_type, document: view, copyNumber, issueDate: clock.isoDate, reason, evidence: input.evidence, actorName };
      } else {
        if (document.doc_type !== "FULL") fail("เลือกใบกำกับเต็มรูปต้นทาง / Select the original full invoice");
        const returned = await client.query(`SELECT 1 FROM bms_pos_returns WHERE tenant_id=$1 AND order_id=$2 AND is_void=FALSE LIMIT 1`, [tenant, document.order_id]);
        if (order.rows[0].status !== "COMPLETED" || order.rows[0].voided_at || returned.rowCount)
          fail("บิลต้อง COMPLETED และไม่เคย void/คืน / Bill must be completed without voids or returns");
        if (!view.seller?.name || !view.seller?.address || !view.seller?.taxId || !view.buyer?.name || !view.buyer?.address)
          fail("ข้อมูลเอกสารเดิมไม่ครบ กรุณาให้บัญชีตรวจ / Original identity is incomplete");
        const prior = await client.query(`SELECT COALESCE(SUM(CASE WHEN doc_type='DEBIT_NOTE' THEN taxable_amount ELSE -taxable_amount END),0) AS taxable,
          COALESCE(SUM(CASE WHEN doc_type='DEBIT_NOTE' THEN exempt_amount ELSE -exempt_amount END),0) AS exempt,
          COALESCE(SUM(CASE WHEN doc_type='DEBIT_NOTE' THEN vat_amount ELSE -vat_amount END),0) AS vat,
          COALESCE(SUM(CASE WHEN doc_type='DEBIT_NOTE' THEN grand_total ELSE -grand_total END),0) AS total, COUNT(*)::int AS count
          FROM bms_tax_documents WHERE tenant_id=$1 AND references_document_id=$2 AND cancelled_at IS NULL`, [tenant, document.id]);
        const adjusted = prior.rows[0];
        if (action === "CORRECT") {
          if (!input.originalReturned) fail("ต้องรับคืนและขีดฆ่าต้นฉบับก่อน / Confirm the original was recovered and cancelled");
          const returns = await client.query(`SELECT 1 FROM bms_pos_returns WHERE tenant_id=$1 AND order_id=$2 AND is_void=FALSE LIMIT 1`, [tenant, document.order_id]);
          if (order.rows[0].status !== "COMPLETED" || order.rows[0].voided_at || returns.rowCount || adjusted.count > 0)
            fail("บิลที่ void/คืน/ปรับยอดแล้วแก้ผู้ซื้อผ่านช่องทางนี้ไม่ได้ / Bill has returns or adjustments");
          proposed = { action, documentType: "FULL", document: { ...view, docNo: undefined, replacesDocNo: document.doc_no, buyer: input.buyer }, originalDocument: view, originalReturned: true, reason, evidence: input.evidence, actorName, issueDate: clock.isoDate };
        } else {
          assertAdjustmentEventDate(input.eventDate, clock.isoDate, input.delayedReason);
          const amounts = adjustmentAmounts(input, Number(document.vat_rate));
          // Adjust each tax bucket independently, never use an exempt amount to hide VAT over-credit.
          if ((amounts.taxable > 0 && Number(document.taxable_amount) === 0) || (amounts.exempt > 0 && Number(document.exempt_amount) === 0)) fail("หมวดภาษีไม่ตรงเอกสารเดิม / Tax category absent from original");
          if (action === "CREDIT" && (amounts.taxable > Number(document.taxable_amount) + Number(adjusted.taxable) + 0.001 || amounts.exempt > Number(document.exempt_amount) + Number(adjusted.exempt) + 0.001 || amounts.vat > Number(document.vat_amount) + Number(adjusted.vat) + 0.001)) fail("ลดหนี้เกินยอดคงเหลือ / Credit exceeds remaining balance");
          const originalValue = Number(document.grand_total), before = originalValue + Number(adjusted.total);
          const sign = action === "DEBIT" ? 1 : -1;
          proposed = { action, documentType: action === "DEBIT" ? "DEBIT_NOTE" : "CREDIT_NOTE", reason, evidence: input.evidence, actorName, eventDate: input.eventDate, delayedReason: input.delayedReason,
            document: { orderId: document.order_id, seller: view.seller, buyer: view.buyer, original: { docNo: document.doc_no, docType: "FULL", issueDate: pgDateToIso(document.issue_date) },
              calendarEra: view.calendarEra, reason, issueDate: clock.isoDate, originalValue, previouslyCredited: -Number(adjusted.total), correctValue: before + sign * amounts.total,
              difference: amounts.total, differenceBeforeVat: amounts.taxable - amounts.vat + amounts.exempt, exemptAmount: amounts.exempt, vatAmount: amounts.vat, vatRate: Number(document.vat_rate), amountText: bahtText(amounts.total),
              lines: [{ name: reason, size: "", qty: 1, unit: "รายการ", amount: amounts.total }], lineAdjustment: 0, cancelledAt: null, cancelledReason: null, replacesDocNo: null }, amounts };
        }
      }
    }
    const reviewHash = digest(proposed);
    if (raw.confirmed !== true) { await client.query("ROLLBACK"); return { status: "PREVIEW", reviewHash, snapshot: proposed }; }
    if (raw.reviewHash !== reviewHash) fail("ข้อมูลเปลี่ยน กรุณาตรวจและยืนยันใหม่ / Preview is stale");
    let resultId: string | null = null;
    if (action !== "CLOSE" && action !== "SUBSTITUTE") {
      const kind = action === "CORRECT" ? "FULL" : action === "DEBIT" ? "DEBIT_NOTE" : "CREDIT_NOTE";
      const seq = await nextSequenceInTx(client, { tenantId: tenant, locationId, deviceId: null, docType: kind, periodKey: String(clock.year) });
      const loc = await taxDocLocationInTx(client, tenant, locationId);
      const prefix = kind === "FULL" ? fullInvoicePrefix(loc) : kind === "CREDIT_NOTE" ? creditNotePrefix(loc) : `DN${fullInvoicePrefix(loc) ?? ""}`;
      const docNo = buildTaxDocNo(prefix, clock, seq, view.calendarEra);
      const amounts = action === "CORRECT" ? { taxable: Number(document.taxable_amount), exempt: Number(document.exempt_amount), vat: Number(document.vat_amount), total: Number(document.grand_total) } : proposed.amounts;
      const buyer = action === "CORRECT" ? input.buyer! : view.buyer;
      const date = action === "CORRECT" ? pgDateToIso(document.issue_date) : clock.isoDate;
      if (action === "CORRECT") {
        await client.query(`UPDATE bms_tax_documents SET cancelled_at=now(),cancelled_reason=$3 WHERE tenant_id=$1 AND id=$2`, [tenant, document.id, reason]);
        await cancelQueuedTaxDocumentInTx(client, tenant, document.id, reason);
      }
      const inserted = await client.query(`INSERT INTO bms_tax_documents
        (tenant_id,location_id,order_id,doc_type,doc_no,issue_date,replaces_document_id,references_document_id,
         buyer_name,buyer_tax_id,buyer_branch_code,buyer_address,buyer_phone,seller_name,seller_tax_id,seller_branch_code,seller_address,seller_phone,
         taxable_amount,exempt_amount,vat_amount,grand_total,vat_rate,rounding_amount,issued_by,credit_reason,original_total,adjustment_kind,buyer_vat_registered)
        VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING id`,
        [tenant, locationId, document.order_id, kind, docNo, date, action === "CORRECT" ? document.id : null, action === "CORRECT" ? null : document.id,
          buyer.name, buyer.taxId, buyer.branchCode, buyer.address, buyer.phone, view.seller.name, view.seller.taxId, view.seller.branchCode, view.seller.address, view.seller.phone,
          amounts.taxable, amounts.exempt, amounts.vat, amounts.total, document.vat_rate, action === "CORRECT" ? document.rounding_amount : 0, actor, reason, document.grand_total, action === "CORRECT" ? "CORRECTION" : "PRICE", action === "CORRECT" ? buyer.vatRegistered : document.buyer_vat_registered]);
      resultId = inserted.rows[0].id;
      proposed.document = { ...proposed.document, id: resultId, docNo, issueDate: date, ...(action === "CORRECT" ? { replacesDocNo: document.doc_no } : {}) };
      await client.query(`UPDATE bms_tax_documents SET print_snapshot=$3::jsonb WHERE tenant_id=$1 AND id=$2`, [tenant, resultId, JSON.stringify(proposed.document)]);
    }
    let saved;
    if (action === "CLOSE") {
      saved = await client.query(`INSERT INTO bms_tax_period_snapshots
        (tenant_id,location_id,tax_month,version,idempotency_key,request_hash,report_hash,snapshot,reason,actor_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) RETURNING id`, [tenant, locationId, input.month, proposed.version, key, requestHash, digest({ report: proposed.report, purchaseReport: proposed.purchaseReport }), JSON.stringify(proposed), reason, actor]);
    } else {
      saved = await client.query(`INSERT INTO bms_tax_document_actions
        (tenant_id,location_id,document_id,result_document_id,action,idempotency_key,request_hash,reason,evidence,actor_id,actor_name,copy_number,snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING id`,
        [tenant, locationId, document.id, resultId, action, key, requestHash, reason, input.evidence, actor, actorName, copyNumber, JSON.stringify(proposed)]);
    }
    await audit(client, tenant, actor, saved.rows[0].id, `control.${action.toLowerCase()}`);
    await client.query("COMMIT");
    return { status: "COMPLETED", id: saved.rows[0].id, snapshot: proposed };
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "40001" || error?.code === "40P01") throw new TaxControlError("มีการทำงานพร้อมกัน กรุณาตรวจและยืนยันใหม่ / Retry the same request", 409);
    throw error;
  } finally { client.release(); }
}
