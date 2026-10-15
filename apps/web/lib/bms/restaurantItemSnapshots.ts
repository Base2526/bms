import type { PoolClient } from "pg";
import type { OrderItemInput } from "./orders";
import type { ResolvedStockConsumption } from "./stockConsumption";
import { RestaurantCheckError } from "./restaurantPosErrors";

export type RestaurantItemSnapshot = {
  version: 1;
  provenance: "FIRST_SEND" | "LEGACY_RESERVATION";
  sourceOrderId: string;
  sourceOrderItemId: string;
  qty: number;
  consumption: ResolvedStockConsumption;
  costAmount: number | null;
  costSource: "CATALOG_AT_SALE" | "LEGACY_CURRENT" | "MISSING";
};

const invalid = () => new RestaurantCheckError(
  "RESTAURANT_SNAPSHOT_REVIEW_REQUIRED: หลักฐานวัตถุดิบ/ต้นทุนของรายการเดิมไม่ครบ กรุณาให้ผู้ดูแลตรวจสอบบิล",
  "RESTAURANT_SNAPSHOT_REVIEW_REQUIRED"
);
const integer = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 2147483647;

/** Stored JSON is a boundary too. Never repair missing evidence from today's catalog. */
export function readRestaurantItemSnapshot(value: unknown, sku: string, size: string, qty: number): RestaurantItemSnapshot {
  if (!value || typeof value !== "object") throw invalid();
  const s = value as RestaurantItemSnapshot;
  if (s.version !== 1 || !["FIRST_SEND", "LEGACY_RESERVATION"].includes(s.provenance)
      || typeof s.sourceOrderId !== "string" || !s.sourceOrderId
      || typeof s.sourceOrderItemId !== "string" || !s.sourceOrderItemId
      || !integer(s.qty) || s.qty !== qty
      || !["CATALOG_AT_SALE", "LEGACY_CURRENT", "MISSING"].includes(s.costSource)
      || (s.costAmount !== null && (typeof s.costAmount !== "number" || !Number.isFinite(s.costAmount)
        || s.costAmount < 0 || !Number.isSafeInteger(Math.round(s.costAmount * 100))))
      || (s.costAmount === null) !== (s.costSource === "MISSING")
      || !s.consumption || s.consumption.soldSku !== sku || s.consumption.soldSize !== size
      || typeof s.consumption.derived !== "boolean" || !Array.isArray(s.consumption.lines)) throw invalid();
  const keys = new Set<string>();
  for (const line of s.consumption.lines) {
    if (!line || typeof line !== "object") throw invalid();
    const key = `${line.sku}\0${line.size}`;
    if (typeof line.sku !== "string" || !line.sku || typeof line.size !== "string" || !line.size
        || !integer(line.qty) || !["DIRECT", "PACK", "BUNDLE", "WEIGHTED", "RECIPE", "MODIFIER"].includes(line.source)
        || (line.sourceRef !== null && typeof line.sourceRef !== "string")
        || !line.meta || typeof line.meta !== "object" || Array.isArray(line.meta) || keys.has(key)) throw invalid();
    keys.add(key);
  }
  if (!s.consumption.derived && s.consumption.lines.length === 0) throw invalid();
  return s;
}

/** Split merged legacy evidence only if stock is exactly divisible; allocate cents cumulatively. */
export function allocateRestaurantSnapshot(s: RestaurantItemSnapshot, quantities: number[]): RestaurantItemSnapshot[] {
  if (!s?.consumption) throw invalid();
  readRestaurantItemSnapshot(s, s.consumption.soldSku, s.consumption.soldSize, s.qty);
  if (!quantities.length || quantities.some(q => !integer(q)) || quantities.reduce((a, b) => a + b, 0) !== s.qty) throw invalid();
  let offset = 0;
  return quantities.map(qty => {
    const lines = s.consumption.lines.map(line => {
      const numerator = BigInt(line.qty) * BigInt(qty);
      if (numerator % BigInt(s.qty) !== BigInt(0)) throw invalid();
      const exact = Number(numerator / BigInt(s.qty));
      if (!integer(exact)) throw invalid();
      return { ...line, qty: exact };
    });
    const cents = s.costAmount === null ? null : Math.round(s.costAmount * 100);
    const proportionalCents = (quantity: number) => Number(
      (BigInt(cents!) * BigInt(quantity) * BigInt(2) + BigInt(s.qty)) / (BigInt(s.qty) * BigInt(2))
    );
    const costAmount = cents === null ? null
      : (proportionalCents(offset + qty) - proportionalCents(offset)) / 100;
    offset += qty;
    return { ...s, qty, costAmount, consumption: { ...s.consumption, lines } };
  });
}

type CheckItem = {
  id: string; product_sku: string; size: string; pack_qty: number; base_qty: number | null;
  pack_code: string | null; unit_name: string | null; pack_price: string | null;
  modifier_codes: string[]; status: string; stock_snapshot: unknown;
};
const qtyOf = (row: CheckItem) => Number(row.pack_qty) * Number(row.base_qty ?? 1);
const keyOf = (sku: string, size: string, pack: string | null, modifiers: string[]) =>
  JSON.stringify([sku, size, (pack?.trim() || "BASE").toUpperCase(), [...modifiers].sort()]);

