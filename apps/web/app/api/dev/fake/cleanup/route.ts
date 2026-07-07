// apps/web/app/api/dev/fake/cleanup/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal } from "@/lib/dev-guards";
import { query } from "@/lib/db";

export async function DELETE(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ตัวอย่างลบเฉพาะ rows ที่เราแทรกด้วย fake_test = true
  const resPosts = await query('DELETE FROM posts WHERE fake_test = true RETURNING id');
  const resUsers = await query('DELETE FROM users WHERE fake_test = true RETURNING id');

  // BMS fake data — marker: orders/conversations = customer_ref 'FAKE-%', PO note 'FAKE%',
  //   supplier name 'FAKE %', products = SKU 'FAKE-%', customers = tag 'fake'
  // ลบตามลำดับ FK: orders + conversations + PO ก่อน (cascade items/payments/shipments/messages/notes)
  //   → suppliers → products (cascade inventory) → customers · ข้ามตัวที่ยังมีของอ้างถึง (กัน FK error)
  const resOrders = await query(`DELETE FROM bms_orders WHERE customer_ref LIKE 'FAKE-%' RETURNING id`);
  const resConversations = await query(`DELETE FROM bms_conversations WHERE customer_ref LIKE 'FAKE-%' RETURNING id`);
  const resPO = await query(`DELETE FROM bms_purchase_orders WHERE note LIKE 'FAKE%' RETURNING id`);
  const resSuppliers = await query(
    `DELETE FROM bms_suppliers s
      WHERE s.name LIKE 'FAKE %'
        AND NOT EXISTS (SELECT 1 FROM bms_purchase_orders po WHERE po.supplier_id = s.id)
      RETURNING s.id`
  );
  const resProducts = await query(
    `DELETE FROM bms_products p
      WHERE p.sku LIKE 'FAKE-%'
        AND NOT EXISTS (SELECT 1 FROM bms_order_items oi WHERE oi.tenant_id = p.tenant_id AND oi.product_sku = p.sku)
        AND NOT EXISTS (SELECT 1 FROM bms_purchase_order_items pi WHERE pi.tenant_id = p.tenant_id AND pi.product_sku = p.sku)
      RETURNING p.sku`
  );
  const resCustomers = await query(
    `DELETE FROM bms_customers c
      WHERE 'fake' = ANY(c.tags)
        AND NOT EXISTS (SELECT 1 FROM bms_orders o WHERE o.customer_id = c.id)
      RETURNING c.id`
  );

  const deleted =
    resPosts.rows.length + resUsers.rows.length + resOrders.rows.length + resConversations.rows.length +
    resPO.rows.length + resSuppliers.rows.length + resProducts.rows.length + resCustomers.rows.length;

  return NextResponse.json({
    ok: true,
    deleted,
    posts: resPosts.rows.length,
    users: resUsers.rows.length,
    bmsOrders: resOrders.rows.length,
    bmsConversations: resConversations.rows.length,
    bmsPurchaseOrders: resPO.rows.length,
    bmsSuppliers: resSuppliers.rows.length,
    bmsProducts: resProducts.rows.length,
    bmsCustomers: resCustomers.rows.length,
  });
}
