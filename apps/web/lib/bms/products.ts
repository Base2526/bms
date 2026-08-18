// =============================================================
// BMS Products & Inventory — admin management service (tenant-scoped)
// =============================================================

import { getClient, query } from "@/lib/db";
import { recordMovement } from "./movements";
import { markRestockSubscriptionsReady } from "./restockSubscriptions";
import { beginTenantTx } from "./tenant";
import { resolveDefaultLocationIdInTx } from "./locations";
import { enforceProductQuota } from "./plans";
import { buildFileUrlById } from "@/lib/storage";
import type { VatCategory } from "./vat";
import { IN_STORE_PREFIX, inStoreBarcode, isInStoreBarcode } from "./barcode";

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
  weight_grams: number | null;
  category: string | null;
  brand: string | null;
  /** 7.88 · เขียนได้ตั้งแต่มีช่องในฟอร์มสินค้า */
  vat_category?: VatCategory;
  created_at: Date | string;
  updated_at: Date | string;
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
  activeOnly?: boolean;
  sort?: "relevance" | "newest" | "name";
};

export async function listProducts(
  tenantId: string, opts: ListProductsOpts = {}
): Promise<{ items: ProductRowFull[]; total: number }> {
  const s = (opts.search ?? "").trim();
  const normalizedSearch = s.toLowerCase();
  const category = opts.category?.trim() || null;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const conds = ["tenant_id = $1"];
  const params: any[] = [tenantId];

  if (s) {
    params.push(`%${s}%`);
    const p = `$${params.length}`;
    // P-0.5: match keywords[] ด้วย (เดิม match แค่ name/sku/barcode ทำให้ alias ที่ร้านตั้งไว้
    // ใน bms_products.keywords ใช้ไม่ได้กับ AI tool-calling path เลย — มี GIN index อยู่แล้ว
    // ดู db/migrations/3.2__bms_products_inventory.sql)
    conds.push(
      `(name ILIKE ${p} OR sku ILIKE ${p} OR barcode ILIKE ${p} OR category ILIKE ${p} OR brand ILIKE ${p} OR EXISTS (
         SELECT 1 FROM unnest(keywords) AS k WHERE k ILIKE ${p}
       ))`
    );
  }
  if (category) {
    params.push(category);
    conds.push(`category = $${params.length}`);
  }
  if (opts.activeOnly) {
    conds.push("active = TRUE");
  }
  const where = conds.join(" AND ");

  const totalRes = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM bms_products WHERE ${where}`,
    params
  );
  const total = Number(totalRes.rows[0]?.total || 0);

  const limitPos = params.length + 1;
  const offsetPos = params.length + 2;
  const rankSql = s
    ? `
        CASE
          WHEN lower(sku) = lower($${limitPos}) THEN 900
          WHEN lower(name) = lower($${limitPos}) THEN 850
          WHEN lower(COALESCE(barcode, '')) = lower($${limitPos}) THEN 800
          WHEN EXISTS (
            SELECT 1 FROM unnest(keywords) AS k WHERE lower(k) = lower($${limitPos})
          ) THEN 780
          WHEN lower(name) LIKE lower($${limitPos + 1}) THEN 620
          WHEN lower(sku) LIKE lower($${limitPos + 1}) THEN 600
          WHEN EXISTS (
            SELECT 1 FROM unnest(keywords) AS k WHERE lower(k) LIKE lower($${limitPos + 1})
          ) THEN 560
          WHEN category ILIKE $${limitPos + 2} THEN 420
          WHEN brand ILIKE $${limitPos + 2} THEN 400
          ELSE 100
        END AS search_rank
      `
    : `0 AS search_rank`;
  const itemsRes = await query<ProductRowFull>(
    `SELECT tenant_id, sku, name, active, price, keywords, barcode,
            image_url, description, cost_price, weight_grams, category, brand, vat_category, created_at, updated_at,
            ${rankSql}
       FROM bms_products WHERE ${where}
      ORDER BY ${
        opts.sort === "newest"
          ? "created_at DESC, name"
          : opts.sort === "name"
            ? "name"
            : "search_rank DESC, name"
      }
      LIMIT $${s ? limitPos + 3 : limitPos} OFFSET $${s ? limitPos + 4 : offsetPos}`,
    s
      ? [...params, normalizedSearch, `${normalizedSearch}%`, `%${s}%`, limit, offset]
      : [...params, limit, offset]
  );

  return { items: itemsRes.rows, total };
}

export type SellableProduct = {
  sku: string;
  name: string;
  price: number;
  description: string | null;
  category: string | null;
  brand: string | null;
  createdAt: string;
  updatedAt: string;
  availableTotal: number;
  availableSizes: Array<{ size: string; available: number }>;
};

export type ListSellableProductsOpts = {
  search?: string;
  category?: string | null;
  brand?: string | null;
  excludeSku?: string | null;
  size?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  inStockOnly?: boolean;
  /** จำกัดยอดคงเหลือ/ไซซ์ให้สาขานี้ — ใช้โดย POS ซึ่งขายจากเครื่องสาขาเดียว */
  locationId?: string | null;
  sort?: "relevance" | "newest" | "availability";
  limit?: number;
};

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Customer-sale catalog view. It always excludes inactive products, derives availability from
 * inventory, and returns bounded fields that an AI/shopfront can safely use in a sales response.
 * There is no cache: a newly inserted active product is visible on the next call.
 */
export async function listSellableProducts(
  tenantId: string,
  opts: ListSellableProductsOpts = {}
): Promise<{ items: SellableProduct[]; total: number }> {
  const search = opts.search?.trim() || null;
  const category = opts.category?.trim() || null;
  const brand = opts.brand?.trim() || null;
  const excludeSku = opts.excludeSku?.trim() || null;
  const size = opts.size?.trim() || null;
  const minPrice =
    typeof opts.minPrice === "number" && Number.isFinite(opts.minPrice) ? opts.minPrice : null;
  const maxPrice =
    typeof opts.maxPrice === "number" && Number.isFinite(opts.maxPrice) ? opts.maxPrice : null;
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
  const params: Array<string | number | null> = [
    tenantId,
    search,
    category,
    brand,
    excludeSku,
  ];
  params.push(opts.locationId?.trim() || null);
  const locationParam = params.length;
  // Build optional placeholders in the same order as params. Keeping a fixed $6 for size while
  // omitting its SQL clause leaves a gap before price/limit parameters, which PostgreSQL cannot
  // type-infer when that unused value is null.
  let inStockClause = "";
  if (opts.inStockOnly) {
    params.push(size);
    const sizeParam = params.length;
    inStockClause = `AND EXISTS (
         SELECT 1
           FROM bms_inventory sellable_i
          WHERE sellable_i.tenant_id = p.tenant_id
            AND sellable_i.product_sku = p.sku
            AND ($${locationParam}::uuid IS NULL OR sellable_i.location_id = $${locationParam})
            AND (sellable_i.current_stock - sellable_i.reserved_stock) > 0
            AND ($${sizeParam}::text IS NULL OR sellable_i.size = $${sizeParam})
       )`;
  }
  params.push(minPrice);
  const minPriceParam = params.length;
  params.push(maxPrice);
  const maxPriceParam = params.length;
  params.push(limit);
  const limitParam = params.length;
  const orderBy =
    opts.sort === "newest"
      ? "created_at DESC, name"
      : opts.sort === "availability"
        ? "available_total DESC, updated_at DESC, name"
        : "search_rank DESC, available_total DESC, name";

  const res = await query<{
    sku: string;
    name: string;
    price: string;
    description: string | null;
    category: string | null;
    brand: string | null;
    created_at: Date | string;
    updated_at: Date | string;
    available_total: string;
    available_sizes: Array<{ size: string; available: number }> | string | null;
    total: string;
  }>(
    `WITH matched AS (
       SELECT p.sku,
              p.name,
              p.price,
              p.description,
              p.category,
              p.brand,
              p.created_at,
              p.updated_at,
              CASE
                WHEN $2::text IS NULL THEN 0
                WHEN lower(p.sku) = lower($2) THEN 900
                WHEN lower(p.name) = lower($2) THEN 850
                WHEN lower(COALESCE(p.barcode, '')) = lower($2) THEN 800
                WHEN EXISTS (
                  SELECT 1 FROM unnest(p.keywords) AS k WHERE lower(k) = lower($2)
                ) THEN 780
                WHEN lower(p.name) LIKE lower($2) || '%' THEN 620
                WHEN lower(p.sku) LIKE lower($2) || '%' THEN 600
                WHEN EXISTS (
                  SELECT 1 FROM unnest(p.keywords) AS k
                   WHERE lower(k) LIKE lower($2) || '%'
                ) THEN 560
                WHEN p.category ILIKE '%' || $2 || '%' THEN 420
                WHEN p.brand ILIKE '%' || $2 || '%' THEN 400
                ELSE 100
              END AS search_rank
         FROM bms_products p
        WHERE p.tenant_id = $1
          AND p.active = TRUE
          AND ($2::text IS NULL OR
               lower(p.name) LIKE '%' || lower($2) || '%' OR
               lower(p.sku) LIKE '%' || lower($2) || '%' OR
               p.barcode ILIKE '%' || $2 || '%' OR
               lower(p.category) LIKE '%' || lower($2) || '%' OR
               lower(p.brand) LIKE '%' || lower($2) || '%' OR
               EXISTS (
                 SELECT 1 FROM unnest(p.keywords) AS k WHERE k ILIKE '%' || $2 || '%'
               ))
          AND ($3::text IS NULL OR p.category = $3)
          AND ($4::text IS NULL OR p.brand = $4)
          AND ($5::text IS NULL OR p.sku <> $5)
          AND ($${minPriceParam}::numeric IS NULL OR p.price >= $${minPriceParam})
          AND ($${maxPriceParam}::numeric IS NULL OR p.price <= $${maxPriceParam})
          ${inStockClause}
     )
     SELECT m.sku,
            m.name,
            m.price,
            m.description,
            m.category,
            m.brand,
            m.created_at,
            m.updated_at,
            COALESCE(SUM(GREATEST(i.current_stock - i.reserved_stock, 0)), 0)::text
              AS available_total,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'size', i.size,
                  'available', GREATEST(i.current_stock - i.reserved_stock, 0)
                )
                ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], i.size), i.size
              ) FILTER (WHERE i.size IS NOT NULL),
              '[]'::jsonb
            ) AS available_sizes,
            COUNT(*) OVER()::text AS total
       FROM matched m
       LEFT JOIN bms_inventory i
         ON i.tenant_id = $1
        AND i.product_sku = m.sku
        AND ($${locationParam}::uuid IS NULL OR i.location_id = $${locationParam})
      GROUP BY m.sku, m.name, m.price, m.description, m.category, m.brand,
               m.created_at, m.updated_at, m.search_rank
      ORDER BY ${orderBy}
      LIMIT $${limitParam}`,
    params
  );

  const items = res.rows.map((row) => {
    const parsedSizes =
      typeof row.available_sizes === "string"
        ? (JSON.parse(row.available_sizes) as Array<{ size: string; available: number }>)
        : (row.available_sizes ?? []);
    return {
      sku: row.sku,
      name: row.name,
      price: Number(row.price),
      description: row.description,
      category: row.category,
      brand: row.brand,
      createdAt: isoDate(row.created_at),
      updatedAt: isoDate(row.updated_at),
      availableTotal: Math.max(0, Number(row.available_total) || 0),
      availableSizes: parsedSizes.map((variant) => ({
        size: String(variant.size),
        available: Math.max(0, Number(variant.available) || 0),
      })),
    };
  });
  return { items, total: Number(res.rows[0]?.total ?? 0) };
}

/**
 * Resolve free-form customer text against the same active catalog fields used by AI search.
 * It supports both directions: a product field can contain the query, or a customer sentence can
 * contain the product name/SKU/alias.
 */
export async function resolveSellableProduct(
  tenantId: string,
  text: string
): Promise<Pick<SellableProduct, "sku" | "name" | "price" | "category" | "brand"> | null> {
  const input = text.trim();
  if (!input) return null;
  const res = await query<{
    sku: string;
    name: string;
    price: string;
    category: string | null;
    brand: string | null;
  }>(
    `SELECT p.sku, p.name, p.price, p.category, p.brand
       FROM bms_products p
      WHERE p.tenant_id = $1
        AND p.active = TRUE
        AND (
          lower(p.sku) = lower($2) OR
          lower(p.name) = lower($2) OR
          lower(COALESCE(p.barcode, '')) = lower($2) OR
          $2 ILIKE '%' || p.sku || '%' OR
          $2 ILIKE '%' || p.name || '%' OR
          lower(p.name) LIKE '%' || lower($2) || '%' OR
          lower(p.sku) LIKE '%' || lower($2) || '%' OR
          lower(p.category) LIKE '%' || lower($2) || '%' OR
          lower(p.brand) LIKE '%' || lower($2) || '%' OR
          EXISTS (
            SELECT 1
              FROM unnest(p.keywords) AS k
             WHERE lower(k) = lower($2)
                OR $2 ILIKE '%' || k || '%'
                OR k ILIKE '%' || $2 || '%'
          )
        )
      ORDER BY
        CASE
          WHEN lower(p.sku) = lower($2) THEN 900
          WHEN lower(p.name) = lower($2) THEN 850
          WHEN lower(COALESCE(p.barcode, '')) = lower($2) THEN 800
          WHEN $2 ILIKE '%' || p.sku || '%' THEN 720
          WHEN $2 ILIKE '%' || p.name || '%' THEN 700
          WHEN EXISTS (
            SELECT 1 FROM unnest(p.keywords) AS k WHERE $2 ILIKE '%' || k || '%'
          ) THEN 680
          ELSE 100
        END DESC,
        char_length(p.name) DESC
      LIMIT 1`,
    [tenantId, input]
  );
  const row = res.rows[0];
  return row
    ? {
        sku: row.sku,
        name: row.name,
        price: Number(row.price),
        category: row.category,
        brand: row.brand,
      }
    : null;
}

export async function findAlternativeProducts(
  tenantId: string,
  input: {
    sku?: string | null;
    keyword?: string | null;
    category?: string | null;
    size?: string | null;
    limit?: number;
  }
): Promise<{
  source: Pick<SellableProduct, "sku" | "name" | "price" | "category" | "brand"> | null;
  alternatives: SellableProduct[];
}> {
  const sourceText = input.sku?.trim() || input.keyword?.trim() || "";
  const source = sourceText ? await resolveSellableProduct(tenantId, sourceText) : null;
  const category = input.category?.trim() || source?.category || null;
  const limit = Math.min(Math.max(input.limit ?? 3, 1), 5);
  const seen = new Set<string>(source ? [source.sku] : []);
  const alternatives: SellableProduct[] = [];

  const add = (items: SellableProduct[]) => {
    for (const item of items) {
      if (seen.has(item.sku)) continue;
      seen.add(item.sku);
      alternatives.push(item);
      if (alternatives.length >= limit) break;
    }
  };
  const fetchCandidates = async (size: string | null, scopedCategory: string | null) =>
    listSellableProducts(tenantId, {
      category: scopedCategory,
      excludeSku: source?.sku,
      size,
      inStockOnly: true,
      sort: "availability",
      limit: 20,
    });

  if (input.size?.trim()) add((await fetchCandidates(input.size.trim(), category)).items);
  if (alternatives.length < limit && category) add((await fetchCandidates(null, category)).items);

  alternatives.sort((a, b) => {
    const categoryScore = Number(b.category === source?.category) - Number(a.category === source?.category);
    if (categoryScore !== 0) return categoryScore;
    const brandScore = Number(b.brand === source?.brand) - Number(a.brand === source?.brand);
    if (brandScore !== 0) return brandScore;
    if (source) {
      const priceDistance = Math.abs(a.price - source.price) - Math.abs(b.price - source.price);
      if (priceDistance !== 0) return priceDistance;
    }
    return b.availableTotal - a.availableTotal;
  });

  return { source, alternatives: alternatives.slice(0, limit) };
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
  weight_grams?: number | null;
  category?: string | null;
  brand?: string | null;
  image_urls?: string[] | null;
  /**
   * ประเภท VAT (7.88) — 'V' = คิด VAT · 'N' = ยกเว้น VAT · 'UNKNOWN' = ยังไม่ระบุ
   *
   * คอลัมน์นี้มีมาตั้งแต่ 7.88 และถูกอ่านตอนออกใบกำกับ/ยื่น e-Tax แต่ไม่มีที่ไหน
   * เขียนได้เลย ร้านที่จด VAT จึงติด blocker "ยังไม่ระบุประเภท VAT" ที่
   * /admin/pos-readiness ตลอดไปโดยไม่มีปุ่มให้กดแก้
   *
   * ไม่ส่งมา = ไม่แตะค่าเดิม (สำคัญ: bulk import ที่ไม่มีคอลัมน์นี้ต้องไม่รีเซ็ต
   * สินค้าที่ตั้งค่าไว้แล้วกลับเป็น UNKNOWN)
   */
  vat_category?: VatCategory | null;
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

export type NormalizedProductFields = {
  sku: string;
  name: string;
  price: number;
  keywords: string[];
  active: boolean;
  barcode: string | null;
  description: string | null;
  category: string | null;
  brand: string | null;
  costPrice: number | null;
  weightGrams: number | null;
  /** null = ผู้เรียกไม่ได้ส่งมา → คงค่าเดิมในฐาน (ไม่ใช่ตั้งเป็น UNKNOWN) */
  vatCategory: VatCategory | null;
};

/**
 * แยก validate/normalize field ล้วนๆ ออกจาก upsertProduct (ไม่แตะ DB) เพื่อให้ bulk import
 * ใช้ validate ตัวเดียวกันทั้ง preview (dry-run) และ commit ไม่ให้ 2 เส้นทาง drift กัน
 */
export function validateProductFields(input: UpsertProductInput): NormalizedProductFields {
  const sku = input.sku.trim();
  const name = input.name.trim();
  const price = Number(input.price);
  if (!sku || !name) throw new Error("sku และ name ห้ามว่าง");
  if (!Number.isFinite(price) || price < 0) throw new Error("ราคาไม่ถูกต้อง");

  const keywords = (input.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const active = input.active ?? true;
  const barcode = input.barcode?.trim() || null;
  const description = input.description?.trim() || null;
  const category = input.category?.trim() || null;
  const brand = input.brand?.trim() || null;

  let costPrice: number | null = null;
  if (input.cost_price != null && input.cost_price !== ("" as any)) {
    costPrice = Number(input.cost_price);
    if (!Number.isFinite(costPrice) || costPrice < 0) throw new Error("ต้นทุนไม่ถูกต้อง");
  }

  // น้ำหนัก (กรัม) — ไม่บังคับ; null = ยังไม่ได้กรอก (ต่างจาก 0) → ค่าส่งตามน้ำหนัก
  // จะไม่ถูกคิดและ quoteShipping() จะเตือนแทนการเดาน้ำหนัก
  let weightGrams: number | null = null;
  if (input.weight_grams != null && input.weight_grams !== ("" as any)) {
    weightGrams = Math.trunc(Number(input.weight_grams));
    if (!Number.isFinite(weightGrams) || weightGrams < 0) throw new Error("น้ำหนักไม่ถูกต้อง");
    if (weightGrams > 2_000_000) throw new Error("น้ำหนักเกินความเป็นจริง (สูงสุด 2,000 กก.)");
  }

  // ค่าที่ไม่รู้จักถือว่า "ไม่ได้ส่งมา" ไม่ใช่ throw — bulk import ที่มีคอลัมน์ว่าง
  // หรือพิมพ์ผิดหนึ่งแถวต้องไม่ทำให้ทั้งไฟล์ล้ม แต่ก็ต้องไม่เขียนค่าเพี้ยนลงฐาน
  const rawVat = typeof input.vat_category === "string" ? input.vat_category.trim().toUpperCase() : "";
  const vatCategory: VatCategory | null =
    rawVat === "V" || rawVat === "N" || rawVat === "UNKNOWN" ? (rawVat as VatCategory) : null;

  return { sku, name, price, keywords, active, barcode, description, category, brand, costPrice, weightGrams, vatCategory };
}

export async function upsertProduct(
  tenantId: string,
  input: UpsertProductInput,
  editorId?: string | number | null,
  revisionId?: string | null
): Promise<ProductRowFull> {
  const { sku, name, price, keywords, active, barcode, description, category, brand, costPrice, weightGrams, vatCategory } =
    validateProductFields(input);
  const imageUrls = normalizeImageUrls(input);
  const imageUrl = imageUrls[0] ?? (input.image_url?.trim() || null);

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId, revisionId });

    // ล็อกแถว tenant ก่อนเช็ค quota กันสอง request สร้างสินค้าใหม่พร้อมกันแล้วเกินแพ็กเกจ
    // (เดิมเช็ค quota แยก connection นอก transaction — race ได้ถ้าสร้างพร้อมกันตอนใกล้เต็มโควตา)
    await client.query(`SELECT id FROM bms_tenants WHERE id = $1 FOR UPDATE`, [tenantId]);

    // quota: เฉพาะสินค้าใหม่ (sku ยังไม่มีในร้าน) ต้องไม่เกินแพ็กเกจ
    const existing = await client.query(`SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, sku]);
    if (existing.rowCount === 0) await enforceProductQuota(tenantId, client);

    const res = await client.query<ProductRowFull>(
      `INSERT INTO bms_products
         (tenant_id, sku, name, price, keywords, active, barcode, image_url, description, cost_price, category, brand, weight_grams, vat_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, 'UNKNOWN'))
       ON CONFLICT (tenant_id, sku) DO UPDATE
         SET name = EXCLUDED.name, price = EXCLUDED.price, keywords = EXCLUDED.keywords,
             active = EXCLUDED.active, barcode = EXCLUDED.barcode, image_url = EXCLUDED.image_url,
             description = EXCLUDED.description, cost_price = EXCLUDED.cost_price,
             category = EXCLUDED.category, brand = EXCLUDED.brand,
             weight_grams = EXCLUDED.weight_grams,
             -- $14 IS NULL = ผู้เรียกไม่ได้ส่งมา → คงค่าเดิม · ไม่ใช้ EXCLUDED เพราะ
             -- INSERT ข้างบน COALESCE เป็น 'UNKNOWN' ไปแล้ว การอ้าง EXCLUDED จะทับ
             -- ค่าที่ตั้งไว้ของสินค้าเดิมทุกครั้งที่มีใครกดบันทึกจากฟอร์มที่ไม่มีช่องนี้
             vat_category = COALESCE($14, bms_products.vat_category),
             updated_at = now()
       RETURNING tenant_id, sku, name, active, price, keywords, barcode, image_url, description, cost_price, category, brand, weight_grams, vat_category`,
      [tenantId, sku, name, price, keywords, active, barcode, imageUrl, description, costPrice, category, brand, weightGrams, vatCategory]
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
    const locationId = await resolveDefaultLocationIdInTx(client, tenantId);
    const res = await client.query<VariantRow>(
      `UPDATE bms_inventory SET reorder_point = $4, updated_at = now()
        WHERE tenant_id = $1 AND location_id = $5 AND product_sku = $2 AND size = $3
        RETURNING size, current_stock, reserved_stock, reorder_point`,
      [tenantId, sku, size.trim().toUpperCase(), rp, locationId]
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
  note?: string | null, actor?: string | null, editorId?: string | number | null,
  /**
   * สาขาที่ปรับ — ไม่ระบุ = สาขาเริ่มต้นของร้าน (พฤติกรรมเดิมก่อน 7.98)
   *
   * ก่อนหน้านี้พารามิเตอร์นี้ไม่มี ทั้งฟังก์ชันจึงผูกกับสาขาเริ่มต้นตายตัว แปลว่า
   * ร้านที่มีหลายสาขาปรับสต็อกสาขาอื่นไม่ได้เลย ทั้งที่ 7.84 แยก location_id ไว้แล้ว
   * และ POS แต่ละเครื่องตัดสต็อกตามสาขาตัวเอง — ยอดจึงเพี้ยนโดยไม่มีทางแก้
   */
  locationIdArg?: string | null
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

    // สาขาที่ส่งมาต้องเป็นของร้านนี้จริง — ห้ามเชื่อ id จากผู้เรียกโดยไม่ตรวจ
    // ไม่งั้นร้าน A ปรับสต็อกสาขาของร้าน B ได้ด้วยการเดา uuid
    let locationId: string;
    if (locationIdArg) {
      const loc = await client.query(
        `SELECT id FROM bms_locations WHERE tenant_id = $1 AND id = $2 AND active`,
        [tenantId, locationIdArg]
      );
      if (loc.rowCount === 0) {
        await client.query("ROLLBACK");
        throw new Error("ไม่พบสาขานี้ในร้าน หรือสาขาถูกปิดใช้งาน");
      }
      locationId = loc.rows[0].id;
    } else {
      locationId = await resolveDefaultLocationIdInTx(client, tenantId);
    }

    const cur = await client.query<VariantRow>(
      `SELECT size, current_stock, reserved_stock, reorder_point
         FROM bms_inventory
        WHERE tenant_id = $1 AND location_id = $4 AND product_sku = $2 AND size = $3 FOR UPDATE`,
      [tenantId, sku, sizeUp, locationId]
    );

    let row: VariantRow;
    if (cur.rowCount === 0) {
      if (delta < 0) {
        await client.query("ROLLBACK");
        throw new Error("ยังไม่มีไซซ์นี้ ลดสต็อกไม่ได้");
      }
      const ins = await client.query<VariantRow>(
        `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
         VALUES ($1, $5, $2, $3, $4, 0)
         RETURNING size, current_stock, reserved_stock, reorder_point`,
        [tenantId, sku, sizeUp, delta, locationId]
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
          WHERE tenant_id = $1 AND location_id = $5 AND product_sku = $2 AND size = $3
          RETURNING size, current_stock, reserved_stock, reorder_point`,
        [tenantId, sku, sizeUp, delta, locationId]
      );
      row = upd.rows[0];
    }

    await recordMovement(client, {
      tenantId, locationId, sku, size: sizeUp,
      type: delta > 0 ? "STOCK_IN" : "STOCK_OUT",
      qty: Math.abs(delta), note: note ?? null, actor: actor ?? "admin",
    });

    await client.query("COMMIT");
    if (delta > 0) {
      try {
        await markRestockSubscriptionsReady(tenantId, sku, sizeUp);
      } catch (error) {
        console.error("[BMS] restock ready hook failed after stock adjustment:", error);
      }
    }
    return row;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}


/**
 * ตั้งประเภท VAT ให้สินค้าที่ยังเป็น 'UNKNOWN' ทั้งหมดในคราวเดียว (7.88 + blocker ที่ pos-readiness)
 *
 * ร้านที่มีสินค้าหลายร้อยตัวไล่กดทีละตัวไม่ได้ในทางปฏิบัติ — และ blocker ที่แก้ไม่ได้
 * ก็เท่ากับเปิดร้านไม่ได้ · จงใจแตะเฉพาะแถวที่ยัง UNKNOWN: สินค้าที่มีคนตั้งค่าไว้แล้ว
 * ต้องไม่ถูกปุ่มนี้เขียนทับ ไม่งั้นร้านที่แยก V/N ไว้ถูกต้องแล้วจะพังทั้งร้านด้วยการกดครั้งเดียว
 *
 * ไม่แตะ bms_order_items — บิลที่ออกไปแล้วเก็บ snapshot ของตัวเองไว้ และใบกำกับที่ยื่นแล้ว
 * ต้องไม่เปลี่ยนย้อนหลัง
 */
export async function setVatCategoryForUnknown(
  tenantId: string,
  vatCategory: Exclude<VatCategory, "UNKNOWN">,
  opts?: { activeOnly?: boolean; editorId?: string | number | null }
): Promise<number> {
  if (vatCategory !== "V" && vatCategory !== "N") throw new Error("ประเภท VAT ต้องเป็น V หรือ N");

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: opts?.editorId });
    const res = await client.query(
      `UPDATE bms_products
          SET vat_category = $2, updated_at = now()
        WHERE tenant_id = $1
          AND vat_category = 'UNKNOWN'
          AND ($3::boolean IS NOT TRUE OR active)`,
      [tenantId, vatCategory, opts?.activeOnly ?? true]
    );
    await client.query("COMMIT");
    return res.rowCount ?? 0;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}


/**
 * ออกบาร์โค้ดสำหรับสินค้าที่ไม่มีบาร์โค้ดจากโรงงาน (ของแบ่งขาย/ของทำเอง)
 *
 * **ไม่ใช้กับสินค้าที่มีบาร์โค้ดติดมาแล้ว** — เลขบนขวดเป็นของ GS1 ต้องยิงเข้ามา
 * ถ้าออกเลขใหม่ทับ ระบบจะถือเลขที่ไม่ตรงกับของจริง แล้วพนักงานยิงขวดหาไม่เจอ
 *
 * เดินลำดับต่อจากเลขช่วง 20–29 ที่ร้านใช้ไปแล้วสูงสุด ไม่ใช่สุ่ม — สุ่มแล้วต้องวน
 * ตรวจการชน และยิ่งสินค้ามากยิ่งชนบ่อยขึ้นเงียบ ๆ · ยังตรวจการชนอีกชั้นอยู่ เพราะ
 * ร้านอาจเคยกรอกเลขช่วงนี้เองมาก่อนแบบไม่เรียงลำดับ
 *
 * unique ของ barcode เป็นระดับร้าน (7.99) — สองร้านถือเลขเดียวกันได้ การไล่ลำดับ
 * จึงดูแค่ในร้านตัวเอง
 */
export async function generateInStoreBarcode(tenantId: string): Promise<string> {
  const used = await query<{ barcode: string }>(
    `SELECT barcode FROM bms_products
      WHERE tenant_id = $1 AND barcode ~ '^2[0-9]{12}$'`,
    [tenantId]
  );
  const taken = new Set(used.rows.map((r) => r.barcode));

  // ลำดับถัดไป = สูงสุดที่ใช้แล้ว + 1 (อ่านจาก 10 หลักกลางของเลขที่เป็นรูปแบบเรา)
  let maxSeq = 0;
  for (const code of taken) {
    if (!isInStoreBarcode(code) || !code.startsWith(IN_STORE_PREFIX)) continue;
    const seq = Number(code.slice(2, 12));
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }

  // เผื่อกรณีที่ร้านเคยกรอกเลขช่วงนี้เองแบบไม่เรียง — ขยับต่อจนเจอเลขว่าง
  for (let seq = maxSeq + 1; seq <= maxSeq + 1000; seq += 1) {
    const candidate = inStoreBarcode(seq);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("หาเลขบาร์โค้ดว่างไม่ได้ — ตรวจบาร์โค้ดช่วง 20xxxxxxxxxxx ในร้านนี้");
}
