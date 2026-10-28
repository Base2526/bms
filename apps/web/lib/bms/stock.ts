// =============================================================
// BMS Stock — Backend API (Postgres, real)
// -------------------------------------------------------------
// ตาราง: bms_products, bms_inventory (migration 3.2)
// ทำตาม BUSINESS_RULES.md:
//   Available = Current - Reserved,  stock ห้ามติดลบ,  inactive ขายไม่ได้
//   เวลาลูกค้าสั่ง → reserve (เพิ่ม reserved_stock) ไม่ตัด current ทันที
//
// type StockResult คงเดิม → pipeline / nlu / ai ไม่ต้องแก้
// (findSize ยังเป็น pure function ใช้ใน nlu.ts)
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { qualityStock, usableStockSql } from "./lotQuality";
import {
  resolveDefaultLocationId,
  resolveDefaultLocationIdInTx,
} from "./locations";
import { recordMovement } from "./movements";
import {
  findAlternativeProducts,
  listSellableProducts,
  resolveSellableProduct,
  type SellableProduct,
} from "./products";
import { getVariantBasePrice, listSellablePacksForSize } from "./productPacks";

export type StockAlternative = Pick<
  SellableProduct,
  | "sku"
  | "name"
  | "price"
  | "category"
  | "brand"
  | "availableTotal"
  | "availableSizes"
>;

/**
 * หน่วยขายที่ขายได้นอกจากหน่วยฐาน (7.86) — บอกโมเดลว่าสินค้านี้ยกแผง/ยกกล่องได้
 * `price: null` = ร้านไม่ได้ตั้งราคายกหน่วยไว้ ระบบคิดจากราคาต่อหน่วยฐาน × baseQty
 * โมเดลใช้ได้แค่ `packCode` ห้ามคิดราคาหรือ baseQty เอง
 */
export type StockPackOption = {
  packCode: string;
  unitName: string;
  baseQty: number;
  price: number | null;
};

export type StockResult =
  | {
      status: "AVAILABLE_TO_ORDER";
      availability: "AVAILABLE";
      sku: string;
      name: string;
      price: number;
      size: string;
    }
  | {
      status: "SOLD_OUT_TODAY";
      availability: "SOLD_OUT_TODAY";
      sku: string;
      name: string;
      price: number;
      size: string | null;
    }
  | {
      status: "MENU_SIZE_REQUIRED";
      sku: string;
      name: string;
      price: number;
      sizes: Array<{ size: string; price: number }>;
    }
  | {
      status: "IN_STOCK";
      sku: string;
      name: string;
      price: number;
      size: string;
      available: number;
      /** เว้นไว้เมื่อสินค้านี้ขายเป็นหน่วยฐานอย่างเดียว */
      packs?: StockPackOption[];
    }
  | {
      status: "OUT_OF_STOCK";
      sku: string;
      name: string;
      price: number;
      size: string;
      availableSizes?: Array<{ size: string; available: number }>;
      alternatives?: StockAlternative[];
    }
  | {
      status: "SIZE_UNKNOWN";
      sku: string;
      name: string;
      price: number;
      sizes: Array<{ size: string; available: number; price: number }>;
    }
  | { status: "NOT_FOUND"; query: string; alternatives?: StockAlternative[] };

const SIZE_TOKENS = ["XXL", "XL", "L", "M", "S"];

/** ดึงไซซ์ออกจากข้อความ เช่น "Nike XL มีไหม" → "XL" (pure, ใช้ใน nlu.ts) */
export function findSize(text: string): string | null {
  const t = ` ${text.toUpperCase()} `;
  for (const size of SIZE_TOKENS) {
    const re = new RegExp(`(^|[^A-Z])${size}([^A-Z]|$)`);
    if (re.test(t)) return size;
  }
  return null;
}

export type ProductRow = { sku: string; name: string; price: string };

export type BranchStockOverview = {
  sellableSkuCount: number;
  lowStockCount: number;
  lowStock: Array<{
    sku: string;
    name: string;
    size: string;
    available: number;
    reorderPoint: number;
  }>;
};

export type BranchStockSearchItem = {
  sku: string;
  name: string;
  size: string;
  locationId: string;
  locationName: string;
  currentStock: number;
  reservedStock: number;
  quarantineStock: number;
  available: number;
  incomingStock: number;
  reorderPoint: number;
  stockPolicy: string;
  baseUnit: string;
  displayUnit: string | null;
  displayPrecision: number;
  lotTracked: boolean;
  expiryTracked: boolean;
  serialTracked: boolean;
  bundle: boolean;
  transferSupported: boolean;
  countSupported: boolean;
  operationBlockReason: string | null;
};

export type BranchStockSearchResult = {
  items: BranchStockSearchItem[];
  nextOffset: number | null;
};

