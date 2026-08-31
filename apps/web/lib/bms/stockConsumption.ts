import type { QueryResult, QueryResultRow } from "pg";
import { isCapabilityEnabledInTx } from "./storeCapabilities";

export type StockConsumptionSource =
  | "DIRECT"
  | "PACK"
  | "BUNDLE"
  | "WEIGHTED"
  | "RECIPE"
  | "MODIFIER";

export type StockConsumptionInput = {
  sku: string;
  size: string;
  /** Integer quantity in the product's base unit. */
  qty: number;
  packCode?: string | null;
  modifierCodes?: string[] | null;
};

export type StockConsumptionLine = {
  sku: string;
  size: string;
  qty: number;
  source: StockConsumptionSource;
  sourceRef: string | null;
  meta: Record<string, unknown>;
};

export type ResolvedStockConsumption = {
  soldSku: string;
  soldSize: string;
  derived: boolean;
  lines: StockConsumptionLine[];
};

type QueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]): Promise<QueryResult<T>>;
};

function normalizedCodes(values: string[] | null | undefined): string[] {
  return Array.from(new Set(
    (values ?? []).map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean)
  )).sort();
}

function assertBaseQuantity(qty: number): number {
  const value = Number(qty);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("จำนวน Stock ต้องเป็นจำนวนเต็มหน่วยฐานที่มากกว่า 0");
  }
  return value;
}

