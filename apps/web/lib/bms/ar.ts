// =============================================================
// BMS — ขายเชื่อ + ลูกหนี้การค้า (9.30)
// -------------------------------------------------------------
// รูปแบบ ledger เหมือนแต้ม (7.96) และเครดิตร้าน (8.9): ยอดคงเหลือคือ SUM ของ ledger
// ส่วนคอลัมน์ balance/settled_amount/credited_amount เป็น cache ที่ **คำนวณใหม่จาก
// ledger ทุกครั้ง** ไม่ใช่ += / -= · การบวกสะสมจะเพี้ยนเงียบ ๆ ทันทีที่มีทางเขียนที่
// ลืมอัปเดต แล้วไม่มีใครรู้ว่าเพี้ยนตั้งแต่เมื่อไร
//
// ต่างจากเครดิตร้านสองข้อ:
//   1. ยอด **ติดลบได้** = ร้านค้างลูกค้า (จ่ายครบแล้วเอาของมาคืน) ดูเหตุผลใน 9.30
//   2. หนี้เป็น **สินทรัพย์** ไม่ใช่หนี้สิน — ตัวเลขที่ส่งบัญชีคนละช่องกัน
//
// ทุกฟังก์ชันที่ลงท้าย InTx ทำงานในทรานแซกชันของผู้เรียก และ **ล็อกแถวบัญชีก่อน
// เขียนเสมอ** · ลำดับล็อกทั้งระบบคือ สต็อก → บัญชีลูกหนี้ (ทั้งเส้นทางขายและเส้นทาง
// คืน) สลับลำดับที่ไหนก็ตาม = deadlock 40P01 กลางเคาน์เตอร์
// =============================================================

import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
// กติกาวงเงินอยู่ในไฟล์ pure ล้วน (ไม่ import อะไรเลย) เพื่อให้เทสรันได้โดยไม่ต้องมี DB
export { describeArAvailability, evaluateArCharge } from "./arCredit";
import { AR_ACCOUNT_STATUSES, describeArAvailability, evaluateArCharge } from "./arCredit";
import type { ArAccountStatus, ArChargeCheck } from "./arCredit";
export type { ArAccountStatus, ArChargeCheck } from "./arCredit";
export type ArInvoiceStatus = "OPEN" | "PARTIAL" | "PAID" | "VOID" | "WRITTEN_OFF";
export type ArReceiptMethod = "CASH" | "BANK_TRANSFER" | "QR" | "CARD" | "WALLET";

export const AR_RECEIPT_METHODS: readonly ArReceiptMethod[] =
  ["CASH", "BANK_TRANSFER", "QR", "CARD", "WALLET"] as const;

export type ArAccount = {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  creditLimit: number;
  termsDays: number;
  status: ArAccountStatus;
  /** ยอดหนี้คงค้าง · ติดลบ = ร้านค้างลูกค้า */
  balance: number;
  /** วงเงินที่ยังเหลือจากเพดานเครดิต ไม่รวมยอดร้านค้างลูกค้า */
  creditLineAvailable: number;
  /** เครดิตคงเหลือจากยอดติดลบ เช่น คืนของหลังจ่ายครบ */
  creditBalance: number;
  /** ยอดขายเชื่อที่ยังทำได้หลังรวมเครดิตคงเหลือจากการคืนของ */
  availableCredit: number;
  /** ยอดของใบที่เลยกำหนดชำระแล้ว */
  overdueAmount: number;
  openInvoiceCount: number;
  note: string | null;
  createdAt: string;
};

export type ArInvoice = {
  id: string;
  accountId: string;
  orderId: string;
  customerId: string;
  customerName: string | null;
  amount: number;
  creditedAmount: number;
  settledAmount: number;
  outstanding: number;
  status: ArInvoiceStatus;
  issuedAt: string;
  dueAt: string;
  /** เลขใบกำกับของบิลต้นทาง — ลูกค้าอ้างเลขนี้เวลามาจ่าย ไม่ใช่ UUID ของบิล */
  docNo: string | null;
  overdue: boolean;
  daysPastDue: number;
};

export type ArLedgerEntry = {
  id: string;
  invoiceId: string;
  kind: "CHARGE" | "PAYMENT" | "CREDIT_NOTE" | "WRITE_OFF" | "ADJUST";
  amount: number;
  receiptId: string | null;
  orderId: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
};

const toISO = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ""));
const round2 = (n: number) => Math.round(n * 100) / 100;

function arReceiptRequestHash(parts: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

const DAY_MS = 24 * 60 * 60 * 1000;

function mapAccount(r: any): ArAccount {
  const balance = Number(r.balance);
  const creditLimit = Number(r.credit_limit);
  const availability = describeArAvailability({ creditLimit, balance });
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customer_name ?? null,
    customerPhone: r.customer_phone ?? null,
    creditLimit,
    termsDays: Number(r.terms_days),
    status: r.status,
    balance,
    creditLineAvailable: availability.creditLineAvailable,
    creditBalance: availability.creditBalance,
    availableCredit: availability.availableCredit,
    overdueAmount: Number(r.overdue_amount ?? 0),
    openInvoiceCount: Number(r.open_invoice_count ?? 0),
    note: r.note ?? null,
    createdAt: toISO(r.created_at),
  };
}

function mapInvoice(r: any): ArInvoice {
  const amount = Number(r.amount);
  const credited = Number(r.credited_amount);
  const settled = Number(r.settled_amount);
  const outstanding = round2(amount - credited - settled);
  const dueAt = toISO(r.due_at);
  const open = r.status === "OPEN" || r.status === "PARTIAL";
  const daysPastDue = open
    ? Math.max(0, Math.floor((Date.now() - new Date(dueAt).getTime()) / DAY_MS))
    : 0;
  return {
    id: r.id,
    accountId: r.account_id,
    orderId: r.order_id,
    customerId: r.customer_id,
    customerName: r.customer_name ?? null,
    amount,
    creditedAmount: credited,
    settledAmount: settled,
    outstanding,
    status: r.status,
    issuedAt: toISO(r.issued_at),
    dueAt,
    docNo: r.doc_no ?? null,
    overdue: open && daysPastDue > 0,
    daysPastDue,
  };
}

