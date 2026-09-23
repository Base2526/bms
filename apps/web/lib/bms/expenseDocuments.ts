import crypto from "crypto";
import type { PoolClient } from "pg";
import { query, runInTransaction } from "@/lib/db";

export const EXPENSE_CATEGORIES = [
  "INVENTORY", "RENT", "UTILITIES", "INTERNET", "ADVERTISING", "TRANSPORT",
  "REPAIRS", "PROFESSIONAL_FEE", "WAGES", "OTHER",
] as const;
export const EXPENSE_DOCUMENT_KINDS = ["TAX_INVOICE", "RECEIPT", "CASH_BILL", "PAYMENT_VOUCHER"] as const;
export const EXPENSE_PAYEE_TYPES = ["INDIVIDUAL", "JURISTIC"] as const;
export const EXPENSE_WHT_TYPES = ["RENT", "SERVICE", "PROFESSIONAL", "TRANSPORT", "ADVERTISING", "OTHER"] as const;

type Category = (typeof EXPENSE_CATEGORIES)[number];
type DocumentKind = (typeof EXPENSE_DOCUMENT_KINDS)[number];
type PayeeType = (typeof EXPENSE_PAYEE_TYPES)[number];
type WhtType = (typeof EXPENSE_WHT_TYPES)[number];

