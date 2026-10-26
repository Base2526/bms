import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import {
  commandOperationTeam,
  runOperationTeamFollowups,
} from "../apps/web/lib/bms/operationTeam.ts";
import {
  operationTeamWorkspace,
  operationTeamDetail,
  operationTeamInbox,
  operationTeamSummary,
} from "../apps/web/lib/bms/operationTeamReads.ts";
import {
  resolveOperationDuty,
  operationSupervisor,
} from "../apps/web/lib/bms/operationTeamDispatch.ts";
import { checklistTx } from "../apps/web/lib/bms/operationChecklists.ts";
import {
  bmsOperationTeamTypeDefs,
  bmsOperationTeamResolvers,
} from "../apps/web/graphql/bmsOperationTeam.ts";
import { query, getClient } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import {
  commandChecklist,
  checklistWorkspace,
  checklistDetail,
  runChecklistSchedules,
} from "../apps/web/lib/bms/operationChecklists.ts";
import {
  uploadChecklistEvidence,
  checklistEvidenceFile,
} from "../apps/web/lib/bms/operationChecklistEvidence.ts";
import { __setStorageDriverForTest } from "../apps/web/lib/storageDrivers/index.ts";
import {
  checklistMyWork,
  checklistInbox,
  checklistSupervision,
  checklistInspectionReport,
  commandChecklistFollowup,
  runChecklistFollowups,
  checklistReportDates,
} from "../apps/web/lib/bms/operationChecklistFollowup.ts";
import {
  bmsOperationChecklistsResolvers,
  bmsOperationChecklistsTypeDefs,
} from "../apps/web/graphql/bmsOperationChecklists.ts";
if (
  !["127.0.0.1", "localhost"].includes(process.env.POSTGRES_HOST ?? "") ||
  process.env.POSTGRES_DB !== "bms_operations_test"
)
  throw new Error("Use disposable bms_operations_test only");
const tenant = randomUUID(),
  otherTenant = randomUUID(),
  actor = randomUUID(),
  reviewer = randomUUID(),
  limited = randomUUID(),
  loc = randomUUID(),
  second = randomUUID();
const permissions = new Set([
  "operations.roster.manage",
  "operations.roster.accept",
  "operations.handover.manage",
  "operations.handover.receive",
  "operations.summary.review",
  "operations.checklist.view",
  "operations.checklist.execute",
  "operations.checklist.manage",
  "operations.checklist.review",
]);
const scope = { tenantId: tenant, actorId: actor, permissions },
  reviewScope = { ...scope, actorId: reviewer },
  limitedScope = { ...scope, actorId: limited };
const item = {
  key: "cold",
  label: "FAKE refrigerator",
  type: "TEMPERATURE",
  required: true,
  photoRequired: false,
  allowNa: true,
  min: 0,
  max: 5,
  unit: "C",
  choices: [],
  instruction: "Inspect and correct",
};
const cmd = (input: any, s = scope) =>
  commandChecklist(s, {
    idempotencyKey: randomUUID(),
    confirmed: true,
    ...input,
  });
const followup = (input: any, s = scope) =>
  commandChecklistFollowup(s, {
    idempotencyKey: randomUUID(),
    confirmed: true,
    ...input,
  });
async function policy(extra: any = {}) {
  const old = (
    await query(
      `SELECT version FROM bms_operation_policies WHERE tenant_id=$1 AND location_id=$2`,
      [tenant, extra.locationId ?? loc],
    )
  ).rows[0];
  return followup({
    action: "SAVE_POLICY",
    locationId: loc,
    supervisorId: reviewer,
    reminderMinutes: 30,
    escalationMinutes: 60,
    enabled: false,
    version: old?.version ?? 0,
    ...extra,
  });
}
const due = () => new Date(Date.now() + 3600000).toISOString();
async function newTemplate(extra: any = {}) {
  const r = await cmd({
    action: "SAVE_TEMPLATE",
    name: "FAKE Opening",
    category: "OPENING",
    locationId: loc,
    separateReviewer: true,
    items: [item],
    ...extra,
  });
  assert.equal(r.status, "OK");
  return r.id!;
}
async function newRun(extra: any = {}) {
  const t = await newTemplate(extra);
  assert.equal(
    (await cmd({ action: "PUBLISH", id: t, version: 1 })).status,
    "OK",
  );
  const r = await cmd({ action: "CREATE_RUN", templateId: t, dueAt: due() });
  assert.equal(r.status, "OK");
  return r.id!;
}
const detail = (id: string) => checklistDetail(scope, id);
async function record(id: string, value: any, s = scope) {
  const r = await detail(id);
  return cmd(
    { action: "RECORD", id, version: r.version, itemKey: "cold", value },
    s,
  );
}
async function submit(id: string) {
  const r = await detail(id);
  return cmd({ action: "SUBMIT", id, version: r.version });
}
const team = (i: any, s = scope) =>
  commandOperationTeam(s, {
    idempotencyKey: randomUUID(),
    confirmed: true,
    ...i,
  });
