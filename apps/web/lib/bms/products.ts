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

export type PublicProduct = {
  shop: {
    name: string;
    slug: string;
    logoUrl: string | null;
    website: string | null;
    phone: string | null;
    currency: string;
  };
  product: {
    sku: string;
    name: string;
    price: number;
    description: string | null;
    category: string | null;
    brand: string | null;
    images: string[];
    variants: Array<{ size: string; available: number }>;
    updatedAt: string | null;
  };
};

export type PublicProductCard = {
  sku: string;
  name: string;
  price: number;
  imageUrl: string | null;
  images: string[];
  category: string | null;
  brand: string | null;
  available: number;
};

export type PublicShopCard = {
  slug: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
  phone: string | null;
  currency: string;
  productCount: number;
  updatedAt: string | null;
};

export type PublicShop = {
  slug: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
  phone: string | null;
  currency: string;
  productCount: number;
  updatedAt: string | null;
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

/**
 * Public, read-only product lookup by tenant slug.
 * Exposes sale-safe fields only and never returns inactive tenants/products,
 * cost price, reserved stock, or admin URLs.
 */
export async function getPublicProduct(tenantSlug: string, sku: string): Promise<PublicProduct | null> {
  const slug = tenantSlug.trim().toLowerCase();
  const productSku = sku.trim();
  if (!slug || !productSku || slug.length > 120 || productSku.length > 200) return null;

  const res = await query<any>(
    `SELECT p.tenant_id, p.sku, p.name, p.price, p.image_url, p.description,
            p.category, p.brand, p.updated_at,
            t.name AS tenant_name, t.slug AS tenant_slug,
            sp.logo_url, sp.website, sp.phone, sp.currency
       FROM bms_products p
       JOIN bms_tenants t ON t.id = p.tenant_id
       LEFT JOIN bms_store_profile sp ON sp.tenant_id = p.tenant_id
      WHERE t.slug = $1
        AND t.active = TRUE
        AND p.sku = $2
        AND p.active = TRUE
      LIMIT 1`,
    [slug, productSku]
  );
  const row = res.rows[0];
  if (!row) return null;

  const [gallery, variants] = await Promise.all([
    listProductImages(row.tenant_id, row.sku),
    listVariants(row.tenant_id, row.sku),
  ]);
  const images = Array.from(new Set([
    row.image_url,
    ...gallery.map((image) => image.url),
  ].filter((url): url is string => typeof url === "string" && url.trim().length > 0)));
  const currency = String(row.currency || "THB").trim().toUpperCase();

  return {
    shop: {
      name: row.tenant_name,
      slug: row.tenant_slug,
      logoUrl: row.logo_url ?? null,
      website: row.website ?? null,
      phone: row.phone ?? null,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "THB",
    },
    product: {
      sku: row.sku,
      name: row.name,
      price: Number(row.price),
      description: row.description ?? null,
      category: row.category ?? null,
      brand: row.brand ?? null,
      images,
      variants: variants.map((variant) => ({
        size: variant.size,
        available: Math.max(0, variant.current_stock - variant.reserved_stock),
      })),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ?? null),
    },
  };
}