// ---------------------------------------------------------------
// cache ที่คำนวณใหม่จาก ledger — ห้ามบวกสะสม
// ---------------------------------------------------------------

/**
 * คำนวณ settled/credited/status ของใบหนึ่งใบใหม่จาก ledger ทั้งหมดของใบนั้น
 *
 * ADJUST ที่เป็นบวกใช้ได้เฉพาะคืนยอดเครดิตติดลบออกจากใบเก่าเพื่อหักกลบใบอื่น;
 * ถ้าไม่มีเครดิตรองรับ credited_amount จะติดลบและชน CHECK ดัง ๆ ตามที่ต้องการ
 * การเพิ่มหนี้ทั่วไปยังต้องออกใบใหม่ ไม่ใช่ขยายใบที่ออกใบกำกับไปแล้ว
 */
async function refreshInvoiceInTx(
  client: PoolClient,
  tenantId: string,
  invoiceId: string,
  opts: { preserveStatus?: "VOID" | "WRITTEN_OFF" } = {}
): Promise<{ outstanding: number; status: ArInvoiceStatus }> {
  const sums = await client.query<{ amount: string; settled: string; credited: string }>(
    `SELECT i.amount,
            COALESCE(SUM(-l.amount) FILTER (WHERE l.kind = 'PAYMENT'), 0) AS settled,
            COALESCE(SUM(-l.amount) FILTER (WHERE l.kind IN ('CREDIT_NOTE','WRITE_OFF','ADJUST')), 0) AS credited
       FROM bms_ar_invoices i
       LEFT JOIN bms_ar_ledger l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
      WHERE i.tenant_id = $1 AND i.id = $2
      GROUP BY i.amount`,
    [tenantId, invoiceId]
  );
  const row = sums.rows[0];
  if (!row) throw new Error("ไม่พบใบแจ้งหนี้ระหว่างคำนวณยอดใหม่");

  const amount = Number(row.amount);
  const settled = round2(Number(row.settled));
  const credited = round2(Number(row.credited));
  const outstanding = round2(amount - settled - credited);

  let status: ArInvoiceStatus;
  if (opts.preserveStatus) status = opts.preserveStatus;
  else if (outstanding <= 0.005) status = credited >= amount - 0.005 ? "VOID" : "PAID";
  else if (settled > 0 || credited > 0) status = "PARTIAL";
  else status = "OPEN";

  await client.query(
    `UPDATE bms_ar_invoices
        SET settled_amount = $3, credited_amount = $4, status = $5,
            closed_at = CASE WHEN $5 IN ('PAID','VOID','WRITTEN_OFF') THEN COALESCE(closed_at, now()) ELSE NULL END,
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, invoiceId, settled, credited, status]
  );
  return { outstanding, status };
}

/** ยอดบัญชี = SUM(ledger) เสมอ · เรียกหลังเขียน ledger ทุกครั้ง (แถวบัญชีต้องถูกล็อกอยู่) */
async function refreshAccountBalanceInTx(
  client: PoolClient, tenantId: string, accountId: string
): Promise<number> {
  const res = await client.query<{ balance: string }>(
    `UPDATE bms_ar_accounts a
        SET balance = COALESCE((
              SELECT SUM(l.amount) FROM bms_ar_ledger l
               WHERE l.tenant_id = a.tenant_id AND l.account_id = a.id
            ), 0),
            updated_at = now()
      WHERE a.tenant_id = $1 AND a.id = $2
      RETURNING a.balance`,
    [tenantId, accountId]
  );
  return Number(res.rows[0]?.balance ?? 0);
}

/**
 * นำยอดเครดิตติดลบจากใบที่คืนของหลังจ่ายครบ ไปตัดใบค้างเก่าสุดของบัญชีเดียวกัน
 * โดยไม่เปลี่ยนยอดรวมบัญชี: ADJUST(+) คืนเครดิตจากใบต้นทาง + PAYMENT(-) ที่ใบเป้าหมาย
 *
 * ผู้เรียกต้องล็อกแถว account อยู่แล้ว จึงไม่มี writer ของบัญชีเดียวกันแทรกระหว่างการย้าย
 * PAYMENT ที่ receipt_id = NULL แปลว่า "ชำระด้วยยอดเครดิตคงเหลือ" ไม่ใช่รับเงินใหม่
 */
async function applyAccountCreditInTx(
  client: PoolClient,
  tenantId: string,
  accountId: string,
  actorUserId: string
): Promise<number> {
  const sources = await client.query<{ id: string; status: ArInvoiceStatus; available: string }>(
    `SELECT i.id, i.status, -SUM(l.amount) AS available
       FROM bms_ar_invoices i
       JOIN bms_ar_ledger l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
      WHERE i.tenant_id = $1 AND i.account_id = $2
      GROUP BY i.id, i.status, i.issued_at
     HAVING SUM(l.amount) < -0.005
      ORDER BY i.issued_at, i.id`,
    [tenantId, accountId]
  );
  if (!sources.rowCount) return 0;

  const targets = await client.query<{ id: string; remaining: string }>(
    `SELECT i.id, SUM(l.amount) AS remaining
       FROM bms_ar_invoices i
       JOIN bms_ar_ledger l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
      WHERE i.tenant_id = $1 AND i.account_id = $2
        AND i.status IN ('OPEN','PARTIAL')
      GROUP BY i.id, i.due_at, i.issued_at
     HAVING SUM(l.amount) > 0.005
      ORDER BY i.due_at, i.issued_at, i.id`,
    [tenantId, accountId]
  );
  if (!targets.rowCount) return 0;

  let sourceIndex = 0;
  let targetIndex = 0;
  let sourceRemaining = round2(Number(sources.rows[0].available));
  let targetRemaining = round2(Number(targets.rows[0].remaining));
  let applied = 0;
  const touched = new Set<string>();

  while (sourceIndex < sources.rows.length && targetIndex < targets.rows.length) {
    const take = round2(Math.min(sourceRemaining, targetRemaining));
    if (take > 0.005) {
      const source = sources.rows[sourceIndex];
      const target = targets.rows[targetIndex];
      await client.query(
        `INSERT INTO bms_ar_ledger
           (tenant_id, account_id, invoice_id, kind, amount, actor_user_id, note)
         VALUES
           ($1,$2,$3,'ADJUST',$5,$6,'ย้ายยอดเครดิตคงเหลือไปตัดใบอื่น'),
           ($1,$2,$4,'PAYMENT',-$5,$6,'ชำระด้วยยอดเครดิตคงเหลือ')`,
        [tenantId, accountId, source.id, target.id, take, actorUserId]
      );
      touched.add(source.id);
      touched.add(target.id);
      applied = round2(applied + take);
      sourceRemaining = round2(sourceRemaining - take);
      targetRemaining = round2(targetRemaining - take);
    }

    if (sourceRemaining <= 0.005) {
      sourceIndex += 1;
      sourceRemaining = sourceIndex < sources.rows.length
        ? round2(Number(sources.rows[sourceIndex].available))
        : 0;
    }
    if (targetRemaining <= 0.005) {
      targetIndex += 1;
      targetRemaining = targetIndex < targets.rows.length
        ? round2(Number(targets.rows[targetIndex].remaining))
        : 0;
    }
  }

  for (const invoiceId of touched) {
    const source = sources.rows.find((row) => row.id === invoiceId);
    await refreshInvoiceInTx(client, tenantId, invoiceId, {
      preserveStatus:
        source?.status === "VOID" || source?.status === "WRITTEN_OFF" ? source.status : undefined,
    });
  }
  return applied;
}

// ---------------------------------------------------------------
// อ่าน
// ---------------------------------------------------------------

const ACCOUNT_SELECT = `
  SELECT a.*, c.name AS customer_name, c.phone AS customer_phone,
         COALESCE((
           SELECT SUM(i.amount - i.credited_amount - i.settled_amount)
             FROM bms_ar_invoices i
            WHERE i.tenant_id = a.tenant_id AND i.account_id = a.id
              AND i.status IN ('OPEN','PARTIAL') AND i.due_at < now()
         ), 0) AS overdue_amount,
         COALESCE((
           SELECT COUNT(*) FROM bms_ar_invoices i
            WHERE i.tenant_id = a.tenant_id AND i.account_id = a.id
              AND i.status IN ('OPEN','PARTIAL')
         ), 0)::int AS open_invoice_count
    FROM bms_ar_accounts a
    JOIN bms_customers c ON c.tenant_id = a.tenant_id AND c.id = a.customer_id`;

export async function getArAccountByCustomer(
  tenantId: string, customerId: string
): Promise<ArAccount | null> {
  const res = await query<any>(
    `${ACCOUNT_SELECT} WHERE a.tenant_id = $1 AND a.customer_id = $2`,
    [tenantId, customerId]
  );
  return res.rows[0] ? mapAccount(res.rows[0]) : null;
}

export async function getArAccountById(tenantId: string, accountId: string): Promise<ArAccount | null> {
  const res = await query<any>(
    `${ACCOUNT_SELECT} WHERE a.tenant_id = $1 AND a.id = $2`,
    [tenantId, accountId]
  );
  return res.rows[0] ? mapAccount(res.rows[0]) : null;
}

export async function listArAccounts(
  tenantId: string,
  opts: { search?: string | null; status?: ArAccountStatus | null; withBalanceOnly?: boolean; limit?: number } = {}
): Promise<ArAccount[]> {
  const limit = Math.max(1, Math.min(500, Math.trunc(opts.limit ?? 200)));
  const search = (opts.search ?? "").trim();
  const res = await query<any>(
    `${ACCOUNT_SELECT}
      WHERE a.tenant_id = $1
        AND ($2::text IS NULL OR a.status = $2)
        AND ($3::text = '' OR c.name ILIKE '%' || $3 || '%' OR c.phone ILIKE '%' || $3 || '%')
        AND ($4::boolean = FALSE OR a.balance <> 0)
      ORDER BY a.balance DESC, c.name
      LIMIT $5`,
    [tenantId, opts.status ?? null, search, opts.withBalanceOnly === true, limit]
  );
  return res.rows.map(mapAccount);
}

const INVOICE_SELECT = `
  SELECT i.*, a.customer_id, c.name AS customer_name,
         (SELECT d.doc_no FROM bms_tax_documents d
           WHERE d.tenant_id = i.tenant_id AND d.order_id = i.order_id
             AND d.doc_type IN ('FULL','ABBREVIATED') AND d.cancelled_at IS NULL
           ORDER BY (d.doc_type = 'FULL') DESC, d.issued_at DESC
           LIMIT 1) AS doc_no
    FROM bms_ar_invoices i
    JOIN bms_ar_accounts a ON a.tenant_id = i.tenant_id AND a.id = i.account_id
    JOIN bms_customers c ON c.tenant_id = a.tenant_id AND c.id = a.customer_id`;

export async function listArInvoices(
  tenantId: string,
  opts: { accountId?: string | null; openOnly?: boolean; overdueOnly?: boolean; limit?: number } = {}
): Promise<ArInvoice[]> {
  const limit = Math.max(1, Math.min(500, Math.trunc(opts.limit ?? 200)));
  const res = await query<any>(
    `${INVOICE_SELECT}
      WHERE i.tenant_id = $1
        AND ($2::uuid IS NULL OR i.account_id = $2)
        AND ($3::boolean = FALSE OR i.status IN ('OPEN','PARTIAL'))
        AND ($4::boolean = FALSE OR (i.status IN ('OPEN','PARTIAL') AND i.due_at < now()))
      ORDER BY i.due_at, i.issued_at
      LIMIT $5`,
    [tenantId, opts.accountId ?? null, opts.openOnly === true, opts.overdueOnly === true, limit]
  );
  return res.rows.map(mapInvoice);
}

export async function getArInvoiceByOrder(tenantId: string, orderId: string): Promise<ArInvoice | null> {
  const res = await query<any>(
    `${INVOICE_SELECT} WHERE i.tenant_id = $1 AND i.order_id = $2`,
    [tenantId, orderId]
  );
  return res.rows[0] ? mapInvoice(res.rows[0]) : null;
}

export async function listArLedger(
  tenantId: string, opts: { invoiceId?: string | null; accountId?: string | null; limit?: number } = {}
): Promise<ArLedgerEntry[]> {
  const limit = Math.max(1, Math.min(500, Math.trunc(opts.limit ?? 200)));
  const res = await query<any>(
    `SELECT l.*, u.name AS actor_name
       FROM bms_ar_ledger l
       LEFT JOIN users u ON u.id = l.actor_user_id
      WHERE l.tenant_id = $1
        AND ($2::uuid IS NULL OR l.invoice_id = $2)
        AND ($3::uuid IS NULL OR l.account_id = $3)
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $4`,
    [tenantId, opts.invoiceId ?? null, opts.accountId ?? null, limit]
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    invoiceId: r.invoice_id,
    kind: r.kind,
    amount: Number(r.amount),
    receiptId: r.receipt_id ?? null,
    orderId: r.order_id ?? null,
    note: r.note ?? null,
    actorName: r.actor_name ?? null,
    createdAt: toISO(r.created_at),
  }));
}

export type ArAging = {
  /** ยังไม่ถึงกำหนด */
  current: number;
  d1to30: number;
  d31to60: number;
  d61to90: number;
  d90plus: number;
  total: number;
};

export type ArOutstanding = {
  /** ยอดลูกหนี้คงค้างรวม = สินทรัพย์ในงบดุล */
  outstandingAmount: number;
  overdueAmount: number;
  accountsWithBalance: number;
  openInvoiceCount: number;
  aging: ArAging;
  /**
   * ต้องเป็น 0 เสมอ — cache ไม่ตรงกับ ledger คือมีทางเขียนที่ลืมคำนวณยอดใหม่
   * (กฎเดียวกับ balanceMismatchCount ของแต้ม/เครดิตร้าน)
   */
  balanceMismatchCount: number;
};

export async function getArOutstanding(tenantId: string): Promise<ArOutstanding> {
  const [invoices, accounts] = await Promise.all([
    query<any>(
      `SELECT
         COALESCE(SUM(o.rem), 0) AS total,
         COALESCE(SUM(o.rem) FILTER (WHERE o.days <= 0), 0) AS current,
         COALESCE(SUM(o.rem) FILTER (WHERE o.days BETWEEN 1 AND 30), 0) AS d1,
         COALESCE(SUM(o.rem) FILTER (WHERE o.days BETWEEN 31 AND 60), 0) AS d31,
         COALESCE(SUM(o.rem) FILTER (WHERE o.days BETWEEN 61 AND 90), 0) AS d61,
         COALESCE(SUM(o.rem) FILTER (WHERE o.days > 90), 0) AS d90,
         COALESCE(SUM(o.rem) FILTER (WHERE o.days > 0), 0) AS overdue,
         COUNT(*)::int AS open_count
       FROM (
         SELECT (i.amount - i.credited_amount - i.settled_amount) AS rem,
                FLOOR(EXTRACT(EPOCH FROM (now() - i.due_at)) / 86400)::int AS days
           FROM bms_ar_invoices i
          WHERE i.tenant_id = $1 AND i.status IN ('OPEN','PARTIAL')
       ) o`,
      [tenantId]
    ),
    query<any>(
      `SELECT COUNT(*) FILTER (WHERE balance <> 0)::int AS with_balance,
              COUNT(*) FILTER (
                WHERE balance <> COALESCE((
                  SELECT SUM(l.amount) FROM bms_ar_ledger l
                   WHERE l.tenant_id = a.tenant_id AND l.account_id = a.id
                ), 0)
              )::int AS mismatch
         FROM bms_ar_accounts a
        WHERE a.tenant_id = $1`,
      [tenantId]
    ),
  ]);
  const i = invoices.rows[0] ?? {};
  const a = accounts.rows[0] ?? {};
  return {
    outstandingAmount: Number(i.total ?? 0),
    overdueAmount: Number(i.overdue ?? 0),
    accountsWithBalance: Number(a.with_balance ?? 0),
    openInvoiceCount: Number(i.open_count ?? 0),
    aging: {
      current: Number(i.current ?? 0),
      d1to30: Number(i.d1 ?? 0),
      d31to60: Number(i.d31 ?? 0),
      d61to90: Number(i.d61 ?? 0),
      d90plus: Number(i.d90 ?? 0),
      total: Number(i.total ?? 0),
    },
    balanceMismatchCount: Number(a.mismatch ?? 0),
  };
}

// ---------------------------------------------------------------
// ตั้งค่าบัญชี
// ---------------------------------------------------------------

export type UpsertArAccountResult =
  | { status: "SAVED"; account: ArAccount }
  | { status: "INVALID"; reason: string };

/**
 * เปิด/แก้บัญชีลูกหนี้ · audit อยู่ในทรานแซกชันเดียวกับการเขียนตามกฎของ repo
 *
 * ปิดบัญชีได้เมื่อยอดเป็น 0 เท่านั้น — บัญชีที่ปิดทั้งที่ยังมีหนี้ค้างคือหนี้ที่หายไป
 * จากรายงานโดยที่เงินยังไม่เข้า
 */
export async function upsertArAccount(input: {
  tenantId: string;
  customerId: string;
  creditLimit: number;
  termsDays: number;
  status?: ArAccountStatus | null;
  note?: string | null;
  actorUserId: string;
}): Promise<UpsertArAccountResult> {
  const creditLimit = round2(Number(input.creditLimit));
  const termsDays = Math.trunc(Number(input.termsDays));
  if (!Number.isFinite(creditLimit) || creditLimit < 0) {
    return { status: "INVALID", reason: "วงเงินต้องไม่ติดลบ" };
  }
  if (!Number.isFinite(termsDays) || termsDays < 0 || termsDays > 365) {
    return { status: "INVALID", reason: "เครดิตเทอมต้องอยู่ระหว่าง 0–365 วัน" };
  }
  const status = input.status ?? "ACTIVE";
  if (!AR_ACCOUNT_STATUSES.includes(status)) {
    return { status: "INVALID", reason: "สถานะบัญชีเครดิตไม่ถูกต้อง" };
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });

    const customer = await client.query(
      `SELECT 1 FROM bms_customers WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.customerId]
    );
    if (!customer.rowCount) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "ไม่พบลูกค้ารายนี้ในร้าน" };
    }

    const existing = await client.query<{ id: string; balance: string }>(
      `SELECT id, balance FROM bms_ar_accounts
        WHERE tenant_id = $1 AND customer_id = $2 FOR UPDATE`,
      [input.tenantId, input.customerId]
    );
    if (status === "CLOSED" && existing.rows[0] && Math.abs(Number(existing.rows[0].balance)) > 0.005) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "ปิดบัญชีไม่ได้ ยังมียอดค้างอยู่" };
    }

    const saved = await client.query<{ id: string }>(
      `INSERT INTO bms_ar_accounts
         (tenant_id, customer_id, credit_limit, terms_days, status, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, customer_id) DO UPDATE
         SET credit_limit = EXCLUDED.credit_limit,
             terms_days   = EXCLUDED.terms_days,
             status       = EXCLUDED.status,
             note         = EXCLUDED.note,
             updated_at   = now()
       RETURNING id`,
      [input.tenantId, input.customerId, creditLimit, termsDays, status,
        input.note?.trim() || null, input.actorUserId]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'ar.account.upsert',$3,$4)`,
      [input.tenantId, input.actorUserId, saved.rows[0].id,
        JSON.stringify({ customerId: input.customerId, creditLimit, termsDays, status })]
    );
    await client.query("COMMIT");

    const account = await getArAccountById(input.tenantId, saved.rows[0].id);
    return account
      ? { status: "SAVED", account }
      : { status: "INVALID", reason: "บันทึกบัญชีไม่สำเร็จ" };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// ขายเชื่อ
// ---------------------------------------------------------------

/**
 * ตรวจว่าขายเชื่อยอดนี้ได้ไหม — **ไม่ล็อกอะไร** ใช้เป็นด่านแรกก่อนสร้างบิล
 *
 * เหตุผลเดียวกับที่บัตรของขวัญตรวจก่อน createOrder (8.9): ล้มตรงนี้ยังไม่มีสต็อกถูก
 * ตัด ไม่มีคูปองถูกนับ · การตัดสินใจจริงเกิดอีกครั้งใน chargeArInTx พร้อม FOR UPDATE
 * เพราะสองเครื่องขายเชื่อให้ลูกค้าคนเดียวกันพร้อมกันได้
 */
export async function precheckArCharge(
  tenantId: string, customerId: string, amount: number
): Promise<ArChargeCheck> {
  const account = await getArAccountByCustomer(tenantId, customerId);
  if (!account) {
    return { ok: false, code: "NO_ACCOUNT", reason: "ลูกค้ารายนี้ยังไม่มีบัญชีเครดิต" };
  }
  return evaluateArCharge(
    { id: account.id, status: account.status, creditLimit: account.creditLimit, balance: account.balance },
    amount
  );
}

/**
 * ตั้งหนี้ให้บิลที่เพิ่งปิดการขาย — เรียกในทรานแซกชันที่ตัดสต็อกเท่านั้น
 *
 * ต้องอยู่ในทรานแซกชันเดียวกับสต็อก/เงิน/ภาษี ไม่ใช่ยิงต่อท้ายหลัง commit: บิลที่ commit
 * แล้วแต่ตั้งหนี้ไม่สำเร็จ = ของออกจากร้านโดยไม่มีใครเป็นหนี้ ซึ่งกู้คืนด้วยมือไม่ได้
 * เพราะไม่มีร่องรอยว่าเคยตั้งใจให้ใครเป็นหนี้
 *
 * ยิงซ้ำได้: UNIQUE (tenant_id, order_id) ของใบ + partial unique ของ ledger CHARGE
 * ทำให้บิลเดิมได้ใบเดิม ไม่ใช่หนี้ก้อนที่สอง
 */
export async function chargeArInTx(
  client: PoolClient,
  tenantId: string,
  args: {
    customerId: string;
    orderId: string;
    amount: number;
    locationId?: string | null;
    shiftId?: string | null;
    actorUserId: string;
    /** คนที่อนุมัติให้ปล่อยเชื่อ (อาจเป็นคนขายเองถ้ามีสิทธิ์) — เก็บลง audit */
    approvedBy?: string | null;
  }
): Promise<{ invoiceId: string; accountId: string; dueAt: string; balanceAfter: number }> {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("ยอดขายเชื่อต้องมากกว่า 0");

  const acc = await client.query<{ id: string; status: ArAccountStatus; credit_limit: string; balance: string; terms_days: number }>(
    `SELECT id, status, credit_limit, balance, terms_days
       FROM bms_ar_accounts
      WHERE tenant_id = $1 AND customer_id = $2
      FOR UPDATE`,
    [tenantId, args.customerId]
  );
  const account = acc.rows[0];
  if (!account) throw new Error("ลูกค้ารายนี้ยังไม่มีบัญชีเครดิต");

  // ใบเดิมของบิลเดิม (ยิงซ้ำ) — คืนของเดิม ไม่ตั้งหนี้ใหม่และไม่ตรวจวงเงินซ้ำ
  const existing = await client.query<{ id: string; due_at: unknown }>(
    `SELECT id, due_at FROM bms_ar_invoices WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, args.orderId]
  );
  if (existing.rows[0]) {
    return {
      invoiceId: existing.rows[0].id,
      accountId: account.id,
      dueAt: toISO(existing.rows[0].due_at),
      balanceAfter: Number(account.balance),
    };
  }

  const verdict = evaluateArCharge(
    {
      id: account.id,
      status: account.status,
      creditLimit: Number(account.credit_limit),
      balance: Number(account.balance),
    },
    amount
  );
  if (!verdict.ok) throw new Error(verdict.reason);

  const invoice = await client.query<{ id: string; due_at: unknown }>(
    `INSERT INTO bms_ar_invoices
       (tenant_id, account_id, order_id, location_id, shift_id, amount, due_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval, $8)
     RETURNING id, due_at`,
    [tenantId, account.id, args.orderId, args.locationId ?? null, args.shiftId ?? null,
      amount, String(account.terms_days), args.actorUserId]
  );
  await client.query(
    `INSERT INTO bms_ar_ledger
       (tenant_id, account_id, invoice_id, kind, amount, order_id, actor_user_id, note)
     VALUES ($1,$2,$3,'CHARGE',$4,$5,$6,'ขายเชื่อที่เคาน์เตอร์')`,
    [tenantId, account.id, invoice.rows[0].id, amount, args.orderId, args.actorUserId]
  );
  const appliedAccountCredit = await applyAccountCreditInTx(
    client, tenantId, account.id, args.actorUserId
  );
  const balanceAfter = await refreshAccountBalanceInTx(client, tenantId, account.id);
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
     VALUES ($1,$2,'ar.charge',$3,$4)`,
    [tenantId, args.actorUserId, args.orderId, JSON.stringify({
      accountId: account.id,
      customerId: args.customerId,
      amount,
      appliedAccountCredit,
      approvedBy: args.approvedBy ?? args.actorUserId,
      balanceAfter,
    })]
  );
  return {
    invoiceId: invoice.rows[0].id,
    accountId: account.id,
    dueAt: toISO(invoice.rows[0].due_at),
    balanceAfter,
  };
}

/**
 * ลดหนี้เมื่อคืนของ/ยกเลิกบิลเชื่อ — ในทรานแซกชันของผู้เรียก (processPosReturn)
 *
 * ยอดที่ส่งมาคือยอดของ refund allocation ชนิด CREDIT ซึ่งถูกจำกัดไว้แล้วว่าไม่เกิน
 * ยอดที่ "จ่ายมาด้วยวิธีนี้" — จึงไม่ต้องกันเกินซ้ำที่นี่
 *
 * คีย์ด้วย pos_return_id ไม่ใช่ order_id: คืนบางส่วนเกิดหลายครั้งต่อบิล คีย์ด้วยบิล
 * จะลดหนี้ได้ครั้งแรกครั้งเดียวแล้วครั้งถัดไปเงียบหาย (ลูกค้าคืนของแต่ยังเป็นหนี้)
 */
export async function reduceArForReturnInTx(
  client: PoolClient,
  tenantId: string,
  args: { orderId: string; posReturnId: string; amount: number; actorUserId: string; isVoid?: boolean }
): Promise<number> {
  const amount = round2(args.amount);
  if (!(amount > 0)) return 0;

  const inv = await client.query<{ id: string; account_id: string; status: ArInvoiceStatus }>(
    `SELECT id, account_id, status FROM bms_ar_invoices WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, args.orderId]
  );
  const invoice = inv.rows[0];
  if (!invoice) return 0;

  // ล็อกบัญชีก่อนเขียน ledger — ลำดับ สต็อก → บัญชี เหมือนเส้นทางขาย
  await client.query(
    `SELECT 1 FROM bms_ar_accounts WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, invoice.account_id]
  );

  const ins = await client.query(
    `INSERT INTO bms_ar_ledger
       (tenant_id, account_id, invoice_id, kind, amount, order_id, pos_return_id, actor_user_id, note)
     VALUES ($1,$2,$3,'CREDIT_NOTE',$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, invoice_id, pos_return_id)
       WHERE kind = 'CREDIT_NOTE' AND pos_return_id IS NOT NULL DO NOTHING`,
    [tenantId, invoice.account_id, invoice.id, -amount, args.orderId, args.posReturnId,
      args.actorUserId, args.isVoid ? "ยกเลิกบิลขายเชื่อ" : "คืนสินค้าบิลขายเชื่อ"]
  );
  if (!(ins.rowCount ?? 0)) return 0;

  await refreshInvoiceInTx(client, tenantId, invoice.id, {
    preserveStatus:
      invoice.status === "VOID" || invoice.status === "WRITTEN_OFF" ? invoice.status : undefined,
  });
  await applyAccountCreditInTx(client, tenantId, invoice.account_id, args.actorUserId);
  await refreshAccountBalanceInTx(client, tenantId, invoice.account_id);
  return amount;
}

// ---------------------------------------------------------------
// รับชำระหนี้
// ---------------------------------------------------------------

export type ArReceiptAllocation = { invoiceId: string; amount: number; orderId: string };

export type RecordArReceiptResult =
  | {
      status: "RECEIVED";
      receiptId: string;
      allocations: ArReceiptAllocation[];
      balanceAfter: number;
      replayed: boolean;
    }
  | { status: "INVALID"; reason: string }
  | { status: "OVER_PAYMENT"; outstanding: number; requested: number }
  | { status: "IDEMPOTENCY_CONFLICT" };

/**
 * รับชำระหนี้ที่เคาน์เตอร์หรือหลังร้าน — ตัดใบเก่าก่อน (FIFO ตามวันครบกำหนด)
 *
 * ทำไมตัดตามใบไม่ใช่หักยอดรวม: อายุหนี้ (aging) คือเครื่องมือเดียวที่บอกว่าหนี้ก้อนไหน
 * ค้างนาน · หักยอดรวมเฉย ๆ จะทำให้ทุกใบดูเหมือนค้างเท่ากันตลอดไป
 *
 * ⚠️ รับเกินยอดค้างไม่ได้ (ปฏิเสธ ไม่ใช่เก็บเป็นเงินล่วงหน้าเงียบ ๆ) — เงินที่จ่ายเกิน
 * ที่เคาน์เตอร์เกือบทั้งหมดคือพิมพ์ผิด · ลูกค้าที่ตั้งใจจ่ายล่วงหน้าจริงให้ลงมัดจำ (9.0)
 * หรือซื้อเครดิตร้าน (8.9) ซึ่งมีเส้นทางของตัวเองอยู่แล้ว
 *
 * ⚠️ เงินสดต้องมีกะเปิดอยู่เสมอ — เงินสดที่ไม่ผูกลิ้นชักคือเงินที่นับปิดกะไม่เจอ
 * จึงบันทึกเป็น bms_pos_cash_movements (IN) ในทรานแซกชันเดียวกัน ไม่ใช่ลง
 * bms_payments ของบิลเดิม (บิลเดิมอยู่คนละกะ เงินจะไปโผล่ในกะที่ปิดไปแล้ว)
 */
export async function recordArReceipt(input: {
  tenantId: string;
  accountId: string;
  amount: number;
  method: ArReceiptMethod;
  reference?: string | null;
  note?: string | null;
  receivedBy: string;
  idempotencyKey: string;
  locationId?: string | null;
  deviceId?: string | null;
  shiftId?: string | null;
}): Promise<RecordArReceiptResult> {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: "INVALID", reason: "ยอดรับชำระต้องมากกว่า 0" };
  }
  if (!AR_RECEIPT_METHODS.includes(input.method)) {
    return { status: "INVALID", reason: "วิธีรับชำระไม่ถูกต้อง" };
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 240) {
    return { status: "INVALID", reason: "idempotencyKey ไม่ถูกต้อง" };
  }
  if (input.method === "CASH" && (!input.shiftId || !input.deviceId)) {
    return {
      status: "INVALID",
      reason: "รับเป็นเงินสดต้องทำที่เครื่องขายที่เปิดกะอยู่ เพื่อให้เงินเข้าลิ้นชักของกะนั้น",
    };
  }

  const normalizedReference = input.reference?.trim() || null;
  const normalizedNote = input.note?.trim() || null;
  const requestHash = arReceiptRequestHash({
    accountId: input.accountId,
    amount,
    method: input.method,
    reference: normalizedReference,
    note: normalizedNote,
    receivedBy: input.receivedBy,
    locationId: input.locationId ?? null,
    deviceId: input.deviceId ?? null,
    shiftId: input.shiftId ?? null,
  });

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.receivedBy });

    // unique key เป็น tenant-wide แต่ account/shift locks แคบกว่านั้น จึงต้องล็อกคีย์
    // ก่อนอ่าน replay และก่อนแตะ state อื่น ไม่งั้น request เดียวชนกันสองเครื่องอาจ
    // จบเป็น unique-constraint 500 แทน replay ที่เสถียร
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`ar-receipt:${input.tenantId}:${idempotencyKey}`]
    );

    const replay = await client.query<{ id: string; account_id: string; request_hash: string }>(
      `SELECT id, account_id, request_hash FROM bms_ar_receipts
        WHERE tenant_id = $1 AND idempotency_key = $2`,
      [input.tenantId, idempotencyKey]
    );
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash !== requestHash) {
        await client.query("ROLLBACK");
        return { status: "IDEMPOTENCY_CONFLICT" };
      }
      const prior = await client.query<any>(
        `SELECT l.invoice_id, -l.amount AS amount, i.order_id
           FROM bms_ar_ledger l
           JOIN bms_ar_invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
          WHERE l.tenant_id = $1 AND l.receipt_id = $2 AND l.kind = 'PAYMENT'
          ORDER BY l.id`,
        [input.tenantId, replay.rows[0].id]
      );
      const balance = await client.query<{ balance: string }>(
        `SELECT balance FROM bms_ar_accounts WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, replay.rows[0].account_id]
      );
      await client.query("ROLLBACK");
      return {
        status: "RECEIVED",
        receiptId: replay.rows[0].id,
        allocations: prior.rows.map((r) => ({
          invoiceId: r.invoice_id, amount: Number(r.amount), orderId: r.order_id,
        })),
        balanceAfter: Number(balance.rows[0]?.balance ?? 0),
        replayed: true,
      };
    }

    const acc = await client.query<{ id: string; status: ArAccountStatus }>(
      `SELECT id, status FROM bms_ar_accounts
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, input.accountId]
    );
    const account = acc.rows[0];
    if (!account) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "ไม่พบบัญชีเครดิตนี้" };
    }
    // บัญชีที่ถูกระงับยังรับชำระได้ — การระงับห้าม "ขายเพิ่ม" ไม่ใช่ห้ามใช้หนี้
    if (account.status === "CLOSED") {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "บัญชีนี้ปิดแล้ว" };
    }

    const open = await client.query<{ id: string; order_id: string; rem: string }>(
      `SELECT id, order_id, (amount - credited_amount - settled_amount) AS rem
         FROM bms_ar_invoices
        WHERE tenant_id = $1 AND account_id = $2 AND status IN ('OPEN','PARTIAL')
        ORDER BY due_at, issued_at, id
        FOR UPDATE`,
      [input.tenantId, account.id]
    );
    const outstanding = round2(
      open.rows.reduce((sum, r) => sum + Math.max(0, Number(r.rem)), 0)
    );
    if (amount > outstanding + 0.005) {
      await client.query("ROLLBACK");
      return { status: "OVER_PAYMENT", outstanding, requested: amount };
    }

    const receipt = await client.query<{ id: string }>(
      `INSERT INTO bms_ar_receipts
         (tenant_id, account_id, location_id, device_id, shift_id, method, amount,
          reference, note, received_by, idempotency_key, request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [input.tenantId, account.id, input.locationId ?? null, input.deviceId ?? null,
        input.shiftId ?? null, input.method, amount, normalizedReference,
        normalizedNote, input.receivedBy, idempotencyKey, requestHash]
    );
    const receiptId = receipt.rows[0].id;

    let remaining = amount;
    const allocations: ArReceiptAllocation[] = [];
    for (const row of open.rows) {
      if (remaining <= 0.005) break;
      const invoiceRemaining = round2(Math.max(0, Number(row.rem)));
      if (invoiceRemaining <= 0) continue;
      const take = round2(Math.min(invoiceRemaining, remaining));
      await client.query(
        `INSERT INTO bms_ar_ledger
           (tenant_id, account_id, invoice_id, kind, amount, receipt_id, order_id, actor_user_id, note)
         VALUES ($1,$2,$3,'PAYMENT',$4,$5,$6,$7,'รับชำระหนี้')`,
        [input.tenantId, account.id, row.id, -take, receiptId, row.order_id, input.receivedBy]
      );
      await refreshInvoiceInTx(client, input.tenantId, row.id);
      allocations.push({ invoiceId: row.id, amount: take, orderId: row.order_id });
      remaining = round2(remaining - take);
    }
    if (remaining > 0.005) {
      // ยอดค้างที่นับไว้ก่อนหน้ากับที่ตัดได้จริงไม่ตรง = cache กับ ledger ไม่ตรง
      // ล้มดัง ๆ ดีกว่ารับเงินแล้วบอกไม่ได้ว่าไปตัดใบไหน
      throw new Error(`จัดสรรยอดรับชำระไม่ครบ (เหลือ ${remaining.toFixed(2)})`);
    }

    if (input.method === "CASH" && input.shiftId && input.deviceId) {
      await client.query(
        `INSERT INTO bms_pos_cash_movements
           (tenant_id, shift_id, device_id, direction, amount, reason, actor_user_id, idempotency_key)
         VALUES ($1,$2,$3,'IN',$4,$5,$6,$7)`,
        [input.tenantId, input.shiftId, input.deviceId, amount,
          `รับชำระหนี้ ${allocations.length} ใบ`, input.receivedBy, `ar-receipt:${idempotencyKey}`]
      );
    }

    const balanceAfter = await refreshAccountBalanceInTx(client, input.tenantId, account.id);
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'ar.collect',$3,$4)`,
      [input.tenantId, input.receivedBy, receiptId, JSON.stringify({
        accountId: account.id, amount, method: input.method,
        invoices: allocations.length, shiftId: input.shiftId ?? null, balanceAfter,
      })]
    );
    await client.query("COMMIT");
    return { status: "RECEIVED", receiptId, allocations, balanceAfter, replayed: false };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// ตัดหนี้สูญ
// ---------------------------------------------------------------

export type WriteOffResult =
  | { status: "WRITTEN_OFF"; amount: number; balanceAfter: number }
  | { status: "INVALID"; reason: string };

/**
 * ตัดหนี้สูญ — ลบสินทรัพย์ของร้านทิ้ง จึงแยกสิทธิ์ออกจาก ar.manage และบังคับเหตุผล
 *
 * ไม่ลบใบทิ้ง: ใบยังอยู่ที่สถานะ WRITTEN_OFF พร้อม ledger ที่บอกว่าใครตัดเมื่อไร
 * ด้วยเหตุผลอะไร · หนี้ที่หายไปเฉย ๆ จากรายงานคือช่องให้ปิดบังการยักยอก
 */
export async function writeOffArInvoice(input: {
  tenantId: string;
  invoiceId: string;
  reason: string;
  actorUserId: string;
}): Promise<WriteOffResult> {
  const reason = input.reason.trim();
  if (!reason) return { status: "INVALID", reason: "ต้องระบุเหตุผลในการตัดหนี้สูญ" };

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const inv = await client.query<{ id: string; account_id: string; rem: string; status: ArInvoiceStatus }>(
      `SELECT id, account_id, status, (amount - credited_amount - settled_amount) AS rem
         FROM bms_ar_invoices
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [input.tenantId, input.invoiceId]
    );
    const invoice = inv.rows[0];
    if (!invoice) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "ไม่พบใบแจ้งหนี้นี้" };
    }
    if (invoice.status !== "OPEN" && invoice.status !== "PARTIAL") {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: `ใบนี้อยู่สถานะ ${invoice.status} ตัดหนี้สูญไม่ได้` };
    }
    const remaining = round2(Number(invoice.rem));
    if (remaining <= 0.005) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "ใบนี้ไม่มียอดค้างแล้ว" };
    }

    await client.query(
      `SELECT 1 FROM bms_ar_accounts WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, invoice.account_id]
    );
    await client.query(
      `INSERT INTO bms_ar_ledger
         (tenant_id, account_id, invoice_id, kind, amount, actor_user_id, note)
       VALUES ($1,$2,$3,'WRITE_OFF',$4,$5,$6)`,
      [input.tenantId, invoice.account_id, invoice.id, -remaining, input.actorUserId, reason]
    );
    await refreshInvoiceInTx(client, input.tenantId, invoice.id, { preserveStatus: "WRITTEN_OFF" });
    const balanceAfter = await refreshAccountBalanceInTx(client, input.tenantId, invoice.account_id);
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'ar.writeoff',$3,$4)`,
      [input.tenantId, input.actorUserId, invoice.id,
        JSON.stringify({ amount: remaining, reason, accountId: invoice.account_id, balanceAfter })]
    );
    await client.query("COMMIT");
    return { status: "WRITTEN_OFF", amount: remaining, balanceAfter };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// รายงานปิดกะ — กะนี้ปล่อยเชื่อไปเท่าไร เก็บกลับมาได้เท่าไร
