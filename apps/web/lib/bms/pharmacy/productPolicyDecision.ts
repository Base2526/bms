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

export type PharmacySaleDecision =
  | { allowed: true }
  | {
      allowed: false;
      status: PharmacySaleBlockStatus;
      sku: string;
      salePolicy: PharmacySalePolicy | "UNKNOWN";
      maxQuantity?: number;
      requested?: number;
    };

export type PharmacyPolicyForDecision = {
  productSku: string;
  salePolicy: PharmacySalePolicy;
  status: PharmacyProductPolicyStatus;
  maxQuantity: number | null;
};

export function evaluatePharmacySale(
  items: Array<{ sku: string; qty: number }>,
  policies: PharmacyPolicyForDecision[],
  approvedAssessmentSkus: ReadonlySet<string> = new Set()
): PharmacySaleDecision {
  const bySku = new Map(policies.map((policy) => [policy.productSku, policy]));
  const quantityBySku = new Map<string, number>();
  for (const item of items) quantityBySku.set(item.sku, (quantityBySku.get(item.sku) ?? 0) + item.qty);
  for (const [sku, qty] of quantityBySku) {
    const item = { sku, qty };
    const policy = bySku.get(item.sku);
    if (!policy || policy.status !== "APPROVED") {
      return { allowed: false, status: "PHARMACY_POLICY_UNKNOWN", sku: item.sku, salePolicy: "UNKNOWN" };
    }
    if (policy.maxQuantity != null && item.qty > policy.maxQuantity) {
      return {
        allowed: false,
        status: "PHARMACY_QUANTITY_LIMIT_EXCEEDED",
        sku: item.sku,
        salePolicy: policy.salePolicy,
        maxQuantity: policy.maxQuantity,
        requested: item.qty,
      };
    }
    if (policy.salePolicy === "DIRECT_SALE") continue;
    if (
      (policy.salePolicy === "PHARMACIST_APPROVAL" || policy.salePolicy === "SHORT_SAFETY_CHECK") &&
      approvedAssessmentSkus.has(item.sku)
    ) continue;
    if (policy.salePolicy === "SHORT_SAFETY_CHECK") {
      return { allowed: false, status: "PHARMACY_SAFETY_CHECK_REQUIRED", sku: item.sku, salePolicy: policy.salePolicy };
    }
    if (policy.salePolicy === "PRESCRIPTION_REQUIRED") {
      return { allowed: false, status: "PHARMACY_PRESCRIPTION_REQUIRED", sku: item.sku, salePolicy: policy.salePolicy };
    }
    if (policy.salePolicy === "ONLINE_SALE_PROHIBITED") {
      return { allowed: false, status: "PHARMACY_ONLINE_SALE_PROHIBITED", sku: item.sku, salePolicy: policy.salePolicy };
    }
    return { allowed: false, status: "PHARMACY_REVIEW_REQUIRED", sku: item.sku, salePolicy: policy.salePolicy };
  }
  return { allowed: true };
}
