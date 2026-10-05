// =============================================================
// BMS — โปรโมชันต่อสินค้า: อ่าน/เขียน (8.7 · ขอบเขตสาขา 9.61)
// -------------------------------------------------------------
// 8.7 สร้างตารางกับเส้นทาง "อ่าน" ไว้ (orders.ts ตอน commit · pos.ts ตอนพรีวิว)
// แต่ **ไม่เคยมีเส้นทางเขียนในแอปเลย** — มีแต่เทสที่ INSERT ตรง ๆ ลงฐาน แปลว่าไม่มี
// ร้านไหนตั้งโปรได้จริงถ้าไม่เปิด psql ไฟล์นี้คือเส้นทางเขียนตัวแรก
//
// ขอบเขต (9.61): locationId = null → โปรทั้งร้าน · มีค่า → โปรของสาขานั้น และทับ
// โปรทั้งร้านของ SKU เดียวกัน (กติกาอยู่ที่ pickPromotionForLocation() ใน pricing.ts
// ซึ่งเป็นตัวเดียวที่ทั้งจอและ server ใช้)
//
// สิทธิ์: product.edit (เหตุผลของ 8.7 — การตั้งโปรคือการตั้งราคาขายของสินค้านั้น)
// ผู้เรียกต้องตรวจสิทธิ์ + ขอบเขตสาขาของผู้ใช้ (bms_user_allowed_locations) มาก่อน
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { validateCrossSkuProducts } from "./crossSkuPromotions";

export type PromotionKind = "BUY_X_GET_Y" | "N_FOR_PRICE" | "BUY_A_GET_B";

export type ProductPromotionRow = {
  id: string;
  productSku: string;
  productName: string | null;
  locationId: string | null;
  locationName: string | null;
  kind: PromotionKind;
  buyQty: number;
  getQty: number | null;
  bundlePrice: number | null;
  buySize: string | null;
  giftSku: string | null;
  giftSize: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  note: string | null;
  updatedAt: string;
};

const iso = (value: Date | string | null): string | null =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);

function mapRow(row: any): ProductPromotionRow {
  return {
    id: String(row.id),
    productSku: row.product_sku,
    productName: row.product_name ?? null,
    locationId: row.location_id ?? null,
    locationName: row.location_name ?? null,
    kind: row.kind,
    buyQty: Number(row.buy_qty),
    getQty: row.get_qty == null ? null : Number(row.get_qty),
    bundlePrice: row.bundle_price == null ? null : Number(row.bundle_price),
    buySize: row.buy_size ?? null,
    giftSku: row.gift_sku ?? null,
    giftSize: row.gift_size ?? null,
    active: Boolean(row.active),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    note: row.note ?? null,
    updatedAt: iso(row.updated_at) as string,
  };
}

export async function listProductPromotions(
  tenantId: string,
  opts: {
    productSku?: string | null;
    /** ระบุสาขา = เห็นเฉพาะโปรที่มีผลที่สาขานั้น (โปรทั้งร้าน + โปรของสาขานั้น) */
    locationId?: string | null;
    includeInactive?: boolean;
    limit?: number;
  } = {}
): Promise<ProductPromotionRow[]> {
  const limit = Math.min(Math.max(Math.trunc(Number(opts.limit) || 200), 1), 500);
  const res = await query(
    `SELECT promo.*, product.name AS product_name, loc.name AS location_name
       FROM bms_product_promotions promo
       LEFT JOIN bms_products product
         ON product.tenant_id = promo.tenant_id AND product.sku = promo.product_sku
       LEFT JOIN bms_locations loc
         ON loc.tenant_id = promo.tenant_id AND loc.id = promo.location_id
      WHERE promo.tenant_id = $1
        AND ($2::text IS NULL OR promo.product_sku = $2)
        AND ($3::uuid IS NULL OR promo.location_id IS NULL OR promo.location_id = $3)
        AND ($4::boolean OR promo.active)
      ORDER BY promo.active DESC, promo.product_sku,
               (promo.location_id IS NULL) DESC, loc.code NULLS FIRST, promo.updated_at DESC
      LIMIT $5`,
    [
      tenantId,
      opts.productSku?.trim() || null,
      opts.locationId ?? null,
      Boolean(opts.includeInactive),
      limit,
    ]
  );
  return res.rows.map(mapRow);
}

export type UpsertProductPromotionInput = {
  tenantId: string;
  productSku: string;
  /** null = โปรทั้งร้าน */
  locationId?: string | null;
  kind: PromotionKind;
  buyQty: number;
  getQty?: number | null;
  bundlePrice?: number | null;
  buySize?: string | null;
  giftSku?: string | null;
  giftSize?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  note?: string | null;
  actorUserId: string;
};

