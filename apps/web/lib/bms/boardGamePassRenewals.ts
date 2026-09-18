import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { boardGamePassExpiry } from "./boardGamePassCoverage";
import { requireBoardGameCafeTenant } from "./boardGameCafe";
import { beginTenantTx } from "./tenant";

export type BoardGamePassRenewalStatus = "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELLED";

export type BoardGamePassRenewal = {
  id: string;
  customerId: string;
  customerName: string | null;
  sourcePassId: string;
  planId: string | null;
  planCode: string;
  planName: string;
  locationId: string | null;
  kind: "UNLIMITED" | "MINUTES";
  includedMinutes: number | null;
  price: number;
  durationDays: number;
  status: BoardGamePassRenewalStatus;
  renewAt: string;
  nextAttemptAt: string;
  failureCount: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  creditCodeTail: string;
};

const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value ?? "");
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function uuid(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`${label}ไม่ถูกต้อง`);
  }
  return normalized;
}

function requiredText(value: unknown, label: string, max: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new Error(`${label}ไม่ถูกต้อง`);
  return normalized;
}

function mapRenewal(row: any): BoardGamePassRenewal {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name ?? null,
    sourcePassId: row.source_pass_id,
    planId: row.plan_id ?? null,
    planCode: row.plan_code,
    planName: row.plan_name,
    locationId: row.location_id ?? null,
    kind: row.kind,
    includedMinutes: row.included_minutes == null ? null : Number(row.included_minutes),
    price: Number(row.price),
    durationDays: Number(row.duration_days),
    status: row.status,
    renewAt: iso(row.renew_at),
    nextAttemptAt: iso(row.next_attempt_at),
    failureCount: Number(row.failure_count),
    lastAttemptAt: row.last_attempt_at ? iso(row.last_attempt_at) : null,
    lastSuccessAt: row.last_success_at ? iso(row.last_success_at) : null,
    lastError: row.last_error ?? null,
    creditCodeTail: row.credit_code_tail ?? "",
  };
}

const RENEWAL_COLUMNS = `r.id, r.customer_id, r.source_pass_id, r.plan_id, r.plan_code,
  r.plan_name, r.location_id, r.kind, r.included_minutes, r.price, r.duration_days,
  r.status, r.renew_at, r.next_attempt_at, r.failure_count, r.last_attempt_at,
  r.last_success_at, r.last_error`;

export async function listBoardGamePassRenewals(
  tenantId: string,
  visibleLocationIds?: string[] | null,
): Promise<BoardGamePassRenewal[]> {
  const scope = Array.isArray(visibleLocationIds) ? visibleLocationIds.map((id) => uuid(id, "locationId")) : null;
  const result = await query(
    `SELECT ${RENEWAL_COLUMNS}, c.name AS customer_name,
            right(replace(sc.code, '-', ''), 4) AS credit_code_tail
       FROM bms_board_game_pass_renewals r
       JOIN bms_store_credits sc ON sc.tenant_id = r.tenant_id AND sc.id = r.store_credit_id
       LEFT JOIN bms_customers c ON c.tenant_id = r.tenant_id AND c.id = r.customer_id
      WHERE r.tenant_id = $1
        AND ($2::uuid[] IS NULL OR r.location_id IS NULL OR r.location_id = ANY($2::uuid[]))
      ORDER BY (r.status IN ('ACTIVE','PAST_DUE')) DESC, r.next_attempt_at, r.created_at DESC`,
    [tenantId, scope],
  );
  return result.rows.map(mapRenewal);
}

export async function locationOfBoardGamePassRenewal(tenantId: string, renewalIdInput: string) {
  const renewalId = uuid(renewalIdInput, "renewalId");
  const result = await query<{ location_id: string | null }>(
    `SELECT location_id FROM bms_board_game_pass_renewals WHERE tenant_id = $1 AND id = $2`,
    [tenantId, renewalId],
  );
  if (!result.rowCount) throw new Error("ไม่พบการต่ออายุนี้");
  return result.rows[0].location_id ?? null;
}

