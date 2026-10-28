// =============================================================
// Central cloud entitlement authority. RBAC remains an independent gate.
// =============================================================

import type { PoolClient, QueryResultRow } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { recordPackageEventInTx } from "./packageMetrics";
import { isRetailLocalDeployment } from "./deploymentMode";
import { resolvePlanAiAllowance } from "./planPolicy";
import { planFeatureKeys, FeatureAccessError, resolveFeatureAccess, type PackageFeature } from "./featurePolicy";

export type Plan = {
  code: string; name: string; price_monthly: number; price_yearly: number;
  max_products: number; max_channels: number; max_orders_month: number; max_users: number;
  max_branches: number; max_devices: number;
  max_ai_messages_month: number; ai_credits_monthly: number; sort: number;
  ai_credits_next_monthly?: number | null; ai_credits_change_at?: string | null;
  feature_keys: PackageFeature[];
  version: number;
};

/** Missing rollout column means legacy; missing tenants/database errors never grant access. */
export async function getTenantFeatureAccess(tenantId: string, client?: PoolClient) {
  const sql = `SELECT t.plan, COALESCE((to_jsonb(t)->>'feature_policy_version')::int, 1) AS version,
    (SELECT CASE WHEN to_jsonb(p) ? 'feature_keys'
      THEN ARRAY(SELECT jsonb_array_elements_text(to_jsonb(p)->'feature_keys')) ELSE NULL END
      FROM bms_plans p WHERE p.code=t.plan) AS feature_keys,
    EXISTS(SELECT 1 FROM bms_report_subscriptions s WHERE s.tenant_id=t.id) AS has_report_schedule
    FROM bms_tenants t WHERE t.id=$1 ${client ? "FOR SHARE OF t" : ""}`;
  const result = await run(client, sql, [tenantId]);
  const row = result.rows[0];
  if (!row) throw new Error("Tenant not found");
  return resolveFeatureAccess(row.plan, row.version, isRetailLocalDeployment(), row.has_report_schedule, row.feature_keys);
}

export async function requirePackageFeature(tenantId: string, feature: PackageFeature, client: PoolClient) {
  const access = (await getTenantFeatureAccess(tenantId, client)).find(item => item.feature === feature);
  if (!access?.allowed) throw new FeatureAccessError(feature);
}

const capacityResources = {
  branches: { table: "bms_locations", column: "code", limit: "max_branches", label: "สาขา" },
  devices: { table: "bms_pos_devices", column: "code", limit: "max_devices", label: "เครื่อง POS" },
  channels: { table: "bms_tenant_channels", column: "channel", limit: "max_channels", label: "ช่องทาง" },
} as const;
export type CapacityResource = keyof typeof capacityResources;

export class CapacityLimitError extends Error {
  readonly code = "PACKAGE_CAPACITY_EXCEEDED";
  constructor(readonly resource: CapacityResource, readonly limit: number) {
    super(`เกินโควตาแพ็กเกจ (${capacityResources[resource].label}สูงสุด ${limit}) — ของเดิมยังใช้งานได้ กรุณาอัปเกรดเพื่อเพิ่มรายการใหม่`);
  }
}

/** Call in the resource's tenant transaction, BEFORE resource locks. Disabled rows count.
 * Existing identities remain editable/reactivatable after downgrade without adding slots.
 */
export async function requireCapacityForUpsert(
  tenantId: string, resource: CapacityResource, key: string, client: PoolClient,
) {
  const tenant = await client.query(`SELECT COALESCE((to_jsonb(t)->>'capacity_policy_version')::int, 1) AS version
    FROM bms_tenants t WHERE id=$1 FOR UPDATE`, [tenantId]);
  if (!tenant.rowCount) throw new Error("Tenant not found");
  if (isRetailLocalDeployment() || tenant.rows[0].version === 1) return;
  const spec = capacityResources[resource]; // closed, server-owned SQL identifiers
  const existing = await client.query(`SELECT 1 FROM ${spec.table} WHERE tenant_id=$1 AND ${spec.column}=$2`, [tenantId, key]);
  if (existing.rowCount) return;
  const plan = await getTenantPlan(tenantId, client);
  const limit = plan[spec.limit];
  if (limit < 0) return;
  const count = await client.query(`SELECT COUNT(*)::int AS n FROM ${spec.table} WHERE tenant_id=$1`, [tenantId]);
  if (count.rows[0].n >= limit) throw new CapacityLimitError(resource, limit);
}

export async function getTenantEntitlements(tenantId: string) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const tenant = await client.query(`SELECT COALESCE((to_jsonb(t)->>'capacity_policy_version')::int, 1) AS version
      FROM bms_tenants t WHERE id=$1 FOR SHARE`, [tenantId]);
    if (!tenant.rowCount) throw new Error("Tenant not found");
    const plan = await getTenantPlan(tenantId, client);
    const source = isRetailLocalDeployment() ? "RETAIL_LOCAL" : tenant.rows[0].version === 1 ? "LEGACY" : "PLAN";
    const capacities = [];
    for (const resource of Object.keys(capacityResources) as CapacityResource[]) {
      const spec = capacityResources[resource];
      const result = await client.query(`SELECT COUNT(*)::int AS n FROM ${spec.table} WHERE tenant_id=$1`, [tenantId]);
      const used = result.rows[0].n;
      const limit = source === "PLAN" ? plan[spec.limit] : -1;
      capacities.push({ resource, used, limit, source, canAdd: limit < 0 || used < limit });
    }
    const features = await getTenantFeatureAccess(tenantId, client);
    await client.query("COMMIT");
    return { plan, capacities, features };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