/**
 * ตรวจซ้ำที่ชั้นแอปก่อนถึง CHECK ของฐาน — ข้อความของ Postgres
 * ("violates check constraint bms_product_promotions_check1") อ่านไม่รู้เรื่อง
 * สำหรับคนที่กำลังตั้งโปรอยู่หน้าจอ
 */
function normalizeInput(input: UpsertProductPromotionInput) {
  const productSku = String(input.productSku ?? "").trim();
  if (!productSku) throw new Error("ต้องระบุสินค้า");
  if (!["BUY_X_GET_Y", "N_FOR_PRICE", "BUY_A_GET_B"].includes(input.kind)) {
    throw new Error("ชนิดโปรโมชันไม่ถูกต้อง");
  }
  const buyQty = Number(input.buyQty);
  if (!Number.isSafeInteger(buyQty) || buyQty < 1) throw new Error("จำนวนที่ต้องซื้อต้องเป็นจำนวนเต็มตั้งแต่ 1");

  let getQty: number | null = null;
  let bundlePrice: number | null = null;
  if (input.kind !== "N_FOR_PRICE") {
    getQty = Number(input.getQty);
    if (!Number.isSafeInteger(getQty) || getQty < 1) throw new Error("จำนวนที่แถมต้องเป็นจำนวนเต็มตั้งแต่ 1");
  } else {
    bundlePrice = Math.round(Number(input.bundlePrice) * 100) / 100;
    if (!Number.isFinite(bundlePrice) || bundlePrice < 0) throw new Error("ราคาชุดต้องไม่ติดลบ");
  }

  const startsAt = input.startsAt?.trim() || null;
  const endsAt = input.endsAt?.trim() || null;
  if (startsAt && Number.isNaN(Date.parse(startsAt))) throw new Error("วันเริ่มโปรไม่ถูกต้อง");
  if (endsAt && Number.isNaN(Date.parse(endsAt))) throw new Error("วันสิ้นสุดโปรไม่ถูกต้อง");
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error("วันสิ้นสุดโปรต้องอยู่หลังวันเริ่ม");
  }

  const buySize = input.kind === "BUY_A_GET_B" ? input.buySize?.trim() || null : null;
  const giftSku = input.kind === "BUY_A_GET_B" ? input.giftSku?.trim() || null : null;
  const giftSize = input.kind === "BUY_A_GET_B" ? input.giftSize?.trim() || null : null;
  if (input.kind === "BUY_A_GET_B" && (!buySize || !giftSku || !giftSize || giftSku === productSku)) {
    throw new Error("เลือกสินค้าที่ซื้อและของแถมคนละ SKU พร้อมระบุไซซ์ทั้งสองสินค้า");
  }
  return {
    productSku,
    locationId: input.locationId ?? null,
    kind: input.kind,
    buyQty,
    getQty,
    bundlePrice,
    buySize, giftSku, giftSize,
    startsAt,
    endsAt,
    note: input.note?.trim() || null,
  };
}

/**
 * หนึ่งขอบเขต (สินค้า × สาขา/ทั้งร้าน) มีโปรที่ใช้งานอยู่ได้ทีละหนึ่งแบบ — การบันทึกซ้ำ
 * จึงเป็นการ "แก้โปรเดิมของขอบเขตนั้น" ไม่ใช่การเพิ่มโปรตัวที่สอง (ตรงกับดัชนี
 * uq_bms_promotions_active_sku_store / _branch ของ 9.61)
 */
