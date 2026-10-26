import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import {
  ChecklistError,
  checklistText,
  checklistUuid,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import {
  checklistPermission,
  checklistTx,
  executeChecklistInTx,
  lockChecklistRun,
  type ChecklistScope,
} from "./operationChecklists";
import { checklistRecipient } from "./operationChecklistDispatch";
import { operationSupervisor, teamNotice } from "./operationTeamDispatch";
import {
  dutyKey,
  teamInstant,
  teamWindow,
  TEAM_PERMISSIONS,
} from "./operationTeamPolicy";
import {
  teamBranches,
  teamCandidates,
  teamHash,
  teamManager,
  teamSummaryInTx,
} from "./operationTeamReads";
export type TeamCommand = {
  action: keyof typeof TEAM_PERMISSIONS;
  idempotencyKey: string;
  confirmed?: boolean;
  id?: string;
  version?: number;
  locationId?: string;
  dutyKey?: string;
  dutyName?: string;
  assignedTo?: string | null;
  startsAt?: string;
  endsAt?: string;
  rosterId?: string;
  recipient?: string;
  dueAt?: string;
  note?: string;
  itemId?: string;
  itemKind?: "RUN" | "ACTION";
  itemVersion?: number;
  date?: string;
  fingerprint?: string;
  source?: "TEAM" | "CHECKLIST";
  enabled?: boolean;
};
async function event(
  c: PoolClient,
  s: ChecklistScope,
  location: string,
  id: string,
  action: string,
  note: string,
  details: unknown = {},
) {
  await c.query(
    `INSERT INTO bms_operation_team_events(tenant_id,location_id,entity_id,action,actor,note,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      s.tenantId,
      location,
      id,
      action,
      s.actorId,
      note,
      JSON.stringify(details),
    ],
  );
  await c.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [
      s.tenantId,
      s.actorId,
      `operations.team.${action.toLowerCase()}`,
      id,
      JSON.stringify({ reason: note, details }),
    ],
  );
}
async function recipient(
  c: PoolClient,
  s: ChecklistScope,
  id: unknown,
  location: string,
  permission: string,
) {
  if (
    !checklistUuid(id) ||
    !(await checklistRecipient(c, s.tenantId, id, location, permission))
  )
    return reject("INVALID_ASSIGNEE");
  return id as string;
}
function version(row: any, i: TeamCommand) {
  if (!Number.isInteger(i.version) || row.version !== i.version)
    return reject("STALE_VERSION");
}
async function entity(
  c: PoolClient,
  s: ChecklistScope,
  table: "bms_operation_rosters" | "bms_operation_handovers",
  id: unknown,
) {
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  const row = (
    await c.query(
      `SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [s.tenantId, id],
    )
  ).rows[0];
  if (!row) return reject("NOT_FOUND");
  await teamBranches(c, s, row.location_id);
  return row;
}
async function candidatesLocked(c: PoolClient, s: ChecklistScope, h: any) {
  const before = await teamCandidates(c, s.tenantId, h.location_id, h.sender);
  // Canonical operations lock the parent before action/escalation rows. Stable order avoids cycles.
  for (const id of [
    ...new Set<string>([
      ...before.map((x) => x.runId as string),
      ...(h.items ?? []).map((x: any) => x.runId as string),
    ]),
  ].sort())
    await lockChecklistRun(c, s, id);
  return teamCandidates(c, s.tenantId, h.location_id, h.sender);
}
async function execute(c: PoolClient, s: ChecklistScope, i: TeamCommand) {
  const note = checklistText(i.note),
    now = (await c.query("SELECT now() at")).rows[0].at.toISOString();
  let result: { status: string; id?: string; version?: number } = {
    status: "OK",
  };
  if (i.action === "SAVE_ROSTER") {
    if (!i.locationId) return reject("INVALID_INPUT");
    await teamBranches(c, s, i.locationId);
    const times = teamWindow(i.startsAt, i.endsAt),
      key = dutyKey(i.dutyKey),
      name = checklistText(i.dutyName, 200, true);
    const assigned = i.assignedTo
      ? await recipient(
          c,
          s,
          i.assignedTo,
          i.locationId,
          "operations.roster.accept",
        )
      : null;
    if (i.id) {
      const old = await entity(c, s, "bms_operation_rosters", i.id);
      version(old, i);
      if (old.status !== "DRAFT" || old.location_id !== i.locationId)
        return reject("INVALID_STATE");
      await c.query(
        `UPDATE bms_operation_rosters SET duty_key=$3,duty_name=$4,assigned_to=$5,starts_at=$6,ends_at=$7,version=version+1 WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, i.id, key, name, assigned, times.startsAt, times.endsAt],
      );
      result = { status: "OK", id: i.id, version: old.version + 1 };
    } else {
      const r = (
        await c.query(
          `INSERT INTO bms_operation_rosters(tenant_id,location_id,duty_key,duty_name,assigned_to,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,version`,
          [
            s.tenantId,
            i.locationId,
            key,
            name,
            assigned,
            times.startsAt,
            times.endsAt,
            s.actorId,
          ],
        )
      ).rows[0];
      result = { status: "OK", ...r };
    }
    await event(c, s, i.locationId, result.id!, i.action, note, {
      key,
      assigned,
      ...times,
    });
    return result;
  }
  if (
    [
      "PUBLISH_ROSTER",
      "CANCEL_ROSTER",
      "ACCEPT_DUTY",
      "END_DUTY",
      "CREATE_HANDOVER",
    ].includes(i.action)
  ) {
    // All publishes in a tenant serialize, including cross-branch overlap checks.
    if (i.action === "PUBLISH_ROSTER")
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${s.tenantId}:team-publish`,
      ]);
    const r = await entity(
      c,
      s,
      "bms_operation_rosters",
      i.action === "CREATE_HANDOVER" ? i.rosterId : i.id,
    );
    version(r, i);
    if (i.action === "PUBLISH_ROSTER") {
      if (r.status !== "DRAFT") return reject("INVALID_STATE");
      if (r.assigned_to) {
        await recipient(
          c,
          s,
          r.assigned_to,
          r.location_id,
          "operations.roster.accept",
        );
        const overlap = await c.query(
          `SELECT 1 FROM bms_operation_rosters WHERE tenant_id=$1 AND assigned_to=$2 AND status='PUBLISHED' AND starts_at<$4 AND ends_at>$3 LIMIT 1`,
          [s.tenantId, r.assigned_to, r.starts_at, r.ends_at],
        );
        if (overlap.rowCount) return reject("OVERLAPPING_DUTY");
      }
      await c.query(
        `UPDATE bms_operation_rosters SET status='PUBLISHED',version=version+1 WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, r.id],
      );
      await teamNotice(
        c,
        s.tenantId,
        r.location_id,
        r.assigned_to,
        r.id,
        "ROSTER",
        "DUTY_PUBLISHED",
        "published",
        "operations.roster.accept",
      );
      if (!r.assigned_to)
        await teamNotice(
          c,
          s.tenantId,
          r.location_id,
          await operationSupervisor(c, s.tenantId, r.location_id, now),
          r.id,
          "ROSTER",
          "DUTY_VACANT",
          "published",
          "operations.checklist.review",
        );
    } else if (i.action === "CANCEL_ROSTER") {
      if (!note) return reject("REASON_REQUIRED");
      if (r.status === "CANCELLED") return reject("INVALID_STATE");
      await c.query(
        `UPDATE bms_operation_rosters SET status='CANCELLED',version=version+1 WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, r.id],
      );
      await teamNotice(
        c,
        s.tenantId,
        r.location_id,
        r.assigned_to,
        r.id,
        "ROSTER",
        "DUTY_CANCELLED",
        "cancelled",
        "operations.roster.accept",
      );
    } else if (i.action === "CREATE_HANDOVER") {
      if (r.status !== "PUBLISHED" || !r.assigned_to)
        return reject("INVALID_STATE");
      if (
        r.assigned_to !== s.actorId &&
        !s.permissions.has("operations.handover.manage")
      )
        return reject("NOT_ASSIGNED");
      const to = await recipient(
        c,
        s,
        i.recipient,
        r.location_id,
        "operations.handover.receive",
      );
      if (to === r.assigned_to) return reject("INVALID_ASSIGNEE");
      if (
        (
          await c.query(
            `SELECT 1 FROM bms_operation_handovers WHERE tenant_id=$1 AND roster_id=$2 AND status<>'CANCELLED'`,
            [s.tenantId, r.id],
          )
        ).rowCount
      )
        return reject("HANDOVER_EXISTS");
      const items = await candidatesLocked(c, s, {
        location_id: r.location_id,
        sender: r.assigned_to,
      });
      const h = (
        await c.query(
          `INSERT INTO bms_operation_handovers(tenant_id,location_id,roster_id,sender,recipient,items,note,due_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id,version`,
          [
            s.tenantId,
            r.location_id,
            r.id,
            r.assigned_to,
            to,
            JSON.stringify(items),
            note,
            teamInstant(i.dueAt),
          ],
        )
      ).rows[0];
      await event(c, s, r.location_id, h.id, i.action, note, {
        rosterId: r.id,
        recipient: to,
      });
      return { status: "OK", ...h };
    } else {
      if (r.status !== "PUBLISHED" || r.assigned_to !== s.actorId)
        return reject("NOT_ASSIGNED");
      if (i.action === "ACCEPT_DUTY") {
        if (
          r.accepted_at ||
          now < r.starts_at.toISOString() ||
          now >= r.ends_at.toISOString()
        )
          return reject("OUTSIDE_DUTY");
        await c.query(
          `UPDATE bms_operation_rosters SET accepted_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2`,
          [s.tenantId, r.id],
        );
      } else {
        if (!r.accepted_at || r.ended_at) return reject("INVALID_STATE");
        await c.query(
          `UPDATE bms_operation_rosters SET ended_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2`,
          [s.tenantId, r.id],
        );
      }
    }
    await event(c, s, r.location_id, r.id, i.action, note);
    return { status: "OK", id: r.id, version: r.version + 1 };
  }
  if (i.action === "CONFIRM_DAY") {
    if (!i.locationId || !i.date || !note) return reject("INVALID_INPUT");
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `${s.tenantId}:daily:${i.locationId}:${i.date}`,
    ]);
    const summary = await teamSummaryInTx(c, s, i.locationId, i.date);
    if (summary.fingerprint !== i.fingerprint) return reject("STALE_SOURCE");
    if (i.version !== (summary.previous?.version ?? 0))
      return reject("STALE_VERSION");
    const next = (summary.previous?.version ?? 0) + 1;
    const r = (
      await c.query(
        `INSERT INTO bms_operation_daily_reviews(tenant_id,location_id,business_date,version,fingerprint,snapshot,note,reviewed_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id,version`,
        [
          s.tenantId,
          i.locationId,
          i.date,
          next,
          summary.fingerprint,
          JSON.stringify({
            ...summary,
            previous: undefined,
            changed: undefined,
          }),
          note,
          s.actorId,
        ],
      )
    ).rows[0];
    await event(c, s, i.locationId, r.id, i.action, note, {
      date: i.date,
      version: next,
    });
    return { status: "OK", ...r };
  }
  if (i.action === "SAVE_SUPERVISOR_DUTY") {
    if (!i.locationId || typeof i.enabled !== "boolean")
      return reject("INVALID_INPUT");
    await teamBranches(c, s, i.locationId);
    const key = i.enabled ? dutyKey(i.dutyKey) : null;
    const p = (
      await c.query(
        `SELECT * FROM bms_operation_policies WHERE tenant_id=$1 AND location_id=$2 FOR UPDATE`,
        [s.tenantId, i.locationId],
      )
    ).rows[0];
    if (!p) return reject("SUPERVISOR_REQUIRED");
    version(p, i);
    await c.query(
      `UPDATE bms_operation_policies SET use_duty_supervisor=$3,supervisor_duty_key=$4,version=version+1,updated_by=$5,updated_at=now() WHERE tenant_id=$1 AND location_id=$2`,
      [s.tenantId, i.locationId, i.enabled, key, s.actorId],
    );
    await event(c, s, i.locationId, i.locationId, i.action, note, {
      enabled: i.enabled,
      key,
    });
    return { status: "OK", id: i.locationId, version: p.version + 1 };
  }
  if (i.action === "READ_NOTICE") {
    if (!checklistUuid(i.id) || !["TEAM", "CHECKLIST"].includes(i.source ?? ""))
      return reject("INVALID_INPUT");
    const table =
      i.source === "TEAM"
        ? "bms_operation_team_notices"
        : "bms_operation_notices";
    const n = (
      await c.query(
        `SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2 AND recipient=$3`,
        [s.tenantId, i.id, s.actorId],
      )
    ).rows[0];
    if (!n) return reject("NOT_FOUND");
    if (i.source === "TEAM") await teamBranches(c, s, n.location_id);
    else await lockChecklistRun(c, s, n.run_id);
    await c.query(
      `UPDATE ${table} SET read_at=COALESCE(read_at,now()) WHERE tenant_id=$1 AND id=$2 AND recipient=$3`,
      [s.tenantId, i.id, s.actorId],
    );
    return { status: "OK", id: i.id };
  }
  const h = await entity(c, s, "bms_operation_handovers", i.id);
  version(h, i);
  if (!teamManager(s) && ![h.sender, h.recipient].includes(s.actorId))
    return reject("FORBIDDEN");
  if (["REFRESH_HANDOVER", "SUBMIT_HANDOVER"].includes(i.action)) {
    if (h.status !== "DRAFT") return reject("INVALID_STATE");
    if (
      h.sender !== s.actorId &&
      !s.permissions.has("operations.handover.manage")
    )
      return reject("NOT_ASSIGNED");
    const items = await candidatesLocked(c, s, h);
    if (i.action === "REFRESH_HANDOVER") {
      const to = await recipient(
        c,
        s,
        i.recipient,
        h.location_id,
        "operations.handover.receive",
      );
      if (to === h.sender) return reject("INVALID_ASSIGNEE");
      await c.query(
        `UPDATE bms_operation_handovers SET recipient=$3,items=$4::jsonb,note=$5,due_at=$6,version=version+1 WHERE tenant_id=$1 AND id=$2`,
        [
          s.tenantId,
          h.id,
          to,
          JSON.stringify(items),
          note,
          teamInstant(i.dueAt),
        ],
      );
    } else {
      if (teamHash(items) !== teamHash(h.items)) return reject("STALE_SOURCE");
      await recipient(
        c,
        s,
        h.recipient,
        h.location_id,
        "operations.handover.receive",
      );
      if (!h.note) return reject("REASON_REQUIRED");
      await c.query(
        `UPDATE bms_operation_handovers SET status='SUBMITTED',submitted_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, h.id],
      );
      await teamNotice(
        c,
        s.tenantId,
        h.location_id,
        h.recipient,
        h.id,
        "HANDOVER",
        "HANDOVER_WAITING",
        String(h.version + 1),
        "operations.handover.receive",
      );
    }
  } else if (i.action === "RECEIVE_HANDOVER") {
    if (h.status !== "SUBMITTED") return reject("INVALID_STATE");
    if (h.recipient !== s.actorId) return reject("NOT_ASSIGNED");
    await c.query(
      `UPDATE bms_operation_handovers SET status='RECEIVED',received_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, h.id],
    );
    await teamNotice(
      c,
      s.tenantId,
      h.location_id,
      h.sender,
      h.id,
      "HANDOVER",
      "HANDOVER_RECEIVED",
      String(h.version + 1),
      "operations.roster.accept",
    );
  } else if (i.action === "REROUTE_HANDOVER") {
    if (h.status !== "SUBMITTED") return reject("INVALID_STATE");
    if (!note) return reject("REASON_REQUIRED");
    const to = await recipient(
      c,
      s,
      i.recipient,
      h.location_id,
      "operations.handover.receive",
    );
    if (to === h.recipient || to === h.sender)
      return reject("INVALID_ASSIGNEE");
    await c.query(
      `UPDATE bms_operation_handovers SET recipient=$3,version=version+1 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, h.id, to],
    );
    await teamNotice(
      c,
      s.tenantId,
      h.location_id,
      to,
      h.id,
      "HANDOVER",
      "HANDOVER_WAITING",
      String(h.version + 1),
      "operations.handover.receive",
    );
  } else if (i.action === "CANCEL_HANDOVER") {
    if (!["DRAFT", "SUBMITTED"].includes(h.status))
      return reject("INVALID_STATE");
    if (!note) return reject("REASON_REQUIRED");
    await c.query(
      `UPDATE bms_operation_handovers SET status='CANCELLED',version=version+1 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, h.id],
    );
  } else if (i.action === "APPEND_NOTE") {
    if (!["SUBMITTED", "RECEIVED"].includes(h.status))
      return reject("INVALID_STATE");
    if (!note) return reject("REASON_REQUIRED");
    await c.query(
      `UPDATE bms_operation_handovers SET version=version+1 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, h.id],
    );
  } else if (i.action === "TRANSFER_ITEM") {
    if (h.status !== "RECEIVED") return reject("INVALID_STATE");
    if (!note) return reject("REASON_REQUIRED");
    const item = h.items.find(
      (x: any) => x.id === i.itemId && x.kind === i.itemKind,
    );
    if (!item) return reject("NOT_FOUND");
    await recipient(
      c,
      s,
      h.recipient,
      h.location_id,
      "operations.checklist.execute",
    );
    const run = await lockChecklistRun(c, s, item.runId);
    if (run.location_id !== h.location_id) return reject("NOT_FOUND");
    const current =
      item.kind === "RUN"
        ? run
        : (
            await c.query(
              `SELECT * FROM bms_operation_actions WHERE tenant_id=$1 AND id=$2 AND run_id=$3 FOR UPDATE`,
              [s.tenantId, item.id, run.id],
            )
          ).rows[0];
    if (!current) return reject("NOT_FOUND");
    if (
      ["APPROVED", "VOID"].includes(run.status) ||
      current.status === "VERIFIED"
    )
      return reject("INVALID_STATE");
    if (current.assigned_to !== h.sender) return reject("OWNER_CHANGED");
    await executeChecklistInTx(c, s, {
      action: item.kind === "RUN" ? "ASSIGN" : "ACTION_ASSIGN",
      id: item.id,
      version: i.itemVersion,
      assignedTo: h.recipient,
      dueAt: current.due_at.toISOString(),
      confirmed: true,
      idempotencyKey: i.idempotencyKey,
      note,
    });
    await c.query(
      `UPDATE bms_operation_handovers SET version=version+1 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, h.id],
    );
  } else return reject("INVALID_INPUT");
  await event(c, s, h.location_id, h.id, i.action, note, {
    recipient: i.recipient ?? h.recipient,
    itemId: i.itemId ?? null,
  });
  return { status: "OK", id: h.id, version: h.version + 1 };
}
export async function commandOperationTeam(
  s: ChecklistScope,
  i: TeamCommand,
): Promise<{ status: string; id?: string; version?: number }> {
  try {
    if (!i || !Object.hasOwn(TEAM_PERMISSIONS, i.action))
      return reject("INVALID_INPUT");
    checklistPermission(s, TEAM_PERMISSIONS[i.action]);
    const key = checklistText(i.idempotencyKey, 128, true);
    if (key.length < 8) return reject("INVALID_INPUT");
    if (i.action !== "READ_NOTICE" && i.confirmed !== true)
      return reject("CONFIRMATION_REQUIRED");
    const fingerprint = teamHash({ team: i });
    return await checklistTx(
      s,
      async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `${s.tenantId}:${s.actorId}:operations:${key}`,
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
      },
      { serializable: i.action === "CONFIRM_DAY" },
    );
  } catch (e) {
    if (e instanceof ChecklistError) return { status: e.message };
    if ((e as any)?.code === "40001" || (e as any)?.code === "40P01")
      return { status: "RETRY_REQUIRED" };
    throw e;
  }
}
export async function runOperationTeamFollowups(onlyTenant?: string) {
  const tenants = await query(
    `SELECT tenant_id FROM bms_operation_handovers WHERE status='SUBMITTED' AND due_at<now() AND ($1::uuid IS NULL OR tenant_id=$1) GROUP BY tenant_id ORDER BY min(followup_at),tenant_id LIMIT 100`,
    [onlyTenant ?? null],
  );
  let processed = 0,
    failed = 0;
  for (const t of tenants.rows) {
    try {
      processed += await checklistTx(
        { tenantId: t.tenant_id, actorId: "system:operations" },
        async (c) => {
          const rows = (
            await c.query(
              `SELECT *,now() clock FROM bms_operation_handovers WHERE tenant_id=$1 AND status='SUBMITTED' AND due_at<now() ORDER BY followup_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
              [t.tenant_id],
            )
          ).rows;
          for (const h of rows) {
            await teamNotice(
              c,
              t.tenant_id,
              h.location_id,
              h.recipient,
              h.id,
              "HANDOVER",
              "HANDOVER_OVERDUE",
              String(h.version),
              "operations.handover.receive",
            );
            await teamNotice(
              c,
              t.tenant_id,
              h.location_id,
              await operationSupervisor(
                c,
                t.tenant_id,
                h.location_id,
                h.clock.toISOString(),
              ),
              h.id,
              "HANDOVER",
              "HANDOVER_ESCALATED",
              String(h.version),
              "operations.checklist.review",
            );
            await c.query(
              `UPDATE bms_operation_handovers SET followup_at=now() WHERE tenant_id=$1 AND id=$2`,
              [t.tenant_id, h.id],
            );
          }
          return rows.length;
        },
      );
    } catch {
      failed++;
    }
  }
  return { processed, failed };
}