// เรียกผ่าน client เดียวกับ transaction ที่เปิดอยู่ (ถ้ามี) ไม่งั้น fallback ไป pool query() เดิม
function run<T extends QueryResultRow = QueryResultRow>(client: PoolClient | undefined, sql: string, params: any[] = []) {
  return client ? client.query<T>(sql, params) : query<T>(sql, params);
}

export async function listPlans(): Promise<Plan[]> {
  const res = await query<Plan>(`SELECT * FROM bms_plans ORDER BY sort`);
  const at = Date.now();
  return res.rows.map(row => shapePlan(row, at));
}

function shapePlan(r: any, at: number): Plan {
  return {
    code: r.code, name: r.name, price_monthly: Number(r.price_monthly), price_yearly: Number(r.price_yearly ?? 0),
    max_products: r.max_products, max_channels: r.max_channels,
    max_branches: r.max_branches ?? -1, max_devices: r.max_devices ?? -1,
    max_orders_month: r.max_orders_month, max_users: r.max_users,
    ...resolvePlanAiAllowance(r, at),
    feature_keys: Array.isArray(r.feature_keys)
      ? r.feature_keys.filter((feature: string): feature is PackageFeature => feature in { REPORT_SCHEDULE: true, RETENTION_ENGINE: true })
      : planFeatureKeys(r.code),
    version: Number(r.version ?? 1),
    sort: r.sort,
  };
}

export async function getTenantPlan(tenantId: string, client?: PoolClient, at = Date.now()): Promise<Plan> {
  const res = await run<any>(
    client,
    `SELECT p.* FROM bms_tenants t JOIN bms_plans p ON p.code = t.plan WHERE t.id = $1`,
    [tenantId]
  );
  if (res.rows[0]) return shapePlan(res.rows[0], at);
  // fallback = free
  const free = await run<any>(client, `SELECT * FROM bms_plans WHERE code='free'`);
  return shapePlan(free.rows[0], at);
}

export async function getUsage(tenantId: string) {
  const res = await query<any>(
    `SELECT
       (SELECT COUNT(*) FROM bms_products WHERE tenant_id = $1)::int AS products,
       (SELECT COUNT(*) FROM bms_tenant_channels WHERE tenant_id = $1)::int AS channels,
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
export async function enforceProductQuota(tenantId: string, client?: PoolClient, additions = 1): Promise<void> {
  if (!Number.isInteger(additions) || additions < 1) throw new Error("Invalid product count");
  if (isRetailLocalDeployment()) return;
  const plan = await getTenantPlan(tenantId, client);
  if (plan.max_products < 0) return; // unlimited
  const res = await run<{ c: number }>(
    client,
    `SELECT COUNT(*)::int AS c FROM bms_products WHERE tenant_id = $1`,
    [tenantId]
  );
  if ((res.rows[0]?.c ?? 0) + additions > plan.max_products) {
    throw new Error(`เกินโควตาแพ็กเกจ ${plan.name} (สินค้าสูงสุด ${plan.max_products}) — อัปเกรดแพ็กเกจเพื่อเพิ่ม`);
  }
}

/** เช็คก่อนสร้าง/ย้าย staff เข้าร้าน — เกิน quota → throw */
export async function enforceUserQuota(tenantId: string, client?: PoolClient, additions = 1): Promise<void> {
  if (!Number.isInteger(additions) || additions < 1) throw new Error("Invalid user count");
  // Cloud package reductions must not sanction an installed Retail Local shop.
  if (isRetailLocalDeployment()) return;
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
  if ((res.rows[0]?.c ?? 0) + additions > plan.max_users) {
    throw new Error(`เกินโควตาแพ็กเกจ ${plan.name} (staff สูงสุด ${plan.max_users} คน) — อัปเกรดแพ็กเกจเพื่อเพิ่ม`);
  }
}

export async function changePlan(tenantId: string, code: string, actorId?: string,
  action: "plan.change" | "tenant.plan.change" = "plan.change"): Promise<boolean> {
  if (isRetailLocalDeployment()) throw new Error("Retail Local is separate from cloud plans");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const ok = await client.query(`SELECT 1 FROM bms_plans WHERE code = $1`, [code]);
    if (ok.rowCount === 0) throw new Error("แพ็กเกจไม่ถูกต้อง");
    const before = await client.query(`SELECT plan FROM bms_tenants WHERE id=$1 FOR UPDATE`, [tenantId]);
    const res = await client.query(`UPDATE bms_tenants SET plan = $2 WHERE id = $1`, [tenantId, code]);
    if (res.rowCount) {
      await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5)`,
        [tenantId, actorId ?? "system", action, action === "plan.change" ? code : tenantId,
          JSON.stringify({ planCode: code, fromPlan: before.rows[0]?.plan ?? null })]);
      if (before.rows[0]?.plan && before.rows[0].plan !== code) {
        await recordPackageEventInTx(client, tenantId, "PLAN_CHANGE", code, before.rows[0].plan, actorId ?? null);
      }
    }
    await client.query("COMMIT");
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
