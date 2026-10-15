import { evidenceCents as cents, evidenceDecimal as money } from "./salesEvidenceMath";

export type MenuPerformanceLine = {
  sku: string; size: string; units: string; revenue: string | null; cost: string | null;
};

/** Recorded activity, including signed returns. Never substitutes supplied demand for sales. */
export function createMenuPerformanceAccumulator() {
  const rows = new Map<string, { sku: string; size: string; units: bigint; revenue: bigint; cost: bigint;
    revenueComplete: boolean; costComplete: boolean }>();
  return {
    add(line: MenuPerformanceLine) {
      if (!line.sku || !line.size || !/^-?\d{1,14}$/.test(line.units)) throw new Error("MENU_ACTUAL_INVALID_LINE");
      const key = JSON.stringify([line.sku, line.size]);
      if (!rows.has(key)) rows.set(key, { sku: line.sku, size: line.size, units: 0n, revenue: 0n, cost: 0n,
        revenueComplete: true, costComplete: true });
      const row = rows.get(key)!;
      row.units += BigInt(line.units);
      if (line.revenue == null) row.revenueComplete = false; else row.revenue += cents(line.revenue);
      if (line.cost == null) row.costComplete = false; else row.cost += cents(line.cost);
    },
    finish(incomplete: boolean) {
      const population = [...rows.values()].sort((a, b) => a.sku.localeCompare(b.sku) || a.size.localeCompare(b.size));
      const units = population.reduce((sum, row) => sum + row.units, 0n);
      const contribution = population.reduce((sum, row) => sum + row.revenue - row.cost, 0n);
      const comparable = !incomplete && population.length > 0 && units > 0n
        && population.every(row => row.units >= 0n && row.revenueComplete && row.costComplete);
      return { complete: comparable, totalUnits: String(units),
        totalContribution: comparable ? money(contribution) : null,
        rows: population.map(row => {
          const margin = row.revenue - row.cost;
          const popular = row.units * BigInt(population.length) * 10n >= units * 7n;
          const profitable = margin * units >= contribution * row.units;
          return { sku: row.sku, size: row.size, units: String(row.units),
            revenue: row.revenueComplete ? money(row.revenue) : null,
            cost: row.costComplete ? money(row.cost) : null,
            contribution: row.revenueComplete && row.costComplete ? money(margin) : null,
            classification: row.units === 0n ? "NO_SALES" : row.units < 0n ? "NET_RETURNS" : !comparable ? "UNCLASSIFIED" : popular ? profitable ? "STAR" : "PLOWHORSE" : profitable ? "PUZZLE" : "DOG",
            popularityPercent: units > 0n && row.units >= 0n ? Number(row.units * 10000n / units) / 100 : null };
        }) };
    },
  };
}
