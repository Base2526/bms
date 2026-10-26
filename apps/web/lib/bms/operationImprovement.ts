import type { PoolClient } from "pg";
import {
  checklistTx,
  checklistPermission,
  executeChecklistInTx,
  lockChecklistRun,
  type ChecklistScope,
} from "./operationChecklists";
import {
  ChecklistError,
  checklistUuid,
  checklistText,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import { checklistRecipient } from "./operationChecklistDispatch";
import { teamBranches, teamHash } from "./operationTeamReads";
import { dutyKey, teamInstant } from "./operationTeamPolicy";
import {
  IMPROVEMENT_PERMISSIONS,
  operationWeek,
} from "./operationImprovementPolicy";
import { executeStandard } from "./operationStandards";
import { issueEvidence, weeklyFacts } from "./operationImprovementReads";

export type ImprovementCommand = {
  action: keyof typeof IMPROVEMENT_PERMISSIONS;
  idempotencyKey: string;
  confirmed: boolean;
  id?: string;
  version?: number;
  locationId?: string;
  familyId?: string;
  dutyKey?: string;
  title?: string;
  body?: string;
  sourceType?: string;
  sourceId?: string;
  trainingRequired?: boolean;
  carryAcknowledgement?: boolean;
  carryTraining?: boolean;
  staffId?: string;
  outcome?: string;
  note?: string;
  actionId?: string;
  category?: string;
  severity?: string;
  ownerId?: string;
  hypothesis?: string;
  cause?: string;
  templateId?: string;
  dueAt?: string;
  assignedTo?: string;
  target?: string;
  weeklyReviewId?: string;
  from?: string;
  fingerprint?: string;
};
async function failure(c: PoolClient, s: ChecklistScope, id: unknown) {
  if (!checklistUuid(id)) reject("INVALID_INPUT");
  const a = (
    await c.query(
      `SELECT a.*,r.location_id,r.status run_status FROM bms_operation_actions a JOIN bms_operation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id WHERE a.tenant_id=$1 AND a.id=$2`,
      [s.tenantId, id],
    )
  ).rows[0];
  if (!a) reject("NOT_FOUND");
  await lockChecklistRun(c, s, a.run_id);
  if (a.run_status === "VOID") reject("INVALID_SOURCE");
  if (
    !(
      await c.query(
        `SELECT 1 FROM bms_operation_results WHERE tenant_id=$1 AND run_id=$2 AND item_key=$3 AND outcome='FAIL' LIMIT 1`,
        [s.tenantId, a.run_id, a.item_key],
      )
    ).rowCount
  )
    reject("INVALID_SOURCE");
  return a;
}
async function fields(
  c: PoolClient,
  s: ChecklistScope,
  i: ImprovementCommand,
  location: string,
) {
  const severity = checklistText(i.severity, 20, true);
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity))
    reject("INVALID_INPUT");
  if (
    !checklistUuid(i.ownerId) ||
    !(await checklistRecipient(
      c,
      s.tenantId,
      i.ownerId,
      location,
      "operations.checklist.execute",
    ))
  )
    reject("INVALID_ASSIGNEE");
  return [
    checklistText(i.title, 160, true),
    dutyKey(i.category),
    severity,
    i.ownerId,
    checklistText(i.hypothesis, 2000),
    checklistText(i.cause, 2000),
  ];
}
async function execute(
  c: PoolClient,
  s: ChecklistScope,
  i: ImprovementCommand,
) {
  if (
    [
      "PUBLISH_STANDARD",
      "ACK_STANDARD",
      "ASSESS_STANDARD",
      "RECORD_TRAINING",
    ].includes(i.action)
  )
    return executeStandard(c, s, i);
  if (i.action === "CONFIRM_WEEK") {
    const week = operationWeek(i.from);
    if (!checklistUuid(i.locationId)) reject("INVALID_INPUT");
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `${s.tenantId}:week:${i.locationId}:${week.from}`,
    ]);
    const old = (
      await c.query(
        `SELECT version FROM bms_operation_weekly_reviews WHERE tenant_id=$1 AND location_id=$2 AND week_from=$3 ORDER BY version DESC LIMIT 1`,
        [s.tenantId, i.locationId, week.from],
      )
    ).rows[0];
    if ((old?.version ?? 0) !== i.version) reject("STALE_VERSION");
    const snapshot = await weeklyFacts(c, s, week.from, i.locationId);
    if (snapshot.fingerprint !== i.fingerprint) reject("SNAPSHOT_CHANGED");
    const row = (
      await c.query(
        `INSERT INTO bms_operation_weekly_reviews(tenant_id,location_id,week_from,version,fingerprint,snapshot,note,reviewed_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id,version`,
        [
          s.tenantId,
          i.locationId,
          week.from,
          (old?.version ?? 0) + 1,
          snapshot.fingerprint,
          JSON.stringify(snapshot),
          checklistText(i.note, 2000, true),
          s.actorId,
        ],
      )
    ).rows[0];
    return { status: "OK", ...row, locationId: i.locationId };
  }
  const source = ["CREATE_ISSUE", "LINK_FAILURE"].includes(i.action)
    ? await failure(c, s, i.actionId)
    : null;
  if (i.action === "CREATE_ISSUE") {
    const a = source!;
    const values = await fields(c, s, i, a.location_id);
    const row = (
      await c.query(
        `INSERT INTO bms_operation_issues(tenant_id,location_id,title,category,severity,owner_id,hypothesis,cause,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,version`,
        [s.tenantId, a.location_id, ...values, s.actorId],
      )
    ).rows[0];
    await link(c, s, row.id, a.id);
    return { status: "OK", ...row, locationId: a.location_id };
  }
  if (!checklistUuid(i.id)) reject("INVALID_INPUT");
  const issue = (
    await c.query(
      `SELECT * FROM bms_operation_issues WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [s.tenantId, i.id],
    )
  ).rows[0];
  if (!issue) reject("NOT_FOUND");
  await teamBranches(c, s, issue.location_id);
  if (issue.version !== i.version) reject("STALE_VERSION");
  if (i.action === "LINK_FAILURE") {
    if (source!.location_id !== issue.location_id) reject("NOT_FOUND");
    await link(c, s, issue.id, source!.id);
    await c.query(
      `UPDATE bms_operation_issues SET status='OPEN',reopened_at=CASE WHEN status='CLOSED' THEN now() ELSE reopened_at END WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, issue.id],
    );
  } else if (i.action === "REOPEN_ISSUE") {
    if (issue.status !== "CLOSED") reject("INVALID_STATE");
    checklistText(i.note, 2000, true);
    await c.query(
      `UPDATE bms_operation_issues SET status='OPEN',reopened_at=now() WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, issue.id],
    );
  } else {
    if (issue.status !== "OPEN") reject("INVALID_STATE");
    if (i.action === "UPDATE_ISSUE") {
      const values = await fields(c, s, i, issue.location_id);
      await c.query(
        `UPDATE bms_operation_issues SET title=$3,category=$4,severity=$5,owner_id=$6,hypothesis=$7,cause=$8 WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, issue.id, ...values],
      );
    } else if (i.action === "CREATE_FOLLOWUP") {
      checklistPermission(s, "operations.checklist.manage");
      if (!checklistUuid(i.templateId)) reject("INVALID_INPUT");
      const t = (
        await c.query(
          `SELECT location_id,separate_reviewer FROM bms_operation_templates WHERE tenant_id=$1 AND id=$2`,
          [s.tenantId, i.templateId],
        )
      ).rows[0];
      if (t?.location_id !== issue.location_id) reject("NOT_FOUND");
      if (!t.separate_reviewer) reject("SEPARATE_REVIEW_REQUIRED");
      let review = null;
      if (i.weeklyReviewId) {
        checklistPermission(s, "operations.summary.review");
        checklistPermission(s, "report.view");
        if (!checklistUuid(i.weeklyReviewId)) reject("INVALID_INPUT");
        review = (
          await c.query(
            `SELECT id,week_from,version,fingerprint FROM bms_operation_weekly_reviews WHERE tenant_id=$1 AND id=$2 AND location_id=$3`,
            [s.tenantId, i.weeklyReviewId, issue.location_id],
          )
        ).rows[0];
        if (!review) reject("NOT_FOUND");
      }
      const target = checklistText(i.target, 2000, true),
        due = teamInstant(i.dueAt);
      // Explicit assignee makes the improvement immediately actionable in the canonical My Work queue.
      if (!checklistUuid(i.assignedTo)) reject("INVALID_ASSIGNEE");
      const evidence = await issueEvidence(c, s, issue.id);
      // Do not recursively embed prior baselines; each improvement freezes only its own decision facts.
      const baseline = {
        ...evidence,
        followups: evidence.followups.map(
          ({ baseline: _prior, ...x }: any) => x,
        ),
      };
      const run = await executeChecklistInTx(
        c,
        s,
        {
          action: "CREATE_RUN",
          confirmed: true,
          idempotencyKey: i.idempotencyKey,
          templateId: i.templateId,
          dueAt: due,
          assignedTo: i.assignedTo,
        },
        { assignmentAt: due },
      );
      await c.query(
        `INSERT INTO bms_operation_improvements(tenant_id,run_id,issue_id,weekly_review_id,target,baseline,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          s.tenantId,
          run.id,
          issue.id,
          review?.id ?? null,
          target,
          JSON.stringify({ issue: baseline, review }),
          s.actorId,
        ],
      );
    } else if (i.action === "CLOSE_ISSUE") {
      if (issue.owner_id === s.actorId) reject("DISTINCT_REVIEWER_REQUIRED");
      checklistText(i.note, 2000, true);
      if (!issue.cause.trim()) reject("OBSERVED_CAUSE_REQUIRED");
      // Canonical transitions lock these same run rows. Never infer verification from the issue label.
      const evidence = await issueEvidence(c, s, issue.id);
      for (const run of [
        ...new Set([
          ...evidence.sources.map((x: any) => x.run_id),
          ...evidence.followups.map((x: any) => x.run_id),
        ]),
      ].sort())
        await lockChecklistRun(c, s, run as string);
      const current = await issueEvidence(c, s, issue.id);
      if (
        !current.sources.length ||
        current.sources.some(
          (x: any) => x.status !== "VERIFIED" || x.run_status === "VOID",
        )
      )
        reject("SOURCE_NOT_VERIFIED");
      const cycle = current.followups.filter(
        (x: any) =>
          Date.parse(x.created_at) >= new Date(issue.reopened_at).getTime(),
      );
      if (
        !cycle.length ||
        cycle.some((x: any) => x.status !== "APPROVED" || !x.reviewed_by)
      )
        reject("RECHECK_NOT_APPROVED");
      await c.query(
        `UPDATE bms_operation_issues SET status='CLOSED' WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, issue.id],
      );
    } else reject("INVALID_INPUT");
  }
  await c.query(
    `UPDATE bms_operation_issues SET version=version+1 WHERE tenant_id=$1 AND id=$2`,
    [s.tenantId, issue.id],
  );
  return {
    status: "OK",
    id: issue.id,
    version: issue.version + 1,
    locationId: issue.location_id,
  };
}
async function link(
  c: PoolClient,
  s: ChecklistScope,
  issue: string,
  action: string,
) {
  const old = (
    await c.query(
      `SELECT issue_id FROM bms_operation_issue_sources WHERE tenant_id=$1 AND action_id=$2`,
      [s.tenantId, action],
    )
  ).rows[0];
  if (old) reject("SOURCE_ALREADY_LINKED");
  await c.query(
    `INSERT INTO bms_operation_issue_sources(tenant_id,issue_id,action_id,linked_by) VALUES($1,$2,$3,$4)`,
    [s.tenantId, issue, action, s.actorId],
  );
}
export async function commandImprovement(
  s: ChecklistScope,
  i: ImprovementCommand,
) {
  try {
    if (!i || !Object.hasOwn(IMPROVEMENT_PERMISSIONS, i.action))
      reject("INVALID_INPUT");
    checklistPermission(s, IMPROVEMENT_PERMISSIONS[i.action]);
    if (i.action === "CREATE_FOLLOWUP")
      checklistPermission(s, "operations.checklist.manage");
    if (i.action === "CREATE_FOLLOWUP" && i.weeklyReviewId) {
      checklistPermission(s, "operations.summary.review");
      checklistPermission(s, "report.view");
    }
    if (i.action === "CONFIRM_WEEK") checklistPermission(s, "report.view");
    if (i.action === "PUBLISH_STANDARD" && i.sourceType === "RECIPE")
      checklistPermission(s, "product.view");
    if (i.confirmed !== true) reject("CONFIRMATION_REQUIRED");
    if (i.action !== "ACK_STANDARD") checklistText(i.note, 2000, true);
    const key = `improvement:${checklistText(i.idempotencyKey, 128, true)}`,
      fingerprint = teamHash(i);
    return await checklistTx(
      s,
      async (c) => {
        // Revalidate the original resource scope before replaying a lost-response result.
        if (i.id) {
          if (!checklistUuid(i.id)) reject("INVALID_INPUT");
          const table = [
            "ACK_STANDARD",
            "ASSESS_STANDARD",
            "RECORD_TRAINING",
          ].includes(i.action)
            ? "bms_operation_standards"
            : "bms_operation_issues";
          const row = (
            await c.query(
              `SELECT location_id FROM ${table} WHERE tenant_id=$1 AND id=$2`,
              [s.tenantId, i.id],
            )
          ).rows[0];
          if (!row) reject("NOT_FOUND");
          await teamBranches(c, s, row.location_id);
        } else if (i.action === "CREATE_ISSUE") await failure(c, s, i.actionId);
        else {
          if (!checklistUuid(i.locationId)) reject("INVALID_INPUT");
          await teamBranches(c, s, i.locationId);
        }
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `${s.tenantId}:${s.actorId}:${key}`,
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
        const result = await execute(c, s, i);
        const details = {
          ...i,
          idempotencyKey: undefined,
          confirmed: undefined,
        };
        await c.query(
          `INSERT INTO bms_operation_improvement_events(tenant_id,location_id,entity_id,action,actor,note,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            s.tenantId,
            result.locationId,
            result.id,
            i.action,
            s.actorId,
            checklistText(i.note, 2000),
            JSON.stringify(details),
          ],
        );
        await c.query(
          `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5::jsonb)`,
          [
            s.tenantId,
            s.actorId,
            `operations.improvement.${i.action.toLowerCase()}`,
            result.id,
            JSON.stringify({
              version: result.version,
              locationId: result.locationId,
              note: i.note ?? "",
            }),
          ],
        );
        await c.query(
          `INSERT INTO bms_operation_commands(tenant_id,actor,key,fingerprint,result) VALUES($1,$2,$3,$4,$5::jsonb)`,
          [s.tenantId, s.actorId, key, fingerprint, JSON.stringify(result)],
        );
        return result;
      },
      { serializable: true },
    );
  } catch (e) {
    if (e instanceof ChecklistError) return { status: e.status };
    if (["40001", "40P01"].includes((e as any)?.code))
      return { status: "RETRY_REQUIRED" };
    if (
      (e as any)?.code === "23505" &&
      (e as any)?.constraint ===
        "bms_operation_issue_sources_tenant_id_action_id_key"
    )
      return { status: "SOURCE_ALREADY_LINKED" };
    throw e;
  }
}