function stockOperationSupport(row: {
  stock_policy: string;
  lot_tracked: boolean;
  expiry_tracked: boolean;
  serial_tracked: boolean;
  is_bundle: boolean;
}): { supported: boolean; reason: string | null } {
  if (row.serial_tracked || row.stock_policy === "SERIALIZED") {
    return {
      supported: false,
      reason: "สินค้านี้ติดตาม Serial และต้องใช้ workflow เฉพาะ",
    };
  }
  if (row.lot_tracked || row.expiry_tracked) {
    return {
      supported: false,
      reason:
        "สินค้านี้ติดตามล็อต/วันหมดอายุ และยังไม่รองรับการโอนหรือนับแบบยอดรวม",
    };
  }
  if (row.is_bundle || row.stock_policy === "BUNDLE") {
    return {
      supported: false,
      reason: "สินค้าชุดตัดสต็อกจากส่วนประกอบ ไม่ได้ถือสต็อกที่ตัวชุด",
    };
  }
  if (["RECIPE", "NON_STOCK"].includes(row.stock_policy)) {
    return { supported: false, reason: "สินค้านี้ไม่ได้ถือสต็อกโดยตรง" };
  }
  return { supported: true, reason: null };
}

/**
 * Bounded, device-branch stock lookup for the native stock workspace.
 *
 * This is an operational inventory read, not the sales catalog: ingredients and unpublished
 * direct-stock products may still need counting. Tenant/location authority is supplied by the
 * authenticated POS adapter, while this service repeats both predicates on every source table.
 */