function aggregateLines(lines: StockConsumptionLine[]): StockConsumptionLine[] {
  const grouped = new Map<string, StockConsumptionLine & { sources: Set<StockConsumptionSource> }>();
  for (const line of lines) {
    const key = `${line.sku}\u0000${line.size}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += line.qty;
      existing.sources.add(line.source);
      continue;
    }
    grouped.set(key, { ...line, sources: new Set([line.source]) });
  }
  const invalid = [...grouped.values()].find((line) => line.qty < 0);
  if (invalid) throw new Error(`MODIFIER_NEGATIVE_CONSUMPTION:${invalid.sku}:${invalid.size}`);
  return [...grouped.values()]
    .filter((line) => line.qty !== 0)
    .map(({ sources, ...line }) => ({
      ...line,
      source: sources.has("RECIPE") ? "RECIPE"
        : sources.has("BUNDLE") ? "BUNDLE"
        : sources.has("MODIFIER") ? "MODIFIER"
        : line.source,
      meta: { ...line.meta, sources: [...sources].sort() },
    }))
    .sort((a, b) => a.sku === b.sku ? a.size.localeCompare(b.size) : a.sku.localeCompare(b.sku));
}

export async function resolveStockConsumptionInTx(
  client: QueryClient,
  tenantId: string,
  input: StockConsumptionInput
): Promise<ResolvedStockConsumption> {
  const qty = assertBaseQuantity(input.qty);
  const modifierCodes = normalizedCodes(input.modifierCodes);
  const product = await client.query<{
    is_bundle: boolean;
    serial_tracked: boolean;
    stock_policy: string | null;
    base_unit: string | null;
  }>(
    `SELECT p.is_bundle, p.serial_tracked, sp.stock_policy, sp.base_unit
       FROM bms_products p
       LEFT JOIN bms_product_stock_policies sp
         ON sp.tenant_id = p.tenant_id AND sp.product_sku = p.sku
      WHERE p.tenant_id = $1 AND p.sku = $2 AND p.active`,
    [tenantId, input.sku]
  );
  const policy = product.rows[0];
  if (!policy) throw new Error(`ไม่พบสินค้าที่ขายได้: ${input.sku}`);

  // Existing bundles remain authoritative regardless of a missing 9.40 policy
  // row, preserving all pre-migration products.
  if (policy.is_bundle || policy.stock_policy === "BUNDLE") {
    const parts = await client.query<{
      component_sku: string;
      component_size: string;
      qty: number;
    }>(
      `SELECT component_sku, component_size, qty
         FROM bms_product_bundle_items
        WHERE tenant_id = $1 AND bundle_sku = $2
        ORDER BY component_sku, component_size`,
      [tenantId, input.sku]
    );
    if (!parts.rowCount) throw new Error(`BUNDLE_INCOMPLETE:${input.sku}`);
    return {
      soldSku: input.sku,
      soldSize: input.size,
      derived: true,
      lines: parts.rows.map((part) => ({
        sku: part.component_sku,
        size: part.component_size,
        qty: assertBaseQuantity(Number(part.qty) * qty),
        source: "BUNDLE",
        sourceRef: input.sku,
        meta: { bundleSku: input.sku },
      })),
    };
  }

  if (policy.stock_policy === "RECIPE") {
    if (!(await isCapabilityEnabledInTx(client, tenantId, "RECIPE"))) {
      throw new Error("ร้านยังไม่ได้เปิดความสามารถ Recipe — เปิดที่ /admin/stock-models ก่อนขายเมนูที่มีสูตร");
    }
    const recipe = await client.query<{
      recipe_id: string;
      version: number;
      output_qty: number;
      component_sku: string;
      component_size: string;
      qty: number;
    }>(
      `SELECT r.id AS recipe_id, r.version, r.output_qty,
              ri.component_sku, ri.component_size, ri.qty
         FROM bms_product_recipes r
         JOIN bms_product_recipe_items ri
           ON ri.tenant_id = r.tenant_id AND ri.recipe_id = r.id
        WHERE r.tenant_id = $1 AND r.product_sku = $2 AND r.size = $3 AND r.active
        ORDER BY ri.component_sku, ri.component_size`,
      [tenantId, input.sku, input.size]
    );
    if (!recipe.rowCount) throw new Error(`RECIPE_INCOMPLETE:${input.sku}:${input.size}`);
    const header = recipe.rows[0];
    const recipeLines: StockConsumptionLine[] = recipe.rows.map((part) => {
      const numerator = Number(part.qty) * qty;
      if (numerator % Number(header.output_qty) !== 0) {
        throw new Error(`RECIPE_BASE_UNIT_MISMATCH:${input.sku}:${input.size}`);
      }
      return {
        sku: part.component_sku,
        size: part.component_size,
        qty: numerator / Number(header.output_qty),
        source: "RECIPE",
        sourceRef: header.recipe_id,
        meta: { recipeVersion: Number(header.version), modifierCodes },
      };
    });

    if (modifierCodes.length > 0) {
      if (!(await isCapabilityEnabledInTx(client, tenantId, "MODIFIER"))) {
        throw new Error("ร้านยังไม่ได้เปิดความสามารถ Modifier — เปิดที่ /admin/stock-models ก่อนใช้ตัวเลือกเมนู");
      }
      const modifiers = await client.query<{
        code: string;
        component_sku: string;
        component_size: string;
        qty_delta: number;
      }>(
        `SELECT upper(m.code) AS code, mi.component_sku, mi.component_size, mi.qty_delta
           FROM bms_product_modifiers m
           JOIN bms_product_modifier_items mi
             ON mi.tenant_id = m.tenant_id AND mi.modifier_id = m.id
          WHERE m.tenant_id = $1 AND m.product_sku = $2 AND m.size = $3
            AND m.active AND upper(m.code) = ANY($4::text[])
          ORDER BY upper(m.code), mi.component_sku, mi.component_size`,
        [tenantId, input.sku, input.size, modifierCodes]
      );
      const found = new Set(modifiers.rows.map((row) => row.code));
      const missing = modifierCodes.filter((code) => !found.has(code));
      if (missing.length > 0) throw new Error(`MODIFIER_NOT_FOUND:${missing.join(",")}`);
      for (const modifier of modifiers.rows) {
        recipeLines.push({
          sku: modifier.component_sku,
          size: modifier.component_size,
          qty: Number(modifier.qty_delta) * qty,
          source: "MODIFIER",
          sourceRef: modifier.code,
          meta: { modifierCode: modifier.code },
        });
      }
    }

    const lines = aggregateLines(recipeLines);
    if (lines.length === 0 || lines.some((line) => line.qty <= 0)) {
      throw new Error(`RECIPE_INVALID_CONSUMPTION:${input.sku}:${input.size}`);
    }
    return { soldSku: input.sku, soldSize: input.size, derived: true, lines };
  }

  const stockPolicy = policy.stock_policy ?? (policy.serial_tracked ? "SERIALIZED" : "DIRECT");
  if (stockPolicy === "WEIGHTED" && !(await isCapabilityEnabledInTx(client, tenantId, "WEIGHTED_PRODUCT"))) {
    throw new Error("ร้านยังไม่ได้เปิดความสามารถสินค้าชั่งขาย — เปิดที่ /admin/stock-models ก่อนขายของชั่ง");
  }
  const packCode = String(input.packCode ?? "").trim().toUpperCase();
  const source: StockConsumptionSource = stockPolicy === "WEIGHTED"
    ? "WEIGHTED"
    : packCode && packCode !== "BASE" ? "PACK" : "DIRECT";
  return {
    soldSku: input.sku,
    soldSize: input.size,
    derived: false,
    lines: [{
      sku: input.sku,
      size: input.size,
      qty,
      source,
      sourceRef: source === "PACK" ? packCode : null,
      meta: { baseUnit: policy.base_unit ?? "PIECE", packCode: packCode || "BASE" },
    }],
  };
}

export async function snapshotOrderItemConsumptionInTx(
  client: QueryClient,
  tenantId: string,
  orderItemId: string | number,
  consumption: ResolvedStockConsumption
): Promise<void> {
  for (const line of consumption.lines) {
    await client.query(
      `INSERT INTO bms_order_item_stock_consumption
         (tenant_id, order_item_id, product_sku, size, qty, source, source_ref, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (order_item_id, product_sku, size) DO NOTHING`,
      [tenantId, orderItemId, line.sku, line.size, line.qty, line.source,
        line.sourceRef, JSON.stringify(line.meta)]
    );
  }
}
