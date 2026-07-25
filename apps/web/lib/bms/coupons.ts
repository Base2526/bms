// =============================================================
// BMS Coupons — โค้ดส่วนลด
// -------------------------------------------------------------
// read/list ใช้ query() ธรรมดา · การแก้ค่า (upsertCoupon UPDATE path) รันใน
// beginTenantTx() พร้อม editorId เพื่อให้ revision trigger (7.22) เก็บ snapshot
// before/after ได้ + รู้ว่าใครแก้ (ไม่งั้น editor = system) · การ "ใช้" โค้ดตอน
// สร้างออร์เดอร์ต้องรันในทรานแซกชันเดียวกับ createOrder() (lib/bms/orders.ts)
// เพื่อ lock แถว coupon (FOR UPDATE) กัน race condition ตอนมีคนใช้โค้ดพร้อมกัน
// เกิน max_redemptions — ดู applyCouponInTx() ที่รับ PoolClient ของทรานแซกชันเดิม
// =============================================================

import { createHmac, timingSafeEqual } from "crypto";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

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

const COUPON_ROW_COLUMNS = `c.id, c.code, c.type, c.value, c.min_order_amount, c.max_redemptions, c.redemptions_count,
  c.per_customer_limit, c.starts_at, c.expires_at, c.active, c.note, c.created_at, c.updated_at`;

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

export type CustomerCoupon = Coupon & {
  remainingRedemptions: number | null;
  customerUsedCount: number;
  available: boolean;
  reason: string | null;
  subtotalOk: boolean | null;
  discountPreview: number | null;
  assigned: boolean;
  assignedAt: string | null;
  source: string | null;
  walletId: string | null;
  state: "ASSIGNED" | "CLAIMED" | "RESERVED" | "REDEEMED" | "REVOKED" | "EXPIRED";
  claimedAt: string | null;
  reservedAt: string | null;
  reservedOrderId: string | null;
  redeemedAt: string | null;
  redeemedOrderId: string | null;
  expiredAt: string | null;
  revokedAt: string | null;
};

export type CustomerCouponLookup = {
  requestedCode: string | null;
  requested: CustomerCoupon | null;
  alternatives: CustomerCoupon[];
};

export type CustomerCouponWalletItem = CustomerCoupon;

async function findCustomerIdByIdentity(
  tenantId: string,
  channel?: string | null,
  customerRef?: string | null
): Promise<string | null> {
  if (!channel || !customerRef) return null;
  const res = await query<{ customer_id: string }>(
    `SELECT customer_id
       FROM bms_customer_identities
      WHERE tenant_id = $1 AND channel = $2 AND external_ref = $3
      LIMIT 1`,
    [tenantId, channel, customerRef]
  );
  return res.rows[0]?.customer_id ?? null;
}

function discountFor(c: Coupon, subtotal: number | null | undefined): number | null {
  if (subtotal == null || !Number.isFinite(subtotal) || subtotal < 0) return null;
  return c.type === "PERCENT"
    ? Math.round(subtotal * (c.value / 100) * 100) / 100
    : Math.min(c.value, subtotal);
}