export async function searchBranchStock(input: {
  tenantId: string;
  locationId: string;
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<BranchStockSearchResult> {
  const rawSearch = String(input.search ?? "")
    .trim()
    .slice(0, 200);
  const likeSearch = rawSearch.replace(/[\\%_]/g, (value) => `\\${value}`);
  const limit = Math.min(
    Math.max(Math.trunc(Number(input.limit ?? 30)), 1),
    50,
  );
  const offset = Math.min(
    Math.max(Math.trunc(Number(input.offset ?? 0)), 0),
    100_000,
  );
  const result = await query<{
    sku: string;
    name: string;
    size: string;
    location_id: string;
    location_name: string;
    current_stock: number;
    reserved_stock: number;
    quarantine_stock: number;
    available: number;
    incoming_stock: number;
    reorder_point: number;
    stock_policy: string;
    base_unit: string;
    display_unit: string | null;
    display_precision: number;
    lot_tracked: boolean;
    expiry_tracked: boolean;
    serial_tracked: boolean;
    is_bundle: boolean;
  }>(
    `SELECT i.product_sku AS sku,
            p.name,
            i.size,
            i.location_id,
            location.name AS location_name,
            i.current_stock::int,
            i.reserved_stock::int,
            COALESCE(i.quarantine_stock, 0)::int AS quarantine_stock,
            ${usableStockSql("i")} AS available,
            COALESCE((
              SELECT sum(item.qty)::int
                FROM bms_stock_transfers transfer
                JOIN bms_stock_transfer_items item
                  ON item.tenant_id = transfer.tenant_id AND item.transfer_id = transfer.id
               WHERE transfer.tenant_id = i.tenant_id
                 AND transfer.to_location = i.location_id
                 AND transfer.status = 'IN_TRANSIT'
                 AND item.product_sku = i.product_sku
                 AND item.size = i.size
            ), 0)::int AS incoming_stock,
            i.reorder_point::int,
            COALESCE(policy.stock_policy,
              CASE WHEN p.is_bundle THEN 'BUNDLE' ELSE 'DIRECT' END) AS stock_policy,
            COALESCE(policy.base_unit, 'PIECE') AS base_unit,
            policy.display_unit,
            COALESCE(policy.display_precision, 0)::int AS display_precision,
            COALESCE(policy.lot_tracking, false) AS lot_tracked,
            COALESCE(policy.expiry_tracking, false) AS expiry_tracked,
            p.serial_tracked,
            p.is_bundle
       FROM (
         SELECT variant.tenant_id, variant.product_sku, variant.code AS size,
                $2::uuid AS location_id,
                COALESCE(balance.current_stock, 0) AS current_stock,
                COALESCE(balance.reserved_stock, 0) AS reserved_stock,
                COALESCE(balance.quarantine_stock, 0) AS quarantine_stock,
                COALESCE(balance.reorder_point, 0) AS reorder_point
           FROM bms_product_variants variant
           LEFT JOIN bms_inventory balance
             ON balance.tenant_id = variant.tenant_id
            AND balance.product_sku = variant.product_sku
            AND balance.size = variant.code AND balance.location_id = $2
          WHERE variant.tenant_id = $1 AND variant.active
       ) i
       JOIN bms_products p
         ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
       JOIN bms_locations location
         ON location.tenant_id = i.tenant_id AND location.id = i.location_id
       LEFT JOIN bms_product_stock_policies policy
         ON policy.tenant_id = i.tenant_id AND policy.product_sku = i.product_sku
      WHERE i.tenant_id = $1
        AND i.location_id = $2
        AND p.active
        AND (
          $3 = ''
          OR upper(p.sku) = upper($3)
          OR p.barcode = $3
          OR p.name ILIKE '%' || $4 || '%' ESCAPE '\\'
          OR p.sku ILIKE '%' || $4 || '%' ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM bms_product_packs pack
             WHERE pack.tenant_id = p.tenant_id
               AND pack.product_sku = p.sku
               AND pack.active
               AND (pack.size IS NULL OR pack.size = i.size)
               AND (pack.barcode = $3 OR pack.pack_code ILIKE '%' || $4 || '%' ESCAPE '\\')
          )
        )
      ORDER BY CASE
                 WHEN upper(p.sku) = upper($3) OR p.barcode = $3 OR EXISTS (
                   SELECT 1 FROM bms_product_packs exact_pack
                    WHERE exact_pack.tenant_id = p.tenant_id
                      AND exact_pack.product_sku = p.sku
                      AND exact_pack.active AND exact_pack.barcode = $3
                      AND (exact_pack.size IS NULL OR exact_pack.size = i.size)
                 ) THEN 0 ELSE 1
               END,
               p.name, p.sku, i.size
      LIMIT $5 OFFSET $6`,
    [
      input.tenantId,
      input.locationId,
      rawSearch,
      likeSearch,
      limit + 1,
      offset,
    ],
  );
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map((row) => {
      const support = stockOperationSupport(row);
      return {
        sku: row.sku,
        name: row.name,
        size: row.size,
        locationId: row.location_id,
        locationName: row.location_name,
        currentStock: Number(row.current_stock),
        reservedStock: Number(row.reserved_stock),
        quarantineStock: Number(row.quarantine_stock),
        available: Number(row.available),
        incomingStock: Number(row.incoming_stock),
        reorderPoint: Number(row.reorder_point),
        stockPolicy: row.stock_policy,
        baseUnit: row.base_unit,
        displayUnit: row.display_unit,
        displayPrecision: Number(row.display_precision),
        lotTracked: Boolean(row.lot_tracked),
        expiryTracked: Boolean(row.expiry_tracked),
        serialTracked: Boolean(row.serial_tracked),
        bundle: Boolean(row.is_bundle),
        transferSupported: support.supported,
        countSupported: support.supported,
        operationBlockReason: support.reason,
      };
    }),
    nextOffset: hasMore ? offset + limit : null,
  };
}

/**
 * ภาพรวมสต็อกที่ขายได้ของสาขาเครื่อง POS เท่านั้น
 *
 * RECIPE/NON_STOCK มี variant ใน catalog แต่สต็อกของ SKU หลักเป็นศูนย์โดยตั้งใจ จึงห้ามเอา
 * มาปนใน "ใกล้หมด" ไม่เช่นนั้นร้านอาหาร/บอร์ดเกมจะเห็นเมนูปรุงสดเป็นของขาดทุกชิ้น
 * locationId มาจาก device scope ที่ adapter ยืนยันแล้ว และทุก statement ยังผูก tenant ซ้ำ
 */
export async function getBranchStockOverview(
  tenantId: string,
  locationId: string,
  limit = 8,
): Promise<BranchStockOverview> {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  const inventoryCte = `
    FROM bms_inventory i
    JOIN bms_products p
      ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
    LEFT JOIN bms_product_stock_policies policy
      ON policy.tenant_id = i.tenant_id AND policy.product_sku = i.product_sku
   WHERE i.tenant_id = $1
     AND i.location_id = $2
     AND p.active
     AND EXISTS (
       SELECT 1
         FROM bms_product_sales_surfaces surface
        WHERE surface.tenant_id = p.tenant_id
          AND surface.product_sku = p.sku
          AND surface.surface = 'RETAIL_POS'
          AND surface.enabled
     )
     AND COALESCE(policy.stock_policy, 'DIRECT') NOT IN ('RECIPE', 'NON_STOCK')`;
  const [summary, lowStock] = await Promise.all([
    query<{ sellable_sku_count: number; low_stock_count: number }>(
      `SELECT
         COUNT(DISTINCT i.product_sku)
           FILTER (WHERE ${usableStockSql('i')} > 0)::int
           AS sellable_sku_count,
         COUNT(*)
           FILTER (WHERE ${usableStockSql('i')} <= i.reorder_point)::int
           AS low_stock_count
       ${inventoryCte}`,
      [tenantId, locationId],
    ),
    query<{
      sku: string;
      name: string;
      size: string;
      available: number;
      reorder_point: number;
    }>(
      `SELECT i.product_sku AS sku,
              p.name,
              i.size,
              ${usableStockSql('i')} AS available,
              i.reorder_point::int AS reorder_point
       ${inventoryCte}
        AND ${usableStockSql('i')} <= i.reorder_point
      ORDER BY ${usableStockSql('i')} ASC, p.name, i.size
      LIMIT $3`,
      [tenantId, locationId, boundedLimit],
    ),
  ]);
  return {
    sellableSkuCount: Number(summary.rows[0]?.sellable_sku_count ?? 0),
    lowStockCount: Number(summary.rows[0]?.low_stock_count ?? 0),
    lowStock: lowStock.rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      size: row.size,
      available: Number(row.available),
      reorderPoint: Number(row.reorder_point),
    })),
  };
}