export async function upsertProductPromotion(
  input: UpsertProductPromotionInput
): Promise<ProductPromotionRow> {
  const data = normalizeInput(input);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    // Serialize all promotion edits, including a legacy promo racing with a gift promo.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 1041))`, [input.tenantId]);
    // Keep legacy promotions writable during a staged rollout before migration 10.41.
    const schema = await client.query<{ ready: boolean }>(`SELECT COUNT(*) = 3 AS ready
      FROM pg_attribute WHERE attrelid = 'bms_product_promotions'::regclass
        AND attname IN ('buy_size','gift_sku','gift_size') AND NOT attisdropped`);
    const giftSchemaReady = schema.rows[0].ready;
    if (data.kind === "BUY_A_GET_B" && !giftSchemaReady) {
      throw new Error("ต้องอัปเดตฐานข้อมูล 10.41 ก่อนตั้งโปรซื้อ A แถม B");
    }
    if (data.kind === "BUY_A_GET_B") await validateCrossSkuProducts(client, input.tenantId, {
      buySku: data.productSku, buySize: data.buySize!, giftSku: data.giftSku!, giftSize: data.giftSize!,
    });
    const conflict = await client.query(
      `SELECT id FROM bms_product_promotions promo
       WHERE tenant_id=$1 AND active
         AND (location_id IS NULL OR $3::uuid IS NULL OR location_id=$3)
         AND NOT (product_sku=$2 AND location_id IS NOT DISTINCT FROM $3::uuid)
         AND (kind='BUY_A_GET_B' OR $5='BUY_A_GET_B')
         AND (product_sku=ANY($4::text[]) OR to_jsonb(promo)->>'gift_sku'=ANY($4::text[])) LIMIT 1`,
      [input.tenantId, data.productSku, data.locationId, [data.productSku, data.giftSku].filter(Boolean), data.kind],
    );
    if (conflict.rowCount) throw new Error("สินค้านี้อยู่ในโปรที่ทับซ้อนกับโปรแถมข้ามสินค้า กรุณาหยุดโปรเดิมก่อน");

    const product = await client.query(
      `SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2`,
      [input.tenantId, data.productSku]
    );
    if (!product.rowCount) throw new Error(`ไม่พบสินค้า ${data.productSku} ในร้านนี้`);

    if (data.locationId) {
      const location = await client.query(
        `SELECT 1 FROM bms_locations WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, data.locationId]
      );
      if (!location.rowCount) throw new Error("ไม่พบสาขานี้ในร้านนี้");
    }

    const params = [
      input.tenantId, data.productSku, data.locationId, data.kind, data.buyQty,
      data.getQty, data.bundlePrice, data.startsAt, data.endsAt, data.note,
      ...(giftSchemaReady ? [data.buySize, data.giftSku, data.giftSize] : []),
    ];
    const updated = await client.query(
      `UPDATE bms_product_promotions
          SET kind = $4, buy_qty = $5, get_qty = $6, bundle_price = $7,
              starts_at = $8::timestamptz, ends_at = $9::timestamptz,
              note = $10, ${giftSchemaReady ? "buy_size=$11, gift_sku=$12, gift_size=$13," : ""} updated_at = now()
        WHERE tenant_id = $1 AND product_sku = $2 AND active
          AND location_id IS NOT DISTINCT FROM $3::uuid
        RETURNING id`,
      params
    );
    const id = updated.rowCount
      ? updated.rows[0].id
      : (await client.query(
          `INSERT INTO bms_product_promotions
             (tenant_id, product_sku, location_id, kind, buy_qty, get_qty,
              bundle_price, starts_at, ends_at, note${giftSchemaReady ? ", buy_size, gift_sku, gift_size" : ""})
           VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10${giftSchemaReady ? ",$11,$12,$13" : ""})
           RETURNING id`,
          params
        )).rows[0].id;

    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'product.promotion_saved',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, String(id),
        JSON.stringify({
          sku: data.productSku, locationId: data.locationId, kind: data.kind,
          buyQty: data.buyQty, getQty: data.getQty, bundlePrice: data.bundlePrice,
          buySize: data.buySize, giftSku: data.giftSku, giftSize: data.giftSize,
          created: !updated.rowCount,
        })]
    );

    const saved = await client.query(
      `SELECT promo.*, product.name AS product_name, loc.name AS location_name
         FROM bms_product_promotions promo
         LEFT JOIN bms_products product
           ON product.tenant_id = promo.tenant_id AND product.sku = promo.product_sku
         LEFT JOIN bms_locations loc
           ON loc.tenant_id = promo.tenant_id AND loc.id = promo.location_id
        WHERE promo.tenant_id = $1 AND promo.id = $2`,
      [input.tenantId, id]
    );
    await client.query("COMMIT");
    return mapRow(saved.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * ปิดโปร ไม่ใช่ลบทิ้ง — แถวที่ปิดแล้วคือหลักฐานว่าสาขานี้เคยจัดโปรอะไรช่วงไหน
 * ซึ่งเป็นคำถามแรกเวลามาไล่ว่าทำไมยอดขาย/กำไรของเดือนนั้นเป็นแบบนั้น
 */
export async function deactivateProductPromotion(input: {
  tenantId: string;
  id: string;
  actorUserId: string;
}): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const res = await client.query(
      `UPDATE bms_product_promotions
          SET active = FALSE, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND active
        RETURNING product_sku, location_id`,
      [input.tenantId, input.id]
    );
    if (res.rowCount) {
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'product.promotion_deactivated',$3,$4::jsonb)`,
        [input.tenantId, `user:${input.actorUserId}`, String(input.id),
          JSON.stringify({ sku: res.rows[0].product_sku, locationId: res.rows[0].location_id ?? null })]
      );
    }
    await client.query("COMMIT");
    return Boolean(res.rowCount);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
