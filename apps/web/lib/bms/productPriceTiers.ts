/**
 * บันไดราคาส่งตามจำนวน แยกตามสาขา (`9.65`)
 *
 * `8.1` ทำขั้นราคาไว้ที่ระดับร้านล้วน และ `9.61` แยกโปรโมชันตามสาขาไปแล้วโดยจดค้างไว้ว่า
 * ราคาส่งตามจำนวนยังทำไม่ได้ - ไฟล์นี้คือเส้นทางเขียนของมัน
 *
 * หน่วยของการแก้คือ **บันไดทั้งชุดของ (สินค้า, สาขา)** ไม่ใช่ทีละขั้น เพราะกติกาของ `9.65`
 * คือบันไดของสาขา *แทนที่* บันไดของส่วนกลางทั้งชุด - API ที่แก้ทีละขั้นจะชวนให้เข้าใจว่า
 * ขั้นของสาขากับของส่วนกลางผสมกันได้ ซึ่งเป็นสิ่งที่ตั้งใจไม่ให้เกิด
 *
 * สูตรที่ตัดสินว่าบันไดไหนถูกใช้อยู่ที่ `pricing.ts` (`pickPriceTiersForLocation`) ที่เดียว
 * ทั้งจอพรีวิวและตอน commit อ่านตัวเดียวกัน
 */
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import type { PriceTier } from "./pricing";

export type ProductPriceTierRow = {
  productSku: string;
  productName: string | null;
  locationId: string | null;
  locationName: string | null;
  minQty: number;
  scope: PriceTier["scope"];
  size: string | null;
  unitPrice: number | null;
  discountPct: number | null;
  note: string | null;
  updatedAt: string;
};

const iso = (value: Date | string | null) =>
  value == null ? "" : value instanceof Date ? value.toISOString() : String(value);

function mapRow(row: any): ProductPriceTierRow {
  return {
    productSku: row.product_sku,
    productName: row.product_name ?? null,
    locationId: row.location_id ?? null,
    locationName: row.location_name ?? null,
    minQty: Number(row.min_qty),
    scope: row.scope,
    size: row.size ?? null,
    unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    discountPct: row.discount_pct == null ? null : Number(row.discount_pct),
    note: row.note ?? null,
    updatedAt: iso(row.updated_at),
  };
}

export async function listProductPriceTiers(input: {
  tenantId: string;
  productSku?: string | null;
  /** null = ทุกสาขา (ดูภาพรวม) - มีค่า = บันไดของสาขานั้นบวกของทั้งร้าน */
  locationId?: string | null;
  /** จำกัดสาขาที่ผู้ใช้ดูแลได้ (9.37) - undefined = ไม่จำกัด */
  allowedLocationIds?: readonly string[];
}): Promise<ProductPriceTierRow[]> {
  const sku = String(input.productSku ?? "").trim() || null;
  const res = await query<any>(
    `SELECT tier.product_sku, product.name AS product_name, tier.location_id,
            loc.name AS location_name, tier.min_qty, tier.scope, tier.size,
            tier.unit_price, tier.discount_pct, tier.note, tier.updated_at
       FROM bms_product_price_tiers tier
       LEFT JOIN bms_products product
         ON product.tenant_id = tier.tenant_id AND product.sku = tier.product_sku
       LEFT JOIN bms_locations loc
         ON loc.tenant_id = tier.tenant_id AND loc.id = tier.location_id
      WHERE tier.tenant_id = $1
        AND ($2::text IS NULL OR tier.product_sku = $2)
        AND ($3::uuid IS NULL OR tier.location_id IS NULL OR tier.location_id = $3)
        AND ($4::uuid[] IS NULL OR tier.location_id IS NULL OR tier.location_id = ANY($4::uuid[]))
      ORDER BY tier.product_sku, tier.location_id NULLS FIRST, tier.min_qty`,
    [input.tenantId, sku, input.locationId ?? null,
      input.allowedLocationIds ? [...input.allowedLocationIds] : null]
  );
  return res.rows.map(mapRow);
}

export type PriceTierInput = {
  minQty: number;
  scope: PriceTier["scope"];
  size?: string | null;
  unitPrice?: number | null;
  discountPct?: number | null;
  note?: string | null;
};

