import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  checklistPermission,
  type ChecklistScope,
} from "./operationChecklists";
import {
  checklistText,
  checklistUuid,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import { checklistRecipient } from "./operationChecklistDispatch";
import { teamBranches } from "./operationTeamReads";
import { dutyKey } from "./operationTeamPolicy";

export async function standardReadinessInTx(
  c: PoolClient,
  s: ChecklistScope,
  location: string,
  staff: string,
  duty?: string,
) {
  await teamBranches(c, s, location);
  if (
    staff !== s.actorId &&
    ![
      "operations.standard.assess",
      "operations.standard.manage",
      "operations.roster.manage",
      "operations.summary.review",
    ].some((p) => s.permissions.has(p))
  )
    reject("FORBIDDEN");
  if (!checklistUuid(staff)) reject("INVALID_INPUT");
  if (
    !(await checklistRecipient(
      c,
      s.tenantId,
      staff,
      location,
      "operations.checklist.view",
    ))
  )
    reject("INVALID_ASSIGNEE");
  const rows = (
    await c.query(
      `SELECT st.id,st.title,st.duty_key,st.version,st.training_required,
    EXISTS(SELECT 1 FROM bms_operation_learning a WHERE a.tenant_id=st.tenant_id AND a.basis_id=st.ack_basis_id AND a.staff_id=$3 AND a.kind='ACK') acknowledged,
    EXISTS(SELECT 1 FROM bms_operation_learning a WHERE a.tenant_id=st.tenant_id AND a.basis_id=st.training_basis_id AND a.staff_id=$3 AND a.kind='TRAINED') trained,
    (SELECT a.kind FROM bms_operation_learning a WHERE a.tenant_id=st.tenant_id AND a.basis_id=st.training_basis_id AND a.staff_id=$3 AND a.kind IN ('PASS','PRACTICE') ORDER BY a.id DESC LIMIT 1) assessment
    FROM bms_operation_standards st WHERE st.tenant_id=$1 AND st.location_id=$2 AND st.status='ACTIVE' AND ($4::text IS NULL OR st.duty_key=$4) ORDER BY st.duty_key,st.title,st.id LIMIT 501`,
      [s.tenantId, location, staff, duty ? dutyKey(duty) : null],
    )
  ).rows;
  if (rows.length > 500) reject("REPORT_TOO_LARGE");
  return {
    staffId: staff,
    locationId: location,
    standards: rows,
    configured: rows.length > 0,
    ready:
      rows.length > 0 &&
      rows.every(
        (x) =>
          x.acknowledged &&
          (!x.training_required || (x.trained && x.assessment === "PASS")),
      ),
  };
}
export async function executeStandard(
  c: PoolClient,
  s: ChecklistScope,
  i: any,
) {
  if (i.action === "PUBLISH_STANDARD") {
    const location = i.locationId;
    await teamBranches(c, s, location);
    if (!checklistUuid(location)) reject("INVALID_INPUT");
    const id = randomUUID(),
      family = i.familyId || id,
      key = dutyKey(i.dutyKey);
    if (!checklistUuid(family)) reject("INVALID_INPUT");
    for (const f of [
      "trainingRequired",
      "carryAcknowledgement",
      "carryTraining",
    ])
      if (typeof i[f] !== "boolean") reject("INVALID_INPUT");
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `${s.tenantId}:standard:${family}`,
    ]);
    const old = (
      await c.query(
        `SELECT * FROM bms_operation_standards WHERE tenant_id=$1 AND family_id=$2 ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        [s.tenantId, family],
      )
    ).rows[0];
    if ((old?.version ?? 0) !== i.version) reject("STALE_VERSION");
    if (old && (old.location_id !== location || old.duty_key !== key))
      reject("STANDARD_SCOPE_CHANGED");
    let source: any;
    if (!checklistUuid(i.sourceId)) reject("INVALID_INPUT");
    if (i.sourceType === "CHECKLIST") {
      source = (
        await c.query(
          `SELECT id,family_id,version,name,items FROM bms_operation_templates WHERE tenant_id=$1 AND id=$2 AND location_id=$3 AND status<>'DRAFT'`,
          [s.tenantId, i.sourceId, location],
        )
      ).rows[0];
    } else if (i.sourceType === "RECIPE") {
      checklistPermission(s, "product.view");
      source = (
        await c.query(
          `SELECT id,product_sku,size,version,sop_steps FROM bms_product_recipes WHERE tenant_id=$1 AND id=$2`,
          [s.tenantId, i.sourceId],
        )
      ).rows[0];
    } else reject("INVALID_INPUT");
    if (!source) reject("NOT_FOUND");
    if (old)
      await c.query(
        `UPDATE bms_operation_standards SET status='RETIRED' WHERE tenant_id=$1 AND family_id=$2 AND status='ACTIVE'`,
        [s.tenantId, family],
      );
    await c.query(
      `INSERT INTO bms_operation_standards(id,tenant_id,location_id,family_id,version,duty_key,title,body,source,status,ack_basis_id,training_basis_id,training_required,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'ACTIVE',$10,$11,$12,$13)`,
      [
        id,
        s.tenantId,
        location,
        family,
        (old?.version ?? 0) + 1,
        key,
        checklistText(i.title, 160, true),
        checklistText(i.body, 10000, true),
        JSON.stringify({ type: i.sourceType, ...source }),
        old && i.carryAcknowledgement ? old.ack_basis_id : id,
        old && old.training_required && i.carryTraining
          ? old.training_basis_id
          : id,
        i.trainingRequired,
        s.actorId,
      ],
    );
    return {
      status: "OK",
      id,
      version: (old?.version ?? 0) + 1,
      locationId: location,
    };
  }
  if (!checklistUuid(i.id)) reject("INVALID_INPUT");
  const st = (
    await c.query(
      `SELECT * FROM bms_operation_standards WHERE tenant_id=$1 AND id=$2 FOR SHARE`,
      [s.tenantId, i.id],
    )
  ).rows[0];
  if (!st) reject("NOT_FOUND");
  await teamBranches(c, s, st.location_id);
  if (st.status !== "ACTIVE" || st.version !== i.version)
    reject("STALE_VERSION");
  const ack = i.action === "ACK_STANDARD",
    staff = ack ? s.actorId : i.staffId;
  if (
    !checklistUuid(staff) ||
    !(await checklistRecipient(
      c,
      s.tenantId,
      staff,
      st.location_id,
      "operations.checklist.view",
    ))
  )
    reject("INVALID_ASSIGNEE");
  if (!ack && staff === s.actorId) reject("SEPARATE_ASSESSOR_REQUIRED");
  const kind = ack
    ? "ACK"
    : i.action === "RECORD_TRAINING"
      ? "TRAINED"
      : i.outcome;
  if (
    !["ACK", "TRAINED", "PASS", "PRACTICE"].includes(kind) ||
    (!ack && kind === "ACK") ||
    (i.action === "ASSESS_STANDARD" && !["PASS", "PRACTICE"].includes(kind))
  )
    reject("INVALID_INPUT");
  if (!ack && !st.training_required) reject("TRAINING_NOT_REQUIRED");
  const evidence = checklistText(i.note, 2000, !ack);
  await c.query(
    `INSERT INTO bms_operation_learning(tenant_id,standard_id,basis_id,staff_id,kind,evidence,actor) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [
      s.tenantId,
      st.id,
      ack ? st.ack_basis_id : st.training_basis_id,
      staff,
      kind,
      evidence,
      s.actorId,
    ],
  );
  return {
    status: "OK",
    id: st.id,
    version: st.version,
    locationId: st.location_id,
  };
}