export async function listPublicRelatedProducts(
  tenantSlug: string,
  currentSku: string,
  opts: { category?: string | null; brand?: string | null; limit?: number } = {}
): Promise<PublicProductCard[]> {
  const slug = tenantSlug.trim().toLowerCase();
  const sku = currentSku.trim();
  const limit = Math.min(Math.max(opts.limit ?? 3, 1), 8);
  if (!slug || !sku || slug.length > 120 || sku.length > 200) return [];

  const runQuery = async (filters: { category?: string | null; brand?: string | null }) => {
    const conds = [
      "t.slug = $1",
      "t.active = TRUE",
      "p.active = TRUE",
      "p.sku <> $2",
    ];
    const params: any[] = [slug, sku];

    if (filters.category?.trim()) {
      params.push(filters.category.trim());
      conds.push(`p.category = $${params.length}`);
    }
    if (filters.brand?.trim()) {
      params.push(filters.brand.trim());
      conds.push(`p.brand = $${params.length}`);
    }

    const limitPos = params.length + 1;
    const where = conds.join(" AND ");
    return query<{
      tenant_id: string;
      sku: string;
      name: string;
      price: string;
      image_url: string | null;
      category: string | null;
      brand: string | null;
      available: string;
    }>(
      `SELECT p.tenant_id, p.sku, p.name, p.price, p.image_url, p.category, p.brand,
              COALESCE(SUM(GREATEST(i.current_stock - i.reserved_stock, 0)), 0)::text AS available
         FROM bms_products p
         JOIN bms_tenants t ON t.id = p.tenant_id
         LEFT JOIN bms_inventory i
           ON i.tenant_id = p.tenant_id
          AND i.product_sku = p.sku
        WHERE ${where}
        GROUP BY p.tenant_id, p.sku, p.name, p.price, p.image_url, p.category, p.brand
        ORDER BY COALESCE(SUM(GREATEST(i.current_stock - i.reserved_stock, 0)), 0) DESC, p.name
        LIMIT $${limitPos}`,
      [...params, limit]
    );
  };

  const res = await runQuery({ category: opts.category, brand: opts.brand });
  const picked = res.rows.length > 0 || (!opts.category && !opts.brand)
    ? res.rows
    : (await runQuery({})).rows;

  return mapPublicProductCards(picked);
}

function normalizeCurrency(value: unknown) {
  const currency = String(value || "THB").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "THB";
}

export async function listPublicShops(limit = 24): Promise<PublicShopCard[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 60);
  const res = await query<{
    slug: string;
    name: string;
    logo_url: string | null;
    website: string | null;
    phone: string | null;
    currency: string | null;
    product_count: string;
    updated_at: Date | string | null;
  }>(
    `SELECT t.slug,
            t.name,
            sp.logo_url,
            sp.website,
            sp.phone,
            sp.currency,
            COUNT(p.sku)::text AS product_count,
            MAX(p.updated_at) AS updated_at
       FROM bms_tenants t
       JOIN bms_products p
         ON p.tenant_id = t.id
        AND p.active = TRUE
       LEFT JOIN bms_store_profile sp
         ON sp.tenant_id = t.id
      WHERE t.active = TRUE
      GROUP BY t.slug, t.name, sp.logo_url, sp.website, sp.phone, sp.currency
      ORDER BY MAX(p.updated_at) DESC NULLS LAST, t.name
      LIMIT $1`,
    [safeLimit]
  );

  return res.rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    logoUrl: row.logo_url ?? null,
    website: row.website ?? null,
    phone: row.phone ?? null,
    currency: normalizeCurrency(row.currency),
    productCount: Math.max(0, Number(row.product_count) || 0),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ?? null),
  }));
}

export async function getPublicShop(tenantSlug: string): Promise<PublicShop | null> {
  const slug = tenantSlug.trim().toLowerCase();
  if (!slug || slug.length > 120) return null;

  const res = await query<{
    slug: string;
    name: string;
    logo_url: string | null;
    website: string | null;
    phone: string | null;
    currency: string | null;
    product_count: string;
    updated_at: Date | string | null;
  }>(
    `SELECT t.slug,
            t.name,
            sp.logo_url,
            sp.website,
            sp.phone,
            sp.currency,
            COUNT(p.sku)::text AS product_count,
            MAX(p.updated_at) AS updated_at
       FROM bms_tenants t
       LEFT JOIN bms_store_profile sp
         ON sp.tenant_id = t.id
       LEFT JOIN bms_products p
         ON p.tenant_id = t.id
        AND p.active = TRUE
      WHERE t.slug = $1
        AND t.active = TRUE
      GROUP BY t.slug, t.name, sp.logo_url, sp.website, sp.phone, sp.currency
      LIMIT 1`,
    [slug]
  );
  const row = res.rows[0];
  if (!row) return null;

  return {
    slug: row.slug,
    name: row.name,
    logoUrl: row.logo_url ?? null,
    website: row.website ?? null,
    phone: row.phone ?? null,
    currency: normalizeCurrency(row.currency),
    productCount: Math.max(0, Number(row.product_count) || 0),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ?? null),
  };
}