/** ตรวจรูปทรงที่ชั้นแอปก่อนถึง CHECK ของฐาน - ข้อความของ Postgres อ่านไม่รู้เรื่องสำหรับคนตั้งราคา */
function normalizeTier(tier: PriceTierInput) {
  const minQty = Math.trunc(Number(tier.minQty));
  if (!Number.isFinite(minQty) || minQty < 2) {
    throw new Error("ขั้นราคาต้องเริ่มที่จำนวนอย่างน้อย 2 ชิ้น");
  }
  if (tier.scope === "CROSS_VARIANT_PERCENT") {
    const pct = Number(tier.discountPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      throw new Error("ส่วนลดแบบเปอร์เซ็นต์ต้องอยู่ระหว่าง 0 ถึง 100");
    }
    return { minQty, scope: "CROSS_VARIANT_PERCENT" as const, size: null,
      unitPrice: null, discountPct: pct, note: String(tier.note ?? "").trim() || null };
  }
  const price = Number(tier.unitPrice);
  if (!Number.isFinite(price) || price < 0) throw new Error("ราคาต่อหน่วยของขั้นราคาไม่ถูกต้อง");
  return { minQty, scope: "PER_VARIANT_FIXED" as const,
    size: String(tier.size ?? "").trim() || null, unitPrice: price, discountPct: null,
    note: String(tier.note ?? "").trim() || null };
}

/**
 * เขียนบันไดทั้งชุดของ (สินค้า, สาขา) ทับของเดิม - ส่งลิสต์ว่างมาคือ "เอาบันไดของสาขานี้ออก"
 * ซึ่งทำให้สาขานั้นกลับไปใช้บันไดของทั้งร้านทันที (นั่นคือความหมายของการไม่มีบันไดของตัวเอง)
 */
export async function replaceProductPriceTiers(input: {
  tenantId: string;
  productSku: string;
  locationId: string | null;
  tiers: readonly PriceTierInput[];
  actorUserId: string;
}): Promise<ProductPriceTierRow[]> {
  const productSku = String(input.productSku ?? "").trim();
  if (!productSku) throw new Error("ไม่ได้ระบุสินค้า");
  const locationId = String(input.locationId ?? "").trim() || null;
  const normalized = input.tiers.map(normalizeTier);
  const seen = new Set<string>();
  for (const tier of normalized) {
    const key = [tier.scope, tier.size ?? "", tier.minQty].join("|");
    if (seen.has(key)) throw new Error(`มีขั้นราคาซ้ำที่จำนวน ${tier.minQty}`);
    seen.add(key);
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const product = await client.query(
      `SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2`,
      [input.tenantId, productSku]
    );
    if (!product.rowCount) throw new Error(`ไม่พบสินค้า ${productSku} ในร้านนี้`);
    if (locationId) {
      const location = await client.query(
        `SELECT 1 FROM bms_locations WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, locationId]
      );
      if (!location.rowCount) throw new Error("ไม่พบสาขานี้ในร้านนี้");
    }
    // ไซซ์ที่อ้างต้องมีจริง ไม่เช่นนั้นขั้นราคานั้นไม่มีวันถูกใช้และไม่มีอะไรบอกว่าทำไม
    const sizes = [...new Set(normalized
      .map((tier) => tier.size)
      .filter((size): size is string => Boolean(size)))];
    if (sizes.length) {
      const known = await client.query<{ code: string }>(
        `SELECT code FROM bms_product_variants
          WHERE tenant_id = $1 AND product_sku = $2 AND code = ANY($3::text[])`,
        [input.tenantId, productSku, sizes]
      );
      const found = new Set(known.rows.map((row) => row.code));
      const missing = sizes.filter((size) => !found.has(size));
      if (missing.length) throw new Error(`ไม่พบไซซ์ของสินค้า: ${missing.join(", ")}`);
    }

    await client.query(
      `DELETE FROM bms_product_price_tiers
        WHERE tenant_id = $1 AND product_sku = $2
          AND location_id IS NOT DISTINCT FROM $3::uuid`,
      [input.tenantId, productSku, locationId]
    );
    for (const tier of normalized) {
      await client.query(
        `INSERT INTO bms_product_price_tiers
           (tenant_id, product_sku, location_id, min_qty, unit_price, scope, discount_pct, size, note)
         VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9)`,
        [input.tenantId, productSku, locationId, tier.minQty, tier.unitPrice, tier.scope,
          tier.discountPct, tier.size, tier.note]
      );
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'product.price_tiers_saved',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, productSku,
        JSON.stringify({ locationId, tierCount: normalized.length })]
    );
    const saved = await client.query<any>(
      `SELECT tier.product_sku, product.name AS product_name, tier.location_id,
              loc.name AS location_name, tier.min_qty, tier.scope, tier.size,
              tier.unit_price, tier.discount_pct, tier.note, tier.updated_at
         FROM bms_product_price_tiers tier
         LEFT JOIN bms_products product
           ON product.tenant_id = tier.tenant_id AND product.sku = tier.product_sku
         LEFT JOIN bms_locations loc
           ON loc.tenant_id = tier.tenant_id AND loc.id = tier.location_id
        WHERE tier.tenant_id = $1 AND tier.product_sku = $2
          AND tier.location_id IS NOT DISTINCT FROM $3::uuid
        ORDER BY tier.min_qty`,
      [input.tenantId, productSku, locationId]
    );
    await client.query("COMMIT");
    return saved.rows.map(mapRow);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
