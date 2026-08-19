// apps/web/app/api/dev/fake/cleanup/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { withRouteErrorLog } from "@/lib/log/routeError";

async function handleDELETE(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);

    // posts/users เป็น fixtures ระดับระบบ (ไม่ใช่ BMS)
    // `posts` ไม่มีคอลัมน์ tenant_id เลย (มีแค่ author_id) — เดิมจึงลบข้ามร้านทุกครั้ง
    // scope ผ่าน author → users.tenant_id แทน · ต้องลบ posts ก่อน users เสมอ (ลำดับเดิมถูกอยู่แล้ว)
    // ไม่งั้น author หายไปก่อนแล้ว EXISTS จะ match ไม่เจอ
    // หมายเหตุ: fake post ที่ author_id เป็น NULL จะไม่ถูกลบ (ระบุร้านไม่ได้) — ยอมเหลือไว้ดีกว่าลบข้ามร้าน
    const resPosts = await query(
      `DELETE FROM posts p
        WHERE p.fake_test = true
          AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.author_id AND u.tenant_id = $1)
        RETURNING p.id`,
      [tenantId]
    );
    const resUsers = await query('DELETE FROM users WHERE fake_test = true AND tenant_id = $1 RETURNING id', [tenantId]);

  // BMS fake data — marker: restock/customer_ref/order = 'FAKE-%', PO note 'FAKE%',
  //   supplier name 'FAKE %', products = SKU 'FAKE-%', customers = tag 'fake'
  // ลบตามลำดับ FK: restock + orders + conversations + PO ก่อน (cascade items/payments/shipments/messages/notes/deliveries)
  //   → suppliers → products (cascade inventory) → customers · ข้ามตัวที่ยังมีของอ้างถึง (กัน FK error)
  //   ทุก DELETE scope ด้วย tenant_id = ร้านของผู้ล็อกอิน
    const resRestock = await query(`DELETE FROM bms_restock_subscriptions WHERE customer_ref LIKE 'FAKE-%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    const resOrders = await query(`DELETE FROM bms_orders WHERE customer_ref LIKE 'FAKE-%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    const resConversations = await query(`DELETE FROM bms_conversations WHERE customer_ref LIKE 'FAKE-%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    const resPO = await query(`DELETE FROM bms_purchase_orders WHERE note LIKE 'FAKE%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    // coupons ไม่มี FK ผูกกับ order แบบ RESTRICT (bms_orders.coupon_id → ON DELETE SET NULL) ลบตรงได้เลย
    const resCoupons = await query(`DELETE FROM bms_coupons WHERE note LIKE 'FAKE%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    const resSuppliers = await query(
      `DELETE FROM bms_suppliers s
        WHERE s.name LIKE 'FAKE %' AND s.tenant_id = $1
          AND NOT EXISTS (SELECT 1 FROM bms_purchase_orders po WHERE po.supplier_id = s.id)
        RETURNING s.id`,
      [tenantId]
    );
    const resProducts = await query(
      `DELETE FROM bms_products p
        WHERE p.sku LIKE 'FAKE-%' AND p.tenant_id = $1
          AND NOT EXISTS (SELECT 1 FROM bms_order_items oi WHERE oi.tenant_id = p.tenant_id AND oi.product_sku = p.sku)
          AND NOT EXISTS (SELECT 1 FROM bms_purchase_order_items pi WHERE pi.tenant_id = p.tenant_id AND pi.product_sku = p.sku)
        RETURNING p.sku`,
      [tenantId]
    );
    const resCustomers = await query(
      `DELETE FROM bms_customers c
        WHERE 'fake' = ANY(c.tags) AND c.tenant_id = $1
          AND NOT EXISTS (SELECT 1 FROM bms_orders o WHERE o.customer_id = c.id)
        RETURNING c.id`,
      [tenantId]
    );
    const resSupportTickets = await query(
      `DELETE FROM support_tickets WHERE ref LIKE 'FAKE-SUPPORT-%' RETURNING id`
    );

    const deleted =
      resPosts.rows.length + resUsers.rows.length + resRestock.rows.length + resOrders.rows.length + resConversations.rows.length +
      resPO.rows.length + resCoupons.rows.length + resSuppliers.rows.length + resProducts.rows.length + resCustomers.rows.length +
      resSupportTickets.rows.length;

    return NextResponse.json({
      ok: true,
      deleted,
      posts: resPosts.rows.length,
      users: resUsers.rows.length,
      bmsRestockSubscriptions: resRestock.rows.length,
      bmsOrders: resOrders.rows.length,
      bmsConversations: resConversations.rows.length,
      bmsPurchaseOrders: resPO.rows.length,
      bmsCoupons: resCoupons.rows.length,
      bmsSuppliers: resSuppliers.rows.length,
      bmsProducts: resProducts.rows.length,
      bmsCustomers: resCustomers.rows.length,
      supportTickets: resSupportTickets.rows.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "cleanup failed" }, { status: e?.message === "ไม่พบร้านที่เลือก" ? 400 : 500 });
  }
}

export const DELETE = withRouteErrorLog("DELETE /api/dev/fake/cleanup", handleDELETE);
