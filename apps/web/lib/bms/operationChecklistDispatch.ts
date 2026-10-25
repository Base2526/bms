import type { PoolClient } from "pg";
import { operationSupervisor, teamNotice } from "./operationTeamDispatch";

/** Recipients are revalidated at dispatch, never inferred from a title or role name alone. */
export async function checklistRecipient(
  c: PoolClient,
  tenant: string,
  user: string | null,
  location: string,
  permission: string,
) {
  if (!user) return false;
  return !!(
    await c.query(
      `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.tenant_id=$1 AND u.id::text=$2 AND NOT COALESCE(u.pos_only,false)
    AND (r.name='Administrator' OR (
      EXISTS(SELECT 1 FROM bms_role_permissions p WHERE p.tenant_id=$1 AND p.role_id=u.role_id AND p.permission='operations.checklist.view')
      AND EXISTS(SELECT 1 FROM bms_role_permissions p WHERE p.tenant_id=$1 AND p.role_id=u.role_id AND p.permission=$4)))
    AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=u.id)
      OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=u.id AND a.location_id=$3))`,
      [tenant, user, location, permission],
    )
  ).rowCount;
}
export async function checklistNotice(
  c: PoolClient,
  tenant: string,
  run: string,
  recipient: string,
  kind: string,
  identity: string,
) {
  await c.query(
    `INSERT INTO bms_operation_notices(tenant_id,run_id,recipient,kind,dedup_key)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,recipient,dedup_key) DO NOTHING`,
    [tenant, run, recipient, kind, `${run}:${kind}:${identity}`],
  );
}
export async function checklistFollowupAudit(
  c: PoolClient,
  tenant: string,
  actor: string,
  run: string | null,
  action: string,
  note: string,
  target?: string,
) {
  if (run)
    await c.query(
      `INSERT INTO bms_operation_events(tenant_id,run_id,action,actor,note) VALUES($1,$2,$3,$4,$5)`,
      [tenant, run, action, actor, note],
    );
  await c.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [
      tenant,
      actor,
      `operations.${action.toLowerCase()}`,
      target ?? run,
      JSON.stringify({ reason: note }),
    ],
  );
}
/** Caller holds the parent run lock. One active escalation, including an acknowledged one. */
export async function escalateChecklistInTx(
  c: PoolClient,
  tenant: string,
  run: any,
  recipient: string,
  reason: string,
  actor: string,
  source: "MANUAL" | "OVERDUE",
) {
  const inserted = (
    await c.query(
      `INSERT INTO bms_operation_escalations(tenant_id,run_id,recipient,reason,created_by,source)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,run_id) WHERE status<>'CLOSED' DO NOTHING RETURNING *`,
      [tenant, run.id, recipient, reason, actor, source],
    )
  ).rows[0];
  if (inserted) {
    await checklistNotice(
      c,
      tenant,
      run.id,
      recipient,
      "ESCALATED",
      inserted.id,
    );
    await checklistFollowupAudit(c, tenant, actor, run.id, "ESCALATE", reason);
    return inserted;
  }
  return (
    await c.query(
      `SELECT * FROM bms_operation_escalations WHERE tenant_id=$1 AND run_id=$2 AND status<>'CLOSED'`,
      [tenant, run.id],
    )
  ).rows[0];
}
/** Transactional in-workspace inbox, not email/LINE nor the generic notification bell.
 * Called after each canonical write and by the bounded cron while holding the run lock. */
export async function syncChecklistFollowup(
  c: PoolClient,
  tenant: string,
  id: string,
) {
  const r = (
    await c.query(
      `SELECT r.*,now() AS clock FROM bms_operation_runs r WHERE tenant_id=$1 AND id=$2`,
      [tenant, id],
    )
  ).rows[0];
  if (!r) return;
  if (["APPROVED", "VOID"].includes(r.status)) {
    const closed = await c.query(
      `UPDATE bms_operation_escalations SET status='CLOSED',version=version+1,closed_at=now()
      WHERE tenant_id=$1 AND run_id=$2 AND status<>'CLOSED' RETURNING id`,
      [tenant, id],
    );
    if (closed.rowCount)
      await checklistFollowupAudit(
        c,
        tenant,
        "SYSTEM",
        id,
        "ESCALATION_CLOSED",
        r.status,
      );
    return;
  }
  const p = (
    await c.query(
      `SELECT * FROM bms_operation_policies WHERE tenant_id=$1 AND location_id=$2`,
      [tenant, r.location_id],
    )
  ).rows[0];
  const supervisor = await operationSupervisor(
    c,
    tenant,
    r.location_id,
    new Date(r.clock).toISOString(),
  );
  if (!r.assigned_to && r.assignment_evidence?.mode === "DUTY")
    await teamNotice(
      c,
      tenant,
      r.location_id,
      supervisor,
      r.id,
      "RUN",
      "ASSIGNMENT_REQUIRED",
      "once",
      "operations.checklist.review",
    );
  const actions = (
    await c.query(
      `SELECT * FROM bms_operation_actions WHERE tenant_id=$1 AND run_id=$2 AND status<>'VERIFIED'`,
      [tenant, id],
    )
  ).rows;
  const tasks = [
    { ...r, kind: "RUN" },
    ...actions.map((a) => ({ ...a, kind: "ACTION" })),
  ];
  const now = new Date(r.clock).getTime();
  for (const task of tasks) {
    const due = new Date(task.due_at),
      identity = `${task.id}:${due.toISOString()}`;
    const reviewing =
      task.kind === "RUN"
        ? task.status === "SUBMITTED"
        : task.status === "RESOLVED";
    if (reviewing) {
      let eligible = !!supervisor;
      if (eligible && r.snapshot.separateReviewer) {
        eligible =
          task.kind === "RUN"
            ? !(
                await c.query(
                  `SELECT 1 FROM bms_operation_results WHERE tenant_id=$1 AND run_id=$2 AND recorded_by=$3 LIMIT 1`,
                  [tenant, id, supervisor],
                )
              ).rowCount
            : task.resolved_by !== supervisor;
      }
      if (eligible)
        await checklistNotice(
          c,
          tenant,
          id,
          supervisor!,
          "REVIEW",
          `${identity}:${task.kind === "RUN" ? new Date(task.submitted_at).toISOString() : new Date(task.updated_at).toISOString()}`,
        );
    } else if (
      await checklistRecipient(
        c,
        tenant,
        task.assigned_to,
        r.location_id,
        "operations.checklist.execute",
      )
    ) {
      await checklistNotice(
        c,
        tenant,
        id,
        task.assigned_to,
        "ASSIGNED",
        identity,
      );
      if (due.getTime() < now)
        await checklistNotice(
          c,
          tenant,
          id,
          task.assigned_to,
          "OVERDUE",
          identity,
        );
      else if (p?.enabled && due.getTime() <= now + p.reminder_minutes * 60000)
        await checklistNotice(
          c,
          tenant,
          id,
          task.assigned_to,
          "DUE_SOON",
          identity,
        );
    }
  }
  if (
    p?.enabled &&
    supervisor &&
    tasks.some(
      (t) => new Date(t.due_at).getTime() + p.escalation_minutes * 60000 <= now,
    )
  ) {
    await escalateChecklistInTx(
      c,
      tenant,
      r,
      supervisor,
      "OVERDUE",
      "SYSTEM",
      "OVERDUE",
    );
  }
}
