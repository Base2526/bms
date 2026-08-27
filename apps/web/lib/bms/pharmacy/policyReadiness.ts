// =============================================================
// Pharmacy product-policy readiness
// -------------------------------------------------------------
// createOrder() blocks any SKU whose policy row is missing or not yet
// APPROVED (PHARMACY_POLICY_UNKNOWN — see productPolicyDecision.ts). That is
// the correct behaviour, but it is discovered at the worst possible moment:
// mid-sale, with a customer at the counter and an error string the cashier
// cannot act on.
//
// The pilot shop chose "review every SKU before opening", so the gate belongs
// at shift-open, not at checkout. This module answers two questions:
//   1. how far along is the review?          → getPharmacyPolicyReadiness()
//   2. may this shop open a till right now?  → assertPharmacyPolicyReadyToOpenShift()
//
// 9.29 made that shift-open block opt-in. An unreviewed SKU no longer dead-ends
// mid-queue: it asks for a licensed pharmacist's PIN at the register, the way an
// ordinary pharmacy already works. Blocking the whole till is therefore a choice
// a shop makes, not the only way to avoid selling something unreviewed.
//
// Nothing here decides whether a product may be sold — evaluatePharmacySale()
// remains the single gate for that, unchanged.
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "../tenant";

export type PharmacyPolicyReadiness = {
  /** false → this shop is not a pharmacy; every count is 0 and ready is true. */
  pharmacyArchetype: boolean;
  /** Active products only — retired SKUs cannot reach a till. */
  totalProducts: number;
  approved: number;
  pendingReview: number;
  draft: number;
  /** Active products with no policy row at all. */
  missing: number;
  /** approved === totalProducts */
  ready: boolean;
  /** 9.29 — เภสัชกรกด PIN อนุมัติจ่ายยาที่เครื่องขายได้ */
  counterAuthorization: boolean;
  /** 9.29 — TRUE = เปิดกะไม่ได้ถ้ายังรีวิว policy ไม่ครบ (พฤติกรรมเดิม) */
  blockShiftOnUnreviewed: boolean;
};

export type UnreviewedProduct = {
  sku: string;
  name: string;
  /** MISSING when no policy row exists yet. */
  policyStatus: "MISSING" | "DRAFT" | "PENDING_REVIEW" | "RETIRED";
};

