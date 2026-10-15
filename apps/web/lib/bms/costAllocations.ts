import { createHash } from "crypto";
import { getClient } from "@/lib/db";
import type { PoolClient } from "pg";
import { beginTenantTx } from "./tenant";
import { getOperatingCostsInTx } from "./operatingCosts";
import { costCents, costMonth } from "./operatingCostMath";
import { scanSalesEvidenceInTx } from "./salesEvidence";
import { evidenceDecimal } from "./salesEvidenceMath";
import { allocateOperatingCost, createAllocationDriver, normalizeAllocationRequest, normalizeAllocationRule,
  type AllocationDriver, type AllocationRule } from "./costAllocationMath";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, v) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)).digest("hex");
const eligible = (row: any) => row && ["OPERATING", "GP", "DEPRECIATION"].includes(row.state) && row.recognizedAmount != null;
const amountOf = (row: any) => {
  const cents = costCents(row.recognizedAmount);
  if (cents === null) throw new Error("COST_ALLOCATION_INVALID_AMOUNT");
  return evidenceDecimal(cents);
};
async function inTx<T>(tenantId: string, actorId: string, write: boolean, run: (client: PoolClient) => Promise<T>) {
  if (!tenantId || !actorId) throw new Error("COST_ALLOCATION_FORBIDDEN");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { serializable: true, ...(write ? { editorId: actorId } : {}) });
    await client.query("SET LOCAL statement_timeout = '30s'");
    const access = (await client.query(`SELECT EXISTS (SELECT 1 FROM bms_user_allowed_locations
      WHERE tenant_id=$1 AND user_id=$2) AS scoped,
      (SELECT currency FROM bms_store_profile WHERE tenant_id=$1) AS currency`, [tenantId, actorId])).rows[0];
    if (!access || access.scoped) throw new Error("COST_ALLOCATION_ALL_BRANCH_ACCESS_REQUIRED");
    if (access.currency !== "THB") throw new Error("COST_ALLOCATION_CURRENCY_REVIEW_REQUIRED");
    const result = await run(client);
    await client.query("COMMIT"); return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    const pg = error as { code?: string; constraint?: string };
    if (pg?.code === "40001" || (pg?.code === "23505" && pg.constraint === "bms_cost_allocations_pkey")) throw new Error("COST_ALLOCATION_CONFLICT");
    throw error;
  }
  finally { client.release(); }
}
async function load(client: PoolClient, tenantId: string, month: string) {
  const costs = await getOperatingCostsInTx(client, tenantId, month);
  const locations = (await client.query<{ id: string; name: string }>(
    "SELECT id,name FROM bms_locations WHERE tenant_id=$1 ORDER BY id LIMIT 1001", [tenantId])).rows;
  if (locations.length > 1000) throw new Error("COST_ALLOCATION_LOCATION_LIMIT");
  const saved = (await client.query(`SELECT * FROM (
    SELECT DISTINCT ON (source_key) source_key,version,request_hash,snapshot,created_at
      FROM bms_cost_allocations WHERE tenant_id=$1 AND month=$2
      ORDER BY source_key,version DESC) latest ORDER BY source_key LIMIT 1001`, [tenantId, month])).rows;
  if (saved.length > 1000) throw new Error("COST_ALLOCATION_ROW_LIMIT");
  return { costs, locations, saved };
}
async function salesDriver(client: PoolClient, tenantId: string, actorId: string, month: string) {
  const collector = createAllocationDriver();
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const scan = await scanSalesEvidenceInTx(client, tenantId, actorId, { from: `${month}-01`, to: last }, collector.add);
  return collector.finish(scan.truncated);
}
function plan(month: string, source: any, rule: AllocationRule, locations: { id: string; name: string }[], driver?: AllocationDriver) {
  if (!eligible(source)) throw new Error("COST_ALLOCATION_SOURCE_REVIEW_REQUIRED");
  if (rule.targets.some(t => !locations.some(l => l.id === t.locationId))) throw new Error("COST_ALLOCATION_TARGET_NOT_FOUND");
  const amount = amountOf(source);
  const allocations = allocateOperatingCost(amount, rule, driver);
  const sourceBasis = { fingerprint: source.fingerprint, review: source.review, state: source.state, amount };
  // Include the complete monthly driver population, not a truncated top-seller result or client weight.
  const driverFingerprint = rule.method.startsWith("SALES_") ? hash(driver) : null;
  const fingerprint = hash({ version: 1, month, sourceKey: source.key, sourceBasis, rule, driverFingerprint, allocations });
  return { version: 1, month, sourceKey: source.key, amount, rule, sourceBasis, driverFingerprint, fingerprint, allocations,
    salesBasis: "PAID_PRODUCT_ACTIVITY_BEFORE_RETURNS_V1", currency: "THB" };
}

