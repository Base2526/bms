import crypto from "crypto";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { requireBankReconciliationEnabled } from "./bankReconciliationFeature";
import type { ParsedBankStatement } from "./bankStatementFormat";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])-01$/;

function text(value: unknown, field: string, max = 200): string {
  const clean = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || clean.length > max) throw new Error(`${field} ไม่ถูกต้อง`);
  return clean;
}
function id(value: unknown, field = "id"): string {
  const clean = String(value ?? "");
  if (!uuid.test(clean)) throw new Error(`${field} ไม่ถูกต้อง`);
  return clean;
}
function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function accountFingerprint(value: string): string {
  const secret =
    process.env.BMS_BANK_FINGERPRINT_SECRET || process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32)
    throw new Error("ยังไม่ได้ตั้งค่า secret สำหรับ fingerprint บัญชีธนาคาร");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}
function cents(value: unknown): bigint {
  const normalized = String(value).trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error("ยอดเงินไม่ถูกต้อง");
  const result =
    BigInt(match[2]) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
  return match[1] ? -result : result;
}
function centsText(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
function actor(actorId: string | number): string {
  return String(actorId);
}

/** Read through the same tenant-scoped role/GUC used by mutations. */
export async function queryBankReconciliation<
  T extends QueryResultRow = QueryResultRow,
>(
  tenantId: string,
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query<T>(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function auditTx(
  client: PoolClient,
  tenantId: string,
  actorId: string | number,
  action: string,
  target: string,
  meta: object = {},
) {
  await client.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, actor(actorId), action, target, JSON.stringify(meta)],
  );
}

export type BankAccountInput = {
  bankCode: string;
  displayName: string;
  accountNumber: string;
  currency?: string | null;
  defaultLocationId?: string | null;
};

export async function listBankAccounts(
  tenantId: string,
  includeArchived = false,
) {
  requireBankReconciliationEnabled();
  const result = await queryBankReconciliation(
    tenantId,
    `SELECT id,bank_code,display_name,account_last4,currency,default_location_id,status,created_at
       FROM bms_bank_accounts WHERE tenant_id=$1 AND ($2::boolean OR status='ACTIVE') ORDER BY status,display_name`,
    [tenantId, includeArchived],
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    bankCode: r.bank_code,
    displayName: r.display_name,
    accountLast4: r.account_last4,
    currency: r.currency,
    defaultLocationId: r.default_location_id,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export async function createBankAccount(
  tenantId: string,
  actorId: string | number,
  input: BankAccountInput,
) {
  requireBankReconciliationEnabled();
  const bankCode = text(input.bankCode, "bankCode", 20).toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(bankCode))
    throw new Error("รหัสธนาคารไม่ถูกต้อง");
  const rawAccountNumber = String(input.accountNumber ?? "").trim();
  if (!/^[0-9\s-]+$/.test(rawAccountNumber))
    throw new Error("เลขบัญชีไม่ถูกต้อง");
  const accountNumber = rawAccountNumber.replace(/\D/g, "");
  if (accountNumber.length < 4 || accountNumber.length > 30)
    throw new Error("เลขบัญชีไม่ถูกต้อง");
  const currency = String(input.currency || "THB").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("สกุลเงินไม่ถูกต้อง");
  if (currency !== "THB")
    throw new Error("การจับคู่กับข้อมูล BMS รองรับบัญชี THB เท่านั้นในขณะนี้");
  const fingerprint = accountFingerprint(
    `${tenantId}|${bankCode}|${accountNumber}`,
  );
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actor(actorId) });
    const result = await client.query(
      `INSERT INTO bms_bank_accounts
        (tenant_id,bank_code,display_name,account_last4,account_fingerprint,currency,default_location_id,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,bank_code,display_name,account_last4,currency,status,created_at`,
      [
        tenantId,
        bankCode,
        text(input.displayName, "displayName", 120),
        accountNumber.slice(-4),
        fingerprint,
        currency,
        input.defaultLocationId
          ? id(input.defaultLocationId, "defaultLocationId")
          : null,
        actor(actorId),
      ],
    );
    await auditTx(
      client,
      tenantId,
      actorId,
      "bank_reconciliation.account.create",
      result.rows[0].id,
      { bankCode, accountLast4: accountNumber.slice(-4), currency },
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveBankAccount(
  tenantId: string,
  actorId: string | number,
  accountId: string,
) {
  requireBankReconciliationEnabled();
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actor(actorId) });
    const result = await client.query(
      `UPDATE bms_bank_accounts SET status='ARCHIVED',updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' RETURNING id,status`,
      [tenantId, id(accountId)],
    );
    if (!result.rows[0]) throw new Error("ไม่พบบัญชีธนาคารที่ใช้งานอยู่");
    await auditTx(
      client,
      tenantId,
      actorId,
      "bank_reconciliation.account.archive",
      accountId,
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createStatementImport(params: {
  tenantId: string;
  actorId: string | number;
  accountId: string;
  fileId: number;
  fileSha256: string;
  originalFilename: string;
  idempotencyKey: string;
  parsed: ParsedBankStatement;
}) {
  requireBankReconciliationEnabled();
  const accountId = id(params.accountId, "accountId");
  if (!Number.isSafeInteger(params.fileId) || params.fileId <= 0)
    throw new Error("fileId ไม่ถูกต้อง");
  if (!/^[0-9a-f]{64}$/.test(params.fileSha256))
    throw new Error("file checksum ไม่ถูกต้อง");
  const idempotencyKey = text(params.idempotencyKey, "idempotencyKey", 200);
  const requestHash = hash(
    JSON.stringify({
      accountId,
      fileSha256: params.fileSha256,
      first: params.parsed.periodStart,
      last: params.parsed.periodEnd,
      rows: params.parsed.rows.length,
    }),
  );
  const client = await getClient();
  try {
    await beginTenantTx(client, params.tenantId, {
      editorId: actor(params.actorId),
    });
    const existing = await client.query(
      `SELECT id,request_hash,status FROM bms_bank_statement_imports
      WHERE tenant_id=$1 AND idempotency_key=$2`,
      [params.tenantId, idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash)
        throw new Error("idempotency key ถูกใช้กับไฟล์อื่นแล้ว");
      await client.query("COMMIT");
      return {
        id: existing.rows[0].id,
        status: existing.rows[0].status,
        replayed: true,
      };
    }
    const inserted = await client.query(
      `INSERT INTO bms_bank_statement_imports
       (tenant_id,bank_account_id,file_id,file_sha256,original_filename,parser_key,parser_version,
        period_start,period_end,opening_balance,closing_balance,row_count,idempotency_key,request_hash,imported_by)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
        FROM bms_bank_accounts a WHERE a.tenant_id=$1 AND a.id=$2 AND a.status='ACTIVE'
       RETURNING id,status`,
      [
        params.tenantId,
        accountId,
        params.fileId,
        params.fileSha256,
        text(params.originalFilename, "filename", 255),
        params.parsed.parserKey,
        params.parsed.parserVersion,
        params.parsed.periodStart,
        params.parsed.periodEnd,
        params.parsed.openingBalance,
        params.parsed.closingBalance,
        params.parsed.rows.length,
        idempotencyKey,
        requestHash,
        actor(params.actorId),
      ],
    );
    if (!inserted.rows[0]) throw new Error("ไม่พบบัญชีธนาคารที่ใช้งานอยู่");
    await client.query(
      `INSERT INTO bms_bank_statement_entries
       (tenant_id,import_id,bank_account_id,line_no,posted_on,transaction_at,direction,amount,balance_after,
        reference,description,counterparty_masked,row_fingerprint)
       SELECT $1,$2,$3,x.line_no,x.posted_on::date,x.transaction_at::timestamptz,x.direction,x.amount::numeric,
              x.balance_after::numeric,x.reference,x.description,x.counterparty_masked,x.fingerprint
         FROM jsonb_to_recordset($4::jsonb) AS x(line_no int,posted_on text,transaction_at text,direction text,
              amount text,balance_after text,reference text,description text,counterparty_masked text,fingerprint text)`,
      [
        params.tenantId,
        inserted.rows[0].id,
        accountId,
        JSON.stringify(
          params.parsed.rows.map((r) => ({
            line_no: r.lineNo,
            posted_on: r.postedOn,
            transaction_at: r.transactionAt,
            direction: r.direction,
            amount: r.amount,
            balance_after: r.balanceAfter,
            reference: r.reference,
            description: r.description,
            counterparty_masked: r.counterpartyMasked,
            fingerprint: r.fingerprint,
          })),
        ),
      ],
    );
    await auditTx(
      client,
      params.tenantId,
      params.actorId,
      "bank_reconciliation.import.validate",
      inserted.rows[0].id,
      {
        accountId,
        rowCount: params.parsed.rows.length,
        fileSha256: params.fileSha256,
        warnings: params.parsed.warnings.length,
      },
    );
    await client.query("COMMIT");
    return { ...inserted.rows[0], replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listStatementImports(
  tenantId: string,
  accountId?: string | null,
  limit = 100,
) {
  requireBankReconciliationEnabled();
  const result = await queryBankReconciliation(
    tenantId,
    `SELECT i.id,i.bank_account_id,a.display_name,a.account_last4,i.original_filename,
      i.period_start,i.period_end,i.row_count,i.status,i.created_at,i.committed_at,i.void_reason
    FROM bms_bank_statement_imports i JOIN bms_bank_accounts a ON a.tenant_id=i.tenant_id AND a.id=i.bank_account_id
    WHERE i.tenant_id=$1 AND ($2::uuid IS NULL OR i.bank_account_id=$2)
    ORDER BY i.created_at DESC LIMIT $3`,
    [
      tenantId,
      accountId ? id(accountId) : null,
      Math.min(Math.max(limit, 1), 500),
    ],
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    bankAccountId: r.bank_account_id,
    accountName: r.display_name,
    accountLast4: r.account_last4,
    originalFilename: r.original_filename,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    rowCount: r.row_count,
    status: r.status,
    createdAt: r.created_at,
    committedAt: r.committed_at,
    voidReason: r.void_reason,
  }));
}

async function mutateImportStatus(
  tenantId: string,
  actorId: string | number,
  importId: string,
  action: "commit" | "void",
  reason?: string,
) {
  requireBankReconciliationEnabled();
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actor(actorId) });
    const result =
      action === "commit"
        ? await client.query(
            `UPDATE bms_bank_statement_imports SET status='COMMITTED',committed_at=now(),updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='VALIDATED'
            AND NOT EXISTS (SELECT 1 FROM bms_bank_statement_entries e JOIN bms_bank_reconciliation_periods p
              ON p.tenant_id=e.tenant_id AND p.bank_account_id=e.bank_account_id
             AND p.period_month=date_trunc('month',e.posted_on)::date AND p.status='CLOSED'
              WHERE e.tenant_id=$1 AND e.import_id=$2) RETURNING id,status`,
            [tenantId, id(importId)],
          )
        : await client.query(
            `UPDATE bms_bank_statement_imports SET status='VOID',voided_at=now(),voided_by=$3,void_reason=$4,updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status IN ('VALIDATED','COMMITTED')
            AND NOT EXISTS (SELECT 1 FROM bms_bank_statement_entries e JOIN bms_bank_reconciliation_periods p
              ON p.tenant_id=e.tenant_id AND p.bank_account_id=e.bank_account_id
             AND p.period_month=date_trunc('month',e.posted_on)::date AND p.status='CLOSED'
              WHERE e.tenant_id=$1 AND e.import_id=$2)
            AND NOT EXISTS (SELECT 1 FROM bms_bank_reconciliation_links l JOIN bms_bank_statement_entries e
              ON e.tenant_id=l.tenant_id AND e.id=l.bank_entry_id
              WHERE e.tenant_id=$1 AND e.import_id=$2 AND l.status='CONFIRMED') RETURNING id,status`,
            [
              tenantId,
              id(importId),
              actor(actorId),
              text(reason, "reason", 500),
            ],
          );
    if (!result.rows[0])
      throw new Error(
        action === "commit"
          ? "รายการนำเข้าไม่อยู่ในสถานะรอยืนยัน"
          : "ยกเลิกไม่ได้: มีการจับคู่แล้วหรือสถานะไม่ถูกต้อง",
      );
    await auditTx(
      client,
      tenantId,
      actorId,
      `bank_reconciliation.import.${action}`,
      importId,
      reason ? { reason } : {},
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
export const commitStatementImport = (
  tenantId: string,
  actorId: string | number,
  importId: string,
) => mutateImportStatus(tenantId, actorId, importId, "commit");
export const voidStatementImport = (
  tenantId: string,
  actorId: string | number,
  importId: string,
  reason: string,
) => mutateImportStatus(tenantId, actorId, importId, "void", reason);

export async function listStatementEntries(
  tenantId: string,
  input: {
    accountId?: string | null;
    month?: string | null;
    status?: string | null;
    limit?: number;
    offset?: number;
  },
) {
  requireBankReconciliationEnabled();
  const accountId = input.accountId ? id(input.accountId) : null;
  const month = input.month
    ? monthPattern.test(input.month)
      ? input.month
      : (() => {
          throw new Error("month ไม่ถูกต้อง");
        })()
    : null;
  const allowedStatuses = new Set([
    "UNMATCHED",
    "SUGGESTED",
    "PARTIAL",
    "MATCHED",
    "IGNORED",
    "STALE",
  ]);
  const status = input.status || null;
  if (status && !allowedStatuses.has(status))
    throw new Error("status ไม่ถูกต้อง");
  // STALE is derived from live source data. Resolve it before LIMIT/OFFSET so
  // filtered pagination never drops stale rows or leaves holes in MATCHED.
  const staleRows = status
    ? await findStaleEntries(tenantId, accountId, month, null)
    : [];
  let staleIds = [
    ...new Set(staleRows.map((row) => String(row.bank_entry_id))),
  ];
  const result = await queryBankReconciliation(
    tenantId,
    `SELECT e.id,e.import_id,e.bank_account_id,e.posted_on,e.direction,e.amount,e.balance_after,
      e.reference,e.description,e.counterparty_masked,e.reconciliation_status,
      COALESCE((SELECT sum(l.matched_amount) FROM bms_bank_reconciliation_links l WHERE l.tenant_id=e.tenant_id AND l.bank_entry_id=e.id AND l.status='CONFIRMED'),0) matched_amount
    FROM bms_bank_statement_entries e JOIN bms_bank_statement_imports i ON i.tenant_id=e.tenant_id AND i.id=e.import_id
    WHERE e.tenant_id=$1 AND i.status='COMMITTED' AND ($2::uuid IS NULL OR e.bank_account_id=$2)
      AND ($3::date IS NULL OR (e.posted_on >= $3::date AND e.posted_on < $3::date + interval '1 month'))
      AND ($5::text IS NULL
        OR ($5='STALE' AND e.id=ANY($4::uuid[]))
        OR ($5<>'STALE' AND e.reconciliation_status=$5 AND NOT(e.id=ANY($4::uuid[]))))
    ORDER BY e.posted_on DESC,e.line_no DESC LIMIT $6 OFFSET $7`,
    [
      tenantId,
      accountId,
      month,
      staleIds,
      status,
      Math.min(Math.max(input.limit || 100, 1), 500),
      Math.max(input.offset || 0, 0),
    ],
  );
  if (!status) {
    staleIds = [
      ...new Set(
        (
          await findStaleEntries(
            tenantId,
            accountId,
            month,
            result.rows.map((r: any) => String(r.id)),
          )
        ).map((row) => String(row.bank_entry_id)),
      ),
    ];
  }
  const stale = new Set(staleIds);
  const entries = result.rows.map((r: any) => ({
    id: r.id,
    importId: r.import_id,
    bankAccountId: r.bank_account_id,
    postedOn: r.posted_on,
    direction: r.direction,
    amount: r.amount,
    balanceAfter: r.balance_after,
    reference: r.reference,
    description: r.description,
    counterpartyMasked: r.counterparty_masked,
    status: stale.has(String(r.id)) ? "STALE" : r.reconciliation_status,
    matchedAmount: r.matched_amount,
  }));
  return entries;
}

export type ReconciliationCandidate = {
  sourceKey: string;
  sourceType: string;
  sourceDate: string;
  amount: string;
  reference: string | null;
  label: string;
  ruleCode: string;
  confidence: number;
  sourceFingerprint: string;
};
export async function listReconciliationLinks(
  tenantId: string,
  entryId: string,
) {
  requireBankReconciliationEnabled();
  const checkedEntryId = id(entryId, "entryId");
  const staleLinkIds = new Set(
    (await findStaleEntries(tenantId, null, null, [checkedEntryId])).map(
      (row) => String(row.link_id),
    ),
  );
  const result = await queryBankReconciliation<any>(
    tenantId,
    `SELECT l.id,l.source_key,l.matched_amount,l.rule_code,l.confidence,l.status,
      l.confirmed_at,l.voided_at,l.void_reason
    FROM bms_bank_reconciliation_links l
    JOIN bms_bank_statement_entries e ON e.tenant_id=l.tenant_id AND e.id=l.bank_entry_id
    JOIN bms_bank_statement_imports i ON i.tenant_id=e.tenant_id AND i.id=e.import_id
    WHERE l.tenant_id=$1 AND l.bank_entry_id=$2 AND i.status='COMMITTED'
    ORDER BY l.confirmed_at DESC,l.id`,
    [tenantId, checkedEntryId],
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    sourceKey: r.source_key,
    matchedAmount: r.matched_amount,
    ruleCode: r.rule_code,
    confidence: r.confidence,
    status: r.status,
    confirmedAt: r.confirmed_at,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
    stale: r.status === "CONFIRMED" && staleLinkIds.has(String(r.id)),
  }));
}

export async function listCandidates(
  tenantId: string,
  entryId: string,
  client?: PoolClient,
): Promise<ReconciliationCandidate[]> {
  requireBankReconciliationEnabled();
  const run = <T extends QueryResultRow>(sql: string, params: unknown[]) =>
    client
      ? client.query<T>(sql, params)
      : queryBankReconciliation<T>(tenantId, sql, params);
  const entryResult = await run<any>(
    `SELECT e.* FROM bms_bank_statement_entries e JOIN bms_bank_statement_imports i ON i.tenant_id=e.tenant_id AND i.id=e.import_id
    WHERE e.tenant_id=$1 AND e.id=$2 AND i.status='COMMITTED'`,
    [tenantId, id(entryId)],
  );
  const entry = entryResult.rows[0];
  if (!entry) throw new Error("ไม่พบรายการธนาคาร");
  const amount = String(entry.amount);
  const date = String(entry.posted_on).slice(0, 10);
  const direction = String(entry.direction);
  const result = await run<any>(
    `WITH candidates AS (
    SELECT 'PAYMENT:'||p.id source_key,'PAYMENT' source_type,timezone('Asia/Bangkok',p.created_at)::date source_date,p.amount,
      p.slip_ref reference,'รับชำระออเดอร์' label FROM bms_payments p
      WHERE $4='IN' AND p.tenant_id=$1 AND p.status='CONFIRMED' AND p.method IN ('BANK_TRANSFER','QR')
        AND timezone('Asia/Bangkok',p.created_at)::date BETWEEN $2::date-7 AND $2::date+7
    UNION ALL SELECT 'AR_RECEIPT:'||r.id,'AR_RECEIPT',timezone('Asia/Bangkok',r.created_at)::date,r.amount,r.reference,'รับชำระลูกหนี้'
      FROM bms_ar_receipts r WHERE $4='IN' AND r.tenant_id=$1 AND r.method IN ('BANK_TRANSFER','QR')
        AND timezone('Asia/Bangkok',r.created_at)::date BETWEEN $2::date-7 AND $2::date+7
    UNION ALL SELECT 'EXPENSE_DOCUMENT:'||d.id,'EXPENSE_DOCUMENT',d.paid_at,
      d.amount_before_vat+d.vat_amount-d.wht_amount,d.document_no,'เอกสารรายจ่าย: '||d.payee_name
      FROM bms_expense_documents d WHERE $4='OUT' AND d.tenant_id=$1 AND d.status='ACTIVE' AND d.paid_at IS NOT NULL
        AND d.paid_at BETWEEN $2::date-7 AND $2::date+7
    UNION ALL SELECT 'REFUND:'||r.id,'REFUND',timezone('Asia/Bangkok',r.completed_at)::date,r.amount,r.external_ref,'คืนเงินลูกค้า'
      FROM bms_pos_refund_allocations r WHERE $4='OUT' AND r.tenant_id=$1 AND r.status='COMPLETED'
        AND r.method IN ('BANK_TRANSFER','QR','CARD','WALLET') AND timezone('Asia/Bangkok',r.completed_at)::date BETWEEN $2::date-7 AND $2::date+7
    UNION ALL SELECT 'DELIVERY_SETTLEMENT:'||s.id,'DELIVERY_SETTLEMENT',timezone('Asia/Bangkok',s.period_end)::date,
      COALESCE(s.actual_net_amount,s.expected_net_amount),s.statement_reference,'ยอดโอนแพลตฟอร์ม '||s.provider
      FROM bms_delivery_settlements s WHERE $4='IN' AND s.tenant_id=$1 AND s.status IN ('MATCHED','CLOSED')
        AND timezone('Asia/Bangkok',s.period_end)::date BETWEEN $2::date-7 AND $2::date+7
    UNION ALL SELECT 'BANK_ENTRY:'||o.id,'BANK_ENTRY',o.posted_on,o.amount,o.reference,'โอนระหว่างบัญชี'
      FROM bms_bank_statement_entries o JOIN bms_bank_statement_imports oi ON oi.tenant_id=o.tenant_id AND oi.id=o.import_id
      WHERE o.tenant_id=$1 AND o.id<>$5 AND o.direction<>$4 AND oi.status='COMMITTED'
        AND o.posted_on BETWEEN $2::date-3 AND $2::date+3
  ), ranked AS (SELECT *,CASE WHEN amount=$3::numeric AND source_date=$2::date THEN 100 WHEN amount=$3::numeric THEN 90
      WHEN abs(amount-$3::numeric)<=0.01 THEN 80 ELSE 60 END confidence
    FROM candidates)
    SELECT r.* FROM ranked r
    WHERE NOT EXISTS(SELECT 1 FROM bms_bank_reconciliation_links l
      WHERE l.tenant_id=$1 AND l.bank_entry_id=$5 AND l.source_key=r.source_key AND l.status='CONFIRMED')
    ORDER BY confidence DESC,abs(source_date-$2::date),source_key LIMIT 50`,
    [tenantId, date, amount, direction, entryId],
  );
  return result.rows.map((r: any) => {
    const normalized = [
      r.source_key,
      String(r.source_date).slice(0, 10),
      String(r.amount),
      r.reference || "",
    ].join("|");
    return {
      sourceKey: r.source_key,
      sourceType: r.source_type,
      sourceDate: r.source_date,
      amount: r.amount,
      reference: r.reference,
      label: r.label,
      ruleCode:
        r.confidence === 100
          ? "EXACT_AMOUNT_DATE"
          : r.confidence >= 90
            ? "EXACT_AMOUNT_NEAR_DATE"
            : r.confidence >= 80
              ? "AMOUNT_TOLERANCE"
              : "DATE_WINDOW",
      confidence: r.confidence,
      sourceFingerprint: hash(normalized),
    };
  });
}

const STALE_LINK_SQL = `WITH links AS (
  SELECT l.id,l.bank_entry_id,l.source_key,l.source_fingerprint,e.reconciliation_status
    FROM bms_bank_reconciliation_links l
    JOIN bms_bank_statement_entries e ON e.tenant_id=l.tenant_id AND e.id=l.bank_entry_id
    JOIN bms_bank_statement_imports i ON i.tenant_id=e.tenant_id AND i.id=e.import_id
   WHERE l.tenant_id=$1 AND l.status='CONFIRMED' AND i.status='COMMITTED'
     AND ($2::uuid IS NULL OR e.bank_account_id=$2)
     AND ($3::date IS NULL OR (e.posted_on >=$3::date AND e.posted_on<$3::date+interval '1 month'))
     AND ($4::uuid[] IS NULL OR e.id=ANY($4::uuid[]))
), current_sources AS (
  SELECT l.id,encode(digest(l.source_key||'|'||timezone('Asia/Bangkok',p.created_at)::date::text||'|'||p.amount::text||'|'||COALESCE(p.slip_ref,''),'sha256'),'hex') fingerprint
    FROM links l JOIN bms_payments p ON p.tenant_id=$1 AND l.source_key='PAYMENT:'||p.id::text
   WHERE p.status='CONFIRMED' AND p.method IN('BANK_TRANSFER','QR')
  UNION ALL SELECT l.id,encode(digest(l.source_key||'|'||timezone('Asia/Bangkok',r.created_at)::date::text||'|'||r.amount::text||'|'||COALESCE(r.reference,''),'sha256'),'hex')
    FROM links l JOIN bms_ar_receipts r ON r.tenant_id=$1 AND l.source_key='AR_RECEIPT:'||r.id::text WHERE r.method IN('BANK_TRANSFER','QR')
  UNION ALL SELECT l.id,encode(digest(l.source_key||'|'||d.paid_at::text||'|'||(d.amount_before_vat+d.vat_amount-d.wht_amount)::text||'|'||COALESCE(d.document_no,''),'sha256'),'hex')
    FROM links l JOIN bms_expense_documents d ON d.tenant_id=$1 AND l.source_key='EXPENSE_DOCUMENT:'||d.id::text WHERE d.status='ACTIVE' AND d.paid_at IS NOT NULL
  UNION ALL SELECT l.id,encode(digest(l.source_key||'|'||timezone('Asia/Bangkok',r.completed_at)::date::text||'|'||r.amount::text||'|'||COALESCE(r.external_ref,''),'sha256'),'hex')
    FROM links l JOIN bms_pos_refund_allocations r ON r.tenant_id=$1 AND l.source_key='REFUND:'||r.id::text WHERE r.status='COMPLETED'
  UNION ALL SELECT l.id,encode(digest(l.source_key||'|'||timezone('Asia/Bangkok',s.period_end)::date::text||'|'||COALESCE(s.actual_net_amount,s.expected_net_amount)::text||'|'||COALESCE(s.statement_reference,''),'sha256'),'hex')
    FROM links l JOIN bms_delivery_settlements s ON s.tenant_id=$1 AND l.source_key='DELIVERY_SETTLEMENT:'||s.id::text WHERE s.status IN('MATCHED','CLOSED')
  UNION ALL SELECT l.id,encode(digest(l.source_key||'|'||e.posted_on::text||'|'||e.amount::text||'|'||COALESCE(e.reference,''),'sha256'),'hex')
    FROM links l JOIN bms_bank_statement_entries e ON e.tenant_id=$1 AND l.source_key='BANK_ENTRY:'||e.id::text
    JOIN bms_bank_statement_imports i ON i.tenant_id=e.tenant_id AND i.id=e.import_id AND i.status='COMMITTED'
)
SELECT l.id link_id,l.bank_entry_id,l.reconciliation_status FROM links l LEFT JOIN current_sources c ON c.id=l.id
 WHERE c.fingerprint IS NULL OR c.fingerprint<>l.source_fingerprint`;

async function findStaleEntries(
  tenantId: string,
  accountId: string | null,
  month: string | null,
  entryIds: string[] | null,
  client?: PoolClient,
) {
  const params = [tenantId, accountId, month, entryIds];
  const result = client
    ? await client.query(STALE_LINK_SQL, params)
    : await queryBankReconciliation(tenantId, STALE_LINK_SQL, params);
  return result.rows as Array<{
    link_id: string;
    bank_entry_id: string;
    reconciliation_status: string;
  }>;
}

export async function listStaleBankEntryIds(
  tenantId: string,
  accountId: string,
  month: string,
): Promise<string[]> {
  requireBankReconciliationEnabled();
  const aid = id(accountId, "accountId");
  if (!monthPattern.test(month)) throw new Error("month ไม่ถูกต้อง");
  return [
    ...new Set(
      (await findStaleEntries(tenantId, aid, month, null)).map((row) =>
        String(row.bank_entry_id),
      ),
    ),
  ];
}

async function refreshEntryStatus(
  client: PoolClient,
  tenantId: string,
  entryId: string,
) {
  await client.query(
    `UPDATE bms_bank_statement_entries e SET reconciliation_status=CASE
      WHEN COALESCE(x.total,0)=0 THEN 'UNMATCHED' WHEN x.total<e.amount THEN 'PARTIAL'
      WHEN x.total=e.amount THEN 'MATCHED' ELSE 'STALE' END
    FROM (SELECT COALESCE(sum(matched_amount),0) total FROM bms_bank_reconciliation_links
      WHERE tenant_id=$1 AND bank_entry_id=$2 AND status='CONFIRMED') x
    WHERE e.tenant_id=$1 AND e.id=$2`,
    [tenantId, entryId],
  );
}

export async function confirmReconciliationLink(
  tenantId: string,
  actorId: string | number,
  input: {
    entryId: string;
    sourceKey: string;
    matchedAmount: string;
    sourceFingerprint: string;
  },
) {
  requireBankReconciliationEnabled();
  const entryId = id(input.entryId, "entryId");
  const sourceKey = text(input.sourceKey, "sourceKey", 100);
  if (
    !/^(PAYMENT|AR_RECEIPT|EXPENSE_DOCUMENT|REFUND|DELIVERY_SETTLEMENT|BANK_ENTRY):[0-9a-f-]{36}$/i.test(
      sourceKey,
    )
  )
    throw new Error("sourceKey ไม่ถูกต้อง");
  const lockKey = `${tenantId}:${sourceKey}`;
  const client = await getClient();
  let sessionLocked = false;
  try {
    // Take the source-capacity lock before the serializable snapshot exists.
    // A transaction-level lock statement would establish an old snapshot while
    // waiting and could miss a match committed by the preceding lock holder.
    await client.query(`SELECT pg_advisory_lock(hashtextextended($1,0))`, [
      lockKey,
    ]);
    sessionLocked = true;
    await beginTenantTx(client, tenantId, {
      editorId: actor(actorId),
      serializable: true,
    });
    // Re-read the candidate inside the serializable transaction. Comparing a
    // fingerprint before BEGIN leaves a race where the source changes between
    // validation and insertion.
    const candidates = await listCandidates(tenantId, entryId, client);
    const candidate = candidates.find((c) => c.sourceKey === sourceKey);
    if (!candidate || candidate.sourceFingerprint !== input.sourceFingerprint)
      throw new Error("ข้อมูลต้นทางเปลี่ยนไปแล้ว กรุณาค้นหาใหม่");
    const amountCents = cents(input.matchedAmount);
    if (amountCents <= 0n || amountCents > cents(candidate.amount))
      throw new Error("ยอดจับคู่ไม่ถูกต้อง");
    const amount = centsText(amountCents);
    const entry = await client.query<any>(
      `SELECT e.amount,e.reconciliation_status FROM bms_bank_statement_entries e
      JOIN bms_bank_statement_imports i ON i.tenant_id=e.tenant_id AND i.id=e.import_id
      WHERE e.tenant_id=$1 AND e.id=$2 AND i.status='COMMITTED'
        AND NOT EXISTS(SELECT 1 FROM bms_bank_reconciliation_periods p WHERE p.tenant_id=e.tenant_id
          AND p.bank_account_id=e.bank_account_id AND p.period_month=date_trunc('month',e.posted_on)::date AND p.status='CLOSED')
      FOR UPDATE OF e,i`,
      [tenantId, entryId],
    );
    if (!entry.rows[0] || entry.rows[0].reconciliation_status === "IGNORED")
      throw new Error("รายการนี้ไม่พร้อมจับคู่");
    const used = await client.query<any>(
      `SELECT COALESCE(sum(matched_amount),0) total FROM bms_bank_reconciliation_links
      WHERE tenant_id=$1 AND bank_entry_id=$2 AND status='CONFIRMED'`,
      [tenantId, entryId],
    );
    if (cents(used.rows[0].total) + amountCents > cents(entry.rows[0].amount))
      throw new Error("ยอดจับคู่รวมเกินรายการธนาคาร");
    const sourceUsed = await client.query<any>(
      `SELECT COALESCE(sum(matched_amount),0) total FROM bms_bank_reconciliation_links
      WHERE tenant_id=$1 AND source_key=$2 AND status='CONFIRMED'`,
      [tenantId, candidate.sourceKey],
    );
    if (cents(sourceUsed.rows[0].total) + amountCents > cents(candidate.amount))
      throw new Error("เอกสารต้นทางถูกจับคู่ครบยอดแล้ว");
    const inserted = await client.query(
      `INSERT INTO bms_bank_reconciliation_links
      (tenant_id,bank_entry_id,source_key,matched_amount,source_fingerprint,rule_code,confidence,confirmed_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status`,
      [
        tenantId,
        entryId,
        candidate.sourceKey,
        amount,
        candidate.sourceFingerprint,
        candidate.ruleCode,
        candidate.confidence,
        actor(actorId),
      ],
    );
    await refreshEntryStatus(client, tenantId, entryId);
    await auditTx(
      client,
      tenantId,
      actorId,
      "bank_reconciliation.match.confirm",
      inserted.rows[0].id,
      {
        entryId,
        sourceKey: candidate.sourceKey,
        matchedAmount: amount,
      },
    );
    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (sessionLocked)
      await client
        .query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`, [lockKey])
        .catch(() => undefined);
    client.release();
  }
}

export async function voidReconciliationLink(
  tenantId: string,
  actorId: string | number,
  linkId: string,
  reason: string,
) {
  requireBankReconciliationEnabled();
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actor(actorId) });
    const result = await client.query<any>(
      `UPDATE bms_bank_reconciliation_links l SET status='VOID',voided_by=$3,voided_at=now(),void_reason=$4,version=version+1,updated_at=now()
      WHERE l.tenant_id=$1 AND l.id=$2 AND l.status='CONFIRMED'
        AND NOT EXISTS(SELECT 1 FROM bms_bank_statement_entries e JOIN bms_bank_reconciliation_periods p
          ON p.tenant_id=e.tenant_id AND p.bank_account_id=e.bank_account_id AND p.period_month=date_trunc('month',e.posted_on)::date
          WHERE e.tenant_id=l.tenant_id AND e.id=l.bank_entry_id AND p.status='CLOSED')
      RETURNING l.id,l.bank_entry_id,l.status`,
      [
        tenantId,
        id(linkId, "linkId"),
        actor(actorId),
        text(reason, "reason", 500),
      ],
    );
    if (!result.rows[0]) throw new Error("ไม่พบการจับคู่ที่ยกเลิกได้");
    await refreshEntryStatus(client, tenantId, result.rows[0].bank_entry_id);
    await auditTx(
      client,
      tenantId,
      actorId,
      "bank_reconciliation.match.void",
      linkId,
      { reason },
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function ignoreStatementEntry(
  tenantId: string,
  actorId: string | number,
  entryId: string,
  reason: string,
) {
  requireBankReconciliationEnabled();
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actor(actorId) });
    const result = await client.query(
      `UPDATE bms_bank_statement_entries e SET reconciliation_status='IGNORED',ignored_reason=$4,ignored_by=$3,ignored_at=now()
      WHERE e.tenant_id=$1 AND e.id=$2 AND e.reconciliation_status IN ('UNMATCHED','SUGGESTED')
        AND NOT EXISTS(SELECT 1 FROM bms_bank_reconciliation_periods p WHERE p.tenant_id=e.tenant_id
          AND p.bank_account_id=e.bank_account_id AND p.period_month=date_trunc('month',e.posted_on)::date AND p.status='CLOSED')
        AND NOT EXISTS(SELECT 1 FROM bms_bank_reconciliation_links l WHERE l.tenant_id=$1 AND l.bank_entry_id=e.id AND l.status='CONFIRMED') RETURNING id,reconciliation_status status`,
      [
        tenantId,
        id(entryId, "entryId"),
        actor(actorId),
        text(reason, "reason", 500),
      ],
    );
    if (!result.rows[0]) throw new Error("รายการนี้ไม่สามารถข้ามได้");
    await auditTx(
      client,
      tenantId,
      actorId,
      "bank_reconciliation.entry.ignore",
      entryId,
      { reason },
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function reconciliationSummary(
  tenantId: string,
  accountId?: string | null,
  month?: string | null,
) {
  requireBankReconciliationEnabled();
  if (month && !monthPattern.test(month)) throw new Error("month ไม่ถูกต้อง");
  const aid = accountId ? id(accountId) : null;
  const staleIds = [
    ...new Set(
      (await findStaleEntries(tenantId, aid, month || null, null)).map((row) =>
        String(row.bank_entry_id),
      ),
    ),
  ];
  const result = await queryBankReconciliation<any>(
    tenantId,
    `SELECT count(*)::int total_count,
      count(*) FILTER(WHERE e.reconciliation_status='MATCHED' AND NOT(e.id=ANY($4::uuid[])))::int matched_count,
      count(*) FILTER(WHERE e.reconciliation_status IN ('UNMATCHED','SUGGESTED','PARTIAL','STALE') OR e.id=ANY($4::uuid[]))::int unresolved_count,
      COALESCE(sum(CASE WHEN e.direction='IN' THEN e.amount ELSE -e.amount END),0) net_movement,
      COALESCE(sum(e.amount) FILTER(WHERE e.reconciliation_status='MATCHED' AND NOT(e.id=ANY($4::uuid[]))),0) matched_amount
    FROM bms_bank_statement_entries e JOIN bms_bank_statement_imports i ON i.tenant_id=e.tenant_id AND i.id=e.import_id
    WHERE e.tenant_id=$1 AND i.status='COMMITTED' AND ($2::uuid IS NULL OR e.bank_account_id=$2)
      AND ($3::date IS NULL OR(e.posted_on >= $3::date AND e.posted_on<$3::date+interval '1 month'))`,
    [tenantId, aid, month || null, staleIds],
  );
  const r = result.rows[0];
  return {
    totalCount: r.total_count,
    matchedCount: r.matched_count,
    unresolvedCount: r.unresolved_count,
    netMovement: r.net_movement,
    matchedAmount: r.matched_amount,
  };
}

export async function listPeriods(tenantId: string, accountId?: string | null) {
  requireBankReconciliationEnabled();
  const result = await queryBankReconciliation<any>(
    tenantId,
    `SELECT p.* FROM bms_bank_reconciliation_periods p
  WHERE p.tenant_id=$1 AND($2::uuid IS NULL OR p.bank_account_id=$2) ORDER BY period_month DESC LIMIT 120`,
    [tenantId, accountId ? id(accountId) : null],
  );
  return result.rows.map((r: any) => ({
    bankAccountId: r.bank_account_id,
    periodMonth: r.period_month,
    status: r.status,
    openingBalance: r.opening_balance,
    closingBalance: r.closing_balance,
    version: r.version,
    closedAt: r.closed_at,
    reopenedAt: r.reopened_at,
    reopenReason: r.reopen_reason,
  }));
}

export async function closeReconciliationPeriod(
  tenantId: string,
  actorId: string | number,
  accountId: string,
  month: string,
) {
  requireBankReconciliationEnabled();
  if (!monthPattern.test(month)) throw new Error("month ไม่ถูกต้อง");
  const aid = id(accountId, "accountId");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, {
      editorId: actor(actorId),
      serializable: true,
    });
    const stale = new Set(
      (await findStaleEntries(tenantId, aid, month, null, client)).map((row) =>
        String(row.bank_entry_id),
      ),
    );
    if (stale.size)
      throw new Error(
        `มี ${stale.size} รายการที่ข้อมูลต้นทางเปลี่ยนไป กรุณาตรวจใหม่`,
      );
    const stats = await client.query<any>(
      `WITH month_imports AS (
      SELECT DISTINCT i.id,i.period_start,i.period_end,i.created_at,i.opening_balance,i.closing_balance
        FROM bms_bank_statement_imports i JOIN bms_bank_statement_entries e ON e.tenant_id=i.tenant_id AND e.import_id=i.id
       WHERE i.tenant_id=$1 AND i.bank_account_id=$2 AND i.status='COMMITTED'
         AND e.posted_on >=$3::date AND e.posted_on<$3::date+interval'1 month'
    ), balances AS (
      SELECT (array_agg(opening_balance ORDER BY period_start,created_at))[1] opening,
             (array_agg(closing_balance ORDER BY period_end DESC,created_at DESC))[1] closing FROM month_imports
    ) SELECT count(*)::int total,count(*)FILTER(WHERE e.reconciliation_status IN('UNMATCHED','SUGGESTED','PARTIAL','STALE'))::int unresolved,
      b.opening,b.closing,
      COALESCE(sum(CASE WHEN e.direction='IN'THEN e.amount ELSE -e.amount END),0) movement
      FROM bms_bank_statement_entries e JOIN bms_bank_statement_imports i ON i.tenant_id=e.tenant_id AND i.id=e.import_id
      CROSS JOIN balances b
      WHERE e.tenant_id=$1 AND e.bank_account_id=$2 AND i.status='COMMITTED' AND e.posted_on >=$3::date AND e.posted_on<$3::date+interval'1 month'
      GROUP BY b.opening,b.closing`,
      [tenantId, aid, month],
    );
    const s = stats.rows[0];
    if (!s.total) throw new Error("เดือนไม่มีรายการที่ยืนยันนำเข้าแล้ว");
    if (s.unresolved)
      throw new Error(`ยังมี ${s.unresolved} รายการที่ยังไม่กระทบยอด`);
    if (
      s.opening != null &&
      s.closing != null &&
      cents(s.opening) + cents(s.movement) !== cents(s.closing)
    )
      throw new Error("ยอดยกมา + รายการเคลื่อนไหว ไม่เท่ากับยอดคงเหลือ");
    const result = await client.query(
      `INSERT INTO bms_bank_reconciliation_periods(tenant_id,bank_account_id,period_month,opening_balance,closing_balance,status,closed_by,closed_at)
      VALUES($1,$2,$3,$4,$5,'CLOSED',$6,now()) ON CONFLICT(tenant_id,bank_account_id,period_month) DO UPDATE SET opening_balance=EXCLUDED.opening_balance,closing_balance=EXCLUDED.closing_balance,status='CLOSED',closed_by=EXCLUDED.closed_by,closed_at=now(),version=bms_bank_reconciliation_periods.version+1,updated_at=now()
      WHERE bms_bank_reconciliation_periods.status<>'CLOSED' RETURNING bank_account_id,period_month,status,version`,
      [tenantId, aid, month, s.opening, s.closing, actor(actorId)],
    );
    if (!result.rows[0]) throw new Error("เดือนนี้ปิดแล้ว");
    await auditTx(
      client,
      tenantId,
      actorId,
      "bank_reconciliation.period.close",
      `${aid}:${month}`,
      { total: s.total, opening: s.opening, closing: s.closing },
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function reopenReconciliationPeriod(
  tenantId: string,
  actorId: string | number,
  accountId: string,
  month: string,
  reason: string,
) {
  requireBankReconciliationEnabled();
  if (!monthPattern.test(month)) throw new Error("month ไม่ถูกต้อง");
  const aid = id(accountId, "accountId");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actor(actorId) });
    const result = await client.query(
      `UPDATE bms_bank_reconciliation_periods SET status='REOPENED',reopened_by=$4,reopened_at=now(),reopen_reason=$5,version=version+1,updated_at=now()
      WHERE tenant_id=$1 AND bank_account_id=$2 AND period_month=$3 AND status='CLOSED' RETURNING bank_account_id,period_month,status,version`,
      [tenantId, aid, month, actor(actorId), text(reason, "reason", 500)],
    );
    if (!result.rows[0]) throw new Error("ไม่พบเดือนที่ปิดแล้ว");
    await auditTx(
      client,
      tenantId,
      actorId,
      "bank_reconciliation.period.reopen",
      `${aid}:${month}`,
      { reason },
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function bankReconciliationReadiness() {
  return {
    enabled: true,
    fileImport: true,
    supportedFormats: ["CSV", "XLSX", "XLS"],
    deterministicMatching: true,
    humanConfirmationRequired: true,
    openBanking: "NOT_CONFIGURED",
    sourceMutation: false,
  };
}
