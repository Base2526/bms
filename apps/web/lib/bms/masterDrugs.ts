import "server-only";
import { getClient, query, runInTransaction } from "@/lib/db";
import { requirePlatformAdmin } from "./platform";
import { getTenantId, beginTenantTx } from "./tenant";
import type { PharmacySalePolicy } from "./pharmacy/productPolicyDecision";

type MasterContext = { admin?: { id?: string; email?: string; tenant_id?: string } };

const REGULATORY_CLASSES = [
  "HOUSEHOLD_REMEDY", "DANGEROUS_DRUG", "SPECIALLY_CONTROLLED_DRUG", "OTHER_DRUG",
] as const;
const SALE_POLICIES = [
  "DIRECT_SALE", "SHORT_SAFETY_CHECK", "PHARMACIST_APPROVAL",
  "PRESCRIPTION_REQUIRED", "ONLINE_SALE_PROHIBITED",
] as const;

export type MasterDrugInput = {
  id?: string | null;
  code: string;
  countryCode?: string | null;
  genericName: string;
  dosageForm: string;
  strength: string;
  regulatoryClass: string;
  suggestedSalePolicy: PharmacySalePolicy;
  suggestedQuantityLimit?: number | null;
  barcodes?: string[] | null;
  source: string;
  sourceVersion: string;
  reviewedByPharmacist?: boolean | null;
  reviewedByPharmacistName?: string | null;
  reviewedByPharmacistLicenseNo?: string | null;
  version?: number | null;
  active?: boolean | null;
};

