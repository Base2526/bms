import { query } from "@/lib/db";

type ListedOrder = { id: string; customer_id: string | null };

/** Read optional list fields in batches; all IDs come from the tenant-scoped order list. */
export async function loadOrderListItems(tenantId: string, orders: readonly ListedOrder[]) {
  const result = new Map<string, Record<string, unknown>[]>();
  if (!orders.length) return result;
  for (const order of orders) result.set(String(order.id), []);
  const rows = await query(
    `SELECT order_id, product_sku, product_name, size, qty, unit_price, line_amount
       FROM bms_order_items
      WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])
      ORDER BY order_id, id`,
    [tenantId, orders.map(order => order.id)]
  );
  for (const row of rows.rows) result.get(String(row.order_id))?.push(row);
  return result;
}

export async function loadOrderListShippingAddresses(tenantId: string, orders: readonly ListedOrder[]) {
  const customerIds = [...new Set(orders.map(order => order.customer_id).filter((id): id is string => Boolean(id)))];
  if (!customerIds.length) return new Set<string>();
  const rows = await query<{ customer_id: string }>(
    `SELECT DISTINCT customer_id FROM bms_customer_addresses
      WHERE tenant_id = $1 AND customer_id = ANY($2::uuid[]) AND address_type = 'shipping'`,
    [tenantId, customerIds]
  );
  return new Set(rows.rows.map(row => String(row.customer_id)));
}
