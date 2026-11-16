import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import {
  checklistTx,
  checklistPermission,
  executeChecklistInTx,
  lockChecklistRun,
  type ChecklistScope,
} from "./operationChecklists";
import {
  ChecklistError,
  checklistUuid,
  checklistText,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import { teamBranches, teamHash } from "./operationTeamReads";
import { teamNotice, operationSupervisor } from "./operationTeamDispatch";
import { dutyKey, teamInstant } from "./operationTeamPolicy";
import { isCapabilityEnabledInTx } from "./storeCapabilities";
import { consumeLotsForWastageInTx, receiveLotInTx } from "./lots";
import { recordMovement } from "./movements";
import { assertValuationLocation } from "./inventoryValuation";
import { recordInventoryWastageInTx } from "./wastage";
import { holdFactoryOutputInTx } from "./factoryQcPolicy";
import { directProduct } from "./operationProductionProduct";
import { factoryBomSnapshotInTx } from "./factoryBoms";
import {
  PRODUCTION_PERMISSIONS,
  productionDate,
  productionExpiryDate,
  productionMetrics,
  productionQuantity,
  productionIngredients,
  scaleProductionIngredients,
  type ProductionIngredient,
} from "./operationProductionPolicy";

export type ProductionCommand = {
  action: keyof typeof PRODUCTION_PERMISSIONS;
  idempotencyKey: string;
  confirmed: boolean;
  id?: string;
  version?: number;
  locationId?: string;
  recipeId?: string;
  factoryBomId?: string;
  factoryDemandId?: string;
  machineId?: string;
  outputSku?: string;
  outputSize?: string;
  plannedQty?: number;
  templateId?: string;
  dueAt?: string;
  assignedTo?: string;
  dutyKey?: string;
  actualQty?: number;
  ingredients?: ProductionIngredient[];
  producedOn?: string;
  expiryDate?: string;
  startedAt?: string;
  endedAt?: string;
  rejectedQty?: number;
  laborMinutes?: number;
  energyKwh?: number;
  note?: string;
  qty?: number;
  actionId?: string;
};
async function event(
  c: PoolClient,
  s: ChecklistScope,
  id: string,
  action: string,
  note: string,
  details: unknown = {},
) {
  await c.query(
    `INSERT INTO bms_operation_production_events(tenant_id,production_id,action,actor,note,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [s.tenantId, id, action, s.actorId, note, JSON.stringify(details)],
  );
  await c.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [
      s.tenantId,
      s.actorId,
      `operations.production.${action.toLowerCase()}`,
      id,
      JSON.stringify({ note, details }),
    ],
  );
}
async function stock(
  c: PoolClient,
  tenant: string,
  location: string,
  x: { sku: string; size: string },
) {
  const key = [tenant, location, x.sku, x.size];
  const r = (
    await c.query(
      `SELECT current_stock,reserved_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 FOR UPDATE`,
      key,
    )
  ).rows[0];
  const lots = (
    await c.query(
      `SELECT count(*)::int n,COALESCE(sum(qty),0)::int qty FROM bms_inventory_lots WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,
      key,
    )
  ).rows[0];
  if (!r || (lots.n > 0 && lots.qty !== r.current_stock))
    return reject("STOCK_RECONCILIATION_REQUIRED");
  return { ...r, tracked: lots.n > 0 };
}
export async function productionRecipe(
  c: PoolClient,
  tenant: string,
  id: string,
  planned: number,
) {
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  const r = (
    await c.query(
      `SELECT id,product_sku,size,version,output_qty,sop_steps FROM bms_product_recipes WHERE tenant_id=$1 AND id=$2 FOR SHARE`,
      [tenant, id],
    )
  ).rows[0];
  if (!r) return reject("NOT_FOUND");
  const items = (
    await c.query(
      `SELECT component_sku sku,component_size size,qty FROM bms_product_recipe_items WHERE tenant_id=$1 AND recipe_id=$2 ORDER BY component_sku,component_size`,
      [tenant, id],
    )
  ).rows;
  const recipeUnit =
    (
      await c.query(
        `SELECT base_unit FROM bms_product_stock_policies WHERE tenant_id=$1 AND product_sku=$2 FOR SHARE`,
        [tenant, r.product_sku],
      )
    ).rows[0]?.base_unit ?? "PIECE";
  const ingredients = [];
  for (const x of scaleProductionIngredients(items, r.output_qty, planned))
    ingredients.push({
      ...x,
      baseUnit: await directProduct(c, tenant, x.sku, x.size),
    });
  return {
    recipeId: r.id,
    recipeSku: r.product_sku,
    recipeVersion: r.version,
    recipeYield: r.output_qty,
    baseUnit: recipeUnit,
    sop: r.sop_steps ?? [],
    ingredients,
  };
}
async function execute(c: PoolClient, s: ChecklistScope, i: ProductionCommand) {
  const note = checklistText(i.note, 2000);
  if (i.action === "CREATE") {
    checklistPermission(s, "operations.checklist.manage");
    if (!i.locationId || Boolean(i.recipeId) === Boolean(i.factoryBomId) || !checklistUuid(i.templateId))
      return reject("INVALID_INPUT");
    await teamBranches(c, s, i.locationId);
    const planned = productionQuantity(i.plannedQty),
      due = teamInstant(i.dueAt),
      sku = checklistText(i.outputSku, 200, true),
      size = checklistText(i.outputSize, 100, true);
    const snapshot = i.factoryBomId
      ? await factoryBomSnapshotInTx(c, s.tenantId, i.factoryBomId, planned)
      : await productionRecipe(c, s.tenantId, i.recipeId!, planned);
    if (i.factoryDemandId) {
      if (!checklistUuid(i.factoryDemandId)) return reject("INVALID_INPUT");
      const demand = (await c.query(
        `SELECT location_id,output_sku,output_size,status FROM bms_factory_demands
         WHERE tenant_id=$1 AND id=$2 FOR SHARE`,
        [s.tenantId, i.factoryDemandId],
      )).rows[0];
      if (!demand || demand.status !== "OPEN" || demand.location_id !== i.locationId ||
          demand.output_sku !== sku || demand.output_size !== size)
        return reject("DEMAND_MISMATCH");
    }
    if (i.machineId) {
      if (!checklistUuid(i.machineId)) return reject("INVALID_INPUT");
      const machine = (await c.query(
        `SELECT 1 FROM bms_factory_machines WHERE tenant_id=$1 AND location_id=$2
         AND id=$3 AND active FOR SHARE`,
        [s.tenantId, i.locationId, i.machineId],
      ));
      if (!machine.rowCount) return reject("MACHINE_NOT_FOUND");
    }
    if (
      (i.factoryBomId
        ? snapshot.recipeSku !== sku || (snapshot as any).outputSize !== size
        : snapshot.recipeSku === sku) ||
      snapshot.ingredients.some((x) => x.sku === sku)
    )
      return reject("OUTPUT_MUST_BE_SEPARATE");
    const unit = await directProduct(c, s.tenantId, sku, size);
    if (unit !== snapshot.baseUnit) return reject("OUTPUT_UNIT_MISMATCH");
    if (!(await isCapabilityEnabledInTx(c, s.tenantId, "RECIPE")))
      return reject("RECIPE_DISABLED");
    const t = (
      await c.query(
        `SELECT location_id FROM bms_operation_templates WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, i.templateId],
      )
    ).rows[0];
    if (t?.location_id !== i.locationId) return reject("NOT_FOUND");
    if (i.dutyKey && i.assignedTo) return reject("INVALID_INPUT");
    const run = await executeChecklistInTx(
      c,
      s,
      {
        action: "CREATE_RUN",
        idempotencyKey: i.idempotencyKey,
        confirmed: true,
        templateId: i.templateId,
        dueAt: due,
        assignedTo: i.assignedTo,
        assignmentMode: i.dutyKey ? "DUTY" : "FIXED",
        dutyKey: i.dutyKey ? dutyKey(i.dutyKey) : undefined,
      },
      { assignmentAt: due },
    );
    const row = (
      await c.query(
        `INSERT INTO bms_operation_production(tenant_id,location_id,run_id,recipe_id,factory_bom_id,factory_demand_id,machine_id,output_sku,output_size,planned_qty,snapshot,note,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING id,version`,
        [
          s.tenantId,
          i.locationId,
          run.id,
          i.recipeId ?? null,
          i.factoryBomId ?? null,
          i.factoryDemandId ?? null,
          i.machineId ?? null,
          sku,
          size,
          planned,
          JSON.stringify(snapshot),
          note,
          s.actorId,
        ],
      )
    ).rows[0];
    await event(c, s, row.id, i.action, note, { runId: run.id });
    return { status: "OK", ...row };
  }
  if (!checklistUuid(i.id)) return reject("INVALID_INPUT");
  // Canonical run before production before sorted stock; handover transfer locks the same parent.
  const identity = (
    await c.query(
      `SELECT run_id FROM bms_operation_production WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, i.id],
    )
  ).rows[0];
  if (!identity) return reject("NOT_FOUND");
  const run = await lockChecklistRun(c, s, identity.run_id);
  const p = (
    await c.query(
      `SELECT * FROM bms_operation_production WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [s.tenantId, i.id],
    )
  ).rows[0];
  await teamBranches(c, s, p.location_id);
  if (p.version !== i.version) return reject("STALE_VERSION");
  if (i.action === "READY" || i.action === "CANCEL") {
    if (
      (i.action === "READY" && p.status !== "DRAFT") ||
      (i.action === "CANCEL" && !["DRAFT", "READY"].includes(p.status))
    )
      return reject("INVALID_STATE");
    if (i.action === "CANCEL" && !note) return reject("REASON_REQUIRED");
    if (i.action === "READY" && run.status === "VOID")
      return reject("INVALID_STATE");
    await c.query(
      `UPDATE bms_operation_production SET status=$3,version=version+1,note=$4 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, p.id, i.action === "READY" ? "READY" : "CANCELLED", note],
    );
  } else if (i.action === "POST") {
    if (!(await isCapabilityEnabledInTx(c, s.tenantId, "RECIPE")))
      return reject("RECIPE_DISABLED");
    if (p.status !== "READY" || run.status === "VOID")
      return reject("INVALID_STATE");
    if (
      run.assigned_to !== s.actorId &&
      !s.permissions.has("operations.production.manage")
    )
      return reject("NOT_ASSIGNED");
    await assertValuationLocation(c, s.tenantId, s.actorId, p.location_id);
    const actual = productionQuantity(i.actualQty),
      inputs = productionIngredients(i.ingredients),
      expected = productionIngredients(p.snapshot.ingredients);
    if (
      JSON.stringify(inputs.map((x) => [x.sku, x.size])) !==
      JSON.stringify(expected.map((x) => [x.sku, x.size]))
    )
      return reject("INGREDIENT_SET_CHANGED");
    if (
      (actual !== p.planned_qty ||
        inputs.some((x, n) => x.qty !== expected[n].qty)) &&
      !note
    )
      return reject("VARIANCE_REASON_REQUIRED");
    const outputPolicy = (
      await c.query<{ expiry_tracking: boolean }>(
        `SELECT expiry_tracking FROM bms_product_stock_policies WHERE tenant_id=$1 AND product_sku=$2 FOR SHARE`,
        [s.tenantId, p.output_sku],
      )
    ).rows[0];
    const produced = productionDate(i.producedOn),
      expiry = productionExpiryDate(i.expiryDate, outputPolicy?.expiry_tracking === true);
    const metrics = productionMetrics(i);
    if (metrics.rejectedQty && !note) return reject("VARIANCE_REASON_REQUIRED");
    if (p.machine_id && metrics.startedAt && metrics.endedAt) {
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${s.tenantId}:factory-machine:${p.machine_id}`,
      ]);
      const overlap = await c.query(
        `SELECT 1 FROM bms_operation_production
         WHERE tenant_id=$1 AND machine_id=$2 AND id<>$3 AND status='POSTED'
           AND started_at<$5::timestamptz AND ended_at>$4::timestamptz LIMIT 1`,
        [s.tenantId, p.machine_id, p.id, metrics.startedAt, metrics.endedAt],
      );
      if (overlap.rowCount) return reject("MACHINE_TIME_OVERLAP");
    }
    const today = (
      await c.query(
        `SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') today`,
      )
    ).rows[0].today;
    if (produced > today || (expiry !== null && (expiry < today || expiry < produced)))
      return reject("INVALID_DATE");
    // Require same base unit as the pinned definition even after catalog edits.
    const all = [
      ...inputs,
      { sku: p.output_sku, size: p.output_size, qty: actual },
    ].sort(
      (a, b) => a.sku.localeCompare(b.sku) || a.size.localeCompare(b.size),
    );
    for (const x of all) {
      const unit = await directProduct(c, s.tenantId, x.sku, x.size);
      if (x.sku === p.output_sku && unit !== p.snapshot.baseUnit)
        return reject("OUTPUT_UNIT_MISMATCH");
      if (
        x.sku !== p.output_sku &&
        unit !==
          p.snapshot.ingredients.find(
            (a: any) => a.sku === x.sku && a.size === x.size,
          )?.baseUnit
      )
        return reject("INGREDIENT_UNIT_CHANGED");
    }
    for (const x of all) {
      if (x.sku === p.output_sku)
        await c.query(
          `INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock) VALUES($1,$2,$3,$4,0,0) ON CONFLICT DO NOTHING`,
          [s.tenantId, p.location_id, x.sku, x.size],
        );
      const b = await stock(c, s.tenantId, p.location_id, x);
      if (x.sku === p.output_sku) {
        if (b.current_stock > 2147483647 - actual)
          return reject("QUANTITY_OVERFLOW");
        if (!b.tracked && b.current_stock !== 0)
          return reject("OUTPUT_LOT_RECONCILIATION_REQUIRED");
      } else if (b.current_stock - b.reserved_stock < x.qty)
        return reject("INSUFFICIENT_STOCK");
    }
    if (
      (
        await c.query(
          `SELECT id FROM bms_inventory_lots WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 AND lot_no=$5`,
          [
            s.tenantId,
            p.location_id,
            p.output_sku,
            p.output_size,
            `PREP-${p.id}`,
          ],
        )
      ).rowCount
    )
      return reject("OUTPUT_LOT_ALREADY_EXISTS");
    for (const x of inputs) {
      const allocations = await consumeLotsForWastageInTx(c, {
        tenantId: s.tenantId,
        locationId: p.location_id,
        productSku: x.sku,
        size: x.size,
        qty: x.qty,
        forProduction: true,
      });
      await c.query(
        `UPDATE bms_inventory SET current_stock=current_stock-$5,updated_at=now() WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,
        [s.tenantId, p.location_id, x.sku, x.size, x.qty],
      );
      const movement = await recordMovement(c, {
        tenantId: s.tenantId,
        locationId: p.location_id,
        sku: x.sku,
        size: x.size,
        qty: x.qty,
        type: "PRODUCTION_OUT",
        actor: s.actorId,
        note: `Production ${p.id}`,
      });
      await c.query(
        `INSERT INTO bms_operation_production_inputs(tenant_id,production_id,product_sku,size,qty,lots,movement_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          s.tenantId,
          p.id,
          x.sku,
          x.size,
          x.qty,
          JSON.stringify(allocations),
          movement,
        ],
      );
    }
    await c.query(
      `UPDATE bms_inventory SET current_stock=current_stock+$5,updated_at=now() WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,
      [s.tenantId, p.location_id, p.output_sku, p.output_size, actual],
    );
    const lot = await receiveLotInTx(c, {
      tenantId: s.tenantId,
      locationId: p.location_id,
      productSku: p.output_sku,
      size: p.output_size,
      qty: actual,
      lotNo: `PREP-${p.id}`,
      expiryDate: expiry,
      note: `Production ${p.id}; produced ${produced}`,
    });
    await recordMovement(c, {
      tenantId: s.tenantId,
      locationId: p.location_id,
      sku: p.output_sku,
      size: p.output_size,
      qty: actual,
      type: "PRODUCTION_IN",
      productionId: p.id,
      actor: s.actorId,
      note: `Production ${p.id}`,
    });
    await c.query(
      `UPDATE bms_operation_production SET status='POSTED',version=version+1,
       actual_qty=$3,output_lot_id=$4,produced_on=$5,expiry_date=$6,note=$7,
       started_at=$8,ended_at=$9,rejected_qty=$10,labor_minutes=$11,energy_kwh=$12,
       posted_at=now() WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, p.id, actual, lot, produced, expiry, note,
        metrics.startedAt, metrics.endedAt, metrics.rejectedQty,
        metrics.laborMinutes, metrics.energyKwh],
    );
    await holdFactoryOutputInTx(c, s, {
      productionId: p.id,
      runId: run.id,
      locationId: p.location_id,
      sku: p.output_sku,
      size: p.output_size,
      lotId: lot,
      qty: actual,
      baseUnit: p.snapshot.baseUnit,
    });
    if (actual !== p.planned_qty)
      await teamNotice(
        c,
        s.tenantId,
        p.location_id,
        await operationSupervisor(
          c,
          s.tenantId,
          p.location_id,
          new Date().toISOString(),
        ),
        run.id,
        "RUN",
        "PRODUCTION_VARIANCE",
        String(p.version + 1),
        "operations.checklist.review",
      );
  } else if (i.action === "WASTE") {
    if (p.status !== "POSTED") return reject("INVALID_STATE");
    checklistPermission(s, "stock.adjust");
    await assertValuationLocation(c, s.tenantId, s.actorId, p.location_id);
    // Catalog edits must not reinterpret a historical output lot in a different unit/policy.
    if (
      (await directProduct(c, s.tenantId, p.output_sku, p.output_size,
        { includeInactive: true })) !==
      p.snapshot.baseUnit
    )
      return reject("OUTPUT_UNIT_MISMATCH");
    if (!(await isCapabilityEnabledInTx(c, s.tenantId, "WASTAGE")))
      return reject("WASTAGE_DISABLED");
    if (!note) return reject("REASON_REQUIRED");
    const qty = productionQuantity(i.qty);
    if (i.actionId) {
      if (
        !checklistUuid(i.actionId) ||
        !(
          await c.query(
            `SELECT id FROM bms_operation_actions WHERE tenant_id=$1 AND id=$2 AND run_id=$3`,
            [s.tenantId, i.actionId, p.run_id],
          )
        ).rowCount
      )
        return reject("NOT_FOUND");
    }
    const balance = await stock(c, s.tenantId, p.location_id, {
      sku: p.output_sku,
      size: p.output_size,
    });
    const remaining = (
      await c.query(
        `SELECT qty FROM bms_inventory_lots WHERE tenant_id=$1 AND id=$2 AND location_id=$3 FOR UPDATE`,
        [s.tenantId, p.output_lot_id, p.location_id],
      )
    ).rows[0];
    if (
      !remaining ||
      remaining.qty < qty ||
      balance.current_stock - balance.reserved_stock < qty
    )
      return reject("INSUFFICIENT_STOCK");
    const waste = await recordInventoryWastageInTx(c, {
      tenantId: s.tenantId,
      locationId: p.location_id,
      productSku: p.output_sku,
      size: p.output_size,
      qty,
      reason: note,
      actorUserId: s.actorId,
      lotId: p.output_lot_id,
    });
    await c.query(
      `INSERT INTO bms_operation_production_waste(tenant_id,production_id,wastage_id,lot_id,qty,reason,action_id,created_by,movement_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        s.tenantId,
        p.id,
        waste.id,
        p.output_lot_id,
        qty,
        note,
        i.actionId || null,
        s.actorId,
        waste.movementId,
      ],
    );
    await c.query(
      `UPDATE bms_operation_production SET version=version+1 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, p.id],
    );
  }
  await event(c, s, p.id, i.action, note, {
    qty: i.qty ?? null,
    actualQty: i.actualQty ?? null,
  });
  return { status: "OK", id: p.id, version: p.version + 1 };
}
export async function commandProduction(
  s: ChecklistScope,
  i: ProductionCommand,
) {
  try {
    if (!i || !Object.hasOwn(PRODUCTION_PERMISSIONS, i.action))
      return reject("INVALID_INPUT");
    checklistPermission(s, PRODUCTION_PERMISSIONS[i.action]);
    if (i.action === "CREATE")
      checklistPermission(s, "operations.checklist.manage");
    if (i.action === "WASTE") checklistPermission(s, "stock.adjust");
    if (i.confirmed !== true) return reject("CONFIRMATION_REQUIRED");
    const key = `production:${checklistText(i.idempotencyKey, 128, true)}`,
      fingerprint = teamHash(i);
    return await checklistTx(s, async (c) => {
      // Revalidate branch before returning a previously successful command after access changes.
      if (i.id) {
        const r = (
          await c.query(
            `SELECT location_id FROM bms_operation_production WHERE tenant_id=$1 AND id=$2`,
            [s.tenantId, checklistUuid(i.id) ? i.id : reject("INVALID_INPUT")],
          )
        ).rows[0];
        if (!r) return reject("NOT_FOUND");
        await teamBranches(c, s, r.location_id);
      } else if (i.locationId) await teamBranches(c, s, i.locationId);
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${s.tenantId}:${s.actorId}:${key}`,
      ]);
      const old = (
        await c.query(
          `SELECT fingerprint,result FROM bms_operation_commands WHERE tenant_id=$1 AND actor=$2 AND key=$3`,
          [s.tenantId, s.actorId, key],
        )
      ).rows[0];
      if (old) {
        if (old.fingerprint !== fingerprint)
          return reject("IDEMPOTENCY_CONFLICT");
        return old.result;
      }
      const result = await execute(c, s, i);
      await c.query(
        `INSERT INTO bms_operation_commands(tenant_id,actor,key,fingerprint,result) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [s.tenantId, s.actorId, key, fingerprint, JSON.stringify(result)],
      );
      return result;
    });
  } catch (e) {
    if (e instanceof ChecklistError) return { status: e.status };
    if ((e as Error)?.message === "VALUATION_CURRENCY_REVIEW_REQUIRED")
      return { status: "VALUATION_CURRENCY_REVIEW_REQUIRED" };
    if ((e as Error)?.message === "PRODUCTION_INSUFFICIENT_USABLE_LOTS")
      return { status: "INSUFFICIENT_USABLE_LOTS" };
    if (["40001", "40P01"].includes((e as any)?.code))
      return { status: "RETRY_REQUIRED" };
    throw e;
  }
}
/** In-app notices only. Bounded oldest-first claims, same cron as checklist/team work. */
export async function runProductionFollowups(onlyTenant?: string) {
  const tenants = (
    await query(
      `SELECT p.tenant_id FROM bms_operation_production p JOIN bms_inventory_lots l ON l.tenant_id=p.tenant_id AND l.id=p.output_lot_id
  WHERE p.status='POSTED' AND l.qty>0 AND l.expiry_date<=(now() AT TIME ZONE 'Asia/Bangkok')::date+1
  AND ($1::uuid IS NULL OR p.tenant_id=$1) GROUP BY p.tenant_id ORDER BY min(p.followup_at),p.tenant_id LIMIT 100`,
      [onlyTenant ?? null],
    )
  ).rows;
  let processed = 0,
    failed = 0;
  for (const t of tenants)
    try {
      processed += await checklistTx(
        { tenantId: t.tenant_id, actorId: "system:operations" },
        async (c) => {
          const rows = (
            await c.query(
              `SELECT p.*,l.expiry_date::text lot_expiry,r.assigned_to,now() clock FROM bms_operation_production p
    JOIN bms_inventory_lots l ON l.tenant_id=p.tenant_id AND l.id=p.output_lot_id
    JOIN bms_operation_runs r ON r.tenant_id=p.tenant_id AND r.id=p.run_id
    WHERE p.tenant_id=$1 AND p.status='POSTED' AND l.qty>0 AND l.expiry_date<=(now() AT TIME ZONE 'Asia/Bangkok')::date+1
    ORDER BY p.followup_at,p.id LIMIT 100 FOR UPDATE OF p SKIP LOCKED`,
              [t.tenant_id],
            )
          ).rows;
          for (const p of rows) {
            const head = await operationSupervisor(
              c,
              t.tenant_id,
              p.location_id,
              p.clock.toISOString(),
            );
            await teamNotice(
              c,
              t.tenant_id,
              p.location_id,
              p.assigned_to,
              p.run_id,
              "RUN",
              "PRODUCTION_EXPIRY",
              `${p.id}:${p.lot_expiry}`,
            );
            if (head !== p.assigned_to)
              await teamNotice(
                c,
                t.tenant_id,
                p.location_id,
                head,
                p.run_id,
                "RUN",
                "PRODUCTION_EXPIRY",
                `${p.id}:${p.lot_expiry}`,
                "operations.checklist.review",
              );
            await c.query(
              `UPDATE bms_operation_production SET followup_at=now() WHERE tenant_id=$1 AND id=$2`,
              [t.tenant_id, p.id],
            );
          }
          return rows.length;
        },
      );
    } catch {
      failed++;
    }
  return { processed, failed };
}
