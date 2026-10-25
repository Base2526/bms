import type { PoolClient } from "pg";
import { checklistRecipient } from "./operationChecklistDispatch";
/** Stable occurrence instant, not the worker's recovery time. No scheduled presence claim. */
export async function resolveOperationDuty(
  c: PoolClient,
  tenant: string,
  location: string,
  key: string,
  instant: string,
  permission = "operations.checklist.execute",
) {
  const rows = (
    await c.query(
      `SELECT id,assigned_to,version FROM bms_operation_rosters WHERE tenant_id=$1 AND location_id=$2 AND duty_key=$3 AND status='PUBLISHED' AND starts_at<=$4::timestamptz AND ends_at>$4::timestamptz ORDER BY id LIMIT 201`,
      [tenant, location, key, instant],
    )
  ).rows;
  const eligible = [];
  for (const r of rows) {
    if (
      await checklistRecipient(c, tenant, r.assigned_to, location, permission)
    )
      eligible.push(r);
  }
  const match =
    eligible.length === 1 && rows.length <= 200 ? eligible[0] : null;
  return {
    assignedTo: match?.assigned_to ?? null,
    evidence: {
      mode: "DUTY",
      dutyKey: key,
      effectiveAt: instant,
      status: match
        ? "RESOLVED"
        : eligible.length > 1 || rows.length > 200
          ? "AMBIGUOUS"
          : "MISSING",
      rosterId: match?.id ?? null,
      rosterVersion: match?.version ?? null,
    },
  };
}
export async function operationSupervisor(
  c: PoolClient,
  tenant: string,
  location: string,
  instant: string,
) {
  const p = (
    await c.query(
      `SELECT * FROM bms_operation_policies WHERE tenant_id=$1 AND location_id=$2`,
      [tenant, location],
    )
  ).rows[0];
  if (p?.use_duty_supervisor && p.supervisor_duty_key) {
    const resolved = await resolveOperationDuty(
      c,
      tenant,
      location,
      p.supervisor_duty_key,
      instant,
      "operations.checklist.review",
    );
    if (resolved.assignedTo) return resolved.assignedTo;
  }
  return p &&
    (await checklistRecipient(
      c,
      tenant,
      p.supervisor_id,
      location,
      "operations.checklist.review",
    ))
    ? p.supervisor_id
    : null;
}
export async function teamNotice(
  c: PoolClient,
  tenant: string,
  location: string,
  recipient: string | null,
  entity: string,
  entityKind: string,
  kind: string,
  key: string,
  permission = "operations.checklist.execute",
) {
  if (!(await checklistRecipient(c, tenant, recipient, location, permission)))
    return;
  await c.query(
    `INSERT INTO bms_operation_team_notices(tenant_id,location_id,recipient,entity_id,entity_kind,kind,dedup_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,recipient,dedup_key) DO NOTHING`,
    [
      tenant,
      location,
      recipient,
      entity,
      entityKind,
      kind,
      `${kind}:${entity}:${key}`,
    ],
  );
}
