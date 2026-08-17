// =============================================================
// BMS Membership — สมาชิก + ชั้น (tier) + แต้มสะสม  (migration 7.96)
// -------------------------------------------------------------
// ความจริงของแต้มอยู่ที่ bms_loyalty_ledger เท่านั้น:
//   * bms_customers.points_balance = cache ของ SUM(points) เอาไว้อ่านเร็ว
//   * "แต้มที่ใช้ได้" = SUM(points − consumed_points) ของแถวที่ให้แต้ม
//     ซึ่งยังไม่หมดอายุ — ตัดแบบ FIFO (ก้อนที่หมดอายุก่อนถูกใช้ก่อน)
//   * ยอดติดลบได้ เมื่อลูกค้าคืนสินค้าหลังใช้แต้มไปแล้ว (ห้าม clamp เป็น 0
//     ไม่งั้นซื้อ-แล้ว-คืนกลายเป็นวิธีปั๊มแต้ม)
//
// ทุกฟังก์ชันที่ลงท้าย InTx ต้องถูกเรียกด้วย client ตัวเดียวกับทรานแซกชันของ
// createOrder()/processPosReturn() — แต้มกับสต็อกกับเงินต้อง commit/rollback
// พร้อมกัน ห้ามยิงหลัง commit
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------
// ตั้งค่าโปรแกรม
// ---------------------------------------------------------------

export type LoyaltyEarnMode = "SPEND" | "VISIT";
export type LoyaltyEarnBase = "AFTER_DISCOUNT" | "BEFORE_DISCOUNT";

export type LoyaltySettings = {
  enabled: boolean;
  earnMode: LoyaltyEarnMode;
  earnPointsPerBaht: number;
  visitPoints: number;
  earnMinSpend: number;
  earnBase: LoyaltyEarnBase;
  redeemPointsPerUnit: number;
  redeemBahtPerUnit: number;
  redeemMinPoints: number;
  maxDiscountPct: number;
  pointsExpireMonths: number;
};

/** ร้านที่ยังไม่มีแถว settings ถือว่าปิดโปรแกรม (ไม่ throw — POS ต้องขายได้ต่อ) */
const DEFAULT_SETTINGS: LoyaltySettings = {
  enabled: false,
  earnMode: "SPEND",
  earnPointsPerBaht: 1,
  visitPoints: 1,
  earnMinSpend: 0,
  earnBase: "AFTER_DISCOUNT",
  redeemPointsPerUnit: 100,
  redeemBahtPerUnit: 10,
  redeemMinPoints: 100,
  maxDiscountPct: 100,
  pointsExpireMonths: 24,
};

const SETTINGS_COLUMNS = `enabled, earn_mode, earn_points_per_baht, visit_points, earn_min_spend,
  earn_base, redeem_points_per_unit, redeem_baht_per_unit, redeem_min_points,
  max_discount_pct, points_expire_months`;

function mapSettings(r: any): LoyaltySettings {
  return {
    enabled: Boolean(r.enabled),
    earnMode: r.earn_mode === "VISIT" ? "VISIT" : "SPEND",
    earnPointsPerBaht: Number(r.earn_points_per_baht),
    visitPoints: Number(r.visit_points),
    earnMinSpend: Number(r.earn_min_spend),
    earnBase: r.earn_base === "BEFORE_DISCOUNT" ? "BEFORE_DISCOUNT" : "AFTER_DISCOUNT",
    redeemPointsPerUnit: Number(r.redeem_points_per_unit),
    redeemBahtPerUnit: Number(r.redeem_baht_per_unit),
    redeemMinPoints: Number(r.redeem_min_points),
    maxDiscountPct: Number(r.max_discount_pct),
    pointsExpireMonths: Number(r.points_expire_months),
  };
}

export async function getLoyaltySettings(tenantId: string): Promise<LoyaltySettings> {
  const res = await query(`SELECT ${SETTINGS_COLUMNS} FROM bms_loyalty_settings WHERE tenant_id = $1`, [tenantId]);
  return res.rows[0] ? mapSettings(res.rows[0]) : DEFAULT_SETTINGS;
}

async function getLoyaltySettingsInTx(client: PoolClient, tenantId: string): Promise<LoyaltySettings> {
  const res = await client.query(`SELECT ${SETTINGS_COLUMNS} FROM bms_loyalty_settings WHERE tenant_id = $1`, [tenantId]);
  return res.rows[0] ? mapSettings(res.rows[0]) : DEFAULT_SETTINGS;
}

export type UpdateLoyaltySettingsInput = Partial<LoyaltySettings>;

export async function updateLoyaltySettings(
  tenantId: string,
  input: UpdateLoyaltySettingsInput
): Promise<LoyaltySettings> {
  const cur = await getLoyaltySettings(tenantId);
  const next: LoyaltySettings = { ...cur, ...input };

  // กันค่าที่ทำให้บิลคิดไม่ได้ — DB มี CHECK อยู่แล้วแต่ error ที่นี่อ่านง่ายกว่า
  if (next.redeemPointsPerUnit <= 0) throw new Error("จำนวนแต้มต่อหน่วยแลกต้องมากกว่า 0");
  if (next.redeemBahtPerUnit <= 0) throw new Error("มูลค่าบาทต่อหน่วยแลกต้องมากกว่า 0");
  if (next.maxDiscountPct <= 0 || next.maxDiscountPct > 100) throw new Error("เพดานส่วนลดต้องอยู่ระหว่าง 1–100%");
  if (next.pointsExpireMonths < 0) throw new Error("อายุแต้มต้องไม่ติดลบ");
  if (next.earnPointsPerBaht < 0) throw new Error("อัตราได้แต้มต้องไม่ติดลบ");

  await query(
    `INSERT INTO bms_loyalty_settings
       (tenant_id, enabled, earn_mode, earn_points_per_baht, visit_points, earn_min_spend,
        earn_base, redeem_points_per_unit, redeem_baht_per_unit, redeem_min_points,
        max_discount_pct, points_expire_months, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       earn_mode = EXCLUDED.earn_mode,
       earn_points_per_baht = EXCLUDED.earn_points_per_baht,
       visit_points = EXCLUDED.visit_points,
       earn_min_spend = EXCLUDED.earn_min_spend,
       earn_base = EXCLUDED.earn_base,
       redeem_points_per_unit = EXCLUDED.redeem_points_per_unit,
       redeem_baht_per_unit = EXCLUDED.redeem_baht_per_unit,
       redeem_min_points = EXCLUDED.redeem_min_points,
       max_discount_pct = EXCLUDED.max_discount_pct,
       points_expire_months = EXCLUDED.points_expire_months,
       updated_at = now()`,
    [tenantId, next.enabled, next.earnMode, next.earnPointsPerBaht, next.visitPoints, next.earnMinSpend,
      next.earnBase, next.redeemPointsPerUnit, next.redeemBahtPerUnit, next.redeemMinPoints,
      next.maxDiscountPct, next.pointsExpireMonths]
  );
  return next;
}

// ---------------------------------------------------------------
// ชั้นสมาชิก
// ---------------------------------------------------------------

export type TierDiscountType = "NONE" | "PERCENT" | "FIXED";

export type MembershipTier = {
  id: string;
  code: string;
  name: string;
  discountType: TierDiscountType;
  discountValue: number;
  qualifySpend12m: number;
  qualifyPoints: number;
  sortOrder: number;
  active: boolean;
};

const TIER_COLUMNS = `id, code, name, discount_type, discount_value,
  qualify_spend_12m, qualify_points, sort_order, active`;

function mapTier(r: any): MembershipTier {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    discountType: r.discount_type,
    discountValue: Number(r.discount_value),
    qualifySpend12m: Number(r.qualify_spend_12m),
    qualifyPoints: Number(r.qualify_points),
    sortOrder: Number(r.sort_order),
    active: Boolean(r.active),
  };
}