export type ExpenseDocumentInput = {
  locationId: string;
  category: Category;
  documentKind: DocumentKind;
  supplierId?: string | null;
  payeeName?: string | null;
  payeeTaxId?: string | null;
  payeeBranchCode?: string | null;
  payeeAddress?: string | null;
  payeeType?: PayeeType | null;
  documentNo?: string | null;
  documentDate: string;
  paidAt?: string | null;
  amountBeforeVat: number;
  vatAmount?: number | null;
  vatClaimMonth?: string | null;
  whtIncomeType?: WhtType | null;
  whtRate?: number | null;
  whtAmount?: number | null;
  purchaseOrderId?: string | null;
  evidenceFileId?: number | null;
  note?: string | null;
  idempotencyKey: string;
};

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const taxIdRe = /^\d{13}$/;
const branchRe = /^\d{5}$/;
const clean = (v: string | null | undefined) => v?.trim() || null;
const money = (v: number | null | undefined, name: string) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} ต้องเป็นจำนวนตั้งแต่ 0 ขึ้นไป`);
  return Math.round((n + Number.EPSILON) * 100) / 100;
};
const isOneOf = <T extends string>(v: string, values: readonly T[]): v is T => values.includes(v as T);

function normalizedInput(input: ExpenseDocumentInput) {
  if (!input.locationId) throw new Error("ต้องระบุสถานประกอบการ");
  if (!isOneOf(input.category, EXPENSE_CATEGORIES)) throw new Error("หมวดค่าใช้จ่ายไม่ถูกต้อง");
  if (!isOneOf(input.documentKind, EXPENSE_DOCUMENT_KINDS)) throw new Error("ชนิดเอกสารไม่ถูกต้อง");
  if (!dateRe.test(input.documentDate)) throw new Error("documentDate ต้องเป็น YYYY-MM-DD");
  if (input.paidAt && !dateRe.test(input.paidAt)) throw new Error("paidAt ต้องเป็น YYYY-MM-DD");
  if (input.vatClaimMonth && !dateRe.test(input.vatClaimMonth)) throw new Error("vatClaimMonth ต้องเป็น YYYY-MM-DD");
  const payeeTaxId = clean(input.payeeTaxId);
  const payeeBranchCode = clean(input.payeeBranchCode);
  if (payeeTaxId && !taxIdRe.test(payeeTaxId)) throw new Error("เลขผู้เสียภาษีผู้รับเงินต้องมี 13 หลัก");
  if (payeeBranchCode && !branchRe.test(payeeBranchCode)) throw new Error("รหัสสาขาผู้รับเงินต้องมี 5 หลัก");
  const amountBeforeVat = money(input.amountBeforeVat, "ยอดก่อน VAT");
  const vatAmount = money(input.vatAmount, "VAT");
  const whtAmount = money(input.whtAmount, "ยอดหัก ณ ที่จ่าย");
  const key = clean(input.idempotencyKey);
  if (!key || key.length > 200) throw new Error("idempotencyKey ไม่ถูกต้อง");
  if (vatAmount > 0 && input.documentKind !== "TAX_INVOICE") throw new Error("ขอภาษีซื้อได้เฉพาะใบกำกับภาษี");
  if ((vatAmount > 0) !== Boolean(input.vatClaimMonth)) throw new Error("VAT และเดือนที่ใช้สิทธิ์ภาษีซื้อต้องระบุคู่กัน");
  if (input.vatClaimMonth && (input.vatClaimMonth.slice(8) !== "01" || input.vatClaimMonth.slice(0, 7) < input.documentDate.slice(0, 7))) {
    throw new Error("เดือนที่ใช้สิทธิ์ภาษีซื้อต้องเป็นวันแรกของเดือนและไม่ก่อนเดือนเอกสาร");
  }
  if ((whtAmount > 0) !== Boolean(input.whtIncomeType)) throw new Error("ข้อมูลหัก ณ ที่จ่ายไม่ครบ");
  if (whtAmount > 0 && (!input.whtRate || !input.paidAt)) throw new Error("หัก ณ ที่จ่ายต้องมีวันที่จ่ายและอัตรา");
  if (whtAmount === 0 && input.whtRate != null) throw new Error("ระบุอัตราหัก ณ ที่จ่ายได้เมื่อมียอดหักเท่านั้น");
  if (whtAmount > amountBeforeVat) throw new Error("ยอดหัก ณ ที่จ่ายต้องไม่เกินยอดก่อน VAT");
  return {
    ...input, payeeName: clean(input.payeeName), payeeTaxId, payeeBranchCode,
    payeeAddress: clean(input.payeeAddress), documentNo: clean(input.documentNo), note: clean(input.note),
    amountBeforeVat, vatAmount, whtAmount, idempotencyKey: key,
  };
}

function hashRequest(input: ReturnType<typeof normalizedInput>) {
  const ordered = Object.keys(input).sort().reduce<Record<string, unknown>>((out, k) => {
    out[k] = (input as any)[k] ?? null;
    return out;
  }, {});
  return crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

function mapRow(r: any) {
  return {
    id: r.id, locationId: r.location_id, locationCode: r.location_code, locationName: r.location_name,
    branchCode: r.branch_code, category: r.category, documentKind: r.document_kind,
    supplierId: r.supplier_id, payeeName: r.payee_name, payeeTaxId: r.payee_tax_id,
    payeeBranchCode: r.payee_branch_code, payeeAddress: r.payee_address, payeeType: r.payee_type,
    documentNo: r.document_no, documentDate: r.document_date, paidAt: r.paid_at,
    amountBeforeVat: Number(r.amount_before_vat), vatAmount: Number(r.vat_amount),
    vatClaimMonth: r.vat_claim_month, whtIncomeType: r.wht_income_type,
    whtRate: r.wht_rate == null ? null : Number(r.wht_rate), whtAmount: Number(r.wht_amount),
    purchaseOrderId: r.purchase_order_id, evidenceFileId: r.evidence_file_id, note: r.note,
    status: r.status, voidReason: r.void_reason, voidedAt: r.voided_at?.toISOString?.() ?? r.voided_at,
    createdAt: r.created_at?.toISOString?.() ?? r.created_at,
  };
}

const selectColumns = `d.*, l.code AS location_code, l.name AS location_name, l.branch_code`;

export async function listExpenseDocuments(tenantId: string, filter: {
  from: string; to: string; locationId?: string | null; category?: string | null;
  search?: string | null; includeVoid?: boolean; limit?: number; offset?: number;
  allowedLocationIds?: string[] | null;
}) {
  if (!dateRe.test(filter.from) || !dateRe.test(filter.to) || filter.from > filter.to) throw new Error("ช่วงวันที่ไม่ถูกต้อง");
  const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
  const offset = Math.max(Number(filter.offset) || 0, 0);
  const search = clean(filter.search) ?? "";
  const params = [tenantId, filter.from, filter.to, filter.locationId ?? null, filter.category ?? null, search, filter.includeVoid === true, filter.allowedLocationIds ?? null, limit, offset];
  const where = `d.tenant_id = $1 AND d.document_date BETWEEN $2::date AND $3::date
    AND ($4::uuid IS NULL OR d.location_id = $4) AND ($5::text IS NULL OR d.category = $5)
    AND ($6 = '' OR d.payee_name ILIKE '%' || $6 || '%' OR COALESCE(d.document_no,'') ILIKE '%' || $6 || '%' OR COALESCE(d.payee_tax_id,'') ILIKE '%' || $6 || '%')
    AND ($7 OR d.status = 'ACTIVE') AND ($8::uuid[] IS NULL OR d.location_id = ANY($8))`;
  const [rows, count] = await Promise.all([
    query(`SELECT ${selectColumns} FROM bms_expense_documents d JOIN bms_locations l ON l.tenant_id=d.tenant_id AND l.id=d.location_id WHERE ${where} ORDER BY d.document_date DESC, d.created_at DESC LIMIT $9 OFFSET $10`, params),
    query<{ count: string }>(`SELECT count(*)::text AS count FROM bms_expense_documents d WHERE ${where}`, params.slice(0, 8)),
  ]);
  return { total: Number(count.rows[0]?.count ?? 0), rows: rows.rows.map(mapRow) };
}

export async function listExpenseSuppliers(tenantId: string) {
  const res = await query(`SELECT id,name,tax_id AS "taxId",branch_code AS "branchCode",address,entity_type AS "entityType" FROM bms_suppliers WHERE tenant_id=$1 ORDER BY name`, [tenantId]);
  return res.rows;
}

async function insertAudit(client: PoolClient, tenantId: string, actor: string, action: string, target: string, meta: object) {
  await client.query(`INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta) VALUES ($1,$2,$3,$4,$5)`, [tenantId, actor, action, target, JSON.stringify(meta)]);
}

export async function createExpenseDocument(tenantId: string, actorUserId: string, input: ExpenseDocumentInput) {
  const n = normalizedInput(input);
  const requestHash = hashRequest(n);
  return (await runInTransaction(actorUserId, async (client) => {
    // Serialise same-key retries before the read. Without this, two requests that arrive together
    // both see no prior row and the loser gets a unique violation instead of the promised replay.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, [tenantId, n.idempotencyKey]);
    const prior = await client.query(`SELECT id, request_hash FROM bms_expense_documents WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`, [tenantId, n.idempotencyKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new Error("idempotencyKey นี้เคยใช้กับข้อมูลคนละชุด");
      const replay = await client.query(`SELECT ${selectColumns} FROM bms_expense_documents d JOIN bms_locations l ON l.tenant_id=d.tenant_id AND l.id=d.location_id WHERE d.tenant_id=$1 AND d.id=$2`, [tenantId, prior.rows[0].id]);
      return mapRow(replay.rows[0]);
    }
    const loc = await client.query(`SELECT 1 FROM bms_locations WHERE tenant_id=$1 AND id=$2 AND active`, [tenantId, n.locationId]);
    if (!loc.rowCount) throw new Error("ไม่พบสถานประกอบการของร้านนี้");
    let supplier: any = null;
    if (n.supplierId) {
      const s = await client.query(`SELECT id,name,tax_id,branch_code,address,entity_type FROM bms_suppliers WHERE tenant_id=$1 AND id=$2`, [tenantId, n.supplierId]);
      supplier = s.rows[0];
      if (!supplier) throw new Error("ไม่พบผู้ขายของร้านนี้");
    }
    if (n.purchaseOrderId) {
      const po = await client.query(`SELECT 1 FROM bms_purchase_orders WHERE tenant_id=$1 AND id=$2`, [tenantId, n.purchaseOrderId]);
      if (!po.rowCount) throw new Error("ไม่พบใบสั่งซื้อของร้านนี้");
    }
    if (n.evidenceFileId != null) {
      const file = await client.query(`SELECT 1 FROM files WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND COALESCE(visibility,'private')='private'`, [n.evidenceFileId, tenantId]);
      if (!file.rowCount) throw new Error("ไม่พบไฟล์หลักฐานส่วนตัวของร้านนี้");
    }
    const payeeName = n.payeeName ?? supplier?.name;
    const payeeTaxId = n.payeeTaxId ?? supplier?.tax_id ?? null;
    const payeeType = n.payeeType ?? supplier?.entity_type ?? null;
    if (!payeeName) throw new Error("ต้องระบุชื่อผู้ขายหรือผู้รับเงิน");
    if (n.documentKind === "TAX_INVOICE" && (!n.documentNo || !payeeTaxId)) throw new Error("ใบกำกับภาษีต้องมีเลขที่เอกสารและเลขผู้เสียภาษีผู้ขาย");
    if (n.whtAmount > 0 && (!payeeType || !payeeTaxId)) throw new Error("หัก ณ ที่จ่ายต้องมีประเภทและเลขผู้เสียภาษีผู้รับเงิน");
    const values = [tenantId,n.locationId,n.category,n.documentKind,n.supplierId ?? null,payeeName,payeeTaxId,n.payeeBranchCode ?? supplier?.branch_code ?? null,n.payeeAddress ?? supplier?.address ?? null,payeeType,n.documentNo,n.documentDate,n.paidAt ?? null,n.amountBeforeVat,n.vatAmount,n.vatClaimMonth ?? null,n.whtIncomeType ?? null,n.whtRate ?? null,n.whtAmount,n.purchaseOrderId ?? null,n.evidenceFileId ?? null,n.note,actorUserId,n.idempotencyKey,requestHash];
    const created = await client.query(`INSERT INTO bms_expense_documents (tenant_id,location_id,category,document_kind,supplier_id,payee_name,payee_tax_id,payee_branch_code,payee_address,payee_type,document_no,document_date,paid_at,amount_before_vat,vat_amount,vat_claim_month,wht_income_type,wht_rate,wht_amount,purchase_order_id,evidence_file_id,note,created_by,idempotency_key,request_hash) VALUES (${values.map((_,i)=>`$${i+1}`).join(",")}) RETURNING id`, values);
    const id = created.rows[0].id;
    await insertAudit(client, tenantId, actorUserId, "expense.document.create", id, { category: n.category, documentKind: n.documentKind, locationId: n.locationId });
    const row = await client.query(`SELECT ${selectColumns} FROM bms_expense_documents d JOIN bms_locations l ON l.tenant_id=d.tenant_id AND l.id=d.location_id WHERE d.tenant_id=$1 AND d.id=$2`, [tenantId,id]);
    return mapRow(row.rows[0]);
  })).result;
}

export async function voidExpenseDocument(tenantId: string, actorUserId: string, id: string, reason: string, allowedLocationIds?: string[] | null) {
  const why = clean(reason);
  if (!why) throw new Error("ต้องระบุเหตุผลที่ยกเลิก");
  return (await runInTransaction(actorUserId, async (client) => {
    const locked = await client.query(`SELECT status FROM bms_expense_documents WHERE tenant_id=$1 AND id=$2 AND ($3::uuid[] IS NULL OR location_id=ANY($3)) FOR UPDATE`, [tenantId,id,allowedLocationIds ?? null]);
    if (!locked.rows[0]) throw new Error("ไม่พบเอกสารรายจ่าย");
    if (locked.rows[0].status === "VOID") throw new Error("เอกสารถูกยกเลิกแล้ว");
    await client.query(`UPDATE bms_expense_documents SET status='VOID',void_reason=$3,voided_at=now(),voided_by=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [tenantId,id,why,actorUserId]);
    await insertAudit(client, tenantId, actorUserId, "expense.document.void", id, { reason: why });
    return { id, status: "VOID" };
  })).result;
}