/** Resolve against the shared active catalog search (name/SKU/barcode/category/brand/aliases). */
export async function resolveProduct(
  tenantId: string,
  text: string,
): Promise<ProductRow | null> {
  const product = await resolveSellableProduct(tenantId, text);
  return product
    ? { sku: product.sku, name: product.name, price: String(product.price) }
    : null;
}

/**
 * Backend API — เช็คสต็อกที่ขายได้จริงจาก Postgres
 * เช่น productText="Nike XL มีไหม", size="XL" → { status:"IN_STOCK", available:5 }
 */
export async function checkStock(
  tenantId: string,
  productText: string,
  size: string | null,
  requestedLocationId?: string | null,
): Promise<StockResult> {
  const requested = requestedLocationId?.trim() || null;
  const locationId = requested
    ? (
        await query<{ id: string }>(
          `SELECT id FROM bms_locations
          WHERE tenant_id = $1 AND id::text = $2 AND active`,
          [tenantId, requested],
        )
      ).rows[0]?.id
    : await resolveDefaultLocationId(tenantId);
  if (!locationId) throw new Error("INVALID_OR_INACTIVE_LOCATION");
  const product = await resolveProduct(tenantId, productText);
  if (!product) {
    const { items } = await listSellableProducts(tenantId, {
      inStockOnly: true,
      sort: "availability",
      limit: 3,
      locationId,
    });
    return { status: "NOT_FOUND", query: productText, alternatives: items };
  }

  const menuState = await query<{
    stock_policy: string;
    temporarily_unavailable: boolean;
  }>(
    `SELECT COALESCE(policy.stock_policy, 'DIRECT') AS stock_policy,
            EXISTS (
              SELECT 1 FROM bms_product_menu_unavailability unavailable
               WHERE unavailable.tenant_id = p.tenant_id
                 AND unavailable.location_id = $3
                 AND unavailable.product_sku = p.sku
                 AND unavailable.resets_at > now()
            ) AS temporarily_unavailable
       FROM bms_products p
       LEFT JOIN bms_product_stock_policies policy
         ON policy.tenant_id = p.tenant_id AND policy.product_sku = p.sku
      WHERE p.tenant_id = $1 AND p.sku = $2`,
    [tenantId, product.sku, locationId],
  );
  const policy = menuState.rows[0]?.stock_policy ?? "DIRECT";
  if (menuState.rows[0]?.temporarily_unavailable) {
    return {
      status: "SOLD_OUT_TODAY",
      availability: "SOLD_OUT_TODAY",
      sku: product.sku,
      name: product.name,
      price: Number(product.price),
      size,
    };
  }
  if (policy === "NON_STOCK" || policy === "RECIPE") {
    if (!size) {
      // Serving options come from the catalog (bms_product_variants, 9.51), not from branch stock.
      // A NON_STOCK/RECIPE menu deliberately keeps its own inventory at zero, and upsertProduct
      // writes the variant without ever creating a bms_inventory row — so reading inventory here
      // answered "no sizes" for every menu a restaurant had just typed in, which the model cannot
      // recover from because create_order requires a size. listRestaurantMenu() and resolvePosScan()
      // already read the same catalog truth; this keeps all three surfaces on one answer.
      const variants = await query<{ size: string; price: string }>(
        `SELECT variant.code AS size, COALESCE(sized.price, shared.price, p.price)::text AS price
           FROM bms_product_variants variant
           JOIN bms_products p ON p.tenant_id = variant.tenant_id AND p.sku = variant.product_sku
           LEFT JOIN bms_product_packs sized
             ON sized.tenant_id = variant.tenant_id AND sized.product_sku = variant.product_sku
            AND sized.size = variant.code AND sized.is_base AND sized.active
           LEFT JOIN bms_product_packs shared
             ON shared.tenant_id = variant.tenant_id AND shared.product_sku = variant.product_sku
            AND shared.size IS NULL AND shared.is_base AND shared.active
          WHERE variant.tenant_id = $1 AND variant.product_sku = $2 AND variant.active
          ORDER BY variant.sort_order, variant.code`,
        [tenantId, product.sku],
      );
      const sizes = await Promise.all(variants.rows.map(async row => ({
        size: row.size,
        price: (await getVariantBasePrice(tenantId, product.sku, row.size, locationId)) ?? Number(row.price),
      })));
      return {
        status: "MENU_SIZE_REQUIRED",
        sku: product.sku,
        name: product.name,
        price: sizes.length ? Math.min(...sizes.map(row => row.price)) : Number(product.price),
        sizes,
      };
    }
    const price =
      (await getVariantBasePrice(tenantId, product.sku, size, locationId)) ??
      Number(product.price);
    return {
      status: "AVAILABLE_TO_ORDER",
      availability: "AVAILABLE",
      sku: product.sku,
      name: product.name,
      price,
      size,
    };
  }

  if (!size) {
    const res = await query<{ size: string; available: number; price: string }>(
      `SELECT i.size, ${usableStockSql('i')} AS available,
              COALESCE(sized.price, shared.price, p.price)::text AS price
         FROM bms_inventory i
         JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
         LEFT JOIN bms_product_packs sized
           ON sized.tenant_id = i.tenant_id AND sized.product_sku = i.product_sku
          AND sized.size = i.size AND sized.is_base AND sized.active
         LEFT JOIN bms_product_packs shared
           ON shared.tenant_id = i.tenant_id AND shared.product_sku = i.product_sku
          AND shared.size IS NULL AND shared.is_base AND shared.active
        WHERE i.tenant_id = $2 AND i.location_id = $3 AND i.product_sku = $1
        ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], size)`,
      [product.sku, tenantId, locationId],
    );
    const sizes = await Promise.all(res.rows.map(async row => ({
      size: row.size,
      available: Number(row.available),
      price: (await getVariantBasePrice(tenantId, product.sku, row.size, locationId)) ?? Number(row.price),
    })));
    const prices = sizes.map(row => row.price);
    return {
      status: "SIZE_UNKNOWN",
      sku: product.sku,
      name: product.name,
      price: prices.length ? Math.min(...prices) : Number(product.price),
      sizes,
    };
  }

  const price =
    (await getVariantBasePrice(tenantId, product.sku, size, locationId)) ??
    Number(product.price);

  const res = await query<{ available: number }>(
    `SELECT ${usableStockSql('i')} AS available
       FROM bms_inventory i
      WHERE tenant_id = $3 AND location_id = $4 AND product_sku = $1 AND size = $2`,
    [product.sku, size, tenantId, locationId],
  );
  const available = Number(res.rows[0]?.available ?? 0);
  if (available <= 0) {
    const [variants, alternativeResult] = await Promise.all([
      query<{ size: string; available: number }>(
        `SELECT size, ${usableStockSql('i')} AS available
           FROM bms_inventory i
          WHERE tenant_id = $2 AND location_id = $3 AND product_sku = $1
          ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], size), size`,
        [product.sku, tenantId, locationId],
      ),
      findAlternativeProducts(tenantId, {
        sku: product.sku,
        size,
        locationId,
        limit: 3,
      }),
    ]);
    return {
      status: "OUT_OF_STOCK",
      sku: product.sku,
      name: product.name,
      price,
      size,
      availableSizes: variants.rows
        .map((variant) => ({
          size: variant.size,
          available: Number(variant.available),
        }))
        .filter((variant) => variant.available > 0),
      alternatives: alternativeResult.alternatives,
    };
  }

  // หน่วยขายอื่นนอกจากหน่วยฐาน — ถ้าไม่บอกตรงนี้ โมเดลไม่มีทางรู้รหัสหน่วยขายเลย
  // แล้ว packCode ของ create_order จะใช้ไม่ได้ (schema สั่งห้ามเดารหัสเอง)
  const packs = await listSellablePacksForSize(tenantId, product.sku, size, locationId);
  return {
    status: "IN_STOCK",
    sku: product.sku,
    name: product.name,
    price,
    size,
    available,
    ...(packs.length > 0
      ? {
          packs: packs.map((pack) => ({
            packCode: pack.packCode,
            unitName: pack.unitName,
            baseQty: pack.baseQty,
            price: pack.price,
          })),
        }
      : {}),
  };
}