/** Call BEFORE moving/cancelling rows or releasing their old reservation. Caller owns the tx/check lock. */
export async function ensureRestaurantItemSnapshotsInTx(client: PoolClient, tenantId: string, checkId: string): Promise<void> {
  const items = await client.query<CheckItem>(
    `SELECT * FROM bms_restaurant_check_items
      WHERE tenant_id=$1 AND check_id=$2 AND status <> 'CANCELLED' ORDER BY created_at, id FOR UPDATE`,
    [tenantId, checkId]);
  const missing = items.rows.filter(row => row.status === "SENT" && row.stock_snapshot == null);
  if (!missing.length) return;
  const source = await client.query<{
    id: string; order_id: string; product_sku: string; size: string; pack_code: string | null;
    stock_modifier_codes: string[]; qty: number; restaurant_check_item_id: string | null;
    stock_consumption_version: number; cost_amount_snapshot: string | null; cost_snapshot_source: RestaurantItemSnapshot["costSource"];
  }>(`SELECT oi.* FROM bms_restaurant_checks c
       JOIN bms_orders o ON o.tenant_id=c.tenant_id AND o.id=c.current_order_id
         AND o.location_id=c.location_id AND o.restaurant_check_id=c.id
       JOIN bms_order_items oi ON oi.tenant_id=o.tenant_id AND oi.order_id=o.id
      WHERE c.tenant_id=$1 AND c.id=$2`, [tenantId, checkId]);
  const handled = new Set<string>();
  for (const row of missing) {
    if (handled.has(row.id)) continue;
    const key = keyOf(row.product_sku, row.size, row.pack_code, row.modifier_codes);
    const candidates = source.rows.filter(oi => oi.restaurant_check_item_id === row.id
      || (oi.restaurant_check_item_id == null && keyOf(oi.product_sku, oi.size, oi.pack_code, oi.stock_modifier_codes) === key));
    if (candidates.length !== 1) throw invalid();
    const oi = candidates[0];
    const group = oi.restaurant_check_item_id ? [row] : items.rows.filter(i => keyOf(i.product_sku, i.size, i.pack_code, i.modifier_codes) === key);
    // A normal old reservation excludes NEW rows; a split's provisional reservation may include them.
    const sent = group.filter(i => i.status === "SENT");
    const allocatedGroup = sent.reduce((sum, i) => sum + qtyOf(i), 0) === Number(oi.qty) ? sent : group;
    const stock = await client.query<{ product_sku: string; size: string; qty: number; source: string; source_ref: string | null; meta: object }>(
      `SELECT product_sku, size, qty, source, source_ref, meta FROM bms_order_item_stock_consumption
        WHERE tenant_id=$1 AND order_item_id=$2 ORDER BY product_sku, size`, [tenantId, oi.id]);
    // Pre-v2 empty rows cannot prove intentional NON_STOCK after catalog changes.
    if (!stock.rowCount && Number(oi.stock_consumption_version) !== 2) throw invalid();
    const snapshot: RestaurantItemSnapshot = {
      version: 1, provenance: "LEGACY_RESERVATION", sourceOrderId: oi.order_id, sourceOrderItemId: String(oi.id), qty: Number(oi.qty),
      costAmount: oi.cost_amount_snapshot == null ? null : Number(oi.cost_amount_snapshot), costSource: oi.cost_snapshot_source,
      consumption: { soldSku: oi.product_sku, soldSize: oi.size, derived: true,
        lines: stock.rows.map(line => ({ sku: line.product_sku, size: line.size, qty: Number(line.qty),
          source: line.source as "RECIPE", sourceRef: line.source_ref, meta: line.meta as Record<string, unknown> })) },
    };
    const allocations = allocateRestaurantSnapshot(snapshot, allocatedGroup.map(qtyOf));
    for (const [index, item] of allocatedGroup.entries()) {
      if (item.status !== "SENT") continue;
      await client.query(`UPDATE bms_restaurant_check_items SET stock_snapshot=$3::jsonb
        WHERE tenant_id=$1 AND id=$2 AND stock_snapshot IS NULL`, [tenantId, item.id, JSON.stringify(allocations[index])]);
      handled.add(item.id);
    }
  }
}

/** The server reloads the complete check; client-supplied ids/JSON are never snapshot authority. */
export async function restaurantOrderItemsInTx(client: PoolClient, tenantId: string, checkId: string, locationId: string): Promise<OrderItemInput[]> {
  const check = await client.query(`SELECT id FROM bms_restaurant_checks
    WHERE tenant_id=$1 AND id=$2 AND location_id=$3 AND status='OPEN' FOR UPDATE`, [tenantId, checkId, locationId]);
  if (!check.rowCount) throw invalid();
  await ensureRestaurantItemSnapshotsInTx(client, tenantId, checkId);
  const items = await client.query<CheckItem>(`SELECT * FROM bms_restaurant_check_items
    WHERE tenant_id=$1 AND check_id=$2 AND status <> 'CANCELLED' ORDER BY product_sku, size, created_at, id FOR UPDATE`, [tenantId, checkId]);
  return items.rows.map(row => ({
    sku: row.product_sku, size: row.size, qty: qtyOf(row), packCode: row.pack_code,
    packQty: Number(row.pack_qty), packUnitName: row.unit_name,
    packUnitPrice: row.pack_price == null ? null : Number(row.pack_price), modifierCodes: row.modifier_codes,
    restaurantCheckItemId: row.id,
    restaurantStockSnapshot: row.status === "SENT"
      ? readRestaurantItemSnapshot(row.stock_snapshot, row.product_sku, row.size, qtyOf(row)) : undefined,
  }));
}