export async function listMembershipTiers(tenantId: string, activeOnly = false): Promise<MembershipTier[]> {
  const res = await query(
    `SELECT ${TIER_COLUMNS} FROM bms_membership_tiers
      WHERE tenant_id = $1 ${activeOnly ? "AND active" : ""}
      ORDER BY sort_order, code`,
    [tenantId]
  );
  return res.rows.map(mapTier);
}

export type UpsertTierInput = {
  id?: string | null;
  code: string;
  name: string;
  discountType: TierDiscountType;
  discountValue: number;
  qualifySpend12m: number;
  qualifyPoints: number;
  sortOrder: number;
  active: boolean;
};

export async function upsertMembershipTier(tenantId: string, input: UpsertTierInput): Promise<MembershipTier> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("ต้องระบุรหัสชั้นสมาชิก");
  if (input.discountType === "PERCENT" && input.discountValue > 100) {
    throw new Error("ส่วนลดแบบเปอร์เซ็นต์ต้องไม่เกิน 100");
  }
  if (input.discountValue < 0) throw new Error("ส่วนลดต้องไม่ติดลบ");

  if (input.id) {
    const res = await query(
      `UPDATE bms_membership_tiers
          SET code = $3, name = $4, discount_type = $5, discount_value = $6,
              qualify_spend_12m = $7, qualify_points = $8, sort_order = $9, active = $10,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${TIER_COLUMNS}`,
      [tenantId, input.id, code, input.name.trim(), input.discountType, input.discountValue,
        input.qualifySpend12m, input.qualifyPoints, input.sortOrder, input.active]
    );
    if (!res.rowCount) throw new Error("ไม่พบชั้นสมาชิกนี้");
    return mapTier(res.rows[0]);
  }

  const res = await query(
    `INSERT INTO bms_membership_tiers
       (tenant_id, code, name, discount_type, discount_value, qualify_spend_12m,
        qualify_points, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, code) DO UPDATE SET
       name = EXCLUDED.name, discount_type = EXCLUDED.discount_type,
       discount_value = EXCLUDED.discount_value, qualify_spend_12m = EXCLUDED.qualify_spend_12m,
       qualify_points = EXCLUDED.qualify_points, sort_order = EXCLUDED.sort_order,
       active = EXCLUDED.active, updated_at = now()
     RETURNING ${TIER_COLUMNS}`,
    [tenantId, code, input.name.trim(), input.discountType, input.discountValue,
      input.qualifySpend12m, input.qualifyPoints, input.sortOrder, input.active]
  );
  return mapTier(res.rows[0]);
}

/**
 * ปิดใช้งานแทนการลบเมื่อยังมีสมาชิกอยู่ในชั้นนั้น — ลบทิ้งจะทำให้ tier_id ของ
 * ลูกค้ากลายเป็น NULL เงียบ ๆ (ON DELETE SET NULL) แล้วส่วนลดหายโดยไม่มีใครรู้
 */
export async function deleteMembershipTier(tenantId: string, id: string): Promise<{ deleted: boolean; deactivated: boolean }> {
  const inUse = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM bms_customers WHERE tenant_id = $1 AND tier_id = $2`,
    [tenantId, id]
  );
  if (Number(inUse.rows[0]?.n ?? 0) > 0) {
    const res = await query(
      `UPDATE bms_membership_tiers SET active = FALSE, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return { deleted: false, deactivated: Boolean(res.rowCount) };
  }
  const res = await query(`DELETE FROM bms_membership_tiers WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return { deleted: Boolean(res.rowCount), deactivated: false };
}

/** ส่วนลดของชั้น คิดจากค่าสินค้า — FIXED ไม่เกินยอดบิล, PERCENT ปัด 2 ตำแหน่ง */
export function tierDiscountAmount(tier: MembershipTier | null, subtotal: number): number {
  if (!tier || !tier.active || tier.discountType === "NONE" || subtotal <= 0) return 0;
  if (tier.discountType === "PERCENT") return round2(subtotal * (tier.discountValue / 100));
  return round2(Math.min(tier.discountValue, subtotal));
}

// ---------------------------------------------------------------
// สมาชิก
// ---------------------------------------------------------------

export type MemberSummary = {
  customerId: string;
  name: string;
  phone: string | null;
  memberNo: string | null;
  memberSince: string | null;
  tier: MembershipTier | null;
  /** SUM(points) ทั้ง ledger — ติดลบได้ */
  pointsBalance: number;
  /** แต้มที่แลกได้จริงตอนนี้ (ตัดก้อนหมดอายุออกแล้ว) */
  pointsUsable: number;
};

const MEMBER_SELECT = `
  SELECT c.id, c.name, c.phone, c.member_no, c.member_since, c.points_balance,
         t.id AS tier_id, t.code AS tier_code, t.name AS tier_name,
         t.discount_type, t.discount_value, t.qualify_spend_12m, t.qualify_points,
         t.sort_order, t.active AS tier_active,
         COALESCE((
           SELECT SUM(l.points - l.consumed_points)
             FROM bms_loyalty_ledger l
            WHERE l.tenant_id = c.tenant_id AND l.customer_id = c.id
              AND l.points > 0
              AND (l.expires_at IS NULL OR l.expires_at > now())
         ), 0) AS points_usable
    FROM bms_customers c
    LEFT JOIN bms_membership_tiers t ON t.tenant_id = c.tenant_id AND t.id = c.tier_id`;

function mapMember(r: any): MemberSummary {
  return {
    customerId: r.id,
    name: r.name,
    phone: r.phone ?? null,
    memberNo: r.member_no ?? null,
    memberSince: r.member_since ? new Date(r.member_since).toISOString() : null,
    tier: r.tier_id
      ? mapTier({
          id: r.tier_id, code: r.tier_code, name: r.tier_name,
          discount_type: r.discount_type, discount_value: r.discount_value,
          qualify_spend_12m: r.qualify_spend_12m, qualify_points: r.qualify_points,
          sort_order: r.sort_order, active: r.tier_active,
        })
      : null,
    pointsBalance: Number(r.points_balance ?? 0),
    // ยอดใช้ได้ต้องไม่ติดลบ (ยอดติดลบสะท้อนที่ pointsBalance ไม่ใช่ที่นี่)
    pointsUsable: Math.max(0, Number(r.points_usable ?? 0)),
  };
}

/**
 * ค้นสมาชิกจากเบอร์/ชื่อ/เลขสมาชิก — จอ POS ใช้ช่องเดียวค้นได้ทุกแบบ
 * คำค้นว่าง = คืนรายชื่อสมาชิกล่าสุด เพื่อให้หน้าแอดมิน "ไล่ดู" ได้ ไม่ใช่บังคับ
 * ให้เดาคำค้นก่อนจึงจะเห็นอะไร · ฝั่ง POS มี guard ของตัวเองว่าต้องพิมพ์ ≥ 3 ตัว
 * ก่อนเรียก จึงไม่ทำให้จอขายไล่ดูรายชื่อลูกค้าทั้งร้านได้
 */
export async function searchMembers(
  tenantId: string,
  rawQuery: string,
  limit = 10,
  offset = 0
): Promise<MemberSummary[]> {
  const q = rawQuery.trim();
  const res = await query(
    `${MEMBER_SELECT}
      WHERE c.tenant_id = $1
        AND c.deleted_at IS NULL
        AND c.member_no IS NOT NULL
        AND ($2 = '' OR c.phone ILIKE $3 OR c.name ILIKE $3 OR c.member_no ILIKE $3)
      ORDER BY c.member_since DESC NULLS LAST, c.name
      LIMIT $4 OFFSET $5`,
    [tenantId, q, `%${q}%`, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0)]
  );
  return res.rows.map(mapMember);
}

/** จำนวนสมาชิกที่ตรงคำค้น — หน้าแอดมินใช้ทำ pagination */
export async function countMembers(tenantId: string, rawQuery = ""): Promise<number> {
  const q = rawQuery.trim();
  const res = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM bms_customers c
      WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND c.member_no IS NOT NULL
        AND ($2 = '' OR c.phone ILIKE $3 OR c.name ILIKE $3 OR c.member_no ILIKE $3)`,
    [tenantId, q, `%${q}%`]
  );
  return Number(res.rows[0]?.n ?? 0);
}

