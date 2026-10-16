import "server-only";
import type { PoolClient } from "pg";
import { query, runInTransaction } from "@/lib/db";
import { requirePlatformAdmin } from "./platform";
import { getTenantId } from "./tenant";
import { isProductGtin, productBarcodeAliases, type BarcodeSuggestion } from "./productBarcodeLookupContract";

type MasterContext = { admin?: { id?: string; email?: string; tenant_id?: string } };

export type MasterBarcodeInput = {
  id: string;
  name: string;
  brand?: string | null;
  sizeText?: string | null;
  unitCode?: string | null;
  categoryHint?: string | null;
  status: "CANDIDATE" | "APPROVED" | "REJECTED";
};

const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

function mapMasterBarcode(row: any) {
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    brand: row.brand ?? null,
    sizeText: row.size_text ?? null,
    unitCode: row.unit_code ?? null,
    categoryHint: row.category_hint ?? null,
    imageFileId: row.image_file_id == null ? null : String(row.image_file_id),
    source: row.source,
    confirmations: Number(row.confirmations),
    status: row.status,
    updatedAt: row.updated_at,
  };
}
export async function findApprovedMasterBarcode(code: string): Promise<BarcodeSuggestion | null> {
  if (!isProductGtin(code) || /^0?2[0-9]/.test(code)) return null;
  const result = await query<any>(
    `SELECT name,brand,size_text,category_hint
       FROM bms_master_barcodes
      WHERE barcode = ANY($1::text[]) AND status='APPROVED'
      ORDER BY length(barcode) ASC LIMIT 1`,
    [productBarcodeAliases(code)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    name: row.name,
    brand: row.brand ?? null,
    size: row.size_text ?? null,
    // Keep this as review metadata until it can be resolved against the
    // receiving tenant's own category list; it is not product description text.
    description: null,
    imageUrl: null,
    source: "BMS verified barcode",
    sourceUrl: null,
  };
}

export async function submitMasterBarcodeCandidateInTx(client: PoolClient, input: {
  actorId?: string | number | null;
  barcode: string | null;
  name: string;
  brand: string | null;
  sizeText: string | null;
  unitCode: string | null;
  categoryHint: string | null;
  productSku: string;
  confirmed: boolean;
}): Promise<boolean> {
  if (!input.confirmed || !input.barcode || !isProductGtin(input.barcode) || /^0?2[0-9]/.test(input.barcode)) {
    return false;
  }
  const result = await client.query<{ accepted: boolean }>(
    `SELECT public.submit_master_barcode_candidate($1,$2,$3,$4,$5,$6,$7,$8) AS accepted`,
    [input.barcode, input.name, input.brand, input.sizeText, input.unitCode,
      input.categoryHint, input.productSku, input.actorId == null ? null : String(input.actorId)],
  );
  return result.rows[0]?.accepted === true;
}

export async function listMasterBarcodes(args: { search?: string | null; status?: string | null; limit?: number | null }) {
  const search = text(args.search, 120);
  const status = text(args.status, 20).toUpperCase();
  const limit = Math.min(Math.max(Number(args.limit ?? 100), 1), 500);
  const result = await query<any>(
    `SELECT * FROM bms_master_barcodes
      WHERE ($1='' OR barcode ILIKE '%'||$1||'%' OR name ILIKE '%'||$1||'%'
        OR COALESCE(brand,'') ILIKE '%'||$1||'%')
        AND ($2='' OR status=$2)
      ORDER BY CASE status WHEN 'CANDIDATE' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
               confirmations DESC, updated_at DESC
      LIMIT $3`,
    [search, status, limit],
  );
  return result.rows.map(mapMasterBarcode);
}

export async function reviewMasterBarcode(ctx: MasterContext, input: MasterBarcodeInput) {
  await requirePlatformAdmin(ctx);
  const actorId = String(ctx.admin?.id || "");
  if (!actorId) throw new Error("Unauthenticated");
  const status = text(input.status, 20).toUpperCase();
  const name = text(input.name, 200);
  if (!input.id || !name || !["CANDIDATE", "APPROVED", "REJECTED"].includes(status)) {
    throw new Error("BARCODE_REVIEW_FIELDS_INVALID");
  }
  return (await runInTransaction(actorId, async (client) => {
    const saved = await client.query<any>(
      `UPDATE bms_master_barcodes SET
         name=$2,brand=NULLIF($3,''),size_text=NULLIF($4,''),unit_code=NULLIF($5,''),
         category_hint=NULLIF($6,''),status=$7,
         source=CASE WHEN source='MERCHANT_CONFIRMED' THEN source ELSE 'PLATFORM_CURATED' END,
         updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [input.id, name, text(input.brand, 120), text(input.sizeText, 80),
        text(input.unitCode, 3).toUpperCase(), text(input.categoryHint, 120), status],
    );
    if (!saved.rowCount) throw new Error("BARCODE_NOT_FOUND");
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
       VALUES($1,$2,'platform.master_data.barcode_review',$3,$4::jsonb)`,
      [getTenantId(ctx), String(ctx.admin?.email || actorId), input.id,
        JSON.stringify({ barcode: saved.rows[0].barcode, status })],
    );
    return mapMasterBarcode(saved.rows[0]);
  })).result;
}

