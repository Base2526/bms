import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  checklistLocations,
  checklistPermission,
  checklistTx,
  projectChecklistRow,
  type ChecklistScope,
} from "./operationChecklists";
import {
  checklistReportDates,
  checklistUuid,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export const teamHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export async function teamBranches(
  c: PoolClient,
  s: ChecklistScope,
  id?: string,
) {
  const rows = await checklistLocations(c, s);
  if (id && (!checklistUuid(id) || !rows.some((r) => r.id === id)))
    return reject("NOT_FOUND");
  return id ? [id] : rows.map((r) => r.id);
}
export function teamPage(offset?: number) {
  const n = offset ?? 0;
  if (!Number.isInteger(n) || n < 0 || n > 100000)
    return reject("INVALID_INPUT");
  return n;
}
export const teamManager = (s: ChecklistScope) =>
  s.permissions.has("operations.handover.manage") ||
  s.permissions.has("operations.checklist.review") ||
  s.permissions.has("operations.summary.review");
export async function teamCandidates(
  c: PoolClient,
  tenant: string,
  location: string,
  sender: string,
) {
  const rows = (
    await c.query(
      `SELECT r.id,r.id run_id,'RUN' kind,r.version,r.status,r.snapshot->>'name' name,r.assigned_to,r.due_at
 FROM bms_operation_runs r WHERE r.tenant_id=$1 AND r.location_id=$2 AND r.assigned_to=$3 AND r.status NOT IN ('APPROVED','VOID')
 UNION ALL SELECT a.id,a.run_id,'ACTION',a.version,a.status,a.instruction,a.assigned_to,a.due_at FROM bms_operation_actions a JOIN bms_operation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id
 WHERE a.tenant_id=$1 AND r.location_id=$2 AND a.assigned_to=$3 AND a.status<>'VERIFIED' AND r.status NOT IN ('APPROVED','VOID')
 UNION ALL SELECT e.id,e.run_id,'ESCALATION',e.version,e.status,r.snapshot->>'name',e.recipient,r.due_at FROM bms_operation_escalations e JOIN bms_operation_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id
 WHERE e.tenant_id=$1 AND r.location_id=$2 AND e.recipient=$3 AND e.status<>'CLOSED'
 ORDER BY kind,id LIMIT 201`,
      [tenant, location, sender],
    )
  ).rows;
  if (rows.length > 200) return reject("TOO_MANY_ITEMS");
  return rows.map(projectChecklistRow);
}
export async function operationTeamWorkspace(
  s: ChecklistScope,
  filter: { locationId?: string; from: string; to: string; offset?: number },
) {
  checklistPermission(s, "operations.checklist.view");
  const dates = checklistReportDates(filter.from, filter.to),
    offset = teamPage(filter.offset);
  return checklistTx(s, async (c) => {
    const ids = await teamBranches(c, s, filter.locationId),
      args = [s.tenantId, ids, dates.from, dates.to, s.actorId];
    const interval = `starts_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Bangkok') AND starts_at < (($4::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok')`;
    const rosterWhere = `tenant_id=$1 AND location_id=ANY($2::uuid[]) AND ${interval} AND ($6 OR assigned_to=$5)`;
    const rosterArgs = [
      ...args,
      s.permissions.has("operations.roster.manage") ||
        s.permissions.has("operations.checklist.review") ||
        s.permissions.has("operations.summary.review"),
    ];
    const rosters = (
      await c.query(
        `SELECT * FROM bms_operation_rosters WHERE ${rosterWhere} ORDER BY starts_at,id LIMIT 25 OFFSET $7`,
        [...rosterArgs, offset],
      )
    ).rows;
    const rosterTotal = (
      await c.query(
        `SELECT count(*)::int n FROM bms_operation_rosters WHERE ${rosterWhere}`,
        rosterArgs,
      )
    ).rows[0].n;
    const handoverWhere = `h.tenant_id=$1 AND h.location_id=ANY($2::uuid[]) AND ${interval.replaceAll("starts_at", "r.starts_at")} AND ($6 OR h.sender=$5 OR h.recipient=$5)`;
    const handoverArgs = [...args, teamManager(s)];
    const handovers = (
      await c.query(
        `SELECT h.*,r.duty_name FROM bms_operation_handovers h JOIN bms_operation_rosters r ON r.tenant_id=h.tenant_id AND r.id=h.roster_id WHERE ${handoverWhere} ORDER BY h.created_at DESC,h.id LIMIT 25 OFFSET $7`,
        [...handoverArgs, offset],
      )
    ).rows;
    const handoverTotal = (
      await c.query(
        `SELECT count(*)::int n FROM bms_operation_handovers h JOIN bms_operation_rosters r ON r.tenant_id=h.tenant_id AND r.id=h.roster_id WHERE ${handoverWhere}`,
        handoverArgs,
      )
    ).rows[0].n;
    const missingWhere = `tenant_id=$1 AND location_id=ANY($2::uuid[]) AND due_at>=($3::date::timestamp AT TIME ZONE 'Asia/Bangkok') AND due_at<(($4::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok') AND assigned_to IS NULL AND assignment_evidence->>'mode'='DUTY' AND status NOT IN ('APPROVED','VOID')`;
    const missing = (
      await c.query(
        `SELECT * FROM bms_operation_runs WHERE ${missingWhere} ORDER BY due_at,id LIMIT 25 OFFSET $5`,
        [...args.slice(0, 4), offset],
      )
    ).rows;
    const missingTotal = (
      await c.query(
        `SELECT count(*)::int n FROM bms_operation_runs WHERE ${missingWhere}`,
        args.slice(0, 4),
      )
    ).rows[0].n;
    const policies = (
      await c.query(
        `SELECT location_id,use_duty_supervisor,supervisor_duty_key,version FROM bms_operation_policies WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) ORDER BY location_id LIMIT 200`,
        [s.tenantId, ids],
      )
    ).rows;
    const staff = (
      await c.query(
        `SELECT u.id,u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.tenant_id=$1 AND NOT COALESCE(u.pos_only,false)
      AND (r.name='Administrator' OR (EXISTS(SELECT 1 FROM bms_role_permissions p WHERE p.tenant_id=$1 AND p.role_id=u.role_id AND p.permission='operations.checklist.view') AND EXISTS(SELECT 1 FROM bms_role_permissions p WHERE p.tenant_id=$1 AND p.role_id=u.role_id AND p.permission IN ('operations.roster.accept','operations.handover.receive'))))
      AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=u.id) OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=u.id AND a.location_id=ANY($2::uuid[]))) ORDER BY u.name,u.id LIMIT 200`,
        [s.tenantId, ids],
      )
    ).rows;
    return {
      staff,
      rosters: rosters.map(projectChecklistRow),
      rosterTotal,
      handovers: handovers.map(projectChecklistRow),
      handoverTotal,
      missing: missing.map(projectChecklistRow),
      missingTotal,
      policies: policies.map(projectChecklistRow),
      actorId: s.actorId,
    };
  });
}
export async function operationTeamRoster(s: ChecklistScope, id: string) {
  checklistPermission(s, "operations.checklist.view");
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  return checklistTx(s, async (c) => {
    const r = (
      await c.query(
        "SELECT * FROM bms_operation_rosters WHERE tenant_id=$1 AND id=$2",
        [s.tenantId, id],
      )
    ).rows[0];
    if (!r) return reject("NOT_FOUND");
    await teamBranches(c, s, r.location_id);
    if (
      r.assigned_to !== s.actorId &&
      !s.permissions.has("operations.roster.manage") &&
      !s.permissions.has("operations.checklist.review") &&
      !s.permissions.has("operations.summary.review")
    )
      return reject("FORBIDDEN");
    return projectChecklistRow(r);
  });
}
export async function operationTeamDetail(s: ChecklistScope, id: string) {
  checklistPermission(s, "operations.checklist.view");
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  return checklistTx(s, async (c) => {
    const h = (
      await c.query(
        `SELECT * FROM bms_operation_handovers WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, id],
      )
    ).rows[0];
    if (!h) return reject("NOT_FOUND");
    await teamBranches(c, s, h.location_id);
    if (!teamManager(s) && ![h.sender, h.recipient].includes(s.actorId))
      return reject("FORBIDDEN");
    const current = [];
    for (const item of h.items) {
      const table =
        item.kind === "RUN"
          ? "bms_operation_runs"
          : item.kind === "ACTION"
            ? "bms_operation_actions"
            : "bms_operation_escalations";
      const r = (
        await c.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2`, [
          s.tenantId,
          item.id,
        ])
      ).rows[0];
      current.push({
        ...item,
        currentStatus: r?.status ?? "NOT_FOUND",
        currentVersion: r?.version ?? 0,
        currentAssignedTo: r?.assigned_to ?? r?.recipient ?? null,
      });
    }
    const events = (
      await c.query(
        `SELECT * FROM bms_operation_team_events WHERE tenant_id=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 200`,
        [s.tenantId, id],
      )
    ).rows;
    return {
      ...projectChecklistRow(h),
      liveItems: current,
      events: events.map(projectChecklistRow),
    };
  });
}
export async function operationTeamInbox(s: ChecklistScope, offset = 0) {
  checklistPermission(s, "operations.checklist.view");
  teamPage(offset);
  return checklistTx(s, async (c) => {
    const ids = await teamBranches(c, s),
      args = [s.tenantId, ids, s.actorId];
    const combined = `WITH notices AS (SELECT n.id,n.run_id entity_id,'RUN' entity_kind,n.kind,'CHECKLIST' source,n.created_at,n.read_at FROM bms_operation_notices n JOIN bms_operation_runs r ON r.tenant_id=n.tenant_id AND r.id=n.run_id WHERE n.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND n.recipient=$3
   UNION ALL SELECT id,entity_id,entity_kind,kind,'TEAM',created_at,read_at FROM bms_operation_team_notices WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) AND recipient=$3 AND (entity_kind<>'QUALITY' OR ${s.permissions.has('operations.quality.view')?'true':'false'}))`;
    const items = (
      await c.query(
        `${combined} SELECT * FROM notices ORDER BY created_at DESC,id LIMIT 25 OFFSET $4`,
        [...args, offset],
      )
    ).rows;
    const counts = (
      await c.query(
        `${combined} SELECT count(*)::int total,count(*) FILTER(WHERE read_at IS NULL)::int unread FROM notices`,
        args,
      )
    ).rows[0];
    return { ...counts, items: items.map(projectChecklistRow) };
  });
}
export async function teamSummaryInTx(
  c: PoolClient,
  s: ChecklistScope,
  location: string,
  date: string,
) {
  checklistReportDates(date, date);
  await teamBranches(c, s, location);
  const args = [s.tenantId, location, date];
  const day = (field: string) =>
    `${field}>=($3::date::timestamp AT TIME ZONE 'Asia/Bangkok') AND ${field}<(($3::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok')`;
  const queries = [
    `SELECT id,version,status,duty_key,assigned_to,starts_at,ends_at,accepted_at,ended_at FROM bms_operation_rosters WHERE tenant_id=$1 AND location_id=$2 AND ${day("starts_at")} ORDER BY id LIMIT 5001`,
    `SELECT id,version,status,assigned_to,due_at,assignment_evidence FROM bms_operation_runs WHERE tenant_id=$1 AND location_id=$2 AND ${day("due_at")} ORDER BY id LIMIT 5001`,
    `SELECT a.id,a.version,a.status,a.assigned_to,a.due_at FROM bms_operation_actions a JOIN bms_operation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id WHERE a.tenant_id=$1 AND r.location_id=$2 AND r.status<>'VOID' AND ${day("r.due_at")} ORDER BY a.id LIMIT 5001`,
    `SELECT h.id,h.version,h.status,h.recipient,h.due_at FROM bms_operation_handovers h JOIN bms_operation_rosters r ON r.tenant_id=h.tenant_id AND r.id=h.roster_id WHERE h.tenant_id=$1 AND h.location_id=$2 AND ${day("r.starts_at")} ORDER BY h.id LIMIT 5001`,
    `SELECT e.id,e.version,e.status,e.recipient FROM bms_operation_escalations e JOIN bms_operation_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id WHERE e.tenant_id=$1 AND r.location_id=$2 AND ${day("r.due_at")} ORDER BY e.id LIMIT 5001`,
  ];
  const facts = [];
  for (const sql of queries) {
    const rows = (await c.query(sql, args)).rows;
    if (rows.length > 5000) return reject("REPORT_TOO_LARGE");
    facts.push(rows.map(projectChecklistRow));
  }
  const now = (await c.query(`SELECT now() AS at`)).rows[0].at.toISOString();
  const [rosters, runs, actions, handovers, escalations] = facts,
    count = (rows: any[], fn: (r: any) => boolean) => rows.filter(fn).length;
  const counts = {
    duties: count(rosters, (r) => r.status === "PUBLISHED"),
    vacancies: count(rosters, (r) => r.status === "PUBLISHED" && !r.assignedTo),
    unaccepted: count(
      rosters,
      (r) => r.status === "PUBLISHED" && !!r.assignedTo && !r.acceptedAt,
    ),
    runs: runs.length,
    approved: count(runs, (r) => r.status === "APPROVED"),
    overdue: count(
      runs,
      (r) => !["APPROVED", "VOID"].includes(r.status) && r.dueAt < now,
    ),
    unassigned: count(
      runs,
      (r) => !["APPROVED", "VOID"].includes(r.status) && !r.assignedTo,
    ),
    review: count(runs, (r) => r.status === "SUBMITTED"),
    actions: count(actions, (r) => r.status !== "VERIFIED"),
    handoverDraft: count(handovers, (r) => r.status === "DRAFT"),
    handoverWaiting: count(handovers, (r) => r.status === "SUBMITTED"),
    handoverReceived: count(handovers, (r) => r.status === "RECEIVED"),
    escalations: count(escalations, (r) => r.status !== "CLOSED"),
  };
  const fingerprint = teamHash({ facts, counts }),
    snapshot = {
      date,
      locationId: location,
      timezone: "Asia/Bangkok",
      asOf: now,
      counts,
      facts,
    };
  const previous = (
    await c.query(
      `SELECT * FROM bms_operation_daily_reviews WHERE tenant_id=$1 AND location_id=$2 AND business_date=$3 ORDER BY version DESC LIMIT 1`,
      args,
    )
  ).rows[0];
  return {
    ...snapshot,
    fingerprint,
    previous: previous ? projectChecklistRow(previous) : null,
    changed: !!previous && previous.fingerprint !== fingerprint,
  };
}
export async function operationTeamSummary(
  s: ChecklistScope,
  location: string,
  date: string,
) {
  checklistPermission(s, "operations.summary.review");
  return checklistTx(s, (c) => teamSummaryInTx(c, s, location, date), {
    serializable: true,
  });
}
