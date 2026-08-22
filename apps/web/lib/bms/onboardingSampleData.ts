import { query } from "@/lib/db";
import {
  seedFakeConversations,
  seedFakeCoupons,
  seedFakeCustomers,
  seedFakeOrders,
  seedFakeProducts,
  seedFakePurchase,
  seedFakeRestockSubscriptions,
} from "./devSeed";
import { archetypeNeedsRestockEmphasis, normalizeShopArchetype } from "./shopArchetypes";

const BASE_STEPS = ["products", "customers", "orders", "conversations", "coupons", "purchase"] as const;
type SeedStep = (typeof BASE_STEPS)[number] | "restock";

export type OnboardingSampleDataResult = {
  status: "COMPLETED" | "ALREADY_COMPLETED";
  archetype: string | null;
  completedSteps: SeedStep[];
};

export class OnboardingSampleDataError extends Error {
  constructor(message: string, readonly code: "HAS_PRODUCTS" | "IN_PROGRESS") {
    super(message);
  }
}

function validCompletedSteps(value: unknown): SeedStep[] {
  const allowed = new Set<SeedStep>([...BASE_STEPS, "restock"]);
  return Array.isArray(value) ? value.filter((step): step is SeedStep => allowed.has(step as SeedStep)) : [];
}

export async function createOnboardingSampleData(tenantId: string): Promise<OnboardingSampleDataResult> {
  const profile = await query<{ business_archetype: string | null }>(
    `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  const archetype = normalizeShopArchetype(profile.rows[0]?.business_archetype ?? null);

  const existingRun = await query<{ status: string; completed_steps: unknown }>(
    `SELECT status, completed_steps FROM bms_onboarding_seed_runs WHERE tenant_id = $1`,
    [tenantId]
  );
  if (!existingRun.rowCount) {
    const products = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM bms_products WHERE tenant_id = $1`,
      [tenantId]
    );
    if (Number(products.rows[0]?.total ?? 0) > 0) {
      throw new OnboardingSampleDataError("ร้านนี้มีสินค้าอยู่แล้ว จึงไม่สร้าง sample data ทับข้อมูลจริง", "HAS_PRODUCTS");
    }
  }

  const claimed = await query<{ status: string; completed_steps: unknown }>(
    `INSERT INTO bms_onboarding_seed_runs (tenant_id, archetype, status)
     VALUES ($1, $2, 'RUNNING')
     ON CONFLICT (tenant_id) DO UPDATE SET
       status = 'RUNNING', last_error = NULL, updated_at = now()
     WHERE bms_onboarding_seed_runs.status = 'FAILED'
        OR (bms_onboarding_seed_runs.status = 'RUNNING'
            AND bms_onboarding_seed_runs.updated_at < now() - interval '10 minutes')
     RETURNING status, completed_steps`,
    [tenantId, archetype]
  );

  if (!claimed.rowCount) {
    if (existingRun.rows[0]?.status === "COMPLETED") {
      return {
        status: "ALREADY_COMPLETED",
        archetype,
        completedSteps: validCompletedSteps(existingRun.rows[0].completed_steps),
      };
    }
    throw new OnboardingSampleDataError("กำลังสร้าง sample data ให้ร้านนี้อยู่ กรุณารอสักครู่", "IN_PROGRESS");
  }

  const completed = new Set<SeedStep>(validCompletedSteps(claimed.rows[0].completed_steps));
  const steps: Array<{ key: SeedStep; run: () => Promise<unknown> }> = [
    { key: "products", run: () => seedFakeProducts(tenantId, 12, archetype) },
    { key: "customers", run: () => seedFakeCustomers(tenantId, 10) },
    { key: "orders", run: () => seedFakeOrders(tenantId, 12, archetype) },
    { key: "conversations", run: () => seedFakeConversations(tenantId, 8, archetype) },
    { key: "coupons", run: () => seedFakeCoupons(tenantId, 3, archetype) },
    { key: "purchase", run: () => seedFakePurchase(tenantId, 6, archetype) },
  ];
  if (archetypeNeedsRestockEmphasis(archetype)) {
    steps.push({ key: "restock", run: () => seedFakeRestockSubscriptions(tenantId, 8) });
  }

  try {
    for (const step of steps) {
      if (completed.has(step.key)) continue;
      await step.run();
      completed.add(step.key);
      await query(
        `UPDATE bms_onboarding_seed_runs
            SET completed_steps = $2::jsonb, updated_at = now()
          WHERE tenant_id = $1`,
        [tenantId, JSON.stringify(Array.from(completed))]
      );
    }
    await query(
      `UPDATE bms_onboarding_seed_runs
          SET status = 'COMPLETED', completed_at = now(), last_error = NULL, updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId]
    );
    return { status: "COMPLETED", archetype, completedSteps: Array.from(completed) };
  } catch (error: any) {
    await query(
      `UPDATE bms_onboarding_seed_runs
          SET status = 'FAILED', last_error = $2, updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId, String(error?.message || "sample seed failed").slice(0, 500)]
    );
    throw error;
  }
}