export async function getMember(tenantId: string, customerId: string): Promise<MemberSummary | null> {
  const res = await query(
    `${MEMBER_SELECT} WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
    [tenantId, customerId]
  );
  return res.rows[0] ? mapMember(res.rows[0]) : null;
}

/**
 * ดึงสมาชิก + แต้มที่ใช้ได้ ในทรานแซกชันของ createOrder
 * คืน null เมื่อ id ไม่ใช่ลูกค้าของร้านนี้ — ห้ามเชื่อ customerId ที่มาจาก client
 * (POS ส่งมาจากจอ ถ้าไม่ตรวจจะผูกบิลข้ามร้านหรือให้ส่วนลดของคนอื่นได้)
 */
export async function getMemberForOrderInTx(
  client: PoolClient,
  tenantId: string,
  customerId: string
): Promise<{ memberNo: string | null; tier: MembershipTier | null; pointsUsable: number } | null> {
  const res = await client.query(
    `${MEMBER_SELECT} WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
    [tenantId, customerId]
  );
  if (!res.rowCount) return null;
  const member = mapMember(res.rows[0]);
  return { memberNo: member.memberNo, tier: member.tier, pointsUsable: member.pointsUsable };
}

export type EnrollMemberResult =
  | { status: "ENROLLED" | "ALREADY_MEMBER"; member: MemberSummary }
  | { status: "INVALID"; reason: string };

/**
 * สมัครสมาชิกที่เคาน์เตอร์ — ค้นด้วยเบอร์ก่อนเสมอ ลูกค้าที่เคยคุยผ่าน LINE/TikTok
 * มี bms_customers อยู่แล้ว ต้องผูกเลขสมาชิกเข้ากับ record เดิม ไม่สร้างใหม่
 * (ร้านนี้ห้าม hard delete ลูกค้า การสร้างซ้ำแก้ทีหลังได้แค่ mergeCustomers)
 */