export async function getPharmacyPolicyReadiness(tenantId: string): Promise<PharmacyPolicyReadiness> {
  // อ่าน archetype ก่อน แล้วค่อยอ่านคอลัมน์ของ 9.29 เฉพาะร้านยา — ร้านที่ไม่ใช่ร้านยา
  // เปิดหน้าความพร้อม/เปิดกะได้ตามปกติแม้ฐานยังไม่ได้ apply 9.29 (ร้านยาจะได้ error
  // ดัง ๆ ซึ่งถูกต้อง: ฟีเจอร์ของมันต้องมีคอลัมน์นั้นจริง)
  const archetype = await query<{ business_archetype: string | null }>(
    `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  if (archetype.rows[0]?.business_archetype !== "pharmacy") {
    return {
      pharmacyArchetype: false,
      totalProducts: 0,
      approved: 0,
      pendingReview: 0,
      draft: 0,
      missing: 0,
      ready: true,
      counterAuthorization: true,
      blockShiftOnUnreviewed: false,
    };
  }

  const settings = await query<{ counter: boolean | null; blocks: boolean | null }>(
    `SELECT pharmacy_counter_authorization AS counter,
            pharmacy_block_shift_on_unreviewed_policy AS blocks
       FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  const counterAuthorization = settings.rows[0]?.counter !== false;
  const blockShiftOnUnreviewed = settings.rows[0]?.blocks === true;

  const res = await query<{
    total: string;
    approved: string;
    pending_review: string;
    draft: string;
    missing: string;
  }>(
    `SELECT count(*)                                                          AS total,
            count(*) FILTER (WHERE pol.status = 'APPROVED')                   AS approved,
            count(*) FILTER (WHERE pol.status = 'PENDING_REVIEW')             AS pending_review,
            count(*) FILTER (WHERE pol.status IN ('DRAFT', 'RETIRED'))        AS draft,
            count(*) FILTER (WHERE pol.status IS NULL)                        AS missing
       FROM bms_products p
       LEFT JOIN bms_pharmacy_product_policies pol
         ON pol.tenant_id = p.tenant_id AND pol.product_sku = p.sku
      WHERE p.tenant_id = $1 AND p.active`,
    [tenantId]
  );

  const row = res.rows[0];
  const totalProducts = Number(row?.total ?? 0);
  const approved = Number(row?.approved ?? 0);

  return {
    pharmacyArchetype: true,
    totalProducts,
    approved,
    pendingReview: Number(row?.pending_review ?? 0),
    draft: Number(row?.draft ?? 0),
    missing: Number(row?.missing ?? 0),
    ready: totalProducts === approved,
    counterAuthorization,
    blockShiftOnUnreviewed,
  };
}

/**
 * Worklist for the pharmacist review screen. Missing rows come first: they are
 * the ones that have never been looked at, and they block a sale outright.
 */
export async function listProductsNeedingPolicyReview(
  tenantId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<UnreviewedProduct[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const res = await query<{ sku: string; name: string; status: string | null }>(
    `SELECT p.sku, p.name, pol.status
       FROM bms_products p
       LEFT JOIN bms_pharmacy_product_policies pol
         ON pol.tenant_id = p.tenant_id AND pol.product_sku = p.sku
      WHERE p.tenant_id = $1 AND p.active
        AND (pol.status IS NULL OR pol.status <> 'APPROVED')
      ORDER BY (pol.status IS NOT NULL), p.name
      LIMIT $2 OFFSET $3`,
    [tenantId, limit, offset]
  );

  return res.rows.map((r) => ({
    sku: r.sku,
    name: r.name,
    policyStatus: (r.status ?? "MISSING") as UnreviewedProduct["policyStatus"],
  }));
}

/**
 * Call before opening a till. Throws with a countable reason so the message can
 * be shown to whoever is standing at the shop door, not buried in a log.
 * Non-pharmacy shops pass straight through.
 */
export async function assertPharmacyPolicyReadyToOpenShift(tenantId: string): Promise<void> {
  const readiness = await getPharmacyPolicyReadiness(tenantId);
  if (readiness.ready) return;

  // Opt-in since 9.29 (see the header). The readiness numbers are still reported
  // either way — a shop should watch its review backlog shrink even when the till
  // opens regardless.
  if (!readiness.blockShiftOnUnreviewed) return;

  const outstanding = readiness.totalProducts - readiness.approved;
  throw new Error(
    `เปิดกะไม่ได้: ยังมีสินค้า ${outstanding} จาก ${readiness.totalProducts} รายการที่เภสัชกรยังไม่ได้อนุมัตินโยบายการขาย ` +
      `(ยังไม่เริ่ม ${readiness.missing} · ร่าง ${readiness.draft} · รอตรวจ ${readiness.pendingReview}) ` +
      `— ถ้าเปิดขายตอนนี้ สินค้าเหล่านี้จะขายไม่ได้กลางคิวลูกค้า`
  );
}

/**
 * ตั้งค่าการอนุมัติที่เคาน์เตอร์ของร้าน (9.29)
 *
 * ส่งเฉพาะค่าที่ต้องการเปลี่ยน — ไม่ส่ง = ไม่แตะ (กฎเดียวกับ `vat_category` ใน
 * `upsertProduct`) เพื่อไม่ให้ฟอร์มที่รู้จักฟิลด์เดียวไปล้างอีกฟิลด์เป็นค่าปริยาย
 *
 * สองค่านี้ตอบว่า "ใครปล่อยยาออกจากร้านได้บ้าง" จึงเขียน audit **ในทรานแซกชันเดียวกับ
 * การเขียน** ไม่ใช่ยิงต่อท้ายจาก resolver (กฎเดียวกับ setCashierPin หลัง 9.5) — ค่าที่
 * เปลี่ยนแล้วไม่มีร่องรอยว่าใครเปลี่ยนคือช่องที่อธิบายย้อนหลังไม่ได้
 *
 * และปฏิเสธถ้าร้านไม่ได้ตั้งประเภทเป็นร้านขายยา: คอลัมน์ของ 9.29 ไม่มีความหมายกับร้าน
 * อื่นเลย การยอมให้ตั้งได้เท่ากับเก็บค่าที่ไม่มีใครอ่านแล้วดูเหมือนมีผล
 */
export async function setPharmacyCounterSettings(
  tenantId: string,
  input: { counterAuthorization?: boolean | null; blockShiftOnUnreviewed?: boolean | null },
  actor?: string | null
): Promise<PharmacyPolicyReadiness> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const profile = await client.query<{ business_archetype: string | null }>(
      `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1 FOR UPDATE`,
      [tenantId]
    );
    if (profile.rows[0]?.business_archetype !== "pharmacy") {
      await client.query("ROLLBACK");
      throw new Error("ตั้งค่านี้ได้เฉพาะร้านที่ตั้งประเภทธุรกิจเป็นร้านขายยา");
    }
    // ร้านยาต้องมีแถวโปรไฟล์อยู่แล้ว (archetype อยู่ในแถวนั้น) จึงเป็น UPDATE ล้วน
    const updated = await client.query<{ counter: boolean; blocks: boolean }>(
      `UPDATE bms_store_profile
          SET pharmacy_counter_authorization =
                COALESCE($2, pharmacy_counter_authorization),
              pharmacy_block_shift_on_unreviewed_policy =
                COALESCE($3, pharmacy_block_shift_on_unreviewed_policy),
              updated_at = now()
        WHERE tenant_id = $1
        RETURNING pharmacy_counter_authorization AS counter,
                  pharmacy_block_shift_on_unreviewed_policy AS blocks`,
      [tenantId, input.counterAuthorization ?? null, input.blockShiftOnUnreviewed ?? null]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'pharmacy.counter_settings_set', $1::text, $3::jsonb)`,
      [tenantId, actor || "system", JSON.stringify({
        counterAuthorization: updated.rows[0]?.counter ?? null,
        blockShiftOnUnreviewed: updated.rows[0]?.blocks ?? null,
      })]
    );
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
  return getPharmacyPolicyReadiness(tenantId);
}
