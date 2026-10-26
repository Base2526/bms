import { query } from "@/lib/db";
import type { PoolClient } from "pg";
import {
  checklistPermission,
  checklistTx,
  executeChecklistInTx,
  lockChecklistRun,
  type ChecklistScope,
} from "./operationChecklists";
import {
  ChecklistError,
  checklistText,
  checklistUuid,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import {
  qualityAccess,
  qualityCase,
  qualityTrace,
} from "./operationQualityReads";
import { teamBranches, teamHash } from "./operationTeamReads";
import { teamInstant } from "./operationTeamPolicy";
import { checklistRecipient } from "./operationChecklistDispatch";
import { notifyQualityCase, notifyLotAvailabilityInTx } from "./operationQualityDispatch";
import { qualityStock } from "./lotQuality";
import { directProduct } from "./operationProduction";
import { recordInventoryWastageInTx } from "./wastage";
import { isCapabilityEnabledInTx } from "./storeCapabilities";
export const QUALITY_PERMISSIONS = {
  CREATE: "operations.quality.manage",
  UPDATE: "operations.quality.manage",
  HOLD: "operations.quality.hold",
  ASSIGN_RUN: "operations.quality.manage",
  SUBMIT: "operations.quality.manage",
  CLOSE: "operations.quality.review",
  REOPEN: "operations.quality.manage",
  PROPOSE_RELEASE: "operations.quality.manage",
  PROPOSE_DISPOSE: "operations.quality.manage",
  APPROVE: "operations.quality.review",
  REJECT: "operations.quality.review",
  SAVE_TRACE: "operations.quality.manage",
} as const;
export type QualityCommand = {
  action: keyof typeof QUALITY_PERMISSIONS;
  confirmed: boolean;
  idempotencyKey: string;
  id?: string;
  version?: number;
  locationId?: string;
  title?: string;
  category?: string;
  severity?: string;
  facts?: string;
  hypothesis?: string;
  observedCause?: string;
  assignedTo?: string;
  dueAt?: string;
  lotId?: string;
  expectedQty?: number;
  holdId?: string;
  holdVersion?: number;
  decisionId?: string;
  qty?: number;
  templateId?: string;
  runVersion?: number;
  fingerprint?: string;
  sourceRunId?: string;
  sourceInspectionId?: string;
  sourceProductionId?: string;
  note: string;
};
async function owner(
  c: PoolClient,
  s: ChecklistScope,
  id: unknown,
  location: string,
) {
  if (
    !checklistUuid(id) ||
    !(await checklistRecipient(
      c,
      s.tenantId,
      id as string,
      location,
      "operations.quality.view",
    ))
  )
    reject("INVALID_ASSIGNEE");
  return id as string;
}
async function lot(c: PoolClient, s: ChecklistScope, id: string) {
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  const l = (
    await c.query(
      `SELECT * FROM bms_inventory_lots WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, id],
    )
  ).rows[0];
  if (!l) return reject("NOT_FOUND");
  await teamBranches(c, s, l.location_id);
  // Match production's product -> inventory -> lot lock order.
  // Disabling sales must not prevent quarantining/discarding existing physical stock.
  const baseUnit = await directProduct(c, s.tenantId, l.product_sku, l.size, {
    includeInactive: true,
  });
  await qualityStock(c, s.tenantId, l.location_id, l.product_sku, l.size);
  const fresh = (
    await c.query(
      `SELECT *,expiry_date::text FROM bms_inventory_lots WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [s.tenantId, id],
    )
  ).rows[0];
  return { ...fresh, baseUnit };
}
async function approved(
  c: PoolClient,
  s: ChecklistScope,
  p: any,
  version: unknown,
) {
  if (!p.run_id) reject("REVIEW_REQUIRED");
  const r = await lockChecklistRun(c, s, p.run_id);
  if (r.status !== "APPROVED" || r.version !== version)
    reject("REVIEW_REQUIRED");
  return r;
}
async function bound(
  c: PoolClient,
  tenant: string,
  caseId: string,
  table: "bms_operation_lot_holds" | "bms_operation_quality_decisions",
) {
  if (
    (
      await c.query(
        `SELECT id FROM ${table} WHERE tenant_id=$1 AND case_id=$2 LIMIT 500`,
        [tenant, caseId],
      )
    ).rows.length >= 500
  )
    reject("REPORT_TOO_LARGE");
}
async function execute(c: PoolClient, s: ChecklistScope, i: QualityCommand) {
  const note = checklistText(i.note, 2000, true);
  let p: any,
    evidence: any = {};
  if (i.action === "CREATE") {
    if (!checklistUuid(i.locationId)) reject("INVALID_INPUT");
    await teamBranches(c, s, i.locationId);
    const assigned = await owner(c, s, i.assignedTo, i.locationId!);
    if (!["NORMAL", "URGENT"].includes(i.severity ?? ""))
      reject("INVALID_INPUT");
    // Source identity is checked by its real branch, never accepted as a label.
    for (const [id, sql] of [
      [
        i.sourceRunId,
        `SELECT location_id FROM bms_operation_runs WHERE tenant_id=$1 AND id=$2`,
      ],
      [
        i.sourceProductionId,
        `SELECT location_id FROM bms_operation_production WHERE tenant_id=$1 AND id=$2`,
      ],
      [
        i.sourceInspectionId,
        `SELECT p.location_id FROM bms_operation_material_inspections x JOIN bms_operation_material_links l ON l.tenant_id=x.tenant_id AND l.id=x.link_id JOIN bms_operation_material_plans p ON p.tenant_id=l.tenant_id AND p.id=l.plan_id WHERE x.tenant_id=$1 AND x.id=$2`,
      ],
    ]) {
      if (id) {
        if (!checklistUuid(id)) reject("INVALID_INPUT");
        const r = (await c.query(sql!, [s.tenantId, id])).rows[0];
        if (r?.location_id !== i.locationId) reject("INVALID_SOURCE");
      }
    }
    p = (
      await c.query(
        `INSERT INTO bms_operation_quality_cases(tenant_id,location_id,title,category,severity,assigned_to,due_at,facts,hypothesis,source_run_id,source_inspection_id,source_production_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          s.tenantId,
          i.locationId,
          checklistText(i.title, 160, true),
          checklistText(i.category, 80, true),
          i.severity,
          assigned,
          teamInstant(i.dueAt),
          checklistText(i.facts, 4000, true),
          checklistText(i.hypothesis, 2000),
          i.sourceRunId ?? null,
          i.sourceInspectionId ?? null,
          i.sourceProductionId ?? null,
          s.actorId,
        ],
      )
    ).rows[0];
  } else {
    p = await qualityCase(c, s, i.id!, true);
    if (p.version !== i.version) reject("STALE_VERSION");
    if (
      p.status === "CLOSED" &&
      i.action !== "REOPEN" &&
      i.action !== "SAVE_TRACE"
    )
      reject("INVALID_STATE");
  }
  if (i.action === "HOLD" || (i.action === "CREATE" && i.lotId)) {
    checklistPermission(s, "operations.quality.hold");
    await bound(c, s.tenantId, p.id, "bms_operation_lot_holds");
    const l = await lot(c, s, i.lotId!);
    if (l.qty !== i.expectedQty) reject("STOCK_CHANGED");
    const unit = l.baseUnit;
    await c.query(
      `INSERT INTO bms_operation_lot_holds(tenant_id,case_id,lot_id,base_unit,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
      [s.tenantId, p.id, l.id, unit, note, s.actorId],
    );
    await notifyLotAvailabilityInTx(c, s.tenantId, s.actorId, l, "HOLD");
    evidence = { lotId: l.id, qty: l.qty, baseUnit: unit };
    if (i.action === "HOLD")
      await c.query(
        `UPDATE bms_operation_quality_cases SET run_id=NULL,status='OPEN' WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, p.id],
      );
  } else if (i.action === "UPDATE") {
    const assigned = await owner(c, s, i.assignedTo, p.location_id),
      due = teamInstant(i.dueAt);
    if (p.run_id) {
      const r = await lockChecklistRun(c, s, p.run_id);
      // Terminal inspections are historical evidence, not the current case assignment.
      // Findings-only updates must also leave submitted inspection versions untouched.
      if (
        !["APPROVED", "VOID"].includes(r.status) &&
        (r.assigned_to !== assigned ||
          new Date(r.due_at).getTime() !== new Date(due).getTime())
      )
        await executeChecklistInTx(c, s, {
          action: "ASSIGN",
          id: r.id,
          version: r.version,
          assignedTo: assigned,
          dueAt: due,
          confirmed: true,
          idempotencyKey: i.idempotencyKey,
          note,
        });
    }
    await c.query(
      `UPDATE bms_operation_quality_cases SET assigned_to=$3,due_at=$4,hypothesis=$5,observed_cause=$6 WHERE tenant_id=$1 AND id=$2`,
      [
        s.tenantId,
        p.id,
        assigned,
        due,
        checklistText(i.hypothesis, 2000),
        checklistText(i.observedCause, 2000),
      ],
    );
  } else if (i.action === "ASSIGN_RUN") {
    checklistPermission(s, "operations.checklist.manage");
    if (!checklistUuid(i.templateId)) reject("INVALID_INPUT");
    if (p.run_id) {
      const old = await lockChecklistRun(c, s, p.run_id);
      if (!["APPROVED", "VOID"].includes(old.status))
        reject("TASK_STILL_ACTIVE");
    }
    const t = (
      await c.query(
        `SELECT location_id,separate_reviewer,status FROM bms_operation_templates WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, i.templateId],
      )
    ).rows[0];
    if (
      t?.location_id !== p.location_id ||
      !t.separate_reviewer ||
      t.status !== "ACTIVE"
    )
      reject("SEPARATE_REVIEW_REQUIRED");
    const r = await executeChecklistInTx(c, s, {
      action: "CREATE_RUN",
      templateId: i.templateId,
      assignedTo: p.assigned_to,
      dueAt: new Date(p.due_at).toISOString(),
      confirmed: true,
      idempotencyKey: i.idempotencyKey,
    });
    await c.query(
      `UPDATE bms_operation_quality_cases SET run_id=$3,status='INVESTIGATING' WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, p.id, r.id],
    );
    evidence = { runId: r.id };
  } else if (i.action === "SUBMIT") {
    await approved(c, s, p, i.runVersion);
    await c.query(
      `UPDATE bms_operation_quality_cases SET status='REVIEW',observed_cause=$3 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, p.id, checklistText(i.observedCause, 2000, true)],
    );
  } else if (i.action === "CLOSE") {
    if (
      p.status !== "REVIEW" ||
      [p.assigned_to, p.created_by].includes(s.actorId)
    )
      reject("SEPARATE_REVIEW_REQUIRED");
    await approved(c, s, p, i.runVersion);
    if (
      (
        await c.query(
          `SELECT 1 FROM bms_operation_lot_holds h WHERE h.tenant_id=$1 AND h.case_id=$2 AND h.status='ACTIVE' LIMIT 1`,
          [s.tenantId, p.id],
        )
      ).rowCount
    )
      reject("ACTIVE_HELD_STOCK");
    if (
      (
        await c.query(
          `SELECT 1 FROM bms_operation_quality_decisions WHERE tenant_id=$1 AND case_id=$2 AND status='PENDING' LIMIT 1`,
          [s.tenantId, p.id],
        )
      ).rowCount
    )
      reject("DECISION_PENDING");
    await c.query(
      `UPDATE bms_operation_quality_cases SET status='CLOSED' WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, p.id],
    );
  } else if (i.action === "REOPEN") {
    if (p.status !== "CLOSED") reject("INVALID_STATE");
    await c.query(
      `UPDATE bms_operation_quality_cases SET status='OPEN',run_id=NULL WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, p.id],
    );
  } else if (["PROPOSE_RELEASE", "PROPOSE_DISPOSE"].includes(i.action)) {
    await approved(c, s, p, i.runVersion);
    if (!checklistUuid(i.holdId)) reject("INVALID_INPUT");
    const h = (
      await c.query(
        `SELECT * FROM bms_operation_lot_holds WHERE tenant_id=$1 AND id=$2 AND case_id=$3`,
        [s.tenantId, i.holdId, p.id],
      )
    ).rows[0];
    if (!h || h.status !== "ACTIVE" || h.version !== i.holdVersion)
      reject("STALE_VERSION");
    const l = await lot(c, s, h.lot_id);
    if (l.qty !== i.expectedQty) reject("STOCK_CHANGED");
    const qty = i.action === "PROPOSE_RELEASE" ? 0 : i.qty;
    if (
      !Number.isInteger(qty) ||
      qty! < 0 ||
      qty! > l.qty ||
      (i.action === "PROPOSE_DISPOSE" && qty === 0)
    )
      reject("INVALID_QUANTITY");
    await c.query(
      `INSERT INTO bms_operation_quality_decisions(tenant_id,case_id,hold_id,kind,qty,hold_version,lot_qty,run_version,proposed_by,note,run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        s.tenantId,
        p.id,
        h.id,
        i.action === "PROPOSE_RELEASE" ? "RELEASE" : "DISPOSE",
        qty,
        h.version,
        l.qty,
        i.runVersion,
        s.actorId,
        note,
        p.run_id,
      ],
    );
  } else if (["APPROVE", "REJECT"].includes(i.action)) {
    if (!checklistUuid(i.decisionId)) reject("INVALID_INPUT");
    const d = (
      await c.query(
        `SELECT * FROM bms_operation_quality_decisions WHERE tenant_id=$1 AND id=$2 AND case_id=$3 FOR UPDATE`,
        [s.tenantId, i.decisionId, p.id],
      )
    ).rows[0];
    if (!d || d.status !== "PENDING") reject("INVALID_STATE");
    if (d.proposed_by === s.actorId) reject("SEPARATE_REVIEW_REQUIRED");
    const h = (
      await c.query(
        `SELECT * FROM bms_operation_lot_holds WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, d.hold_id],
      )
    ).rows[0];
    let movement = null;
    if (i.action === "APPROVE") {
      const l = await lot(c, s, h.lot_id);
      if (!d.run_id || d.run_id !== p.run_id) reject("REVIEW_REQUIRED");
      await approved(c, s, p, d.run_version);
      if (
        h.status !== "ACTIVE" ||
        h.version !== d.hold_version ||
        l.qty !== d.lot_qty
      )
        reject("STOCK_CHANGED");
      if (l.baseUnit !== h.base_unit) reject("SOURCE_UNIT_CHANGED");
      if (d.kind === "RELEASE") {
        await c.query(
          `UPDATE bms_operation_lot_holds SET status='RELEASED',version=version+1,released_by=$3,released_at=now() WHERE tenant_id=$1 AND id=$2`,
          [s.tenantId, h.id, s.actorId],
        );
        await notifyLotAvailabilityInTx(c, s.tenantId, s.actorId, l, "RELEASE");
      } else {
        checklistPermission(s, "stock.adjust");
        if (!(await isCapabilityEnabledInTx(c, s.tenantId, "WASTAGE")))
          reject("WASTAGE_DISABLED");
        const stock = await qualityStock(
          c,
          s.tenantId,
          l.location_id,
          l.product_sku,
          l.size,
        );
        if (!stock.reconciled) reject("STOCK_RECONCILIATION_REQUIRED");
        if (d.qty > stock.stock - stock.reserved)
          reject("INSUFFICIENT_UNRESERVED");
        movement = (
          await recordInventoryWastageInTx(
            c,
            {
              tenantId: s.tenantId,
              locationId: l.location_id,
              productSku: l.product_sku,
              size: l.size,
              qty: d.qty,
              reason: note,
              actorUserId: s.actorId,
              lotId: l.id,
            },
            { qualityDisposal: true },
          )
        ).movementId;
        await c.query(
          `UPDATE bms_operation_lot_holds SET version=version+1 WHERE tenant_id=$1 AND id=$2`,
          [s.tenantId, h.id],
        );
      }
    }
    await c.query(
      `UPDATE bms_operation_quality_decisions SET status=$3,reviewed_by=$4,review_note=$5,movement_id=$6,reviewed_at=now() WHERE tenant_id=$1 AND id=$2`,
      [
        s.tenantId,
        d.id,
        i.action === "APPROVE" ? "APPLIED" : "REJECTED",
        s.actorId,
        note,
        movement,
      ],
    );
    evidence = {
      decisionId: d.id,
      holdId: h.id,
      lotId: h.lot_id,
      kind: d.kind,
      qty: d.qty,
      movementId: movement,
    };
  } else if (i.action === "SAVE_TRACE") {
    const trace = await qualityTrace(c, s, i.lotId!);
    if (trace.fingerprint !== i.fingerprint) reject("SNAPSHOT_CHANGED");
    evidence = trace;
  }
  if (i.action !== "CREATE")
    await c.query(
      `UPDATE bms_operation_quality_cases SET version=version+1 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, p.id],
    );
  p = await qualityCase(c, s, p.id);
  await c.query(
    `INSERT INTO bms_operation_quality_events(tenant_id,case_id,action,actor,note,evidence) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      s.tenantId,
      p.id,
      i.action,
      s.actorId,
      note,
      JSON.stringify({ ...evidence, version: p.version }),
    ],
  );
  await c.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [
      s.tenantId,
      s.actorId,
      `operations.quality.${i.action.toLowerCase()}`,
      p.id,
      JSON.stringify({ version: p.version, note }),
    ],
  );
  await notifyQualityCase(
    c,
    s.tenantId,
    p,
    i.action === "SUBMIT" || i.action.startsWith("PROPOSE_")
      ? "QUALITY_REVIEW"
      : "QUALITY_CHANGED",
  );
  return { status: "OK", id: p.id, version: p.version };
}
export async function commandQuality(s: ChecklistScope, i: QualityCommand) {
  try {
    qualityAccess(s);
    if (!i || !Object.hasOwn(QUALITY_PERMISSIONS, i.action))
      reject("INVALID_INPUT");
    checklistPermission(s, QUALITY_PERMISSIONS[i.action]);
    if (i.action === "CREATE" && i.lotId)
      checklistPermission(s, "operations.quality.hold");
    if (i.action === "ASSIGN_RUN" || i.action === "UPDATE")
      checklistPermission(s, "operations.checklist.manage");
    if (i.confirmed !== true) reject("CONFIRMATION_REQUIRED");
    checklistText(i.note, 2000, true);
    const key = `quality:${checklistText(i.idempotencyKey, 128, true)}`,
      fingerprint = teamHash(i);
    return await checklistTx(
      s,
      async (c) => {
        if (i.action === "CREATE") {
          if (!checklistUuid(i.locationId)) reject("INVALID_INPUT");
          await teamBranches(c, s, i.locationId);
        } else await qualityCase(c, s, i.id!);
        // Re-check target permissions even on an idempotent replay, not only in execute().
        let target = i.lotId;
        if (i.holdId || i.decisionId) {
          const row = (
            await c.query(
              `SELECT h.lot_id,d.kind FROM bms_operation_lot_holds h LEFT JOIN bms_operation_quality_decisions d ON d.tenant_id=h.tenant_id AND d.hold_id=h.id AND d.id=$3 WHERE h.tenant_id=$1 AND h.case_id=$4 AND (h.id=$2 OR d.id=$3)`,
              [
                s.tenantId,
                checklistUuid(i.holdId) ? i.holdId : null,
                checklistUuid(i.decisionId) ? i.decisionId : null,
                i.id,
              ],
            )
          ).rows[0];
          if (!row) reject("NOT_FOUND");
          target = row.lot_id;
          if (i.action === "APPROVE" && row.kind === "DISPOSE")
            checklistPermission(s, "stock.adjust");
        }
        if (target) {
          if (!checklistUuid(target)) reject("INVALID_INPUT");
          const row = (
            await c.query(
              `SELECT location_id FROM bms_inventory_lots WHERE tenant_id=$1 AND id=$2`,
              [s.tenantId, target],
            )
          ).rows[0];
          if (!row) reject("NOT_FOUND");
          await teamBranches(c, s, row.location_id);
        }
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `${s.tenantId}:quality`,
        ]);
        const old = (
          await c.query(
            `SELECT fingerprint,result FROM bms_operation_commands WHERE tenant_id=$1 AND actor=$2 AND key=$3`,
            [s.tenantId, s.actorId, key],
          )
        ).rows[0];
        if (old) {
          if (old.fingerprint !== fingerprint) reject("IDEMPOTENCY_CONFLICT");
          return old.result;
        }
        const r = await execute(c, s, i);
        await c.query(
          `INSERT INTO bms_operation_commands(tenant_id,actor,key,fingerprint,result) VALUES($1,$2,$3,$4,$5::jsonb)`,
          [s.tenantId, s.actorId, key, fingerprint, JSON.stringify(r)],
        );
        return r;
      },
      { serializable: true },
    );
  } catch (e) {
    if (e instanceof ChecklistError) return { status: e.status };
    if (["40001", "40P01"].includes((e as any)?.code))
      return { status: "RETRY_REQUIRED" };
    if ((e as any)?.code === "23505")
      return { status: "ALREADY_PENDING_OR_HELD" };
    throw e;
  }
}
export async function runQualityFollowups(onlyTenant?: string) {
  const tenants = (
    await query(
      `SELECT tenant_id FROM bms_operation_quality_cases WHERE status<>'CLOSED' AND ($1::uuid IS NULL OR tenant_id=$1) GROUP BY tenant_id ORDER BY min(followup_at),tenant_id LIMIT 100`,
      [onlyTenant ?? null],
    )
  ).rows;
  let processed = 0,
    failed = 0;
  for (const t of tenants)
    try {
      processed += await checklistTx(
        { tenantId: t.tenant_id, actorId: "system:quality" },
        async (c) => {
          const rows = (
            await c.query(
              `SELECT * FROM bms_operation_quality_cases WHERE tenant_id=$1 AND status<>'CLOSED' ORDER BY followup_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
              [t.tenant_id],
            )
          ).rows;
          for (const p of rows) {
            if (new Date(p.due_at).getTime() < Date.now())
              await notifyQualityCase(c, t.tenant_id, p, "QUALITY_OVERDUE");
            await c.query(
              `UPDATE bms_operation_quality_cases SET followup_at=now() WHERE tenant_id=$1 AND id=$2`,
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