export async function enrollMember(
  tenantId: string,
  input: { name?: string | null; phone: string; actorUserId?: string | null }
): Promise<EnrollMemberResult> {
  const phone = input.phone.replace(/[\s-]/g, "").trim();
  if (!/^[0-9+]{8,20}$/.test(phone)) return { status: "INVALID", reason: "เบอร์โทรไม่ถูกต้อง" };
  const name = (input.name ?? "").trim();

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: input.actorUserId });

    const existing = await client.query<{ id: string; member_no: string | null; name: string }>(
      `SELECT id, member_no, name FROM bms_customers
        WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE`,
      [tenantId, phone]
    );

    let customerId: string;
    let alreadyMember = false;

    if (existing.rowCount) {
      customerId = existing.rows[0].id;
      alreadyMember = Boolean(existing.rows[0].member_no);
      if (!alreadyMember) {
        // ลูกค้าเดิมจากช่องทางแชท — เติมชื่อให้ถ้าเดิมยังว่าง/เป็น placeholder
        await client.query(
          `UPDATE bms_customers
              SET name = CASE WHEN $3 <> '' AND (name IS NULL OR name = '') THEN $3 ELSE name END,
                  updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, customerId, name]
        );
      }
    } else {
      if (!name) return finishInvalid(client, "ลูกค้าใหม่ต้องระบุชื่อ");
      const created = await client.query<{ id: string }>(
        `INSERT INTO bms_customers (tenant_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, name, phone]
      );
      customerId = created.rows[0].id;
    }

    if (!alreadyMember) {
      const tier = await client.query<{ id: string }>(
        `SELECT id FROM bms_membership_tiers
          WHERE tenant_id = $1 AND active ORDER BY sort_order, code LIMIT 1`,
        [tenantId]
      );
      await client.query(
        `UPDATE bms_customers
            SET member_no = $3, member_since = now(), tier_id = $4,
                tier_reviewed_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, customerId, await nextMemberNoInTx(client, tenantId), tier.rows[0]?.id ?? null]
      );
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1, $2, 'member.enroll', $3, $4)`,
        [tenantId, input.actorUserId ?? "system", customerId, JSON.stringify({ phone })]
      );
    }

    await client.query("COMMIT");
    const member = await getMember(tenantId, customerId);
    if (!member) return { status: "INVALID", reason: "สมัครสมาชิกไม่สำเร็จ" };
    return { status: alreadyMember ? "ALREADY_MEMBER" : "ENROLLED", member };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function finishInvalid(client: PoolClient, reason: string): Promise<EnrollMemberResult> {
  await client.query("ROLLBACK");
  return { status: "INVALID", reason };
}

/**
 * เลขสมาชิกรูปแบบ M000001 — ต่อจากเลขสูงสุดของร้าน (ไม่ใช้ sequence เพราะ
 * ต้องเริ่มนับใหม่ต่อร้าน) ชนกันไม่ได้เพราะมี unique index และเรียกใน tx
 * ที่ล็อกแถวลูกค้าไว้แล้ว
 */
async function nextMemberNoInTx(client: PoolClient, tenantId: string): Promise<string> {
  const res = await client.query<{ max_no: string | null }>(
    `SELECT MAX(NULLIF(regexp_replace(member_no, '\\D', '', 'g'), '')::bigint)::text AS max_no
       FROM bms_customers
      WHERE tenant_id = $1 AND member_no ~ '^M[0-9]+$'`,
    [tenantId]
  );
  const next = Number(res.rows[0]?.max_no ?? 0) + 1;
  return `M${String(next).padStart(6, "0")}`;
}

// ---------------------------------------------------------------
// คิดส่วนลด (preview — ต้องได้เลขเดียวกับตอน commit)
// ---------------------------------------------------------------

/** แต้ม → บาท ตามอัตราของร้าน (ปัดลงเป็นหน่วยแลก ไม่ให้เศษแต้มได้ส่วนลดฟรี) */
export function pointsToDiscount(settings: LoyaltySettings, points: number): { points: number; discount: number } {
  if (points <= 0 || !settings.enabled) return { points: 0, discount: 0 };
  const units = Math.floor(points / settings.redeemPointsPerUnit);
  if (units <= 0) return { points: 0, discount: 0 };
  return {
    points: units * settings.redeemPointsPerUnit,
    discount: round2(units * settings.redeemBahtPerUnit),
  };
}

export type MemberDiscountBreakdown = {
  subtotal: number;
  tierDiscount: number;
  tierLabel: string | null;
  couponDiscount: number;
  pointsDiscount: number;
  pointsUsed: number;
  manualDiscount: number;
  /** ผลรวมหลังบังคับเพดาน max_discount_pct */
  totalDiscount: number;
  /** ยอดสุทธิที่ลูกค้าต้องจ่าย (ยังไม่รวมค่าส่ง/ปัดเศษเงินสด) */
  netTotal: number;
  /** true = ส่วนลดถูกตัดเพราะชนเพดาน — จอต้องบอกพนักงาน */
  capped: boolean;
  cappedAt: number;
};

/**
 * ประกอบส่วนลดทุกชั้นตามลำดับตายตัว tier → คูปอง → แต้ม → ส่วนลดมือ
 * แล้วบังคับเพดานรวมต่อบิล ถ้าชนเพดานจะตัดจาก "ชั้นท้ายสุดก่อน" เพราะแต้ม/
 * ส่วนลดมือย้อนคืนได้ ส่วนคูปองที่นับ redemption แล้วย้อนยาก
 *
 * pure function — จอ POS เรียกก่อนกดขายได้ และ createOrder เรียกซ้ำตอน commit
 * ด้วย input เดียวกันต้องได้เลขเดียวกัน
 */
export function composeDiscounts(args: {
  settings: LoyaltySettings;
  subtotal: number;
  tier: MembershipTier | null;
  couponDiscount?: number;
  pointsRequested?: number;
  pointsAvailable?: number;
  manualDiscount?: number;
}): MemberDiscountBreakdown {
  const subtotal = round2(Math.max(0, args.subtotal));
  const cappedAt = round2(subtotal * (args.settings.maxDiscountPct / 100));

  const tierDiscount = tierDiscountAmount(args.tier, subtotal);
  const couponDiscount = round2(Math.max(0, args.couponDiscount ?? 0));
  const manualDiscount = round2(Math.max(0, args.manualDiscount ?? 0));

  // แลกได้ไม่เกินแต้มที่มี และไม่ต่ำกว่าขั้นต่ำที่ร้านกำหนด
  const requested = Math.max(0, Math.floor(args.pointsRequested ?? 0));
  const available = Math.max(0, Math.floor(args.pointsAvailable ?? 0));
  const redeemable = Math.min(requested, available);
  const points = args.settings.enabled && redeemable >= args.settings.redeemMinPoints
    ? pointsToDiscount(args.settings, redeemable)
    : { points: 0, discount: 0 };

  // ส่วนลดจากแต้มต้องไม่เกินยอดที่เหลือหลังหักชั้นอื่น — ลูกค้าจ่าย 0 ได้ แต่ห้ามติดลบ
  const beforePoints = round2(tierDiscount + couponDiscount + manualDiscount);
  const roomForPoints = Math.max(0, round2(Math.min(subtotal, cappedAt) - beforePoints));
  let pointsDiscount = Math.min(points.discount, roomForPoints);
  let pointsUsed = points.points;
  if (pointsDiscount < points.discount) {
    // ตัดจำนวนแต้มที่หักจริงลงตามส่วนลดที่ใช้ได้ ไม่หักแต้มที่ไม่ได้แปลงเป็นส่วนลด
    const units = Math.floor(pointsDiscount / args.settings.redeemBahtPerUnit);
    pointsUsed = units * args.settings.redeemPointsPerUnit;
    pointsDiscount = round2(units * args.settings.redeemBahtPerUnit);
  }

  const raw = round2(beforePoints + pointsDiscount);
  const totalDiscount = round2(Math.min(raw, cappedAt, subtotal));

  // ชนเพดานแล้วต้องตัดยอดของ "ชั้น" ให้ผลรวมเท่ากับ totalDiscount จริง ๆ
  // ไม่ใช่ปล่อยให้ตัวเลขต่อชั้นรวมกันเกิน — bms_order_discounts จะไม่ตรงกับ
  // discount_amount แล้วสืบย้อนใบกำกับไม่ได้ · ตัดจากชั้นที่ย้อนคืนง่ายที่สุดก่อน
  const trimmed = { tier: tierDiscount, coupon: couponDiscount, points: pointsDiscount, manual: manualDiscount };
  let over = round2(raw - totalDiscount);
  for (const key of ["manual", "points", "coupon", "tier"] as const) {
    if (over <= 0.001) break;
    const cut = Math.min(trimmed[key], over);
    trimmed[key] = round2(trimmed[key] - cut);
    over = round2(over - cut);
  }
  if (trimmed.points < pointsDiscount) {
    // ส่วนลดจากแต้มถูกตัด → จำนวนแต้มที่หักต้องลดตามด้วย ห้ามหักแต้มที่ไม่ได้เป็นส่วนลด
    const units = Math.floor(trimmed.points / args.settings.redeemBahtPerUnit);
    pointsUsed = units * args.settings.redeemPointsPerUnit;
    trimmed.points = round2(units * args.settings.redeemBahtPerUnit);
  }

  return {
    subtotal,
    tierDiscount: trimmed.tier,
    tierLabel: args.tier && trimmed.tier > 0
      ? `สมาชิก ${args.tier.name}${args.tier.discountType === "PERCENT" ? ` −${args.tier.discountValue}%` : ""}`
      : null,
    couponDiscount: trimmed.coupon,
    pointsDiscount: trimmed.points,
    pointsUsed,
    manualDiscount: trimmed.manual,
    totalDiscount: round2(trimmed.tier + trimmed.coupon + trimmed.points + trimmed.manual),
    netTotal: round2(subtotal - (trimmed.tier + trimmed.coupon + trimmed.points + trimmed.manual)),
    capped: raw > totalDiscount + 0.001,
    cappedAt,
  };
}

/** preview สำหรับจอ POS — คืนตัวเลขชุดเดียวกับที่ createOrder จะคิด */
export async function previewMemberDiscount(args: {
  tenantId: string;
  customerId: string | null;
  subtotal: number;
  pointsRequested?: number;
  couponDiscount?: number;
}): Promise<MemberDiscountBreakdown & { member: MemberSummary | null }> {
  const settings = await getLoyaltySettings(args.tenantId);
  const member = args.customerId ? await getMember(args.tenantId, args.customerId) : null;
  const breakdown = composeDiscounts({
    settings,
    subtotal: args.subtotal,
    tier: member?.tier ?? null,
    couponDiscount: args.couponDiscount,
    pointsRequested: args.pointsRequested,
    pointsAvailable: member?.pointsUsable ?? 0,
  });
  return { ...breakdown, member };
}

// ---------------------------------------------------------------
// ledger — ทุกตัวต้องอยู่ในทรานแซกชันของผู้เรียก
// ---------------------------------------------------------------

type LedgerKind = "EARN" | "REDEEM" | "REVERSE" | "EXPIRE" | "ADJUST";

/** ยอดคงเหลือ (SUM ทั้ง ledger) + แต้มที่ใช้ได้ พร้อมล็อกแถวลูกค้ากันแลกซ้อน */
async function lockMemberPointsInTx(
  client: PoolClient,
  tenantId: string,
  customerId: string
): Promise<{ balance: number; usable: number }> {
  const lock = await client.query<{ points_balance: number }>(
    `SELECT points_balance FROM bms_customers
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [tenantId, customerId]
  );
  if (!lock.rowCount) throw new Error("ไม่พบลูกค้าสำหรับคิดแต้ม");
  const usable = await client.query<{ usable: string }>(
    `SELECT COALESCE(SUM(points - consumed_points), 0) AS usable
       FROM bms_loyalty_ledger
      WHERE tenant_id = $1 AND customer_id = $2 AND points > 0
        AND (expires_at IS NULL OR expires_at > now())`,
    [tenantId, customerId]
  );
  return {
    balance: Number(lock.rows[0].points_balance ?? 0),
    usable: Math.max(0, Number(usable.rows[0]?.usable ?? 0)),
  };
}

/**
 * เขียน cache ยอดแต้มกลับลง bms_customers
 *
 * ⚠️ bms_customers มี revision trigger (7.1/7.6) ถ้าไม่ตั้ง app.skip_revision
 * ทุกบิลที่ให้แต้มจะ snapshot แถวลูกค้าทั้งแถวลง bms_customers_revisions
 * → ตาราง revision บวมตามจำนวนบิล และหน้า Revision History เต็มไปด้วย
 * การเปลี่ยนตัวเลขแต้ม ปนกับการแก้ข้อมูลลูกค้าจริง (เหมือนปัญหา
 * bms_coupons.redemptions_count ที่ 7.24 แก้ไว้ — ดู applyCouponInTx)
 * ยอดแต้มมี ledger เป็นประวัติของตัวเองอยู่แล้ว
 */
async function syncPointsBalanceInTx(client: PoolClient, tenantId: string, customerId: string): Promise<number> {
  await client.query("SELECT set_config('app.skip_revision', '1', true)");
  try {
    const res = await client.query<{ points_balance: number }>(
      `UPDATE bms_customers c
          SET points_balance = COALESCE((
                SELECT SUM(l.points) FROM bms_loyalty_ledger l
                 WHERE l.tenant_id = c.tenant_id AND l.customer_id = c.id
              ), 0),
              updated_at = now()
        WHERE c.tenant_id = $1 AND c.id = $2
        RETURNING c.points_balance`,
      [tenantId, customerId]
    );
    return Number(res.rows[0]?.points_balance ?? 0);
  } finally {
    await client.query("SELECT set_config('app.skip_revision', '', true)");
  }
}

/**
 * ตัดแต้มแบบ FIFO จากก้อนที่ยังใช้ได้ — ก้อนที่หมดอายุก่อนถูกใช้ก่อน
 * คืนจำนวนที่ตัดไม่ได้ (shortfall) ให้ผู้เรียกตัดสินใจ: การแลกต้องไม่เกิดถ้าไม่พอ
 * แต่การดึงแต้มคืนจากการคืนสินค้าเกิดได้เสมอแม้ยอดจะติดลบ
 */
async function consumeGrantsInTx(
  client: PoolClient,
  tenantId: string,
  customerId: string,
  points: number,
  opts: { onlyExpired?: boolean } = {}
): Promise<{ consumed: number; shortfall: number }> {
  let remaining = Math.max(0, Math.floor(points));
  if (remaining === 0) return { consumed: 0, shortfall: 0 };

  const grants = await client.query<{ id: string; open: number }>(
    `SELECT id, (points - consumed_points) AS open
       FROM bms_loyalty_ledger
      WHERE tenant_id = $1 AND customer_id = $2 AND points > consumed_points AND points > 0
        AND ${opts.onlyExpired ? "expires_at IS NOT NULL AND expires_at <= now()" : "(expires_at IS NULL OR expires_at > now())"}
      ORDER BY expires_at NULLS LAST, id
      FOR UPDATE`,
    [tenantId, customerId]
  );

  let consumed = 0;
  for (const grant of grants.rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(grant.open));
    if (take <= 0) continue;
    await client.query(
      `UPDATE bms_loyalty_ledger SET consumed_points = consumed_points + $3 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, grant.id, take]
    );
    remaining -= take;
    consumed += take;
  }
  return { consumed, shortfall: remaining };
}

