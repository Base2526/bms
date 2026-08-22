// =============================================================
// POS petty-cash expenses
// -------------------------------------------------------------
// ค่าใช้จ่ายคือ "ความหมายทางธุรกิจ" ของเงิน ส่วน bms_pos_cash_movements คือ
// ความจริงทางกายภาพของลิ้นชัก ทั้งสองแถวจึงต้องเกิดใน transaction เดียวกัน
// เพื่อไม่ให้รายงานค่าใช้จ่ายกับยอดปิดกะพูดคนละเรื่อง
// =============================================================

import crypto from "crypto";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { drawerExpectedInTx } from "./pos";
import { getVatSettings } from "./taxDocuments";
import { calculatePettyCashSettlement } from "@/lib/pos/pettyCash";

export const POS_EXPENSE_CATEGORIES = [
  "INGREDIENTS",
  "PACKAGING",
  "DELIVERY",
  "TRANSPORT",
  "CLEANING",
  "REPAIRS",
  "UTILITIES",
  "OTHER",
] as const;

export type PosExpenseCategory = (typeof POS_EXPENSE_CATEGORIES)[number];
export type PosExpenseKind = "DIRECT" | "ADVANCE";
export type PosExpenseFundingSource = "DRAWER" | "PERSONAL" | "PETTY_CASH";
export type PosExpenseStatus = "OPEN" | "SETTLED";
export type PosPettyCashFundingSource = "OWNER_PERSONAL" | "BUSINESS_ACCOUNT";
const POS_MONEY_MAX = 9_999_999_999.99; // NUMERIC(12,2)

export type PosExpense = {
  id: string;
  kind: PosExpenseKind;
  fundingSource: PosExpenseFundingSource;
  category: PosExpenseCategory;
  description: string;
  payee: string | null;
  status: PosExpenseStatus;
  advancedAmount: number;
  actualAmount: number | null;
  returnedAmount: number;
  extraCashOut: number;
  receiptRef: string | null;
  actorName: string | null;
  approvedByName: string | null;
  settledByName: string | null;
  settlementApprovedByName: string | null;
  pettyCashBalanceAfter: number | null;
  createdAt: string;
  settledAt: string | null;
};

function toISO(value: any): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapExpense(row: any): PosExpense {
  return {
    id: row.id,
    kind: row.kind,
    fundingSource: row.funding_source ?? "DRAWER",
    category: row.category,
    description: row.description,
    payee: row.payee ?? null,
    status: row.status,
    advancedAmount: Number(row.advanced_amount),
    actualAmount: row.actual_amount == null ? null : Number(row.actual_amount),
    returnedAmount: Number(row.returned_amount ?? 0),
    extraCashOut: Number(row.extra_cash_out ?? 0),
    receiptRef: row.receipt_ref ?? null,
    actorName: row.actor_name ?? null,
    approvedByName: row.approved_by_name ?? null,
    settledByName: row.settled_by_name ?? null,
    settlementApprovedByName: row.settlement_approved_by_name ?? null,
    pettyCashBalanceAfter: row.petty_cash_balance_after == null ? null : Number(row.petty_cash_balance_after),
    createdAt: toISO(row.created_at),
    settledAt: row.settled_at ? toISO(row.settled_at) : null,
  };
}

function requestHash(parts: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

async function lockIdempotencyKeyInTx(
  client: PoolClient,
  tenantId: string,
  scope: "fund" | "create" | "settle",
  key: string
): Promise<void> {
  // The unique keys below are tenant-wide, while wallet/shift row locks are only
  // branch/device-wide. Serialize the key itself first so the same retry sent to
  // two branches cannot race into a unique-constraint 500.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`pos-expense:${tenantId}:${scope}:${key}`]
  );
}

function money(value: unknown): number {
  return Math.round(Number(value) * 100) / 100;
}

function nullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function movementReason(prefix: string, description: string): string {
  return `${prefix}: ${description}`.slice(0, 200);
}

