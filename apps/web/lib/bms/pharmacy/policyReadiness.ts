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
// Nothing here decides whether a product may be sold — evaluatePharmacySale()
// remains the single gate for that, unchanged.
// =============================================================

import { query } from "@/lib/db";

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
};

export type UnreviewedProduct = {
  sku: string;
  name: string;
  /** MISSING when no policy row exists yet. */
  policyStatus: "MISSING" | "DRAFT" | "PENDING_REVIEW" | "RETIRED";
};

async function isPharmacyTenant(tenantId: string): Promise<boolean> {
  const res = await query<{ business_archetype: string | null }>(
    `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  return res.rows[0]?.business_archetype === "pharmacy";
}

export async function getPharmacyPolicyReadiness(tenantId: string): Promise<PharmacyPolicyReadiness> {
  const pharmacyArchetype = await isPharmacyTenant(tenantId);
  if (!pharmacyArchetype) {
    return {
      pharmacyArchetype: false,
      totalProducts: 0,
      approved: 0,
      pendingReview: 0,
      draft: 0,
      missing: 0,
      ready: true,
    };
  }

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

  const outstanding = readiness.totalProducts - readiness.approved;
  throw new Error(
    `เปิดกะไม่ได้: ยังมีสินค้า ${outstanding} จาก ${readiness.totalProducts} รายการที่เภสัชกรยังไม่ได้อนุมัตินโยบายการขาย ` +
      `(ยังไม่เริ่ม ${readiness.missing} · ร่าง ${readiness.draft} · รอตรวจ ${readiness.pendingReview}) ` +
      `— ถ้าเปิดขายตอนนี้ สินค้าเหล่านี้จะขายไม่ได้กลางคิวลูกค้า`
  );
}
