import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { syncChecklistFollowup } from "./operationChecklistDispatch";
import { resolveOperationDuty } from "./operationTeamDispatch";
import { dutyKey } from "./operationTeamPolicy";
import {
  ChecklistError,
  rejectChecklist as reject,
  checklistUuid,
  checklistText,
  checklistItems,
  evaluateChecklistResult,
  editableChecklist,
  CHECKLIST_COMMAND_PERMISSIONS,
  type ChecklistCommandAction,
  type ChecklistItem,
} from "./operationChecklistPolicy";

export type ChecklistScope = {
  tenantId: string;
  actorId: string;
  permissions: ReadonlySet<string>;
};
export type ChecklistCommand = {
  action: ChecklistCommandAction;
  idempotencyKey: string;
  id?: string;
  version?: number;
  confirmed?: boolean;
  templateId?: string;
  locationId?: string;
  stationId?: string | null;
  name?: string;
  category?: string;
  separateReviewer?: boolean;
  items?: ChecklistItem[];
  dueAt?: string;
  assignedTo?: string | null;
  itemKey?: string;
  value?: unknown;
  note?: string;
  photoIds?: number[];
  timezone?: string;
  localTime?: string;
  weekdays?: number[];
  dueMinutes?: number;
  assignmentMode?: "FIXED" | "DUTY";
  dutyKey?: string;
};
export function checklistPermission(s: ChecklistScope, permission: string) {
  if (
    !s.permissions.has("operations.checklist.view") ||
    !s.permissions.has(permission)
  )
    reject("FORBIDDEN");
}
export async function checklistTx<T>(
  s: Pick<ChecklistScope, "tenantId" | "actorId">,
  work: (c: PoolClient) => Promise<T>,
  options: { serializable?: boolean } = {},
) {
  const c = await getClient();
  try {
    await beginTenantTx(c, s.tenantId, { editorId: s.actorId, ...options });
    const result = await work(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
// All reads, including dropdowns, use the same branch scope as the mutation.
export async function checklistLocations(
  c: PoolClient,
  s: Pick<ChecklistScope, "tenantId" | "actorId">,
) {
  return (
    await c.query(
      `SELECT l.id,l.name,l.active FROM bms_locations l WHERE l.tenant_id=$1 AND
    (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2)
     OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2 AND a.location_id=l.id)) ORDER BY l.code`,
      [s.tenantId, s.actorId],
    )
  ).rows;
}
async function branch(
  c: PoolClient,
  s: ChecklistScope,
  id: string,
  active = false,
) {
  const row = (await checklistLocations(c, s)).find((r) => r.id === id);
  if (!row || (active && !row.active)) reject("NOT_FOUND");
}
async function assignee(
  c: PoolClient,
  s: ChecklistScope,
  id: unknown,
  location: string,
) {
  if (id == null || id === "") return null;
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  const row = await c.query(
    `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.tenant_id=$1 AND u.id=$2 AND COALESCE(u.pos_only,false)=false
    AND (r.name='Administrator' OR (EXISTS(SELECT 1 FROM bms_role_permissions p WHERE p.tenant_id=$1 AND p.role_id=u.role_id AND p.permission='operations.checklist.execute')
      AND EXISTS(SELECT 1 FROM bms_role_permissions p WHERE p.tenant_id=$1 AND p.role_id=u.role_id AND p.permission='operations.checklist.view')))
    AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=u.id)
      OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=u.id AND a.location_id=$3))`,
    [s.tenantId, id, location],
  );
  if (!row.rowCount) return reject("INVALID_ASSIGNEE");
  return id;
}
function date(v: unknown) {
  if (
    typeof v !== "string" ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    return reject("INVALID_INPUT");
  return new Date(v).toISOString();
}
function current(row: any, input: ChecklistCommand) {
  if (!Number.isInteger(input.version) || input.version !== row.version)
    reject("STALE_VERSION");
}
function executor(s: ChecklistScope, row: any) {
  if (row.assigned_to && row.assigned_to !== s.actorId) reject("NOT_ASSIGNED");
}
function confirm(input: ChecklistCommand) {
  if (input.confirmed !== true) reject("CONFIRMATION_REQUIRED");
}
async function audit(
  c: PoolClient,
  s: Pick<ChecklistScope, "tenantId" | "actorId">,
  action: string,
  id: string,
  note = "",
  template = false,
) {
  await c.query(
    `INSERT INTO bms_operation_events(tenant_id,run_id,template_id,action,actor,note) VALUES($1,$2,$3,$4,$5,$6)`,
    [
      s.tenantId,
      template ? null : id,
      template ? id : null,
      action,
      s.actorId,
      note,
    ],
  );
  await c.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [
      s.tenantId,
      s.actorId,
      `operations.${action.toLowerCase()}`,
      id,
      JSON.stringify({ reason: note }),
    ],
  );
  if (!template) await syncChecklistFollowup(c, s.tenantId, id);
}
export async function lockChecklistRun(
  c: PoolClient,
  s: ChecklistScope,
  id: unknown,
) {
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  const row = (
    await c.query(
      `SELECT * FROM bms_operation_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [s.tenantId, id],
    )
  ).rows[0];
  if (!row) return reject("NOT_FOUND");
  await branch(c, s, row.location_id);
  return row;
}
async function template(c: PoolClient, s: ChecklistScope, id: unknown) {
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  const identity = (
    await c.query(
      `SELECT family_id,location_id FROM bms_operation_templates WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, id],
    )
  ).rows[0];
  if (!identity) return reject("NOT_FOUND");
  await branch(c, s, identity.location_id);
  // Family lock comes before row locks: concurrent publication cannot deadlock while retiring a sibling.
  await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `${s.tenantId}:checklist-template:${identity.family_id}`,
  ]);
  const row = (
    await c.query(
      `SELECT * FROM bms_operation_templates WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [s.tenantId, id],
    )
  ).rows[0];
  if (!row) return reject("NOT_FOUND");
  await branch(c, s, row.location_id);
  return row;
}
export async function latestChecklistResults(
  c: PoolClient,
  tenant: string,
  id: string,
) {
  return (
    await c.query(
      `SELECT DISTINCT ON(item_key) * FROM bms_operation_results WHERE tenant_id=$1 AND run_id=$2 ORDER BY item_key,revision DESC`,
      [tenant, id],
    )
  ).rows;
}
async function createRun(
  c: PoolClient,
  tenant: string,
  actor: string,
  t: any,
  due: string,
  assigned: string | null,
  assignmentEvidence: unknown = {},
) {
  const snapshot = {
    name: t.name,
    category: t.category,
    version: t.version,
    separateReviewer: t.separate_reviewer,
    items: t.items,
  };
  return (
    await c.query(
      `INSERT INTO bms_operation_runs(tenant_id,template_id,location_id,station_id,snapshot,due_at,assigned_to,created_by,assignment_evidence)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb) RETURNING *`,
      [
        tenant,
        t.id,
        t.location_id,
        t.station_id,
        JSON.stringify(snapshot),
        due,
        assigned,
        actor,
        JSON.stringify(assignmentEvidence),
      ],
    )
  ).rows[0];
}

export async function commandChecklist(
  s: ChecklistScope,
  input: ChecklistCommand,
): Promise<{ status: string; id?: string; version?: number }> {
  try {
    if (!input || !Object.hasOwn(CHECKLIST_COMMAND_PERMISSIONS, input.action))
      return reject("INVALID_INPUT");
    checklistPermission(s, CHECKLIST_COMMAND_PERMISSIONS[input.action]);
    const key = checklistText(input.idempotencyKey, 128, true);
    if (key.length < 8) return reject("INVALID_INPUT");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    return await checklistTx(s, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${s.tenantId}:${s.actorId}:operations:${key}`,
      ]);
      const old = (
        await c.query(
          `SELECT * FROM bms_operation_commands WHERE tenant_id=$1 AND actor=$2 AND key=$3`,
          [s.tenantId, s.actorId, key],
        )
      ).rows[0];
      if (old) {
        if (old.fingerprint !== fingerprint) reject("IDEMPOTENCY_CONFLICT");
        return old.result;
      }
      const result = await executeChecklistInTx(c, s, input);
      await c.query(
        `INSERT INTO bms_operation_commands(tenant_id,actor,key,fingerprint,result) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [s.tenantId, s.actorId, key, fingerprint, JSON.stringify(result)],
      );
      return result;
    });
  } catch (e) {
    if (e instanceof ChecklistError) return { status: e.status };
    throw e;
  }
}
export async function executeChecklistInTx(
  c: PoolClient,
  s: ChecklistScope,
  i: ChecklistCommand,
  options: { assignmentAt?: string } = {},
): Promise<{ status: string; id: string; version: number }> {
  if (!Object.hasOwn(CHECKLIST_COMMAND_PERMISSIONS, i.action))
    return reject("INVALID_INPUT");
  checklistPermission(s, CHECKLIST_COMMAND_PERMISSIONS[i.action]);
  const note = checklistText(i.note),
    ok = (id: string, version: number) => ({ status: "OK", id, version });
  if (i.action === "SAVE_TEMPLATE") {
    if (!checklistUuid(i.locationId)) return reject("INVALID_INPUT");
    await branch(c, s, i.locationId, true);
    const name = checklistText(i.name, 200, true),
      category = checklistText(i.category, 60, true),
      items = checklistItems(i.items);
    if (typeof i.separateReviewer !== "boolean") return reject("INVALID_INPUT");
    if (i.stationId) {
      if (!checklistUuid(i.stationId)) return reject("INVALID_INPUT");
      const station = await c.query(
        `SELECT id FROM bms_kitchen_stations WHERE tenant_id=$1 AND id=$2 AND active AND (location_id IS NULL OR location_id=$3)`,
        [s.tenantId, i.stationId, i.locationId],
      );
      if (!station.rowCount) return reject("NOT_FOUND");
    }
    const previous = i.id ? await template(c, s, i.id) : null;
    if (previous && previous.location_id !== i.locationId)
      return reject("INVALID_INPUT");
    const family = previous?.family_id ?? randomUUID();
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `${s.tenantId}:checklist-template:${family}`,
    ]);
    const version = Number(
      (
        await c.query(
          `SELECT COALESCE(MAX(version),0)+1 AS n FROM bms_operation_templates WHERE tenant_id=$1 AND family_id=$2`,
          [s.tenantId, family],
        )
      ).rows[0].n,
    );
    const row = (
      await c.query(
        `INSERT INTO bms_operation_templates(tenant_id,family_id,version,location_id,station_id,name,category,separate_reviewer,items,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING id`,
        [
          s.tenantId,
          family,
          version,
          i.locationId,
          i.stationId ?? null,
          name,
          category,
          i.separateReviewer,
          JSON.stringify(items),
          s.actorId,
        ],
      )
    ).rows[0];
    await audit(c, s, i.action, row.id, "", true);
    return ok(row.id, version);
  }
  if (["PUBLISH", "RETIRE", "CREATE_RUN", "SAVE_SCHEDULE"].includes(i.action)) {
    confirm(i);
    const t = await template(c, s, i.templateId ?? i.id);
    await branch(c, s, t.location_id, true);
    if (i.action === "PUBLISH" || i.action === "RETIRE") {
      current(t, i);
      if (
        (i.action === "PUBLISH" && t.status !== "DRAFT") ||
        (i.action === "RETIRE" && t.status === "RETIRED")
      )
        return reject("INVALID_STATE");
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${s.tenantId}:checklist-template:${t.family_id}`,
      ]);
      if (
        i.action === "PUBLISH" &&
        (
          await c.query(
            `SELECT 1 FROM bms_operation_templates WHERE tenant_id=$1 AND family_id=$2 AND version>$3 AND status IN ('ACTIVE','RETIRED') LIMIT 1`,
            [s.tenantId, t.family_id, t.version],
          )
        ).rowCount
      )
        return reject("STALE_VERSION");
      await c.query(
        `UPDATE bms_operation_schedules SET active=false,version=version+1 WHERE tenant_id=$1 AND template_id IN
        (SELECT id FROM bms_operation_templates WHERE tenant_id=$1 AND family_id=$2 AND ($3='PUBLISH' OR id=$4)) AND active`,
        [s.tenantId, t.family_id, i.action, t.id],
      );
      if (i.action === "PUBLISH")
        await c.query(
          `UPDATE bms_operation_templates SET status='RETIRED' WHERE tenant_id=$1 AND family_id=$2 AND status='ACTIVE'`,
          [s.tenantId, t.family_id],
        );
      await c.query(
        `UPDATE bms_operation_templates SET status=$3 WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, t.id, i.action === "PUBLISH" ? "ACTIVE" : "RETIRED"],
      );
      await audit(c, s, i.action, t.id, note, true);
      return ok(t.id, t.version);
    }
    if (t.status !== "ACTIVE") return reject("INVALID_STATE");
    const mode = i.assignmentMode ?? "FIXED";
    if (!["FIXED", "DUTY"].includes(mode) || (mode === "DUTY" && i.assignedTo))
      return reject("INVALID_INPUT");
    const key = mode === "DUTY" ? dutyKey(i.dutyKey) : null;
    const assigned =
      mode === "FIXED"
        ? await assignee(c, s, i.assignedTo, t.location_id)
        : null;
    if (i.action === "SAVE_SCHEDULE") {
      const tz = checklistText(i.timezone, 80, true),
        time = checklistText(i.localTime, 5, true);
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
      } catch {
        return reject("INVALID_INPUT");
      }
      if (
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
        !Array.isArray(i.weekdays) ||
        !i.weekdays.length ||
        i.weekdays.length > 7 ||
        new Set(i.weekdays).size !== i.weekdays.length ||
        i.weekdays.some((n) => !Number.isInteger(n) || n < 0 || n > 6) ||
        !Number.isInteger(i.dueMinutes) ||
        i.dueMinutes! < 1 ||
        i.dueMinutes! > 10080
      )
        return reject("INVALID_INPUT");
      const next = await nextOccurrence(
        c,
        tz,
        time,
        i.weekdays,
        new Date().toISOString(),
      );
      const row = (
        await c.query(
          `INSERT INTO bms_operation_schedules(tenant_id,template_id,assigned_to,timezone,local_time,weekdays,due_minutes,next_at,created_by,assignment_mode,duty_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            s.tenantId,
            t.id,
            assigned,
            tz,
            time,
            i.weekdays,
            i.dueMinutes,
            next,
            s.actorId,
            mode,
            key,
          ],
        )
      ).rows[0];
      await audit(c, s, i.action, t.id, `${row.id}`, true);
      return ok(row.id, 1);
    }
    const resolved = key
      ? await resolveOperationDuty(
          c,
          s.tenantId,
          t.location_id,
          key,
          options.assignmentAt ? date(options.assignmentAt) : new Date().toISOString(),
        )
      : null;
    const row = await createRun(
      c,
      s.tenantId,
      s.actorId,
      t,
      date(i.dueAt),
      resolved ? resolved.assignedTo : assigned,
      resolved?.evidence ?? {},
    );
    await audit(c, s, i.action, row.id);
    return ok(row.id, 1);
  }
  if (i.action === "PAUSE_SCHEDULE") {
    confirm(i);
    if (!checklistUuid(i.id)) return reject("INVALID_INPUT");
    const identity = (
      await c.query(
        `SELECT template_id FROM bms_operation_schedules WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, i.id],
      )
    ).rows[0];
    if (!identity) return reject("NOT_FOUND");
    const t = await template(c, s, identity.template_id);
    const schedule = (
      await c.query(
        `SELECT * FROM bms_operation_schedules WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [s.tenantId, i.id],
      )
    ).rows[0];
    if (!schedule) return reject("NOT_FOUND");
    current(schedule, i);
    await c.query(
      `UPDATE bms_operation_schedules SET active=false,version=version+1 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, i.id],
    );
    await audit(c, s, i.action, t.id, i.id!, true);
    return ok(i.id!, schedule.version + 1);
  }
  const actionCommand = i.action.startsWith("ACTION_");
  let a: any;
  if (actionCommand) {
    if (!checklistUuid(i.id)) return reject("INVALID_INPUT");
    // Lock parent first everywhere (result, review, corrective action) to avoid lock inversions.
    a = (
      await c.query(
        `SELECT * FROM bms_operation_actions WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, i.id],
      )
    ).rows[0];
    if (!a) return reject("NOT_FOUND");
  }
  const r = await lockChecklistRun(c, s, actionCommand ? a.run_id : i.id);
  if (actionCommand) {
    a = (
      await c.query(
        `SELECT * FROM bms_operation_actions WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [s.tenantId, i.id],
      )
    ).rows[0];
    current(a, i);
    if (r.status === "APPROVED" || r.status === "VOID")
      return reject("INVALID_STATE");
    let status = a.status,
      assigned = a.assigned_to,
      due = a.due_at,
      resolution = a.resolution,
      resolvedBy = a.resolved_by,
      verifiedBy = a.verified_by;
    if (i.action === "ACTION_ASSIGN") {
      confirm(i);
      assigned = await assignee(c, s, i.assignedTo, r.location_id);
      due = date(i.dueAt);
    }
    if (i.action === "ACTION_START") {
      executor(s, a);
      if (a.status !== "OPEN") return reject("INVALID_STATE");
      status = "IN_PROGRESS";
    }
    if (i.action === "ACTION_RESOLVE") {
      executor(s, a);
      confirm(i);
      if (!["OPEN", "IN_PROGRESS"].includes(a.status))
        return reject("INVALID_STATE");
      if (!note) return reject("REASON_REQUIRED");
      status = "RESOLVED";
      resolution = note;
      resolvedBy = s.actorId;
    }
    if (i.action === "ACTION_VERIFY") {
      confirm(i);
      if (a.status !== "RESOLVED") return reject("INVALID_STATE");
      if (r.snapshot.separateReviewer && resolvedBy === s.actorId)
        return reject("DISTINCT_REVIEWER_REQUIRED");
      status = "VERIFIED";
      verifiedBy = s.actorId;
    }
    if (i.action === "ACTION_REOPEN") {
      confirm(i);
      if (!["RESOLVED", "VERIFIED"].includes(a.status))
        return reject("INVALID_STATE");
      if (!note) return reject("REASON_REQUIRED");
      status = "OPEN";
      resolution = null;
      resolvedBy = null;
      verifiedBy = null;
    }
    await c.query(
      `UPDATE bms_operation_actions SET status=$3,assigned_to=$4,due_at=$5,resolution=$6,resolved_by=$7,verified_by=$8,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [
        s.tenantId,
        a.id,
        status,
        assigned,
        due,
        resolution,
        resolvedBy,
        verifiedBy,
      ],
    );
    await audit(c, s, i.action, r.id, `${a.item_key}: ${note}`);
    return ok(a.id, a.version + 1);
  }
  current(r, i);
  if (["START", "RECORD", "SUBMIT"].includes(i.action)) {
    editableChecklist(r.status);
    executor(s, r);
  }
  let status = r.status;
  if (i.action === "START") status = "IN_PROGRESS";
  else if (i.action === "ASSIGN") {
    confirm(i);
    editableChecklist(r.status);
    const assigned = await assignee(c, s, i.assignedTo, r.location_id);
    await c.query(
      `UPDATE bms_operation_runs SET assigned_to=$3,due_at=$4 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, r.id, assigned, date(i.dueAt)],
    );
  } else if (i.action === "RECORD") {
    const item: ChecklistItem | undefined = r.snapshot.items.find(
      (x: ChecklistItem) => x.key === i.itemKey,
    );
    if (!item) return reject("INVALID_INPUT");
    const photos = i.photoIds ?? [];
    if (
      !Array.isArray(photos) ||
      photos.length > 5 ||
      new Set(photos).size !== photos.length ||
      photos.some((n) => !Number.isSafeInteger(n) || n < 1)
    )
      return reject("INVALID_INPUT");
    if (photos.length) {
      const found = await c.query(
        `SELECT file_id FROM bms_operation_evidence WHERE tenant_id=$1 AND run_id=$2 AND item_key=$3 AND file_id=ANY($4::int[])`,
        [s.tenantId, r.id, item.key, photos],
      );
      if (found.rowCount !== photos.length) return reject("EVIDENCE_REQUIRED");
    }
    const outcome = evaluateChecklistResult(item, i.value, note, photos);
    const revision = Number(
      (
        await c.query(
          `SELECT COALESCE(MAX(revision),0)+1 n FROM bms_operation_results WHERE tenant_id=$1 AND run_id=$2 AND item_key=$3`,
          [s.tenantId, r.id, item.key],
        )
      ).rows[0].n,
    );
    await c.query(
      `INSERT INTO bms_operation_results(tenant_id,run_id,item_key,revision,value,outcome,note,photo_ids,recorded_by)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9)`,
      [
        s.tenantId,
        r.id,
        item.key,
        revision,
        JSON.stringify(i.value),
        outcome,
        note,
        JSON.stringify(photos),
        s.actorId,
      ],
    );
    if (outcome === "FAIL") {
      await c.query(
        `INSERT INTO bms_operation_actions(tenant_id,run_id,item_key,assigned_to,due_at,instruction)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,run_id,item_key) DO UPDATE SET
        status='OPEN',resolution=NULL,resolved_by=NULL,verified_by=NULL,version=bms_operation_actions.version+1,updated_at=now()`,
        [
          s.tenantId,
          r.id,
          item.key,
          r.assigned_to,
          r.due_at,
          item.instruction || item.label,
        ],
      );
    }
    status = "IN_PROGRESS";
  } else if (i.action === "SUBMIT") {
    confirm(i);
    const results = await latestChecklistResults(c, s.tenantId, r.id);
    if (
      r.snapshot.items.some(
        (x: ChecklistItem) =>
          x.required && !results.some((y) => y.item_key === x.key),
      )
    )
      return reject("INCOMPLETE");
    status = "SUBMITTED";
  } else if (i.action === "APPROVE" || i.action === "REJECT") {
    confirm(i);
    if (r.status !== "SUBMITTED") return reject("INVALID_STATE");
    if (r.snapshot.separateReviewer) {
      const own = await c.query(
        `SELECT 1 FROM bms_operation_results WHERE tenant_id=$1 AND run_id=$2 AND recorded_by=$3 LIMIT 1`,
        [s.tenantId, r.id, s.actorId],
      );
      if (own.rowCount) return reject("DISTINCT_REVIEWER_REQUIRED");
    }
    if (i.action === "APPROVE") {
      const open = await c.query(
        `SELECT 1 FROM bms_operation_actions WHERE tenant_id=$1 AND run_id=$2 AND status<>'VERIFIED' LIMIT 1`,
        [s.tenantId, r.id],
      );
      if (open.rowCount) return reject("CORRECTIVE_ACTION_OPEN");
    } else if (!note) return reject("REASON_REQUIRED");
    status = i.action === "APPROVE" ? "APPROVED" : "REJECTED";
  } else if (i.action === "VOID") {
    confirm(i);
    if (["APPROVED", "VOID"].includes(r.status)) return reject("INVALID_STATE");
    if (!note) return reject("REASON_REQUIRED");
    status = "VOID";
  } else return reject("INVALID_INPUT");
  await c.query(
    `UPDATE bms_operation_runs SET status=$3,version=version+1,
    started_at=CASE WHEN $3='IN_PROGRESS' THEN COALESCE(started_at,now()) ELSE started_at END,
    submitted_at=CASE WHEN $3='SUBMITTED' THEN now() ELSE submitted_at END,
    reviewed_at=CASE WHEN $3 IN ('APPROVED','REJECTED','VOID') THEN now() ELSE reviewed_at END,
    reviewed_by=CASE WHEN $3 IN ('APPROVED','REJECTED','VOID') THEN $4 ELSE reviewed_by END WHERE tenant_id=$1 AND id=$2`,
    [s.tenantId, r.id, status, s.actorId],
  );
  await audit(
    c,
    s,
    i.action,
    r.id,
    i.action === "RECORD" ? `${i.itemKey}: ${note}` : note,
  );
  return ok(r.id, r.version + 1);
}

/** SQL uses one clock and timezone conversion, including overnight/DST dates. */
async function nextOccurrence(
  c: PoolClient,
  tz: string,
  time: string,
  days: number[],
  after: string,
) {
  const row = (
    await c.query(
      `SELECT ((($4::timestamptz AT TIME ZONE $1)::date + n)+$2::time) AT TIME ZONE $1 AS at
    FROM generate_series(0,8) n WHERE EXTRACT(DOW FROM (($4::timestamptz AT TIME ZONE $1)::date+n))::int=ANY($3::int[])
    AND (((($4::timestamptz AT TIME ZONE $1)::date+n)+$2::time) AT TIME ZONE $1)>$4::timestamptz ORDER BY at LIMIT 1`,
      [tz, time, days, after],
    )
  ).rows[0];
  if (!row) return reject("INVALID_INPUT");
  return row.at;
}
/** Bounded per-tenant catch-up. SKIP LOCKED and occurrence PK make concurrent schedulers safe. */
export async function runChecklistSchedules() {
  const tenants = (
    await query(
      `SELECT DISTINCT tenant_id FROM bms_operation_schedules WHERE active AND next_at<=now() ORDER BY tenant_id LIMIT 100`,
    )
  ).rows;
  let created = 0,
    failed = 0;
  for (const tenant of tenants) {
    try {
      created += await checklistTx(
        { tenantId: tenant.tenant_id, actorId: "SYSTEM" },
        async (c) => {
          const rows = (
            await c.query(
              `SELECT s.* FROM bms_operation_schedules s WHERE s.tenant_id=$1 AND s.active AND s.next_at<=now()
          ORDER BY s.next_at LIMIT 20 FOR UPDATE SKIP LOCKED`,
              [tenant.tenant_id],
            )
          ).rows;
          let count = 0;
          for (const schedule of rows) {
            const t = (
              await c.query(
                `SELECT t.* FROM bms_operation_templates t JOIN bms_locations l ON l.tenant_id=t.tenant_id AND l.id=t.location_id
            WHERE t.tenant_id=$1 AND t.id=$2 AND t.status='ACTIVE' AND l.active`,
                [tenant.tenant_id, schedule.template_id],
              )
            ).rows[0];
            if (!t) {
              await c.query(
                `UPDATE bms_operation_schedules SET active=false,version=version+1 WHERE tenant_id=$1 AND id=$2`,
                [tenant.tenant_id, schedule.id],
              );
              continue;
            }
            const occurrence = await c.query(
              `SELECT 1 FROM bms_operation_occurrences WHERE tenant_id=$1 AND schedule_id=$2 AND scheduled_at=$3`,
              [tenant.tenant_id, schedule.id, schedule.next_at],
            );
            if (!occurrence.rowCount) {
              const due = new Date(
                new Date(schedule.next_at).getTime() +
                  schedule.due_minutes * 60000,
              ).toISOString();
              const resolved =
                schedule.assignment_mode === "DUTY"
                  ? await resolveOperationDuty(
                      c,
                      tenant.tenant_id,
                      t.location_id,
                      schedule.duty_key,
                      new Date(schedule.next_at).toISOString(),
                    )
                  : null;
              const r = await createRun(
                c,
                tenant.tenant_id,
                "SYSTEM",
                t,
                due,
                resolved ? resolved.assignedTo : schedule.assigned_to,
                resolved?.evidence ?? {},
              );
              await c.query(
                `INSERT INTO bms_operation_occurrences(tenant_id,schedule_id,scheduled_at,run_id) VALUES($1,$2,$3,$4)`,
                [tenant.tenant_id, schedule.id, schedule.next_at, r.id],
              );
              await audit(
                c,
                { tenantId: tenant.tenant_id, actorId: "SYSTEM" },
                "SCHEDULED",
                r.id,
              );
              count++;
            }
            const next = await nextOccurrence(
              c,
              schedule.timezone,
              schedule.local_time,
              schedule.weekdays,
              new Date(schedule.next_at).toISOString(),
            );
            await c.query(
              `UPDATE bms_operation_schedules SET next_at=$3,version=version+1 WHERE tenant_id=$1 AND id=$2`,
              [tenant.tenant_id, schedule.id, next],
            );
          }
          return count;
        },
      );
    } catch {
      failed++;
    }
  }
  return { created, failed, tenants: tenants.length };
}

const iso = (v: any) => (v instanceof Date ? v.toISOString() : v);
export const projectChecklistRow = (row: any): any =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, x) => x.toUpperCase()),
      iso(v),
    ]),
  );
export async function checklistWorkspace(
  s: ChecklistScope,
  filter: {
    locationId?: string;
    search?: string;
    status?: string;
    offset?: number;
  } = {},
) {
  checklistPermission(s, "operations.checklist.view");
  if (filter.locationId && !checklistUuid(filter.locationId))
    return reject("INVALID_INPUT");
  const search = checklistText(filter.search, 100),
    status = checklistText(filter.status, 30);
  const offset = filter.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    return reject("INVALID_INPUT");
  return checklistTx(s, async (c) => {
    const locations = await checklistLocations(c, s),
      ids = locations.map((r) => r.id);
    if (filter.locationId && !ids.includes(filter.locationId))
      return reject("NOT_FOUND");
    const selected = filter.locationId ? [filter.locationId] : ids;
    const args = [
      s.tenantId,
      selected,
      `%${search.replace(/[\\%_]/g, "\\$&")}%`,
      status,
      offset,
    ];
    const predicate = `tenant_id=$1 AND location_id=ANY($2::uuid[]) AND snapshot->>'name' ILIKE $3 AND ($4='' OR status=$4)`;
    const runs = (
      await c.query(
        `SELECT * FROM bms_operation_runs WHERE ${predicate} ORDER BY due_at DESC,id LIMIT 25 OFFSET $5`,
        args,
      )
    ).rows;
    const total = (
      await c.query(
        `SELECT count(*)::int n FROM bms_operation_runs WHERE ${predicate}`,
        args.slice(0, 4),
      )
    ).rows[0].n;
    const templates = (
      await c.query(
        `SELECT * FROM bms_operation_templates WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) ORDER BY created_at DESC,id LIMIT 100`,
        [s.tenantId, selected],
      )
    ).rows;
    const schedules = (
      await c.query(
        `SELECT s.*,t.name FROM bms_operation_schedules s JOIN bms_operation_templates t ON t.tenant_id=s.tenant_id AND t.id=s.template_id
      WHERE s.tenant_id=$1 AND t.location_id=ANY($2::uuid[]) ORDER BY s.active DESC,s.next_at LIMIT 100`,
        [s.tenantId, selected],
      )
    ).rows;
    const metrics = (
      await c.query(
        `SELECT count(*) FILTER(WHERE status NOT IN ('APPROVED','VOID'))::int AS open,
      count(*) FILTER(WHERE status NOT IN ('APPROVED','VOID') AND due_at<now())::int AS overdue,
      count(*) FILTER(WHERE status='SUBMITTED')::int AS review FROM bms_operation_runs WHERE tenant_id=$1 AND location_id=ANY($2::uuid[])`,
        [s.tenantId, selected],
      )
    ).rows[0];
    const actions = (
      await c.query(
        `SELECT a.*,r.snapshot->>'name' AS name,r.location_id FROM bms_operation_actions a JOIN bms_operation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id
      WHERE a.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND a.status<>'VERIFIED' AND r.status<>'VOID' ORDER BY a.due_at LIMIT 100`,
        [s.tenantId, selected],
      )
    ).rows;
    const actionTotal = (
      await c.query(
        `SELECT count(*)::int n FROM bms_operation_actions a JOIN bms_operation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id
      WHERE a.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND a.status<>'VERIFIED' AND r.status<>'VOID'`,
        [s.tenantId, selected],
      )
    ).rows[0].n;
    const stations = (
      await c.query(
        `SELECT id,name,location_id FROM bms_kitchen_stations WHERE tenant_id=$1 AND active AND (location_id IS NULL OR location_id=ANY($2::uuid[])) ORDER BY name LIMIT 200`,
        [s.tenantId, selected],
      )
    ).rows;
    const staff = (
      await c.query(
        `SELECT u.id,u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.tenant_id=$1 AND COALESCE(u.pos_only,false)=false
      AND (r.name='Administrator' OR EXISTS(SELECT 1 FROM bms_role_permissions p WHERE p.tenant_id=$1 AND p.role_id=u.role_id AND p.permission='operations.checklist.execute'))
      AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=u.id)
        OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=u.id AND a.location_id=ANY($2::uuid[]))) ORDER BY u.name LIMIT 200`,
        [s.tenantId, selected],
      )
    ).rows;
    return {
      locations,
      staff,
      stations: stations.map(projectChecklistRow),
      templates: templates.map(projectChecklistRow),
      runs: runs.map(projectChecklistRow),
      schedules: schedules.map(projectChecklistRow),
      actions: actions.map(projectChecklistRow),
      total,
      metrics: { ...metrics, actions: actionTotal },
      actorId: s.actorId,
    };
  });
}
export async function checklistDetail(s: ChecklistScope, id: string) {
  checklistPermission(s, "operations.checklist.view");
  return checklistTx(s, async (c) => {
    const r = await lockChecklistRun(c, s, id);
    const results = await latestChecklistResults(c, s.tenantId, id);
    const history = (
      await c.query(
        `SELECT * FROM bms_operation_results WHERE tenant_id=$1 AND run_id=$2 ORDER BY recorded_at DESC,id LIMIT 500`,
        [s.tenantId, id],
      )
    ).rows;
    const events = (
      await c.query(
        `SELECT * FROM bms_operation_events WHERE tenant_id=$1 AND run_id=$2 ORDER BY id DESC LIMIT 200`,
        [s.tenantId, id],
      )
    ).rows;
    const actions = (
      await c.query(
        `SELECT * FROM bms_operation_actions WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at`,
        [s.tenantId, id],
      )
    ).rows;
    const evidence = (
      await c.query(
        `SELECT file_id,item_key FROM bms_operation_evidence WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at LIMIT 250`,
        [s.tenantId, id],
      )
    ).rows;
    return {
      ...projectChecklistRow(r),
      results: results.map(projectChecklistRow),
      history: history.map(projectChecklistRow),
      events: events.map(projectChecklistRow),
      actions: actions.map(projectChecklistRow),
      evidence: evidence.map(projectChecklistRow),
    };
  });
}
