import { costCents, costMonth, costSourceKey } from "./operatingCostMath";
import { evidenceCents, evidenceDecimal, inspectSalesEvidence, type SalesEvidenceEvent } from "./salesEvidenceMath";

export const ALLOCATION_METHODS = ["DIRECT", "EQUAL", "WEIGHTED", "SALES_GROSS", "SALES_UNITS"] as const;
export type AllocationTarget = { locationId: string; channel: string | null; weight: string | null };
export type AllocationRule = { method: typeof ALLOCATION_METHODS[number]; reason: string; targets: AllocationTarget[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exactKeys = (v: any, keys: string[]) => {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) throw new Error("COST_ALLOCATION_INVALID_INPUT");
};
export const targetKey = (t: AllocationTarget) => JSON.stringify([t.locationId, t.channel]);
export function normalizeAllocationRule(value: unknown): AllocationRule {
  const v = value as AllocationRule; exactKeys(v, ["method", "reason", "targets"]);
  if (!ALLOCATION_METHODS.includes(v.method) || typeof v.reason !== "string" || !v.reason.trim() || v.reason.trim().length > 500
      || !Array.isArray(v.targets) || v.targets.length < 1 || v.targets.length > 100) throw new Error("COST_ALLOCATION_INVALID_RULE");
  const targets = v.targets.map(t => {
    exactKeys(t, ["locationId", "channel", "weight"]);
    if (typeof t.locationId !== "string" || !uuid.test(t.locationId)
        || (t.channel != null && (typeof t.channel !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(t.channel)))) throw new Error("COST_ALLOCATION_INVALID_TARGET");
    if (v.method === "WEIGHTED") {
      if (typeof t.weight !== "string" || !/^\d{1,9}$/.test(t.weight)) throw new Error("COST_ALLOCATION_INVALID_WEIGHT");
    } else if (t.weight != null) throw new Error("COST_ALLOCATION_UNEXPECTED_WEIGHT");
    return { locationId: t.locationId.toLowerCase(), channel: t.channel ?? null, weight: t.weight == null ? null : String(BigInt(t.weight)) };
  }).sort((a, b) => targetKey(a) < targetKey(b) ? -1 : 1);
  if (new Set(targets.map(targetKey)).size !== targets.length || targets.some((t, i) => targets.some((other, j) =>
    i !== j && t.locationId === other.locationId && (t.channel === null || other.channel === null)))) throw new Error("COST_ALLOCATION_OVERLAPPING_TARGETS");
  if (v.method === "DIRECT" && targets.length !== 1) throw new Error("COST_ALLOCATION_DIRECT_ONE_TARGET");
  return { method: v.method, reason: v.reason.trim(), targets };
}
export function normalizeAllocationRequest(value: any, write = false) {
  exactKeys(value, ["month", "sourceKey", "rule", ...(write ? ["expectedVersion", "previewFingerprint", "confirmed"] : [])]);
  const month = costMonth(value.month);
  // The common sales evidence clock currently supports 20xx only, even for manual allocations.
  if (!month.startsWith("20")) throw new Error("COST_ALLOCATION_MONTH_UNSUPPORTED");
  const sourceKey = costSourceKey(value.sourceKey).key, rule = normalizeAllocationRule(value.rule);
  if (write && (value.confirmed !== true || !Number.isInteger(value.expectedVersion) || value.expectedVersion < 0
      || value.expectedVersion >= 2147483647 || typeof value.previewFingerprint !== "string"
      || !/^[a-f0-9]{64}$/.test(value.previewFingerprint))) throw new Error("COST_ALLOCATION_CONFIRMATION_REQUIRED");
  return { month, sourceKey, rule, expectedVersion: value.expectedVersion as number,
    previewFingerprint: value.previewFingerprint as string, confirmed: value.confirmed === true };
}

export type AllocationDriver = { rows: { locationId: string; channel: string; gross: string; units: string }[]; issues: string[]; truncated: boolean };
/** Paid sale activity BEFORE return/void reversals. Never label this net revenue or net units. */
export function createAllocationDriver() {
  const rows = new Map<string, { locationId: string; channel: string; gross: bigint; units: bigint }>();
  const issues = new Set<string>();
  return { add(event: SalesEvidenceEvent) {
    if (event.kind !== "SALE") return;
    if (!event.locationId || !uuid.test(event.locationId) || !/^[a-z][a-z0-9_-]{0,63}$/.test(event.channel)) { issues.add("INVALID_SALE_SCOPE"); return; }
    const result = inspectSalesEvidence(event);
    // Cost and VAT completeness are not requirements for a gross sales allocation denominator.
    const blocking = result.issues.filter(i => ["ORDER_TOTAL_MISMATCH", "MISSING_LINES", "LINE_LIMIT", "LEGACY_DATE_FALLBACK", "CANCELLED_SALE_REQUIRES_RECONCILIATION"].includes(i));
    blocking.forEach(i => issues.add(i));
    if (blocking.length) return;
    const key = JSON.stringify([event.locationId, event.channel]);
    if (!rows.has(key)) rows.set(key, { locationId: event.locationId, channel: event.channel, gross: 0n, units: 0n });
    const row = rows.get(key)!;
    for (const item of result.attribution) { row.gross += evidenceCents(item.netAmount); row.units += BigInt(item.qty); }
  }, finish(truncated: boolean): AllocationDriver {
    return { rows: [...rows].sort(([a], [b]) => a < b ? -1 : 1).map(([, r]) => ({ ...r, gross: evidenceDecimal(r.gross), units: String(r.units) })),
      issues: [...issues].sort(), truncated };
  } };
}

export function allocateOperatingCost(amount: string, ruleValue: AllocationRule, driver?: AllocationDriver) {
  const rule = normalizeAllocationRule(ruleValue), cents = costCents(amount);
  if (cents === null) throw new Error("COST_ALLOCATION_INVALID_AMOUNT");
  const automatic = rule.method.startsWith("SALES_");
  if (automatic && (!driver || driver.truncated || driver.issues.length)) throw new Error("COST_ALLOCATION_SALES_INCOMPLETE");
  const byTarget = new Map<string, bigint>();
  if (automatic) for (const row of driver!.rows) {
    const weight = rule.method === "SALES_GROSS" ? evidenceCents(row.gross) : BigInt(row.units);
    if (weight < 0n) throw new Error("COST_ALLOCATION_INVALID_WEIGHT");
    for (const channel of [null, row.channel]) {
      const key = JSON.stringify([row.locationId, channel]);
      byTarget.set(key, (byTarget.get(key) ?? 0n) + weight);
    }
  }
  const weights = rule.targets.map(t => {
    if (rule.method === "WEIGHTED") return BigInt(t.weight!);
    if (!automatic) return 1n;
    return byTarget.get(targetKey(t)) ?? 0n;
  });
  if (weights.some(w => w < 0n)) throw new Error("COST_ALLOCATION_INVALID_WEIGHT");
  const total = weights.reduce((a, b) => a + b, 0n);
  if (total === 0n && cents !== 0n) throw new Error("COST_ALLOCATION_ZERO_BASIS");
  let cumulative = 0n, allocated = 0n;
  const magnitude = cents < 0n ? -cents : cents;
  return rule.targets.map((t, i) => {
    cumulative += weights[i];
    const target = total === 0n ? 0n : (magnitude * cumulative * 2n + total) / (total * 2n);
    const part = (target - allocated) * (cents < 0n ? -1n : 1n); allocated = target;
    return { locationId: t.locationId, channel: t.channel, basisWeight: String(weights[i]), amount: evidenceDecimal(part) };
  });
}
