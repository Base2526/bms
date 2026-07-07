// =============================================================
// BMS SaaS — plans, usage, quota
// =============================================================

import { query } from "@/lib/db";

export type Plan = {
  code: string; name: string; price_monthly: number;
  max_products: number; max_channels: number; max_orders_month: number; sort: number;
};

export async function listPlans(): Promise<Plan[]> {
  const res = await query<Plan>(`SELECT * FROM bms_plans ORDER BY sort`);
  return res.rows.map(shapePlan);
}

function shapePlan(r: any): Plan {
  return {
    code: r.code, name: r.name, price_monthly: Number(r.price_monthly),
    max_products: r.max_products, max_channels: r.max_channels,
    max_orders_month: r.max_orders_month, sort: r.sort,
  };
}

export async function getTenantPlan(tenantId: string): Promise<Plan> {
  const res = await query<any>(
    `SELECT p.* FROM bms_tenants t JOIN bms_plans p ON p.code = t.plan WHERE t.id = $1`,
    [tenantId]
  );
  if (res.rows[0]) return shapePlan(res.rows[0]);
  // fallback = free
  const free = await query<any>(`SELECT * FROM bms_plans WHERE code='free'`);
  return shapePlan(free.rows[0]);
}

export async function getUsage(tenantId: string) {
  const res = await query<any>(
    `SELECT
       (SELECT COUNT(*) FROM bms_products WHERE tenant_id = $1)::int AS products,
       (SELECT COUNT(*) FROM bms_tenant_channels WHERE tenant_id = $1 AND active)::int AS channels,
       (SELECT COUNT(*) FROM bms_orders WHERE tenant_id = $1
          AND created_at >= date_trunc('month', now()))::int AS orders_month`,
    [tenantId]
  );
  return res.rows[0];
}

/** เช็คก่อนสร้างสินค้าใหม่ — เกิน quota → throw */
export async function enforceProductQuota(tenantId: string): Promise<void> {
  const plan = await getTenantPlan(tenantId);
  if (plan.max_products < 0) return; // unlimited
  const res = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM bms_products WHERE tenant_id = $1`,
    [tenantId]
  );
  if ((res.rows[0]?.c ?? 0) >= plan.max_products) {
    throw new Error(`เกินโควตาแพ็กเกจ ${plan.name} (สินค้าสูงสุด ${plan.max_products}) — อัปเกรดแพ็กเกจเพื่อเพิ่ม`);
  }
}

export async function changePlan(tenantId: string, code: string): Promise<boolean> {
  const ok = await query(`SELECT 1 FROM bms_plans WHERE code = $1`, [code]);
  if (ok.rowCount === 0) throw new Error("แพ็กเกจไม่ถูกต้อง");
  const res = await query(
    `UPDATE bms_tenants SET plan = $2 WHERE id = $1`,
    [tenantId, code]
  );
  return (res.rowCount ?? 0) > 0;
}
