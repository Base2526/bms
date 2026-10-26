import type { PoolClient } from "pg";
import {
  checklistTx,
  checklistPermission,
  type ChecklistScope,
} from "./operationChecklists";
import {
  checklistUuid,
  checklistText,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import { teamBranches, teamPage, teamHash } from "./operationTeamReads";
import { operationWeek, wasteValue } from "./operationImprovementPolicy";
import { standardReadinessInTx } from "./operationStandards";

// JSON-safe dates are also essential for deterministic fingerprints (Date has no enumerable keys).
export const improvementJson = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export async function improvementForRun(s: ChecklistScope, id: string) {
  checklistPermission(s, "operations.checklist.view");
  if (!checklistUuid(id)) reject("INVALID_INPUT");
  return checklistTx(s, async (c) => {
    const r = (
      await c.query(
        `SELECT location_id FROM bms_operation_runs WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, id],
      )
    ).rows[0];
    if (!r) reject("NOT_FOUND");
    await teamBranches(c, s, r.location_id);
    const row = (
      await c.query(
        `SELECT target,baseline->'issue'->>'title' title,created_at FROM bms_operation_improvements WHERE tenant_id=$1 AND run_id=$2`,
        [s.tenantId, id],
      )
    ).rows[0];
    return row ? improvementJson(row) : null;
  });
}
const manager = (s: ChecklistScope) =>
  s.permissions.has("operations.improvement.manage") ||
  s.permissions.has("operations.checklist.review") ||
  s.permissions.has("operations.summary.review");
export async function improvementWorkspace(
  s: ChecklistScope,
  f: { locationId?: string; search?: string; offset?: number } = {},
) {
  checklistPermission(s, "operations.checklist.view");
  return checklistTx(s, async (c) => {
    const ids = await teamBranches(c, s, f.locationId),
      search = checklistText(f.search, 120),
      offset = teamPage(f.offset);
    const args = [s.tenantId, ids, search, offset];
    const where = `tenant_id=$1 AND location_id=ANY($2::uuid[]) AND ($3='' OR position(lower($3) in lower(title||' '||duty_key))>0)`;
    const standards = (
      await c.query(
        `SELECT * FROM bms_operation_standards WHERE ${where} AND status='ACTIVE' ORDER BY title,id LIMIT 25 OFFSET $4`,
        args,
      )
    ).rows;
    const standardTotal = Number(
      (
        await c.query(
          `SELECT count(*) FROM bms_operation_standards WHERE ${where} AND status='ACTIVE'`,
          args.slice(0, 3),
        )
      ).rows[0].count,
    );
    // Ordinary staff see SOPs and their own learning, not another employee's assessment or issue analysis.
    const issues = manager(s)
      ? (
          await c.query(
            `SELECT i.*,EXISTS(SELECT 1 FROM bms_operation_issue_sources l JOIN bms_operation_actions a ON a.tenant_id=l.tenant_id AND a.id=l.action_id WHERE l.tenant_id=i.tenant_id AND l.issue_id=i.id AND a.status<>'VERIFIED') needs_followup FROM bms_operation_issues i WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) AND ($3='' OR position(lower($3) in lower(title||' '||category))>0) ORDER BY created_at DESC,id LIMIT 25 OFFSET $4`,
            args,
          )
        ).rows
      : [];
    const issueTotal = manager(s)
      ? Number(
          (
            await c.query(
              `SELECT count(*) FROM bms_operation_issues WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) AND ($3='' OR position(lower($3) in lower(title||' '||category))>0)`,
              args.slice(0, 3),
            )
          ).rows[0].count,
        )
      : 0;
    return improvementJson({
      standards,
      standardTotal,
      issues,
      issueTotal,
      actorId: s.actorId,
    });
  });
}
export async function improvementDetail(
  s: ChecklistScope,
  id: string,
  kind: string,
) {
  checklistPermission(s, "operations.checklist.view");
  if (!checklistUuid(id) || !["STANDARD", "ISSUE", "REVIEW"].includes(kind))
    reject("INVALID_INPUT");
  if (kind !== "STANDARD" && !manager(s)) reject("FORBIDDEN");
  if (kind === "REVIEW") {
    checklistPermission(s, "operations.summary.review");
    checklistPermission(s, "report.view");
  }
  return checklistTx(s, async (c) => {
    const table =
      kind === "STANDARD"
        ? "bms_operation_standards"
        : kind === "ISSUE"
          ? "bms_operation_issues"
          : "bms_operation_weekly_reviews";
    const row = (
      await c.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2`, [
        s.tenantId,
        id,
      ])
    ).rows[0];
    if (!row) reject("NOT_FOUND");
    await teamBranches(c, s, row.location_id);
    const history = (
      await c.query(
        `SELECT * FROM bms_operation_improvement_events WHERE tenant_id=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 101`,
        [s.tenantId, id],
      )
    ).rows;
    if (kind === "STANDARD") {
      const privileged =
        s.permissions.has("operations.standard.manage") ||
        s.permissions.has("operations.standard.assess");
      const learning = (
        await c.query(
          `SELECT * FROM bms_operation_learning WHERE tenant_id=$1 AND ((kind='ACK' AND basis_id=$2) OR (kind<>'ACK' AND basis_id=$3)) AND ($4 OR staff_id=$5) ORDER BY id DESC LIMIT 101`,
          [
            s.tenantId,
            row.ack_basis_id,
            row.training_basis_id,
            privileged,
            s.actorId,
          ],
        )
      ).rows;
      const versions = (
        await c.query(
          `SELECT id,version,title,status,created_at FROM bms_operation_standards WHERE tenant_id=$1 AND family_id=$2 ORDER BY version DESC LIMIT 101`,
          [s.tenantId, row.family_id],
        )
      ).rows;
      return improvementJson({
        ...row,
        learning: learning.slice(0, 100),
        versions: versions.slice(0, 100),
        history: privileged ? history.slice(0, 100) : [],
        historyTruncated:
          learning.length > 100 ||
          versions.length > 100 ||
          history.length > 100,
      });
    }
    if (kind === "REVIEW")
      return improvementJson({
        ...row,
        history: history.slice(0, 100),
        historyTruncated: history.length > 100,
      });
    return improvementJson({
      ...(await issueEvidence(c, s, id)),
      history: history.slice(0, 100),
      historyTruncated: history.length > 100,
    });
  });
}
export async function issueEvidence(
  c: PoolClient,
  s: ChecklistScope,
  id: string,
) {
  const issue = (
    await c.query(
      `SELECT * FROM bms_operation_issues WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, id],
    )
  ).rows[0];
  if (!issue) reject("NOT_FOUND");
  const sources = (
    await c.query(
      `SELECT a.*,r.location_id,r.status run_status,r.template_id,r.snapshot,l.created_at linked_at FROM bms_operation_issue_sources l JOIN bms_operation_actions a ON a.tenant_id=l.tenant_id AND a.id=l.action_id JOIN bms_operation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id WHERE l.tenant_id=$1 AND l.issue_id=$2 ORDER BY a.id LIMIT 501`,
      [s.tenantId, id],
    )
  ).rows;
  const followups = (
    await c.query(
      `SELECT i.*,r.status,r.version,r.assigned_to,r.due_at,r.reviewed_at,r.reviewed_by,r.snapshot FROM bms_operation_improvements i JOIN bms_operation_runs r ON r.tenant_id=i.tenant_id AND r.id=i.run_id WHERE i.tenant_id=$1 AND i.issue_id=$2 ORDER BY i.created_at,i.run_id LIMIT 501`,
      [s.tenantId, id],
    )
  ).rows;
  if (sources.length > 500 || followups.length > 500)
    reject("REPORT_TOO_LARGE");
  return improvementJson({ ...issue, sources, followups });
}
export async function operationReadiness(
  s: ChecklistScope,
  location: string,
  staff: string,
  duty?: string,
) {
  checklistPermission(s, "operations.checklist.view");
  return checklistTx(s, (c) =>
    standardReadinessInTx(c, s, location, staff, duty),
  );
}
export async function improvementSources(
  s: ChecklistScope,
  f: { locationId?: string; search?: string; offset?: number } = {},
) {
  checklistPermission(s, "operations.improvement.manage");
  return checklistTx(s, async (c) => {
    const ids = await teamBranches(c, s, f.locationId),
      search = checklistText(f.search, 120),
      offset = teamPage(f.offset);
    const rows = (
      await c.query(
        `SELECT a.id,a.run_id,a.item_key,a.status,r.location_id,r.snapshot->>'name' name FROM bms_operation_actions a JOIN bms_operation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id WHERE a.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND r.status<>'VOID' AND NOT EXISTS(SELECT 1 FROM bms_operation_issue_sources l WHERE l.tenant_id=a.tenant_id AND l.action_id=a.id) AND EXISTS(SELECT 1 FROM bms_operation_results e WHERE e.tenant_id=a.tenant_id AND e.run_id=a.run_id AND e.item_key=a.item_key AND e.outcome='FAIL') AND ($3='' OR position(lower($3) in lower(COALESCE(r.snapshot->>'name','')||' '||a.item_key||' '||a.id::text))>0) ORDER BY a.created_at DESC,a.id LIMIT 26 OFFSET $4`,
        [s.tenantId, ids, search, offset],
      )
    ).rows;
    return { rows: rows.slice(0, 25), hasMore: rows.length > 25 };
  });
}
export async function improvementCatalog(
  s: ChecklistScope,
  kind: string,
  locationId: string,
  search: string = "",
) {
  checklistPermission(s, "operations.checklist.view");
  if (!["CHECKLIST", "FOLLOWUP", "RECIPE"].includes(kind))
    reject("INVALID_INPUT");
  if (kind === "RECIPE") checklistPermission(s, "product.view");
  return checklistTx(s, async (c) => {
    if (!checklistUuid(locationId)) reject("INVALID_INPUT");
    await teamBranches(c, s, locationId);
    const term = checklistText(search, 120);
    const rows =
      kind !== "RECIPE"
        ? (
            await c.query(
              `SELECT id,name,version,status,separate_reviewer FROM bms_operation_templates WHERE tenant_id=$1 AND location_id=$2 AND ${kind === "FOLLOWUP" ? "status='ACTIVE' AND separate_reviewer" : "status<>'DRAFT'"} AND ($3='' OR position(lower($3) in lower(name||' '||id::text))>0) ORDER BY name,version DESC,id LIMIT 51`,
              [s.tenantId, locationId, term],
            )
          ).rows
        : (
            await c.query(
              `SELECT id,product_sku name,version FROM bms_product_recipes WHERE tenant_id=$1 AND ($2='' OR position(lower($2) in lower(product_sku||' '||id::text))>0) ORDER BY product_sku,version DESC,id LIMIT 51`,
              [s.tenantId, term],
            )
          ).rows;
    return { rows: rows.slice(0, 50), hasMore: rows.length > 50 };
  });
}
export async function weeklyFacts(
  c: PoolClient,
  s: ChecklistScope,
  from: string,
  locationId?: string,
) {
  checklistPermission(s, "operations.summary.review");
  checklistPermission(s, "report.view");
  const week = operationWeek(from),
    ids = await teamBranches(c, s, locationId);
  if (ids.length > 200) reject("REPORT_TOO_LARGE");
  const args = [s.tenantId, ids, week.from, week.to];
  const period = (column: string) =>
    `${column}>=($3::date::timestamp AT TIME ZONE 'Asia/Bangkok') AND ${column}<(($4::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok')`;
  const bounded = async (sql: string, params: unknown[] = args) => {
    const rows = (await c.query(`${sql} LIMIT 5001`, params)).rows;
    if (rows.length > 5000) reject("REPORT_TOO_LARGE");
    return improvementJson(rows);
  };
  const clock = (await c.query(`SELECT now() clock`)).rows[0].clock as Date;
  const runs = await bounded(
    `SELECT id,location_id,template_id,snapshot->>'version' template_version,status,due_at,reviewed_at,version FROM bms_operation_runs WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) AND ${period("due_at")} ORDER BY id`,
  );
  const actions = await bounded(
    `SELECT a.id,a.run_id,a.item_key,a.status,a.due_at,a.created_at,a.version,r.location_id,r.status run_status,COALESCE(i.severity,'UNCLASSIFIED') severity,i.id issue_id FROM bms_operation_actions a JOIN bms_operation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id LEFT JOIN bms_operation_issue_sources l ON l.tenant_id=a.tenant_id AND l.action_id=a.id LEFT JOIN bms_operation_issues i ON i.tenant_id=l.tenant_id AND i.id=l.issue_id WHERE a.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND a.status<>'VERIFIED' AND r.status<>'VOID' ORDER BY a.id`,
    args.slice(0, 2),
  );
  const failures = await bounded(
    `SELECT DISTINCT r.location_id,t.family_id,t.version template_version,t.category,a.item_key,a.run_id FROM bms_operation_actions a JOIN bms_operation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id JOIN bms_operation_templates t ON t.tenant_id=r.tenant_id AND t.id=r.template_id WHERE a.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND r.status<>'VOID' AND ${period("r.due_at")} ORDER BY r.location_id,t.family_id,t.version,t.category,a.item_key,a.run_id`,
  );
  const handovers = await bounded(
    `SELECT h.id,h.location_id,h.roster_id,h.status,h.due_at,h.submitted_at,h.received_at,h.version FROM bms_operation_handovers h JOIN bms_operation_rosters r ON r.tenant_id=h.tenant_id AND r.id=h.roster_id WHERE h.tenant_id=$1 AND h.location_id=ANY($2::uuid[]) AND ${period("r.starts_at")} ORDER BY h.id`,
  );
  const production = await bounded(
    `SELECT p.id,p.run_id,p.location_id,p.recipe_id,p.snapshot->>'recipeVersion' recipe_version,p.snapshot->>'baseUnit' base_unit,p.output_sku,p.output_size,p.status,p.planned_qty,p.actual_qty,p.version FROM bms_operation_production p JOIN bms_operation_runs r ON r.tenant_id=p.tenant_id AND r.id=p.run_id WHERE p.tenant_id=$1 AND p.location_id=ANY($2::uuid[]) AND ${period("r.due_at")} ORDER BY p.id`,
  );
  // Summary permission exposes bounded operational evidence, never PO prices or lot balances.
  const quality = await bounded(`SELECT id,location_id,title,status,version,severity,assigned_to,due_at,run_id,created_at FROM bms_operation_quality_cases WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) AND (${period('created_at')} OR status<>'CLOSED') ORDER BY id`);
  const qualityDisposals = await bounded(`SELECT d.id,l.location_id,l.product_sku,l.size,h.base_unit,d.qty,d.movement_id,d.reviewed_at,v.amount::text FROM bms_operation_quality_decisions d JOIN bms_operation_lot_holds h ON h.tenant_id=d.tenant_id AND h.id=d.hold_id JOIN bms_inventory_lots l ON l.tenant_id=h.tenant_id AND l.id=h.lot_id LEFT JOIN bms_inventory_value_entries v ON v.tenant_id=d.tenant_id AND v.movement_id=d.movement_id AND v.kind='WASTAGE' WHERE d.tenant_id=$1 AND l.location_id=ANY($2::uuid[]) AND d.kind='DISPOSE' AND d.status='APPLIED' AND ${period('d.reviewed_at')} ORDER BY d.id`);
  const materials = await bounded(`SELECT p.id,p.location_id,p.title,p.status,p.version,p.from_date::text,p.to_date::text,p.run_id FROM bms_operation_material_plans p WHERE p.tenant_id=$1 AND p.location_id=ANY($2::uuid[]) AND p.from_date<=$4::date AND p.to_date>=$3::date ORDER BY p.id`);
  const receiving = await bounded(`SELECT x.id,p.id plan_id,p.location_id,l.product_sku,l.size,l.base_unit,x.accepted_qty,x.rejected_qty,x.status,x.version,x.run_id,r.status run_status,r.version run_version,x.created_at,x.posted_at FROM bms_operation_material_inspections x JOIN bms_operation_material_links l ON l.tenant_id=x.tenant_id AND l.id=x.link_id JOIN bms_operation_material_plans p ON p.tenant_id=l.tenant_id AND p.id=l.plan_id JOIN bms_operation_runs r ON r.tenant_id=x.tenant_id AND r.id=x.run_id WHERE x.tenant_id=$1 AND p.location_id=ANY($2::uuid[]) AND (${period('x.created_at')} OR ${period('x.posted_at')}) ORDER BY x.id`);
  const waste = await bounded(
    `SELECT w.id,w.production_id,p.location_id,p.output_sku,p.output_size,p.snapshot->>'baseUnit' base_unit,w.qty,w.reason,w.movement_id,v.amount::text FROM bms_operation_production_waste w JOIN bms_operation_production p ON p.tenant_id=w.tenant_id AND p.id=w.production_id LEFT JOIN bms_inventory_value_entries v ON v.tenant_id=w.tenant_id AND v.movement_id=w.movement_id AND v.kind='WASTAGE' WHERE w.tenant_id=$1 AND p.location_id=ANY($2::uuid[]) AND ${period("w.created_at")} ORDER BY w.id`,
  );
  const rosters = await bounded(
    `SELECT id,location_id,duty_key,assigned_to FROM bms_operation_rosters WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) AND status='PUBLISHED' AND ${period("starts_at")} ORDER BY id`,
  );
  // Bulk evidence avoids an N+1 query for each employee/roster.
  const readiness =
    await bounded(`SELECT r.id roster_id,r.location_id,r.assigned_to,r.duty_key,st.id standard_id,st.version,st.training_required,st.ack_basis_id,st.training_basis_id,
 (SELECT a.id::text FROM bms_operation_learning a WHERE a.tenant_id=st.tenant_id AND a.basis_id=st.ack_basis_id AND a.staff_id=r.assigned_to AND a.kind='ACK' ORDER BY a.id DESC LIMIT 1) acknowledgement_id,
 (SELECT a.id::text FROM bms_operation_learning a WHERE a.tenant_id=st.tenant_id AND a.basis_id=st.training_basis_id AND a.staff_id=r.assigned_to AND a.kind='TRAINED' ORDER BY a.id DESC LIMIT 1) training_id,
 (SELECT a.id::text FROM bms_operation_learning a WHERE a.tenant_id=st.tenant_id AND a.basis_id=st.training_basis_id AND a.staff_id=r.assigned_to AND a.kind IN ('PASS','PRACTICE') ORDER BY a.id DESC LIMIT 1) assessment_id,
 EXISTS(SELECT 1 FROM bms_operation_learning a WHERE a.tenant_id=st.tenant_id AND a.basis_id=st.ack_basis_id AND a.staff_id=r.assigned_to AND a.kind='ACK') acknowledged,
 EXISTS(SELECT 1 FROM bms_operation_learning a WHERE a.tenant_id=st.tenant_id AND a.basis_id=st.training_basis_id AND a.staff_id=r.assigned_to AND a.kind='TRAINED') trained,
 (SELECT a.kind FROM bms_operation_learning a WHERE a.tenant_id=st.tenant_id AND a.basis_id=st.training_basis_id AND a.staff_id=r.assigned_to AND a.kind IN ('PASS','PRACTICE') ORDER BY a.id DESC LIMIT 1) assessment
 FROM bms_operation_rosters r LEFT JOIN bms_operation_standards st ON st.tenant_id=r.tenant_id AND st.location_id=r.location_id AND st.duty_key=r.duty_key AND st.status='ACTIVE' WHERE r.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND r.status='PUBLISHED' AND ${period("r.starts_at")} ORDER BY r.id,st.id`);
  const issues = await bounded(
    `SELECT id,location_id,title,category,severity,owner_id,status,version,reopened_at FROM bms_operation_issues WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) ORDER BY id`,
    args.slice(0, 2),
  );
  const branches = ids.map((id) => {
    const own = (rows: any[]) => rows.filter((x) => x.location_id === id),
      rr = own(runs),
      due = rr.filter(
        (x) => x.status !== "VOID" && Date.parse(x.due_at) <= clock.getTime(),
      );
    const onTime = due.filter(
      (x) =>
        x.status === "APPROVED" &&
        x.reviewed_at &&
        Date.parse(x.reviewed_at) <= Date.parse(x.due_at),
    ).length;
    const hh = own(handovers),
      ww = own(waste);
    const groups = new Map<string, any>();
    for (const p of own(production).filter((x) => x.status === "POSTED")) {
      const key = JSON.stringify([
        p.recipe_id,
        p.recipe_version,
        p.output_sku,
        p.output_size,
        p.base_unit,
      ]);
      const g = groups.get(key) ?? {
        recipeId: p.recipe_id,
        recipeVersion: p.recipe_version,
        sku: p.output_sku,
        size: p.output_size,
        unit: p.base_unit,
        planned: 0,
        actual: 0,
        productionIds: [],
      };
      g.planned += p.planned_qty;
      g.actual += p.actual_qty;
      g.productionIds.push(p.id);
      groups.set(key, g);
    }
    const repeat = new Map<string, any>();
    for (const f of own(failures)) {
      const key = JSON.stringify([
        f.family_id,
        f.template_version,
        f.category,
        f.item_key,
      ]);
      const g = repeat.get(key) ?? {
        familyId: f.family_id,
        version: f.template_version,
        category: f.category,
        itemKey: f.item_key,
        runIds: [],
      };
      g.runIds.push(f.run_id);
      repeat.set(key, g);
    }
    return {
      locationId: id,
      due: due.length,
      onTime,
      onTimePercent: due.length ? (onTime / due.length) * 100 : null,
      cancelled: rr.filter((x) => x.status === "VOID").length,
      future: rr.filter(
        (x) => x.status !== "VOID" && Date.parse(x.due_at) > clock.getTime(),
      ).length,
      backlog: own(actions).map((x) => ({
        ...x,
        ageDays: Math.max(
          0,
          Math.floor((clock.getTime() - Date.parse(x.created_at)) / 86400000),
        ),
      })),
      repeats: [...repeat.values()].filter((x) => x.runIds.length > 1),
      yields: [...groups.values()],
      wasteValue: wasteValue(ww),
      handover: {
        missing: own(rosters).filter(
          (x) =>
            !hh.some((h) => h.roster_id === x.id && h.status !== "CANCELLED"),
        ).length,
        onTime: hh.filter(
          (x) =>
            x.status === "RECEIVED" &&
            Date.parse(x.received_at) <= Date.parse(x.due_at),
        ).length,
        late: hh.filter(
          (x) =>
            x.status === "RECEIVED" &&
            Date.parse(x.received_at) > Date.parse(x.due_at),
        ).length,
        waiting: hh.filter((x) => ["DRAFT", "SUBMITTED"].includes(x.status))
          .length,
        cancelled: hh.filter((x) => x.status === "CANCELLED").length,
      },
      sources: {
        runs: rr,
        handovers: hh,
        production: own(production),
        materials: own(materials),
        quality: own(quality),
        qualityDisposals: own(qualityDisposals),
        receiving: own(receiving),
        waste: ww,
        rosters: own(rosters),
        readiness: own(readiness),
        issues: own(issues),
      },
    };
  });
  const facts = { week, branches };
  return { ...facts, asOf: clock.toISOString(), fingerprint: teamHash(facts) };
}
export async function operationWeeklyReport(
  s: ChecklistScope,
  from: string,
  locationId?: string,
) {
  return checklistTx(
    s,
    async (c) => {
      const report = await weeklyFacts(c, s, from, locationId);
      const reviews = (
        await c.query(
          `SELECT DISTINCT ON(location_id) id,location_id,version,fingerprint,created_at FROM bms_operation_weekly_reviews WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) AND week_from=$3::date ORDER BY location_id,version DESC`,
          [
            s.tenantId,
            report.branches.map((x) => x.locationId),
            report.week.from,
          ],
        )
      ).rows;
      return improvementJson({
        ...report,
        reviews: reviews.map((x) => ({
          ...x,
          changed:
            x.fingerprint !==
            teamHash({
              week: report.week,
              branches: report.branches.filter(
                (b) => b.locationId === x.location_id,
              ),
            }),
        })),
      });
    },
    { serializable: true },
  );
}
