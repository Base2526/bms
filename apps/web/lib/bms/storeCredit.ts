// =============================================================
// BMS — บัตรของขวัญ / เครดิตร้าน (8.9)
// -------------------------------------------------------------
// รูปแบบ ledger เหมือนแต้มสะสม (7.96): ยอดคงเหลือคือ SUM ของ ledger ส่วนคอลัมน์
// balance เป็น cache · คอลัมน์ที่ถูก UPDATE โดยไม่มี ledger จะเพี้ยนเงียบ ๆ ทันทีที่มี
// ทางเขียนที่ลืมอัปเดตมัน แล้วไม่มีใครรู้ว่าเพี้ยนตั้งแต่เมื่อไร
//
// ต่างจากแต้มข้อเดียวแต่สำคัญ: **เครดิตติดลบไม่ได้** แต้มยอมให้ติดลบโดยตั้งใจ
// (กันการคืนของหลังใช้แต้ม) แต่เครดิตคือเงิน ยอดติดลบคือร้านเป็นหนี้ลูกค้าโดยไม่มี
// ใครอนุมัติ · บังคับทั้งใน CHECK ของตารางและในโค้ดนี้
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type StoreCredit = {
  id: string;
  code: string;
  customerId: string | null;
  customerName: string | null;
  balance: number;
  status: "ACTIVE" | "VOID" | "EXPIRED";
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
};

const toISO = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ""));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * โค้ดบัตร — ต้องเดาไม่ได้
 *
 * บัตรของขวัญคือเงินที่ใครถือก็ใช้ได้ · โค้ดที่เรียงกัน (GC-0001, GC-0002) แปลว่า
 * คนที่ซื้อบัตรใบเดียวเดาโค้ดใบอื่นได้ทั้งหมด · ใช้ crypto.randomUUID เป็นแหล่งสุ่ม
 * แล้วตัดเป็นชุดตัวอักษร-เลขที่อ่านออกทางโทรศัพท์ได้ (ตัด I/O/0/1 ที่สับสนกับตาทิ้ง)
 */
export function generateCreditCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

export type IssueCreditResult =
  | { status: "ISSUED"; credit: StoreCredit }
  | { status: "INVALID"; reason: string };

/** ออกบัตรใหม่ / ออกเครดิตให้ลูกค้า — ยอดตั้งต้นลง ledger เป็น ISSUE */
export async function issueStoreCredit(input: {
  tenantId: string;
  amount: number;
  customerId?: string | null;
  code?: string | null;
  expiresAt?: string | null;
  note?: string | null;
  issuedBy: string;
}): Promise<IssueCreditResult> {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { status: "INVALID", reason: "จำนวนเงินต้องมากกว่า 0" };

  const code = (input.code ?? "").trim() || generateCreditCode();

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.issuedBy });
    const dup = await client.query(
      `SELECT 1 FROM bms_store_credits WHERE tenant_id = $1 AND code = $2`,
      [input.tenantId, code]
    );
    if (dup.rowCount) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "โค้ดนี้มีอยู่แล้วในร้าน" };
    }

    const ins = await client.query<{ id: string }>(
      `INSERT INTO bms_store_credits
         (tenant_id, code, customer_id, balance, expires_at, issued_by, note)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7)
       RETURNING id`,
      [input.tenantId, code, input.customerId ?? null, amount,
        input.expiresAt ?? null, input.issuedBy, input.note ?? null]
    );
    await client.query(
      `INSERT INTO bms_store_credit_ledger (tenant_id, credit_id, kind, amount, actor_user_id, note)
       VALUES ($1,$2,'ISSUE',$3,$4,$5)`,
      [input.tenantId, ins.rows[0].id, amount, input.issuedBy, input.note ?? null]
    );
    await client.query("COMMIT");

    const credit = await findStoreCredit(input.tenantId, code);
    return credit ? { status: "ISSUED", credit } : { status: "INVALID", reason: "ออกบัตรไม่สำเร็จ" };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function findStoreCredit(tenantId: string, code: string): Promise<StoreCredit | null> {
  const res = await query<any>(
    `SELECT c.*, cu.name AS customer_name
       FROM bms_store_credits c
       LEFT JOIN bms_customers cu ON cu.tenant_id = c.tenant_id AND cu.id = c.customer_id
      WHERE c.tenant_id = $1 AND c.code = $2`,
    [tenantId, code.trim()]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id, code: r.code, customerId: r.customer_id ?? null,
    customerName: r.customer_name ?? null,
    balance: Number(r.balance), status: r.status,
    expiresAt: r.expires_at ? toISO(r.expires_at) : null,
    note: r.note ?? null, createdAt: toISO(r.created_at),
  };
}

export type CreditUsable =
  | { ok: true; creditId: string; balance: number }
  | { ok: false; reason: string };

