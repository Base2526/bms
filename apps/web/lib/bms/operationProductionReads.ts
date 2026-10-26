import type { PoolClient } from "pg";
import { usableLotSql } from "./lotQuality";
import {
  checklistTx,
  checklistPermission,
  type ChecklistScope,
} from "./operationChecklists";
import { teamBranches, teamPage } from "./operationTeamReads";
import {
  checklistUuid,
  checklistReportDates,
  checklistText,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import { productionRecipe } from "./operationProduction";
import { productionQuantity } from "./operationProductionPolicy";
export async function availability(
  c: PoolClient,
  tenant: string,
  location: string,
  sku: string,
  size: string,
  neededOn?: string,
) {
  const r = (
    await c.query(
      `SELECT i.current_stock stock,i.reserved_stock reserved,
  (SELECT count(*)::int FROM bms_inventory_lots l WHERE l.tenant_id=i.tenant_id AND l.location_id=i.location_id AND l.product_sku=i.product_sku AND l.size=i.size) tracked,
  (SELECT COALESCE(sum(qty),0)::int FROM bms_inventory_lots l WHERE l.tenant_id=i.tenant_id AND l.location_id=i.location_id AND l.product_sku=i.product_sku AND l.size=i.size) lot_total,
  (SELECT COALESCE(sum(qty),0)::int FROM bms_inventory_lots l WHERE l.tenant_id=i.tenant_id AND l.location_id=i.location_id AND l.product_sku=i.product_sku AND l.size=i.size AND ${usableLotSql("l")} AND (expiry_date IS NULL OR expiry_date >= GREATEST(COALESCE($5::date,(now() AT TIME ZONE 'Asia/Bangkok')::date),(now() AT TIME ZONE 'Asia/Bangkok')::date))) eligible
  FROM bms_inventory i WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,
      [tenant, location, sku, size, neededOn ?? null],
    )
  ).rows[0];
  if (!r) return { stock: 0, reserved: 0, available: 0, reconciled: true };
  const reconciled = !r.tracked || r.stock === r.lot_total;
  return {
    stock: r.stock,
    reserved: r.reserved,
    available: reconciled
      ? Math.max(
          0,
          Math.min(r.stock, r.tracked ? r.eligible : r.stock) - r.reserved,
        )
      : null,
    reconciled,
  };
}
export async function productionWorkspace(
  s: ChecklistScope,
  filter: {
    locationId?: string;
    search?: string;
    recipeSearch?: string;
    outputSearch?: string;
    offset?: number;
    mine?: boolean;
    status?: string;
    from?: string;
    to?: string;
  } = {},
) {
  checklistPermission(s, "product.view");
  const search = checklistText(filter.search, 120),
    recipeSearch = checklistText(filter.recipeSearch ?? filter.search, 120),
    outputSearch = checklistText(filter.outputSearch ?? filter.search, 120),
    offset = teamPage(filter.offset),
    status = filter.status ?? "";
  if (!["", "DRAFT", "READY", "POSTED", "CANCELLED"].includes(status))
    return reject("INVALID_INPUT");
  const period =
    filter.from || filter.to
      ? checklistReportDates(filter.from, filter.to)
      : null;
  return checklistTx(s, async (c) => {
    const locations = await teamBranches(c, s, filter.locationId);
    const predicate = `p.tenant_id=$1 AND p.location_id=ANY($2::uuid[]) AND ($3='' OR position(lower($3) in lower(p.output_sku||' '||p.id::text))>0)
    AND (NOT $4::boolean OR r.assigned_to=$5) AND ($6='' OR p.status=$6)
    AND ($7::date IS NULL OR (r.due_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $7::date AND $8::date)`;
    const args = [
      s.tenantId,
      locations,
      search,
      filter.mine === true,
      s.actorId,
      status,
      period?.from ?? null,
      period?.to ?? null,
    ];
    const rows = (
      await c.query(
        `SELECT p.id,p.location_id,p.run_id,p.output_sku,p.output_size,p.planned_qty,p.actual_qty,p.status,p.version,r.due_at,r.assigned_to,
   p.expiry_date::text,p.created_at FROM bms_operation_production p JOIN bms_operation_runs r ON r.tenant_id=p.tenant_id AND r.id=p.run_id
   WHERE ${predicate} ORDER BY r.due_at DESC,p.id LIMIT 25 OFFSET $9`,
        [...args, offset],
      )
    ).rows;
    const total = Number(
      (
        await c.query(
          `SELECT count(*) FROM bms_operation_production p JOIN bms_operation_runs r ON r.tenant_id=p.tenant_id AND r.id=p.run_id WHERE ${predicate}`,
          args,
        )
      ).rows[0].count,
    );
    // Catalog options use server-side search and explicit truncation, never pretend a bounded list is complete.
    const recipes = (
      await c.query(
        `SELECT r.id,r.product_sku,r.size,r.version,r.output_qty FROM bms_product_recipes r WHERE r.tenant_id=$1
   AND ($2='' OR position(lower($2) in lower(r.product_sku))>0) ORDER BY r.product_sku,r.version DESC LIMIT 101`,
        [s.tenantId, recipeSearch],
      )
    ).rows;
    const outputs = (
      await c.query(
        `SELECT v.product_sku,v.code size,p.name,COALESCE(sp.base_unit,'PIECE') base_unit FROM bms_product_variants v
   JOIN bms_products p ON p.tenant_id=v.tenant_id AND p.sku=v.product_sku
   LEFT JOIN bms_product_stock_policies sp ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku
   WHERE v.tenant_id=$1 AND v.active AND NOT p.serial_tracked AND NOT p.is_bundle AND COALESCE(sp.stock_policy,'DIRECT')='DIRECT'
   AND ($2='' OR position(lower($2) in lower(p.sku||' '||p.name))>0) ORDER BY v.product_sku,v.code LIMIT 101`,
        [s.tenantId, outputSearch],
      )
    ).rows;
    return {
      rows,
      total,
      recipes: recipes.slice(0, 100),
      outputs: outputs.slice(0, 100),
      optionsTruncated: recipes.length > 100 || outputs.length > 100,
    };
  });
}
export async function productionPreview(
  s: ChecklistScope,
  i: {
    locationId: string;
    recipeId: string;
    plannedQty: number;
    outputSku: string;
    outputSize: string;
  },
) {
  checklistPermission(s, "product.view");
  return checklistTx(
    s,
    async (c) => {
      await teamBranches(c, s, i.locationId);
      const recipe = await productionRecipe(
        c,
        s.tenantId,
        i.recipeId,
        productionQuantity(i.plannedQty),
      );
      const ingredients = [];
      for (const x of recipe.ingredients)
        ingredients.push({
          ...x,
          ...(await availability(c, s.tenantId, i.locationId, x.sku, x.size)),
        });
      return {
        ...recipe,
        ingredients,
        output: await availability(
          c,
          s.tenantId,
          i.locationId,
          checklistText(i.outputSku, 200, true),
          checklistText(i.outputSize, 100, true),
        ),
      };
    },
    { serializable: true },
  );
}
export async function productionDetail(s: ChecklistScope, id: string) {
  checklistPermission(s, "product.view");
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  return checklistTx(
    s,
    async (c) => {
      const p = (
        await c.query(
          `SELECT p.*,p.produced_on::text produced_on,p.expiry_date::text expiry_date,r.assigned_to,r.due_at,r.status run_status
    FROM bms_operation_production p JOIN bms_operation_runs r ON r.tenant_id=p.tenant_id AND r.id=p.run_id WHERE p.tenant_id=$1 AND p.id=$2`,
          [s.tenantId, id],
        )
      ).rows[0];
      if (!p) return reject("NOT_FOUND");
      await teamBranches(c, s, p.location_id);
      const inputs = (
        await c.query(
          `SELECT i.*,v.amount::text FROM bms_operation_production_inputs i LEFT JOIN bms_inventory_value_entries v ON v.tenant_id=i.tenant_id AND v.movement_id=i.movement_id WHERE i.tenant_id=$1 AND i.production_id=$2 ORDER BY i.product_sku,i.size`,
          [s.tenantId, id],
        )
      ).rows;
      const totals = (
        await c.query(
          `SELECT CASE WHEN count(*)>0 AND bool_and(v.amount IS NOT NULL) THEN sum(v.amount) END::text value,
   CASE WHEN count(*)>0 AND bool_and(v.amount IS NOT NULL) THEN round(sum(v.amount)/NULLIF($3::int,0),6) END::text unit_cost
   FROM bms_operation_production_inputs i LEFT JOIN bms_inventory_value_entries v ON v.tenant_id=i.tenant_id AND v.movement_id=i.movement_id WHERE i.tenant_id=$1 AND i.production_id=$2`,
          [s.tenantId, id, p.actual_qty],
        )
      ).rows[0];
      const costVisible = s.permissions.has("report.view");
      const waste = (
        await c.query(
          `SELECT id,qty,reason,action_id,created_at FROM bms_operation_production_waste WHERE tenant_id=$1 AND production_id=$2 ORDER BY created_at DESC LIMIT 201`,
          [s.tenantId, id],
        )
      ).rows;
      const events = (
        await c.query(
          `SELECT action,actor,note,created_at FROM bms_operation_production_events WHERE tenant_id=$1 AND production_id=$2 ORDER BY id DESC LIMIT 201`,
          [s.tenantId, id],
        )
      ).rows;
      const lot = p.output_lot_id
        ? (
            await c.query(
              `SELECT id,lot_no,qty,expiry_date::text FROM bms_inventory_lots WHERE tenant_id=$1 AND id=$2 AND location_id=$3`,
              [s.tenantId, p.output_lot_id, p.location_id],
            )
          ).rows[0]
        : null;
      return {
        ...p,
        inputs: inputs.map((x) => ({
          ...x,
          amount: costVisible ? x.amount : null,
        })),
        costVisible,
        value: costVisible ? totals.value : null,
        unitCost: costVisible ? totals.unit_cost : null,
        lot,
        waste: waste.slice(0, 200),
        events: events.slice(0, 200),
        historyTruncated: waste.length > 200 || events.length > 200,
      };
    },
    { serializable: true },
  );
}
export async function productionForRun(s: ChecklistScope, id: string) {
  checklistPermission(s, "product.view");
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  return checklistTx(s, async (c) => {
    const p = (
      await c.query(
        `SELECT id,location_id FROM bms_operation_production WHERE tenant_id=$1 AND run_id=$2`,
        [s.tenantId, id],
      )
    ).rows[0];
    if (!p) return null;
    await teamBranches(c, s, p.location_id);
    return p.id;
  });
}