// =============================================================
// Reserve stock — กันของไว้ให้ลูกค้าโดยยังไม่ตัดสต็อก
// -------------------------------------------------------------
// เดิมฟังก์ชันนี้รับแค่ (sku, size, qty) แล้ว `UPDATE bms_inventory` โดย **ไม่มี
// tenant_id และไม่มี location_id เลย** — สินค้ารหัสเดียวกันที่มีอยู่หลายร้าน/หลายสาขา
// จึงถูกจองพร้อมกันทุกแถวที่เข้าเงื่อนไข ยืนยันกับ dev DB แล้วว่า `NIKE-AIR/XL`
// มีอยู่ใน 2 ร้าน = ยิงครั้งเดียวกินสองร้าน · นี่เป็นจุดเดียวในโค้ดเบสที่แตะ
// `bms_inventory` โดยไม่ผูก tenant (ตรวจแล้วทั้ง 16 statement) — มีเทสกันไว้ที่
// `scripts/inventory-tenant-scope-contract.test.mts`
//
// สองอย่างที่ต้องมาคู่กันเสมอ ไม่ใช่ของแถม:
//   1. **สาขา** — การจองเป็นของสาขา ไม่ใช่ของร้านทั้งร้าน (7.84) ไม่ระบุ = สาขาเริ่มต้น
//   2. **movement `RESERVE`** — กฎของโมดูลนี้คือ "ทุกการขยับสต็อกต้องมี movement"
//      (ดู docs/business/inventory.md) เดิมฟังก์ชันนี้ไม่เคยเขียน ledger เลย ของที่
//      หายไปจากยอดขายได้จึงไม่มีร่องรอยว่าใครกันไว้ตอนไหน — เป็นที่มาของยอด
//      "จองอยู่แต่อธิบายไม่ได้" ที่หน้า Products ฟ้อง
//
// เส้นทางปกติของการจองยังเป็น `createOrder()` ซึ่งจองในทรานแซกชันเดียวกับการสร้างบิล
// ฟังก์ชันนี้มีไว้สำหรับการกันของที่ไม่มีบิล และผู้เรียกต้องยืนยันตัวตน + สิทธิ์มาก่อน
// =============================================================

