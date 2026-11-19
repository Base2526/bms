// Sourced product facts. Customer reads see only independently published revisions.
import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { insertAuditInTx } from "./audit";

export type TechnicalSpecInput = {
  sku: string;
  variantCode: string;
  lengthMm?: number | null;
  widthMm?: number | null;
  diameterMm?: number | null;
  thicknessMm?: number | null;
  nominalWeightG?: number | null;
  grade?: string | null;
  standardCode?: string | null;
  usageLimitations?: string | null;
  sourceReference: string;
  requestKey: string;
};

export type TechnicalSpecResult = { status: "DRAFT" | "PUBLISHED" | "INVALID_INPUT" | "VARIANT_NOT_FOUND"
  | "NOT_FOUND" | "SECOND_REVIEWER_REQUIRED" | "IDEMPOTENCY_CONFLICT" | "ACTOR_FORBIDDEN";
  revisionNo?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dimension = (value: unknown): string | null | undefined => {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000_000
    || Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-7) return undefined;
  return value.toFixed(3);
};
const shortText = (value: unknown, max: number): string | null | undefined => {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length && trimmed.length <= max ? trimmed : undefined;
};
type Normalized = {
  sku: string; variantCode: string; lengthMm: string | null; widthMm: string | null;
  diameterMm: string | null; thicknessMm: string | null; nominalWeightG: string | null;
  grade: string | null; standardCode: string | null; usageLimitations: string | null;
  sourceReference: string; requestKey: string;
};
function normalize(raw: TechnicalSpecInput): Normalized | null {
  if (!raw || typeof raw.sku !== "string" || !raw.sku.trim()
    || typeof raw.variantCode !== "string" || !raw.variantCode.trim()
    || raw.variantCode.trim().length > 64 || typeof raw.requestKey !== "string"
    || raw.requestKey.trim().length < 8 || raw.requestKey.trim().length > 200) return null;
  const lengthMm = dimension(raw.lengthMm), widthMm = dimension(raw.widthMm);
  const diameterMm = dimension(raw.diameterMm), thicknessMm = dimension(raw.thicknessMm);
  const nominalWeightG = dimension(raw.nominalWeightG);
  const grade = shortText(raw.grade, 120), standardCode = shortText(raw.standardCode, 120);
  const usageLimitations = shortText(raw.usageLimitations, 1000);
  const sourceReference = shortText(raw.sourceReference, 500);
  if ([lengthMm,widthMm,diameterMm,thicknessMm,nominalWeightG,grade,standardCode,usageLimitations,sourceReference]
    .some((value) => value === undefined) || !sourceReference || sourceReference.length < 3
    || [lengthMm,widthMm,diameterMm,thicknessMm,nominalWeightG,grade,standardCode,usageLimitations]
      .every((value) => value == null)) return null;
  return { sku: raw.sku.trim(), variantCode: raw.variantCode.trim(), lengthMm: lengthMm!, widthMm: widthMm!,
    diameterMm: diameterMm!, thicknessMm: thicknessMm!, nominalWeightG: nominalWeightG!,
    grade: grade!, standardCode: standardCode!, usageLimitations: usageLimitations!,
    sourceReference, requestKey: raw.requestKey.trim() };
}

async function actorAllowed(client: PoolClient, tenantId: string, actorId: string) {
  const res = await client.query(
    `SELECT 1 FROM users WHERE id=$2 AND (tenant_id=$1 OR is_platform_admin) LIMIT 1`,
    [tenantId,actorId]
  );
  return Boolean(res.rowCount);
}

