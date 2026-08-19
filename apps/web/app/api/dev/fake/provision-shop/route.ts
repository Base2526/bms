// apps/web/app/api/dev/fake/provision-shop/route.ts
// "สร้างร้านทดสอบทั้งร้าน" — คลิกเดียว: tenant ใหม่ (slug test-*) + admin user + staff/products/
// customers/orders/conversations/purchase ครบชุด ผ่านฟังก์ชันเดียวกับที่ route /api/dev/fake/* อื่นใช้
// (lib/bms/devSeed.ts) เรียกตรง ๆ ไม่มี HTTP round-trip ระหว่างกัน
//
// ถ้า seed ขั้นไหนพังกลางทาง จะลบร้านที่เพิ่ง provision ทิ้งทันที (deleteTenant() ปลอดภัยแน่นอน
// เพราะ provisionTestShop() การันตี slug ขึ้นต้น "test-" เสมอ) กันเหลือร้าน half-seeded ค้างไว้
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled } from "@/lib/dev-guards";
import { provisionTestShop } from "@/lib/bms/testShop";
import { deleteTenant } from "@/lib/bms/platform";
import {
  seedFakeStaff,
  seedFakeProducts,
  seedFakeCustomers,
  seedFakeOrders,
  seedFakeConversations,
  seedFakePurchase,
  seedFakeCoupons,
  seedFakeRestockSubscriptions,
} from "@/lib/bms/devSeed";
import { normalizeShopArchetype } from "@/lib/bms/shopArchetypes";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clamp = (v: unknown, def: number, min = 0, max = 500) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : def;
};

async function handlePOST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  const businessArchetype = normalizeShopArchetype(body?.businessArchetype);
  const c = body?.counts ?? {};
  const counts = {
    staff: clamp(c.staff, 2, 0, 20),
    products: clamp(c.products, 20, 1, 500),
    customers: clamp(c.customers, 15, 1, 500),
    orders: clamp(c.orders, 30, 1, 500),
    conversations: clamp(c.conversations, 15, 1, 500),
    purchase: clamp(c.purchase, 10, 1, 500),
    coupons: clamp(c.coupons, 5, 0, 200),
    restockSubscriptions: clamp(c.restockSubscriptions, businessArchetype ? 12 : 0, 0, 200),
  };

  let shop;
  try {
    shop = await provisionTestShop({ name, businessArchetype });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "สร้างร้านไม่สำเร็จ" }, { status: 500 });
  }

  try {
    await seedFakeStaff(shop.tenantId, counts.staff, guard.actor?.id);
    const products = await seedFakeProducts(shop.tenantId, counts.products, businessArchetype);
    const customers = await seedFakeCustomers(shop.tenantId, counts.customers);
    const orderResult = await seedFakeOrders(shop.tenantId, counts.orders, businessArchetype);
    const convResult = await seedFakeConversations(shop.tenantId, counts.conversations, businessArchetype);
    const poResult = await seedFakePurchase(shop.tenantId, counts.purchase, businessArchetype);
    const coupons = counts.coupons > 0 ? await seedFakeCoupons(shop.tenantId, counts.coupons, businessArchetype) : [];
    const restockResult = counts.restockSubscriptions > 0
      ? await seedFakeRestockSubscriptions(shop.tenantId, counts.restockSubscriptions)
      : { summary: { restockSubscriptions: 0, restockDeliveries: 0, restockConversations: 0 } };

    return NextResponse.json({
      ok: true,
      tenant: { id: shop.tenantId, slug: shop.slug, name: shop.name },
      admin: { email: shop.adminEmail, password: shop.adminPassword },
      businessArchetype,
      summary: {
        staff: counts.staff,
        products: products.length,
        customers: customers.length,
        coupons: coupons.length,
        ...orderResult.summary,
        ...convResult.summary,
        ...poResult.summary,
        ...restockResult.summary,
      },
    });
  } catch (e: any) {
    await deleteTenant(shop.tenantId).catch(() => {});
    return NextResponse.json(
      { error: `${e?.message || "seed failed"} — ร้าน "${shop.slug}" ที่เพิ่งสร้างถูกลบทิ้งแล้ว` },
      { status: 500 }
    );
  }
}

export const POST = withRouteErrorLog("POST /api/dev/fake/provision-shop", handlePOST);