function baseEligibility(
  c: Coupon,
  customerUsedCount: number,
  subtotal?: number | null,
  wallet?: {
    assignedAt?: string | null;
    source?: string | null;
    walletId?: string | null;
    state?: CustomerCoupon["state"];
    claimedAt?: string | null;
    reservedAt?: string | null;
    reservedOrderId?: string | null;
    redeemedAt?: string | null;
    redeemedOrderId?: string | null;
    expiredAt?: string | null;
    revokedAt?: string | null;
  } | null
): Omit<CustomerCoupon, keyof Coupon> {
  const now = Date.now();
  const remainingRedemptions = c.maxRedemptions == null
    ? null
    : Math.max(0, c.maxRedemptions - c.redemptionsCount);
  const subtotalOk = subtotal == null || !Number.isFinite(subtotal)
    ? null
    : c.minOrderAmount == null || subtotal >= c.minOrderAmount;

  let reason: string | null = null;
  if (wallet?.state === "REVOKED") reason = "สิทธิ์คูปองนี้ถูกยกเลิกแล้ว";
  else if (wallet?.state === "EXPIRED") reason = "คูปองนี้หมดอายุแล้ว";
  else if (!c.active) reason = "โค้ดนี้ถูกปิดใช้งานแล้ว";
  else if (c.startsAt && now < new Date(c.startsAt).getTime()) reason = "โค้ดนี้ยังไม่เริ่มใช้ได้";
  else if (c.expiresAt && now > new Date(c.expiresAt).getTime()) reason = "โค้ดนี้หมดอายุแล้ว";
  else if (c.maxRedemptions != null && c.redemptionsCount >= c.maxRedemptions) reason = "โค้ดนี้ถูกใช้ครบจำนวนแล้ว";
  else if (c.perCustomerLimit != null && customerUsedCount >= c.perCustomerLimit) reason = "ลูกค้าใช้โค้ดนี้ครบจำนวนที่กำหนดแล้ว";
  else if (subtotalOk === false) reason = `ยอดสั่งซื้อต้องถึง ${c.minOrderAmount?.toLocaleString()} บาทขึ้นไป`;

  return {
    remainingRedemptions,
    customerUsedCount,
    available: !reason,
    reason,
    subtotalOk,
    discountPreview: discountFor(c, subtotal),
    assigned: Boolean(wallet),
    assignedAt: wallet?.assignedAt ?? null,
    source: wallet?.source ?? null,
    walletId: wallet?.walletId ?? null,
    state: wallet?.state ?? "ASSIGNED",
    claimedAt: wallet?.claimedAt ?? null,
    reservedAt: wallet?.reservedAt ?? null,
    reservedOrderId: wallet?.reservedOrderId ?? null,
    redeemedAt: wallet?.redeemedAt ?? null,
    redeemedOrderId: wallet?.redeemedOrderId ?? null,
    expiredAt: wallet?.expiredAt ?? null,
    revokedAt: wallet?.revokedAt ?? null,
  };
}

async function customerCouponUseCounts(tenantId: string, customerId: string | null, couponIds: string[], codes: string[]) {
  const counts = new Map<string, number>();
  if (!customerId || couponIds.length === 0) return counts;
  const res = await query<{ coupon_id: string; n: number }>(
    `SELECT COALESCE(o.coupon_id, legacy.id) AS coupon_id, COUNT(*)::int AS n
       FROM bms_orders o
       LEFT JOIN bms_coupons legacy
         ON o.coupon_id IS NULL
        AND legacy.tenant_id = o.tenant_id
        AND legacy.code = o.coupon_code
      WHERE o.tenant_id = $1
        AND o.customer_id = $2
        AND o.status <> 'CANCELLED'
        AND (
          o.coupon_id = ANY($3::uuid[])
          OR (o.coupon_id IS NULL AND o.coupon_code = ANY($4::text[]))
        )
      GROUP BY COALESCE(o.coupon_id, legacy.id)`,
    [tenantId, customerId, couponIds, codes]
  );
  for (const row of res.rows) {
    if (row.coupon_id) counts.set(row.coupon_id, Number(row.n));
  }
  return counts;
}