// ---------------------------------------------------------------

export type ArShiftSummary = {
  creditSalesAmount: number;
  creditSalesCount: number;
  collectedAmount: number;
  collectedCount: number;
  /** เฉพาะเงินสด — ยอดนี้อยู่ในลิ้นชักแล้วผ่าน bms_pos_cash_movements */
  collectedCashAmount: number;
};

export async function getArShiftSummary(
  tenantId: string, shiftId: string
): Promise<ArShiftSummary> {
  const res = await query<any>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM bms_ar_invoices
         WHERE tenant_id = $1 AND shift_id = $2) AS sales_amount,
       (SELECT COUNT(*) FROM bms_ar_invoices
         WHERE tenant_id = $1 AND shift_id = $2)::int AS sales_count,
       (SELECT COALESCE(SUM(amount), 0) FROM bms_ar_receipts
         WHERE tenant_id = $1 AND shift_id = $2) AS collected,
       (SELECT COUNT(*) FROM bms_ar_receipts
         WHERE tenant_id = $1 AND shift_id = $2)::int AS collected_count,
       (SELECT COALESCE(SUM(amount), 0) FROM bms_ar_receipts
         WHERE tenant_id = $1 AND shift_id = $2 AND method = 'CASH') AS collected_cash`,
    [tenantId, shiftId]
  );
  const r = res.rows[0] ?? {};
  return {
    creditSalesAmount: Number(r.sales_amount ?? 0),
    creditSalesCount: Number(r.sales_count ?? 0),
    collectedAmount: Number(r.collected ?? 0),
    collectedCount: Number(r.collected_count ?? 0),
    collectedCashAmount: Number(r.collected_cash ?? 0),
  };
}
