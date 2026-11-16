import type { PoolClient } from "pg";
import { checklistPermission, checklistTx, type ChecklistScope } from "./operationChecklists";
import { ChecklistError, checklistText, checklistUuid, rejectChecklist as reject } from "./operationChecklistPolicy";
import { productionIngredients, productionQuantity, scaleProductionIngredients, type ProductionIngredient } from "./operationProductionPolicy";
import { directProduct } from "./operationProductionProduct";
import { teamHash } from "./operationTeamReads";

export type FactoryBomInput = {
  outputSku: string;
  outputSize: string;
  expectedActiveVersion: number;
  outputQty: number;
  ingredients: ProductionIngredient[];
  sopSteps: string[];
  confirmed: boolean;
  idempotencyKey: string;
};

function manage(s: ChecklistScope) {
  checklistPermission(s, "operations.production.manage");
  checklistPermission(s, "product.edit");
}

export async function factoryBomSnapshotInTx(
  c: PoolClient, tenant: string, id: string, planned: number,
) {
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  const bom = (await c.query(
    `SELECT b.id,b.output_sku,b.output_size,b.output_base_unit,b.version,b.output_qty,b.sop_steps
     FROM bms_factory_boms b JOIN bms_products p
       ON p.tenant_id=b.tenant_id AND p.sku=b.output_sku
     WHERE b.tenant_id=$1 AND b.id=$2 AND b.active AND p.active FOR SHARE OF b,p`,
    [tenant, id],
  )).rows[0];
  if (!bom) return reject("NOT_FOUND");
  const baseUnit = await directProduct(c, tenant, bom.output_sku, bom.output_size);
  if (!bom.output_base_unit || baseUnit !== bom.output_base_unit)
    return reject("OUTPUT_UNIT_MISMATCH");
  const items = (await c.query(
    `SELECT component_sku sku,component_size size,component_base_unit,qty FROM bms_factory_bom_items
     WHERE tenant_id=$1 AND bom_id=$2 ORDER BY component_sku,component_size`,
    [tenant, id],
  )).rows;
  const units = new Map<string, string>();
  for (const x of items) {
    const current = await directProduct(c, tenant, x.sku, x.size);
    if (!x.component_base_unit || current !== x.component_base_unit)
      return reject("INGREDIENT_UNIT_CHANGED");
    units.set(JSON.stringify([x.sku, x.size]), x.component_base_unit);
  }
  const ingredients = [];
  for (const x of scaleProductionIngredients(items, bom.output_qty, planned))
    ingredients.push({ ...x, baseUnit: units.get(JSON.stringify([x.sku, x.size]))! });
  return {
    sourceKind: "FACTORY_BOM", factoryBomId: bom.id, outputSize: bom.output_size,
    recipeId: null, recipeSku: bom.output_sku, recipeVersion: bom.version,
    recipeYield: bom.output_qty, baseUnit, sop: bom.sop_steps, ingredients,
  };
}

export async function factoryBomDetail(s: ChecklistScope, id: string) {
  checklistPermission(s, "product.view");
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  return checklistTx(s, async (c) => {
    const bom = (await c.query(
      `SELECT id,output_sku,output_size,output_base_unit,version,output_qty,active,sop_steps,created_at
       FROM bms_factory_boms WHERE tenant_id=$1 AND id=$2`, [s.tenantId, id],
    )).rows[0];
    if (!bom) return reject("NOT_FOUND");
    const ingredients = (await c.query(
      `SELECT component_sku sku,component_size size,component_base_unit,qty FROM bms_factory_bom_items
       WHERE tenant_id=$1 AND bom_id=$2 ORDER BY component_sku,component_size`,
      [s.tenantId, id],
    )).rows;
    return { ...bom, ingredients };
  });
}

