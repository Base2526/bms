import { createHash } from "node:crypto";
import { query } from "@/lib/db";
import { operationSupervisor } from "./operationTeamDispatch";
import {
  checklistLocations,
  checklistPermission,
  checklistTx,
  lockChecklistRun,
  projectChecklistRow,
  type ChecklistScope,
} from "./operationChecklists";
import {
  ChecklistError,
  checklistText,
  checklistUuid,
  checklistReportDates,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import {
  checklistRecipient,
  checklistFollowupAudit,
  escalateChecklistInTx,
  syncChecklistFollowup,
  checklistNotice,
} from "./operationChecklistDispatch";

export { checklistReportDates } from "./operationChecklistPolicy";
function pageOffset(offset: number | undefined) {
  const n = offset ?? 0;
  if (!Number.isInteger(n) || n < 0 || n > 100000)
    return reject("INVALID_INPUT");
  return n;
}
async function selectedLocations(c: any, s: ChecklistScope, id?: string) {
  const locations = await checklistLocations(c, s);
  if (id && (!checklistUuid(id) || !locations.some((l) => l.id === id)))
    return reject("NOT_FOUND");
  return id ? [id] : locations.map((l) => l.id);
}
export async function checklistMyWork(
  s: ChecklistScope,
  filter: { locationId?: string; offset?: number; bucket?: string } = {},
) {
  checklistPermission(s, "operations.checklist.view");
  const offset = pageOffset(filter.offset),
    bucket = filter.bucket ?? "MINE";
  if (!["MINE", "UNASSIGNED", "REVIEW"].includes(bucket))
    return reject("INVALID_INPUT");
  checklistPermission(
    s,
    bucket === "REVIEW"
      ? "operations.checklist.review"
      : "operations.checklist.execute",
  );
  return checklistTx(s, async (c) => {
    const locations = await selectedLocations(c, s, filter.locationId);
    const work = `WITH work AS (
      SELECT r.id,r.id AS run_id,'RUN' AS kind,r.snapshot->>'name' AS name,r.location_id,r.status,r.assigned_to,r.due_at,r.version,
        (r.status='SUBMITTED' AND (NOT COALESCE((r.snapshot->>'separateReviewer')::boolean,true) OR NOT EXISTS(SELECT 1 FROM bms_operation_results x WHERE x.tenant_id=r.tenant_id AND x.run_id=r.id AND x.recorded_by=$3))) AS reviewable
      FROM bms_operation_runs r WHERE r.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND r.status NOT IN ('APPROVED','VOID')
      UNION ALL
      SELECT a.id,r.id,'ACTION',a.instruction,r.location_id,a.status,a.assigned_to,a.due_at,a.version,
        (a.status='RESOLVED' AND (NOT COALESCE((r.snapshot->>'separateReviewer')::boolean,true) OR a.resolved_by IS DISTINCT FROM $3))
      FROM bms_operation_actions a JOIN bms_operation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id
      WHERE a.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND a.status<>'VERIFIED' AND r.status NOT IN ('APPROVED','VOID')
    ), filtered AS (SELECT * FROM work WHERE
      ($4='MINE' AND assigned_to=$3 AND status NOT IN ('SUBMITTED','RESOLVED')) OR
      ($4='UNASSIGNED' AND assigned_to IS NULL AND status NOT IN ('SUBMITTED','RESOLVED')) OR ($4='REVIEW' AND reviewable))`;
    const args = [s.tenantId, locations, s.actorId, bucket];
    const rows = (
      await c.query(
        `${work} SELECT *,due_at<now() AS overdue FROM filtered ORDER BY due_at,id LIMIT 25 OFFSET $5`,
        [...args, offset],
      )
    ).rows;
    const counts = (
      await c.query(
        `${work} SELECT count(*)::int AS total,count(*) FILTER(WHERE due_at<now())::int AS overdue FROM filtered`,
        args,
      )
    ).rows[0];
    return { ...counts, items: rows.map(projectChecklistRow) };
  });
}
export async function checklistInbox(
  s: ChecklistScope,
  filter: { locationId?: string; offset?: number; unreadOnly?: boolean } = {},
) {
  checklistPermission(s, "operations.checklist.view");
  const offset = pageOffset(filter.offset);
  return checklistTx(s, async (c) => {
    const locations = await selectedLocations(c, s, filter.locationId),
      args = [s.tenantId, locations, s.actorId, filter.unreadOnly ?? false];
    const base = `FROM bms_operation_notices n JOIN bms_operation_runs r ON r.tenant_id=n.tenant_id AND r.id=n.run_id
      WHERE n.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND n.recipient=$3`;
    const counts = (
      await c.query(
        `SELECT count(*) FILTER(WHERE NOT $4 OR n.read_at IS NULL)::int total,count(*) FILTER(WHERE n.read_at IS NULL)::int unread ${base}`,
        args,
      )
    ).rows[0];
    const rows = (
      await c.query(
        `SELECT n.*,r.snapshot->>'name' name,r.status AS run_status ${base} AND (NOT $4 OR n.read_at IS NULL) ORDER BY n.created_at DESC,n.id LIMIT 25 OFFSET $5`,
        [...args, offset],
      )
    ).rows;
    return { ...counts, items: rows.map(projectChecklistRow) };
  });
}
export async function checklistSupervision(
  s: ChecklistScope,
  filter: { locationId?: string; offset?: number } = {},
) {
  checklistPermission(s, "operations.checklist.view");
  if (
    !s.permissions.has("operations.checklist.manage") &&
    !s.permissions.has("operations.checklist.review")
  )
    return reject("FORBIDDEN");
  const offset = pageOffset(filter.offset);
  return checklistTx(s, async (c) => {
    const locations = await selectedLocations(c, s, filter.locationId);
    const policies = (
      await c.query(
        `SELECT p.*,l.name FROM bms_operation_policies p JOIN bms_locations l ON l.tenant_id=p.tenant_id AND l.id=p.location_id WHERE p.tenant_id=$1 AND p.location_id=ANY($2::uuid[]) ORDER BY l.name LIMIT 200`,
        [s.tenantId, locations],
      )
    ).rows;
    const base = `FROM bms_operation_escalations e JOIN bms_operation_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id WHERE e.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND e.status<>'CLOSED'`;
    const escalations = (
      await c.query(
        `SELECT e.*,r.snapshot->>'name' name,r.location_id ${base} ORDER BY e.created_at,e.id LIMIT 25 OFFSET $3`,
        [s.tenantId, locations, offset],
      )
    ).rows;
    const total = (
      await c.query(`SELECT count(*)::int n ${base}`, [s.tenantId, locations])
    ).rows[0].n;
    const supervisors = (
      await c.query(
        `SELECT u.id,u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.tenant_id=$1 AND NOT COALESCE(u.pos_only,false)
      AND (r.name='Administrator' OR (EXISTS(SELECT 1 FROM bms_role_permissions p WHERE p.tenant_id=$1 AND p.role_id=u.role_id AND p.permission='operations.checklist.view') AND EXISTS(SELECT 1 FROM bms_role_permissions p WHERE p.tenant_id=$1 AND p.role_id=u.role_id AND p.permission='operations.checklist.review')))
      AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=u.id) OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=u.id AND a.location_id=ANY($2::uuid[]))) ORDER BY u.name,u.id LIMIT 200`,
        [s.tenantId, locations],
      )
    ).rows;
    return {
      policies: policies.map(projectChecklistRow),
      escalations: escalations.map(projectChecklistRow),
      supervisors,
      total,
    };
  });
}
export type FollowupCommand = {
  action:
    "SAVE_POLICY" | "ESCALATE" | "ACKNOWLEDGE" | "READ_NOTICE" | "REROUTE";
  idempotencyKey: string;
  id?: string;
  version?: number;
  locationId?: string;
  supervisorId?: string;
  reminderMinutes?: number;
  escalationMinutes?: number;
  enabled?: boolean;
  note?: string;
  confirmed?: boolean;
};
export async function commandChecklistFollowup(
  s: ChecklistScope,
  i: FollowupCommand,
): Promise<{ status: string; id?: string; version?: number }> {
  try {
    const permissions = {
      SAVE_POLICY: "manage",
      ESCALATE: "execute",
      ACKNOWLEDGE: "review",
      READ_NOTICE: "view",
      REROUTE: "manage",
    };
    if (!i || !Object.hasOwn(permissions, i.action))
      return reject("INVALID_INPUT");
    checklistPermission(s, `operations.checklist.${permissions[i.action]}`);
    const key = checklistText(i.idempotencyKey, 128, true),
      note = checklistText(i.note);
    if (key.length < 8) return reject("INVALID_INPUT");
    if (i.action !== "READ_NOTICE" && i.confirmed !== true)
      return reject("CONFIRMATION_REQUIRED");
    const fingerprint = createHash("sha256")
      .update(`followup:${JSON.stringify(i)}`)
      .digest("hex");
    return await checklistTx(s, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${s.tenantId}:${s.actorId}:operations:${key}`,
      ]);
      const previous = (
        await c.query(
          `SELECT fingerprint,result FROM bms_operation_commands WHERE tenant_id=$1 AND actor=$2 AND key=$3`,
          [s.tenantId, s.actorId, key],
        )
      ).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          return reject("IDEMPOTENCY_CONFLICT");
        return previous.result;
      }
      let result: { status: string; id?: string; version?: number } = {
        status: "OK",
      };
      if (i.action === "SAVE_POLICY") {
        if (
          !i.locationId ||
          !checklistUuid(i.supervisorId) ||
          typeof i.enabled !== "boolean" ||
          ![i.reminderMinutes, i.escalationMinutes].every(
            (n) => Number.isInteger(n) && n! >= 0 && n! <= 10080,
          )
        )
          return reject("INVALID_INPUT");
        await selectedLocations(c, s, i.locationId);
        if (
          !(await checklistRecipient(
            c,
            s.tenantId,
            i.supervisorId,
            i.locationId,
            "operations.checklist.review",
          ))
        )
          return reject("INVALID_ASSIGNEE");
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `${s.tenantId}:checklist-policy:${i.locationId}`,
        ]);
        const old = (
          await c.query(
            `SELECT * FROM bms_operation_policies WHERE tenant_id=$1 AND location_id=$2 FOR UPDATE`,
            [s.tenantId, i.locationId],
          )
        ).rows[0];
        if (i.version !== (old?.version ?? 0)) return reject("STALE_VERSION");
        const p = (
          await c.query(
            `INSERT INTO bms_operation_policies(tenant_id,location_id,supervisor_id,reminder_minutes,escalation_minutes,enabled,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,location_id) DO UPDATE SET supervisor_id=EXCLUDED.supervisor_id,reminder_minutes=EXCLUDED.reminder_minutes,escalation_minutes=EXCLUDED.escalation_minutes,enabled=EXCLUDED.enabled,version=bms_operation_policies.version+1,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING version`,
            [
              s.tenantId,
              i.locationId,
              i.supervisorId,
              i.reminderMinutes,
              i.escalationMinutes,
              i.enabled,
              s.actorId,
            ],
          )
        ).rows[0];
        await checklistFollowupAudit(
          c,
          s.tenantId,
          s.actorId,
          null,
          "SAVE_POLICY",
          JSON.stringify({
            before: old ?? null,
            after: {
              supervisor: i.supervisorId,
              reminder: i.reminderMinutes,
              escalation: i.escalationMinutes,
              enabled: i.enabled,
            },
          }),
          i.locationId,
        );
        result = { status: "OK", id: i.locationId, version: p.version };
      } else {
        if (!checklistUuid(i.id)) return reject("INVALID_INPUT");
        if (i.action === "READ_NOTICE") {
          const n = (
            await c.query(
              `SELECT * FROM bms_operation_notices WHERE tenant_id=$1 AND id=$2 AND recipient=$3`,
              [s.tenantId, i.id, s.actorId],
            )
          ).rows[0];
          if (!n) return reject("NOT_FOUND");
          await lockChecklistRun(c, s, n.run_id);
          await c.query(
            `UPDATE bms_operation_notices SET read_at=COALESCE(read_at,now()) WHERE tenant_id=$1 AND id=$2 AND recipient=$3`,
            [s.tenantId, i.id, s.actorId],
          );
          result = { status: "OK", id: i.id };
        } else if (i.action === "ESCALATE") {
          if (!note) return reject("REASON_REQUIRED");
          const r = await lockChecklistRun(c, s, i.id);
          if (i.version !== r.version) return reject("STALE_VERSION");
          if (["APPROVED", "VOID"].includes(r.status))
            return reject("INVALID_STATE");
          const ownAction = await c.query(
            `SELECT 1 FROM bms_operation_actions WHERE tenant_id=$1 AND run_id=$2 AND assigned_to=$3 AND status<>'VERIFIED' LIMIT 1`,
            [s.tenantId, r.id, s.actorId],
          );
          if (
            r.assigned_to &&
            r.assigned_to !== s.actorId &&
            !ownAction.rowCount &&
            !s.permissions.has("operations.checklist.manage")
          )
            return reject("NOT_ASSIGNED");
          const p = {
            supervisor_id: await operationSupervisor(
              c,
              s.tenantId,
              r.location_id,
              (await c.query("SELECT now() at")).rows[0].at.toISOString(),
            ),
          };
          if (
            !p ||
            !(await checklistRecipient(
              c,
              s.tenantId,
              p.supervisor_id,
              r.location_id,
              "operations.checklist.review",
            ))
          )
            return reject("SUPERVISOR_REQUIRED");
          const existing = (
            await c.query(
              `SELECT id FROM bms_operation_escalations WHERE tenant_id=$1 AND run_id=$2 AND status<>'CLOSED'`,
              [s.tenantId, r.id],
            )
          ).rows[0];
          if (existing) return reject("ALREADY_ESCALATED");
          const e = await escalateChecklistInTx(
            c,
            s.tenantId,
            r,
            p.supervisor_id,
            note,
            s.actorId,
            "MANUAL",
          );
          result = { status: "OK", id: e.id, version: e.version };
        } else {
          const target = (
            await c.query(
              `SELECT run_id FROM bms_operation_escalations WHERE tenant_id=$1 AND id=$2`,
              [s.tenantId, i.id],
            )
          ).rows[0];
          if (!target) return reject("NOT_FOUND");
          const r = await lockChecklistRun(c, s, target.run_id);
          const e = (
            await c.query(
              `SELECT * FROM bms_operation_escalations WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
              [s.tenantId, i.id],
            )
          ).rows[0];
          if (i.version !== e.version) return reject("STALE_VERSION");
          if (e.status === "CLOSED" || ["APPROVED", "VOID"].includes(r.status))
            return reject("INVALID_STATE");
          if (!note) return reject("REASON_REQUIRED");
          let auditNote = `${e.id}: ${note}`;
          if (i.action === "ACKNOWLEDGE") {
            if (e.recipient !== s.actorId) return reject("FORBIDDEN");
            if (e.status !== "OPEN") return reject("INVALID_STATE");
            await c.query(
              `UPDATE bms_operation_escalations SET status='ACKNOWLEDGED',version=version+1,acknowledged_at=now(),acknowledged_by=$3 WHERE tenant_id=$1 AND id=$2`,
              [s.tenantId, i.id, s.actorId],
            );
          } else {
            const p = {
              supervisor_id: await operationSupervisor(
                c,
                s.tenantId,
                r.location_id,
                (await c.query("SELECT now() at")).rows[0].at.toISOString(),
              ),
            };
            if (
              !p ||
              p.supervisor_id === e.recipient ||
              !(await checklistRecipient(
                c,
                s.tenantId,
                p.supervisor_id,
                r.location_id,
                "operations.checklist.review",
              ))
            )
              return reject("INVALID_ASSIGNEE");
            await c.query(
              `UPDATE bms_operation_escalations SET recipient=$3,status='OPEN',version=version+1,acknowledged_at=NULL,acknowledged_by=NULL WHERE tenant_id=$1 AND id=$2`,
              [s.tenantId, i.id, p.supervisor_id],
            );
            await checklistNotice(
              c,
              s.tenantId,
              r.id,
              p.supervisor_id,
              "ESCALATED",
              `${e.id}:${e.version + 1}`,
            );
            auditNote = `${e.id}: ${e.recipient} -> ${p.supervisor_id}: ${note}`;
          }
          await checklistFollowupAudit(
            c,
            s.tenantId,
            s.actorId,
            r.id,
            i.action,
            auditNote,
          );
          result = { status: "OK", id: e.id, version: e.version + 1 };
        }
      }
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