type WalletRow = {
  wallet_id: string;
  coupon_id: string;
  source: string | null;
  assigned_at: Date | string;
  state: CustomerCoupon["state"];
  claimed_at: Date | string | null;
  reserved_at: Date | string | null;
  reserved_order_id: string | null;
  redeemed_at: Date | string | null;
  redeemed_order_id: string | null;
  expired_at: Date | string | null;
  revoked_at: Date | string | null;
  code: string;
  type: CouponType;
  value: string | number;
  min_order_amount: string | number | null;
  max_redemptions: number | null;
  redemptions_count: number;
  per_customer_limit: number | null;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
  active: boolean;
  note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

async function listWalletRows(tenantId: string, customerId: string): Promise<WalletRow[]> {
  const res = await query<WalletRow>(
    `SELECT w.id AS wallet_id, w.coupon_id, w.source, w.assigned_at,
            w.state, w.claimed_at, w.reserved_at, w.reserved_order_id, w.redeemed_at, w.redeemed_order_id, w.expired_at, w.revoked_at,
            ${COUPON_ROW_COLUMNS}
       FROM bms_customer_coupon_wallet w
       JOIN bms_coupons c ON c.id = w.coupon_id
      WHERE w.tenant_id = $1
        AND w.customer_id = $2
      ORDER BY c.expires_at ASC NULLS LAST, w.assigned_at DESC`,
    [tenantId, customerId]
  );
  return res.rows;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString();
}

function derivedWalletState(row: WalletRow, coupon: Coupon): CustomerCoupon["state"] {
  if (row.revoked_at) return "REVOKED";
  if (row.redeemed_order_id || row.redeemed_at) return "REDEEMED";
  if (coupon.expiresAt && Date.now() > new Date(coupon.expiresAt).getTime()) return "EXPIRED";
  if (row.reserved_order_id || row.reserved_at) return "RESERVED";
  if (row.claimed_at) return "CLAIMED";
  return row.state ?? "ASSIGNED";
}

async function syncWalletLifecycle(tenantId: string, customerId: string): Promise<void> {
  await query(
    `UPDATE bms_customer_coupon_wallet w
        SET state = 'EXPIRED',
            expired_at = COALESCE(expired_at, now()),
            updated_at = now()
       FROM bms_coupons c
      WHERE w.tenant_id = $1
        AND w.customer_id = $2
        AND w.coupon_id = c.id
        AND w.revoked_at IS NULL
        AND w.redeemed_at IS NULL
        AND c.expires_at IS NOT NULL
        AND c.expires_at < now()
        AND w.state <> 'EXPIRED'`,
    [tenantId, customerId]
  );
}

export async function listCustomerCouponWallet(
  tenantId: string,
  opts: { channel?: string | null; customerRef?: string | null; subtotal?: number | null; customerId?: string | null }
): Promise<CustomerCouponWalletItem[]> {
  const customerId = opts.customerId ?? await findCustomerIdByIdentity(tenantId, opts.channel, opts.customerRef);
  if (!customerId) return [];
  await syncWalletLifecycle(tenantId, customerId);
  const rows = await listWalletRows(tenantId, customerId);
  if (rows.length === 0) return [];
  const coupons = rows.map((r) => mapRow(r));
  const counts = await customerCouponUseCounts(tenantId, customerId, coupons.map((c) => c.id), coupons.map((c) => c.code));
  return rows.map((row) => {
    const coupon = mapRow(row);
    return {
      ...coupon,
      ...baseEligibility(coupon, counts.get(coupon.id) ?? 0, opts.subtotal, {
        walletId: row.wallet_id,
        assignedAt: toIsoOrNull(row.assigned_at),
        source: row.source ?? null,
        state: derivedWalletState(row, coupon),
        claimedAt: toIsoOrNull(row.claimed_at),
        reservedAt: toIsoOrNull(row.reserved_at),
        reservedOrderId: row.reserved_order_id ?? null,
        redeemedAt: toIsoOrNull(row.redeemed_at),
        redeemedOrderId: row.redeemed_order_id ?? null,
        expiredAt: toIsoOrNull(row.expired_at),
        revokedAt: toIsoOrNull(row.revoked_at),
      }),
    };
  });
}

export async function listAvailableCouponsForCustomer(
  tenantId: string,
  opts: { channel?: string | null; customerRef?: string | null; subtotal?: number | null; limit?: number }
): Promise<CustomerCoupon[]> {
  const customerId = await findCustomerIdByIdentity(tenantId, opts.channel, opts.customerRef);
  if (customerId) {
    const walletItems = await listCustomerCouponWallet(tenantId, { customerId, subtotal: opts.subtotal });
    if (walletItems.length > 0) {
      return walletItems
        .filter((coupon) => coupon.available)
        .slice(0, Math.min(Math.max(opts.limit ?? 5, 1), 20));
    }
  }
  const res = await query(
    `SELECT ${ROW_COLUMNS}
       FROM bms_coupons
      WHERE tenant_id = $1
      ORDER BY expires_at ASC NULLS LAST, created_at DESC
      LIMIT 200`,
    [tenantId]
  );
  const coupons = res.rows.map(mapRow);
  const counts = await customerCouponUseCounts(tenantId, customerId, coupons.map((c) => c.id), coupons.map((c) => c.code));
  return coupons
    .map((coupon) => ({ ...coupon, ...baseEligibility(coupon, counts.get(coupon.id) ?? 0, opts.subtotal, null) }))
    .filter((coupon) => coupon.available)
    .slice(0, Math.min(Math.max(opts.limit ?? 5, 1), 20));
}

export async function checkCouponForCustomer(
  tenantId: string,
  rawCode: string,
  opts: { channel?: string | null; customerRef?: string | null; subtotal?: number | null; alternativeLimit?: number }
): Promise<CustomerCouponLookup> {
  const code = rawCode.trim().toUpperCase();
  const customerId = await findCustomerIdByIdentity(tenantId, opts.channel, opts.customerRef);
  const walletItems = customerId ? await listCustomerCouponWallet(tenantId, { customerId, subtotal: opts.subtotal }) : [];
  const hasWallet = walletItems.length > 0;
  const walletMatch = walletItems.find((item) => item.code === code) ?? null;
  if (hasWallet && !walletMatch) {
    return {
      requestedCode: code || null,
      requested: null,
      alternatives: walletItems.filter((item) => item.available).slice(0, Math.min(Math.max(opts.alternativeLimit ?? 3, 1), 20)),
    };
  }
  const res = await query(
    `SELECT ${ROW_COLUMNS}
       FROM bms_coupons
      WHERE tenant_id = $1 AND code = $2
      LIMIT 1`,
    [tenantId, code]
  );
  const coupon = res.rows[0] ? mapRow(res.rows[0]) : null;
  const counts = coupon
    ? await customerCouponUseCounts(tenantId, customerId, [coupon.id], [coupon.code])
    : new Map<string, number>();
  const requested = coupon
    ? { ...coupon, ...baseEligibility(coupon, counts.get(coupon.id) ?? 0, opts.subtotal, walletMatch ? {
        walletId: walletMatch.walletId,
        assignedAt: walletMatch.assignedAt,
        source: walletMatch.source,
      } : null) }
    : null;
  const alternatives = requested?.available
    ? []
    : await listAvailableCouponsForCustomer(tenantId, {
        channel: opts.channel,
        customerRef: opts.customerRef,
        subtotal: opts.subtotal,
        limit: opts.alternativeLimit ?? 3,
      });
  return { requestedCode: code || null, requested, alternatives };
}

export function couponCodeFromShareText(body: string): string | null {
  const text = String(body || "");
  const codeLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^(?:โค้ด|CODE)\s+/i.test(line));
  if (codeLine) return codeLine.replace(/^(?:โค้ด|CODE)\s+/i, "").trim().toUpperCase() || null;
  return null;
}