async function insertLedgerInTx(
  client: PoolClient,
  tenantId: string,
  row: {
    customerId: string;
    kind: LedgerKind;
    points: number;
    orderId?: string | null;
    posReturnId?: string | null;
    expiresAt?: Date | null;
    consumedPoints?: number;
    actorUserId?: string | null;
    note?: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO bms_loyalty_ledger
       (tenant_id, customer_id, kind, points, order_id, pos_return_id, expires_at,
        consumed_points, actor_user_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [tenantId, row.customerId, row.kind, row.points, row.orderId ?? null, row.posReturnId ?? null,
      row.expiresAt ?? null, row.consumedPoints ?? 0, row.actorUserId ?? null, row.note ?? null]
  );
}

/**
 * แถวที่ให้แต้มต้องกลบยอดติดลบก่อน — ลูกค้าที่ยอดเป็น −50 จากการคืนสินค้า
 * ได้แต้มใหม่ 83 ต้องเหลือใช้ได้ 33 ไม่ใช่ 83
 */
function consumedToCoverDeficit(balanceBefore: number, granted: number): number {
  const deficit = Math.max(0, -balanceBefore);
  return Math.min(granted, deficit);
}

export type RedeemPointsResult =
  | { ok: true; pointsUsed: number; discount: number }
  | { ok: false; reason: string };

/**
 * แลกแต้มเป็นส่วนลดของบิลนี้ — เรียกใน tx ของ createOrder ก่อน INSERT order
 * ถ้าคืน ok: false ผู้เรียกต้อง ROLLBACK ทั้งบิล (เหมือน COUPON_INVALID)
 * ไม่มี "จองแต้ม" แยก: แต้มออกจากยอดทันทีที่บิลถูกสร้าง แล้วคืนกลับผ่าน
 * releasePointsForOrdersInTx() ตอนยกเลิกบิล — บิล PENDING ที่ค้างจึงไม่กินแต้มค้าง
 */
export async function redeemPointsInTx(
  client: PoolClient,
  args: {
    tenantId: string;
    customerId: string;
    orderId: string;
    points: number;
    discount: number;
    actorUserId?: string | null;
  }
): Promise<RedeemPointsResult> {
  const points = Math.floor(args.points);
  if (points <= 0) return { ok: true, pointsUsed: 0, discount: 0 };

  const settings = await getLoyaltySettingsInTx(client, args.tenantId);
  if (!settings.enabled) return { ok: false, reason: "ร้านนี้ปิดโปรแกรมสะสมแต้มอยู่" };
  if (points < settings.redeemMinPoints) {
    return { ok: false, reason: `ต้องแลกอย่างน้อย ${settings.redeemMinPoints} แต้ม` };
  }

  const { usable } = await lockMemberPointsInTx(client, args.tenantId, args.customerId);
  if (usable < points) return { ok: false, reason: `แต้มไม่พอ (ใช้ได้ ${usable} แต้ม)` };

  const taken = await consumeGrantsInTx(client, args.tenantId, args.customerId, points);
  if (taken.shortfall > 0) return { ok: false, reason: "แต้มไม่พอ (ถูกใช้ไปพร้อมกันจากอีกรายการ)" };

  await insertLedgerInTx(client, args.tenantId, {
    customerId: args.customerId,
    kind: "REDEEM",
    points: -points,
    orderId: args.orderId,
    actorUserId: args.actorUserId,
    note: `แลกแต้มเป็นส่วนลด ${args.discount.toFixed(2)} บาท`,
  });
  await syncPointsBalanceInTx(client, args.tenantId, args.customerId);
  return { ok: true, pointsUsed: points, discount: args.discount };
}

/**
 * ให้แต้มจากบิลที่ชำระเงินแล้ว — เรียกใน tx ของ finalizePosSale หลังบิลเป็น PAID
 * UNIQUE (tenant_id, order_id, 'EARN') กันแต้มซ้ำเมื่อเครื่องยิงคีย์เดิมซ้ำ
 * บิลที่ไม่ผูกลูกค้า/ร้านที่ปิดโปรแกรม → คืน 0 เงียบ ๆ (ไม่ throw ไม่ล้มการขาย)
 */
export async function earnPointsForOrderInTx(
  client: PoolClient,
  args: { tenantId: string; orderId: string; actorUserId?: string | null }
): Promise<{ points: number; customerId: string | null }> {
  const settings = await getLoyaltySettingsInTx(client, args.tenantId);
  if (!settings.enabled) return { points: 0, customerId: null };

  const ord = await client.query<{
    customer_id: string | null;
    total_amount: string;
    discount_amount: string | null;
    member_no: string | null;
  }>(
    `SELECT o.customer_id, o.total_amount, o.discount_amount, c.member_no
       FROM bms_orders o
       LEFT JOIN bms_customers c ON c.tenant_id = o.tenant_id AND c.id = o.customer_id
      WHERE o.tenant_id = $1 AND o.id = $2`,
    [args.tenantId, args.orderId]
  );
  const order = ord.rows[0];
  // ให้แต้มเฉพาะสมาชิก — ลูกค้าที่มี record แต่ไม่ได้สมัครไม่สะสม
  if (!order?.customer_id || !order.member_no) return { points: 0, customerId: null };

  const net = Number(order.total_amount);
  const base = settings.earnBase === "BEFORE_DISCOUNT"
    ? net + Number(order.discount_amount ?? 0)
    : net;
  if (base < settings.earnMinSpend) return { points: 0, customerId: order.customer_id };

  const points = settings.earnMode === "VISIT"
    ? settings.visitPoints
    : Math.floor(base * settings.earnPointsPerBaht);
  if (points <= 0) return { points: 0, customerId: order.customer_id };

  const dup = await client.query(
    `SELECT 1 FROM bms_loyalty_ledger
      WHERE tenant_id = $1 AND order_id = $2 AND kind = 'EARN' LIMIT 1`,
    [args.tenantId, args.orderId]
  );
  if (dup.rowCount) return { points: 0, customerId: order.customer_id };

  const { balance } = await lockMemberPointsInTx(client, args.tenantId, order.customer_id);
  const expiresAt = settings.pointsExpireMonths > 0
    ? new Date(Date.now() + settings.pointsExpireMonths * 30 * 24 * 60 * 60 * 1000)
    : null;

  await insertLedgerInTx(client, args.tenantId, {
    customerId: order.customer_id,
    kind: "EARN",
    points,
    orderId: args.orderId,
    expiresAt,
    consumedPoints: consumedToCoverDeficit(balance, points),
    actorUserId: args.actorUserId,
    note: settings.earnMode === "VISIT" ? "แต้มต่อการซื้อ 1 ครั้ง" : `แต้มจากยอด ${base.toFixed(2)} บาท`,
  });
  await syncPointsBalanceInTx(client, args.tenantId, order.customer_id);
  return { points, customerId: order.customer_id };
}

/**
 * คืนสินค้า → ดึงแต้มที่ได้จากบิลนั้นคืนตามสัดส่วน และคืนแต้มที่แลกไปให้ลูกค้า
 * ไม่ทำข้อนี้ = ซื้อแล้วคืนกลายเป็นวิธีปั๊มแต้มฟรี
 * ยอดหลังทำอาจติดลบ (ลูกค้าใช้แต้มไปแล้วก่อนคืนของ) — ตั้งใจให้ติดลบ
 */
export async function reversePointsForReturnInTx(
  client: PoolClient,
  args: {
    tenantId: string;
    orderId: string;
    posReturnId: string;
    /** ยอดที่คืนครั้งนี้ ÷ ยอดสุทธิของบิลเดิม (0–1) */
    ratio: number;
    actorUserId?: string | null;
  }
): Promise<{ earnedReversed: number; redeemedReturned: number; customerId: string | null }> {
  const ratio = Math.min(1, Math.max(0, args.ratio));
  if (!(ratio > 0)) return { earnedReversed: 0, redeemedReturned: 0, customerId: null };

  const ledger = await client.query<{ customer_id: string; kind: string; points: number; consumed_points: number }>(
    `SELECT customer_id, kind, points, consumed_points
       FROM bms_loyalty_ledger
      WHERE tenant_id = $1 AND order_id = $2 AND kind IN ('EARN','REDEEM')
      ORDER BY id
      FOR UPDATE`,
    [args.tenantId, args.orderId]
  );
  if (!ledger.rowCount) return { earnedReversed: 0, redeemedReturned: 0, customerId: null };
  const customerId = ledger.rows[0].customer_id;

  // REVERSE ของ return ก้อนนี้เคยทำแล้ว → ออก (partial return ยิงซ้ำด้วยคีย์เดิม)
  const dup = await client.query(
    `SELECT 1 FROM bms_loyalty_ledger
      WHERE tenant_id = $1 AND pos_return_id = $2 AND kind = 'REVERSE' LIMIT 1`,
    [args.tenantId, args.posReturnId]
  );
  if (dup.rowCount) return { earnedReversed: 0, redeemedReturned: 0, customerId };

  const earned = ledger.rows.filter((r) => r.kind === "EARN").reduce((s, r) => s + Number(r.points), 0);
  const redeemed = ledger.rows.filter((r) => r.kind === "REDEEM").reduce((s, r) => s - Number(r.points), 0);

  // ไม่ต้อง cap ยอดสะสมเอง: ratio ของแต่ละครั้ง = ยอดคืนครั้งนั้น ÷ ยอดสุทธิบิล
  // และ processPosReturn บังคับให้ผลรวมยอดคืนทุกครั้งไม่เกินยอดที่จ่ายมา
  // (remainingRefund ต้องเป็น 0 เสมอ) → ผลรวม ratio ทุกครั้ง ≤ 1 อยู่แล้ว
  const earnToReverse = Math.round(earned * ratio);
  const pointsBack = Math.round(redeemed * ratio);
  const net = pointsBack - earnToReverse;

  if (net === 0) {
    // ไม่มีอะไรขยับ แต่ต้องบันทึกว่าเคยประมวลผล return นี้แล้ว ไม่งั้นยิงซ้ำจะคิดใหม่
    // ใช้ ADJUST 0 ไม่ได้ (CHECK points <> 0) → ข้ามไปโดยไม่บันทึก แล้วพึ่ง
    // idempotency ของ bms_pos_returns ที่ชั้นบนแทน
    return { earnedReversed: 0, redeemedReturned: 0, customerId };
  }

  const { balance } = await lockMemberPointsInTx(client, args.tenantId, customerId);
  if (net < 0) {
    // ดึงแต้มคืนมากกว่าที่คืนให้ — ตัดจากก้อนที่ยังใช้ได้เท่าที่มี ส่วนที่เหลือทำให้ยอดติดลบ
    await consumeGrantsInTx(client, args.tenantId, customerId, -net);
  }
  await insertLedgerInTx(client, args.tenantId, {
    customerId,
    kind: "REVERSE",
    points: net,
    orderId: args.orderId,
    posReturnId: args.posReturnId,
    consumedPoints: net > 0 ? consumedToCoverDeficit(balance, net) : 0,
    actorUserId: args.actorUserId,
    note: `คืนสินค้า ${(ratio * 100).toFixed(0)}% ของบิล — ดึงคืน ${earnToReverse} แต้ม, คืนให้ ${pointsBack} แต้ม`,
  });
  await syncPointsBalanceInTx(client, args.tenantId, customerId);
  return { earnedReversed: earnToReverse, redeemedReturned: pointsBack, customerId };
}

/**
 * ยกเลิกบิล → คืนแต้มที่แลกไปทั้งหมด และดึงแต้มที่ได้คืน (ถ้าบิลนั้นเคยจ่ายแล้ว)
 * เรียกจาก cancelOrder() ในทรานแซกชันเดียวกัน คู่กับ releaseCouponForOrdersInTx
 */
export async function releasePointsForOrdersInTx(
  client: PoolClient,
  tenantId: string,
  orderIds: string[],
  reason = "ยกเลิกบิล"
): Promise<void> {
  if (orderIds.length === 0) return;
  const ledger = await client.query<{ order_id: string; customer_id: string; kind: string; points: number }>(
    `SELECT order_id, customer_id, kind, points
       FROM bms_loyalty_ledger
      WHERE tenant_id = $1 AND order_id = ANY($2::uuid[]) AND kind IN ('EARN','REDEEM')
      ORDER BY id
      FOR UPDATE`,
    [tenantId, orderIds]
  );
  if (!ledger.rowCount) return;

  const byOrder = new Map<string, { customerId: string; net: number }>();
  for (const row of ledger.rows) {
    const cur = byOrder.get(row.order_id) ?? { customerId: row.customer_id, net: 0 };
    // กลับทิศทุกแถว: REDEEM (−) กลายเป็นคืนให้ (+) และ EARN (+) กลายเป็นดึงคืน (−)
    cur.net -= Number(row.points);
    byOrder.set(row.order_id, cur);
  }

  for (const [orderId, entry] of byOrder) {
    // REVERSE ที่มาจากการยกเลิก/คืนทั้งบิลคือแถวที่ไม่ผูก pos_return_id
    // (partial return ของ POS ผูก pos_return_id ทุกแถว) — เช็คด้วยคอลัมน์จริง
    // ไม่ใช่ข้อความใน note ซึ่งเปลี่ยนคำแล้วการกันซ้ำจะพังเงียบ ๆ
    const done = await client.query(
      `SELECT 1 FROM bms_loyalty_ledger
        WHERE tenant_id = $1 AND order_id = $2 AND kind = 'REVERSE'
          AND pos_return_id IS NULL LIMIT 1`,
      [tenantId, orderId]
    );
    if (done.rowCount || entry.net === 0) continue;

    const { balance } = await lockMemberPointsInTx(client, tenantId, entry.customerId);
    if (entry.net < 0) {
      await consumeGrantsInTx(client, tenantId, entry.customerId, -entry.net);
    }
    await insertLedgerInTx(client, tenantId, {
      customerId: entry.customerId,
      kind: "REVERSE",
      points: entry.net,
      orderId,
      consumedPoints: entry.net > 0 ? consumedToCoverDeficit(balance, entry.net) : 0,
      note: `${reason} — คืนแต้มที่แลก / ดึงแต้มที่ได้กลับ`,
    });
    await syncPointsBalanceInTx(client, tenantId, entry.customerId);
  }
}

/** บันทึกรายละเอียดส่วนลดของบิล — ยอดรวมยังอยู่ที่ bms_orders.discount_amount */
export async function recordOrderDiscountsInTx(
  client: PoolClient,
  tenantId: string,
  orderId: string,
  rows: Array<{ source: "TIER" | "COUPON" | "POINTS" | "MANUAL"; refId?: string | null; label: string; amount: number; pointsUsed?: number }>
): Promise<void> {
  for (const row of rows) {
    if (!(row.amount > 0)) continue;
    await client.query(
      `INSERT INTO bms_order_discounts (tenant_id, order_id, source, ref_id, label, amount, points_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (order_id, source) DO NOTHING`,
      [tenantId, orderId, row.source, row.refId ?? null, row.label, row.amount, row.pointsUsed ?? 0]
    );
  }
}

export type OrderDiscountLine = {
  source: "TIER" | "COUPON" | "POINTS" | "MANUAL";
  label: string;
  amount: number;
  pointsUsed: number;
};

/** ใบเสร็จ/หน้าออร์เดอร์ใช้ตัวนี้แสดงส่วนลดแยกบรรทัด */
export async function listOrderDiscounts(tenantId: string, orderId: string): Promise<OrderDiscountLine[]> {
  const res = await query(
    `SELECT source, label, amount, points_used FROM bms_order_discounts
      WHERE tenant_id = $1 AND order_id = $2 ORDER BY id`,
    [tenantId, orderId]
  );
  return res.rows.map((r: any) => ({
    source: r.source,
    label: r.label,
    amount: Number(r.amount),
    pointsUsed: Number(r.points_used ?? 0),
  }));
}

// ---------------------------------------------------------------
// ปรับแต้มด้วยมือ / ประวัติ / รายงาน
// ---------------------------------------------------------------

export type LoyaltyLedgerEntry = {
  id: string;
  kind: LedgerKind;
  points: number;
  orderId: string | null;
  posReturnId: string | null;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
};

export async function listLoyaltyLedger(
  tenantId: string,
  customerId: string,
  limit = 100
): Promise<LoyaltyLedgerEntry[]> {
  const res = await query(
    `SELECT id, kind, points, order_id, pos_return_id, expires_at, note, created_at
       FROM bms_loyalty_ledger
      WHERE tenant_id = $1 AND customer_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [tenantId, customerId, Math.min(Math.max(limit, 1), 500)]
  );
  // Date จาก pg ต้อง toISOString() ก่อนคืนใน field ที่เป็น String! (ไม่งั้น frontend ได้ epoch)
  return res.rows.map((r: any) => ({
    id: String(r.id),
    kind: r.kind,
    points: Number(r.points),
    orderId: r.order_id ?? null,
    posReturnId: r.pos_return_id ?? null,
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    note: r.note ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** ปรับแต้มด้วยมือ — ต้องมีเหตุผลเสมอ (ไม่มีเหตุผล = ตรวจสอบย้อนหลังไม่ได้) */
export async function adjustPoints(args: {
  tenantId: string;
  customerId: string;
  points: number;
  note: string;
  actorUserId?: string | null;
}): Promise<{ balance: number }> {
  const points = Math.trunc(args.points);
  if (points === 0) throw new Error("จำนวนแต้มต้องไม่เป็น 0");
  const note = args.note.trim();
  if (!note) throw new Error("ต้องระบุเหตุผลของการปรับแต้ม");

  const client = await getClient();
  try {
    await beginTenantTx(client, args.tenantId, { editorId: args.actorUserId });
    const { balance } = await lockMemberPointsInTx(client, args.tenantId, args.customerId);
    const settings = await getLoyaltySettingsInTx(client, args.tenantId);

    if (points < 0) {
      await consumeGrantsInTx(client, args.tenantId, args.customerId, -points);
    }
    await insertLedgerInTx(client, args.tenantId, {
      customerId: args.customerId,
      kind: "ADJUST",
      points,
      expiresAt: points > 0 && settings.pointsExpireMonths > 0
        ? new Date(Date.now() + settings.pointsExpireMonths * 30 * 24 * 60 * 60 * 1000)
        : null,
      consumedPoints: points > 0 ? consumedToCoverDeficit(balance, points) : 0,
      actorUserId: args.actorUserId,
      note,
    });
    const next = await syncPointsBalanceInTx(client, args.tenantId, args.customerId);
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'loyalty.adjust', $3, $4)`,
      [args.tenantId, args.actorUserId ?? "system", args.customerId,
        JSON.stringify({ points, note, balanceAfter: next })]
    );
    await client.query("COMMIT");
    return { balance: next };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ตัดแต้มหมดอายุ — idempotent รันซ้ำได้ (ก้อนที่ consume ครบแล้วไม่ถูกนับอีก)
 * ยังไม่มี cron จริงในระบบนี้ ต้องยิงมือหรือผูก scheduler เพิ่ม
 */
export async function expireLoyaltyPoints(tenantId: string): Promise<{ customers: number; points: number }> {
  const settings = await getLoyaltySettings(tenantId);
  if (settings.pointsExpireMonths === 0) return { customers: 0, points: 0 };

  const due = await query<{ customer_id: string; expired: string }>(
    `SELECT customer_id, SUM(points - consumed_points) AS expired
       FROM bms_loyalty_ledger
      WHERE tenant_id = $1 AND points > consumed_points AND points > 0
        AND expires_at IS NOT NULL AND expires_at <= now()
      GROUP BY customer_id
      HAVING SUM(points - consumed_points) > 0`,
    [tenantId]
  );

  let customers = 0;
  let totalPoints = 0;
  for (const row of due.rows) {
    const points = Number(row.expired);
    if (points <= 0) continue;
    const client = await getClient();
    try {
      await beginTenantTx(client, tenantId);
      const taken = await consumeGrantsInTx(client, tenantId, row.customer_id, points, { onlyExpired: true });
      if (taken.consumed > 0) {
        await insertLedgerInTx(client, tenantId, {
          customerId: row.customer_id,
          kind: "EXPIRE",
          points: -taken.consumed,
          note: `แต้มหมดอายุ ${taken.consumed} แต้ม`,
        });
        await syncPointsBalanceInTx(client, tenantId, row.customer_id);
        customers += 1;
        totalPoints += taken.consumed;
      }
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[loyalty] ตัดแต้มหมดอายุไม่สำเร็จ", row.customer_id, err);
    } finally {
      client.release();
    }
  }
  return { customers, points: totalPoints };
}

/**
 * ทบทวนชั้นสมาชิก — ยอดซื้อ 12 เดือน (บิลที่ไม่ถูกยกเลิก/คืน) หรือแต้มสะสมตลอดชีพ
 * ถึงเกณฑ์ชั้นไหนก็ได้ชั้นนั้น เลือกชั้นสูงสุดที่ผ่านเกณฑ์
 */
export async function reviewMemberTier(
  tenantId: string,
  customerId: string
): Promise<{ changed: boolean; tier: MembershipTier | null }> {
  const tiers = await listMembershipTiers(tenantId, true);
  if (tiers.length === 0) return { changed: false, tier: null };

  // ลูกค้าที่ไม่ได้สมัครสมาชิกไม่มีชั้น — POS เรียกตัวนี้ด้วย customerId ของบิล
  // ซึ่งอาจเป็นลูกค้าธรรมดา (ผูกบิลไว้แต่ไม่ได้เป็นสมาชิก) ต้องไม่ไปตั้ง tier ให้
  const isMember = await query<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM bms_customers
      WHERE tenant_id = $1 AND id = $2 AND member_no IS NOT NULL AND deleted_at IS NULL`,
    [tenantId, customerId]
  );
  if (!isMember.rowCount) return { changed: false, tier: null };

  const stats = await query<{ spend_12m: string; lifetime_points: string; tier_id: string | null }>(
    `SELECT
       COALESCE((
         SELECT SUM(o.total_amount) FROM bms_orders o
          WHERE o.tenant_id = $1 AND o.customer_id = $2
            AND o.status NOT IN ('CANCELLED','RETURNED')
            AND o.created_at > now() - interval '12 months'
       ), 0) AS spend_12m,
       COALESCE((
         SELECT SUM(l.points) FROM bms_loyalty_ledger l
          WHERE l.tenant_id = $1 AND l.customer_id = $2 AND l.points > 0
       ), 0) AS lifetime_points,
       (SELECT tier_id FROM bms_customers WHERE tenant_id = $1 AND id = $2) AS tier_id`,
    [tenantId, customerId]
  );
  const spend = Number(stats.rows[0]?.spend_12m ?? 0);
  const lifetime = Number(stats.rows[0]?.lifetime_points ?? 0);
  const currentTierId = stats.rows[0]?.tier_id ?? null;

  const eligible = tiers
    .filter((t) => spend >= t.qualifySpend12m || (t.qualifyPoints > 0 && lifetime >= t.qualifyPoints))
    .sort((a, b) => b.sortOrder - a.sortOrder);
  const target = eligible[0] ?? tiers[0];
  const changed = currentTierId !== target.id;

  // ทบทวนแล้วชั้นเท่าเดิม = แตะแค่ tier_reviewed_at และต้องไม่เขียน revision
  // (cron วนทุกคนทุกเดือน ถ้าไม่ข้ามจะได้ revision ต่อสมาชิกต่อรอบ)
  // ชั้นเปลี่ยนจริงยังเขียน revision ตามปกติ เพราะกระทบส่วนลดที่ลูกค้าได้
  //
  // ต้องอยู่ในทรานแซกชันเดียวกับ set_config(..., is_local = true) — ถ้ายิงผ่าน
  // query() สองครั้ง แต่ละครั้งอาจได้ connection ต่างกันแล้ว flag ไม่มีผล
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    if (!changed) {
      await client.query("SELECT set_config('app.skip_revision', '1', true)");
      await client.query(
        `UPDATE bms_customers SET tier_reviewed_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, customerId]
      );
      await client.query("SELECT set_config('app.skip_revision', '', true)");
    } else {
      await client.query(
        `UPDATE bms_customers SET tier_id = $3, tier_reviewed_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, customerId, target.id]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
  return { changed, tier: target };
}

export async function reviewAllMemberTiers(tenantId: string): Promise<{ reviewed: number; changed: number }> {
  const members = await query<{ id: string }>(
    `SELECT id FROM bms_customers
      WHERE tenant_id = $1 AND member_no IS NOT NULL AND deleted_at IS NULL`,
    [tenantId]
  );
  let changed = 0;
  for (const row of members.rows) {
    try {
      const res = await reviewMemberTier(tenantId, row.id);
      if (res.changed) changed += 1;
    } catch (e) {
      console.error("[loyalty] ทบทวนชั้นสมาชิกไม่สำเร็จ", row.id, e);
    }
  }
  return { reviewed: members.rowCount ?? 0, changed };
}

/**
 * cron: วนทุกร้านที่เปิดโปรแกรมและตั้งอายุแต้มไว้
 * ร้านที่ล้มไม่หยุดร้านอื่น — งานนี้ต้องเดินให้จบทุกคืน
 */
export async function expireLoyaltyPointsAllTenants(): Promise<{ tenants: number; customers: number; points: number }> {
  const tenants = await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM bms_loyalty_settings WHERE enabled AND points_expire_months > 0`
  );
  let customers = 0;
  let points = 0;
  for (const row of tenants.rows) {
    try {
      const res = await expireLoyaltyPoints(row.tenant_id);
      customers += res.customers;
      points += res.points;
    } catch (e) {
      console.error("[loyalty] ตัดแต้มหมดอายุของร้านไม่สำเร็จ", row.tenant_id, e);
    }
  }
  return { tenants: tenants.rowCount ?? 0, customers, points };
}