const EXPENSE_SELECT = `
  SELECT e.*,
         COALESCE(actor.name, actor.email) AS actor_name,
         COALESCE(approver.name, approver.email) AS approved_by_name,
         COALESCE(settler.name, settler.email) AS settled_by_name,
         COALESCE(settle_approver.name, settle_approver.email) AS settlement_approved_by_name,
         petty_ledger.balance_after AS petty_cash_balance_after
    FROM bms_pos_expenses e
    LEFT JOIN users actor ON actor.id = e.actor_user_id
    LEFT JOIN users approver ON approver.id = e.approved_by
    LEFT JOIN users settler ON settler.id = e.settled_by
    LEFT JOIN users settle_approver ON settle_approver.id = e.settlement_approved_by
    LEFT JOIN bms_pos_petty_cash_ledger petty_ledger ON petty_ledger.id = e.petty_cash_ledger_id`;

export type PosPettyCashLedgerEntry = {
  id: string;
  direction: "IN" | "OUT";
  source: "OWNER_PERSONAL" | "BUSINESS_ACCOUNT" | "EXPENSE";
  amount: number;
  balanceAfter: number;
  reason: string;
  evidenceRef: string;
  actorName: string | null;
  createdAt: string;
};

export type PosPettyCashWallet = {
  balance: number;
  entries: PosPettyCashLedgerEntry[];
};

export async function getPosPettyCashWallet(
  tenantId: string,
  locationId: string
): Promise<PosPettyCashWallet> {
  // ยอดกับประวัติต้องมาจาก snapshot เดียวกัน ไม่งั้นการเติมเงินที่คั่นระหว่าง
  // สอง query อาจทำให้หน้าเห็นยอดใหม่แต่ไม่มีรายการ (หรือกลับกัน)
  const result = await query<any>(
    `SELECT COALESCE(w.balance, 0) AS wallet_balance,
            recent.*, COALESCE(u.name, u.email) AS actor_name
       FROM (SELECT 1) seed
       LEFT JOIN bms_pos_petty_cash_wallets w
         ON w.tenant_id = $1 AND w.location_id = $2
       LEFT JOIN LATERAL (
         SELECT l.* FROM bms_pos_petty_cash_ledger l
          WHERE l.tenant_id = $1 AND l.location_id = $2
          ORDER BY l.created_at DESC
          LIMIT 20
       ) recent ON TRUE
       LEFT JOIN users u ON u.id = recent.actor_user_id
      ORDER BY recent.created_at DESC NULLS LAST`,
    [tenantId, locationId]
  );
  return {
    balance: Number(result.rows[0]?.wallet_balance ?? 0),
    entries: result.rows.filter((row) => row.id).map((row) => ({
      id: row.id,
      direction: row.direction,
      source: row.source,
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      reason: row.reason,
      evidenceRef: row.evidence_ref,
      actorName: row.actor_name ?? null,
      createdAt: toISO(row.created_at),
    })),
  };
}

export type FundPosPettyCashResult =
  | { status: "FUNDED"; balanceAfter: number; entry: PosPettyCashLedgerEntry; replayed: boolean }
  | { status: "INVALID"; reason: string }
  | { status: "LOCATION_NOT_FOUND" }
  | { status: "IDEMPOTENCY_CONFLICT" };