export async function stageTechnicalSpecs(tenantId: string, actorId: string,
  raw: TechnicalSpecInput): Promise<TechnicalSpecResult> {
  const input = normalize(raw);
  if (!input || !UUID.test(actorId)) return { status: "INVALID_INPUT" };
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    if (!(await actorAllowed(client,tenantId,actorId))) {
      await client.query("ROLLBACK"); return { status: "ACTOR_FORBIDDEN" };
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`product-spec:${tenantId}:${input.requestKey}`]);
    const previous = await client.query<{ request_hash: string; revision_no: number }>(
      `SELECT request_hash,revision_no FROM bms_product_technical_specs
        WHERE tenant_id=$1 AND request_key=$2`, [tenantId,input.requestKey]);
    if (previous.rowCount) {
      await client.query("ROLLBACK");
      return previous.rows[0].request_hash === requestHash
        ? { status: "DRAFT", revisionNo: previous.rows[0].revision_no }
        : { status: "IDEMPOTENCY_CONFLICT" };
    }
    const variant = await client.query(
      `SELECT 1 FROM bms_product_variants v JOIN bms_products p
         ON p.tenant_id=v.tenant_id AND p.sku=v.product_sku
        WHERE v.tenant_id=$1 AND v.product_sku=$2 AND v.code=$3 AND v.active AND p.active
        FOR UPDATE OF v`, [tenantId,input.sku,input.variantCode]);
    if (!variant.rowCount) { await client.query("ROLLBACK"); return { status: "VARIANT_NOT_FOUND" }; }
    const max = await client.query<{ revision_no: number }>(
      `SELECT coalesce(max(revision_no),0)::integer AS revision_no FROM bms_product_technical_specs
        WHERE tenant_id=$1 AND product_sku=$2 AND variant_code=$3`,
      [tenantId,input.sku,input.variantCode]);
    const revisionNo = max.rows[0].revision_no + 1;
    await client.query(`UPDATE bms_product_technical_specs SET status='SUPERSEDED'
      WHERE tenant_id=$1 AND product_sku=$2 AND variant_code=$3 AND status='DRAFT'`,
      [tenantId,input.sku,input.variantCode]);
    await client.query(
      `INSERT INTO bms_product_technical_specs
        (tenant_id,product_sku,variant_code,revision_no,status,length_mm,width_mm,diameter_mm,
         thickness_mm,nominal_weight_g,grade,standard_code,usage_limitations,source_reference,
         recorded_by,request_key,request_hash)
       VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [tenantId,input.sku,input.variantCode,revisionNo,input.lengthMm,input.widthMm,input.diameterMm,
        input.thicknessMm,input.nominalWeightG,input.grade,input.standardCode,input.usageLimitations,
        input.sourceReference,actorId,input.requestKey,requestHash]);
    await insertAuditInTx(client, { tenantId, actor: actorId, actorUserId: actorId,
      actorKind: "STAFF", action: "product.spec.stage", target: input.sku,
      meta: { variantCode: input.variantCode, revisionNo, sourceRecorded: true } });
    await client.query("COMMIT");
    return { status: "DRAFT", revisionNo };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function publishTechnicalSpecs(tenantId: string, actorId: string,
  sku: string, variantCode: string, revisionNo: number): Promise<TechnicalSpecResult> {
  if (!UUID.test(actorId) || !sku?.trim() || !variantCode?.trim()
    || !Number.isSafeInteger(revisionNo) || revisionNo < 1) return { status: "INVALID_INPUT" };
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    if (!(await actorAllowed(client,tenantId,actorId))) {
      await client.query("ROLLBACK"); return { status: "ACTOR_FORBIDDEN" };
    }
    const variant = await client.query(
      `SELECT 1 FROM bms_product_variants v JOIN bms_products p
         ON p.tenant_id=v.tenant_id AND p.sku=v.product_sku
        WHERE v.tenant_id=$1 AND v.product_sku=$2 AND v.code=$3 AND v.active AND p.active
        FOR UPDATE OF v`, [tenantId,sku,variantCode]);
    if (!variant.rowCount) { await client.query("ROLLBACK"); return { status: "VARIANT_NOT_FOUND" }; }
    const row = await client.query<{ status: string; recorded_by: string }>(
      `SELECT status,recorded_by FROM bms_product_technical_specs
        WHERE tenant_id=$1 AND product_sku=$2 AND variant_code=$3 AND revision_no=$4 FOR UPDATE`,
      [tenantId,sku,variantCode,revisionNo]);
    if (!row.rowCount) { await client.query("ROLLBACK"); return { status: "NOT_FOUND" }; }
    if (row.rows[0].status === "PUBLISHED") {
      await client.query("ROLLBACK"); return { status: "PUBLISHED", revisionNo };
    }
    if (row.rows[0].status !== "DRAFT") { await client.query("ROLLBACK"); return { status: "NOT_FOUND" }; }
    if (row.rows[0].recorded_by === actorId) {
      await client.query("ROLLBACK"); return { status: "SECOND_REVIEWER_REQUIRED" };
    }
    await client.query(`UPDATE bms_product_technical_specs SET status='SUPERSEDED'
      WHERE tenant_id=$1 AND product_sku=$2 AND variant_code=$3 AND status='PUBLISHED'`,
      [tenantId,sku,variantCode]);
    await client.query(`UPDATE bms_product_technical_specs
      SET status='PUBLISHED',published_by=$5,published_at=now()
      WHERE tenant_id=$1 AND product_sku=$2 AND variant_code=$3 AND revision_no=$4`,
      [tenantId,sku,variantCode,revisionNo,actorId]);
    await insertAuditInTx(client, { tenantId, actor: actorId, actorUserId: actorId,
      actorKind: "STAFF", action: "product.spec.publish", target: sku,
      meta: { variantCode, revisionNo } });
    await client.query("COMMIT");
    return { status: "PUBLISHED", revisionNo };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function listTechnicalSpecs(tenantId: string, sku: string, publishedOnly = false) {
  const res = await query(
    `SELECT product_sku,variant_code,revision_no,status,length_mm,width_mm,diameter_mm,
      thickness_mm,nominal_weight_g,grade,standard_code,usage_limitations,
      ${publishedOnly ? "NULL::text" : "source_reference"} AS source_reference,published_at
      FROM bms_product_technical_specs WHERE tenant_id=$1 AND product_sku=$2
        AND status=${publishedOnly ? "'PUBLISHED'" : "ANY(ARRAY['DRAFT','PUBLISHED'])"}
        ${publishedOnly ? `AND EXISTS (SELECT 1 FROM bms_product_variants v
          WHERE v.tenant_id=bms_product_technical_specs.tenant_id
            AND v.product_sku=bms_product_technical_specs.product_sku
            AND v.code=bms_product_technical_specs.variant_code AND v.active)` : ""}
      ORDER BY variant_code,CASE status WHEN 'DRAFT' THEN 0 ELSE 1 END,revision_no DESC LIMIT 200`,
    [tenantId,sku]
  );
  return res.rows;
}

export async function publishedTechnicalSpecsForTool(tenantId: string, sku: string) {
  try {
    return { status: "VERIFIED" as const, items: await listTechnicalSpecs(tenantId,sku,true) };
  } catch (error) {
    // A staged web deploy may precede its migration; preserve product answers but
    // disclose that technical facts are unavailable rather than claiming none exist.
    if ((error as { code?: string }).code === "42P01") {
      return { status: "UNAVAILABLE" as const, items: [] };
    }
    throw error;
  }
}

export async function searchPublishedTechnicalSpecs(tenantId: string, keyword: string, limit = 10) {
  const term = keyword.trim();
  if (!term || term.length > 100) return { status: "VERIFIED" as const, items: [] };
  try {
    const res = await query(
    `SELECT s.product_sku,s.variant_code,s.revision_no,s.length_mm,s.width_mm,
      s.diameter_mm,s.thickness_mm,s.nominal_weight_g,s.grade,s.standard_code,
      s.usage_limitations,s.published_at,p.name AS product_name
      FROM bms_product_technical_specs s
      JOIN bms_products p ON p.tenant_id=s.tenant_id AND p.sku=s.product_sku AND p.active
      JOIN bms_product_variants v ON v.tenant_id=s.tenant_id AND v.product_sku=s.product_sku
        AND v.code=s.variant_code AND v.active
      WHERE s.tenant_id=$1 AND s.status='PUBLISHED'
        AND EXISTS (SELECT 1 FROM bms_product_sales_surfaces surface
          WHERE surface.tenant_id=s.tenant_id AND surface.product_sku=s.product_sku
            AND surface.surface='ONLINE_ORDER' AND surface.enabled)
        AND (p.sku ILIKE $2 OR p.name ILIKE $2 OR s.grade ILIKE $2
          OR s.standard_code ILIKE $2 OR s.variant_code ILIKE $2)
      ORDER BY p.sku,s.variant_code LIMIT $3`,
    [tenantId,`%${term}%`,Math.max(1,Math.min(Math.floor(limit),20))]
  );
    return { status: "VERIFIED" as const, items: res.rows };
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      return { status: "UNAVAILABLE" as const, items: [] };
    }
    throw error;
  }
}