/**
 * ตรวจว่าบัตรใช้ได้ไหม พร้อมล็อกแถวไว้ — ต้องเรียกในทรานแซกชันของผู้เรียก
 *
 * FOR UPDATE สำคัญ: บัตรใบเดียวถูกยิงสองเครื่องพร้อมกันได้ (ลูกค้าคนเดียวกันสองคิว
 * หรือคนซื้อบัตรให้กันแล้วใช้พร้อมกัน) ถ้าไม่ล็อก ทั้งสองจะเห็นยอดเดิมแล้วหักเกินยอด
 */
export async function lockUsableCreditInTx(
  client: PoolClient, tenantId: string, code: string
): Promise<CreditUsable> {
  const res = await client.query<any>(
    `SELECT id, balance, status, expires_at FROM bms_store_credits
      WHERE tenant_id = $1 AND code = $2 FOR UPDATE`,
    [tenantId, code.trim()]
  );
  const r = res.rows[0];
  if (!r) return { ok: false, reason: "ไม่พบบัตรนี้" };
  if (r.status === "VOID") return { ok: false, reason: "บัตรนี้ถูกยกเลิกแล้ว" };
  if (r.status === "EXPIRED") return { ok: false, reason: "บัตรนี้หมดอายุแล้ว" };
  if (r.expires_at && new Date(r.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "บัตรนี้หมดอายุแล้ว" };
  }
  const balance = Number(r.balance);
  if (balance <= 0) return { ok: false, reason: "บัตรนี้ยอดหมดแล้ว" };
  return { ok: true, creditId: r.id, balance };
}

/**
 * หักเครดิตเป็นค่าสินค้า — เรียกในทรานแซกชันที่ปิดการขายเท่านั้น
 *
 * UNIQUE (tenant_id, credit_id, order_id, kind) กันการหักซ้ำจากบิลเดียวกันเมื่อ
 * เครื่องยิงซ้ำเพราะ response หาย · ON CONFLICT DO NOTHING แล้วเช็คว่าเขียนจริงไหม
 */