let rosterSequence = 0;
async function roster(extra: any = {}) {
  const start = Date.now() + ++rosterSequence * 86400000;
  const r = await team({
    action: "SAVE_ROSTER",
    locationId: loc,
    dutyKey: `duty-${rosterSequence}`,
    dutyName: "FAKE Duty",
    assignedTo: actor,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 3600000).toISOString(),
    ...extra,
  });
  assert.equal(r.status, "OK");
  return r;
}
async function published(extra: any = {}) {
  const r = await roster(extra);
  const p = await team({
    action: "PUBLISH_ROSTER",
    id: r.id,
    version: r.version,
  });
  assert.equal(p.status, "OK");
  return p;
}
async function assignedRun() {
  const id = await newRun();
  assert.equal(
    (
      await cmd({
        action: "ASSIGN",
        id,
        version: 1,
        assignedTo: actor,
        dueAt: due(),
      })
    ).status,
    "OK",
  );
  return id;
}
test.before(async () => {
  await query(
    readFileSync(
      new URL("./testing/operation-checklists-fixture.sql", import.meta.url),
      "utf8",
    ),
  );
  const sql = readFileSync(
    new URL(
      "../db/migrations/10.91__bms_operation_checklists.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await query(sql);
  await query(sql); // Proves rerun, grants and policy recreation.
  const followupSql = readFileSync(
    new URL(
      "../db/migrations/10.92__bms_operation_followup.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await query(followupSql);
  await query(followupSql);
  const teamSql = readFileSync(
    new URL("../db/migrations/10.93__bms_operation_team.sql", import.meta.url),
    "utf8",
  );
  await query(teamSql);
  await query(teamSql);
  await query(
    `INSERT INTO bms_tenants(id,name) VALUES($1,'FAKE operations'),($2,'FAKE other')`,
    [tenant, otherTenant],
  );
  for (const id of [actor, reviewer, limited])
    await query(
      `INSERT INTO users(id,tenant_id,name,role_id) SELECT $1,$2,'FAKE staff',id FROM roles WHERE name='Administrator'`,
      [id, tenant],
    );
  await query(
    `INSERT INTO bms_locations(id,tenant_id,name,code) VALUES($1,$3,'FAKE A','A'),($2,$3,'FAKE B','B')`,
    [loc, second, tenant],
  );
  await query(
    `INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,
    [tenant, limited, second],
  );
});
test("Release D: roster guards, idempotency, cross-branch overlap and immutable publication", async () => {
  const input = {
    action: "SAVE_ROSTER",
    locationId: loc,
    dutyKey: "morning",
    dutyName: "FAKE Morning",
    startsAt: "2027-05-01T08:00:00+07:00",
    endsAt: "2027-05-01T16:00:00+07:00",
    assignedTo: actor,
    idempotencyKey: randomUUID(),
  };
  assert.equal(
    (await team({ ...input, confirmed: false })).status,
    "CONFIRMATION_REQUIRED",
  );
  assert.equal(
    (
      await team(input, {
        ...scope,
        permissions: new Set(["operations.checklist.view"]),
      })
    ).status,
    "FORBIDDEN",
  );
  assert.equal((await team(input, limitedScope)).status, "NOT_FOUND");
  const results = await Promise.all([team(input), team(input)]);
  assert.equal(results[0].status, "OK");
  assert.deepEqual(results[0], results[1]);
  const id = results[0].id!;
  assert.equal(
    (await team({ ...input, dutyName: "changed" })).status,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    (await team({ action: "PUBLISH_ROSTER", id, version: 1 })).status,
    "OK",
  );
  assert.equal(
    (await team({ ...input, id, version: 2, idempotencyKey: randomUUID() }))
      .status,
    "INVALID_STATE",
  );
  const overlap = await roster({
    ...input,
    idempotencyKey: randomUUID(),
    locationId: second,
  });
  assert.equal(
    (await team({ action: "PUBLISH_ROSTER", id: overlap.id, version: 1 }))
      .status,
    "OVERLAPPING_DUTY",
  );
  const adjacent = await published({
    startsAt: input.endsAt,
    endsAt: "2027-05-01T20:00:00+07:00",
    locationId: second,
  });
  assert.ok(adjacent.id);
  const concurrent = await Promise.all([
    roster({
      startsAt: "2027-06-01T08:00:00Z",
      endsAt: "2027-06-01T09:00:00Z",
    }),
    roster({
      startsAt: "2027-06-01T08:00:00Z",
      endsAt: "2027-06-01T09:00:00Z",
      locationId: second,
    }),
  ]);
  const commits = await Promise.all(
    concurrent.map((r) =>
      team({ action: "PUBLISH_ROSTER", id: r.id, version: 1 }),
    ),
  );
  assert.deepEqual(commits.map((x) => x.status).sort(), [
    "OK",
    "OVERLAPPING_DUTY",
  ]);
  assert.equal(
    (await team({ action: "ACCEPT_DUTY", id, version: 2 })).status,
    "OUTSIDE_DUTY",
  );
  assert.equal(
    (await team({ action: "CANCEL_ROSTER", id, version: 2, note: "" })).status,
    "REASON_REQUIRED",
  );
  assert.equal(
    (
      await team({
        action: "CANCEL_ROSTER",
        id,
        version: 2,
        note: "FAKE changed plan",
      })
    ).status,
    "OK",
  );
});
test("Release D: duty acceptance is self-only, current-window, versioned and separate from POS", async () => {
  const r = await published({
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: due(),
  });
  assert.equal(
    (await team({ action: "ACCEPT_DUTY", id: r.id, version: 2 }, reviewScope))
      .status,
    "NOT_ASSIGNED",
  );
  assert.equal(
    (await team({ action: "ACCEPT_DUTY", id: r.id, version: 2 })).status,
    "OK",
  );
  assert.equal(
    (await team({ action: "ACCEPT_DUTY", id: r.id, version: 3 })).status,
    "OUTSIDE_DUTY",
  );
  assert.equal(
    (await team({ action: "END_DUTY", id: r.id, version: 3 })).status,
    "OK",
  );
  assert.equal(
    (
      await team({
        action: "CANCEL_ROSTER",
        id: r.id,
        version: 4,
        note: "FAKE cleanup",
      })
    ).status,
    "OK",
  );
});
test("Release D: duty resolution uses occurrence, half-open bounds, ambiguity and current eligibility", async () => {
  const key = `duty-${randomUUID()}`,
    start = "2027-07-01T15:00:00Z",
    end = "2027-07-01T23:00:00Z";
  const r = await published({ dutyKey: key, startsAt: start, endsAt: end });
  const resolve = (at: string) =>
    checklistTx(scope, (c) => resolveOperationDuty(c, tenant, loc, key, at));
  assert.equal((await resolve(start)).assignedTo, actor);
  assert.equal((await resolve(end)).assignedTo, null);
  const r2 = await published({
    dutyKey: key,
    assignedTo: reviewer,
    startsAt: start,
    endsAt: end,
  });
  assert.equal((await resolve(start)).evidence.status, "AMBIGUOUS");
  await team({
    action: "CANCEL_ROSTER",
    id: r2.id,
    version: 2,
    note: "FAKE duplicate role",
  });
  await query("UPDATE users SET pos_only=true WHERE id=$1", [actor]);
  try {
    assert.equal((await resolve(start)).evidence.status, "MISSING");
  } finally {
    await query("UPDATE users SET pos_only=false WHERE id=$1", [actor]);
  }
  const runId = await newRun(),
    templateId = (await detail(runId)).templateId;
  const schedule = await cmd({
    action: "SAVE_SCHEDULE",
    templateId,
    assignmentMode: "DUTY",
    dutyKey: key,
    timezone: "Asia/Bangkok",
    localTime: "22:00",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    dueMinutes: 60,
  });
  assert.equal(schedule.status, "OK");
  // Recovery runs now, but the due occurrence belonged to the historical roster.
  const historical = new Date(Date.now() - 3 * 86400000).toISOString(),
    historicalEnd = new Date(Date.parse(historical) + 3600000).toISOString();
  const old = await published({
    dutyKey: key,
    startsAt: historical,
    endsAt: historicalEnd,
  });
  await query("UPDATE bms_operation_schedules SET next_at=$2 WHERE id=$1", [
    schedule.id,
    historical,
  ]);
  await runChecklistSchedules();
  const created = (
    await query(
      "SELECT r.* FROM bms_operation_runs r JOIN bms_operation_occurrences o ON o.tenant_id=r.tenant_id AND o.run_id=r.id WHERE o.schedule_id=$1",
      [schedule.id],
    )
  ).rows[0];
  assert.equal(created.assigned_to, actor);
  assert.equal(created.assignment_evidence.effectiveAt, historical);
  await team({
    action: "CANCEL_ROSTER",
    id: old.id,
    version: 2,
    note: "FAKE changed after occurrence",
  });
  assert.equal((await detail(created.id)).assignedTo, actor);
  await policy();
  const missing = await cmd({
    action: "CREATE_RUN",
    templateId,
    assignmentMode: "DUTY",
    dutyKey: "not-scheduled",
    dueAt: due(),
  });
  assert.equal(missing.status, "OK");
  assert.equal((await detail(missing.id!)).assignedTo, null);
  assert.equal(
    (
      await query(
        `SELECT count(*)::int n FROM bms_operation_team_notices WHERE entity_id=$1 AND kind='ASSIGNMENT_REQUIRED'`,
        [missing.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await cmd({
        action: "CREATE_RUN",
        templateId,
        assignmentMode: "DUTY",
        dutyKey: key,
        assignedTo: actor,
        dueAt: due(),
      })
    ).status,
    "INVALID_INPUT",
  );
  assert.equal(
    (await cmd({ action: "PAUSE_SCHEDULE", id: schedule.id, version: 2 }))
      .status,
    "OK",
  );
});
test("Release D: handover snapshot stale guard, receipt never transfers, explicit transfer preserves due and canonical checks", async () => {
  const id = await assignedRun(),
    before = await detail(id),
    r = await published();
  const created = await team({
    action: "CREATE_HANDOVER",
    rosterId: r.id,
    version: 2,
    recipient: reviewer,
    dueAt: due(),
    note: "FAKE check fridge",
  });
  assert.equal(created.status, "OK");
  const hid = created.id!;
  await record(id, 8);
  assert.equal(
    (await team({ action: "SUBMIT_HANDOVER", id: hid, version: 1 })).status,
    "STALE_SOURCE",
  );
  assert.equal(
    (
      await team({
        action: "REFRESH_HANDOVER",
        id: hid,
        version: 1,
        recipient: reviewer,
        dueAt: due(),
        note: "FAKE latest",
      })
    ).status,
    "OK",
  );
  assert.equal(
    (await team({ action: "SUBMIT_HANDOVER", id: hid, version: 2 })).status,
    "OK",
  );
  const snapshot = await operationTeamDetail(scope, hid);
  assert.ok(snapshot.items.some((x: any) => x.id === id));
  assert.ok(snapshot.items.some((x: any) => x.kind === "ACTION"));
  assert.equal(
    (await team({ action: "RECEIVE_HANDOVER", id: hid, version: 3 })).status,
    "NOT_ASSIGNED",
  );
  const receive = {
    action: "RECEIVE_HANDOVER",
    id: hid,
    version: 3,
    idempotencyKey: randomUUID(),
  };
  const result = await Promise.all([
    team(receive, reviewScope),
    team(receive, reviewScope),
  ]);
  assert.equal(result[0].status, "OK");
  assert.deepEqual(result[0], result[1]);
  const after = await detail(id);
  assert.equal(after.assignedTo, actor);
  assert.equal(after.status, "IN_PROGRESS");
  assert.equal(after.dueAt, before.dueAt);
  const transfer = {
    action: "TRANSFER_ITEM",
    id: hid,
    version: 4,
    itemId: id,
    itemKind: "RUN",
    itemVersion: after.version,
    note: "FAKE take over",
    idempotencyKey: randomUUID(),
  };
  assert.equal(
    (
      await team(transfer, {
        ...scope,
        permissions: new Set(
          [...permissions].filter((p) => p !== "operations.checklist.manage"),
        ),
      })
    ).status,
    "FORBIDDEN",
  );
  assert.equal(
    (await team({ ...transfer, itemVersion: 1, idempotencyKey: randomUUID() }))
      .status,
    "STALE_VERSION",
  );
  assert.equal((await team(transfer)).status, "OK");
  assert.equal((await team(transfer)).status, "OK");
  const transferred = await detail(id);
  assert.equal(transferred.assignedTo, reviewer);
  assert.equal(transferred.dueAt, before.dueAt);
  assert.equal(transferred.actions[0].status, "OPEN");
  const h = await operationTeamDetail(scope, hid);
  assert.deepEqual(h.items, snapshot.items);
  const action = transferred.actions[0];
  assert.equal(
    (
      await team({
        action: "TRANSFER_ITEM",
        id: hid,
        version: 5,
        itemId: action.id,
        itemKind: "ACTION",
        itemVersion: action.version,
        note: "FAKE transfer corrective",
      })
    ).status,
    "OK",
  );
  assert.equal((await detail(id)).actions[0].dueAt, action.dueAt);
  assert.equal(
    (
      await team({
        action: "APPEND_NOTE",
        id: hid,
        version: 6,
        note: "FAKE continuing",
      })
    ).status,
    "OK",
  );
  assert.deepEqual(
    (await operationTeamDetail(scope, hid)).items,
    snapshot.items,
  );
  await assert.rejects(operationTeamDetail(limitedScope, hid), /NOT_FOUND/);
});
test("Release D: rerouting, pending reminders and unified inbox are scoped and deduplicated", async () => {
  await policy();
  const r = await published();
  const h = await team({
    action: "CREATE_HANDOVER",
    rosterId: r.id,
    version: 2,
    recipient: reviewer,
    dueAt: new Date(Date.now() - 3600000).toISOString(),
    note: "FAKE pending",
  });
  assert.equal(h.status, "OK");
  assert.equal(
    (await team({ action: "SUBMIT_HANDOVER", id: h.id, version: 1 })).status,
    "OK",
  );
  await Promise.all([
    runOperationTeamFollowups(tenant),
    runOperationTeamFollowups(tenant),
  ]);
  await runOperationTeamFollowups(tenant);
  assert.equal(
    (
      await query(
        `SELECT count(*)::int n FROM bms_operation_team_notices WHERE entity_id=$1 AND kind='HANDOVER_OVERDUE'`,
        [h.id],
      )
    ).rows[0].n,
    1,
  );
  const notice = (
    await query(
      `SELECT id FROM bms_operation_team_notices WHERE entity_id=$1 AND kind='HANDOVER_OVERDUE'`,
      [h.id],
    )
  ).rows[0];
  assert.equal(
    (await team({ action: "READ_NOTICE", id: notice.id, source: "TEAM" }))
      .status,
    "NOT_FOUND",
  );
  const inbox = await operationTeamInbox(reviewScope);
  assert.ok(inbox.unread > 0);
  assert.equal(
    (
      await team(
        { action: "READ_NOTICE", id: notice.id, source: "TEAM" },
        reviewScope,
      )
    ).status,
    "OK",
  );
  assert.equal((await operationTeamDetail(scope, h.id!)).status, "SUBMITTED");
  assert.equal(
    (
      await team({
        action: "REROUTE_HANDOVER",
        id: h.id,
        version: 2,
        recipient: limited,
        note: "FAKE wrong branch",
      })
    ).status,
    "INVALID_ASSIGNEE",
  );
  assert.equal(
    (
      await team({
        action: "CANCEL_HANDOVER",
        id: h.id,
        version: 2,
        note: "FAKE cancelled",
      })
    ).status,
    "OK",
  );
  const date = new Date().toISOString().slice(0, 10);
  await assert.rejects(
    operationTeamWorkspace(limitedScope, {
      locationId: loc,
      from: date,
      to: date,
    }),
    /NOT_FOUND/,
  );
});
test("Release D: daily confirmation is immutable, rejects stale preview and exposes subsequent changes", async () => {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const preview = await operationTeamSummary(scope, loc, date);
  assert.equal(preview.previous, null);
  const id = await newRun();
  assert.equal(
    (
      await team({
        action: "CONFIRM_DAY",
        locationId: loc,
        date,
        version: 0,
        fingerprint: preview.fingerprint,
        note: "FAKE stale",
      })
    ).status,
    "STALE_SOURCE",
  );
  const fresh = await operationTeamSummary(scope, loc, date);
  const confirm = {
    action: "CONFIRM_DAY",
    locationId: loc,
    date,
    version: 0,
    fingerprint: fresh.fingerprint,
    note: "FAKE reviewed",
    idempotencyKey: randomUUID(),
  };
  assert.equal((await team(confirm)).status, "OK");
  assert.equal((await team(confirm)).status, "OK");
  assert.equal((await operationTeamSummary(scope, loc, date)).changed, false);
  await record(id, 8);
  const changed = await operationTeamSummary(scope, loc, date);
  assert.equal(changed.changed, true);
  assert.equal(changed.previous!.snapshot.counts.actions, fresh.counts.actions);
  await assert.rejects(
    operationTeamSummary(
      { ...scope, permissions: new Set(["operations.checklist.view"]) },
      loc,
      date,
    ),
    /FORBIDDEN/,
  );
  const c = await getClient();
  try {
    await beginTenantTx(c, tenant);
    await assert.rejects(
      c.query(
        `UPDATE bms_operation_daily_reviews SET note='tamper' WHERE tenant_id=$1`,
        [tenant],
      ),
      /permission denied/,
    );
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
test("Release D: dynamic supervisor resolves eligible duty and falls back, manual escalation uses same resolver", async () => {
  await policy();
  const p = (
    await query(
      "SELECT version FROM bms_operation_policies WHERE tenant_id=$1 AND location_id=$2",
      [tenant, loc],
    )
  ).rows[0];
  assert.equal(
    (
      await team({
        action: "SAVE_SUPERVISOR_DUTY",
        locationId: loc,
        version: p.version,
        enabled: true,
        dutyKey: "shift-head",
      })
    ).status,
    "OK",
  );
  const r = await published({
    assignedTo: actor,
    dutyKey: "shift-head",
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: due(),
  });
  assert.equal(
    await checklistTx(scope, (c) =>
      operationSupervisor(c, tenant, loc, new Date().toISOString()),
    ),
    actor,
  );
  const id = await newRun();
  assert.equal(
    (
      await followup({
        action: "ESCALATE",
        id,
        version: 1,
        note: "FAKE dynamic",
      })
    ).status,
    "OK",
  );
  assert.equal(
    (
      await query(
        "SELECT recipient FROM bms_operation_escalations WHERE run_id=$1",
        [id],
      )
    ).rows[0].recipient,
    actor,
  );
  await team({
    action: "CANCEL_ROSTER",
    id: r.id,
    version: 2,
    note: "FAKE unavailable",
  });
  assert.equal(
    await checklistTx(scope, (c) =>
      operationSupervisor(c, tenant, loc, new Date().toISOString()),
    ),
    reviewer,
  );
});
test("Release D: team audit failure rolls back publication, notice and command result", async () => {
  const r = await roster(),
    key = randomUUID();
  await query(
    `CREATE OR REPLACE FUNCTION fake_team_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target='${r.id}' THEN RAISE EXCEPTION 'FAKE team audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fake_team_audit BEFORE INSERT ON bms_audit_log FOR EACH ROW EXECUTE FUNCTION fake_team_audit_failure()`,
  );
  try {
    await assert.rejects(
      team({
        action: "PUBLISH_ROSTER",
        id: r.id,
        version: 1,
        idempotencyKey: key,
      }),
      /FAKE team audit failure/,
    );
    assert.equal(
      (
        await query("SELECT status FROM bms_operation_rosters WHERE id=$1", [
          r.id,
        ])
      ).rows[0].status,
      "DRAFT",
    );
    assert.equal(
      (
        await query(
          "SELECT id FROM bms_operation_team_notices WHERE entity_id=$1",
          [r.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await query(
          "SELECT key FROM bms_operation_commands WHERE tenant_id=$1 AND key=$2",
          [tenant, key],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await query(
          "SELECT id FROM bms_operation_team_events WHERE entity_id=$1 AND action='PUBLISH_ROSTER'",
          [r.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await query(
      "DROP TRIGGER fake_team_audit ON bms_audit_log; DROP FUNCTION fake_team_audit_failure()",
    );
  }
  assert.equal(
    (
      await team({
        action: "PUBLISH_ROSTER",
        id: r.id,
        version: 1,
        idempotencyKey: key,
      })
    ).status,
    "OK",
  );
});
test("Release D: handover reroute resets only recipient; revoked recipient suppressed; RLS and evidence grants fail closed", async () => {
  const newReceiver = randomUUID();
  await query(
    `INSERT INTO users(id,tenant_id,name,role_id) SELECT $1,$2,'FAKE replacement',id FROM roles WHERE name='Administrator'`,
    [newReceiver, tenant],
  );
  const r = await published(),
    h = await team({
      action: "CREATE_HANDOVER",
      rosterId: r.id,
      version: 2,
      recipient: reviewer,
      dueAt: new Date(Date.now() - 3600000).toISOString(),
      note: "FAKE replacement",
    });
  await team({ action: "SUBMIT_HANDOVER", id: h.id, version: 1 });
  const original = (await operationTeamDetail(scope, h.id!)).items;
  assert.equal(
    (
      await team({
        action: "REROUTE_HANDOVER",
        id: h.id,
        version: 2,
        recipient: newReceiver,
        note: "FAKE unavailable",
      })
    ).status,
    "OK",
  );
  assert.deepEqual((await operationTeamDetail(scope, h.id!)).items, original);
  assert.equal(
    (
      await team(
        { action: "RECEIVE_HANDOVER", id: h.id, version: 3 },
        reviewScope,
      )
    ).status,
    "NOT_ASSIGNED",
  );
  await query("UPDATE users SET pos_only=true WHERE id=$1", [newReceiver]);
  await runOperationTeamFollowups(tenant);
  assert.equal(
    (
      await query(
        `SELECT id FROM bms_operation_team_notices WHERE entity_id=$1 AND recipient=$2 AND kind='HANDOVER_OVERDUE'`,
        [h.id, newReceiver],
      )
    ).rowCount,
    0,
  );
  await query("UPDATE users SET pos_only=false WHERE id=$1", [newReceiver]);
  assert.equal(
    (
      await team(
        { action: "RECEIVE_HANDOVER", id: h.id, version: 3 },
        { ...scope, actorId: newReceiver },
      )
    ).status,
    "OK",
  );
  const c = await getClient();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE bms_app");
    await c.query("SELECT set_config('bms.tenant_id','',true)");
    assert.equal(
      (await c.query("SELECT id FROM bms_operation_rosters")).rowCount,
      0,
    );
    await c.query("ROLLBACK");
    await beginTenantTx(c, otherTenant);
    await assert.rejects(
      c.query(
        `INSERT INTO bms_operation_rosters(tenant_id,location_id,duty_key,duty_name,starts_at,ends_at,created_by) VALUES($1,$2,'x','FAKE',now(),now()+interval '1 hour','FAKE')`,
        [tenant, loc],
      ),
      /row-level security/,
    );
    await c.query("ROLLBACK");
    for (const sql of [
      `UPDATE bms_operation_runs SET assignment_evidence='{}' WHERE tenant_id=$1`,
      `UPDATE bms_operation_team_events SET note='tamper' WHERE tenant_id=$1`,
      `DELETE FROM bms_operation_handovers WHERE tenant_id=$1`,
    ]) {
      await beginTenantTx(c, tenant);
      await assert.rejects(c.query(sql, [tenant]), /permission denied/);
      await c.query("ROLLBACK");
    }
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
test("Release C: validated policy requires confirmation, reviewer, branch and optimistic version", async () => {
  assert.equal(
    (await policy({ confirmed: false })).status,
    "CONFIRMATION_REQUIRED",
  );
  assert.equal(
    (await policy({ supervisorId: limited })).status,
    "INVALID_ASSIGNEE",
  );
  assert.equal((await policy({ reminderMinutes: -1 })).status, "INVALID_INPUT");
  assert.equal((await policy()).status, "OK");
  assert.equal((await policy({ version: 0 })).status, "STALE_VERSION");
  assert.equal(
    (
      await followup(
        {
          action: "SAVE_POLICY",
          locationId: loc,
          supervisorId: reviewer,
          reminderMinutes: 30,
          escalationMinutes: 60,
          enabled: true,
          version: 1,
        },
        limitedScope,
      )
    ).status,
    "NOT_FOUND",
  );
});
test("Release C: personal work and inbox are actor/branch scoped; read does not complete work", async () => {
  const id = await newRun();
  assert.equal(
    (
      await cmd({
        action: "ASSIGN",
        id,
        version: 1,
        assignedTo: actor,
        dueAt: due(),
      })
    ).status,
    "OK",
  );
  assert.ok((await checklistMyWork(scope)).items.some((x) => x.runId === id));
  assert.ok(
    !(await checklistMyWork(reviewScope)).items.some((x) => x.runId === id),
  );
  assert.ok(
    !(await checklistMyWork(limitedScope)).items.some((x) => x.runId === id),
  );
  const notice = (await checklistInbox(scope)).items.find(
    (x) => x.runId === id,
  );
  assert.ok(notice);
  assert.equal(
    (await followup({ action: "READ_NOTICE", id: notice.id }, reviewScope))
      .status,
    "NOT_FOUND",
  );
  const input = {
    action: "READ_NOTICE",
    id: notice.id,
    idempotencyKey: randomUUID(),
  };
  assert.deepEqual(await followup(input), await followup(input));
  assert.ok(
    (await checklistInbox(scope)).items.find((x) => x.id === notice.id).readAt,
  );
  assert.equal((await detail(id)).status, "OPEN");
  const count = (
    await query(
      `SELECT count(*) n FROM bms_operation_notices WHERE tenant_id=$1 AND run_id=$2 AND kind='ASSIGNED'`,
      [tenant, id],
    )
  ).rows[0].n;
  await runChecklistFollowups();
  await runChecklistFollowups();
  assert.equal(
    (
      await query(
        `SELECT count(*) n FROM bms_operation_notices WHERE tenant_id=$1 AND run_id=$2 AND kind='ASSIGNED'`,
        [tenant, id],
      )
    ).rows[0].n,
    count,
  );
  await assert.rejects(
    () =>
      checklistMyWork({
        ...scope,
        permissions: new Set(["operations.checklist.view"]),
      }),
    /FORBIDDEN/,
  );
  await assert.rejects(
    () => checklistInbox(limitedScope, { locationId: loc }),
    /NOT_FOUND/,
  );
});
test("Release C: manual escalation, replay and acknowledgment never approve or close a checklist", async () => {
  const id = await newRun();
  const input = {
    action: "ESCALATE",
    id,
    version: 1,
    note: "FAKE needs help",
    idempotencyKey: randomUUID(),
  };
  assert.equal(
    (await followup({ ...input, confirmed: false })).status,
    "CONFIRMATION_REQUIRED",
  );
  const result = await followup(input);
  assert.equal(result.status, "OK");
  assert.deepEqual(await followup(input), result);
  assert.equal(
    (await followup({ ...input, idempotencyKey: randomUUID() })).status,
    "ALREADY_ESCALATED",
  );
  assert.equal(
    (await followup({ ...input, note: "changed" })).status,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    (
      await followup({
        action: "ACKNOWLEDGE",
        id: result.id,
        version: 1,
        note: "FAKE accepted",
      })
    ).status,
    "FORBIDDEN",
  );
  assert.equal(
    (
      await followup(
        {
          action: "ACKNOWLEDGE",
          id: result.id,
          version: 1,
          note: "FAKE accepted",
        },
        reviewScope,
      )
    ).status,
    "OK",
  );
  assert.equal((await detail(id)).status, "OPEN");
  assert.equal(
    (await checklistSupervision(reviewScope)).escalations.find(
      (e) => e.id === result.id,
    ).status,
    "ACKNOWLEDGED",
  );
  assert.equal(
    (await cmd({ action: "VOID", id, version: 1, note: "FAKE cancelled" }))
      .status,
    "OK",
  );
  assert.equal(
    (
      await query(
        `SELECT status FROM bms_operation_escalations WHERE tenant_id=$1 AND id=$2`,
        [tenant, result.id],
      )
    ).rows[0].status,
    "CLOSED",
  );
});
test("Release C: automatic thresholds are opt-in, concurrent sweeps deduplicate, invalid recipients suppressed", async () => {
  const id = await newRun();
  const past = new Date(Date.now() - 120 * 60000).toISOString();
  await cmd({
    action: "ASSIGN",
    id,
    version: 1,
    assignedTo: actor,
    dueAt: past,
  });
  await runChecklistFollowups();
  assert.equal(
    (
      await query(
        `SELECT count(*)::int n FROM bms_operation_escalations WHERE tenant_id=$1 AND run_id=$2`,
        [tenant, id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal((await policy({ enabled: true })).status, "OK");
  const sweeps = await Promise.all([
    runChecklistFollowups(),
    runChecklistFollowups(),
  ]);
  assert.ok(sweeps.every((s) => s.failed === 0));
  assert.equal(
    (
      await query(
        `SELECT count(*)::int n FROM bms_operation_escalations WHERE tenant_id=$1 AND run_id=$2`,
        [tenant, id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await query(
        `SELECT count(*)::int n FROM bms_operation_notices WHERE tenant_id=$1 AND run_id=$2 AND kind='ESCALATED'`,
        [tenant, id],
      )
    ).rows[0].n,
    1,
  );
  const soon = await newRun();
  await cmd({
    action: "ASSIGN",
    id: soon,
    version: 1,
    assignedTo: actor,
    dueAt: new Date(Date.now() + 10 * 60000).toISOString(),
  });
  assert.equal(
    (
      await query(
        `SELECT count(*)::int n FROM bms_operation_notices WHERE tenant_id=$1 AND run_id=$2 AND kind='DUE_SOON'`,
        [tenant, soon],
      )
    ).rows[0].n,
    1,
  );
  await query(
    `INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,
    [tenant, reviewer, second],
  );
  const revoked = await newRun();
  await cmd({
    action: "ASSIGN",
    id: revoked,
    version: 1,
    assignedTo: actor,
    dueAt: past,
  });
  assert.equal(
    (
      await followup({
        action: "ESCALATE",
        id: revoked,
        version: 2,
        note: "FAKE request",
      })
    ).status,
    "SUPERVISOR_REQUIRED",
  );
  assert.equal(
    (
      await query(
        `SELECT count(*)::int n FROM bms_operation_escalations WHERE tenant_id=$1 AND run_id=$2`,
        [tenant, revoked],
      )
    ).rows[0].n,
    0,
  );
  assert.ok(
    !(await checklistInbox(reviewScope)).items.some((x) => x.runId === id),
  );
  await query(
    `DELETE FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2`,
    [tenant, reviewer],
  );
  await policy({ enabled: false });
});
test("Release C: review queue excludes self-review; review notification is transactional", async () => {
  const id = await newRun();
  await record(id, 3);
  await submit(id);
  assert.ok(
    !(await checklistMyWork(scope, { bucket: "REVIEW" })).items.some(
      (x) => x.runId === id,
    ),
  );
  assert.ok(
    (await checklistMyWork(reviewScope, { bucket: "REVIEW" })).items.some(
      (x) => x.runId === id,
    ),
  );
  assert.ok(
    (await checklistInbox(reviewScope)).items.some(
      (x) => x.runId === id && x.kind === "REVIEW",
    ),
  );
});
test("Release C: report uses inclusive Bangkok due-date cohort, distinct runs and historical failures", async () => {
  const reportLoc = randomUUID();
  await query(
    `INSERT INTO bms_locations(id,tenant_id,name,code) VALUES($1,$2,'FAKE report','R')`,
    [reportLoc, tenant],
  );
  const t = await newTemplate({ locationId: reportLoc });
  await cmd({ action: "PUBLISH", id: t, version: 1 });
  const ids: string[] = [];
  for (const time of [
    "2026-10-23T17:00:00Z",
    "2026-10-24T16:59:59Z",
    "2026-10-24T17:00:00Z",
  ]) {
    const r = await cmd({ action: "CREATE_RUN", templateId: t, dueAt: time });
    ids.push(r.id!);
    await record(r.id!, 9);
    await record(r.id!, 8);
    await record(r.id!, 3);
  }
  const result = await checklistInspectionReport(reviewScope, {
    locationId: reportLoc,
    from: "2026-10-24",
    to: "2026-10-24",
  });
  assert.equal(result.branches[0].total, 2);
  assert.equal(result.branches[0].failedRuns, 2);
  assert.equal(result.branches[0].openActions, 2);
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].runs, 2);
  await cmd({
    action: "VOID",
    id: ids[0],
    version: (await detail(ids[0])).version,
    note: "FAKE void",
  });
  const after = await checklistInspectionReport(reviewScope, {
    locationId: reportLoc,
    from: "2026-10-24",
    to: "2026-10-24",
  });
  assert.equal(after.branches[0].total, 2);
  assert.equal(after.branches[0].voided, 1);
  assert.equal(after.branches[0].failedRuns, 1);
  assert.equal(after.problems.length, 0);
  assert.equal(
    (
      await checklistInspectionReport(reviewScope, {
        locationId: reportLoc,
        from: "2026-10-25",
        to: "2026-10-25",
      })
    ).branches[0].total,
    1,
  );
  await assert.rejects(
    () =>
      checklistInspectionReport(
        { ...scope, permissions: new Set(["operations.checklist.view"]) },
        { from: "2026-10-24", to: "2026-10-24" },
      ),
    /FORBIDDEN/,
  );
  for (const dates of [
    ["2026-02-30", "2026-03-01"],
    ["2026-01-01", "2026-12-31"],
    ["2026-10-25", "2026-10-24"],
  ])
    assert.throws(
      () => checklistReportDates(...(dates as [string, string])),
      /INVALID_INPUT/,
    );
});
test("Release C: rerouting requires a new eligible supervisor and keeps audit; notice failure rolls back work", async () => {
  const id = await newRun();
  const e = await followup({
    action: "ESCALATE",
    id,
    version: 1,
    note: "FAKE escalate",
  });
  assert.equal(
    (
      await followup({
        action: "REROUTE",
        id: e.id,
        version: 1,
        note: "FAKE reroute",
      })
    ).status,
    "INVALID_ASSIGNEE",
  );
  await policy({ supervisorId: actor });
  assert.equal(
    (
      await followup({
        action: "REROUTE",
        id: e.id,
        version: 1,
        note: "FAKE reroute",
      })
    ).status,
    "OK",
  );
  assert.equal(
    (await checklistSupervision(scope)).escalations.find((x) => x.id === e.id)
      .recipient,
    actor,
  );
  await policy();
  await query(`REVOKE INSERT ON bms_operation_notices FROM bms_app`);
  try {
    await assert.rejects(
      () =>
        cmd({
          action: "ASSIGN",
          id,
          version: 1,
          assignedTo: actor,
          dueAt: due(),
        }),
      /permission denied/,
    );
  } finally {
    await query(`GRANT INSERT ON bms_operation_notices TO bms_app`);
  }
  const r = await detail(id);
  assert.equal(r.version, 1);
  assert.equal(r.assignedTo, null);
});
test("services enforce permission and branch scope on every read and write", async () => {
  const t = await newTemplate();
  assert.equal(
    (
      await cmd(
        { action: "PUBLISH", id: t, version: 1 },
        { ...scope, permissions: new Set(["operations.checklist.view"]) },
      )
    ).status,
    "FORBIDDEN",
  );
  assert.equal(
    (await cmd({ action: "PUBLISH", id: t, version: 1 }, limitedScope)).status,
    "NOT_FOUND",
  );
  assert.equal(
    (
      await cmd(
        { action: "PUBLISH", id: t, version: 1 },
        { ...scope, tenantId: otherTenant },
      )
    ).status,
    "NOT_FOUND",
  );
  const w = await checklistWorkspace(limitedScope);
  assert.equal(w.templates.length, 0);
  assert.deepEqual(
    w.locations.map((x: any) => x.id),
    [second],
  );
});
test("publishing requires confirmation; failed business actions leave no partial data", async () => {
  const t = await newTemplate();
  assert.equal(
    (await cmd({ action: "PUBLISH", id: t, version: 1, confirmed: false }))
      .status,
    "CONFIRMATION_REQUIRED",
  );
  assert.equal(
    (await cmd({ action: "CREATE_RUN", templateId: t, dueAt: due() })).status,
    "INVALID_STATE",
  );
});
test("immutable template version and run snapshot retain original checks", async () => {
  const id = await newRun(),
    r = await detail(id);
  const next = await newTemplate({
    id: r.templateId,
    name: "FAKE changed",
    items: [{ ...item, max: 10 }],
  });
  assert.equal(
    (await cmd({ action: "PUBLISH", id: next, version: 2 })).status,
    "OK",
  );
  assert.equal((await detail(id)).snapshot.items[0].max, 5);
  assert.equal(
    (
      await cmd({
        action: "CREATE_RUN",
        templateId: r.templateId,
        dueAt: due(),
      })
    ).status,
    "INVALID_STATE",
  );
});
test("failed measurement creates corrective action atomically and later pass does not erase it", async () => {
  const id = await newRun();
  assert.equal((await record(id, 9)).status, "OK");
  assert.equal((await record(id, 4)).status, "OK");
  const r = await detail(id);
  assert.equal(r.history.length, 2);
  assert.equal(r.results[0].value, 4);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].status, "OPEN");
  assert.equal((await submit(id)).status, "OK");
  assert.equal(
    (await cmd({ action: "APPROVE", id, version: 4 }, reviewScope)).status,
    "CORRECTIVE_ACTION_OPEN",
  );
  const a = r.actions[0];
  assert.equal(
    (
      await cmd({
        action: "ACTION_RESOLVE",
        id: a.id,
        version: a.version,
        note: "FAKE adjusted setting",
      })
    ).status,
    "OK",
  );
  assert.equal(
    (await cmd({ action: "ACTION_VERIFY", id: a.id, version: a.version + 1 }))
      .status,
    "DISTINCT_REVIEWER_REQUIRED",
  );
  assert.equal(
    (
      await cmd(
        { action: "ACTION_VERIFY", id: a.id, version: a.version + 1 },
        reviewScope,
      )
    ).status,
    "OK",
  );
  assert.equal(
    (await cmd({ action: "APPROVE", id, version: 4 }, reviewScope)).status,
    "OK",
  );
  assert.equal((await record(id, 3)).status, "INVALID_STATE");
});
test("required results, separate reviewer, rejection and resubmission", async () => {
  const id = await newRun();
  assert.equal((await submit(id)).status, "INCOMPLETE");
  assert.equal((await record(id, 0)).status, "OK");
  assert.equal((await submit(id)).status, "OK");
  assert.equal(
    (await cmd({ action: "APPROVE", id, version: 3 })).status,
    "DISTINCT_REVIEWER_REQUIRED",
  );
  assert.equal(
    (await cmd({ action: "REJECT", id, version: 3, note: "" }, reviewScope))
      .status,
    "REASON_REQUIRED",
  );
  assert.equal(
    (
      await cmd(
        { action: "REJECT", id, version: 3, note: "FAKE recheck" },
        reviewScope,
      )
    ).status,
    "OK",
  );
  assert.equal((await record(id, 1)).status, "OK");
  assert.equal((await submit(id)).status, "OK");
  assert.equal(
    (await cmd({ action: "APPROVE", id, version: 6 }, reviewScope)).status,
    "OK",
  );
});
test("concurrent record rejects stale version and same-key retry creates one result", async () => {
  const id = await newRun(),
    key = randomUUID(),
    input = {
      action: "RECORD" as const,
      id,
      version: 1,
      itemKey: "cold",
      value: 3,
      idempotencyKey: key,
    };
  const replies = await Promise.all([cmd(input), cmd(input)]);
  assert.ok(replies.every((r) => r.status === "OK"));
  assert.equal((await detail(id)).history.length, 1);
  assert.equal(
    (await cmd({ ...input, value: 4 })).status,
    "IDEMPOTENCY_CONFLICT",
  );
  const inputs = [2, 3].map((value) =>
    cmd({ action: "RECORD", id, version: 2, itemKey: "cold", value }),
  );
  assert.deepEqual((await Promise.all(inputs)).map((r) => r.status).sort(), [
    "OK",
    "STALE_VERSION",
  ]);
});
test("assignee must be eligible for branch; someone else cannot execute assigned work", async () => {
  const id = await newRun();
  assert.equal(
    (
      await cmd({
        action: "ASSIGN",
        id,
        version: 1,
        assignedTo: limited,
        dueAt: due(),
      })
    ).status,
    "INVALID_ASSIGNEE",
  );
  assert.equal(
    (
      await cmd({
        action: "ASSIGN",
        id,
        version: 1,
        assignedTo: actor,
        dueAt: due(),
      })
    ).status,
    "OK",
  );
  assert.equal((await record(id, 3, reviewScope)).status, "NOT_ASSIGNED");
});
test("RLS hides other tenants and prevents cross-tenant inserts; history grants are append-only", async () => {
  const id = await newRun(),
    c = await getClient();
  try {
    await beginTenantTx(c, otherTenant);
    for (const table of [
      "bms_operation_policies",
      "bms_operation_notices",
      "bms_operation_escalations",
      "bms_operation_rosters",
      "bms_operation_handovers",
      "bms_operation_team_events",
      "bms_operation_team_notices",
      "bms_operation_daily_reviews",
    ]) {
      assert.equal(
        (await c.query(`SELECT * FROM ${table} WHERE tenant_id=$1`, [tenant]))
          .rowCount,
        0,
      );
    }
    assert.equal(
      (await c.query(`SELECT * FROM bms_operation_runs WHERE id=$1`, [id]))
        .rowCount,
      0,
    );
    await c.query("ROLLBACK");
    await beginTenantTx(c, tenant);
    await assert.rejects(
      c.query(
        `UPDATE bms_operation_results SET note='tampered' WHERE tenant_id=$1`,
        [tenant],
      ),
      /permission denied/,
    );
    await c.query("ROLLBACK");
    await beginTenantTx(c, otherTenant);
    await assert.rejects(
      c.query(
        `INSERT INTO bms_operation_commands(tenant_id,actor,key,fingerprint,result) VALUES($1,'x','x','x','{}')`,
        [tenant],
      ),
      /row-level security/,
    );
    await c.query("ROLLBACK");
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
test("runtime grants cannot overwrite template content or run snapshots", async () => {
  const id = await newRun(),
    c = await getClient();
  try {
    await beginTenantTx(c, tenant);
    await assert.rejects(
      c.query(`UPDATE bms_operation_runs SET snapshot='{}' WHERE id=$1`, [id]),
      /permission denied/,
    );
    await c.query("ROLLBACK");
    await beginTenantTx(c, tenant);
    await assert.rejects(
      c.query(
        `UPDATE bms_operation_templates SET items='[]' WHERE tenant_id=$1`,
        [tenant],
      ),
      /permission denied/,
    );
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
test("audit failure rolls back measurement, state, corrective action and idempotency result", async () => {
  const id = await newRun();
  await query(`CREATE OR REPLACE FUNCTION fake_operation_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target='${id}' THEN RAISE EXCEPTION 'FAKE audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fake_operation_audit BEFORE INSERT ON bms_audit_log FOR EACH ROW EXECUTE FUNCTION fake_operation_audit_failure()`);
  try {
    await assert.rejects(record(id, 99), /FAKE audit failure/);
    const r = await detail(id);
    assert.equal(r.history.length, 0);
    assert.equal(r.actions.length, 0);
    assert.equal(r.version, 1);
  } finally {
    await query(
      `DROP TRIGGER fake_operation_audit ON bms_audit_log; DROP FUNCTION fake_operation_audit_failure()`,
    );
  }
});
test("scheduled runs use branch snapshots and workers do not duplicate an occurrence", async () => {
  const id = await newRun(),
    r = await detail(id);
  const schedule = await cmd({
    action: "SAVE_SCHEDULE",
    templateId: r.templateId,
    timezone: "Asia/Bangkok",
    localTime: "08:00",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    dueMinutes: 60,
  });
  assert.equal(schedule.status, "OK");
  await query(
    `UPDATE bms_operation_schedules SET next_at=now()-interval '1 hour' WHERE id=$1`,
    [schedule.id],
  );
  const results = await Promise.all([
    runChecklistSchedules(),
    runChecklistSchedules(),
  ]);
  assert.ok(results.reduce((s, x) => s + x.created, 0) >= 1); // Other synthetic tenants may have catch-up work; target occurrence is asserted below.
  assert.equal(
    results.reduce((s, x) => s + x.failed, 0),
    0,
  );
  const occurrences = await query(
    `SELECT * FROM bms_operation_occurrences WHERE schedule_id=$1`,
    [schedule.id],
  );
  assert.equal(occurrences.rowCount, 1);
  const generated = await detail(occurrences.rows[0].run_id);
  assert.equal(generated.locationId, loc);
  assert.equal(
    new Date(generated.dueAt).getTime() -
      new Date(occurrences.rows[0].scheduled_at).getTime(),
    3600000,
  );
  const next = (
    await query(
      `SELECT next_at AT TIME ZONE 'Asia/Bangkok' AS local FROM bms_operation_schedules WHERE id=$1`,
      [schedule.id],
    )
  ).rows[0].local;
  assert.equal(new Date(next).getHours(), 8);
});
test("retiring a draft preserves the active schedule; publication pauses old version schedules", async () => {
  const id = await newRun(),
    r = await detail(id);
  const schedule = await cmd({
    action: "SAVE_SCHEDULE",
    templateId: r.templateId,
    timezone: "Asia/Bangkok",
    localTime: "08:00",
    weekdays: [1],
    dueMinutes: 60,
  });
  const draft = await newTemplate({ id: r.templateId });
  assert.equal(
    (await cmd({ action: "RETIRE", id: draft, version: 2 })).status,
    "OK",
  );
  assert.equal(
    (
      await query(`SELECT active FROM bms_operation_schedules WHERE id=$1`, [
        schedule.id,
      ])
    ).rows[0].active,
    true,
  );
  const next = await newTemplate({ id: r.templateId });
  assert.equal(
    (await cmd({ action: "PUBLISH", id: next, version: 3 })).status,
    "OK",
  );
  assert.equal(
    (
      await query(`SELECT active FROM bms_operation_schedules WHERE id=$1`, [
        schedule.id,
      ])
    ).rows[0].active,
    false,
  );
});
test("an older draft cannot replace a newer published version", async () => {
  const first = await newTemplate(),
    next = await newTemplate({ id: first });
  assert.equal(
    (await cmd({ action: "PUBLISH", id: next, version: 2 })).status,
    "OK",
  );
  assert.equal(
    (await cmd({ action: "PUBLISH", id: first, version: 1 })).status,
    "STALE_VERSION",
  );
});
test("invalid timezone/schedule fails before creating a schedule", async () => {
  const id = await newRun(),
    r = await detail(id);
  for (const timezone of ["bad/timezone", ""])
    assert.equal(
      (
        await cmd({
          action: "SAVE_SCHEDULE",
          templateId: r.templateId,
          timezone,
          localTime: "08:00",
          weekdays: [1],
          dueMinutes: 60,
        })
      ).status,
      "INVALID_INPUT",
    );
});
test("private evidence is decoded, branch-scoped, tied to the item and immutable after approval", async () => {
  assert.equal(
    (await query(`SELECT has_table_privilege('bms_app','files','SELECT') allowed`)).rows[0].allowed,
    false,
    "Evidence must work with the production 9.28 files restriction",
  );
  const require = createRequire(
      new URL("../apps/web/package.json", import.meta.url),
    ),
    sharp = require("sharp");
  const storage = new Map<string, Buffer>();
  __setStorageDriverForTest({
    name: "test",
    shared: true,
    write: async (k, b) => {
      storage.set(k, b);
    },
    delete: async (k) => {
      storage.delete(k);
    },
    read: async (k) => storage.get(k)!,
    stat: async (k) =>
      storage.has(k) ? { size: storage.get(k)!.length } : null,
    writeStream: async (k, stream) => {
      const chunks = [];
      for await (const b of stream as any) chunks.push(Buffer.from(b));
      const bytes = Buffer.concat(chunks);
      storage.set(k, bytes);
      return { size: bytes.length, checksum: "FAKE" };
    },
    openStream: async () => {
      throw new Error("unused");
    },
  });
  try {
    const id = await newRun({ items: [{ ...item, photoRequired: true }] }),
      bytes = await sharp({
        create: { width: 3, height: 3, channels: 3, background: "white" },
      })
        .png()
        .toBuffer();
    await assert.rejects(
      uploadChecklistEvidence(limitedScope, id, "cold", 1, bytes),
      /NOT_FOUND/,
    );
    await assert.rejects(
      uploadChecklistEvidence(scope, id, "cold", 1, Buffer.from("<svg/>")),
      /INVALID_INPUT/,
    );
    const f = await uploadChecklistEvidence(scope, id, "cold", 1, bytes);
    assert.ok((await checklistEvidenceFile(scope, f.fileId)).length > 0);
    await assert.rejects(
      checklistEvidenceFile(limitedScope, f.fileId),
      /NOT_FOUND/,
    );
    await assert.rejects(
      checklistEvidenceFile({ ...scope, tenantId: otherTenant }, f.fileId),
      /NOT_FOUND/,
    );
    assert.equal((await record(id, 4)).status, "EVIDENCE_REQUIRED");
    assert.equal(
      (
        await cmd({
          action: "RECORD",
          id,
          version: 1,
          itemKey: "cold",
          value: 4,
          photoIds: [f.fileId],
        })
      ).status,
      "OK",
    );
    const other = await newRun();
    assert.equal(
      (
        await cmd({
          action: "RECORD",
          id: other,
          version: 1,
          itemKey: "cold",
          value: 4,
          photoIds: [f.fileId],
        })
      ).status,
      "EVIDENCE_REQUIRED",
    );
    await submit(id);
    assert.equal(
      (await cmd({ action: "APPROVE", id, version: 3 }, reviewScope)).status,
      "OK",
    );
    await assert.rejects(
      uploadChecklistEvidence(scope, id, "cold", 4, bytes),
      /INVALID_STATE/,
    );
  } finally {
    __setStorageDriverForTest(null);
  }
});
test("GraphQL derives tenant, rejects missing authority and returns business status in data", async () => {
  const { buildSchema, graphql } = createRequire(
    new URL("../apps/web/package.json", import.meta.url),
  )("./node_modules/graphql/index.js");
  const schema = buildSchema(
    `scalar JSON type Query{_empty:String} type Mutation{_empty:String} ${bmsOperationChecklistsTypeDefs} ${bmsOperationTeamTypeDefs}`,
  );
  const root = Object.fromEntries(
    Object.entries({
      ...bmsOperationChecklistsResolvers.Query,
      ...bmsOperationChecklistsResolvers.Mutation,
      ...bmsOperationTeamResolvers.Query,
      ...bmsOperationTeamResolvers.Mutation,
    }).map(([key, resolve]) => [
      key,
      (args: any, ctx: any) => (resolve as any)(null, args, ctx),
    ]),
  );
  const source = `query{bmsChecklistWorkspace{actorId total}}`;
  const denied = await graphql({
    schema,
    source,
    rootValue: root,
    contextValue: {
      scope: "admin",
      admin: { id: actor, tenant_id: tenant },
      __bmsPerms: new Set(),
    },
  });
  assert.ok(denied.errors?.length);
  const ctx = {
    scope: "admin",
    admin: { id: actor, tenant_id: tenant, role: "Administrator" },
    __bmsPerms: permissions,
  };
  const good = await graphql({
    schema,
    source,
    rootValue: root,
    contextValue: ctx,
  });
  assert.equal(good.errors, undefined);
  assert.equal(good.data.bmsChecklistWorkspace.actorId, actor);
  const dRead = await graphql({
    schema,
    source: `query{bmsOperationTeam(filter:{from:"2026-10-24",to:"2026-10-24"}){actorId rosterTotal handoverTotal staff{id}} bmsOperationInbox{unread items{source}} bmsOperationSummary(locationId:"${loc}",date:"2026-10-24"){timezone fingerprint}}`,
    rootValue: root,
    contextValue: ctx,
  });
  assert.equal(dRead.errors, undefined);
  assert.equal(dRead.data.bmsOperationTeam.actorId, actor);
  const dMutation = `mutation($input:BmsTeamCommandInput!){bmsOperationTeamCommand(input:$input){status}}`,
    dInput = {
      action: "SAVE_ROSTER",
      locationId: loc,
      dutyKey: "x",
      dutyName: "FAKE api",
      startsAt: "2028-01-01T00:00:00Z",
      endsAt: "2028-01-01T08:00:00Z",
      confirmed: true,
      idempotencyKey: randomUUID(),
    };
  const dGood = await graphql({
    schema,
    source: dMutation,
    rootValue: root,
    contextValue: ctx,
    variableValues: { input: dInput },
  });
  assert.equal(dGood.errors, undefined);
  assert.equal(dGood.data.bmsOperationTeamCommand.status, "OK");
  const dDenied = await graphql({
    schema,
    source: dMutation,
    rootValue: root,
    contextValue: {
      ...ctx,
      __bmsPerms: new Set(["operations.checklist.view"]),
    },
    variableValues: { input: { ...dInput, idempotencyKey: randomUUID() } },
  });
  assert.equal(dDenied.errors, undefined);
  assert.equal(dDenied.data.bmsOperationTeamCommand.status, "FORBIDDEN");
  const dInvalid = await graphql({
    schema,
    source: dMutation,
    rootValue: root,
    contextValue: ctx,
    variableValues: { input: { ...dInput, tenantId: otherTenant } },
  });
  assert.ok(dInvalid.errors?.length);
  const cRead = await graphql({
    schema,
    source: `query{bmsChecklistMyWork{total items{runId kind}} bmsChecklistInbox{unread} bmsChecklistSupervision{total} bmsChecklistInspectionReport(filter:{from:"2026-10-24",to:"2026-10-24"}){timezone branches{total}}}`,
    rootValue: root,
    contextValue: ctx,
  });
  assert.equal(cRead.errors, undefined);
  assert.equal(
    cRead.data.bmsChecklistInspectionReport.timezone,
    "Asia/Bangkok",
  );
  const cDenied = await graphql({
    schema,
    source: `query{bmsChecklistMyWork{total}}`,
    rootValue: root,
    contextValue: {
      ...ctx,
      __bmsPerms: new Set(["operations.checklist.view"]),
    },
  });
  assert.equal(cDenied.errors?.[0].extensions.code, "FORBIDDEN");
  const cBad = await graphql({
    schema,
    source: `mutation($input:BmsChecklistFollowupInput!){bmsChecklistFollowup(input:$input){status}}`,
    rootValue: root,
    contextValue: ctx,
    variableValues: {
      input: {
        action: "ESCALATE",
        id: randomUUID(),
        version: 1,
        idempotencyKey: randomUUID(),
        note: "FAKE",
        confirmed: true,
      },
    },
  });
  assert.equal(cBad.errors, undefined);
  assert.equal(cBad.data.bmsChecklistFollowup.status, "NOT_FOUND");
  const bad = await graphql({
    schema,
    source: `mutation($input:BmsChecklistCommandInput!){bmsChecklistCommand(input:$input){status}}`,
    rootValue: root,
    contextValue: ctx,
    variableValues: {
      input: {
        action: "CREATE_RUN",
        idempotencyKey: randomUUID(),
        templateId: randomUUID(),
        dueAt: due(),
        confirmed: true,
      },
    },
  });
  assert.equal(bad.errors, undefined);
  assert.equal(bad.data.bmsChecklistCommand.status, "NOT_FOUND");
});