type CouponClaimTokenPayload = {
  tenantId: string;
  customerId: string;
  code: string;
  exp: number;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function couponClaimSecret(): string {
  return (
    process.env.BMS_COUPON_CLAIM_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.JWT_SECRET ||
    "dev-only-coupon-claim-secret"
  );
}

function signCouponClaimPayload(encodedPayload: string): string {
  return createHmac("sha256", couponClaimSecret()).update(encodedPayload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createCouponClaimToken(input: {
  tenantId: string;
  customerId: string;
  code: string;
  expiresInSeconds?: number;
}): string {
  const payload: CouponClaimTokenPayload = {
    tenantId: input.tenantId,
    customerId: input.customerId,
    code: input.code.trim().toUpperCase(),
    exp: Math.floor(Date.now() / 1000) + Math.max(input.expiresInSeconds ?? 60 * 60 * 24 * 30, 60),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signCouponClaimPayload(encodedPayload)}`;
}

export function verifyCouponClaimToken(token: string): CouponClaimTokenPayload | null {
  const [encodedPayload, signature, extra] = String(token || "").split(".");
  if (!encodedPayload || !signature || extra) return null;
  if (!safeEqual(signature, signCouponClaimPayload(encodedPayload))) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<CouponClaimTokenPayload>;
    if (!payload.tenantId || !payload.customerId || !payload.code || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      tenantId: String(payload.tenantId),
      customerId: String(payload.customerId),
      code: String(payload.code).trim().toUpperCase(),
      exp: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

export async function assignCouponToCustomer(
  tenantId: string,
  customerId: string,
  rawCode: string,
  opts?: { actor?: string | null; source?: string | null; note?: string | null }
): Promise<boolean> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return false;
  const coupon = await query<{ id: string }>(
    `SELECT id FROM bms_coupons WHERE tenant_id = $1 AND code = $2 LIMIT 1`,
    [tenantId, code]
  );
  if (coupon.rowCount === 0) return false;
  await query(
    `INSERT INTO bms_customer_coupon_wallet
       (tenant_id, customer_id, coupon_id, source, assigned_by, note, assigned_at, revoked_at, updated_at, state,
        claimed_at, reserved_at, reserved_order_id, redeemed_at, redeemed_order_id, expired_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), NULL, now(), 'ASSIGNED', NULL, NULL, NULL, NULL, NULL, NULL)
     ON CONFLICT (tenant_id, customer_id, coupon_id) DO UPDATE
       SET source = EXCLUDED.source,
           assigned_by = EXCLUDED.assigned_by,
           note = EXCLUDED.note,
           assigned_at = now(),
           revoked_at = NULL,
           state = 'ASSIGNED',
           claimed_at = NULL,
           reserved_at = NULL,
           reserved_order_id = NULL,
           redeemed_at = NULL,
           redeemed_order_id = NULL,
           expired_at = NULL,
           updated_at = now()`,
    [tenantId, customerId, coupon.rows[0].id, opts?.source ?? "MANUAL_CHAT", opts?.actor ?? null, opts?.note ?? null]
  );
  return true;
}

export async function claimCouponForCustomer(
  tenantId: string,
  rawCode: string,
  opts: {
    channel?: string | null;
    customerRef?: string | null;
    customerId?: string | null;
    actor?: string | null;
    allowFutureStart?: boolean;
  }
): Promise<{ ok: true; code: string; startsAt: string | null } | { ok: false; reason: string }> {
  const customerId = opts.customerId ?? await findCustomerIdByIdentity(tenantId, opts.channel, opts.customerRef);
  if (!customerId) return { ok: false, reason: "ยังไม่พบข้อมูลลูกค้า" };
  const lookup = await checkCouponForCustomer(tenantId, rawCode, {
    channel: opts.channel,
    customerRef: opts.customerRef,
    subtotal: null,
    alternativeLimit: 3,
  });
  if (!lookup.requested) return { ok: false, reason: "ไม่พบคูปองนี้ในสิทธิ์ของลูกค้า" };
  const canClaimBeforeStart = Boolean(
    opts.allowFutureStart &&
    lookup.requested.startsAt &&
    Date.now() < new Date(lookup.requested.startsAt).getTime() &&
    lookup.requested.reason === "โค้ดนี้ยังไม่เริ่มใช้ได้"
  );
  if (!lookup.requested.available && !canClaimBeforeStart) {
    return { ok: false, reason: lookup.requested.reason || "คูปองนี้ยังใช้ไม่ได้" };
  }
  const assigned = await assignCouponToCustomer(tenantId, customerId, lookup.requested.code, {
    actor: opts.actor ?? null,
    source: lookup.requested.source ?? "CUSTOMER_CLAIM",
    note: opts.allowFutureStart ? "Claimed by customer claim link" : "Claimed by customer intent",
  });
  if (!assigned) return { ok: false, reason: "ไม่พบคูปองนี้" };
  await query(
    `UPDATE bms_customer_coupon_wallet
        SET state = 'CLAIMED',
            claimed_at = COALESCE(claimed_at, now()),
            updated_at = now()
      WHERE tenant_id = $1 AND customer_id = $2 AND coupon_id = $3`,
    [tenantId, customerId, lookup.requested.id]
  );
  return { ok: true, code: lookup.requested.code, startsAt: lookup.requested.startsAt };
}

export async function claimCouponByToken(
  token: string
): Promise<{ ok: true; code: string; startsAt: string | null } | { ok: false; reason: string }> {
  const payload = verifyCouponClaimToken(token);
  if (!payload) return { ok: false, reason: "ลิงก์คูปองไม่ถูกต้องหรือหมดอายุแล้ว" };
  return claimCouponForCustomer(payload.tenantId, payload.code, {
    customerId: payload.customerId,
    actor: "customer:claim-link",
    allowFutureStart: true,
  });
}

export async function reserveCustomerCouponInTx(
  client: PoolClient,
  tenantId: string,
  customerId: string | null,
  couponId: string | null,
  orderId: string
): Promise<void> {
  if (!customerId || !couponId) return;
  await client.query(
    `INSERT INTO bms_customer_coupon_wallet
       (tenant_id, customer_id, coupon_id, source, assigned_at, updated_at, state, claimed_at, reserved_at, reserved_order_id)
     VALUES ($1, $2, $3, 'AUTO_CLAIM', now(), now(), 'RESERVED', now(), now(), $4)
     ON CONFLICT (tenant_id, customer_id, coupon_id) DO UPDATE
       SET state = 'RESERVED',
           claimed_at = COALESCE(bms_customer_coupon_wallet.claimed_at, now()),
           reserved_at = now(),
           reserved_order_id = $4,
           expired_at = NULL,
           revoked_at = NULL,
           updated_at = now()`,
    [tenantId, customerId, couponId, orderId]
  );
}

export async function releaseCustomerCouponReservationsInTx(client: PoolClient, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await client.query(
    `UPDATE bms_customer_coupon_wallet w
        SET state = CASE WHEN w.claimed_at IS NOT NULL THEN 'CLAIMED' ELSE 'ASSIGNED' END,
            reserved_at = NULL,
            reserved_order_id = NULL,
            redeemed_at = CASE WHEN w.redeemed_order_id = o.id THEN NULL ELSE w.redeemed_at END,
            redeemed_order_id = CASE WHEN w.redeemed_order_id = o.id THEN NULL ELSE w.redeemed_order_id END,
            updated_at = now()
       FROM bms_orders o
      WHERE o.id = ANY($1::uuid[])
        AND w.tenant_id = o.tenant_id
        AND w.customer_id = o.customer_id
        AND w.coupon_id = o.coupon_id
        AND (w.reserved_order_id = o.id OR w.redeemed_order_id = o.id)`,
    [orderIds]
  );
}

export async function redeemCustomerCouponForOrderInTx(client: PoolClient, tenantId: string, orderId: string): Promise<void> {
  await client.query(
    `UPDATE bms_customer_coupon_wallet w
        SET state = 'REDEEMED',
            redeemed_at = COALESCE(redeemed_at, now()),
            redeemed_order_id = COALESCE(redeemed_order_id, o.id),
            reserved_at = NULL,
            reserved_order_id = NULL,
            updated_at = now()
       FROM bms_orders o
      WHERE o.tenant_id = $1
        AND o.id = $2
        AND o.customer_id IS NOT NULL
        AND o.coupon_id IS NOT NULL
        AND w.tenant_id = o.tenant_id
        AND w.customer_id = o.customer_id
        AND w.coupon_id = o.coupon_id`,
    [tenantId, orderId]
  );
}

export type CouponRedemption = {
  orderId: string;
  customerId: string | null;
  customerName: string | null;
  channel: string;
  status: string;
  discountAmount: number;
  totalAmount: number;
  createdAt: string;
};

/**
 * ประวัติการใช้โค้ด — ไม่มีตาราง redemption log แยก (ตามที่ตัดสินใจไว้ตอนออกแบบ
 * bms_coupons) query ตรงจาก bms_orders แทน
 * · match ด้วย coupon_id ที่นิ่งเป็นหลัก (7.23) — กันปัญหา rename โค้ดแล้วประวัติหาย/ผิดตัว
 * · fallback ไป coupon_code เฉพาะออเดอร์เก่าที่ยังไม่มี coupon_id (ก่อน 7.23) เท่านั้น
 */
export async function listCouponRedemptions(tenantId: string, couponId: string): Promise<CouponRedemption[]> {
  const coupon = await query<{ code: string }>(
    `SELECT code FROM bms_coupons WHERE tenant_id = $1 AND id = $2`,
    [tenantId, couponId]
  );
  if (coupon.rowCount === 0) return [];

  const res = await query(
    `SELECT o.id AS order_id, o.customer_id, o.channel, o.status, o.total_amount, o.discount_amount, o.created_at,
            COALESCE(NULLIF(cu.name, o.customer_ref), ci.display_name, o.customer_ref) AS customer_name
       FROM bms_orders o
       LEFT JOIN bms_customers cu ON cu.id = o.customer_id
       LEFT JOIN bms_customer_identities ci
         ON ci.tenant_id = o.tenant_id AND ci.channel = o.channel AND ci.external_ref = o.customer_ref
      WHERE o.tenant_id = $1
        AND (o.coupon_id = $2 OR (o.coupon_id IS NULL AND o.coupon_code = $3))
      ORDER BY o.created_at DESC`,
    [tenantId, couponId, coupon.rows[0].code]
  );
  return res.rows.map((r: any) => ({
    orderId: r.order_id,
    customerId: r.customer_id ?? null,
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

export async function upsertCoupon(
  tenantId: string,
  input: UpsertCouponInput,
  editorId?: string | number | null
): Promise<Coupon> {
  const v = normalizeInput(input);
  // UPDATE ต้องผ่าน beginTenantTx() พร้อม editorId เพื่อให้ revision trigger (7.22)
  // เห็น app.editor_id — INSERT ไม่ fire trigger (BEFORE UPDATE) จึงไม่ต้อง tx เพิ่ม
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId });
    if (v.id) {
      // ล็อกแถวก่อน แล้วห้ามเปลี่ยน "code" ถ้าคูปองถูกใช้ไปแล้ว — code = identity ที่ลูกค้าพิมพ์/
      // ที่ออเดอร์เก่า snapshot ไว้ ถ้า rename หลังใช้ ป้ายบนออเดอร์เก่าจะค้าง + ไปชนคูปองอื่นที่
      // มาใช้ชื่อเดิม ( field อื่น เช่น value/วันหมดอายุ/สถานะ ยังแก้ได้) ถ้าอยากได้โค้ดใหม่ให้สร้างใหม่
      const cur = await client.query<{ code: string; redemptions_count: number }>(
        `SELECT code, redemptions_count
           FROM bms_coupons
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
        [tenantId, v.id]
      );
      if (cur.rowCount === 0) throw new Error("ไม่พบโค้ดส่วนลดนี้");
      const orderUse = await client.query<{ order_count: number }>(
        `SELECT COUNT(*)::int AS order_count
           FROM bms_orders
          WHERE tenant_id = $1
            AND (coupon_id = $2 OR (coupon_id IS NULL AND coupon_code = $3))`,
        [tenantId, v.id, cur.rows[0].code]
      );
      const orderCount = Number(orderUse.rows[0]?.order_count ?? 0);
      if ((cur.rows[0].redemptions_count > 0 || orderCount > 0) && cur.rows[0].code !== v.code) {
        throw new Error(
          `เปลี่ยนโค้ดไม่ได้: "${cur.rows[0].code}" เคยถูกใช้กับออเดอร์แล้ว ${orderCount} รายการ — ` +
          `แก้ส่วนลด/วันหมดอายุ/สถานะได้ แต่ถ้าต้องการโค้ดใหม่ให้สร้างโค้ดใหม่แทน`
        );
      }
      const res = await client.query(
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
      await client.query("COMMIT");
      return mapRow(res.rows[0]);
    }
    const res = await client.query(
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
    await client.query("COMMIT");
    return mapRow(res.rows[0]);
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch {}
    if (err?.code === "23505") throw new Error(`โค้ด "${v.code}" มีอยู่แล้ว`);
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteCoupon(tenantId: string, id: string): Promise<boolean> {
  // ห้ามลบคูปองที่เคยถูกใช้กับออเดอร์แล้ว — แม้ order จะถูก cancel แล้วคืน quota จน
  // redemptions_count กลับเป็น 0 ก็ตาม ประวัติการใช้/ออเดอร์เก่ายังต้อง trace ได้
  // ให้ "ปิดใช้งาน" (active=false) แทน หยุดใช้ต่อได้แต่เก็บประวัติครบ
  const cur = await query<{ code: string; redemptions_count: number; order_count: number }>(
    `SELECT c.code, c.redemptions_count,
            COUNT(o.id)::int AS order_count
       FROM bms_coupons c
       LEFT JOIN bms_orders o
         ON o.tenant_id = c.tenant_id
        AND (o.coupon_id = c.id OR (o.coupon_id IS NULL AND o.coupon_code = c.code))
      WHERE c.tenant_id = $1 AND c.id = $2
      GROUP BY c.id`,
    [tenantId, id]
  );
  if (cur.rowCount === 0) return false;
  const usageCount = Math.max(cur.rows[0].redemptions_count, cur.rows[0].order_count);
  if (usageCount > 0) {
    throw new Error(
      `ลบไม่ได้: โค้ด "${cur.rows[0].code}" เคยถูกใช้แล้ว ${usageCount} ครั้ง/รายการ — ` +
      `ให้ "ปิดใช้งาน" แทน (แก้โค้ด → ปิดสวิตช์เปิดใช้งาน) เพื่อเก็บประวัติการใช้ไว้`
    );
  }
  const res = await query(`DELETE FROM bms_coupons WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * คืน quota โค้ด (ลด redemptions_count) ของออเดอร์ที่ถูก cancel/auto-release ก่อนขายจริง —
 * เรียกในทรานแซกชันเดียวกับการเปลี่ยนสถานะออเดอร์ (เหมือนคืน reserved_stock)
 * ผูกด้วย coupon_id ที่นิ่ง (7.23) เป็นหลัก และ fallback ด้วย coupon_code สำหรับออเดอร์เก่า
 * ก่อน 7.23 ที่ยังไม่มี coupon_id · GREATEST(0, ...) กันติดลบ · set app.skip_revision กัน
 * counter update ไปสร้าง revision snapshot รก (7.24)
 */
export async function releaseCouponForOrdersInTx(client: PoolClient, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await client.query("SELECT set_config('app.skip_revision', '1', true)");
  try {
    await client.query(
      `UPDATE bms_coupons c
          SET redemptions_count = GREATEST(0, c.redemptions_count - sub.cnt), updated_at = now()
         FROM (
           SELECT COALESCE(o.coupon_id, legacy.id) AS coupon_id, COUNT(*)::int AS cnt
             FROM bms_orders o
             LEFT JOIN bms_coupons legacy
               ON o.coupon_id IS NULL
              AND legacy.tenant_id = o.tenant_id
              AND legacy.code = o.coupon_code
            WHERE o.id = ANY($1::uuid[])
              AND COALESCE(o.coupon_id, legacy.id) IS NOT NULL
            GROUP BY COALESCE(o.coupon_id, legacy.id)
         ) sub
        WHERE c.id = sub.coupon_id`,
      [orderIds]
    );
  } finally {
    await client.query("SELECT set_config('app.skip_revision', '', true)");
  }
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
        WHERE tenant_id = $1
          AND customer_id = $2
          AND status <> 'CANCELLED'
          AND (coupon_id = $3 OR (coupon_id IS NULL AND coupon_code = $4))`,
      [tenantId, customerId, c.id, code]
    );
    if (Number(used.rows[0]?.n ?? 0) >= c.perCustomerLimit) {
      return { ok: false, reason: "คุณใช้โค้ดนี้ครบจำนวนที่กำหนดแล้ว" };
    }
  }

  const discount = c.type === "PERCENT"
    ? Math.round(subtotal * (c.value / 100) * 100) / 100
    : Math.min(c.value, subtotal);

  // +1 เป็น counter เชิงปฏิบัติการ — กัน revision trigger (7.22) snapshot รก (7.24)
  await client.query("SELECT set_config('app.skip_revision', '1', true)");
  try {
    await client.query(
      `UPDATE bms_coupons SET redemptions_count = redemptions_count + 1, updated_at = now() WHERE id = $1`,
      [c.id]
    );
  } finally {
    await client.query("SELECT set_config('app.skip_revision', '', true)");
  }

  return { ok: true, couponId: c.id, code: c.code, discount };
}