export async function saveFactoryBom(s: ChecklistScope, input: FactoryBomInput) {
  try {
    manage(s);
    if (input.confirmed !== true) return reject("CONFIRMATION_REQUIRED");
    if (!Number.isInteger(input.expectedActiveVersion) || input.expectedActiveVersion < 0 ||
        input.expectedActiveVersion > 2147483647) return reject("INVALID_INPUT");
    const outputSku = checklistText(input.outputSku, 200, true);
    const outputSize = checklistText(input.outputSize, 100, true);
    const outputQty = productionQuantity(input.outputQty);
    const ingredients = productionIngredients(input.ingredients);
    if (ingredients.some((x) => x.sku === outputSku))
      return reject("OUTPUT_MUST_BE_SEPARATE");
    if (!Array.isArray(input.sopSteps) || input.sopSteps.length > 50)
      return reject("INVALID_INPUT");
    const sop = input.sopSteps.map((x) => checklistText(x, 500, true));
    const key = `factory-bom:${checklistText(input.idempotencyKey, 128, true)}`;
    const fingerprint = teamHash({ outputSku, outputSize, outputQty, ingredients, sop });
    return await checklistTx(s, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${s.tenantId}:${s.actorId}:${key}`,
      ]);
      const prior = (await c.query(
        `SELECT fingerprint,result FROM bms_operation_commands
         WHERE tenant_id=$1 AND actor=$2 AND key=$3`,
        [s.tenantId, s.actorId, key],
      )).rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint) return reject("IDEMPOTENCY_CONFLICT");
        return prior.result;
      }
      // This product lock serializes version allocation and active-version replacement.
      const output = (await c.query(
        `SELECT sku FROM bms_products WHERE tenant_id=$1 AND sku=$2 AND active FOR UPDATE`,
        [s.tenantId, outputSku],
      )).rows[0];
      if (!output) return reject("DIRECT_STOCK_REQUIRED");
      const active = (await c.query<{ version: number }>(
        `SELECT version FROM bms_factory_boms
         WHERE tenant_id=$1 AND output_sku=$2 AND output_size=$3 AND active FOR UPDATE`,
        [s.tenantId, outputSku, outputSize],
      )).rows[0];
      if ((active?.version ?? 0) !== input.expectedActiveVersion)
        return reject("STALE_VERSION");
      const outputBaseUnit = await directProduct(c, s.tenantId, outputSku, outputSize);
      const componentUnits = new Map<string, string>();
      for (const x of ingredients)
        componentUnits.set(JSON.stringify([x.sku, x.size]),
          await directProduct(c, s.tenantId, x.sku, x.size));
      await c.query(
        `UPDATE bms_factory_boms SET active=false
         WHERE tenant_id=$1 AND output_sku=$2 AND output_size=$3 AND active`,
        [s.tenantId, outputSku, outputSize],
      );
      const row = (await c.query(
        `INSERT INTO bms_factory_boms
         (tenant_id,output_sku,output_size,output_base_unit,version,output_qty,active,sop_steps,created_by)
         VALUES($1,$2,$3,$4,
           COALESCE((SELECT max(version)+1 FROM bms_factory_boms
                     WHERE tenant_id=$1 AND output_sku=$2 AND output_size=$3),1),
           $5,true,$6::jsonb,$7) RETURNING id,version`,
        [s.tenantId, outputSku, outputSize, outputBaseUnit, outputQty,
          JSON.stringify(sop), s.actorId],
      )).rows[0];
      for (const x of ingredients) await c.query(
        `INSERT INTO bms_factory_bom_items
         (tenant_id,bom_id,component_sku,component_size,component_base_unit,qty)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [s.tenantId, row.id, x.sku, x.size,
          componentUnits.get(JSON.stringify([x.sku, x.size])), x.qty],
      );
      await c.query(
        `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
         VALUES($1,$2,'factory.bom.save',$3,$4::jsonb)`,
        [s.tenantId, s.actorId, row.id,
          JSON.stringify({ outputSku, outputSize, version: row.version, ingredientCount: ingredients.length })],
      );
      const result = { status: "OK", id: row.id, version: row.version };
      await c.query(
        `INSERT INTO bms_operation_commands(tenant_id,actor,key,fingerprint,result)
         VALUES($1,$2,$3,$4,$5::jsonb)`,
        [s.tenantId, s.actorId, key, fingerprint, JSON.stringify(result)],
      );
      return result;
    });
  } catch (e) {
    if (e instanceof ChecklistError) return { status: e.status };
    if (["40001", "40P01"].includes((e as any)?.code)) return { status: "RETRY_REQUIRED" };
    throw e;
  }
}