/** cron: ทบทวนชั้นสมาชิกทุกร้านที่เปิดโปรแกรม */
export async function reviewMemberTiersAllTenants(): Promise<{ tenants: number; reviewed: number; changed: number }> {
  const tenants = await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM bms_loyalty_settings WHERE enabled`
  );
  let reviewed = 0;
  let changed = 0;
  for (const row of tenants.rows) {
    try {
      const res = await reviewAllMemberTiers(row.tenant_id);
      reviewed += res.reviewed;
      changed += res.changed;
    } catch (e) {
      console.error("[loyalty] ทบทวนชั้นสมาชิกของร้านไม่สำเร็จ", row.tenant_id, e);
    }
  }
  return { tenants: tenants.rowCount ?? 0, reviewed, changed };
}

export type LoyaltyOutstandingReport = {
  members: number;
  /** แต้มที่ยังใช้ได้ทั้งร้าน = ภาระผูกพัน (IFRS 15: deferred revenue) */
  outstandingPoints: number;
  /** มูลค่าเป็นบาทตามอัตราแลกปัจจุบัน */
  outstandingValue: number;
  expiringIn30Days: number;
  /** ผลรวม cache ที่ไม่ตรงกับ ledger — ต้องเป็น 0 เสมอ */
  balanceMismatchCount: number;
};

export async function loyaltyOutstandingReport(tenantId: string): Promise<LoyaltyOutstandingReport> {
  const settings = await getLoyaltySettings(tenantId);
  const res = await query<{
    members: string; outstanding: string; expiring: string; mismatch: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM bms_customers
         WHERE tenant_id = $1 AND member_no IS NOT NULL AND deleted_at IS NULL) AS members,
       COALESCE((SELECT SUM(points - consumed_points) FROM bms_loyalty_ledger
         WHERE tenant_id = $1 AND points > 0
           AND (expires_at IS NULL OR expires_at > now())), 0) AS outstanding,
       COALESCE((SELECT SUM(points - consumed_points) FROM bms_loyalty_ledger
         WHERE tenant_id = $1 AND points > 0
           AND expires_at IS NOT NULL
           AND expires_at > now() AND expires_at <= now() + interval '30 days'), 0) AS expiring,
       (SELECT COUNT(*) FROM bms_customers c
         WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
           AND c.points_balance <> COALESCE((
             SELECT SUM(l.points) FROM bms_loyalty_ledger l
              WHERE l.tenant_id = c.tenant_id AND l.customer_id = c.id), 0)) AS mismatch`,
    [tenantId]
  );
  const r = res.rows[0];
  const outstanding = Number(r?.outstanding ?? 0);
  return {
    members: Number(r?.members ?? 0),
    outstandingPoints: outstanding,
    outstandingValue: round2((outstanding / settings.redeemPointsPerUnit) * settings.redeemBahtPerUnit),
    expiringIn30Days: Number(r?.expiring ?? 0),
    balanceMismatchCount: Number(r?.mismatch ?? 0),
  };
}
