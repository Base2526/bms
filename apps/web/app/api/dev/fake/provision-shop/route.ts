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
  seedFakeMembers,
  seedFakeBoardGameCafe,
} from "@/lib/bms/devSeed";
import { seedFakePosDevices } from "@/lib/bms/devPosSeed";
import { normalizeShopArchetype } from "@/lib/bms/shopArchetypes";
import { normalizeRestaurantSeedSet } from "@/lib/bms/restaurantCatalogSeed";
import { generateFakeGroundTruth } from "@/lib/bms/fakeEvaluation";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clamp = (v: unknown, def: number, min = 0, max = 2000) => {
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
  const restaurantSeedSet = normalizeRestaurantSeedSet(body?.restaurantSeedSet);
  const c = body?.counts ?? {};
  const counts = {
    // One Administrator is provisioned separately, so 22 seeded staff = 23 total.
    staff: clamp(c.staff, 22, 0, 59),
    posDevices: clamp(c.posDevices, 3, 1, 12),
    products: clamp(c.products, 500, 1, 2000),
    customers: clamp(c.customers, 1000, 1, 5000),
    orders: clamp(c.orders, 5000, 800, 20000),
    conversations: clamp(c.conversations, 250, 1, 2000),
    purchase: clamp(c.purchase, 100, 1, 2000),
    coupons: clamp(c.coupons, 18, 0, 200),
    restockSubscriptions: clamp(c.restockSubscriptions, businessArchetype ? 100 : 0, 0, 1000),
  };

  let shop;
  try {
    shop = await provisionTestShop({ name, businessArchetype });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "สร้างร้านไม่สำเร็จ" }, { status: 500 });
  }

  try {
    const staff = await seedFakeStaff(shop.tenantId, counts.staff, guard.actor?.id, businessArchetype);
    const deviceResult = await seedFakePosDevices(shop.tenantId, counts.posDevices, guard.actor?.id);
    const products = await seedFakeProducts(shop.tenantId, counts.products, businessArchetype, restaurantSeedSet);
    const customers = await seedFakeCustomers(shop.tenantId, counts.customers);
    const orderResult = await seedFakeOrders(shop.tenantId, counts.orders, businessArchetype, "omnichannel");
    const convResult = await seedFakeConversations(shop.tenantId, counts.conversations, businessArchetype);
    const poResult = await seedFakePurchase(shop.tenantId, counts.purchase, businessArchetype);
    const coupons = counts.coupons > 0 ? await seedFakeCoupons(shop.tenantId, counts.coupons, businessArchetype) : [];
    const restockResult = counts.restockSubscriptions > 0
      ? await seedFakeRestockSubscriptions(shop.tenantId, counts.restockSubscriptions)
      : { summary: { restockSubscriptions: 0, restockDeliveries: 0, restockConversations: 0 } };
    const boardGameResult = businessArchetype === "board_game_cafe"
      ? await (async () => {
          const members = await seedFakeMembers(shop.tenantId, 12);
          const boardGame = await seedFakeBoardGameCafe(shop.tenantId, 12);
          return { ...boardGame.summary, members: members.members };
        })()
      : null;
    const groundTruth = await generateFakeGroundTruth(shop.tenantId, {
      label: `${shop.name} full-store seed`,
      generatedBy: guard.actor?.id,
    });

    return NextResponse.json({
      ok: true,
      tenant: { id: shop.tenantId, slug: shop.slug, name: shop.name },
      admin: { email: shop.adminEmail, password: shop.adminPassword },
      businessArchetype,
      restaurantSeedSet,
      groundTruth: {
        id: groundTruth.id,
        cases: groundTruth.cases.length,
        generatorVersion: groundTruth.generatorVersion,
      },
      summary: {
        staff: staff.length + 1,
        products: products.length,
        customers: customers.length,
        coupons: coupons.length,
        ...deviceResult.summary,
        ...orderResult.summary,
        ...convResult.summary,
        ...poResult.summary,
        ...restockResult.summary,
        ...(boardGameResult ? { boardGame: boardGameResult } : {}),
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
