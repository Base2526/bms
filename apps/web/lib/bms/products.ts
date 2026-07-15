// =============================================================
// BMS Products & Inventory — admin management service (tenant-scoped)
// =============================================================

import { getClient, query } from "@/lib/db";
import { recordMovement } from "./movements";
import { beginTenantTx } from "./tenant";
import { enforceProductQuota } from "./plans";
import { buildFileUrlById } from "@/lib/storage";

export type ProductRowFull = {
  tenant_id?: string;
  sku: string;
  name: string;
  active: boolean;
  price: string;
  keywords: string[];
  barcode: string | null;
  image_url: string | null;
  description: string | null;
  cost_price: string | null;
  category: string | null;
  brand: string | null;
};

export type ProductImage = {
  id: number | string;
  url: string;
};

export type VariantRow = {
  size: string;
  current_stock: number;
  reserved_stock: number;
  reorder_point: number;
};

export type ListProductsOpts = {
  search?: string;
  category?: string | null;
  limit?: number;
  offset?: number;
};

export async function listProducts(
  tenantId: string, opts: ListProductsOpts = {}
): Promise<{ items: ProductRowFull[]; total: number }> {
  const s = (opts.search ?? "").trim();
  const category = opts.category?.trim() || null;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const conds = ["tenant_id = $1"];
  const params: any[] = [tenantId];

  if (s) {
    params.push(`%${s}%`);
    const p = `$${params.length}`;
    conds.push(`(name ILIKE ${p} OR sku ILIKE ${p} OR barcode ILIKE ${p})`);
  }
  if (category) {
    params.push(category);
    conds.push(`category = $${params.length}`);
  }
  const where = conds.join(" AND ");

  const totalRes = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM bms_products WHERE ${where}`,
    params
  );
  const total = Number(totalRes.rows[0]?.total || 0);

  const limitPos = params.length + 1;
  const offsetPos = params.length + 2;
  const itemsRes = await query<ProductRowFull>(
    `SELECT tenant_id, sku, name, active, price, keywords, barcode,
            image_url, description, cost_price, category, brand
       FROM bms_products WHERE ${where}
      ORDER BY name
      LIMIT $${limitPos} OFFSET $${offsetPos}`,
    [...params, limit, offset]
  );

  return { items: itemsRes.rows, total };
}

export async function listVariants(tenantId: string, sku: string): Promise<VariantRow[]> {
  const res = await query<VariantRow>(
    `SELECT size, current_stock, reserved_stock, reorder_point
       FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2
      ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], size), size`,
    [tenantId, sku]
  );
  return res.rows;
}

export type UpsertProductInput = {
  sku: string;
  name: string;
  price: number;
  keywords?: string[];
  active?: boolean;
  barcode?: string | null;
  image_url?: string | null;
  description?: string | null;
  cost_price?: number | null;
  category?: string | null;
  brand?: string | null;
  image_urls?: string[] | null;
};

function normalizeImageUrls(input: UpsertProductInput): string[] {
  const raw = Array.isArray(input.image_urls)
    ? input.image_urls
    : input.image_url
      ? [input.image_url]
      : [];

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of raw) {
    const url = typeof item === "string" ? item.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

function extractFileIdFromUrl(url: string): number | null {
  const match = url.match(/\/api\/files\/(\d+)(?:$|[/?#])/);
  if (!match) return null;
  const fileId = Number(match[1]);
  return Number.isInteger(fileId) && fileId > 0 ? fileId : null;
}

export async function listProductImages(tenantId: string, sku: string): Promise<ProductImage[]> {
  const res = await query<{ file_id: number }>(
    `SELECT file_id
       FROM bms_product_images
      WHERE tenant_id = $1 AND product_sku = $2
      ORDER BY sort_order, id`,
    [tenantId, sku]
  );

  return res.rows.map((row) => ({
    id: row.file_id,
    url: buildFileUrlById(row.file_id),
  }));
}

export async function upsertProduct(tenantId: string, input: UpsertProductInput): Promise<ProductRowFull> {
  const sku = input.sku.trim();
  const name = input.name.trim();
  const price = Number(input.price);
  if (!sku || !name) throw new Error("sku และ name ห้ามว่าง");
  if (!Number.isFinite(price) || price < 0) throw new Error("ราคาไม่ถูกต้อง");

  const keywords = (input.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const active = input.active ?? true;
  const barcode = input.barcode?.trim() || null;
  const imageUrls = normalizeImageUrls(input);
  const imageUrl = imageUrls[0] ?? (input.image_url?.trim() || null);
  const description = input.description?.trim() || null;
  const category = input.category?.trim() || null;
  const brand = input.brand?.trim() || null;

  let costPrice: number | null = null;
  if (input.cost_price != null && input.cost_price !== ("" as any)) {
    costPrice = Number(input.cost_price);
    if (!Number.isFinite(costPrice) || costPrice < 0) throw new Error("ต้นทุนไม่ถูกต้อง");
  }

  // quota: เฉพาะสินค้าใหม่ (sku ยังไม่มีในร้าน) ต้องไม่เกินแพ็กเกจ
  const existing = await query(`SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, sku]);
  if (existing.rowCount === 0) await enforceProductQuota(tenantId);

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const res = await client.query<ProductRowFull>(
      `INSERT INTO bms_products
         (tenant_id, sku, name, price, keywords, active, barcode, image_url, description, cost_price, category, brand)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (tenant_id, sku) DO UPDATE
         SET name = EXCLUDED.name, price = EXCLUDED.price, keywords = EXCLUDED.keywords,
             active = EXCLUDED.active, barcode = EXCLUDED.barcode, image_url = EXCLUDED.image_url,
             description = EXCLUDED.description, cost_price = EXCLUDED.cost_price,
             category = EXCLUDED.category, brand = EXCLUDED.brand, updated_at = now()
       RETURNING tenant_id, sku, name, active, price, keywords, barcode, image_url, description, cost_price, category, brand`,
      [tenantId, sku, name, price, keywords, active, barcode, imageUrl, description, costPrice, category, brand]
    );

    await client.query(
      `DELETE FROM bms_product_images WHERE tenant_id = $1 AND product_sku = $2`,
      [tenantId, sku]
    );

    const imageRows = imageUrls
      .map((url, index) => ({ fileId: extractFileIdFromUrl(url), sortOrder: index }))
      .filter((row): row is { fileId: number; sortOrder: number } => row.fileId != null);

    if (imageRows.length > 0) {
      const values = imageRows.map((_, index) => {
        const base = index * 2;
        return `($1, $2, $${base + 3}, $${base + 4})`;
      }).join(", ");

      await client.query(
        `INSERT INTO bms_product_images (tenant_id, product_sku, file_id, sort_order)
         VALUES ${values}
         ON CONFLICT (tenant_id, product_sku, file_id)
         DO UPDATE SET sort_order = EXCLUDED.sort_order`,
        [tenantId, sku, ...imageRows.flatMap((row) => [row.fileId, row.sortOrder])]
      );
    }

    await client.query("COMMIT");
    return res.rows[0];
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function setProductActive(tenantId: string, sku: string, active: boolean): Promise<boolean> {
  const res = await query(
    `UPDATE bms_products SET active = $3, updated_at = now() WHERE tenant_id = $1 AND sku = $2`,
    [tenantId, sku, active]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function setReorderPoint(
  tenantId: string, sku: string, size: string, reorderPoint: number
): Promise<VariantRow> {
  const rp = Math.max(0, Math.floor(Number(reorderPoint) || 0));
  const res = await query<VariantRow>(
    `UPDATE bms_inventory SET reorder_point = $4, updated_at = now()
      WHERE tenant_id = $1 AND product_sku = $2 AND size = $3
      RETURNING size, current_stock, reserved_stock, reorder_point`,
    [tenantId, sku, size.trim().toUpperCase(), rp]
  );
  if (res.rowCount === 0) throw new Error("ไม่พบไซซ์นี้");
  return res.rows[0];
}

export async function listLowStock(tenantId: string): Promise<
  Array<VariantRow & { sku: string; name: string; available: number }>
> {
  const res = await query<any>(
    `SELECT p.sku, p.name, i.size, i.current_stock, i.reserved_stock, i.reorder_point,
            (i.current_stock - i.reserved_stock) AS available
       FROM bms_inventory i
       JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
      WHERE i.tenant_id = $1
        AND (i.current_stock - i.reserved_stock) <= i.reorder_point
        AND p.active
      ORDER BY available ASC, p.name`,
    [tenantId]
  );
  return res.rows;
}

/**
 * ปรับสต็อก (เติม/ลด current_stock) แบบ atomic ในร้านนั้น — upsert ไซซ์ใหม่ได้
 * ป้องกัน: current ห้ามติดลบ และห้ามต่ำกว่า reserved
 */
export async function adjustStock(
  tenantId: string, sku: string, size: string, delta: number,
  note?: string | null, actor?: string | null
): Promise<VariantRow> {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("delta ต้องเป็นจำนวนเต็มที่ไม่ใช่ 0");
  const sizeUp = size.trim().toUpperCase();

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const prod = await client.query(`SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, sku]);
    if (prod.rowCount === 0) {
      await client.query("ROLLBACK");
      throw new Error(`ไม่พบสินค้า ${sku}`);
    }

    const cur = await client.query<VariantRow>(
      `SELECT size, current_stock, reserved_stock, reorder_point
         FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2 AND size = $3 FOR UPDATE`,
      [tenantId, sku, sizeUp]
    );

    let row: VariantRow;
    if (cur.rowCount === 0) {
      if (delta < 0) {
        await client.query("ROLLBACK");
        throw new Error("ยังไม่มีไซซ์นี้ ลดสต็อกไม่ได้");
      }
      const ins = await client.query<VariantRow>(
        `INSERT INTO bms_inventory (tenant_id, product_sku, size, current_stock, reserved_stock)
         VALUES ($1, $2, $3, $4, 0)
         RETURNING size, current_stock, reserved_stock, reorder_point`,
        [tenantId, sku, sizeUp, delta]
      );
      row = ins.rows[0];
    } else {
      const next = cur.rows[0].current_stock + delta;
      if (next < cur.rows[0].reserved_stock) {
        await client.query("ROLLBACK");
        throw new Error(`ลดไม่ได้: current (${next}) จะต่ำกว่าที่จองไว้ (reserved ${cur.rows[0].reserved_stock})`);
      }
      const upd = await client.query<VariantRow>(
        `UPDATE bms_inventory SET current_stock = current_stock + $4, updated_at = now()
          WHERE tenant_id = $1 AND product_sku = $2 AND size = $3
          RETURNING size, current_stock, reserved_stock, reorder_point`,
        [tenantId, sku, sizeUp, delta]
      );
      row = upd.rows[0];
    }

    await recordMovement(client, {
      tenantId, sku, size: sizeUp,
      type: delta > 0 ? "STOCK_IN" : "STOCK_OUT",
      qty: Math.abs(delta), note: note ?? null, actor: actor ?? "admin",
    });

    await client.query("COMMIT");
    return row;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