export async function createBoardGamePassRenewal(
  tenantId: string,
  input: { memberPassId: string; storeCreditCode: string },
  actorUserId: string,
): Promise<BoardGamePassRenewal> {
  const memberPassId = uuid(input.memberPassId, "memberPassId");
  const creditCode = requiredText(input.storeCreditCode, "รหัสเครดิตร้าน", 80);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    await requireBoardGameCafeTenant(client, tenantId);
    const pass = await client.query<any>(
      `SELECT p.id, p.location_id, p.customer_id, p.plan_id, p.plan_code, p.plan_name, p.kind,
              p.included_minutes, p.price_paid, p.starts_at, p.expires_at, p.status
         FROM bms_board_game_member_passes p
        WHERE p.tenant_id = $1 AND p.id = $2 FOR UPDATE`,
      [tenantId, memberPassId],
    );
    if (!pass.rowCount) throw new Error("ไม่พบแพ็กเกจสมาชิกนี้");
    const source = pass.rows[0];
    if (source.status !== "ACTIVE" || new Date(source.expires_at).getTime() <= Date.now()) {
      throw new Error("ตั้งต่ออายุได้เฉพาะแพ็กเกจที่ยังใช้งานอยู่");
    }
    const credit = await client.query<any>(
      `SELECT id, customer_id, status, expires_at
         FROM bms_store_credits WHERE tenant_id = $1 AND code = $2 FOR UPDATE`,
      [tenantId, creditCode],
    );
    if (!credit.rowCount) throw new Error("ไม่พบเครดิตร้านนี้");
    const funding = credit.rows[0];
    if (funding.customer_id !== source.customer_id) {
      throw new Error("ต่ออายุอัตโนมัติใช้ได้เฉพาะเครดิตร้านที่ผูกกับสมาชิกรายเดียวกัน");
    }
    if (funding.status !== "ACTIVE" || (funding.expires_at && new Date(funding.expires_at).getTime() <= Date.now())) {
      throw new Error("เครดิตร้านนี้ไม่อยู่ในสถานะที่ใช้ต่ออายุได้");
    }
    const durationDays = Math.max(1, Math.round(
      (new Date(source.expires_at).getTime() - new Date(source.starts_at).getTime()) / 86_400_000,
    ));
    const inserted = await client.query<any>(
      `INSERT INTO bms_board_game_pass_renewals
          (tenant_id, customer_id, source_pass_id, plan_id, store_credit_id, location_id,
           plan_code, plan_name, kind, included_minutes, price, duration_days,
           renew_at, next_attempt_at, consented_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14)
       RETURNING id`,
      [tenantId, source.customer_id, source.id, source.plan_id, funding.id, source.location_id,
        source.plan_code, source.plan_name, source.kind, source.included_minutes,
        Number(source.price_paid), durationDays, source.expires_at, actorUserId],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'board_game.pass_renewal_create',$3,$4::jsonb)`,
      [tenantId, actorUserId, inserted.rows[0].id, JSON.stringify({ memberPassId, customerId: source.customer_id,
        planCode: source.plan_code, price: Number(source.price_paid), renewAt: iso(source.expires_at) })],
    );
    await client.query("COMMIT");
    const rows = await listBoardGamePassRenewals(tenantId);
    const created = rows.find((row) => row.id === inserted.rows[0].id);
    if (!created) throw new Error("สร้างการต่ออายุไม่สำเร็จ");
    return created;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function updateBoardGamePassRenewal(
  tenantId: string,
  renewalIdInput: string,
  input: { action: "pause" | "resume" | "cancel"; reason?: string | null },
  actorUserId: string,
): Promise<void> {
  const renewalId = uuid(renewalIdInput, "renewalId");
  const reason = input.action === "cancel" ? requiredText(input.reason, "เหตุผลยกเลิก", 500) : null;
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    const renewal = await client.query<{ status: BoardGamePassRenewalStatus }>(
      `SELECT status FROM bms_board_game_pass_renewals WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, renewalId],
    );
    if (!renewal.rowCount) throw new Error("ไม่พบการต่ออายุนี้");
    if (renewal.rows[0].status === "CANCELLED") throw new Error("การต่ออายุนี้ยกเลิกแล้ว");
    const target = input.action === "pause" ? "PAUSED" : input.action === "resume" ? "ACTIVE" : "CANCELLED";
    await client.query(
      `UPDATE bms_board_game_pass_renewals
          SET status = $3, next_attempt_at = CASE WHEN $3 = 'ACTIVE' THEN now() ELSE next_attempt_at END,
              cancelled_at = CASE WHEN $3 = 'CANCELLED' THEN now() ELSE NULL END,
              cancelled_by = CASE WHEN $3 = 'CANCELLED' THEN $4::uuid ELSE NULL END,
              cancel_reason = CASE WHEN $3 = 'CANCELLED' THEN $5 ELSE NULL END,
              last_error = CASE WHEN $3 = 'ACTIVE' THEN NULL ELSE last_error END,
              version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, renewalId, target, actorUserId, reason],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [tenantId, actorUserId, `board_game.pass_renewal_${input.action}`, renewalId, JSON.stringify({ reason })],
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function recordRun(
  client: PoolClient,
  args: { tenantId: string; renewalId: string; scheduledFor: Date; attemptNo: number; status: string;
    amount: number; passId?: string | null; paymentId?: string | null; error?: string | null },
) {
  await client.query(
    `INSERT INTO bms_board_game_pass_renewal_runs
        (tenant_id, renewal_id, scheduled_for, attempt_no, status, amount,
         member_pass_id, payment_id, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [args.tenantId, args.renewalId, args.scheduledFor, args.attemptNo, args.status,
      args.amount, args.passId ?? null, args.paymentId ?? null, args.error ?? null],
  );
}

