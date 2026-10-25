import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { query, getClient } from "../apps/web/lib/db.ts";
import { renderReadinessSql } from "./schemaReadiness.mts";
import { BMS_PERMISSIONS } from "../apps/web/lib/bms/permissions.ts";
import {
  commandChecklist,
  checklistTx,
} from "../apps/web/lib/bms/operationChecklists.ts";
import { commandImprovement } from "../apps/web/lib/bms/operationImprovement.ts";
import {
  improvementWorkspace,
  improvementDetail,
  improvementSources,
  improvementCatalog,
  improvementForRun,
  operationReadiness,
  operationWeeklyReport,
} from "../apps/web/lib/bms/operationImprovementReads.ts";
import { IMPROVEMENT_PERMISSIONS } from "../apps/web/lib/bms/operationImprovementPolicy.ts";
import { bmsOperationImprovementResolvers as gql } from "../apps/web/graphql/bmsOperationImprovement.ts";
import {
  assertCostingTestDatabase,
  withCostingFixture,
  withAuditFailure,
} from "./testing/restaurantCostingFixture.mts";
const migration = readFileSync(
  new URL(
    "../db/migrations/10.94__bms_operation_improvement.sql",
    import.meta.url,
  ),
  "utf8",
);
test.before(async () => {
  await assertCostingTestDatabase();
  await query(migration);
  await query(
    readFileSync(
      new URL(
        "../db/migrations/10.95__bms_operation_training_evidence.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
type Base = Parameters<Parameters<typeof withCostingFixture>[0]>[0];
test("readiness detects an old training constraint, not just the existing learning table", async () => {
  const c = await getClient();
  try {
    await c.query("BEGIN");
    await c.query(
      `ALTER TABLE bms_operation_learning DROP CONSTRAINT bms_operation_learning_kind_check`,
    );
    await c.query(
      `ALTER TABLE bms_operation_learning ADD CONSTRAINT bms_operation_learning_kind_check CHECK(kind IN ('ACK','PASS','PRACTICE')) NOT VALID`,
    );
    await c.query(renderReadinessSql());
    assert.equal(
      (
        await c.query(
          `SELECT ok FROM bms_schema_readiness WHERE migration='10.95__bms_operation_training_evidence.sql'`,
        )
      ).rows[0].ok,
      false,
    );
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
  const good = await getClient();
  try {
    await good.query("BEGIN");
    await good.query(renderReadinessSql());
    assert.equal(
      (
        await good.query(
          `SELECT ok FROM bms_schema_readiness WHERE migration='10.95__bms_operation_training_evidence.sql'`,
        )
      ).rows[0].ok,
      true,
    );
  } finally {
    await good.query("ROLLBACK");
    good.release();
  }
});
test("source catalog is branch scoped and training evidence cannot be self-certified", async () =>
  fixture(async (f) => {
    const p = await f.publish();
    assert.equal(
      (
        await f.cmd({
          action: "RECORD_TRAINING",
          id: p.id,
          version: 1,
          staffId: f.actor,
        })
      ).status,
      "SEPARATE_ASSESSOR_REQUIRED",
    );
    assert.equal(
      (await improvementCatalog(f.s, "CHECKLIST", f.location, "FAKE")).rows
        .length,
      1,
    );
    assert.equal(
      (await improvementCatalog(f.s, "CHECKLIST", f.locations[1], "FAKE")).rows
        .length,
      0,
    );
    await assert.rejects(
      improvementCatalog(
        { ...f.s, permissions: new Set(["operations.checklist.view"]) },
        "RECIPE",
        f.location,
      ),
      /FORBIDDEN/,
    );
    await query(
      readFileSync(
        new URL(
          "../db/migrations/10.95__bms_operation_training_evidence.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(
      (
        await f.cmd(
          { action: "RECORD_TRAINING", id: p.id, version: 1, staffId: f.actor },
          f.reviewer,
        )
      ).status,
      "OK",
    );
    assert.equal(
      (await operationReadiness(f.s, f.location, f.actor, "kitchen")).ready,
      false,
    );
  }));
test("weekly handover uses roster cohort and separates no handover, late, timely, waiting and cancelled", async () =>
  fixture(async (f) => {
    for (let n = 0; n < 5; n++) {
      const roster = (
        await query(
          `INSERT INTO bms_operation_rosters(tenant_id,location_id,duty_key,duty_name,assigned_to,starts_at,ends_at,status,created_by) VALUES($1,$2,'kitchen','FAKE kitchen',$3,($4::date::timestamp AT TIME ZONE 'Asia/Bangkok'),($4::date::timestamp AT TIME ZONE 'Asia/Bangkok')+interval '8 hours','PUBLISHED',$3) RETURNING id`,
          [f.tenant, f.location, f.actor, f.week],
        )
      ).rows[0];
      if (n)
        await query(
          `INSERT INTO bms_operation_handovers(tenant_id,location_id,roster_id,sender,recipient,due_at,status,received_at) VALUES($1,$2,$3,$4,$5,now(),$6,CASE WHEN $6='RECEIVED' THEN now()+($7*interval '1 hour') ELSE NULL END)`,
          [
            f.tenant,
            f.location,
            roster.id,
            f.actor,
            f.approver,
            n < 3 ? "RECEIVED" : n === 3 ? "SUBMITTED" : "CANCELLED",
            n === 1 ? -1 : 1,
          ],
        );
    }
    const b = (await operationWeeklyReport(f.s, f.week, f.location))
      .branches[0];
    assert.deepEqual(b.handover, {
      missing: 2,
      onTime: 1,
      late: 1,
      waiting: 1,
      cancelled: 1,
    });
    assert.equal(b.sources.readiness.length, 5);
    assert.ok(b.sources.readiness.every((x: any) => x.standard_id === null));
  }));
async function fixture(
  work: (
    f: Base & {
      s: any;
      reviewer: any;
      template: string;
      week: string;
      cmd: (a: any, scope?: any) => Promise<any>;
      check: (a: any, scope?: any) => Promise<any>;
      publish: (a?: any) => Promise<any>;
      fail: () => Promise<any>;
      issue: (a?: any) => Promise<any>;
    },
  ) => Promise<void>,
) {
  await withCostingFixture(async (f) => {
    try {
      const s = {
          tenantId: f.tenant,
          actorId: f.actor,
          permissions: new Set(BMS_PERMISSIONS),
        },
        reviewer = { ...s, actorId: f.approver };
      const cmd = (a: any, scope = s) =>
        commandImprovement(scope, {
          idempotencyKey: randomUUID(),
          confirmed: true,
          note: "FAKE evidence",
          ...a,
        } as any) as Promise<any>;
      const check = (a: any, scope = s) =>
        commandChecklist(scope, {
          idempotencyKey: randomUUID(),
          confirmed: true,
          ...a,
        } as any) as Promise<any>;
      const t = await check({
        action: "SAVE_TEMPLATE",
        locationId: f.location,
        name: "FAKE safety check",
        category: "SAFETY",
        separateReviewer: true,
        items: [
          {
            key: "temperature",
            label: "Temperature",
            type: "PASS_FAIL",
            required: true,
            photoRequired: false,
            allowNa: false,
            instruction: "FAKE fix",
            choices: [],
          },
        ],
      });
      assert.equal(t.status, "OK");
      assert.equal(
        (await check({ action: "PUBLISH", id: t.id, version: 1 })).status,
        "OK",
      );
      const week = (
        await query(
          `SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') d`,
        )
      ).rows[0].d;
      const publish = (a: any = {}) =>
        cmd({
          action: "PUBLISH_STANDARD",
          locationId: f.location,
          version: 0,
          dutyKey: "kitchen",
          title: "FAKE safe prep",
          body: "FAKE instructions",
          sourceType: "CHECKLIST",
          sourceId: t.id,
          trainingRequired: true,
          carryAcknowledgement: false,
          carryTraining: false,
          ...a,
        });
      const fail = async () => {
        const r = await check({
          action: "CREATE_RUN",
          templateId: t.id,
          assignedTo: f.actor,
          dueAt: new Date().toISOString(),
        });
        assert.equal(r.status, "OK");
        assert.equal(
          (
            await check({
              action: "RECORD",
              id: r.id,
              version: 1,
              itemKey: "temperature",
              value: "FAIL",
              note: "FAKE observed failure",
            })
          ).status,
          "OK",
        );
        return (
          await query(
            `SELECT * FROM bms_operation_actions WHERE tenant_id=$1 AND run_id=$2`,
            [f.tenant, r.id],
          )
        ).rows[0];
      };
      const issue = async (a: any = {}) =>
        cmd({
          action: "CREATE_ISSUE",
          actionId: (await fail()).id,
          title: "FAKE repeated issue",
          category: "cold-chain",
          severity: "HIGH",
          ownerId: f.actor,
          hypothesis: "FAKE hypothesis",
          cause: "FAKE observed cause",
          ...a,
        });
      await work({
        ...f,
        s,
        reviewer,
        template: t.id,
        week,
        cmd,
        check,
        publish,
        fail,
        issue,
      });
    } finally {
      for (const table of [
        "bms_operation_improvement_events",
        "bms_operation_improvements",
        "bms_operation_weekly_reviews",
        "bms_operation_issue_sources",
        "bms_operation_issues",
        "bms_operation_learning",
        "bms_operation_standards",
        "bms_operation_team_notices",
        "bms_operation_team_events",
        "bms_operation_handovers",
        "bms_operation_rosters",
        "bms_operation_notices",
        "bms_operation_escalations",
        "bms_operation_policies",
        "bms_operation_events",
        "bms_operation_results",
        "bms_operation_actions",
        "bms_operation_runs",
        "bms_operation_templates",
        "bms_operation_commands",
      ])
        await query(`DELETE FROM ${table} WHERE tenant_id=$1`, [f.tenant]);
    }
  });
}
test("F schema reruns without resetting evidence, enforces RLS and append-only grants", async () =>
  fixture(async (f) => {
    const p = await f.publish();
    assert.equal(p.status, "OK");
    await query(migration);
    await query(migration);
    assert.equal((await improvementWorkspace(f.s)).standardTotal, 1);
    const tables = [
      "bms_operation_standards",
      "bms_operation_learning",
      "bms_operation_issues",
      "bms_operation_issue_sources",
      "bms_operation_weekly_reviews",
      "bms_operation_improvements",
      "bms_operation_improvement_events",
    ];
    const rows = (
      await query(
        `SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])`,
        [tables],
      )
    ).rows;
    assert.equal(rows.length, 7);
    assert.ok(rows.every((x) => x.relrowsecurity && x.relforcerowsecurity));
    await assert.rejects(
      checklistTx(f.s, (c) =>
        c.query(
          `UPDATE bms_operation_standards SET body='changed' WHERE tenant_id=$1`,
          [f.tenant],
        ),
      ),
      /permission denied/,
    );
    await assert.rejects(
      checklistTx(f.s, (c) =>
        c.query(`DELETE FROM bms_operation_learning WHERE tenant_id=$1`, [
          f.tenant,
        ]),
      ),
      /permission denied/,
    );
    assert.equal(
      (
        await checklistTx({ ...f.s, tenantId: randomUUID() }, (c) =>
          c.query(`SELECT id FROM bms_operation_standards WHERE id=$1`, [p.id]),
        )
      ).rowCount,
      0,
    );
    await assert.rejects(
      checklistTx({ ...f.s, tenantId: randomUUID() }, (c) =>
        c.query(
          `UPDATE bms_operation_standards SET status='RETIRED' WHERE id=$1 RETURNING id`,
          [p.id],
        ),
      ).then((r) => {
        assert.equal(r.rowCount, 1);
      }),
      /0 !== 1/,
    );
  }));
test("all commands require their server permission and explicit confirmation", async () =>
  fixture(async (f) => {
    for (const [action, permission] of Object.entries(
      IMPROVEMENT_PERMISSIONS,
    )) {
      const permissions = new Set(BMS_PERMISSIONS);
      permissions.delete(permission as any);
      assert.equal(
        (await f.cmd({ action }, { ...f.s, permissions })).status,
        "FORBIDDEN",
        action,
      );
      assert.equal(
        (await f.cmd({ action, confirmed: false })).status,
        "CONFIRMATION_REQUIRED",
        action,
      );
    }
    assert.equal((await f.cmd({ action: "UNKNOWN" })).status, "INVALID_INPUT");
    await assert.rejects(
      gql.Query.bmsImprovementWorkspace(null, { filter: {} }, {}),
      /UNAUTHENTICATED|Unauthorized|Unauthorized access|Authentication|unauthorized|ไม่ได้เข้าสู่ระบบ/i,
    );
  }));
test("SOP ack is self-only and distinct from trainer evidence; new versions invalidate by default", async () =>
  fixture(async (f) => {
    const p = await f.publish();
    assert.equal(p.status, "OK");
    let ready = await operationReadiness(f.s, f.location, f.actor, "kitchen");
    assert.equal(ready.ready, false);
    assert.equal(
      (
        await f.cmd({
          action: "ACK_STANDARD",
          id: p.id,
          version: 1,
          staffId: f.approver,
        })
      ).status,
      "OK",
    );
    ready = await operationReadiness(f.s, f.location, f.actor, "kitchen");
    assert.equal(ready.standards[0].acknowledged, true);
    assert.equal(ready.ready, false);
    assert.equal(
      (
        await f.cmd({
          action: "ASSESS_STANDARD",
          id: p.id,
          version: 1,
          staffId: f.actor,
          outcome: "PASS",
        })
      ).status,
      "SEPARATE_ASSESSOR_REQUIRED",
    );
    assert.equal(
      (
        await f.cmd(
          {
            action: "ASSESS_STANDARD",
            id: p.id,
            version: 1,
            staffId: f.actor,
            outcome: "PASS",
          },
          f.reviewer,
        )
      ).status,
      "OK",
    );
    assert.equal(
      (await operationReadiness(f.s, f.location, f.actor, "kitchen")).ready,
      false,
      "passing assessment does not invent training evidence",
    );
    assert.equal(
      (
        await f.cmd(
          { action: "RECORD_TRAINING", id: p.id, version: 1, staffId: f.actor },
          f.reviewer,
        )
      ).status,
      "OK",
    );
    assert.equal(
      (await operationReadiness(f.s, f.location, f.actor, "kitchen")).ready,
      true,
    );
    const d = await improvementDetail(f.s, p.id, "STANDARD");
    const p2 = await f.publish({ familyId: d.family_id, version: 1 });
    assert.equal(p2.status, "OK");
    assert.equal(
      (await operationReadiness(f.s, f.location, f.actor, "kitchen")).ready,
      false,
    );
    assert.equal(
      (await f.cmd({ action: "ACK_STANDARD", id: p.id, version: 1 })).status,
      "STALE_VERSION",
    );
    assert.equal(
      (await improvementDetail(f.s, p.id, "STANDARD")).learning.length,
      3,
    );
    assert.equal(
      (await operationReadiness(f.s, f.location, f.actor, "unknown"))
        .configured,
      false,
    );
  }));
test("explicit carry retains basis, later PRACTICE revokes readiness, and learning visibility is self-scoped", async () =>
  fixture(async (f) => {
    const p = await f.publish();
    await f.cmd({ action: "ACK_STANDARD", id: p.id, version: 1 });
    await f.cmd(
      { action: "RECORD_TRAINING", id: p.id, version: 1, staffId: f.actor },
      f.reviewer,
    );
    await f.cmd(
      {
        action: "ASSESS_STANDARD",
        id: p.id,
        version: 1,
        staffId: f.actor,
        outcome: "PASS",
      },
      f.reviewer,
    );
    const d = await improvementDetail(f.s, p.id, "STANDARD"),
      p2 = await f.publish({
        familyId: d.family_id,
        version: 1,
        carryAcknowledgement: true,
        carryTraining: true,
      });
    assert.equal(p2.status, "OK");
    assert.equal(
      (await operationReadiness(f.s, f.location, f.actor, "kitchen")).ready,
      true,
    );
    await f.cmd(
      {
        action: "ASSESS_STANDARD",
        id: p2.id,
        version: 2,
        staffId: f.actor,
        outcome: "PRACTICE",
      },
      f.reviewer,
    );
    assert.equal(
      (await operationReadiness(f.s, f.location, f.actor, "kitchen")).ready,
      false,
    );
    const own = {
      ...f.reviewer,
      permissions: new Set(["operations.checklist.view"]),
    };
    assert.equal(
      (await improvementDetail(own, p2.id, "STANDARD")).learning.length,
      0,
    );
    await assert.rejects(
      operationReadiness(own, f.location, f.actor, "kitchen"),
      /FORBIDDEN/,
    );
    await assert.rejects(
      operationReadiness(f.s, f.location, randomUUID(), "kitchen"),
      /INVALID_ASSIGNEE/,
    );
  }));
test("partial SOP carry never displays reset evidence from the other learning basis", async () =>
  fixture(async (f) => {
    for (const carryAcknowledgement of [true, false]) {
      const p = await f.publish();
      await f.cmd({ action: "ACK_STANDARD", id: p.id, version: 1 });
      await f.cmd(
        { action: "RECORD_TRAINING", id: p.id, version: 1, staffId: f.actor },
        f.reviewer,
      );
      await f.cmd(
        {
          action: "ASSESS_STANDARD",
          id: p.id,
          version: 1,
          staffId: f.actor,
          outcome: "PASS",
        },
        f.reviewer,
      );
      const d = await improvementDetail(f.s, p.id, "STANDARD");
      const next = await f.publish({
        familyId: d.family_id,
        version: 1,
        carryAcknowledgement,
        carryTraining: !carryAcknowledgement,
      });
      assert.equal(next.status, "OK");
      const current = await improvementDetail(f.s, next.id, "STANDARD");
      assert.deepEqual(
        current.learning.map((x: any) => x.kind).sort(),
        carryAcknowledgement ? ["ACK"] : ["PASS", "TRAINED"],
      );
      assert.equal(
        (await improvementDetail(f.s, p.id, "STANDARD")).learning.length,
        3,
      );
    }
  }));
test("followup catalog filters eligibility before its bounded page, including many retired versions", async () =>
  fixture(async (f) => {
    await query(
      `INSERT INTO bms_operation_templates(tenant_id,family_id,version,location_id,name,category,status,separate_reviewer,items,created_by)
      SELECT tenant_id,gen_random_uuid(),1,location_id,'AAA FAKE retired '||n,category,'RETIRED',true,items,created_by FROM bms_operation_templates CROSS JOIN generate_series(1,55) n WHERE tenant_id=$1 AND id=$2`,
      [f.tenant, f.template],
    );
    const followups = await improvementCatalog(
      f.s,
      "FOLLOWUP",
      f.location,
      "FAKE",
    );
    assert.deepEqual(
      followups.rows.map((x: any) => x.id),
      [f.template],
    );
    assert.equal(followups.hasMore, false);
    const pinned = await improvementCatalog(
      f.s,
      "CHECKLIST",
      f.location,
      "AAA",
    );
    assert.equal(pinned.rows.length, 50);
    assert.equal(
      pinned.hasMore,
      true,
      "SOP may still pin a retired published version",
    );
  }));
test("weekly readiness pins exact learning evidence and detects a new assessment even with the same verdict", async () =>
  fixture(async (f) => {
    const p = await f.publish();
    await f.cmd({ action: "ACK_STANDARD", id: p.id, version: 1 });
    await f.cmd(
      { action: "RECORD_TRAINING", id: p.id, version: 1, staffId: f.actor },
      f.reviewer,
    );
    await f.cmd(
      {
        action: "ASSESS_STANDARD",
        id: p.id,
        version: 1,
        staffId: f.actor,
        outcome: "PASS",
      },
      f.reviewer,
    );
    await query(
      `INSERT INTO bms_operation_rosters(tenant_id,location_id,duty_key,duty_name,assigned_to,starts_at,ends_at,status,created_by) VALUES($1,$2,'kitchen','FAKE kitchen',$3,($4::date::timestamp AT TIME ZONE 'Asia/Bangkok'),($4::date::timestamp AT TIME ZONE 'Asia/Bangkok')+interval '8 hours','PUBLISHED',$3)`,
      [f.tenant, f.location, f.actor, f.week],
    );
    const before = await operationWeeklyReport(f.s, f.week, f.location);
    const facts = before.branches[0].sources.readiness[0];
    assert.ok(
      facts.acknowledgement_id && facts.training_id && facts.assessment_id,
    );
    const confirmed = await f.cmd({
      action: "CONFIRM_WEEK",
      locationId: f.location,
      from: f.week,
      version: 0,
      fingerprint: before.fingerprint,
    });
    assert.equal(confirmed.status, "OK");
    await f.cmd(
      {
        action: "ASSESS_STANDARD",
        id: p.id,
        version: 1,
        staffId: f.actor,
        outcome: "PASS",
        note: "FAKE new assessment evidence",
      },
      f.reviewer,
    );
    const after = await operationWeeklyReport(f.s, f.week, f.location);
    assert.notEqual(after.fingerprint, before.fingerprint);
    assert.equal(after.reviews[0].changed, true);
    assert.notEqual(
      after.branches[0].sources.readiness[0].assessment_id,
      facts.assessment_id,
    );
    const saved = await improvementDetail(f.s, confirmed.id, "REVIEW");
    assert.equal(
      saved.snapshot.branches[0].sources.readiness[0].assessment_id,
      facts.assessment_id,
    );
  }));
test("SOP publication rejects stale family scope, duplicate idempotency and rolls back audit failures", async () =>
  fixture(async (f) => {
    const key = randomUUID(),
      p = await f.publish({ idempotencyKey: key });
    assert.equal((await f.publish({ idempotencyKey: key })).id, p.id);
    assert.equal(
      (await f.publish({ idempotencyKey: key, title: "changed" })).status,
      "IDEMPOTENCY_CONFLICT",
    );
    const d = await improvementDetail(f.s, p.id, "STANDARD");
    assert.equal(
      (await f.publish({ familyId: d.family_id, version: 0 })).status,
      "STALE_VERSION",
    );
    assert.equal(
      (await f.publish({ familyId: d.family_id, version: 1, dutyKey: "other" }))
        .status,
      "STANDARD_SCOPE_CHANGED",
    );
    await withAuditFailure(
      f.tenant,
      "operations.improvement.publish_standard",
      async () =>
        assert.rejects(
          f.publish({ familyId: d.family_id, version: 1 }),
          /TEST_COST_AUDIT_FAILURE/,
        ),
    );
    assert.equal(
      (await improvementDetail(f.s, p.id, "STANDARD")).status,
      "ACTIVE",
    );
    assert.equal((await improvementWorkspace(f.s)).standardTotal, 1);
  }));
test("concurrent publication has one active family version and retry safely converges", async () =>
  fixture(async (f) => {
    const p = await f.publish(),
      d = await improvementDetail(f.s, p.id, "STANDARD");
    const results = await Promise.all([
      f.publish({ familyId: d.family_id, version: 1 }),
      f.publish({ familyId: d.family_id, version: 1 }),
    ]);
    assert.equal(results.filter((x) => x.status === "OK").length, 1);
    assert.ok(
      results.some((x) =>
        ["STALE_VERSION", "RETRY_REQUIRED"].includes(x.status),
      ),
    );
    assert.equal((await improvementWorkspace(f.s)).standardTotal, 1);
  }));
test("issue sources are real, unique failures and branch scope is checked on reads and replay", async () =>
  fixture(async (f) => {
    assert.equal(
      (await f.cmd({ action: "CREATE_ISSUE", actionId: randomUUID() })).status,
      "NOT_FOUND",
    );
    const source = await f.fail(),
      key = randomUUID();
    const input = {
      action: "CREATE_ISSUE",
      actionId: source.id,
      title: "FAKE issue",
      category: "safety",
      severity: "CRITICAL",
      ownerId: f.actor,
      idempotencyKey: key,
    };
    const i = await f.cmd(input);
    assert.equal(i.status, "OK");
    assert.equal((await f.cmd(input)).id, i.id);
    assert.equal(
      (await f.cmd({ ...input, idempotencyKey: randomUUID() })).status,
      "SOURCE_ALREADY_LINKED",
    );
    assert.equal((await improvementSources(f.s)).rows.length, 0);
    await query(
      `INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,
      [f.tenant, f.actor, f.locations[1]],
    );
    assert.equal((await f.cmd(input)).status, "NOT_FOUND");
    await assert.rejects(improvementDetail(f.s, i.id, "ISSUE"), /NOT_FOUND/);
    assert.equal((await improvementWorkspace(f.s)).issueTotal, 0);
  }));
test("issue closure requires verified sources, separate owner and an approved canonical recheck", async () =>
  fixture(async (f) => {
    const i = await f.issue();
    assert.equal(i.status, "OK");
    assert.equal(
      (await f.cmd({ action: "CLOSE_ISSUE", id: i.id, version: 1 })).status,
      "DISTINCT_REVIEWER_REQUIRED",
    );
    assert.equal(
      (await f.cmd({ action: "CLOSE_ISSUE", id: i.id, version: 1 }, f.reviewer))
        .status,
      "SOURCE_NOT_VERIFIED",
    );
    let d = await improvementDetail(f.s, i.id, "ISSUE"),
      a = d.sources[0];
    assert.equal(
      (
        await f.check({
          action: "ACTION_RESOLVE",
          id: a.id,
          version: a.version,
          note: "FAKE fixed",
        })
      ).status,
      "OK",
    );
    assert.equal(
      (
        await f.check(
          { action: "ACTION_VERIFY", id: a.id, version: a.version + 1 },
          f.reviewer,
        )
      ).status,
      "OK",
    );
    assert.equal(
      (await f.cmd({ action: "CLOSE_ISSUE", id: i.id, version: 1 }, f.reviewer))
        .status,
      "RECHECK_NOT_APPROVED",
    );
    const fup = await f.cmd({
      action: "CREATE_FOLLOWUP",
      id: i.id,
      version: 1,
      templateId: f.template,
      assignedTo: f.actor,
      dueAt: new Date().toISOString(),
      target: "FAKE keep temperature correct",
    });
    assert.equal(fup.status, "OK");
    d = await improvementDetail(f.s, i.id, "ISSUE");
    const run = d.followups[0];
    const brief = await improvementForRun(
      { ...f.s, permissions: new Set(["operations.checklist.view"]) },
      run.run_id,
    );
    assert.equal(brief.target, "FAKE keep temperature correct");
    assert.equal(brief.hypothesis, undefined);
    assert.equal(run.status, "OPEN");
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_operation_notices WHERE tenant_id=$1 AND run_id=$2`,
          [f.tenant, run.run_id],
        )
      ).rows[0].count,
      "1",
    );
    assert.equal(
      (await f.cmd({ action: "CLOSE_ISSUE", id: i.id, version: 2 }, f.reviewer))
        .status,
      "RECHECK_NOT_APPROVED",
    );
    for (const input of [
      { action: "RECORD", version: 1, itemKey: "temperature", value: "PASS" },
      { action: "SUBMIT", version: 2 },
    ])
      assert.equal((await f.check({ id: run.run_id, ...input })).status, "OK");
    assert.equal(
      (
        await f.check(
          { action: "APPROVE", id: run.run_id, version: 3 },
          f.reviewer,
        )
      ).status,
      "OK",
    );
    assert.equal(
      (await f.cmd({ action: "CLOSE_ISSUE", id: i.id, version: 2 }, f.reviewer))
        .status,
      "OK",
    );
    assert.equal(
      (await improvementDetail(f.s, i.id, "ISSUE")).status,
      "CLOSED",
    );
    assert.equal(
      (await f.cmd({ action: "REOPEN_ISSUE", id: i.id, version: 3 })).status,
      "OK",
    );
    assert.equal(
      (await f.cmd({ action: "CLOSE_ISSUE", id: i.id, version: 4 }, f.reviewer))
        .status,
      "RECHECK_NOT_APPROVED",
    );
    assert.equal(
      (await improvementDetail(f.s, i.id, "ISSUE")).followups.length,
      1,
    );
  }));
test("followup audit rollback leaves no duplicate work, notices or baseline", async () =>
  fixture(async (f) => {
    const i = await f.issue();
    const before = (
      await query(
        `SELECT count(*) FROM bms_operation_runs WHERE tenant_id=$1`,
        [f.tenant],
      )
    ).rows[0].count;
    await withAuditFailure(
      f.tenant,
      "operations.improvement.create_followup",
      async () =>
        assert.rejects(
          f.cmd({
            action: "CREATE_FOLLOWUP",
            id: i.id,
            version: 1,
            templateId: f.template,
            assignedTo: f.actor,
            dueAt: new Date().toISOString(),
            target: "FAKE improve",
          }),
          /TEST_COST_AUDIT_FAILURE/,
        ),
    );
    assert.equal(
      (
        await query(
          `SELECT count(*) FROM bms_operation_runs WHERE tenant_id=$1`,
          [f.tenant],
        )
      ).rows[0].count,
      before,
    );
    assert.equal(
      (await improvementDetail(f.s, i.id, "ISSUE")).followups.length,
      0,
    );
  }));
test("weekly report uses stable distinct-run repeats, due denominators, excludes void and shows current backlog", async () =>
  fixture(async (f) => {
    await f.fail();
    await f.fail();
    const r1 = await operationWeeklyReport(f.s, f.week, f.location);
    assert.equal(r1.branches[0].due, 2);
    assert.equal(r1.branches[0].repeats[0].runIds.length, 2);
    assert.equal(r1.branches[0].backlog.length, 2);
    const run = r1.branches[0].sources.runs[0];
    await f.check({
      action: "RECORD",
      id: run.id,
      version: run.version,
      itemKey: "temperature",
      value: "FAIL",
      note: "FAKE repeated revision",
    });
    const r2 = await operationWeeklyReport(f.s, f.week, f.location);
    assert.equal(r2.branches[0].repeats[0].runIds.length, 2);
    const future = await f.check({
      action: "CREATE_RUN",
      templateId: f.template,
      assignedTo: f.actor,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(future.status, "OK");
    const rr = (
      await query(
        `SELECT * FROM bms_operation_runs WHERE tenant_id=$1 AND id=$2`,
        [f.tenant, run.id],
      )
    ).rows[0];
    assert.equal(
      (
        await f.check({
          action: "VOID",
          id: run.id,
          version: rr.version,
          note: "FAKE cancelled",
        })
      ).status,
      "OK",
    );
    const r3 = await operationWeeklyReport(f.s, f.week, f.location);
    assert.equal(r3.branches[0].due, 1);
    assert.equal(r3.branches[0].future, 1);
    assert.equal(r3.branches[0].cancelled, 1);
    assert.equal(r3.branches[0].backlog.length, 1);
    assert.equal(r3.branches[0].repeats.length, 0);
    const empty = await operationWeeklyReport(f.s, f.week, f.locations[1]);
    assert.equal(empty.branches[0].onTimePercent, null);
  }));
test("weekly confirmation rejects changed facts and stale version, remains immutable and links real improvement work", async () =>
  fixture(async (f) => {
    let preview = await operationWeeklyReport(f.s, f.week, f.location);
    await f.fail();
    assert.equal(
      (
        await f.cmd({
          action: "CONFIRM_WEEK",
          locationId: f.location,
          from: f.week,
          version: 0,
          fingerprint: preview.fingerprint,
        })
      ).status,
      "SNAPSHOT_CHANGED",
    );
    const i = await f.issue();
    preview = await operationWeeklyReport(f.s, f.week, f.location);
    const saved = await f.cmd({
      action: "CONFIRM_WEEK",
      locationId: f.location,
      from: f.week,
      version: 0,
      fingerprint: preview.fingerprint,
    });
    assert.equal(saved.status, "OK");
    const before = await improvementDetail(f.s, saved.id, "REVIEW");
    assert.equal(
      (await operationWeeklyReport(f.s, f.week)).reviews[0].changed,
      false,
      "multi-branch live facts compare against the single-branch snapshot",
    );
    await f.fail();
    assert.equal(
      (await operationWeeklyReport(f.s, f.week)).reviews[0].changed,
      true,
    );
    assert.deepEqual(
      (await improvementDetail(f.s, saved.id, "REVIEW")).snapshot,
      before.snapshot,
    );
    assert.equal(
      (
        await f.cmd({
          action: "CONFIRM_WEEK",
          locationId: f.location,
          from: f.week,
          version: 0,
          fingerprint: preview.fingerprint,
        })
      ).status,
      "STALE_VERSION",
    );
    assert.equal(
      (
        await f.cmd({
          action: "CREATE_FOLLOWUP",
          id: i.id,
          version: 1,
          templateId: f.template,
          assignedTo: f.actor,
          dueAt: new Date().toISOString(),
          target: "FAKE measurable target",
          weeklyReviewId: saved.id,
        })
      ).status,
      "OK",
    );
    const d = await improvementDetail(f.s, i.id, "ISSUE");
    assert.equal(d.followups[0].baseline.review.id, saved.id);
    await assert.rejects(
      checklistTx(f.s, (c) =>
        c.query(
          `UPDATE bms_operation_weekly_reviews SET note='changed' WHERE tenant_id=$1`,
          [f.tenant],
        ),
      ),
      /permission denied/,
    );
  }));
test("F GraphQL adapters preserve business rejections, source authority and read permissions", async () =>
  fixture(async (f) => {
    const input = {
      action: "PUBLISH_STANDARD",
      idempotencyKey: randomUUID(),
      confirmed: false,
    };
    assert.equal(
      (await gql.Mutation.bmsImprovementCommand(null, { input }, f.ctx()))
        .status,
      "CONFIRMATION_REQUIRED",
    );
    const p = await f.publish();
    assert.equal(
      (
        await gql.Query.bmsImprovementDetail(
          null,
          { id: p.id, kind: "STANDARD" },
          f.ctx(),
        )
      ).id,
      p.id,
    );
    await assert.rejects(
      operationWeeklyReport(
        {
          ...f.s,
          permissions: new Set([
            "operations.checklist.view",
            "operations.summary.review",
          ]),
        },
        f.week,
        f.location,
      ),
      /FORBIDDEN/,
    );
    await assert.rejects(
      improvementDetail({ ...f.s, tenantId: randomUUID() }, p.id, "STANDARD"),
      /NOT_FOUND/,
    );
  }));
