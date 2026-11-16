import type { PoolClient } from "pg";
import {
  checklistPermission,
  checklistTx,
  type ChecklistScope,
} from "./operationChecklists";
import {
  ChecklistError,
  checklistText,
  checklistUuid,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import { teamBranches, teamHash } from "./operationTeamReads";
import { checklistRecipient } from "./operationChecklistDispatch";
import {
  notifyLotAvailabilityInTx,
  notifyQualityCase,
} from "./operationQualityDispatch";

export type FactoryQcPolicyInput = {
  locationId: string;
  sku: string;
  size: string;
  required: boolean;
  dueMinutes: number;
  reviewerId?: string | null;
  confirmed: boolean;
  idempotencyKey: string;
};

function policyPermission(s: ChecklistScope) {
  checklistPermission(s, "operations.quality.manage");
  checklistPermission(s, "operations.production.manage");
  checklistPermission(s, "product.view");
}

export async function factoryQcPolicy(
  s: ChecklistScope,
  locationId: string,
  sku: string,
  size: string,
) {
  policyPermission(s);
  if (!checklistUuid(locationId)) return reject("INVALID_INPUT");
  const productSku = checklistText(sku, 200, true);
  const variant = checklistText(size, 100, true);
  return checklistTx(s, async (c) => {
    await teamBranches(c, s, locationId);
    const row = (
      await c.query(
        `SELECT required,due_minutes,reviewer_id,version FROM bms_factory_qc_policies
         WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,
        [s.tenantId, locationId, productSku, variant],
      )
    ).rows[0];
    return {
      locationId,
      sku: productSku,
      size: variant,
      required: row?.required === true,
      dueMinutes: row?.due_minutes ?? 1440,
      reviewerId: row?.reviewer_id ?? null,
      version: row?.version ?? 0,
    };
  });
}

export async function setFactoryQcPolicy(s: ChecklistScope, input: FactoryQcPolicyInput) {
  try {
    policyPermission(s);
    if (input.confirmed !== true) return reject("CONFIRMATION_REQUIRED");
    if (
      !checklistUuid(input.locationId) ||
      typeof input.required !== "boolean" ||
      !Number.isInteger(input.dueMinutes) ||
      input.dueMinutes < 1 ||
      input.dueMinutes > 10080
    ) return reject("INVALID_INPUT");
    const sku = checklistText(input.sku, 200, true);
    const size = checklistText(input.size, 100, true);
    const reviewerId = input.reviewerId || null;
    if (input.required && !checklistUuid(reviewerId)) return reject("QUALITY_REVIEWER_REQUIRED");
    const key = `factory-qc:${checklistText(input.idempotencyKey, 128, true)}`;
    const fingerprint = teamHash({ ...input, sku, size });
    return checklistTx(s, async (c) => {
      await teamBranches(c, s, input.locationId);
      if (input.required && !(await checklistRecipient(c, s.tenantId,
        reviewerId, input.locationId, "operations.quality.view")))
        return reject("QUALITY_REVIEWER_REQUIRED");
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${s.tenantId}:${s.actorId}:${key}`,
      ]);
      const prior = (
        await c.query(
          `SELECT fingerprint,result FROM bms_operation_commands
           WHERE tenant_id=$1 AND actor=$2 AND key=$3`,
          [s.tenantId, s.actorId, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint) return reject("IDEMPOTENCY_CONFLICT");
        return prior.result;
      }
      const product = (
        await c.query(
          `SELECT p.serial_tracked,p.is_bundle,COALESCE(sp.stock_policy,'DIRECT') stock_policy
           FROM bms_products p JOIN bms_product_variants v
             ON v.tenant_id=p.tenant_id AND v.product_sku=p.sku AND v.code=$3
           LEFT JOIN bms_product_stock_policies sp
             ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku
           WHERE p.tenant_id=$1 AND p.sku=$2 AND p.active AND v.active FOR SHARE OF p,v`,
          [s.tenantId, sku, size],
        )
      ).rows[0];
      if (!product || product.serial_tracked || product.is_bundle || product.stock_policy !== "DIRECT")
        return reject("DIRECT_STOCK_REQUIRED");
      const row = (
        await c.query(
          `INSERT INTO bms_factory_qc_policies
             (tenant_id,location_id,product_sku,size,required,due_minutes,reviewer_id,updated_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(tenant_id,location_id,product_sku,size)
           DO UPDATE SET required=EXCLUDED.required,due_minutes=EXCLUDED.due_minutes,
             reviewer_id=EXCLUDED.reviewer_id,version=bms_factory_qc_policies.version+1,
             updated_by=EXCLUDED.updated_by,updated_at=now()
           RETURNING version`,
          [s.tenantId, input.locationId, sku, size, input.required, input.dueMinutes,
            reviewerId, s.actorId],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
         VALUES($1,$2,'factory.qc_policy.set',$3,$4::jsonb)`,
        [s.tenantId, s.actorId, `${input.locationId}:${sku}:${size}`,
          JSON.stringify({ required: input.required, dueMinutes: input.dueMinutes,
            reviewerId })],
      );
      const result = { status: "OK", version: row.version };
      await c.query(
        `INSERT INTO bms_operation_commands(tenant_id,actor,key,fingerprint,result)
         VALUES($1,$2,$3,$4,$5::jsonb)`,
        [s.tenantId, s.actorId, key, fingerprint, JSON.stringify(result)],
      );
      return result;
    });
  } catch (e) {
    if (e instanceof ChecklistError) return { status: e.status };
    if (["40001", "40P01"].includes((e as any)?.code))
      return { status: "RETRY_REQUIRED" };
    throw e;
  }
}

/** Called after output-lot creation and before the production transaction commits. */
export async function holdFactoryOutputInTx(
  c: PoolClient,
  s: ChecklistScope,
  output: {
    productionId: string;
    runId: string;
    locationId: string;
    sku: string;
    size: string;
    lotId: string;
    qty: number;
    baseUnit: string;
  },
) {
  const policy = (
    await c.query<{ due_minutes: number; reviewer_id: string | null }>(
      `SELECT due_minutes,reviewer_id FROM bms_factory_qc_policies
       WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 AND required
       FOR SHARE`,
      [s.tenantId, output.locationId, output.sku, output.size],
    )
  ).rows[0];
  if (!policy) return null;
  const reviewer = policy.reviewer_id ?? s.actorId;
  if (!(await checklistRecipient(c, s.tenantId, reviewer, output.locationId,
    "operations.quality.view"))) return reject("QUALITY_REVIEWER_REQUIRED");
  const qualityCase = (
    await c.query<{ id: string; location_id: string; assigned_to: string; version: number }>(
      `INSERT INTO bms_operation_quality_cases
       (tenant_id,location_id,title,category,severity,assigned_to,due_at,facts,
        source_run_id,source_production_id,created_by)
       VALUES($1,$2,$3,'PRODUCTION_QC','NORMAL',$4,
              now()+($5::int*interval '1 minute'),$6,$7,$8,$9)
       RETURNING id,location_id,assigned_to,version`,
      [s.tenantId, output.locationId, `Production QC: ${output.sku}/${output.size}`,
        reviewer, policy.due_minutes, `Output lot ${output.lotId} pending quality review`,
        output.runId, output.productionId, s.actorId],
    )
  ).rows[0];
  await c.query(
    `INSERT INTO bms_operation_lot_holds
     (tenant_id,case_id,lot_id,base_unit,reason,created_by)
     VALUES($1,$2,$3,$4,'Production QC pending',$5)`,
    [s.tenantId, qualityCase.id, output.lotId, output.baseUnit, s.actorId],
  );
  await c.query(
    `INSERT INTO bms_operation_quality_events
     (tenant_id,case_id,action,actor,note,evidence)
     VALUES($1,$2,'AUTO_HOLD',$3,'Production output awaits QC',$4::jsonb)`,
    [s.tenantId, qualityCase.id, s.actorId,
      JSON.stringify({ productionId: output.productionId, lotId: output.lotId, qty: output.qty })],
  );
  await c.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
     VALUES($1,$2,'factory.qc_auto_hold',$3,$4::jsonb)`,
    [s.tenantId, s.actorId, qualityCase.id,
      JSON.stringify({ productionId: output.productionId, lotId: output.lotId })],
  );
  await notifyLotAvailabilityInTx(c, s.tenantId, s.actorId,
    { id: output.lotId, location_id: output.locationId }, "HOLD");
  await notifyQualityCase(c, s.tenantId, qualityCase, "QUALITY_CHANGED");
  return qualityCase.id;
}