export async function fundPosPettyCash(input: {
  tenantId: string;
  locationId: string;
  source: PosPettyCashFundingSource;
  amount: number;
  reason: string;
  evidenceRef: string;
  actorUserId: string;
  idempotencyKey: string;
}): Promise<FundPosPettyCashResult> {
  const amount = money(input.amount);
  const reason = input.reason.trim();
  const evidenceRef = input.evidenceRef.trim();
  const key = input.idempotencyKey.trim();
  const ledgerKey = `fund:${key}`;
  if (input.source !== "OWNER_PERSONAL" && input.source !== "BUSINESS_ACCOUNT") {
    return { status: "INVALID", reason: "แหล่งเงินสดย่อยไม่ถูกต้อง" };
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > POS_MONEY_MAX) {
    return { status: "INVALID", reason: "จำนวนเงินไม่ถูกต้องหรือสูงเกินขอบเขตระบบ" };
  }
  if (!reason || reason.length > 200) return { status: "INVALID", reason: "เหตุผลต้องยาว 1–200 ตัวอักษร" };
  if (!evidenceRef || evidenceRef.length > 300) return { status: "INVALID", reason: "ต้องระบุหลักฐานไม่เกิน 300 ตัวอักษร" };
  if (!key || key.length > 180) return { status: "INVALID", reason: "idempotencyKey ไม่ถูกต้อง" };

  const fingerprint = requestHash({
    locationId: input.locationId, source: input.source, amount, reason, evidenceRef,
    actorUserId: input.actorUserId,
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await lockIdempotencyKeyInTx(client, input.tenantId, "fund", key);
    const replay = await client.query<any>(
      `SELECT l.*, COALESCE(u.name, u.email) AS actor_name
         FROM bms_pos_petty_cash_ledger l
         LEFT JOIN users u ON u.id = l.actor_user_id
        WHERE l.tenant_id = $1 AND l.idempotency_key = $2`,
      [input.tenantId, ledgerKey]
    );
    if (replay.rows[0]) {
      await client.query("ROLLBACK");
      if (replay.rows[0].request_hash !== fingerprint) return { status: "IDEMPOTENCY_CONFLICT" };
      const row = replay.rows[0];
      return {
        status: "FUNDED",
        balanceAfter: Number(row.balance_after),
        entry: {
          id: row.id, direction: row.direction, source: row.source, amount: Number(row.amount),
          balanceAfter: Number(row.balance_after), reason: row.reason, evidenceRef: row.evidence_ref,
          actorName: row.actor_name ?? null, createdAt: toISO(row.created_at),
        },
        replayed: true,
      };
    }
    const location = await client.query(
      `SELECT id FROM bms_locations WHERE tenant_id = $1 AND id = $2 AND active = TRUE`,
      [input.tenantId, input.locationId]
    );
    if (!location.rowCount) {
      await client.query("ROLLBACK");
      return { status: "LOCATION_NOT_FOUND" };
    }
    await client.query(
      `INSERT INTO bms_pos_petty_cash_wallets (tenant_id, location_id, balance)
       VALUES ($1,$2,0) ON CONFLICT (tenant_id, location_id) DO NOTHING`,
      [input.tenantId, input.locationId]
    );
    const wallet = await client.query<{ balance: string }>(
      `SELECT balance FROM bms_pos_petty_cash_wallets
        WHERE tenant_id = $1 AND location_id = $2 FOR UPDATE`,
      [input.tenantId, input.locationId]
    );
    const balanceAfter = money(Number(wallet.rows[0].balance) + amount);
    if (!Number.isFinite(balanceAfter) || balanceAfter > POS_MONEY_MAX) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "ยอดเงินสดย่อยรวมสูงเกินขอบเขตระบบ" };
    }
    const inserted = await client.query<any>(
      `INSERT INTO bms_pos_petty_cash_ledger
         (tenant_id, location_id, direction, source, amount, balance_after, reason,
          evidence_ref, actor_user_id, idempotency_key, request_hash)
       VALUES ($1,$2,'IN',$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [input.tenantId, input.locationId, input.source, amount, balanceAfter, reason,
        evidenceRef, input.actorUserId, ledgerKey, fingerprint]
    );
    await client.query(
      `UPDATE bms_pos_petty_cash_wallets SET balance = $3, updated_at = now()
        WHERE tenant_id = $1 AND location_id = $2`,
      [input.tenantId, input.locationId, balanceAfter]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'pos.petty_cash.fund',$3,$4)`,
      [input.tenantId, input.actorUserId, inserted.rows[0].id, JSON.stringify({
        locationId: input.locationId, source: input.source, amount, balanceAfter, evidenceRef,
      })]
    );
    await client.query("COMMIT");
    return {
      status: "FUNDED",
      balanceAfter,
      entry: {
        id: inserted.rows[0].id, direction: "IN", source: input.source, amount,
        balanceAfter, reason, evidenceRef, actorName: null, createdAt: toISO(inserted.rows[0].created_at),
      },
      replayed: false,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function listPosExpenses(
  tenantId: string,
  shiftId: string,
  deviceId: string
): Promise<PosExpense[]> {
  const res = await query(
    `${EXPENSE_SELECT}
      WHERE e.tenant_id = $1 AND e.shift_id = $2 AND e.device_id = $3
      ORDER BY e.created_at DESC`,
    [tenantId, shiftId, deviceId]
  );
  return res.rows.map(mapExpense);
}

async function insertDrawerMovementInTx(
  client: PoolClient,
  input: {
    tenantId: string;
    shiftId: string;
    deviceId: string;
    direction: "IN" | "OUT";
    amount: number;
    reason: string;
    actorUserId: string;
    approvedByUserId: string;
    idempotencyKey: string;
  }
): Promise<string> {
  const movement = await client.query<{ id: string }>(
    `INSERT INTO bms_pos_cash_movements
       (tenant_id, shift_id, device_id, direction, amount, reason,
        actor_user_id, approved_by, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [input.tenantId, input.shiftId, input.deviceId, input.direction, input.amount,
      input.reason, input.actorUserId, input.approvedByUserId, input.idempotencyKey]
  );
  const movementId = movement.rows[0].id;
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
     VALUES ($1, $2, 'pos.cash.movement', $3, $4)`,
    [input.tenantId, input.actorUserId, movementId, JSON.stringify({
      shiftId: input.shiftId,
      deviceId: input.deviceId,
      direction: input.direction,
      amount: input.amount,
      reason: input.reason,
      approvedBy: input.approvedByUserId,
      source: "pos_expense",
    })]
  );
  return movementId;
}

export type CreatePosExpenseResult =
  | { status: "RECORDED"; expense: PosExpense; drawerAfter: number | null; pettyCashAfter: number | null; replayed: boolean }
  | { status: "INVALID"; reason: string }
  | { status: "SHIFT_NOT_OPEN" }
  | { status: "WOULD_OVERDRAW"; available: number | null }
  | { status: "PETTY_CASH_INSUFFICIENT"; available: number }
  | { status: "IDEMPOTENCY_CONFLICT" };

export async function createPosExpense(input: {
  tenantId: string;
  shiftId: string;
  deviceId: string;
  locationId?: string | null;
  kind: PosExpenseKind;
  category: PosExpenseCategory;
  description: string;
  payee?: string | null;
  amount: number;
  receiptRef?: string | null;
  actorUserId: string;
  fundingSource?: PosExpenseFundingSource;
  approvedByUserId?: string | null;
  idempotencyKey: string;
}): Promise<CreatePosExpenseResult> {
  const amount = money(input.amount);
  const description = input.description.trim();
  const payee = nullableText(input.payee);
  const receiptRef = nullableText(input.receiptRef);
  const fundingSource = input.fundingSource ?? "DRAWER";
  const approvedByUserId = input.approvedByUserId ?? null;
  const key = input.idempotencyKey.trim();
  if (!Number.isFinite(amount) || amount <= 0 || amount > POS_MONEY_MAX) {
    return { status: "INVALID", reason: "จำนวนเงินไม่ถูกต้องหรือสูงเกินขอบเขตระบบ" };
  }
  if (input.kind !== "DIRECT" && input.kind !== "ADVANCE") return { status: "INVALID", reason: "รูปแบบค่าใช้จ่ายไม่ถูกต้อง" };
  if (fundingSource !== "DRAWER" && fundingSource !== "PERSONAL" && fundingSource !== "PETTY_CASH") {
    return { status: "INVALID", reason: "แหล่งเงินค่าใช้จ่ายไม่ถูกต้อง" };
  }
  if (!(POS_EXPENSE_CATEGORIES as readonly string[]).includes(input.category)) {
    return { status: "INVALID", reason: "หมวดค่าใช้จ่ายไม่ถูกต้อง" };
  }
  if (!description || description.length > 200) return { status: "INVALID", reason: "รายละเอียดต้องยาว 1–200 ตัวอักษร" };
  if (payee && payee.length > 160) return { status: "INVALID", reason: "ชื่อผู้รับเงินยาวเกินไป" };
  if (receiptRef && receiptRef.length > 300) return { status: "INVALID", reason: "เลขที่/หลักฐานยาวเกินไป" };
  if (!key || key.length > 180) return { status: "INVALID", reason: "idempotencyKey ไม่ถูกต้อง" };
  if (fundingSource === "PERSONAL" || fundingSource === "PETTY_CASH") {
    if (input.kind !== "DIRECT") return { status: "INVALID", reason: "รายการนอกลิ้นชักใช้ได้กับค่าใช้จ่ายที่จ่ายแล้วเท่านั้น" };
    if (!receiptRef) return { status: "INVALID", reason: "รายการนอกลิ้นชักต้องระบุเลขที่ใบเสร็จหรือหลักฐาน" };
    if (approvedByUserId) return { status: "INVALID", reason: "รายการนอกลิ้นชักไม่ต้องส่ง PIN ผู้อนุมัติ" };
    if (fundingSource === "PETTY_CASH" && !input.locationId) {
      return { status: "INVALID", reason: "เงินสดย่อยต้องระบุสาขา" };
    }
  } else {
    if (!approvedByUserId) return { status: "INVALID", reason: "เงินออกจากลิ้นชักต้องมีผู้อนุมัติ" };
    if (input.actorUserId === approvedByUserId) {
      return { status: "INVALID", reason: "ผู้อนุมัติต้องเป็นคนละคนกับผู้ทำรายการ" };
    }
  }

  const fingerprint = requestHash({
    shiftId: input.shiftId, deviceId: input.deviceId, locationId: input.locationId ?? null,
    kind: input.kind, fundingSource,
    category: input.category, description, payee, amount, receiptRef,
    actorUserId: input.actorUserId, approvedByUserId,
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await lockIdempotencyKeyInTx(client, input.tenantId, "create", key);
    const replay = await client.query<any>(
      `${EXPENSE_SELECT}
        WHERE e.tenant_id = $1 AND e.create_idempotency_key = $2`,
      [input.tenantId, key]
    );
    if (replay.rows[0]) {
      if (replay.rows[0].create_request_hash !== fingerprint) {
        await client.query("ROLLBACK");
        return { status: "IDEMPOTENCY_CONFLICT" };
      }
      const replayShift = await client.query<{ opening_float: string }>(
        `SELECT opening_float FROM bms_pos_shifts
          WHERE tenant_id = $1 AND id = $2 AND device_id = $3`,
        [input.tenantId, input.shiftId, input.deviceId]
      );
      if (!replayShift.rowCount) {
        await client.query("ROLLBACK");
        return { status: "SHIFT_NOT_OPEN" };
      }
      const replayDrawer = await drawerExpectedInTx(
        client, input.tenantId, input.shiftId, Number(replayShift.rows[0].opening_float)
      );
      const replayBlind = (await getVatSettings(input.tenantId)).blindClose;
      await client.query("ROLLBACK");
      return {
        status: "RECORDED", expense: mapExpense(replay.rows[0]),
        drawerAfter: replayBlind ? null : replayDrawer,
        pettyCashAfter: replay.rows[0].petty_cash_balance_after == null
          ? null : Number(replay.rows[0].petty_cash_balance_after), replayed: true,
      };
    }
    const shift = await client.query<{ opening_float: string; location_id: string }>(
      `SELECT opening_float, location_id FROM bms_pos_shifts
        WHERE tenant_id = $1 AND id = $2 AND device_id = $3 AND status = 'OPEN'
        FOR UPDATE`,
      [input.tenantId, input.shiftId, input.deviceId]
    );
    if (!shift.rowCount) {
      await client.query("ROLLBACK");
      return { status: "SHIFT_NOT_OPEN" };
    }
    if (fundingSource === "PETTY_CASH" && shift.rows[0].location_id !== input.locationId) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "เงินสดย่อยต้องเป็นของสาขาเดียวกับกะ" };
    }

    const drawer = await drawerExpectedInTx(
      client, input.tenantId, input.shiftId, Number(shift.rows[0].opening_float)
    );
    const blind = (await getVatSettings(input.tenantId)).blindClose;
    if (fundingSource === "DRAWER" && amount > drawer + 0.001) {
      await client.query("ROLLBACK");
      return { status: "WOULD_OVERDRAW", available: blind ? null : drawer };
    }

    const movementId = fundingSource === "DRAWER"
      ? await insertDrawerMovementInTx(client, {
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          deviceId: input.deviceId,
          direction: "OUT",
          amount,
          reason: movementReason(input.kind === "DIRECT" ? "ค่าใช้จ่าย" : "เบิกซื้อ", description),
          actorUserId: input.actorUserId,
          approvedByUserId: approvedByUserId!,
          idempotencyKey: `expense:create:${key}`,
        })
      : null;
    let pettyCashLedgerId: string | null = null;
    let pettyCashAfter: number | null = null;
    if (fundingSource === "PETTY_CASH") {
      await client.query(
        `INSERT INTO bms_pos_petty_cash_wallets (tenant_id, location_id, balance)
         VALUES ($1,$2,0) ON CONFLICT (tenant_id, location_id) DO NOTHING`,
        [input.tenantId, input.locationId]
      );
      const pettyWallet = await client.query<{ balance: string }>(
        `SELECT balance FROM bms_pos_petty_cash_wallets
          WHERE tenant_id = $1 AND location_id = $2 FOR UPDATE`,
        [input.tenantId, input.locationId]
      );
      const available = Number(pettyWallet.rows[0]?.balance ?? 0);
      if (amount > available + 0.001) {
        await client.query("ROLLBACK");
        return { status: "PETTY_CASH_INSUFFICIENT", available };
      }
      pettyCashAfter = money(available - amount);
      const pettyLedger = await client.query<{ id: string }>(
        `INSERT INTO bms_pos_petty_cash_ledger
           (tenant_id, location_id, shift_id, device_id, direction, source, amount,
            balance_after, reason, evidence_ref, actor_user_id, idempotency_key, request_hash)
         VALUES ($1,$2,$3,$4,'OUT','EXPENSE',$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [input.tenantId, input.locationId, input.shiftId, input.deviceId, amount,
          pettyCashAfter, description, receiptRef, input.actorUserId, `expense:${key}`, fingerprint]
      );
      pettyCashLedgerId = pettyLedger.rows[0].id;
      await client.query(
        `UPDATE bms_pos_petty_cash_wallets SET balance = $3, updated_at = now()
          WHERE tenant_id = $1 AND location_id = $2`,
        [input.tenantId, input.locationId, pettyCashAfter]
      );
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'pos.petty_cash.spend',$3,$4)`,
        [input.tenantId, input.actorUserId, pettyCashLedgerId, JSON.stringify({
          locationId: input.locationId, shiftId: input.shiftId, deviceId: input.deviceId,
          amount, balanceAfter: pettyCashAfter, evidenceRef: receiptRef,
        })]
      );
    }
    const direct = input.kind === "DIRECT";
    const inserted = await client.query<any>(
      `INSERT INTO bms_pos_expenses
         (tenant_id, shift_id, device_id, kind, funding_source, category, description, payee, status,
          advanced_amount, actual_amount, receipt_ref, create_cash_movement_id, petty_cash_ledger_id,
          actor_user_id, approved_by, settled_by, settlement_approved_by, settled_at,
          create_idempotency_key, create_request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               CASE WHEN $9 = 'SETTLED' THEN now() ELSE NULL END,$19,$20)
       RETURNING *`,
      [input.tenantId, input.shiftId, input.deviceId, input.kind, fundingSource, input.category,
        description, payee, direct ? "SETTLED" : "OPEN", amount, direct ? amount : null,
        receiptRef, movementId, pettyCashLedgerId, input.actorUserId, approvedByUserId,
        direct ? input.actorUserId : null, direct ? approvedByUserId : null,
        key, fingerprint]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'pos.expense.create', $3, $4)`,
      [input.tenantId, input.actorUserId, inserted.rows[0].id, JSON.stringify({
        shiftId: input.shiftId,
        deviceId: input.deviceId,
        kind: input.kind,
        fundingSource,
        category: input.category,
        amount,
        payee,
        approvedBy: approvedByUserId,
        cashMovementId: movementId,
        pettyCashLedgerId,
        control: fundingSource === "PERSONAL" ? "PERSONAL_FUNDS_NO_DRAWER_MOVEMENT"
          : fundingSource === "PETTY_CASH" ? "PETTY_CASH_WALLET_NO_DRAWER_MOVEMENT"
          : "DUAL_CONTROL_DRAWER_OUT",
      })]
    );
    await client.query("COMMIT");
    return {
      status: "RECORDED",
      expense: { ...mapExpense(inserted.rows[0]), pettyCashBalanceAfter: pettyCashAfter },
      drawerAfter: blind ? null : money(drawer - (fundingSource === "DRAWER" ? amount : 0)),
      pettyCashAfter,
      replayed: false,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export type SettlePosExpenseResult =
  | { status: "SETTLED"; expense: PosExpense; drawerAfter: number | null; replayed: boolean }
  | { status: "INVALID"; reason: string }
  | { status: "NOT_FOUND" }
  | { status: "ALREADY_SETTLED" }
  | { status: "SHIFT_NOT_OPEN" }
  | { status: "WOULD_OVERDRAW"; available: number | null }
  | { status: "IDEMPOTENCY_CONFLICT" };

export async function settlePosExpense(input: {
  tenantId: string;
  shiftId: string;
  deviceId: string;
  expenseId: string;
  actualAmount: number;
  receiptRef?: string | null;
  actorUserId: string;
  approvedByUserId: string;
  idempotencyKey: string;
}): Promise<SettlePosExpenseResult> {
  const actualAmount = money(input.actualAmount);
  const receiptRef = nullableText(input.receiptRef);
  const key = input.idempotencyKey.trim();
  if (!Number.isFinite(actualAmount) || actualAmount < 0 || actualAmount > POS_MONEY_MAX) {
    return { status: "INVALID", reason: "ยอดซื้อจริงไม่ถูกต้องหรือสูงเกินขอบเขตระบบ" };
  }
  if (receiptRef && receiptRef.length > 300) return { status: "INVALID", reason: "เลขที่/หลักฐานยาวเกินไป" };
  if (!key || key.length > 180) return { status: "INVALID", reason: "idempotencyKey ไม่ถูกต้อง" };
  if (input.actorUserId === input.approvedByUserId) {
    return { status: "INVALID", reason: "ผู้อนุมัติต้องเป็นคนละคนกับผู้ทำรายการ" };
  }

  const fingerprint = requestHash({
    shiftId: input.shiftId, deviceId: input.deviceId, expenseId: input.expenseId,
    actualAmount, receiptRef, actorUserId: input.actorUserId,
    approvedByUserId: input.approvedByUserId,
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await lockIdempotencyKeyInTx(client, input.tenantId, "settle", key);
    const replay = await client.query<any>(
      `${EXPENSE_SELECT}
        WHERE e.tenant_id = $1 AND e.settlement_idempotency_key = $2`,
      [input.tenantId, key]
    );
    if (replay.rows[0]) {
      if (replay.rows[0].settlement_request_hash !== fingerprint) {
        await client.query("ROLLBACK");
        return { status: "IDEMPOTENCY_CONFLICT" };
      }
      const replayShift = await client.query<{ opening_float: string }>(
        `SELECT opening_float FROM bms_pos_shifts
          WHERE tenant_id = $1 AND id = $2 AND device_id = $3`,
        [input.tenantId, input.shiftId, input.deviceId]
      );
      if (!replayShift.rowCount) {
        await client.query("ROLLBACK");
        return { status: "SHIFT_NOT_OPEN" };
      }
      const replayDrawer = await drawerExpectedInTx(
        client, input.tenantId, input.shiftId, Number(replayShift.rows[0].opening_float)
      );
      const replayBlind = (await getVatSettings(input.tenantId)).blindClose;
      await client.query("ROLLBACK");
      return {
        status: "SETTLED", expense: mapExpense(replay.rows[0]),
        drawerAfter: replayBlind ? null : replayDrawer, replayed: true,
      };
    }
    const shift = await client.query<{ opening_float: string }>(
      `SELECT opening_float FROM bms_pos_shifts
        WHERE tenant_id = $1 AND id = $2 AND device_id = $3 AND status = 'OPEN'
        FOR UPDATE`,
      [input.tenantId, input.shiftId, input.deviceId]
    );
    if (!shift.rowCount) {
      await client.query("ROLLBACK");
      return { status: "SHIFT_NOT_OPEN" };
    }

    const row = await client.query<any>(
      `${EXPENSE_SELECT}
        WHERE e.tenant_id = $1 AND e.id = $2 AND e.shift_id = $3 AND e.device_id = $4
        FOR UPDATE OF e`,
      [input.tenantId, input.expenseId, input.shiftId, input.deviceId]
    );
    if (!row.rows[0]) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
    }
    const current = row.rows[0];
    const drawer = await drawerExpectedInTx(
      client, input.tenantId, input.shiftId, Number(shift.rows[0].opening_float)
    );
    const blind = (await getVatSettings(input.tenantId)).blindClose;
    if (current.status !== "OPEN" || current.kind !== "ADVANCE") {
      await client.query("ROLLBACK");
      return { status: "ALREADY_SETTLED" };
    }

    const settlement = calculatePettyCashSettlement(Number(current.advanced_amount), actualAmount);
    const advancedAmount = settlement.advancedAmount;
    const delta = settlement.drawerDelta;
    if (delta > drawer + 0.001) {
      await client.query("ROLLBACK");
      return { status: "WOULD_OVERDRAW", available: blind ? null : drawer };
    }
    let movementId: string | null = null;
    if (Math.abs(delta) >= 0.01) {
      movementId = await insertDrawerMovementInTx(client, {
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        deviceId: input.deviceId,
        direction: delta > 0 ? "OUT" : "IN",
        amount: Math.abs(delta),
        reason: movementReason(delta > 0 ? "จ่ายเพิ่มจากยอดเบิก" : "คืนเงินทอนจากยอดเบิก", current.description),
        actorUserId: input.actorUserId,
        approvedByUserId: input.approvedByUserId,
        idempotencyKey: `expense:settle:${key}`,
      });
    }
    const updated = await client.query<any>(
      `UPDATE bms_pos_expenses
          SET status = 'SETTLED', actual_amount = $5,
              returned_amount = GREATEST(advanced_amount - $5, 0),
              extra_cash_out = GREATEST($5 - advanced_amount, 0),
              receipt_ref = COALESCE($6, receipt_ref), settlement_movement_id = $7,
              settled_by = $8, settlement_approved_by = $9, settled_at = now(),
              settlement_idempotency_key = $10, settlement_request_hash = $11
        WHERE tenant_id = $1 AND id = $2 AND shift_id = $3 AND device_id = $4
        RETURNING *`,
      [input.tenantId, input.expenseId, input.shiftId, input.deviceId, actualAmount,
        receiptRef, movementId, input.actorUserId, input.approvedByUserId, key, fingerprint]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'pos.expense.settle', $3, $4)`,
      [input.tenantId, input.actorUserId, input.expenseId, JSON.stringify({
        shiftId: input.shiftId,
        deviceId: input.deviceId,
        advancedAmount,
        actualAmount,
        returnedAmount: settlement.returnedAmount,
        extraCashOut: settlement.extraCashOut,
        approvedBy: input.approvedByUserId,
        settlementMovementId: movementId,
      })]
    );
    await client.query("COMMIT");
    return {
      status: "SETTLED",
      expense: mapExpense(updated.rows[0]),
      drawerAfter: blind ? null : money(drawer - delta),
      replayed: false,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