async function processRenewal(tenantId: string, renewalId: string, now: Date): Promise<"SUCCEEDED" | "INSUFFICIENT_CREDIT" | "SKIPPED"> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query<any>(
      `SELECT r.*, sc.balance, sc.status AS credit_status, sc.expires_at AS credit_expires_at,
              sc.customer_id AS credit_customer_id
         FROM bms_board_game_pass_renewals r
         JOIN bms_store_credits sc ON sc.tenant_id = r.tenant_id AND sc.id = r.store_credit_id
        WHERE r.tenant_id = $1 AND r.id = $2
        FOR UPDATE OF r, sc`,
      [tenantId, renewalId],
    );
    if (!result.rowCount) {
      await client.query("COMMIT");
      return "SKIPPED";
    }
    const row = result.rows[0];
    if (!["ACTIVE", "PAST_DUE"].includes(row.status) || new Date(row.next_attempt_at) > now) {
      await client.query("COMMIT");
      return "SKIPPED";
    }
    const scheduledFor = new Date(row.renew_at);
    const attemptNo = Number(row.failure_count) + 1;
    const price = money(Number(row.price));
    const creditUsable = row.credit_status === "ACTIVE"
      && (!row.credit_expires_at || new Date(row.credit_expires_at) > now)
      && row.credit_customer_id === row.customer_id
      && Number(row.balance) >= price;
    if (!creditUsable) {
      const error = "เครดิตร้านไม่พร้อมใช้หรือยอดคงเหลือไม่พอ";
      await recordRun(client, { tenantId, renewalId, scheduledFor, attemptNo,
        status: "INSUFFICIENT_CREDIT", amount: price, error });
      await client.query(
        `UPDATE bms_board_game_pass_renewals
            SET status='PAST_DUE', failure_count=failure_count+1, last_attempt_at=$3,
                next_attempt_at=$3::timestamptz + INTERVAL '1 day', last_error=$4,
                version=version+1, updated_at=$3
          WHERE tenant_id=$1 AND id=$2`,
        [tenantId, renewalId, now, error],
      );
      await client.query("COMMIT");
      return "INSUFFICIENT_CREDIT";
    }

    const startsAt = scheduledFor;
    const expiresAt = boardGamePassExpiry(startsAt, Number(row.duration_days));
    const issueKey = createHash("sha256").update(`renewal:${renewalId}:${scheduledFor.toISOString()}`).digest("hex");
    const issueHash = createHash("sha256").update(JSON.stringify({ renewalId, scheduledFor: scheduledFor.toISOString() })).digest("hex");
    const pass = await client.query<{ id: string }>(
      `INSERT INTO bms_board_game_member_passes
          (tenant_id, location_id, customer_id, plan_id, plan_code, plan_name, kind,
           included_minutes, price_paid, remaining_minutes, starts_at, expires_at,
           issue_idempotency_key, issue_request_hash, issued_by, note, renewal_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$11,$12,$13,NULL,$14,$15)
       RETURNING id`,
      [tenantId, row.location_id, row.customer_id, row.plan_id, row.plan_code, row.plan_name,
        row.kind, row.included_minutes, price, startsAt, expiresAt, issueKey, issueHash,
        "ต่ออายุอัตโนมัติด้วยเครดิตร้าน", renewalId],
    );
    const passId = pass.rows[0].id;
    await client.query(
      `INSERT INTO bms_board_game_pass_ledger (tenant_id, pass_id, kind, minutes, note)
       VALUES ($1,$2,'ISSUE',$3,'ต่ออายุอัตโนมัติ')`,
      [tenantId, passId, row.included_minutes ?? 0],
    );
    await client.query(
      `INSERT INTO bms_store_credit_ledger
          (tenant_id, credit_id, kind, amount, board_game_member_pass_id, note)
       VALUES ($1,$2,'REDEEM',$3,$4,'ต่ออายุแพ็กเกจสมาชิกบอร์ดเกม')`,
      [tenantId, row.store_credit_id, -price, passId],
    );
    await client.query(
      `UPDATE bms_store_credits SET balance=balance-$3, updated_at=$4
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, row.store_credit_id, price, now],
    );
    const payment = await client.query<{ id: string }>(
      `INSERT INTO bms_payments
          (tenant_id, payable_type, board_game_member_pass_id, method, amount, status,
           note, verified_by, confirmed_at, updated_at)
       VALUES ($1,'BOARD_GAME_MEMBER_PASS',$2,'STORE_CREDIT',$3,'CONFIRMED',
               'ต่ออายุแพ็กเกจสมาชิกอัตโนมัติ','system:cron',$4,$4)
       RETURNING id`,
      [tenantId, passId, price, now],
    );
    await recordRun(client, { tenantId, renewalId, scheduledFor, attemptNo,
      status: "SUCCEEDED", amount: price, passId, paymentId: payment.rows[0].id });
    await client.query(
      `UPDATE bms_board_game_pass_renewals
          SET status='ACTIVE', source_pass_id=$3, renew_at=$4, next_attempt_at=$4,
              failure_count=0, last_attempt_at=$5, last_success_at=$5, last_error=NULL,
              version=version+1, updated_at=$5
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, renewalId, passId, expiresAt, now],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,'system:cron','board_game.pass_renewal_succeeded',$2,$3::jsonb)`,
      [tenantId, renewalId, JSON.stringify({ memberPassId: passId, amount: price,
        scheduledFor: scheduledFor.toISOString(), nextRenewAt: expiresAt.toISOString() })],
    );
    await client.query("COMMIT");
    return "SUCCEEDED";
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function recordRenewalFailure(tenantId: string, renewalId: string, now: Date, error: string) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const renewal = await client.query<any>(
      `SELECT id, renew_at, failure_count, price, status, next_attempt_at
         FROM bms_board_game_pass_renewals
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, renewalId],
    );
    const row = renewal.rows[0];
    if (!row || !["ACTIVE", "PAST_DUE"].includes(row.status) || new Date(row.next_attempt_at) > now) {
      await client.query("COMMIT");
      return;
    }
    const message = error.slice(0, 500);
    await recordRun(client, { tenantId, renewalId, scheduledFor: new Date(row.renew_at),
      attemptNo: Number(row.failure_count) + 1, status: "FAILED", amount: Number(row.price), error: message });
    await client.query(
      `UPDATE bms_board_game_pass_renewals
          SET status='PAST_DUE', failure_count=failure_count+1, last_attempt_at=$3,
              next_attempt_at=$3::timestamptz + INTERVAL '1 day', last_error=$4,
              version=version+1, updated_at=$3
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, renewalId, now, message],
    );
    await client.query("COMMIT");
  } catch (recordError) {
    try { await client.query("ROLLBACK"); } catch {}
    throw recordError;
  } finally {
    client.release();
  }
}

export async function runDueBoardGamePassRenewals(input: {
  tenantId?: string | null; renewalId?: string | null; now?: Date; limit?: number;
} = {}) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 100)));
  const tenantId = input.tenantId ? uuid(input.tenantId, "tenantId") : null;
  const renewalId = input.renewalId ? uuid(input.renewalId, "renewalId") : null;
  const due = await query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id, id FROM bms_board_game_pass_renewals
      WHERE status IN ('ACTIVE','PAST_DUE') AND next_attempt_at <= $1
        AND ($2::uuid IS NULL OR tenant_id = $2)
        AND ($3::uuid IS NULL OR id = $3)
      ORDER BY next_attempt_at, id LIMIT $4`,
    [now, tenantId, renewalId, limit],
  );
  let succeeded = 0;
  let insufficientCredit = 0;
  let skipped = 0;
  const failed: Array<{ tenantId: string; renewalId: string; error: string }> = [];
  for (const row of due.rows) {
    try {
      const status = await processRenewal(row.tenant_id, row.id, now);
      if (status === "SUCCEEDED") succeeded += 1;
      else if (status === "INSUFFICIENT_CREDIT") insufficientCredit += 1;
      else skipped += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await recordRenewalFailure(row.tenant_id, row.id, now, message);
      } catch (recordError) {
        failed.push({ tenantId: row.tenant_id, renewalId: row.id,
          error: `${message}; บันทึกความล้มเหลวไม่สำเร็จ: ${recordError instanceof Error ? recordError.message : String(recordError)}` });
        continue;
      }
      failed.push({ tenantId: row.tenant_id, renewalId: row.id, error: message });
    }
  }
  return { scanned: due.rowCount ?? 0, succeeded, insufficientCredit, skipped, failed };
}