export type ReserveResult =
  | {
      status: "RESERVED";
      sku: string;
      size: string;
      qty: number;
      availableAfter: number;
    }
  | {
      status: "INSUFFICIENT";
      sku: string;
      size: string;
      available: number;
      requested: number;
    }
  | { status: "NOT_FOUND"; sku: string; size: string };

export async function reserveStock(input: {
  tenantId: string;
  sku: string;
  size: string;
  qty: number;
  /** ไม่ระบุ = สาขาเริ่มต้นของร้าน */
  locationId?: string | null;
  note?: string | null;
  actor?: string | null;
}): Promise<ReserveResult> {
  const { tenantId, sku, size, qty } = input;
  if (!tenantId) throw new Error("tenantId is required");
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("qty must be a positive integer");
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const locationId =
      input.locationId ??
      (await resolveDefaultLocationIdInTx(client, tenantId));

    const quality = await qualityStock(client,tenantId,locationId,sku,size);
    if (!quality.exists) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND", sku, size };
    }
    if(!quality.reconciled || quality.available<qty) {
      await client.query('ROLLBACK');
      return {status:'INSUFFICIENT',sku,size,available:quality.reconciled?quality.available:0,requested:qty};
    }
    // atomic reserve: สำเร็จเฉพาะเมื่อ available ของ "สาขานั้นของร้านนั้น" ยังพอ
    const upd = await client.query<{ available_after: number }>(
      `UPDATE bms_inventory
          SET reserved_stock = reserved_stock + $5,
              updated_at = now()
        WHERE tenant_id = $1
          AND location_id = $2
          AND product_sku = $3
          AND size = $4
          AND (current_stock - reserved_stock) >= $5
        RETURNING (current_stock - reserved_stock) AS available_after`,
      [tenantId, locationId, sku, size, qty],
    );

    if (upd.rowCount && upd.rows[0]) {
      // ledger อยู่ในทรานแซกชันเดียวกับการจอง — ของที่ถูกกันไว้ต้องมีร่องรอยเสมอ
      await recordMovement(client, {
        tenantId,
        locationId,
        sku,
        size,
        type: "RESERVE",
        qty,
        note: input.note ?? null,
        actor: input.actor ?? null,
      });
      await client.query("COMMIT");
      return {
        status: "RESERVED",
        sku,
        size,
        qty,
        availableAfter: quality.available - qty,
      };
    }

    // ไม่สำเร็จ: แยกว่า "ไม่พบ SKU/size ในสาขานี้" หรือ "ของไม่พอ"
    const cur = await client.query<{ available: number }>(
      `SELECT (current_stock - reserved_stock) AS available
         FROM bms_inventory
        WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
      [tenantId, locationId, sku, size],
    );
    await client.query("ROLLBACK");
    if (cur.rowCount === 0) return { status: "NOT_FOUND", sku, size };
    return {
      status: "INSUFFICIENT",
      sku,
      size,
      available: Number(cur.rows[0].available),
      requested: qty,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// =============================================================
// ใครจองของอยู่ — อธิบายเลข reserved_stock ให้เป็นรายบิล
// -------------------------------------------------------------
// `bms_inventory.reserved_stock` เป็นยอดรวมที่ถูกบวกสะสม ไม่ได้เก็บว่าแต่ละหน่วย
// เป็นของบิลไหน (ไม่มีตาราง ledger ของการจอง) — ฟังก์ชันนี้จึงประกอบคำอธิบายกลับ
// จากบิลที่ยังถือของอยู่จริง: PENDING/PAID/PACKING (ปล่อยตอน SHIPPED/CANCELLED)
//
// อ่านจาก view `bms_order_stock_lines` (8.8) ไม่ใช่ `bms_order_items` เพราะสินค้าชุด
// จองที่ "ส่วนประกอบ" — บิลที่ขายเป็นเซ็ตต้องโผล่ในหน้าจอของส่วนประกอบ ไม่ใช่ของเซ็ต
//
// `unattributed` = ส่วนที่อธิบายไม่ได้ ต้องแสดงเสมอ ไม่ใช่ปัดทิ้ง: `/api/bms/reserve`
// จองได้โดยไม่ผูกบิล และการจองค้างจากบั๊กเก่าก็โผล่ที่นี่ — ถ้าไม่แสดง คนอ่านจะเชื่อว่า
// รายการที่เห็นครบแล้วทั้งที่ยังมีของถูกล็อกอยู่โดยไม่มีใครเป็นเจ้าของ
// =============================================================

/** สถานะบิลที่ยัง "ถือ" reserved_stock อยู่ — ปล่อยเมื่อ SHIPPED (ตัดของจริง) หรือ CANCELLED */
export const RESERVATION_HOLDING_STATUSES = [
  "PENDING",
  "PAID",
  "PACKING",
] as const;

export type VariantReservationOrder = {
  orderId: string;
  /** ไซซ์ที่บิลนี้ถืออยู่ — บิลเดียวถือหลายไซซ์ได้ จึงเป็นหนึ่งแถวต่อ (บิล × ไซซ์) */
  size: string;
  status: string;
  channel: string;
  customerRef: string | null;
  customerName: string | null;
  customerPhone: string | null;
  qty: number;
  /**
   * ไม่ว่าง = บิลนี้ถือของผ่านเซ็ต ไม่ได้ซื้อสินค้าตัวนี้ตรง ๆ
   * เป็นลิสต์เพราะบิลเดียวซื้อสองเซ็ตที่มีส่วนประกอบตัวเดียวกันได้ — บอกแค่เซ็ตแรก
   * คือบอกเหตุผลไม่ครบให้คนที่กำลังเปิดบิลตามหาสินค้าตัวนี้
   */
  viaBundleSkus: string[];
  locationName: string | null;
  branchCode: string | null;
  /** ไม่ null = ของถูกจองไว้เพราะมัดจำที่ยังไม่ปิด (9.0) */
  depositStatus: string | null;
  createdAt: string;
};

export type VariantReservations = {
  sku: string;
  /** null = ถามรวมทุกไซซ์ของ SKU นี้ (การ์ดสรุปด้านบนของหน้า Products) */
  size: string | null;
  /** ยอดจองจริงในตาราง (รวมทุกสาขา) — ตัวเลขเดียวกับที่หน้า Products แสดง */
  reservedTotal: number;
  /** ผลรวมที่อธิบายได้จากบิลที่ยังถือของอยู่ */
  attributedTotal: number;
  /** reservedTotal - attributedTotal (ไม่ติดลบ) — ของที่ถูกกันไว้แต่ไม่มีบิลเป็นเจ้าของ */
  unattributed: number;
  /**
   * attributedTotal - reservedTotal (ไม่ติดลบ) — บิลถือรวมกัน **มากกว่า** ยอดจองในตาราง
   * เกิดเมื่อมีคนแก้/รีเซ็ต `reserved_stock` โดยไม่ยกเลิกบิล หรือมีเส้นทางปล่อยของที่รันซ้ำ
   * ต้องรายงานเหมือน `unattributed`: บิลเหล่านั้นจะไปล้มหรือทำให้ขายเกินตอนตัดสต็อกจริง
   */
  overAttributed: number;
  /** จำนวนบิลที่ถือของอยู่ทั้งหมด (นับหัวบิล ไม่ใช่แถว) */
  orderCount: number;
  /** จำนวนแถว (บิล × ไซซ์) ทั้งหมด — มากกว่า orders.length เมื่อรายการถูกตัดที่ LIST_LIMIT */
  lineCount: number;
  orders: VariantReservationOrder[];
};

/** เพดานจำนวนบิลที่ส่งกลับ — ยอดรวมยังคิดจากทุกบิล ไม่ใช่แค่ 200 แถวแรก */
const RESERVATION_LIST_LIMIT = 200;

export async function listVariantReservations(
  tenantId: string,
  sku: string,
  /**
   * `null` = ทุกไซซ์ของ SKU นี้ — การ์ด "จองอยู่ N" ด้านบนเป็นยอดรวมทุกไซซ์ และเป็นตัวเลข
   * ที่คนกดก่อนเสมอ ถ้าตอบได้แค่รายไซซ์ คนที่กดตัวรวมจะไม่ได้คำตอบ
   */
  size: string | null,
): Promise<VariantReservations> {
  const inv = await query<{ reserved_total: number }>(
    `SELECT COALESCE(SUM(reserved_stock), 0)::int AS reserved_total
       FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2
        AND ($3::text IS NULL OR size = $3)`,
    [tenantId, sku, size],
  );
  const reservedTotal = Number(inv.rows[0]?.reserved_total ?? 0);

  const res = await query<{
    order_id: string;
    size: string;
    status: string;
    channel: string;
    customer_ref: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    qty: number;
    via_bundle_skus: string[] | null;
    location_name: string | null;
    branch_code: string | null;
    deposit_status: string | null;
    created_at: Date | string;
  }>(
    `SELECT o.id::text AS order_id,
            v.size,
            o.status,
            o.channel,
            o.customer_ref,
            c.name  AS customer_name,
            c.phone AS customer_phone,
            SUM(v.qty)::int AS qty,
            -- บรรทัดที่ขายเป็นเซ็ต: view แตกเป็นส่วนประกอบแล้ว จึงย้อนกลับไปหาชื่อเซ็ต
            -- ที่ bms_order_items เพื่อไม่ให้พนักงานเห็นบิลที่ "ไม่มีสินค้านี้อยู่ในบิล"
            COALESCE(
              array_agg(DISTINCT oi.product_sku) FILTER (WHERE oi.product_sku <> $2),
              '{}'
            ) AS via_bundle_skus,
            l.name AS location_name,
            l.branch_code,
            d.status AS deposit_status,
            MIN(o.created_at) AS created_at
       FROM bms_order_stock_lines v
       JOIN bms_orders o
         ON o.tenant_id = v.tenant_id AND o.id = v.order_id
       JOIN bms_order_items oi
         ON oi.id = v.order_item_id
       LEFT JOIN bms_customers c
         ON c.id = o.customer_id
       LEFT JOIN bms_locations l
         ON l.tenant_id = v.tenant_id AND l.id = v.location_id
       LEFT JOIN bms_pos_deposits d
         ON d.tenant_id = o.tenant_id AND d.order_id = o.id AND d.status = 'OPEN'
      WHERE v.tenant_id = $1
        AND v.product_sku = $2
        AND ($3::text IS NULL OR v.size = $3)
        AND o.status = ANY($4::text[])
      GROUP BY o.id, v.size, o.status, o.channel, o.customer_ref, c.name, c.phone,
               l.name, l.branch_code, d.status
      ORDER BY MIN(o.created_at) DESC, v.size
      LIMIT $5`,
    [
      tenantId,
      sku,
      size,
      [...RESERVATION_HOLDING_STATUSES],
      RESERVATION_LIST_LIMIT,
    ],
  );

  const orders: VariantReservationOrder[] = res.rows.map((r) => ({
    orderId: r.order_id,
    size: r.size,
    status: r.status,
    channel: r.channel,
    customerRef: r.customer_ref,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    qty: Number(r.qty),
    viaBundleSkus: r.via_bundle_skus ?? [],
    locationName: r.location_name,
    branchCode: r.branch_code,
    depositStatus: r.deposit_status,
    // pg คืน timestamptz เป็น Date — field เป็น String! ใน GraphQL ต้องแปลงที่นี่
    // ไม่งั้น serialize ได้ epoch number แล้วหน้าจอโชว์ Invalid Date
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  }));

  // คิดยอดรวมจากทุกบิล ไม่ใช่จากรายการที่ถูกตัดด้วย LIMIT — ไม่งั้น "อธิบายไม่ได้"
  // จะพุ่งขึ้นเองเมื่อสินค้าตัวนั้นมีบิลค้างเกินเพดาน แล้วชี้ไปที่ปัญหาที่ไม่มีอยู่
  const agg = await query<{
    attributed_total: number;
    order_count: number;
    line_count: number;
  }>(
    `SELECT COALESCE(SUM(g.qty), 0)::int    AS attributed_total,
            COUNT(DISTINCT g.order_id)::int AS order_count,
            COUNT(*)::int                   AS line_count
       FROM (
         -- จัดกลุ่มแบบเดียวกับรายการด้านบน: หนึ่งแถวต่อ (บิล x ไซซ์)
         SELECT v.order_id, v.size, SUM(v.qty) AS qty
           FROM bms_order_stock_lines v
           JOIN bms_orders o
             ON o.tenant_id = v.tenant_id AND o.id = v.order_id
          WHERE v.tenant_id = $1
            AND v.product_sku = $2
            AND ($3::text IS NULL OR v.size = $3)
            AND o.status = ANY($4::text[])
          GROUP BY v.order_id, v.size
       ) g`,
    [tenantId, sku, size, [...RESERVATION_HOLDING_STATUSES]],
  );
  const attributedTotal = Number(agg.rows[0]?.attributed_total ?? 0);

  return {
    sku,
    size,
    reservedTotal,
    attributedTotal,
    unattributed: Math.max(0, reservedTotal - attributedTotal),
    overAttributed: Math.max(0, attributedTotal - reservedTotal),
    orderCount: Number(agg.rows[0]?.order_count ?? 0),
    lineCount: Number(agg.rows[0]?.line_count ?? 0),
    orders,
  };
}
