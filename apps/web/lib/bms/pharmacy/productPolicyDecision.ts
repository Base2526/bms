export const PHARMACY_PRODUCT_TYPES = [
  "UNKNOWN", "GENERAL_PRODUCT", "MEDICAL_SUPPLY", "MEDICAL_DEVICE", "HOUSEHOLD_REMEDY", "DRUG",
] as const;

export const PHARMACY_SALE_POLICIES = [
  "DIRECT_SALE", "SHORT_SAFETY_CHECK", "PHARMACIST_APPROVAL",
  "PRESCRIPTION_REQUIRED", "ONLINE_SALE_PROHIBITED",
] as const;

export type PharmacyProductType = (typeof PHARMACY_PRODUCT_TYPES)[number];
export type PharmacySalePolicy = (typeof PHARMACY_SALE_POLICIES)[number];
export type PharmacyProductPolicyStatus = "MISSING" | "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "RETIRED";

export type PharmacySaleBlockStatus =
  | "PHARMACY_POLICY_UNKNOWN"
  | "PHARMACY_SAFETY_CHECK_REQUIRED"
  | "PHARMACY_REVIEW_REQUIRED"
  | "PHARMACY_PRESCRIPTION_REQUIRED"
  | "PHARMACY_ONLINE_SALE_PROHIBITED"
  | "PHARMACY_QUANTITY_LIMIT_EXCEEDED";

export type PharmacySaleBlocker = {
  status: PharmacySaleBlockStatus;
  sku: string;
  salePolicy: PharmacySalePolicy | "UNKNOWN";
  maxQuantity?: number;
  requested?: number;
};

export type PharmacySaleDecision =
  | { allowed: true }
  | (PharmacySaleBlocker & {
      allowed: false;
      /**
       * EVERY sku that failed, in basket order. `status`/`sku`/`salePolicy` on
       * the decision itself stay equal to blockers[0] so existing callers and
       * customer-facing messages are byte-identical to before.
       *
       * Why report all of them: the basket is rejected as a whole either way,
       * so returning only the first offender made a customer with two flagged
       * items discover them one round-trip at a time.
       */
      blockers: PharmacySaleBlocker[];
    });

export type PharmacyPolicyForDecision = {
  productSku: string;
  salePolicy: PharmacySalePolicy;
  status: PharmacyProductPolicyStatus;
  maxQuantity: number | null;
};

/**
 * Which surface the basket is being sold on.
 *
 * Only ONLINE_SALE_PROHIBITED reads it, and only to stop over-blocking: the
 * classification says a product may not be sold *online*, and it never said a
 * pharmacist may not hand it over at the counter. The default stays "online"
 * so any caller that has not been taught about channels keeps the strict
 * behaviour rather than silently gaining a counter exemption.
 */
export type PharmacySaleChannel = "online" | "counter";

export function evaluatePharmacySale(
  items: Array<{ sku: string; qty: number }>,
  policies: PharmacyPolicyForDecision[],
  approvedAssessmentSkus: ReadonlySet<string> = new Set(),
  channel: PharmacySaleChannel = "online"
): PharmacySaleDecision {
  const bySku = new Map(policies.map((policy) => [policy.productSku, policy]));
  const quantityBySku = new Map<string, number>();
  for (const item of items) quantityBySku.set(item.sku, (quantityBySku.get(item.sku) ?? 0) + item.qty);

  // Collect every offender instead of returning at the first one. This is a
  // REPORTING change only — the basket is still rejected as a whole, and any
  // sku without an APPROVED policy row still blocks. Never turn this into
  // "let the clean items through": the caller reserves stock and takes money
  // for the whole order in one transaction.
  const blockers: PharmacySaleBlocker[] = [];
  for (const [sku, qty] of quantityBySku) {
    const policy = bySku.get(sku);
    if (!policy || policy.status !== "APPROVED") {
      blockers.push({ status: "PHARMACY_POLICY_UNKNOWN", sku, salePolicy: "UNKNOWN" });
      continue;
    }
    if (policy.maxQuantity != null && qty > policy.maxQuantity) {
      blockers.push({
        status: "PHARMACY_QUANTITY_LIMIT_EXCEEDED",
        sku,
        salePolicy: policy.salePolicy,
        maxQuantity: policy.maxQuantity,
        requested: qty,
      });
      continue;
    }
    if (policy.salePolicy === "DIRECT_SALE") continue;
    if (
      (policy.salePolicy === "PHARMACIST_APPROVAL" ||
        policy.salePolicy === "SHORT_SAFETY_CHECK" ||
        // Counter-only: the fall-through below turns this policy into
        // "needs a pharmacist", so its approval has to clear it here too or the
        // case would be approved and the sale still refused, forever.
        (policy.salePolicy === "ONLINE_SALE_PROHIBITED" && channel === "counter")) &&
      approvedAssessmentSkus.has(sku)
    ) continue;
    if (policy.salePolicy === "SHORT_SAFETY_CHECK") {
      blockers.push({ status: "PHARMACY_SAFETY_CHECK_REQUIRED", sku, salePolicy: policy.salePolicy });
      continue;
    }
    if (policy.salePolicy === "PRESCRIPTION_REQUIRED") {
      blockers.push({ status: "PHARMACY_PRESCRIPTION_REQUIRED", sku, salePolicy: policy.salePolicy });
      continue;
    }
    if (policy.salePolicy === "ONLINE_SALE_PROHIBITED") {
      // At the counter this is not a dead end: it falls through to
      // PHARMACY_REVIEW_REQUIRED below, so a pharmacist still gates every
      // hand-over. What it must never become is a free sale.
      if (channel === "online") {
        blockers.push({ status: "PHARMACY_ONLINE_SALE_PROHIBITED", sku, salePolicy: policy.salePolicy });
        continue;
      }
    }
    blockers.push({ status: "PHARMACY_REVIEW_REQUIRED", sku, salePolicy: policy.salePolicy });
  }

  if (blockers.length > 0) return { allowed: false, ...blockers[0], blockers };
  return { allowed: true };
}
