import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fakeSeedDisabled, requirePlatformAdminSeeder } from "@/lib/dev-guards";
import { provisionDemoShop } from "@/lib/bms/testShop";
import {
  seedFakeCoupons,
  seedFakeConversations,
  seedFakeCustomers,
  seedFakeOrders,
  seedFakeProducts,
  seedFakePurchase,
  seedFakeRestockSubscriptions,
  seedFakeStaff,
} from "@/lib/bms/devSeed";
import { seedFakePosDevices } from "@/lib/bms/devPosSeed";
import { deleteScenarioTenants } from "@/lib/bms/platform";
import { query } from "@/lib/db";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { generateFakeGroundTruth } from "@/lib/bms/fakeEvaluation";
import { DEMO_SCENARIO_SHOPS, parseDemoScenarioKey } from "@/lib/bms/demoScenarioSelection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findExistingDemoTenant(slug: string): Promise<{ id: string; slug: string; name: string } | null> {
  const result = await query<{ id: string; slug: string; name: string }>(
    `SELECT id, slug, name FROM bms_tenants WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  return result.rows[0] ?? null;
}

async function cleanupDemoBusinessData(tenantId: string) {
  await query(`DELETE FROM bms_fake_eval_runs WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_restock_subscriptions WHERE customer_ref LIKE 'FAKE-%' AND tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_orders WHERE customer_ref LIKE 'FAKE-%' AND tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_conversations WHERE customer_ref LIKE 'FAKE-%' AND tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_purchase_orders WHERE note LIKE 'FAKE%' AND tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_coupons WHERE note LIKE 'FAKE%' AND tenant_id = $1`, [tenantId]);
  await query(
    `DELETE FROM bms_suppliers s
      WHERE (s.name LIKE 'FAKE %' OR s.note LIKE 'FAKE%') AND s.tenant_id = $1
        AND NOT EXISTS (SELECT 1 FROM bms_purchase_orders po WHERE po.supplier_id = s.id)`,
    [tenantId]
  );
  await query(`DELETE FROM users WHERE tenant_id = $1 AND email LIKE '%@staff.bms.test'`, [tenantId]);
  await query(
    `DELETE FROM bms_products p
      WHERE p.sku LIKE 'FAKE-%' AND p.tenant_id = $1
        AND NOT EXISTS (SELECT 1 FROM bms_order_items oi WHERE oi.tenant_id = p.tenant_id AND oi.product_sku = p.sku)
        AND NOT EXISTS (SELECT 1 FROM bms_purchase_order_items pi WHERE pi.tenant_id = p.tenant_id AND pi.product_sku = p.sku)`,
    [tenantId]
  );
  await query(
    `DELETE FROM bms_customers c
      WHERE 'fake' = ANY(c.tags) AND c.tenant_id = $1
        AND NOT EXISTS (SELECT 1 FROM bms_orders o WHERE o.customer_id = c.id)`,
    [tenantId]
  );
}

async function handlePOST(req: NextRequest) {
  if (fakeSeedDisabled()) {
    return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  }
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const rawOnly = typeof body?.shopKey === "string" ? body.shopKey.trim().toLowerCase() : "";
  const selectedKey = parseDemoScenarioKey(body?.shopKey);
  if (!selectedKey) {
    return NextResponse.json(
      { error: rawOnly ? `unknown demo shop "${rawOnly}"` : "shopKey is required; create one scenario shop at a time" },
      { status: 400 }
    );
  }
  const selected = DEMO_SCENARIO_SHOPS.filter((shop) => shop.key === selectedKey);

  const created = [];
  for (const demo of selected) {
    const existing = await findExistingDemoTenant(demo.slug);
    if (existing && existing.name !== demo.name) {
      await query(
        `WITH renamed_tenant AS (
           UPDATE bms_tenants SET name = $2 WHERE id = $1 RETURNING id
         )
         UPDATE bms_locations
            SET name = $3, updated_at = now()
          WHERE tenant_id = (SELECT id FROM renamed_tenant)
            AND code = 'MAIN'`,
        [existing.id, demo.name, `${demo.name} สาขาหลัก`]
      );
      existing.name = demo.name;
    }
    const shop = existing
      ? {
          tenantId: existing.id,
          slug: existing.slug,
          name: existing.name,
          adminEmail: `admin+${existing.slug}@demo.bms.local`,
          adminPassword: "(existing demo admin)",
        }
      : await provisionDemoShop({
          name: demo.name,
          slug: demo.slug,
          businessArchetype: demo.businessArchetype,
        });

    await cleanupDemoBusinessData(shop.tenantId);
    const staff = await seedFakeStaff(
      shop.tenantId,
      demo.counts.staff,
      guard.actor.id,
      demo.businessArchetype
    );
    const deviceResult = await seedFakePosDevices(shop.tenantId, demo.counts.posDevices, guard.actor.id);
    const products = await seedFakeProducts(shop.tenantId, demo.counts.products, demo.businessArchetype);
    const customers = await seedFakeCustomers(shop.tenantId, demo.counts.customers);
    const orderResult = await seedFakeOrders(shop.tenantId, demo.counts.orders, demo.businessArchetype, "omnichannel");
    const convResult = await seedFakeConversations(shop.tenantId, demo.counts.conversations, demo.businessArchetype);
    const poResult = await seedFakePurchase(shop.tenantId, demo.counts.purchase, demo.businessArchetype);
    const coupons = await seedFakeCoupons(shop.tenantId, demo.counts.coupons, demo.businessArchetype);
    const restock = await seedFakeRestockSubscriptions(shop.tenantId, demo.counts.restockSubscriptions);
    const groundTruth = await generateFakeGroundTruth(shop.tenantId, {
      label: `${shop.name} scenario seed`,
      generatedBy: guard.actor.id,
    });

    created.push({
      key: demo.key,
      tenant: { id: shop.tenantId, slug: shop.slug, name: shop.name },
      admin: { email: shop.adminEmail, password: shop.adminPassword },
      reusedExistingTenant: !!existing,
      businessArchetype: demo.businessArchetype,
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
        ...restock.summary,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    created,
  });
}

export const POST = withRouteErrorLog("POST /api/dev/fake/provision-demo-shops", handlePOST);

async function handleDELETE(_req: NextRequest) {
  if (fakeSeedDisabled()) {
    return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  }
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const deleted = await deleteScenarioTenants(
    DEMO_SCENARIO_SHOPS.map((shop) => shop.slug),
    String(guard.actor.id)
  );
  return NextResponse.json({
    ok: true,
    deletedCount: deleted.length,
    deleted: deleted.map(({ id, slug, name }) => ({ id, slug, name })),
  });
}

export const DELETE = withRouteErrorLog("DELETE /api/dev/fake/provision-demo-shops", handleDELETE);
