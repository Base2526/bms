import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

/** Non-authoritative telemetry: a savepoint keeps failures out of business outcomes.
 * Pre-migration code remains compatible. Missing evidence is exposed as untracked, not zero.
 */
export async function recordPackageEventInTx(client: PoolClient, tenantId: string,
  kind: "SIGNUP" | "PLAN_CHANGE", toPlan: string, fromPlan: string | null = null, actor: string | null = null) {
  await client.query("SAVEPOINT package_telemetry");
  try {
    // A telemetry lock must not stall signup/plan administration indefinitely.
    // pg_settings exposes these settings in milliseconds; preserve stricter caller limits.
    const settings = await client.query(`SELECT name, setting FROM pg_settings
      WHERE name IN ('statement_timeout','lock_timeout')`);
    const previous = new Map<string, string>(settings.rows.map(r => [r.name, r.setting]));
    const bounded = (name: string, ceiling: number) => {
      const value = Number(previous.get(name));
      if (!Number.isFinite(value) || value < 0) throw new Error("Telemetry timeout settings unavailable");
      return String(value === 0 ? ceiling : Math.min(value, ceiling));
    };
    await client.query(`SELECT set_config('statement_timeout',$1,true), set_config('lock_timeout',$2,true)`,
      [bounded('statement_timeout', 1000), bounded('lock_timeout', 250)]);
    const ready = await client.query(`SELECT to_regclass('bms_package_events') IS NOT NULL AS ready`);
    if (ready.rows[0]?.ready) {
      await client.query(`INSERT INTO bms_package_events(tenant_id,kind,from_plan,to_plan,actor,occurred_at)
        VALUES($1,$2,$3,$4,$5,CASE WHEN $2='SIGNUP' THEN
          (SELECT created_at FROM bms_tenants WHERE id=$1) ELSE now() END)
        ON CONFLICT DO NOTHING`, [tenantId, kind, fromPlan, toPlan, actor]);
    }
    await client.query(`SELECT set_config('statement_timeout',$1,true), set_config('lock_timeout',$2,true)`,
      [previous.get('statement_timeout'), previous.get('lock_timeout')]);
    await client.query("RELEASE SAVEPOINT package_telemetry");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT package_telemetry");
    await client.query("RELEASE SAVEPOINT package_telemetry");
    console.warn("Package telemetry unavailable; business transaction preserved");
  }
}

/** Called only after a verified self-serve signup commits. No PII is recorded. */
export async function recordPackageSignup(tenantId: string, existingClient?: PoolClient) {
  let client: PoolClient | undefined = existingClient;
  try {
    client ??= await getClient();
    await beginTenantTx(client, tenantId);
    await recordPackageEventInTx(client, tenantId, "SIGNUP", "free");
    await client.query("COMMIT");
  } catch {
    await client?.query("ROLLBACK").catch(() => undefined);
    console.warn("Package signup telemetry unavailable");
  } finally { if (!existingClient) client?.release(); }
}

/** Platform-only aggregate, guarded by live DB authority in its adapter. Half-open UTC window.
 * Counts distinct shops, not upgrade events; repeat upgrades cannot inflate conversion.
 * Existing Free baseline and verified new signup cohorts are intentionally separate.
 */
export async function getPackageMetrics(from: string, to: string) {
  const start = new Date(from), end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end
    || end.getTime() - start.getTime() > 366 * 86400000) throw new RangeError("Invalid metrics window (maximum 366 days)");
  const ready = await query(`SELECT to_regclass('bms_package_events') IS NOT NULL AS ready`);
  if (!ready.rows[0]?.ready) return { available: false, from: start.toISOString(), to: end.toISOString(), cohorts: [], costs: [], untrackedTenants: null };
  const params = [start.toISOString(), end.toISOString()];
  const cohorts = await query(`WITH transitions AS (
      SELECT tenant_id, occurred_at FROM bms_package_events
        WHERE kind='PLAN_CHANGE' AND from_plan='free' AND to_plan IN ('pro','business')
      UNION ALL
      SELECT tenant_id, created_at FROM bms_audit_log
        WHERE action IN ('plan.change','tenant.plan.change')
          AND meta->>'fromPlan'='free' AND meta->>'planCode' IN ('pro','business')
    ), cohort AS (
      SELECT e.* FROM bms_package_events e JOIN bms_tenants t ON t.id=e.tenant_id
      WHERE e.kind IN ('SIGNUP','BASELINE') AND e.to_plan='free'
        AND e.occurred_at >= $1 AND e.occurred_at < $2 AND t.slug NOT LIKE 'test-%'
    ) SELECT c.kind, COUNT(*)::int AS shops,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM transitions p
        WHERE p.tenant_id=c.tenant_id AND p.occurred_at>=c.occurred_at AND p.occurred_at<$2))::int AS converted
    FROM cohort c GROUP BY c.kind ORDER BY c.kind`, params);
  // An event may include a cross-provider retry. Do not attribute its whole cost to
  // its original provider label; tenant and shared/BYOK are the reliable dimensions.
  const costs = await query(`SELECT e.tenant_id, e.source,
      SUM(e.provider_calls)::int AS calls,
      SUM(CASE WHEN e.actual_cost_usd IS NULL THEN e.provider_calls ELSE e.unpriced_provider_calls END)::int AS unpriced,
      CASE WHEN SUM(e.provider_calls)=0 THEN 0
        ELSE SUM(e.actual_cost_usd) FILTER (WHERE e.provider_calls>0) END AS cost
    FROM bms_ai_usage_events e JOIN bms_tenants t ON t.id=e.tenant_id
    WHERE e.created_at >= $1 AND e.created_at < $2 AND t.slug NOT LIKE 'test-%'
    GROUP BY e.tenant_id,e.source ORDER BY e.tenant_id,e.source`, params);
  const missing = await query(`SELECT COUNT(*)::int AS n FROM bms_tenants t WHERE t.slug NOT LIKE 'test-%'
    AND NOT EXISTS (SELECT 1 FROM bms_package_events e WHERE e.tenant_id=t.id AND e.kind IN ('SIGNUP','BASELINE'))`);
  return {
    available: true, from: start.toISOString(), to: end.toISOString(), untrackedTenants: missing.rows[0].n,
    cohorts: cohorts.rows.map(r => ({ kind: r.kind, shops: r.shops, converted: r.converted,
      conversionRate: r.shops ? r.converted / r.shops : null })),
    costs: costs.rows.map(r => ({ tenantId: r.tenant_id, source: r.source,
      providerCalls: r.calls, unpricedProviderCalls: r.unpriced, knownCostUsd: r.cost == null ? null : Number(r.cost) })),
  };
}