export async function listPublicProducts(
  tenantSlug: string,
  opts: { limit?: number } = {}
): Promise<PublicProductCard[]> {
  const slug = tenantSlug.trim().toLowerCase();
  const limit = Math.min(Math.max(opts.limit ?? 48, 1), 120);
  if (!slug || slug.length > 120) return [];

  const res = await query<{
    tenant_id: string;
    sku: string;
    name: string;
    price: string;
    image_url: string | null;
    category: string | null;
    brand: string | null;
    available: string;
  }>(
    `SELECT p.tenant_id,
            p.sku,
            p.name,
            p.price,
            p.image_url,
            p.category,
            p.brand,
            COALESCE(SUM(GREATEST(i.current_stock - i.reserved_stock, 0)), 0)::text AS available
       FROM bms_products p
       JOIN bms_tenants t
         ON t.id = p.tenant_id
       LEFT JOIN bms_inventory i
         ON i.tenant_id = p.tenant_id
        AND i.product_sku = p.sku
      WHERE t.slug = $1
        AND t.active = TRUE
        AND p.active = TRUE
      GROUP BY p.tenant_id, p.sku, p.name, p.price, p.image_url, p.category, p.brand, p.updated_at
      ORDER BY p.updated_at DESC NULLS LAST, p.name
      LIMIT $2`,
    [slug, limit]
  );

  return mapPublicProductCards(res.rows);
}

async function mapPublicProductCards(rows: Array<{
  tenant_id: string;
  sku: string;
  name: string;
  price: string;
  image_url: string | null;
  category: string | null;
  brand: string | null;
  available: string;
}>): Promise<PublicProductCard[]> {
  if (rows.length === 0) return [];

  const tenantId = rows[0]!.tenant_id;
  const skus = rows.map((row) => row.sku);
  const galleryRes = await query<{ product_sku: string; file_id: number }>(
    `SELECT product_sku, file_id
       FROM bms_product_images
      WHERE tenant_id = $1
        AND product_sku = ANY($2::text[])
      ORDER BY product_sku, sort_order, id`,
    [tenantId, skus]
  );

  const galleryMap = new Map<string, string[]>();
  for (const row of galleryRes.rows) {
    const existing = galleryMap.get(row.product_sku) || [];
    existing.push(buildFileUrlById(row.file_id));
    galleryMap.set(row.product_sku, existing);
  }

  return rows.map((row) => {
    const images = Array.from(new Set([
      row.image_url,
      ...(galleryMap.get(row.sku) || []),
    ].filter((url): url is string => typeof url === "string" && url.trim().length > 0)));

    return {
      sku: row.sku,
      name: row.name,
      price: Number(row.price),
      imageUrl: images[0] ?? null,
      images,
      category: row.category ?? null,
      brand: row.brand ?? null,
      available: Math.max(0, Number(row.available) || 0),
    };
  });
}

export async function upsertProduct(
  tenantId: string,
  input: UpsertProductInput,
  editorId?: string | number | null
): Promise<ProductRowFull> {
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
    await beginTenantTx(client, tenantId, { editorId });

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

export async function setProductActive(
  tenantId: string,
  sku: string,
  active: boolean,
  editorId?: string | number | null
): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId });
    const res = await client.query(
      `UPDATE bms_products SET active = $3, updated_at = now() WHERE tenant_id = $1 AND sku = $2`,
      [tenantId, sku, active]
    );
    await client.query("COMMIT");
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function setReorderPoint(
  tenantId: string, sku: string, size: string, reorderPoint: number,
  editorId?: string | number | null
): Promise<VariantRow> {
  const rp = Math.max(0, Math.floor(Number(reorderPoint) || 0));
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId });
    const res = await client.query<VariantRow>(
      `UPDATE bms_inventory SET reorder_point = $4, updated_at = now()
        WHERE tenant_id = $1 AND product_sku = $2 AND size = $3
        RETURNING size, current_stock, reserved_stock, reorder_point`,
      [tenantId, sku, size.trim().toUpperCase(), rp]
    );
    if (res.rowCount === 0) throw new Error("ไม่พบไซซ์นี้");
    await client.query("COMMIT");
    return res.rows[0];
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
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
  note?: string | null, actor?: string | null, editorId?: string | number | null
): Promise<VariantRow> {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("delta ต้องเป็นจำนวนเต็มที่ไม่ใช่ 0");
  const sizeUp = size.trim().toUpperCase();

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId });

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