export async function previewCostAllocation(tenantId: string, actorId: string, value: unknown) {
  const input = normalizeAllocationRequest(value);
  return inTx(tenantId, actorId, false, async client => {
    const data = await load(client, tenantId, input.month);
    if (data.costs.truncated) throw new Error("COST_ALLOCATION_COSTS_TRUNCATED");
    const driver = input.rule.method.startsWith("SALES_") ? await salesDriver(client, tenantId, actorId, input.month) : undefined;
    const snapshot = plan(input.month, data.costs.rows.find(r => r.key === input.sourceKey), input.rule, data.locations, driver);
    return { status: "READY", expectedVersion: Number(data.saved.find(r => r.source_key === input.sourceKey)?.version ?? 0), snapshot };
  });
}

export async function saveCostAllocation(tenantId: string, actorId: string, value: unknown) {
  const input = normalizeAllocationRequest(value, true), requestHash = hash(input);
  return inTx(tenantId, actorId, true, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`cost-allocation:${tenantId}:${input.month}`]);
    const previous = (await client.query(`SELECT version,request_hash,snapshot FROM bms_cost_allocations
      WHERE tenant_id=$1 AND month=$2 AND source_key=$3 ORDER BY version DESC LIMIT 1`,
    [tenantId, input.month, input.sourceKey])).rows[0];
    if (previous?.request_hash === requestHash) return { status: "SAVED", version: Number(previous.version), replayed: true };
    if (Number(previous?.version ?? 0) !== input.expectedVersion) throw new Error("COST_ALLOCATION_CONFLICT");
    const data = await load(client, tenantId, input.month);
    if (data.costs.truncated) throw new Error("COST_ALLOCATION_COSTS_TRUNCATED");
    const driver = input.rule.method.startsWith("SALES_") ? await salesDriver(client, tenantId, actorId, input.month) : undefined;
    const snapshot = plan(input.month, data.costs.rows.find(r => r.key === input.sourceKey), input.rule, data.locations, driver);
    if (snapshot.fingerprint !== input.previewFingerprint) throw new Error("COST_ALLOCATION_PREVIEW_STALE");
    const version = input.expectedVersion + 1;
    await client.query(`INSERT INTO bms_cost_allocations (tenant_id,month,source_key,version,request_hash,snapshot,created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [tenantId, input.month, input.sourceKey, version, requestHash, JSON.stringify(snapshot), actorId]);
    await client.query(`INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
      VALUES ($1,$2,'report.cost_allocation',$3,$4::jsonb)`, [tenantId, actorId, input.sourceKey,
      JSON.stringify({ month: input.month, version, previousVersion: input.expectedVersion, fingerprint: snapshot.fingerprint, rule: snapshot.rule })]);
    return { status: "SAVED", version, replayed: false };
  });
}

export async function getCostAllocationReport(tenantId: string, actorId: string, value: string) {
  const month = costMonth(value);
  if (!month.startsWith("20")) throw new Error("COST_ALLOCATION_MONTH_UNSUPPORTED");
  return inTx(tenantId, actorId, false, client => getCostAllocationReportInTx(client, tenantId, actorId, month));
}

/** Internal composition: caller owns serializable tenant tx, all-source permissions and all-branch scope.
 * A supplied driver must be the complete monthly stream from that same transaction, never client data.
 */
export async function getCostAllocationReportInTx(client: PoolClient, tenantId: string, actorId: string, value: string, suppliedDriver?: AllocationDriver) {
    const month = costMonth(value);
    if (!month.startsWith("20")) throw new Error("COST_ALLOCATION_MONTH_UNSUPPORTED");
    const data = await load(client, tenantId, month);
    const automatic = data.saved.some(r => String(r.snapshot?.rule?.method).startsWith("SALES_"));
    const driver = automatic ? suppliedDriver ?? await salesDriver(client, tenantId, actorId, month) : undefined;
    const sources = new Map(data.costs.rows.map(r => [r.key, r]));
    const saved = new Map(data.saved.map(r => [r.source_key, r]));
    const keys = [...new Set([...sources.keys(), ...saved.keys()])].sort();
    let knownAllocated = 0n, unresolvedCount = data.costs.unresolvedCount;
    const groups = new Map<string, { locationId: string; channel: string | null; amount: bigint }>();
    const rows = keys.map(key => {
      const source = sources.get(key), prior = saved.get(key);
      let state = eligible(source) ? "UNALLOCATED" : "NOT_APPLICABLE", issue: string | null = null;
      let current: ReturnType<typeof plan> | null = null;
      if (prior && source && ["EXCLUDED", "DUPLICATE", "NOT_ELIGIBLE"].includes(source.state)) state = "INACTIVE";
      else if (prior) {
        try {
          const rule = normalizeAllocationRule(prior.snapshot?.rule);
          current = plan(month, source, rule, data.locations, driver);
          if (data.costs.truncated || current.fingerprint !== prior.snapshot?.fingerprint) throw new Error("COST_ALLOCATION_PREVIEW_STALE");
          // Compare stored result, not just a caller-controlled fingerprint in persisted JSON.
          if (hash(current) !== hash(prior.snapshot)) throw new Error("COST_ALLOCATION_SNAPSHOT_INVALID");
          state = "CURRENT";
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (!message.startsWith("COST_")) throw error;
          state = "STALE"; issue = message; current = null;
        }
      }
      if (state === "UNALLOCATED" || state === "STALE") unresolvedCount++;
      if (state === "CURRENT" && current) {
        knownAllocated += costCents(current.amount)!;
        for (const allocation of current.allocations) {
          const id = JSON.stringify([allocation.locationId, allocation.channel]);
          if (!groups.has(id)) groups.set(id, { ...allocation, amount: 0n });
          groups.get(id)!.amount += costCents(allocation.amount)!;
        }
      }
      return { sourceKey: key, reference: source?.reference ?? key, classification: source?.state ?? "MISSING",
        amount: source && eligible(source) ? amountOf(source) : null, state, issue, version: Number(prior?.version ?? 0),
        snapshot: prior?.snapshot ?? null };
    });
    const reviewed = data.costs.rows.filter(eligible).reduce((n, r) => n + costCents(r.recognizedAmount)!, 0n);
    const complete = data.costs.complete && unresolvedCount === 0 && knownAllocated === reviewed;
    return { status: "OK", month, currency: "THB", complete, truncated: data.costs.truncated, unresolvedCount,
      knownAllocated: evidenceDecimal(knownAllocated), allocatedTotal: complete ? evidenceDecimal(knownAllocated) : null,
      reviewedTotal: data.costs.complete ? evidenceDecimal(reviewed) : null,
      locations: data.locations, rows, groups: [...groups.values()].map(g => ({ ...g, amount: evidenceDecimal(g.amount) })),
      salesBasis: "PAID_PRODUCT_ACTIVITY_BEFORE_RETURNS_V1" };
}
