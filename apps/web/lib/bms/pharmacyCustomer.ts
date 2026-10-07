import { query } from "@/lib/db";
import type { PharmacyCaseStatus } from "./pharmacy/customerAssistancePolicy";
import { normalizeMedicineLabel } from "./productMedicineLabel";

export async function getPharmacyProductFacts(tenantId: string, sku: string, locationId?: string, size?: string) {
  const product = await query<{ sku: string; name: string; medicine_label: unknown; registration_no: string | null;
    approved_policy: { productType: string; regulatoryFramework: string; regulatoryClass: string; salePolicy: string } | null }>(
    `SELECT product.sku, product.name, product.medicine_label,
            CASE WHEN policy.status = 'APPROVED' THEN policy.registration_no END AS registration_no,
            CASE WHEN policy.status = 'APPROVED' THEN jsonb_build_object(
              'productType', policy.product_type, 'regulatoryFramework', policy.regulatory_framework,
              'regulatoryClass', policy.regulatory_class, 'salePolicy', policy.sale_policy
            ) END AS approved_policy
       FROM bms_products product
       JOIN bms_store_profile profile ON profile.tenant_id = product.tenant_id
       LEFT JOIN bms_pharmacy_product_policies policy
         ON policy.tenant_id = product.tenant_id AND policy.product_sku = product.sku
      WHERE product.tenant_id = $1 AND product.sku = $2 AND product.active
        AND profile.business_archetype = 'pharmacy'
        AND EXISTS (SELECT 1 FROM bms_product_sales_surfaces surface
          WHERE surface.tenant_id = product.tenant_id AND surface.product_sku = product.sku
            AND surface.surface = 'CUSTOMER_AI' AND surface.enabled)`, [tenantId, sku]
  );
  const row = product.rows[0];
  if (!row) return null;
  const packs = await query<{ pack_code: string; unit_name: string; base_qty: number; size: string | null }>(
    `SELECT pack_code, unit_name, base_qty, size FROM bms_product_packs
      WHERE tenant_id = $1 AND product_sku = $2 AND active
      ORDER BY size NULLS FIRST, base_qty, pack_code LIMIT 30`, [tenantId, sku]
  );
  let expiry: { earliestDate: string | null; latestDate: string | null; hasUnknownExpiry: boolean } | null = null;
  if (locationId && size) {
    const lots = await query<{ earliest: string | null; latest: string | null; unknown_expiry: boolean }>(
      `SELECT MIN(lot.expiry_date)::text AS earliest, MAX(lot.expiry_date)::text AS latest,
              COALESCE(BOOL_OR(lot.expiry_date IS NULL), false) AS unknown_expiry
         FROM bms_inventory_lots lot
         JOIN bms_locations location ON location.tenant_id = lot.tenant_id AND location.id = lot.location_id AND location.active
         JOIN bms_product_variants variant ON variant.tenant_id = lot.tenant_id
           AND variant.product_sku = lot.product_sku AND variant.code = lot.size AND variant.active
         JOIN bms_store_profile profile ON profile.tenant_id = lot.tenant_id
        WHERE lot.tenant_id = $1 AND lot.product_sku = $2 AND lot.location_id = $3 AND lot.size = $4
          AND lot.qty > 0 AND (lot.expiry_date IS NULL OR lot.expiry_date >=
            (now() AT TIME ZONE COALESCE(NULLIF(profile.timezone, ''), 'Asia/Bangkok'))::date)`,
      [tenantId, sku, locationId, size]
    );
    const summary = lots.rows[0];
    if (summary) expiry = { earliestDate: summary.earliest, latestDate: summary.latest,
      hasUnknownExpiry: summary.unknown_expiry === true };
  }
  return { sku: row.sku, name: row.name, label: normalizeMedicineLabel(row.medicine_label),
    labelSource: "SHOP_TRANSCRIBED_LABEL", registrationNo: row.registration_no,
    approvedPolicy: row.approved_policy ?? null,
    approvedUsageQuotationAvailable: false,
    packs: packs.rows.map((pack) => ({ packCode: pack.pack_code, unitName: pack.unit_name,
      piecesPerPack: Number(pack.base_qty), size: pack.size })),
    expiry, observedAt: new Date().toISOString(),
    note: "Missing label fields are unknown. These facts do not establish clinical equivalence, suitability, dose or permission to sell. Expiry is an unallocated stock snapshot for the selected branch/size, not the lot this customer will receive; confirm the dispensed package with the pharmacist.",
  };
}