export async function getExpenseTaxSummary(tenantId: string, input: { from: string; to: string; locationId?: string | null; allowedLocationIds?: string[] | null }) {
  if (!dateRe.test(input.from) || !dateRe.test(input.to) || input.from > input.to) throw new Error("ช่วงวันที่ไม่ถูกต้อง");
  const res = await query(`
    SELECT location_id,
           count(*) FILTER (WHERE document_date BETWEEN $2::date AND $3::date)::int AS document_count,
           COALESCE(sum(amount_before_vat) FILTER (WHERE document_date BETWEEN $2::date AND $3::date),0)::text AS expense_base,
           COALESCE(sum(vat_amount) FILTER (WHERE vat_claim_month BETWEEN date_trunc('month',$2::date)::date AND date_trunc('month',$3::date)::date),0)::text AS vat_purchase,
           COALESCE(sum(wht_amount) FILTER (WHERE paid_at BETWEEN $2::date AND $3::date),0)::text AS wht
      FROM bms_expense_documents
     WHERE tenant_id=$1 AND status='ACTIVE'
       AND (document_date BETWEEN $2::date AND $3::date
            OR vat_claim_month BETWEEN date_trunc('month',$2::date)::date AND date_trunc('month',$3::date)::date
            OR paid_at BETWEEN $2::date AND $3::date)
       AND ($4::uuid IS NULL OR location_id=$4)
       AND ($5::uuid[] IS NULL OR location_id=ANY($5))
     GROUP BY location_id ORDER BY location_id`, [tenantId,input.from,input.to,input.locationId ?? null,input.allowedLocationIds ?? null]);
  const totals = res.rows.map((r:any)=>({ locationId:r.location_id, documentCount:Number(r.document_count), expenseBase:Number(r.expense_base), vatPurchase:Number(r.vat_purchase), wht:Number(r.wht) }));
  return { totals, grandTotal: totals.reduce((a,r)=>({ documentCount:a.documentCount+r.documentCount, expenseBase:a.expenseBase+r.expenseBase, vatPurchase:a.vatPurchase+r.vatPurchase, wht:a.wht+r.wht }), { documentCount:0,expenseBase:0,vatPurchase:0,wht:0 }) };
}
