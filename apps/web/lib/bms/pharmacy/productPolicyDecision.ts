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
  | {
      allowed: true;
      /**
       * SKUs that only cleared because a licensed pharmacist authorised them at
       * the register (`9.29`). The caller writes one evidence row per line in
       * the same transaction as the bill — an empty/absent list means the basket
       * passed on its own policies and there is nothing to record.
       */
      counterAuthorizedSkus?: string[];
    }
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

/**
 * Blocks a pharmacist's review of this basket can resolve — the set every caller
 * that decides "should I open a queue case for this?" must agree on.
 *
 * Three call sites used to hardcode their own pair of statuses (`pipeline.ts`,
 * `tools/catalog.ts`, `pos.ts`), which is how PRESCRIPTION_REQUIRED ended up
 * unsellable everywhere: `evaluatePharmacySale()` would have cleared it for an
 * approved case, but nothing would open the case in the first place.
 *
 * Deliberately NOT in the set:
 *   - PHARMACY_POLICY_UNKNOWN — an unreviewed product policy is fixed by
 *     reviewing the policy (or a pharmacist's PIN at the register), not by
 *     approving one basket. Its whole point is that nobody has classified the
 *     product yet, so there is nothing for a case to be about.
 *   - PHARMACY_ONLINE_SALE_PROHIBITED — the classification says this product may
 *     not travel over the internet at all. A pharmacist can hand it over in
 *     person (the counter path turns it into PHARMACY_REVIEW_REQUIRED), but no
 *     approval makes an online order of it legitimate.
 *   - PHARMACY_QUANTITY_LIMIT_EXCEEDED — a cap the shop set for itself.
 */
export const PHARMACIST_REVIEWABLE_BLOCK_STATUSES: readonly PharmacySaleBlockStatus[] = [
  "PHARMACY_REVIEW_REQUIRED",
  "PHARMACY_SAFETY_CHECK_REQUIRED",
  "PHARMACY_PRESCRIPTION_REQUIRED",
];

export function isPharmacistReviewableBlock(status: string): boolean {
  return (PHARMACIST_REVIEWABLE_BLOCK_STATUSES as readonly string[]).includes(status);
}

/**
 * True when EVERY reason this basket was refused is something a pharmacist's
 * review can resolve. All-or-nothing on purpose: the basket is reserved and paid
 * for as one order, so opening a case for a basket that also contains an
 * unreviewable item would produce an approval that can never be spent.
 */
export function isPharmacistReviewableBasket(
  status: string,
  blockers?: ReadonlyArray<{ status: string }> | null
): boolean {
  if (blockers && blockers.length > 0) {
    return blockers.every((blocker) => isPharmacistReviewableBlock(blocker.status));
  }
  return isPharmacistReviewableBlock(status);
}

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
  channel: PharmacySaleChannel = "online",
  /**
   * SKUs a licensed pharmacist authorised **in person at the register**
   * (`9.29`). This is how an ordinary pharmacy works: the pharmacist is
   * standing at the counter, looks at the box, asks the customer two questions
   * and says yes — the evidence worth keeping is who authorised what, not a
   * transcript.
   *
   * Ignored unless `channel === "counter"`: there is nobody at a register on an
   * online order, so an online caller can never gain this exemption even by
   * passing a set.
   *
   * It clears the policy-driven blocks, PRESCRIPTION_REQUIRED included — a
   * pharmacist reading the prescription is exactly who is meant to decide that.
   * It deliberately does NOT clear PHARMACY_QUANTITY_LIMIT_EXCEEDED: that cap is
   * a number the shop configured for itself, and selling past it is a policy
   * edit, not a counter decision.
   */
  counterPharmacistAuthorizedSkus: ReadonlySet<string> = new Set()
): PharmacySaleDecision {
  const bySku = new Map(policies.map((policy) => [policy.productSku, policy]));
  const counterAuthorized = (sku: string) =>
    channel === "counter" && counterPharmacistAuthorizedSkus.has(sku);
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
      // An unreviewed SKU is not a dead end at the counter any more: a licensed
      // pharmacist may take responsibility for this one hand-over. The policy
      // row still has to be reviewed before the product sells itself.
      if (counterAuthorized(sku)) continue;
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
    // The pharmacist at the register clears every policy-driven block below,
    // including PRESCRIPTION_REQUIRED. The quantity cap above is already past.
    if (counterAuthorized(sku)) continue;
    if (
      (policy.salePolicy === "PHARMACIST_APPROVAL" ||
        policy.salePolicy === "SHORT_SAFETY_CHECK" ||
        // A prescription is a document a pharmacist reads and takes
        // responsibility for. Their approval of this exact basket IS that
        // decision, so it clears the block on both surfaces — the case carries
        // the prescription image/reference in bms_pharmacy_clinical_evidence.
        // What stays impossible is dispensing one with no case at all.
        policy.salePolicy === "PRESCRIPTION_REQUIRED" ||
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

/**
 * Which SKUs a pharmacist's checkout draft actually authorises for THIS basket.
 *
 * Pure on purpose: this is the quantity boundary of a clinical approval, so it
 * has to be testable without a database. checkPharmacySaleInTx() only supplies
 * the two lists.
 *
 * **Both sides are summed per (sku, size) before comparing.** The previous
 * version compared each requested line on its own against the first matching
 * draft item, which is wrong in two directions now that `9.21` lets one bill
 * carry the same SKU+size in two selling units ("1 box + 3 tablets"):
 *   - over-dispensing: an approval for 10 tablets cleared a bill holding
 *     10 (box) + 10 (loose) — 20 units handed over on a 10-unit approval,
 *     because each line satisfied the `>=` check by itself;
 *   - under-dispensing: a draft the pharmacist built as two rows of the same
 *     product only ever counted the first row.
 *
 * Size is compared as text because that is how both the order line and the
 * draft store it — an approval for one size never authorises another.
 */
export function approvedSkusFromCheckoutDraft(
  items: Array<{ sku: string; size?: string; qty: number }>,
  draftItems: Array<{ sku?: unknown; size?: unknown; qty?: unknown }>
): Set<string> {
  const keyOf = (sku: string, size: unknown) => `${sku}\u0000${String(size ?? "")}`;

  const approvedQty = new Map<string, number>();
  for (const item of draftItems) {
    const sku = String(item?.sku ?? "").trim();
    if (!sku) continue;
    const qty = Number(item?.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const key = keyOf(sku, item?.size);
    approvedQty.set(key, (approvedQty.get(key) ?? 0) + qty);
  }

  const requestedQty = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item.sku, item.size);
    requestedQty.set(key, (requestedQty.get(key) ?? 0) + item.qty);
  }

  // A sku clears only when EVERY (sku, size) total it appears in is covered.
  const requestedSkus = new Set<string>();
  const blocked = new Set<string>();
  for (const item of items) {
    requestedSkus.add(item.sku);
    const key = keyOf(item.sku, item.size);
    if ((approvedQty.get(key) ?? 0) < (requestedQty.get(key) ?? 0)) blocked.add(item.sku);
  }

  const approved = new Set<string>();
  for (const sku of requestedSkus) if (!blocked.has(sku)) approved.add(sku);
  return approved;
}