export async function redeemCreditInTx(
  client: PoolClient,
  tenantId: string,
  args: { creditId: string; orderId: string; amount: number; actorUserId?: string | null }
): Promise<{ applied: boolean; balanceAfter: number }> {
  const amount = round2(args.amount);
  const ins = await client.query(
    `INSERT INTO bms_store_credit_ledger
       (tenant_id, credit_id, kind, amount, order_id, actor_user_id)
     VALUES ($1,$2,'REDEEM',$3,$4,$5)
     ON CONFLICT (tenant_id, credit_id, order_id) WHERE kind = 'REDEEM' DO NOTHING`,
    [tenantId, args.creditId, -amount, args.orderId, args.actorUserId ?? null]
  );
  const applied = (ins.rowCount ?? 0) > 0;
  if (applied) {
    // CHECK (balance >= 0) เป็นแนวป้องกันสุดท้าย — หักเกินยอดจะล้มที่นี่ ไม่ใช่ผ่านไป
    await client.query(
      `UPDATE bms_store_credits SET balance = balance - $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, args.creditId, amount]
    );
  }
  const after = await client.query<{ balance: string }>(
    `SELECT balance FROM bms_store_credits WHERE tenant_id = $1 AND id = $2`,
    [tenantId, args.creditId]
  );
  return { applied, balanceAfter: Number(after.rows[0]?.balance ?? 0) };
}

/** คืนเครดิตกลับ (ยกเลิกบิลที่จ่ายด้วยเครดิต) — ในทรานแซกชันของผู้เรียก */
export async function reverseCreditForOrderInTx(
  client: PoolClient, tenantId: string, orderId: string, actorUserId?: string | null
): Promise<number> {
  const spent = await client.query<{ credit_id: string; amount: string }>(
    `SELECT credit_id, SUM(amount) AS amount FROM bms_store_credit_ledger
      WHERE tenant_id = $1 AND order_id = $2 AND kind = 'REDEEM'
      GROUP BY credit_id`,
    [tenantId, orderId]
  );
  let returned = 0;
  for (const row of spent.rows) {
    const amount = Math.abs(Number(row.amount));
    if (amount <= 0) continue;
    const ins = await client.query(
      `INSERT INTO bms_store_credit_ledger
         (tenant_id, credit_id, kind, amount, order_id, actor_user_id, note)
       VALUES ($1,$2,'REVERSE',$3,$4,$5,'ยกเลิกบิลที่จ่ายด้วยเครดิต')
       ON CONFLICT (tenant_id, credit_id, order_id) WHERE kind = 'REVERSE' AND pos_return_id IS NULL DO NOTHING`,
      [tenantId, row.credit_id, amount, orderId, actorUserId ?? null]
    );
    if ((ins.rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE bms_store_credits SET balance = balance + $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, row.credit_id, amount]
      );
      returned += amount;
    }
  }
  return round2(returned);
}

/** คืนของแล้วคืนเป็นเครดิต — ออกบัตรใหม่ให้ลูกค้าถือไป */
export async function refundToStoreCreditInTx(
  client: PoolClient,
  tenantId: string,
  args: { amount: number; customerId?: string | null; posReturnId?: string | null; actorUserId: string; code?: string | null }
): Promise<{ code: string; creditId: string }> {
  const amount = round2(args.amount);
  const code = (args.code ?? "").trim() || generateCreditCode();
  const ins = await client.query<{ id: string }>(
    `INSERT INTO bms_store_credits (tenant_id, code, customer_id, balance, issued_by, note)
     VALUES ($1,$2,$3,$4,$5,'คืนสินค้าเป็นเครดิตร้าน')
     RETURNING id`,
    [tenantId, code, args.customerId ?? null, amount, args.actorUserId]
  );
  await client.query(
    `INSERT INTO bms_store_credit_ledger
       (tenant_id, credit_id, kind, amount, pos_return_id, actor_user_id, note)
     VALUES ($1,$2,'REFUND',$3,$4,$5,'คืนสินค้าเป็นเครดิตร้าน')`,
    [tenantId, ins.rows[0].id, amount, args.posReturnId ?? null, args.actorUserId]
  );
  return { code, creditId: ins.rows[0].id };
}

export type StoreCreditOutstanding = {
  activeCards: number;
  outstandingAmount: number;
  /** ต้องเป็น 0 เสมอ — cache ไม่ตรงกับ ledger คือมีทางเขียนที่ลืมลง ledger */
  balanceMismatchCount: number;
};

/**
 * ยอดเครดิตค้าง = หนี้สินในงบดุล (deferred revenue) เหมือนแต้มค้าง
 * ส่งตัวเลขนี้ให้บัญชีก่อนปิดงบ · ไม่ใช่ตัวเลขประดับหน้าจอ
 */
export async function getStoreCreditOutstanding(tenantId: string): Promise<StoreCreditOutstanding> {
  const res = await query<any>(
    `SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE' AND balance > 0)::int AS active_cards,
            COALESCE(SUM(balance) FILTER (WHERE status = 'ACTIVE'), 0) AS outstanding,
            COUNT(*) FILTER (
              WHERE balance <> COALESCE((
                SELECT SUM(l.amount) FROM bms_store_credit_ledger l
                 WHERE l.tenant_id = c.tenant_id AND l.credit_id = c.id
              ), 0)
            )::int AS mismatch
       FROM bms_store_credits c
      WHERE c.tenant_id = $1`,
    [tenantId]
  );
  const r = res.rows[0] ?? {};
  return {
    activeCards: Number(r.active_cards ?? 0),
    outstandingAmount: Number(r.outstanding ?? 0),
    balanceMismatchCount: Number(r.mismatch ?? 0),
  };
}


/**
 * คืนเครดิตเข้าบัตรเดิมตามสัดส่วนที่คืนของ (8.9) — ในทรานแซกชันของผู้เรียก
 *
 * ใช้กับทางคืนสินค้าของ POS ซึ่งคืนบางส่วนได้หลายครั้งต่อบิล · จึงคีย์ด้วย
 * pos_return_id ไม่ใช่ order_id — คีย์ด้วยบิลจะยอมให้คืนได้ครั้งแรกเท่านั้น
 * แล้วครั้งที่สองเงียบหายไป (ลูกค้าเสียเงินบนบัตรโดยไม่มีสัญญาณ)
 *
 * ratio = ยอดคืนครั้งนี้ ÷ ยอดสุทธิของบิล · ผลรวมทุกครั้งไม่เกิน 1 เพราะทางคืนสินค้า
 * ปฏิเสธการคืนเกินยอดที่จ่ายมาอยู่แล้ว
 */
export async function reverseCreditForReturnInTx(
  client: PoolClient,
  tenantId: string,
  args: { orderId: string; posReturnId: string; ratio: number; actorUserId?: string | null }
): Promise<number> {
  const ratio = Math.min(1, Math.max(0, Number(args.ratio)));
  if (!(ratio > 0)) return 0;

  const spent = await client.query<{ credit_id: string; amount: string }>(
    `SELECT credit_id, SUM(amount) AS amount FROM bms_store_credit_ledger
      WHERE tenant_id = $1 AND order_id = $2 AND kind = 'REDEEM'
      GROUP BY credit_id`,
    [tenantId, args.orderId]
  );

  let returned = 0;
  for (const row of spent.rows) {
    const give = round2(Math.abs(Number(row.amount)) * ratio);
    if (give <= 0) continue;
    const ins = await client.query(
      `INSERT INTO bms_store_credit_ledger
         (tenant_id, credit_id, kind, amount, order_id, pos_return_id, actor_user_id, note)
       VALUES ($1,$2,'REVERSE',$3,$4,$5,$6,'คืนสินค้า — คืนเครดิตเข้าบัตรเดิม')
       ON CONFLICT (tenant_id, credit_id, pos_return_id) WHERE pos_return_id IS NOT NULL DO NOTHING`,
      [tenantId, row.credit_id, give, args.orderId, args.posReturnId, args.actorUserId ?? null]
    );
    if ((ins.rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE bms_store_credits SET balance = balance + $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, row.credit_id, give]
      );
      returned += give;
    }
  }
  return round2(returned);
}
