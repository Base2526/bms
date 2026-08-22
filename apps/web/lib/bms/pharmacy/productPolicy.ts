import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import {
  PHARMACY_PRODUCT_TYPES,
  PHARMACY_SALE_POLICIES,
  evaluatePharmacySale,
  type PharmacyProductPolicyStatus,
  type PharmacyProductType,
  type PharmacySaleDecision,
  type PharmacySalePolicy,
} from "./productPolicyDecision";
export {
  PHARMACY_PRODUCT_TYPES,
  PHARMACY_SALE_POLICIES,
  evaluatePharmacySale,
  type PharmacyProductPolicyStatus,
  type PharmacyProductType,
  type PharmacySaleBlockStatus,
  type PharmacySaleDecision,
  type PharmacySalePolicy,
} from "./productPolicyDecision";

export type PharmacyProductPolicy = {
  id: string;
  tenantId: string;
  productSku: string;
  productName: string;
  productType: PharmacyProductType;
  regulatoryFramework: PharmacyRegulatoryFramework;
  regulatoryClass: string;
  regulatoryEvidenceSource: PharmacyRegulatoryEvidenceSource;
  regulatoryEvidenceRef: string | null;
  salePolicy: PharmacySalePolicy;
  registrationNo: string | null;
  maxQuantity: number | null;
  safetyRuleKey: string | null;
  status: PharmacyProductPolicyStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListPharmacyProductPoliciesPageOptions = {
  search?: string;
  limit?: number;
  offset?: number;
};

export type PharmacyProductPolicyPage = {
  items: PharmacyProductPolicy[];
  total: number;
  limit: number;
  offset: number;
};

export const PHARMACY_REGULATORY_FRAMEWORKS = ["UNKNOWN", "NOT_REGULATED", "DRUG", "MEDICAL_DEVICE"] as const;
export type PharmacyRegulatoryFramework = (typeof PHARMACY_REGULATORY_FRAMEWORKS)[number];
export const PHARMACY_REGULATORY_EVIDENCE_SOURCES = [
  "UNKNOWN", "PRODUCT_LABEL", "FDA_REGISTRATION", "FDA_ANNOUNCEMENT",
  "SUPPLIER_DOCUMENT", "PHARMACIST_REVIEW",
] as const;
export type PharmacyRegulatoryEvidenceSource = (typeof PHARMACY_REGULATORY_EVIDENCE_SOURCES)[number];

const REGULATORY_CLASSES_BY_FRAMEWORK: Record<PharmacyRegulatoryFramework, readonly string[]> = {
  UNKNOWN: ["UNKNOWN"],
  NOT_REGULATED: ["NOT_APPLICABLE"],
  DRUG: ["UNKNOWN", "HOUSEHOLD_REMEDY", "DANGEROUS_DRUG", "SPECIALLY_CONTROLLED_DRUG", "OTHER_DRUG"],
  MEDICAL_DEVICE: ["UNKNOWN", "MEDICAL_DEVICE_CLASS_1", "MEDICAL_DEVICE_CLASS_2", "MEDICAL_DEVICE_CLASS_3", "MEDICAL_DEVICE_CLASS_4"],
};


export async function checkPharmacistDraftPolicyInTx(
  client: PoolClient,
  tenantId: string,
  items: Array<{ sku: string; qty: number }>
): Promise<PharmacySaleDecision> {
  const skus = [...new Set(items.map((item) => item.sku))];
  if (skus.length === 0) return { allowed: true };
  const rows = await client.query<{
    product_sku: string;
    sale_policy: PharmacySalePolicy;
    status: PharmacyProductPolicyStatus;
    max_quantity: number | null;
  }>(
    `SELECT product_sku, sale_policy, status, max_quantity
       FROM bms_pharmacy_product_policies
      WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, skus]
  );
  return evaluatePharmacySale(
    items,
    rows.rows.map((row) => ({
      productSku: row.product_sku,
      salePolicy: row.sale_policy,
      status: row.status,
      maxQuantity: row.max_quantity == null ? null : Number(row.max_quantity),
    })),
    new Set(skus)
  );
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row: any): PharmacyProductPolicy {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productSku: row.product_sku,
    productName: row.product_name ?? row.product_sku,
    productType: row.product_type,
    regulatoryFramework: row.regulatory_framework ?? "UNKNOWN",
    regulatoryClass: row.regulatory_class,
    regulatoryEvidenceSource: row.regulatory_evidence_source ?? "UNKNOWN",
    regulatoryEvidenceRef: row.regulatory_evidence_ref ?? null,
    salePolicy: row.sale_policy,
    registrationNo: row.registration_no ?? null,
    maxQuantity: row.max_quantity == null ? null : Number(row.max_quantity),
    safetyRuleKey: row.safety_rule_key ?? null,
    status: row.status,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: iso(row.reviewed_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

export async function listPharmacyProductPolicies(tenantId: string): Promise<PharmacyProductPolicy[]> {
  const res = await query(
    `SELECT COALESCE(policy.id::text, 'missing:' || product.sku) AS id,
            product.tenant_id,
            product.sku AS product_sku,
            product.name AS product_name,
            COALESCE(policy.product_type, 'UNKNOWN') AS product_type,
            COALESCE(policy.regulatory_framework, 'UNKNOWN') AS regulatory_framework,
            COALESCE(policy.regulatory_class, 'UNKNOWN') AS regulatory_class,
            COALESCE(policy.regulatory_evidence_source, 'UNKNOWN') AS regulatory_evidence_source,
            policy.regulatory_evidence_ref,
            COALESCE(policy.sale_policy, 'PHARMACIST_APPROVAL') AS sale_policy,
            policy.registration_no, policy.max_quantity, policy.safety_rule_key,
            COALESCE(policy.status, 'MISSING') AS status,
            policy.reviewed_by, policy.reviewed_at,
            COALESCE(policy.created_at, product.created_at) AS created_at,
            COALESCE(policy.updated_at, product.updated_at) AS updated_at
       FROM bms_products product
       LEFT JOIN bms_pharmacy_product_policies policy
         ON policy.tenant_id = product.tenant_id AND policy.product_sku = product.sku
      WHERE product.tenant_id = $1
      ORDER BY product.name, product.sku`,
    [tenantId]
  );
  return res.rows.map(mapRow);
}

export async function listPharmacyProductPoliciesPage(
  tenantId: string,
  options: ListPharmacyProductPoliciesPageOptions = {}
): Promise<PharmacyProductPolicyPage> {
  const limit = Math.max(1, Math.min(100, Number(options.limit ?? 20) || 20));
  const offset = Math.max(0, Number(options.offset ?? 0) || 0);
  const search = String(options.search || "").trim();
  const hasSearch = search.length > 0;
  const searchValue = `%${search}%`;
  const res = await query(
    `SELECT *
       FROM (
         SELECT COALESCE(policy.id::text, 'missing:' || product.sku) AS id,
                product.tenant_id,
                product.sku AS product_sku,
                product.name AS product_name,
                COALESCE(policy.product_type, 'UNKNOWN') AS product_type,
                COALESCE(policy.regulatory_framework, 'UNKNOWN') AS regulatory_framework,
                COALESCE(policy.regulatory_class, 'UNKNOWN') AS regulatory_class,
                COALESCE(policy.regulatory_evidence_source, 'UNKNOWN') AS regulatory_evidence_source,
                policy.regulatory_evidence_ref,
                COALESCE(policy.sale_policy, 'PHARMACIST_APPROVAL') AS sale_policy,
                policy.registration_no, policy.max_quantity, policy.safety_rule_key,
                COALESCE(policy.status, 'MISSING') AS status,
                policy.reviewed_by, policy.reviewed_at,
                COALESCE(policy.created_at, product.created_at) AS created_at,
                COALESCE(policy.updated_at, product.updated_at) AS updated_at,
                COUNT(*) OVER()::int AS total_count
           FROM bms_products product
           LEFT JOIN bms_pharmacy_product_policies policy
             ON policy.tenant_id = product.tenant_id AND policy.product_sku = product.sku
          WHERE product.tenant_id = $1
            AND (
              $2::boolean = false
              OR product.sku ILIKE $3
              OR product.name ILIKE $3
            )
          ORDER BY product.name, product.sku
          LIMIT $4 OFFSET $5
       ) page`,
    [tenantId, hasSearch, searchValue, limit, offset]
  );
  return {
    items: res.rows.map(mapRow),
    total: res.rows[0]?.total_count ?? 0,
    limit,
    offset,
  };
}

export type UpsertPharmacyProductPolicyInput = {
  productSku: string;
  productType: PharmacyProductType;
  regulatoryFramework: PharmacyRegulatoryFramework;
  regulatoryClass: string;
  regulatoryEvidenceSource: PharmacyRegulatoryEvidenceSource;
  regulatoryEvidenceRef?: string | null;
  salePolicy: PharmacySalePolicy;
  registrationNo?: string | null;
  maxQuantity?: number | null;
  safetyRuleKey?: string | null;
};

export function validatePharmacyProductPolicyInput(input: UpsertPharmacyProductPolicyInput) {
  const productSku = String(input.productSku || "").trim();
  const regulatoryClass = String(input.regulatoryClass || "").trim();
  const regulatoryEvidenceRef = input.regulatoryEvidenceRef?.trim() || null;
  if (!productSku) throw new Error("ต้องระบุ SKU");
  if (!PHARMACY_PRODUCT_TYPES.includes(input.productType)) throw new Error("productType ไม่ถูกต้อง");
  if (!PHARMACY_REGULATORY_FRAMEWORKS.includes(input.regulatoryFramework)) throw new Error("regulatoryFramework ไม่ถูกต้อง");
  if (!REGULATORY_CLASSES_BY_FRAMEWORK[input.regulatoryFramework].includes(regulatoryClass)) {
    throw new Error(`regulatoryClass ไม่สัมพันธ์กับ regulatoryFramework ${input.regulatoryFramework}`);
  }
  if (!PHARMACY_REGULATORY_EVIDENCE_SOURCES.includes(input.regulatoryEvidenceSource)) {
    throw new Error("regulatoryEvidenceSource ไม่ถูกต้อง");
  }
  if (input.productType === "DRUG" && input.regulatoryFramework !== "DRUG") {
    throw new Error("สินค้าประเภท DRUG ต้องใช้ regulatoryFramework = DRUG");
  }
  if (input.productType === "HOUSEHOLD_REMEDY" && (
    input.regulatoryFramework !== "DRUG" || regulatoryClass !== "HOUSEHOLD_REMEDY"
  )) {
    throw new Error("ยาสามัญประจำบ้านต้องใช้ framework DRUG และ class HOUSEHOLD_REMEDY");
  }
  if (input.productType === "MEDICAL_DEVICE" && input.regulatoryFramework !== "MEDICAL_DEVICE") {
    throw new Error("สินค้าประเภท MEDICAL_DEVICE ต้องใช้ regulatoryFramework = MEDICAL_DEVICE");
  }
  if (input.productType === "GENERAL_PRODUCT" && input.regulatoryFramework !== "NOT_REGULATED") {
    throw new Error("สินค้าทั่วไปต้องใช้ regulatoryFramework = NOT_REGULATED");
  }
  if (input.productType === "UNKNOWN" && input.regulatoryFramework !== "UNKNOWN") {
    throw new Error("เมื่อยังไม่ทราบประเภทผลิตภัณฑ์ regulatoryFramework ต้องเป็น UNKNOWN");
  }
  if (input.regulatoryEvidenceSource === "FDA_REGISTRATION" && !["DRUG", "MEDICAL_DEVICE"].includes(input.regulatoryFramework)) {
    throw new Error("ใช้ข้อมูลทะเบียน อย. ได้เฉพาะกรอบ DRUG หรือ MEDICAL_DEVICE");
  }
  if (!PHARMACY_SALE_POLICIES.includes(input.salePolicy)) throw new Error("salePolicy ไม่ถูกต้อง");
  if (!regulatoryClass) throw new Error("ต้องระบุ regulatoryClass");
  if (input.maxQuantity != null && (!Number.isInteger(input.maxQuantity) || input.maxQuantity <= 0)) {
    throw new Error("maxQuantity ต้องเป็นจำนวนเต็มมากกว่า 0");
  }
  if (regulatoryEvidenceRef && regulatoryEvidenceRef.length > 500) {
    throw new Error("รายละเอียดแหล่งอ้างอิงยาวเกิน 500 ตัวอักษร");
  }
  return {
    productSku,
    productType: input.productType,
    regulatoryFramework: input.regulatoryFramework,
    regulatoryClass,
    regulatoryEvidenceSource: input.regulatoryEvidenceSource,
    regulatoryEvidenceRef,
    salePolicy: input.salePolicy,
    registrationNo: input.registrationNo?.trim() || null,
    maxQuantity: input.maxQuantity ?? null,
    safetyRuleKey: input.safetyRuleKey?.trim() || null,
  };
}

export async function upsertPharmacyProductPolicyDraft(
  tenantId: string,
  input: UpsertPharmacyProductPolicyInput
): Promise<PharmacyProductPolicy> {
  const value = validatePharmacyProductPolicyInput(input);
  const res = await query(
    `INSERT INTO bms_pharmacy_product_policies
       (tenant_id, product_sku, product_type, regulatory_framework, regulatory_class,
        regulatory_evidence_source, regulatory_evidence_ref, sale_policy,
        registration_no, max_quantity, safety_rule_key, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DRAFT')
     ON CONFLICT (tenant_id, product_sku) DO UPDATE
       SET product_type = EXCLUDED.product_type,
           regulatory_class = EXCLUDED.regulatory_class,
           regulatory_framework = EXCLUDED.regulatory_framework,
           regulatory_evidence_source = EXCLUDED.regulatory_evidence_source,
           regulatory_evidence_ref = EXCLUDED.regulatory_evidence_ref,
           sale_policy = EXCLUDED.sale_policy,
           registration_no = EXCLUDED.registration_no,
           max_quantity = EXCLUDED.max_quantity,
           safety_rule_key = EXCLUDED.safety_rule_key,
           status = 'DRAFT', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
     WHERE bms_pharmacy_product_policies.status IN ('DRAFT','APPROVED','RETIRED')
     RETURNING *`,
    [tenantId, value.productSku, value.productType, value.regulatoryFramework, value.regulatoryClass,
      value.regulatoryEvidenceSource, value.regulatoryEvidenceRef, value.salePolicy,
      value.registrationNo, value.maxQuantity, value.safetyRuleKey]
  );
  if (!res.rowCount) throw new Error("Product Policy ที่รอตรวจอยู่ยังแก้ไขไม่ได้");
  return mapRow(res.rows[0]);
}

export async function submitPharmacyProductPolicyForReview(tenantId: string, productSku: string) {
  const current = await query(
    `SELECT * FROM bms_pharmacy_product_policies
      WHERE tenant_id = $1 AND product_sku = $2 AND status = 'DRAFT'`,
    [tenantId, productSku]
  );
  if (!current.rowCount) throw new Error("ส่งตรวจได้เฉพาะ Product Policy สถานะ DRAFT");
  const policy = mapRow(current.rows[0]);
  if (policy.regulatoryFramework === "UNKNOWN" || policy.regulatoryClass === "UNKNOWN") {
    throw new Error("ต้องยืนยันประเภทตามข้อกำกับก่อนส่งให้เภสัชกรตรวจ");
  }
  if (policy.regulatoryEvidenceSource === "UNKNOWN") {
    throw new Error("ต้องระบุแหล่งอ้างอิงของประเภทตามข้อกำกับก่อนส่งตรวจ");
  }
  if (policy.regulatoryEvidenceSource === "FDA_REGISTRATION" && !policy.registrationNo) {
    throw new Error("แหล่งอ้างอิง FDA_REGISTRATION ต้องระบุเลขทะเบียน/เลขใบรับแจ้ง");
  }
  if (
    ["FDA_ANNOUNCEMENT", "SUPPLIER_DOCUMENT", "PHARMACIST_REVIEW"].includes(policy.regulatoryEvidenceSource) &&
    !policy.regulatoryEvidenceRef
  ) {
    throw new Error("แหล่งอ้างอิงที่เลือกต้องระบุรายละเอียด/เลขอ้างอิง");
  }
  const res = await query(
    `UPDATE bms_pharmacy_product_policies
        SET status = 'PENDING_REVIEW', updated_at = now()
      WHERE tenant_id = $1 AND product_sku = $2 AND status = 'DRAFT'
      RETURNING *`,
    [tenantId, productSku]
  );
  if (!res.rowCount) throw new Error("ส่งตรวจได้เฉพาะ Product Policy สถานะ DRAFT");
  return mapRow(res.rows[0]);
}

export async function reviewPharmacyProductPolicy(
  tenantId: string,
  productSku: string,
  reviewerId: string,
  decision: "APPROVE" | "REJECT"
) {
  const licensed = await query<{ ok: boolean }>(
    `SELECT public.bms_is_licensed_pharmacist($1, $2) AS ok`,
    [tenantId, reviewerId]
  );
  if (licensed.rows[0]?.ok !== true) throw new Error("ผู้อนุมัติต้องเป็นเภสัชกรที่มีใบประกอบวิชาชีพ");
  const approved = decision === "APPROVE";
  const res = await query(
    `UPDATE bms_pharmacy_product_policies
        SET status = $4, reviewed_by = $3, reviewed_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND product_sku = $2 AND status = 'PENDING_REVIEW'
        AND (
          $4 <> 'APPROVED' OR (
            regulatory_framework <> 'UNKNOWN'
            AND regulatory_class <> 'UNKNOWN'
            AND regulatory_evidence_source <> 'UNKNOWN'
            AND (regulatory_evidence_source <> 'FDA_REGISTRATION' OR registration_no IS NOT NULL)
            AND (
              regulatory_evidence_source NOT IN ('FDA_ANNOUNCEMENT','SUPPLIER_DOCUMENT','PHARMACIST_REVIEW')
              OR regulatory_evidence_ref IS NOT NULL
            )
          )
        )
      RETURNING *`,
    [tenantId, productSku, reviewerId, approved ? "APPROVED" : "DRAFT"]
  );
  if (!res.rowCount) throw new Error("อนุมัติได้เฉพาะ Policy ที่รอตรวจและมีข้อมูลข้อกำกับพร้อมหลักฐานครบ");
  return mapRow(res.rows[0]);
}

export async function checkPharmacySaleInTx(
  client: PoolClient,
  tenantId: string,
  items: Array<{ sku: string; size?: string; qty: number }>,
  approvedAssessmentId?: string | null
): Promise<PharmacySaleDecision> {
  const profile = await client.query<{ business_archetype: string | null }>(
    `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  if (profile.rows[0]?.business_archetype !== "pharmacy") return { allowed: true };

  const skus = [...new Set(items.map((item) => item.sku))];
  const policyRows = await client.query<{
    product_sku: string;
    sale_policy: PharmacySalePolicy;
    status: PharmacyProductPolicyStatus;
    max_quantity: number | null;
  }>(
    `SELECT product_sku, sale_policy, status, max_quantity
       FROM bms_pharmacy_product_policies
      WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, skus]
  );

  const approvedSkus = new Set<string>();
  if (approvedAssessmentId) {
    const assessment = await client.query<{ checkout_order_draft: any }>(
      `SELECT checkout_order_draft
         FROM bms_pharmacy_assessments
        WHERE tenant_id = $1 AND id = $2 AND status = 'APPROVED' AND deleted_at IS NULL`,
      [tenantId, approvedAssessmentId]
    );
    const draftItems = Array.isArray(assessment.rows[0]?.checkout_order_draft?.items)
      ? assessment.rows[0].checkout_order_draft.items
      : [];
    for (const sku of skus) {
      const requestedForSku = items.filter((item) => item.sku === sku);
      const fullyCovered = requestedForSku.every((requested) => {
        const approved = draftItems.find((item: any) =>
          item?.sku === requested.sku &&
          String(item?.size ?? "") === String(requested.size ?? "")
        );
        return approved && Number(approved.qty) >= requested.qty;
      });
      if (fullyCovered) approvedSkus.add(sku);
    }
  }

  return evaluatePharmacySale(
    items,
    policyRows.rows.map((row) => ({
      productSku: row.product_sku,
      salePolicy: row.sale_policy,
      status: row.status,
      maxQuantity: row.max_quantity == null ? null : Number(row.max_quantity),
    })),
    approvedSkus
  );
}
