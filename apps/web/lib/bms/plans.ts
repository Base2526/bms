// =============================================================
// BMS SaaS — plans, usage, quota
// =============================================================

import type { PoolClient, QueryResultRow } from "pg";
import { query } from "@/lib/db";

export type Plan = {
  code: string; name: string; price_monthly: number;
  max_products: number; max_channels: number; max_orders_month: number; max_users: number;
  max_ai_messages_month: number; ai_credits_monthly: number; sort: number;
};

// เรียกผ่าน client เดียวกับ transaction ที่เปิดอยู่ (ถ้ามี) ไม่งั้น fallback ไป pool query() เดิม
function run<T extends QueryResultRow = QueryResultRow>(client: PoolClient | undefined, sql: string, params: any[] = []) {
  return client ? client.query<T>(sql, params) : query<T>(sql, params);
}

export async function listPlans(): Promise<Plan[]> {
  const res = await query<Plan>(`SELECT * FROM bms_plans ORDER BY sort`);
  return res.rows.map(shapePlan);
}

function shapePlan(r: any): Plan {
  return {
    code: r.code, name: r.name, price_monthly: Number(r.price_monthly),
    max_products: r.max_products, max_channels: r.max_channels,
    max_orders_month: r.max_orders_month, max_users: r.max_users,
    max_ai_messages_month: r.max_ai_messages_month,
    ai_credits_monthly: r.ai_credits_monthly ?? r.max_ai_messages_month,
    sort: r.sort,
  };
}

export async function getTenantPlan(tenantId: string, client?: PoolClient): Promise<Plan> {
  const res = await run<any>(
    client,
    `SELECT p.* FROM bms_tenants t JOIN bms_plans p ON p.code = t.plan WHERE t.id = $1`,
    [tenantId]
  );
  if (res.rows[0]) return shapePlan(res.rows[0]);
  // fallback = free
  const free = await run<any>(client, `SELECT * FROM bms_plans WHERE code='free'`);
  return shapePlan(free.rows[0]);
}

export async function getUsage(tenantId: string) {
  const res = await query<any>(
    `SELECT
       (SELECT COUNT(*) FROM bms_products WHERE tenant_id = $1)::int AS products,
       (SELECT COUNT(*) FROM bms_tenant_channels WHERE tenant_id = $1 AND active)::int AS channels,
       (SELECT COUNT(*) FROM bms_orders WHERE tenant_id = $1
          AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'))::int AS orders_month,
       (SELECT COUNT(*) FROM users WHERE tenant_id = $1)::int AS users`,
    [tenantId]
  );
  return res.rows[0];
}

/** เช็คก่อนสร้างสินค้าใหม่ — เกิน quota → throw
 *  ส่ง client เข้ามาเมื่อเรียกจากใน transaction ที่ล็อกแถว bms_tenants ไว้แล้ว (กัน race
 *  ตอนสร้างสินค้าใหม่พร้อมกันหลาย request — ดู upsertProduct()) */
export async function enforceProductQuota(tenantId: string, client?: PoolClient): Promise<void> {
  const plan = await getTenantPlan(tenantId, client);
  if (plan.max_products < 0) return; // unlimited
  const res = await run<{ c: number }>(
    client,
    `SELECT COUNT(*)::int AS c FROM bms_products WHERE tenant_id = $1`,
    [tenantId]
  );
  if ((res.rows[0]?.c ?? 0) >= plan.max_products) {
    throw new Error(`เกินโควตาแพ็กเกจ ${plan.name} (สินค้าสูงสุด ${plan.max_products}) — อัปเกรดแพ็กเกจเพื่อเพิ่ม`);
  }
}

/** เช็คก่อนสร้าง/ย้าย staff เข้าร้าน — เกิน quota → throw */
export async function enforceUserQuota(tenantId: string, client?: PoolClient): Promise<void> {
  // Serialize user creation per tenant. Without this lock two requests can
  // both observe c=max-1 and commit above the paid plan limit.
  if (client) {
    const tenant = await client.query(`SELECT id FROM bms_tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
    if (!tenant.rowCount) throw new Error("ไม่พบร้านที่ระบุ");
  }
  const plan = await getTenantPlan(tenantId, client);
  if (plan.max_users < 0) return; // unlimited
  const res = await run<{ c: number }>(
    client,
    `SELECT COUNT(*)::int AS c FROM users WHERE tenant_id = $1`,
    [tenantId]
  );
  if ((res.rows[0]?.c ?? 0) >= plan.max_users) {
    throw new Error(`เกินโควตาแพ็กเกจ ${plan.name} (staff สูงสุด ${plan.max_users} คน) — อัปเกรดแพ็กเกจเพื่อเพิ่ม`);
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