export async function runChecklistFollowups() {
  // Oldest sweep first avoids starvation between tenants; business rows are claimed in their tenant transaction.
  const tenants = (
    await query(
      `SELECT tenant_id,min(followup_at) AS oldest FROM bms_operation_runs WHERE status NOT IN ('APPROVED','VOID') GROUP BY tenant_id ORDER BY oldest,tenant_id LIMIT 100`,
    )
  ).rows;
  let processed = 0,
    failed = 0;
  for (const t of tenants) {
    try {
      processed += await checklistTx(
        { tenantId: t.tenant_id, actorId: "SYSTEM" },
        async (c) => {
          const rows = (
            await c.query(
              `SELECT id FROM bms_operation_runs WHERE tenant_id=$1 AND status NOT IN ('APPROVED','VOID') ORDER BY followup_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
              [t.tenant_id],
            )
          ).rows;
          for (const r of rows) {
            await syncChecklistFollowup(c, t.tenant_id, r.id);
            await c.query(
              `UPDATE bms_operation_runs SET followup_at=now() WHERE tenant_id=$1 AND id=$2`,
              [t.tenant_id, r.id],
            );
          }
          return rows.length;
        },
      );
    } catch {
      failed++;
    }
  }
  return { processed, failed, tenants: tenants.length };
}

export async function checklistInspectionReport(
  s: ChecklistScope,
  filter: { locationId?: string; from: string; to: string },
) {
  checklistPermission(s, "operations.checklist.review");
  const { from, to } = checklistReportDates(filter.from, filter.to);
  return checklistTx(
    s,
    async (c) => {
      const locations = await selectedLocations(c, s, filter.locationId),
        args = [s.tenantId, locations, from, to];
      const cohort = `WITH cohort AS (SELECT r.* FROM bms_operation_runs r WHERE r.tenant_id=$1 AND r.location_id=ANY($2::uuid[])
      AND r.due_at>=($3::date::timestamp AT TIME ZONE 'Asia/Bangkok') AND r.due_at<(($4::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok'))`;
      const branches = (
        await c.query(
          `${cohort} SELECT r.location_id,l.name,count(*)::int AS total,
      count(*) FILTER(WHERE r.status='VOID')::int AS voided,
      count(*) FILTER(WHERE r.status='APPROVED')::int AS approved,
      count(*) FILTER(WHERE r.status='APPROVED' AND r.reviewed_at<=r.due_at)::int AS on_time,
      count(*) FILTER(WHERE r.status NOT IN ('APPROVED','VOID') AND r.due_at<now())::int AS overdue,
      count(*) FILTER(WHERE r.status='SUBMITTED')::int AS review,
      count(*) FILTER(WHERE r.status<>'VOID' AND EXISTS(SELECT 1 FROM bms_operation_results x WHERE x.tenant_id=r.tenant_id AND x.run_id=r.id AND x.outcome='FAIL'))::int AS failed_runs,
      (SELECT count(*)::int FROM bms_operation_actions a JOIN cohort cr ON cr.tenant_id=a.tenant_id AND cr.id=a.run_id WHERE cr.location_id=r.location_id AND cr.status<>'VOID' AND a.status<>'VERIFIED') AS open_actions
      FROM cohort r JOIN bms_locations l ON l.tenant_id=r.tenant_id AND l.id=r.location_id GROUP BY r.location_id,l.name ORDER BY l.name,r.location_id`,
          args,
        )
      ).rows;
      const problems = (
        await c.query(
          `${cohort} SELECT r.location_id,l.name AS branch,t.family_id,x.item_key,min(r.snapshot->>'name') AS name,
      count(DISTINCT r.id)::int AS runs,max(r.due_at) AS last_due
      FROM cohort r JOIN bms_operation_results x ON x.tenant_id=r.tenant_id AND x.run_id=r.id
      JOIN bms_operation_templates t ON t.tenant_id=r.tenant_id AND t.id=r.template_id
      JOIN bms_locations l ON l.tenant_id=r.tenant_id AND l.id=r.location_id
      WHERE r.status<>'VOID' AND x.outcome='FAIL' GROUP BY r.location_id,l.name,t.family_id,x.item_key
      HAVING count(DISTINCT r.id)>=2 ORDER BY runs DESC,last_due DESC,t.family_id,x.item_key LIMIT 51`,
          args,
        )
      ).rows;
      return {
        from,
        to,
        timezone: "Asia/Bangkok",
        generatedAt: new Date().toISOString(),
        branches: branches.map(projectChecklistRow),
        problems: problems.slice(0, 50).map(projectChecklistRow),
        problemsTruncated: problems.length > 50,
      };
    },
    { serializable: true },
  );
}
