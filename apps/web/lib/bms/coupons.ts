// =============================================================
// BMS Coupons — โค้ดส่วนลด
// -------------------------------------------------------------
// CRUD ปกติใช้ query() ธรรมดา · การ "ใช้" โค้ดตอนสร้างออร์เดอร์ต้องรันในทรานแซกชัน
// เดียวกับ createOrder() (lib/bms/orders.ts) เพื่อ lock แถว coupon (FOR UPDATE)
// กัน race condition ตอนมีคนใช้โค้ดพร้อมกันเกิน max_redemptions — ดู
// applyCouponInTx() ที่รับ PoolClient ของทรานแซกชันเดิมเข้ามาตรงๆ
// =============================================================

import type { PoolClient } from "pg";
import { query } from "@/lib/db";

export type CouponType = "PERCENT" | "FIXED";

export type Coupon = {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  minOrderAmount: number | null;
  maxRedemptions: number | null;
  redemptionsCount: number;
  perCustomerLimit: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

const ROW_COLUMNS = `id, code, type, value, min_order_amount, max_redemptions, redemptions_count,
  per_customer_limit, starts_at, expires_at, active, note, created_at, updated_at`;

function mapRow(r: any): Coupon {
  return {
    id: r.id,
    code: r.code,
    type: r.type,
    value: Number(r.value),
    minOrderAmount: r.min_order_amount == null ? null : Number(r.min_order_amount),
    maxRedemptions: r.max_redemptions ?? null,
    redemptionsCount: r.redemptions_count,
    perCustomerLimit: r.per_customer_limit ?? null,
    startsAt: r.starts_at ? new Date(r.starts_at).toISOString() : null,
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    active: r.active,
    note: r.note ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listCoupons(tenantId: string): Promise<Coupon[]> {
  const res = await query(
    `SELECT ${ROW_COLUMNS} FROM bms_coupons WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  return res.rows.map(mapRow);
}

export type CouponRedemption = {
  orderId: string;
  customerName: string | null;
  channel: string;
  status: string;
  discountAmount: number;
  totalAmount: number;
  createdAt: string;
};

/**
 * ประวัติการใช้โค้ด — ไม่มีตาราง redemption log แยก (ตามที่ตัดสินใจไว้ตอนออกแบบ
 * bms_coupons) query ตรงจาก bms_orders.coupon_code แทน เพราะข้อมูลที่ต้องการ
 * (ใครใช้/เมื่อไหร่/ส่วนลดเท่าไหร่) ครบอยู่แล้วในนั้น
 */
export async function listCouponRedemptions(tenantId: string, couponId: string): Promise<CouponRedemption[]> {
  const coupon = await query<{ code: string }>(
    `SELECT code FROM bms_coupons WHERE tenant_id = $1 AND id = $2`,
    [tenantId, couponId]
  );
  if (coupon.rowCount === 0) return [];

  const res = await query(
    `SELECT o.id AS order_id, o.channel, o.status, o.total_amount, o.discount_amount, o.created_at,
            COALESCE(NULLIF(cu.name, o.customer_ref), ci.display_name, o.customer_ref) AS customer_name
       FROM bms_orders o
       LEFT JOIN bms_customers cu ON cu.id = o.customer_id
       LEFT JOIN bms_customer_identities ci
         ON ci.tenant_id = o.tenant_id AND ci.channel = o.channel AND ci.external_ref = o.customer_ref
      WHERE o.tenant_id = $1 AND o.coupon_code = $2
      ORDER BY o.created_at DESC`,
    [tenantId, coupon.rows[0].code]
  );
  return res.rows.map((r: any) => ({
    orderId: r.order_id,
    customerName: r.customer_name ?? null,
    channel: r.channel,
    status: r.status,
    discountAmount: Number(r.discount_amount),
    totalAmount: Number(r.total_amount),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export type UpsertCouponInput = {
  id?: string | null;
  code: string;
  type: CouponType;
  value: number;
  minOrderAmount?: number | null;
  maxRedemptions?: number | null;
  perCustomerLimit?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  active?: boolean;
  note?: string | null;
};

/** normalize + validate ก่อนเขียน DB เสมอ ไม่เชื่อค่าที่ client ส่งมาตรงๆ */
function normalizeInput(input: UpsertCouponInput) {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("ระบุโค้ดส่วนลด");
  if (!Number.isFinite(input.value) || input.value <= 0) throw new Error("มูลค่าส่วนลดต้องมากกว่า 0");
  if (input.type === "PERCENT" && input.value > 100) throw new Error("ส่วนลดแบบ % ต้องไม่เกิน 100");
  if (input.minOrderAmount != null && input.minOrderAmount < 0) throw new Error("ยอดขั้นต่ำต้องไม่ติดลบ");
  if (input.maxRedemptions != null && input.maxRedemptions < 1) throw new Error("จำนวนครั้งที่ใช้ได้ต้องมากกว่า 0");
  if (input.perCustomerLimit != null && input.perCustomerLimit < 1) throw new Error("จำนวนครั้ง/ลูกค้าต้องมากกว่า 0");
  if (input.startsAt && input.expiresAt && new Date(input.startsAt) > new Date(input.expiresAt)) {
    throw new Error("วันเริ่มต้องมาก่อนวันหมดอายุ");
  }
  return { ...input, code };
}

export async function upsertCoupon(tenantId: string, input: UpsertCouponInput): Promise<Coupon> {
  const v = normalizeInput(input);
  try {
    if (v.id) {
      const res = await query(
        `UPDATE bms_coupons SET
           code = $3, type = $4, value = $5, min_order_amount = $6, max_redemptions = $7,
           per_customer_limit = $8, starts_at = $9, expires_at = $10, active = $11, note = $12,
           updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${ROW_COLUMNS}`,
        [
          tenantId, v.id, v.code, v.type, v.value, v.minOrderAmount ?? null, v.maxRedemptions ?? null,
          v.perCustomerLimit ?? null, v.startsAt ?? null, v.expiresAt ?? null, v.active ?? true, v.note ?? null,
        ]
      );
      if (res.rowCount === 0) throw new Error("ไม่พบโค้ดส่วนลดนี้");
      return mapRow(res.rows[0]);
    }
    const res = await query(
      `INSERT INTO bms_coupons (
         tenant_id, code, type, value, min_order_amount, max_redemptions,
         per_customer_limit, starts_at, expires_at, active, note
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${ROW_COLUMNS}`,
      [
        tenantId, v.code, v.type, v.value, v.minOrderAmount ?? null, v.maxRedemptions ?? null,
        v.perCustomerLimit ?? null, v.startsAt ?? null, v.expiresAt ?? null, v.active ?? true, v.note ?? null,
      ]
    );
    return mapRow(res.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") throw new Error(`โค้ด "${v.code}" มีอยู่แล้ว`);
    throw err;
  }
}

export async function deleteCoupon(tenantId: string, id: string): Promise<boolean> {
  const res = await query(`DELETE FROM bms_coupons WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return (res.rowCount ?? 0) > 0;
}

export type CouponApplyResult =
  | { ok: true; couponId: string; code: string; discount: number }
  | { ok: false; reason: string };

/**
 * ตรวจ + "ใช้" โค้ด (เพิ่ม redemptions_count) แบบ atomic ภายในทรานแซกชันของ
 * createOrder() เดิม — ต้องรันก่อน COMMIT ของออร์เดอร์ ถ้า reason ถูกคืนมา
 * ต้อง ROLLBACK ทั้งออร์เดอร์ (เหมือน INSUFFICIENT ของสต็อก ไม่ใช่ error เงียบ)
 */
export async function applyCouponInTx(
  client: PoolClient,
  tenantId: string,
  rawCode: string,
  customerId: string | null,
  subtotal: number
): Promise<CouponApplyResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, reason: "โค้ดส่วนลดไม่ถูกต้อง" };

  const res = await client.query(
    `SELECT ${ROW_COLUMNS} FROM bms_coupons WHERE tenant_id = $1 AND code = $2 FOR UPDATE`,
    [tenantId, code]
  );
  if (res.rowCount === 0) return { ok: false, reason: "ไม่พบโค้ดส่วนลดนี้" };
  const c = mapRow(res.rows[0]);

  const now = Date.now();
  if (!c.active) return { ok: false, reason: "โค้ดนี้ถูกปิดใช้งานแล้ว" };
  if (c.startsAt && now < new Date(c.startsAt).getTime()) return { ok: false, reason: "โค้ดนี้ยังไม่เริ่มใช้ได้" };
  if (c.expiresAt && now > new Date(c.expiresAt).getTime()) return { ok: false, reason: "โค้ดนี้หมดอายุแล้ว" };
  if (c.minOrderAmount != null && subtotal < c.minOrderAmount) {
    return { ok: false, reason: `ยอดสั่งซื้อต้องถึง ${c.minOrderAmount.toLocaleString()} บาทขึ้นไป` };
  }
  if (c.maxRedemptions != null && c.redemptionsCount >= c.maxRedemptions) {
    return { ok: false, reason: "โค้ดนี้ถูกใช้ครบจำนวนแล้ว" };
  }
  if (c.perCustomerLimit != null && customerId) {
    const used = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM bms_orders
        WHERE tenant_id = $1 AND coupon_code = $2 AND customer_id = $3 AND status <> 'CANCELLED'`,
      [tenantId, code, customerId]
    );
    if (Number(used.rows[0]?.n ?? 0) >= c.perCustomerLimit) {
      return { ok: false, reason: "คุณใช้โค้ดนี้ครบจำนวนที่กำหนดแล้ว" };
    }
  }

  const discount = c.type === "PERCENT"
    ? Math.round(subtotal * (c.value / 100) * 100) / 100
    : Math.min(c.value, subtotal);

  await client.query(
    `UPDATE bms_coupons SET redemptions_count = redemptions_count + 1, updated_at = now() WHERE id = $1`,
    [c.id]
  );

  return { ok: true, couponId: c.id, code: c.code, discount };
}