/** A shift stamp is historical evidence, never a live attendance/presence guarantee. */
export async function getPharmacyCustomerServiceStatus(tenantId: string) {
  const result = await query<{ id: string; name: string; recorded: boolean }>(
    `SELECT location.id, location.name, EXISTS (
       SELECT 1 FROM bms_pos_shifts shift
        JOIN users pharmacist ON pharmacist.id = shift.pharmacist_user_id
          AND pharmacist.tenant_id = shift.tenant_id AND pharmacist.is_licensed_pharmacist
        JOIN bms_pos_devices device ON device.id = shift.device_id
          AND device.tenant_id = shift.tenant_id AND device.active
        WHERE shift.tenant_id = location.tenant_id AND shift.location_id = location.id
          AND shift.status = 'OPEN'
     ) AS recorded
       FROM bms_locations location
       JOIN bms_store_profile profile ON profile.tenant_id = location.tenant_id
      WHERE location.tenant_id = $1 AND location.active AND profile.business_archetype = 'pharmacy'
      ORDER BY (location.code = 'MAIN') DESC, location.name LIMIT 50`, [tenantId]
  );
  return {
    observedAt: new Date().toISOString(),
    branches: result.rows.map((row) => ({ locationId: row.id, name: row.name,
      pharmacistRecordedOnOpenShift: row.recorded === true, currentPresence: "UNKNOWN" as const })),
    consultationHours: null, estimatedResponseMinutes: null,
    note: "An open shift may record a pharmacist who authorised an earlier sale. It does not confirm current presence or availability; no record does not prove absence. Ask the shop before travelling.",
  };
}

/** Only operational status for this channel's identity: never health fields, staff names or decisions. */
export async function getCustomerPharmacyCaseStatus(tenantId: string, channel: string, customerRef: string, caseReference?: string): Promise<PharmacyCaseStatus[]> {
  if (caseReference !== undefined && !/^(?:[0-9a-f]{8}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(caseReference)) {
    throw new Error("เลขเคสต้องเป็นเลขอ้างอิง 8 ตัวหรือ UUID จากระบบ");
  }
  const result = await query<{ id: string; status: string; expires_at: Date | string | null;
    created_at: Date | string; decision_reason: string | null }>(
    `SELECT assessment.id, assessment.status, assessment.expires_at, assessment.created_at,
            CASE WHEN assessment.decision_reason = 'expired_no_action' THEN 'expired_no_action' END AS decision_reason
       FROM bms_pharmacy_assessments assessment
       JOIN bms_customer_identities identity ON identity.tenant_id = assessment.tenant_id
         AND identity.customer_id = assessment.customer_id
       JOIN bms_customers customer ON customer.tenant_id = identity.tenant_id
         AND customer.id = identity.customer_id AND customer.deleted_at IS NULL
       JOIN bms_store_profile profile ON profile.tenant_id = assessment.tenant_id
      WHERE assessment.tenant_id = $1 AND identity.channel = $2 AND identity.external_ref = $3
        AND assessment.channel_id = $2 AND assessment.deleted_at IS NULL
        AND ($4::text IS NULL OR assessment.id::text = $4 OR left(assessment.id::text, 8) = $4)
        AND profile.business_archetype = 'pharmacy'
      ORDER BY assessment.created_at DESC LIMIT 3`, [tenantId, channel, customerRef, caseReference?.toLowerCase() ?? null]
  );
  const terminal = new Set(["APPROVED", "REJECTED", "REFER_TO_DOCTOR", "EMERGENCY_REFERRAL", "CLOSED"]);
  const iso = (v: Date | string) => v instanceof Date ? v.toISOString() : String(v);
  return result.rows.map((row) => ({
    caseReference: row.id.slice(0, 8), status: row.status, createdAt: iso(row.created_at),
    expiresAt: row.expires_at ? iso(row.expires_at) : null,
    requiresReevaluation: row.decision_reason === "expired_no_action" ||
      (!terminal.has(row.status) && row.expires_at != null && new Date(row.expires_at).getTime() < Date.now()),
  }));
}