function bounded(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function mapMasterDrug(row: any) {
  return {
    id: row.id,
    code: row.code,
    countryCode: row.country_code,
    genericName: row.generic_name,
    dosageForm: row.dosage_form,
    strength: row.strength,
    regulatoryClass: row.regulatory_class,
    suggestedSalePolicy: row.suggested_sale_policy,
    suggestedQuantityLimit: row.suggested_quantity_limit == null ? null : Number(row.suggested_quantity_limit),
    barcodes: row.barcodes ?? [],
    source: row.source,
    sourceVersion: row.source_version,
    reviewedByPharmacist: row.reviewed_by_pharmacist === true,
    reviewedByPharmacistName: row.reviewed_by_pharmacist_name ?? null,
    reviewedByPharmacistLicenseNo: row.reviewed_by_pharmacist_license_no ?? null,
    reviewedAt: row.reviewed_at == null ? null : new Date(row.reviewed_at).toISOString(),
    version: Number(row.version),
    effectiveFrom: new Date(row.effective_from).toISOString(),
    effectiveTo: row.effective_to == null ? null : new Date(row.effective_to).toISOString(),
    active: row.active === true,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function normalizeInput(input: MasterDrugInput) {
  const code = bounded(input.code, 80).toUpperCase();
  const countryCode = bounded(input.countryCode || "TH", 2).toUpperCase();
  const genericName = bounded(input.genericName, 240);
  const dosageForm = bounded(input.dosageForm, 120);
  const strength = bounded(input.strength, 120);
  const regulatoryClass = bounded(input.regulatoryClass, 40).toUpperCase();
  const suggestedSalePolicy = bounded(input.suggestedSalePolicy, 40).toUpperCase();
  const source = bounded(input.source, 300);
  const sourceVersion = bounded(input.sourceVersion, 120);
  const reviewed = input.reviewedByPharmacist === true;
  const reviewerName = bounded(input.reviewedByPharmacistName, 200) || null;
  const reviewerLicense = bounded(input.reviewedByPharmacistLicenseNo, 120) || null;
  const version = Number(input.version ?? 1);
  const limit = input.suggestedQuantityLimit == null ? null : Number(input.suggestedQuantityLimit);
  const barcodes = [...new Set((input.barcodes ?? []).map((value) => bounded(value, 32)).filter(Boolean))];
  if (!code || !genericName || !dosageForm || !strength || !source || !sourceVersion) {
    throw new Error("MASTER_DRUG_REQUIRED_FIELDS");
  }
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("MASTER_DRUG_COUNTRY_INVALID");
  if (!(REGULATORY_CLASSES as readonly string[]).includes(regulatoryClass)) throw new Error("MASTER_DRUG_CLASS_INVALID");
  if (!(SALE_POLICIES as readonly string[]).includes(suggestedSalePolicy)) throw new Error("MASTER_DRUG_POLICY_INVALID");
  if (!Number.isInteger(version) || version < 1) throw new Error("MASTER_DRUG_VERSION_INVALID");
  if (limit != null && (!Number.isInteger(limit) || limit < 1)) throw new Error("MASTER_DRUG_LIMIT_INVALID");
  if (barcodes.some((value) => !/^\d{8}$|^\d{12,14}$/.test(value) || /^0?2\d/.test(value))) {
    throw new Error("MASTER_DRUG_BARCODE_INVALID");
  }
  if (reviewed && (!reviewerName || !reviewerLicense)) throw new Error("MASTER_DRUG_REVIEWER_REQUIRED");
  return {
    id: input.id || null, code, countryCode, genericName, dosageForm, strength,
    regulatoryClass, suggestedSalePolicy, suggestedQuantityLimit: limit, barcodes,
    source, sourceVersion, reviewed, reviewerName, reviewerLicense, version,
    active: input.active !== false,
  };
}

export async function listMasterDrugs(args: {
  search?: string | null; includeInactive?: boolean | null; limit?: number | null;
} = {}) {
  const search = bounded(args.search, 120);
  const limit = Math.min(Math.max(Number(args.limit ?? 200), 1), 500);
  const result = await query<any>(
    `SELECT * FROM bms_master_drugs
      WHERE ($1 OR (active AND effective_to IS NULL))
        AND ($2='' OR code ILIKE '%'||$2||'%' OR generic_name ILIKE '%'||$2||'%'
          OR dosage_form ILIKE '%'||$2||'%' OR strength ILIKE '%'||$2||'%')
      ORDER BY active DESC, generic_name, strength, version DESC
      LIMIT $3`,
    [args.includeInactive === true, search, limit],
  );
  return result.rows.map(mapMasterDrug);
}

export async function upsertMasterDrug(ctx: MasterContext, input: MasterDrugInput) {
  await requirePlatformAdmin(ctx);
  const actorId = String(ctx.admin?.id || "");
  if (!actorId) throw new Error("Unauthenticated");
  const value = normalizeInput(input);
  return (await runInTransaction(actorId, async (client) => {
    const saved = await client.query<any>(
      `SELECT * FROM public.upsert_master_drug(
        $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,$12,
        $13,$14,$15,$16,$17
      )`,
      [value.id, value.code, value.countryCode, value.genericName, value.dosageForm,
        value.strength, value.regulatoryClass, value.suggestedSalePolicy,
        value.suggestedQuantityLimit, value.barcodes, value.source, value.sourceVersion,
        value.reviewed, value.reviewerName, value.reviewerLicense, value.version, value.active],
    );
    const version = Number(saved.rows[0].version);
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
       VALUES($1,$2,'platform.master_data.drug_saved',$3,$4::jsonb)`,
      [getTenantId(ctx), String(ctx.admin?.email || actorId), value.code,
        JSON.stringify({ version, active: value.active, reviewedByPharmacist: value.reviewed })],
    );
    return mapMasterDrug(saved.rows[0]);
  })).result;
}

export async function applyMasterDrugSuggestionToPolicy(input: {
  tenantId: string;
  productSku: string;
  masterDrugCode: string;
  actorId: string;
  actorLabel: string;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorId });
    const product = await client.query<{ name: string }>(
      `SELECT name FROM bms_products WHERE tenant_id=$1 AND sku=$2 FOR UPDATE`,
      [input.tenantId, input.productSku],
    );
    if (!product.rowCount) throw new Error("PRODUCT_NOT_FOUND");
    const master = await client.query<any>(
      `SELECT * FROM bms_master_drugs
        WHERE code=$1 AND active=TRUE AND effective_to IS NULL`,
      [bounded(input.masterDrugCode, 80).toUpperCase()],
    );
    if (!master.rowCount) throw new Error("MASTER_DRUG_NOT_AVAILABLE");
    const drug = master.rows[0];
    const snapshot = {
      code: drug.code,
      version: Number(drug.version),
      genericName: drug.generic_name,
      dosageForm: drug.dosage_form,
      strength: drug.strength,
      regulatoryClass: drug.regulatory_class,
      suggestedSalePolicy: drug.suggested_sale_policy,
      suggestedQuantityLimit: drug.suggested_quantity_limit == null ? null : Number(drug.suggested_quantity_limit),
      source: drug.source,
      sourceVersion: drug.source_version,
      reviewedByPharmacist: drug.reviewed_by_pharmacist === true,
      reviewedByPharmacistName: drug.reviewed_by_pharmacist_name ?? null,
      reviewedByPharmacistLicenseNo: drug.reviewed_by_pharmacist_license_no ?? null,
      reviewedAt: drug.reviewed_at ?? null,
    };
    const productType = drug.regulatory_class === "HOUSEHOLD_REMEDY" ? "HOUSEHOLD_REMEDY" : "DRUG";
    const evidenceRef = `master:${drug.code}@${drug.version} — ${drug.source}/${drug.source_version}`.slice(0, 500);
    const saved = await client.query<any>(
      `INSERT INTO bms_pharmacy_product_policies (
         tenant_id,product_sku,product_type,regulatory_framework,regulatory_class,
         regulatory_evidence_source,regulatory_evidence_ref,sale_policy,max_quantity,status,
         master_drug_id,master_drug_code,master_drug_version,master_drug_suggestion_snapshot,
         master_drug_suggestion_applied_at,master_drug_suggestion_applied_by
       )
       SELECT $1,$2,$3,'DRUG',$4,'MASTER_DRUG_REFERENCE',$5,$6,$7,'DRAFT',
              $8,$9,$10,$11::jsonb,now(),$12
         FROM bms_master_drugs applicable
        WHERE applicable.id=$8 AND applicable.active=TRUE AND applicable.effective_to IS NULL
       ON CONFLICT (tenant_id,product_sku) DO UPDATE SET
         product_type=EXCLUDED.product_type,regulatory_framework='DRUG',
         regulatory_class=EXCLUDED.regulatory_class,
         regulatory_evidence_source='MASTER_DRUG_REFERENCE',
         regulatory_evidence_ref=EXCLUDED.regulatory_evidence_ref,
         sale_policy=EXCLUDED.sale_policy,max_quantity=EXCLUDED.max_quantity,
         status='DRAFT',reviewed_by=NULL,reviewed_at=NULL,
         master_drug_id=EXCLUDED.master_drug_id,
         master_drug_code=EXCLUDED.master_drug_code,
         master_drug_version=EXCLUDED.master_drug_version,
         master_drug_suggestion_snapshot=EXCLUDED.master_drug_suggestion_snapshot,
         master_drug_suggestion_applied_at=now(),
         master_drug_suggestion_applied_by=EXCLUDED.master_drug_suggestion_applied_by,
         updated_at=now()
       WHERE bms_pharmacy_product_policies.status IN ('DRAFT','APPROVED','RETIRED')
       RETURNING *`,
      [input.tenantId, input.productSku, productType, drug.regulatory_class, evidenceRef,
        drug.suggested_sale_policy, drug.suggested_quantity_limit, drug.id, drug.code,
        Number(drug.version), JSON.stringify(snapshot), input.actorId],
    );
    if (!saved.rowCount) throw new Error("PRODUCT_POLICY_PENDING_REVIEW");
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
       VALUES($1,$2,'pharmacy.product_policy.master_suggestion_applied',$3,$4::jsonb)`,
      [input.tenantId, input.actorLabel, input.productSku,
        JSON.stringify({ masterDrugCode: drug.code, masterDrugVersion: Number(drug.version), reviewedByPharmacist: drug.reviewed_by_pharmacist === true })],
    );
    await client.query("COMMIT");
    return { ...saved.rows[0], product_name: product.rows[0].name };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
