// Local UI fixture: real Next page + exported SDL, fake auth/data. No external I/O.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const {
  buildSchema,
  parse,
  validate,
  getVariableValues,
} = require("./node_modules/graphql/index.js");
const schema = buildSchema(
  readFileSync(new URL("../schema.graphql", import.meta.url), "utf8"),
);
const { chromium } = await import(
  process.env.BMS_PLAYWRIGHT_MODULE || "playwright"
);
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3018";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "Local fixture only",
);
const output = ".test-output/operation-checklists-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["en", "th"])
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        serviceWorkers: "block",
      });
      context.setDefaultTimeout(20000);
      await context.routeWebSocket("**/*", (socket) =>
        socket.onMessage((raw) => {
          if (JSON.parse(String(raw)).type === "connection_init")
            socket.send(JSON.stringify({ type: "connection_ack" }));
        }),
      );
      await context.addCookies([
        { name: "ADMIN_COOKIE", value: "FAKE-ui-fixture", url: base },
        { name: "lang", value: lang, url: base },
      ]);
      const id = "00000000-0000-4000-8000-000000000001",
        location = "00000000-0000-4000-8000-000000000002",
        actor = "00000000-0000-4000-8000-000000000003";
      const templateId = "00000000-0000-4000-8000-000000000004";
      const item = {
        key: "cold",
        label: "FAKE temperature",
        type: "TEMPERATURE",
        required: true,
        photoRequired: false,
        allowNa: true,
        min: 0,
        max: 5,
        unit: "C",
        choices: [],
        instruction: "FAKE corrective instruction",
      };
      const template = {
        id: templateId,
        familyId: templateId,
        name: "FAKE Opening",
        category: "OPENING",
        version: 1,
        status: "DRAFT",
        locationId: location,
        stationId: null,
        items: [item],
        separateReviewer: true,
        createdAt: "2026-10-24T01:00:00Z",
      };
      const run = {
        assignmentEvidence: {},
        id,
        templateId,
        snapshot: {
          name: "FAKE Opening",
          items: [item],
          separateReviewer: true,
        },
        status: "OPEN",
        version: 1,
        locationId: location,
        assignedTo: actor,
        dueAt: "2026-10-24T02:00:00Z",
        createdAt: "2026-10-24T01:00:00Z",
        startedAt: null,
        submittedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        results: [],
        history: [],
        events: [],
        actions: [],
        evidence: [],
      };
      const writes = [],
        teamWrites = [],
        followupWrites = [],
        filters = [],
        errors = [];
      let loseResponse = true,
        loseFollowupResponse = true,
        noticeRead = false,
        deny = false;
      let loseTeamResponse = true,
        teamNoticeRead = false;
      const rosterId = "00000000-0000-4000-8000-000000000010",
        handoverId = "00000000-0000-4000-8000-000000000011",
        other = "00000000-0000-4000-8000-000000000012";
      const roster = {
        id: rosterId,
        locationId: location,
        dutyKey: "kitchen",
        dutyName: "FAKE Duty",
        assignedTo: actor,
        startsAt: run.createdAt,
        endsAt: run.dueAt,
        status: "DRAFT",
        version: 1,
        acceptedAt: null,
        endedAt: null,
      };
      const handover = {
        id: handoverId,
        locationId: location,
        rosterId,
        sender: other,
        recipient: actor,
        note: "FAKE handover note",
        dueAt: run.dueAt,
        status: "SUBMITTED",
        version: 1,
        items: [
          {
            id,
            runId: id,
            kind: "RUN",
            version: 1,
            status: "OPEN",
            name: "FAKE pending",
            assignedTo: other,
            dueAt: run.dueAt,
          },
        ],
        liveItems: [],
        events: [],
        dutyName: "FAKE Duty",
        submittedAt: run.createdAt,
        receivedAt: null,
      };
      handover.liveItems = handover.items.map((x) => ({
        ...x,
        currentStatus: "OPEN",
        currentVersion: 1,
        currentAssignedTo: other,
      }));
      const daily = {
        date: "2026-10-24",
        locationId: location,
        timezone: "Asia/Bangkok",
        asOf: run.createdAt,
        fingerprint: "fake-fingerprint",
        changed: false,
        previous: null,
        counts: {
          duties: 1,
          vacancies: 0,
          unaccepted: 1,
          runs: 1,
          approved: 0,
          overdue: 1,
          unassigned: 0,
          review: 0,
          actions: 0,
          handoverDraft: 0,
          handoverWaiting: 1,
          handoverReceived: 0,
          escalations: 0,
        },
      };
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (
          url.origin !== new URL(base).origin &&
          !url.pathname.endsWith("/graphql")
        )
          return route.abort();
        if (!/\/api\/|\/graphql$/.test(url.pathname)) return route.continue();
        let json = {};
        if (url.pathname === "/api/auth/me")
          json = {
            isAuthenticated: true,
            admin: {
              id: actor,
              role: "Administrator",
              name: "FAKE Manager",
              language: lang,
            },
          };
        else if (url.pathname.endsWith("/graphql")) {
          const { query: q = "", variables: v = {} } =
            route.request().postDataJSON() || {};
          let data = {};
          if (q.includes("MyBmsPermissions"))
            data = {
              myBmsPermissions: deny
                ? []
                : [
                    "operations.checklist.view",
                    "operations.checklist.execute",
                    "operations.checklist.review",
                    "operations.checklist.manage",
                    "operations.roster.manage",
                    "operations.roster.accept",
                    "operations.handover.manage",
                    "operations.handover.receive",
                    "operations.summary.review",
                  ],
            };
          else if (
            /ChecklistWorkspace|ChecklistRun|ChecklistCommand|ChecklistMyWork|ChecklistInbox|ChecklistSupervision|ChecklistInspectionReport|ChecklistFollowup|OperationTeam|OperationRoster|OperationHandover|OperationInbox|OperationSummary/.test(
              q,
            )
          ) {
            const doc = parse(q);
            assert.deepEqual(
              [
                ...validate(schema, doc),
                ...(getVariableValues(
                  schema,
                  doc.definitions.find((d) => d.kind === "OperationDefinition")
                    .variableDefinitions,
                  v,
                ).errors ?? []),
              ].map((e) => e.message),
              [],
            );
            if (q.includes("query OperationTeam("))
              data = {
                bmsOperationTeam: {
                  actorId: actor,
                  rosterTotal: 1,
                  handoverTotal: 1,
                  missingTotal: 0,
                  rosters: [roster],
                  handovers: [handover],
                  missing: [],
                  policies: [
                    {
                      locationId: location,
                      version: 1,
                      useDutySupervisor: false,
                      supervisorDutyKey: null,
                    },
                  ],
                  staff: [
                    { id: actor, name: "FAKE Manager" },
                    { id: other, name: "FAKE Sender" },
                  ],
                },
              };
            if (q.includes("query OperationRoster("))
              data = { bmsOperationRoster: roster };
            if (q.includes("query OperationHandover("))
              data = { bmsOperationHandover: handover };
            if (q.includes("query OperationSummary("))
              data = { bmsOperationSummary: daily };
            if (q.includes("query OperationInbox("))
              data = {
                bmsOperationInbox: {
                  total: 1,
                  unread: teamNoticeRead ? 0 : 1,
                  items: [
                    {
                      id: "00000000-0000-4000-8000-000000000013",
                      entityId: handoverId,
                      entityKind: "HANDOVER",
                      kind: "HANDOVER_WAITING",
                      source: "TEAM",
                      createdAt: run.createdAt,
                      readAt: teamNoticeRead ? run.createdAt : null,
                    },
                  ],
                },
              };
            if (q.includes("mutation OperationTeamCommand(")) {
              teamWrites.push(v.input);
              if (loseTeamResponse) {
                loseTeamResponse = false;
                return route.abort("connectionreset");
              }
              if (v.input.action === "PUBLISH_ROSTER") {
                roster.status = "PUBLISHED";
                roster.version++;
              }
              if (v.input.action === "RECEIVE_HANDOVER") {
                handover.status = "RECEIVED";
                handover.version++;
                handover.receivedAt = run.createdAt;
              }
              if (v.input.action === "TRANSFER_ITEM") {
                handover.version++;
                handover.liveItems[0].currentAssignedTo = actor;
              }
              if (v.input.action === "CONFIRM_DAY")
                daily.previous = {
                  id: rosterId,
                  version: 1,
                  fingerprint: daily.fingerprint,
                  note: v.input.note,
                  reviewedBy: actor,
                  createdAt: run.createdAt,
                  snapshot: { counts: daily.counts },
                };
              if (v.input.action === "READ_NOTICE") teamNoticeRead = true;
              data = {
                bmsOperationTeamCommand: {
                  status: "OK",
                  id: v.input.id ?? rosterId,
                  version: 2,
                },
              };
            }
            if (q.includes("query ChecklistWorkspace")) {
              filters.push(v.filter);
              data = {
                bmsChecklistWorkspace: {
                  actorId: actor,
                  total: 1,
                  locations: [
                    { id: location, name: "FAKE Branch", active: true },
                  ],
                  staff: [{ id: actor, name: "FAKE Staff" }],
                  stations: [],
                  metrics: { open: 1, overdue: 1, review: 0, actions: 0 },
                  templates: [template],
                  runs: [run],
                  schedules: [],
                  actions: [],
                },
              };
            }
            if (q.includes("query ChecklistRun"))
              data = { bmsChecklistRun: run };
            if (q.includes("query ChecklistMyWork"))
              data = {
                bmsChecklistMyWork: {
                  total: 1,
                  overdue: 1,
                  items: [
                    {
                      id,
                      runId: id,
                      kind: "RUN",
                      name: "FAKE Opening",
                      locationId: location,
                      status: run.status,
                      dueAt: run.dueAt,
                      version: run.version,
                      overdue: true,
                    },
                  ],
                },
              };
            if (q.includes("query ChecklistInbox"))
              data = {
                bmsChecklistInbox: {
                  total: 1,
                  unread: noticeRead ? 0 : 1,
                  items: [
                    {
                      id: "00000000-0000-4000-8000-000000000005",
                      runId: id,
                      kind: "ASSIGNED",
                      name: "FAKE Opening",
                      runStatus: run.status,
                      createdAt: run.createdAt,
                      readAt: noticeRead ? run.createdAt : null,
                    },
                  ],
                },
              };
            if (q.includes("query ChecklistSupervision"))
              data = {
                bmsChecklistSupervision: {
                  total: 1,
                  policies: [
                    {
                      locationId: location,
                      name: "FAKE Branch",
                      supervisorId: actor,
                      reminderMinutes: 30,
                      escalationMinutes: 60,
                      enabled: false,
                      version: 1,
                    },
                  ],
                  supervisors: [{ id: actor, name: "FAKE Supervisor" }],
                  escalations: [
                    {
                      id: "00000000-0000-4000-8000-000000000006",
                      runId: id,
                      locationId: location,
                      name: "FAKE Opening",
                      recipient: actor,
                      reason: "FAKE help",
                      source: "MANUAL",
                      status: "OPEN",
                      version: 1,
                      createdAt: run.createdAt,
                      acknowledgedAt: null,
                    },
                  ],
                },
              };
            if (q.includes("query ChecklistInspectionReport"))
              data = {
                bmsChecklistInspectionReport: {
                  ...v.filter,
                  timezone: "Asia/Bangkok",
                  generatedAt: run.createdAt,
                  problemsTruncated: false,
                  branches: [
                    {
                      locationId: location,
                      name: "FAKE Branch",
                      total: 2,
                      voided: 0,
                      approved: 1,
                      onTime: 1,
                      overdue: 1,
                      review: 0,
                      failedRuns: 2,
                      openActions: 1,
                    },
                  ],
                  problems: [
                    {
                      locationId: location,
                      branch: "FAKE Branch",
                      familyId: templateId,
                      itemKey: "cold",
                      name: "FAKE Opening",
                      runs: 2,
                      lastDue: run.dueAt,
                    },
                  ],
                },
              };
            if (q.includes("mutation ChecklistFollowup")) {
              followupWrites.push(v.input);
              if (v.input.action === "READ_NOTICE" && loseFollowupResponse) {
                loseFollowupResponse = false;
                return route.abort("connectionreset");
              }
              if (v.input.action === "READ_NOTICE") noticeRead = true;
              data = {
                bmsChecklistFollowup: {
                  status: "OK",
                  id: v.input.id ?? location,
                  version: 2,
                },
              };
            }
            if (q.includes("mutation ChecklistCommand")) {
              writes.push(v.input);
              if (loseResponse) {
                loseResponse = false;
                return route.abort("connectionreset");
              }
              if (v.input.action === "RECORD") {
                run.version = 2;
                run.status = "IN_PROGRESS";
                run.results = [
                  {
                    id: "1",
                    itemKey: "cold",
                    revision: 1,
                    value: v.input.value,
                    outcome: "PASS",
                    note: "",
                    photoIds: [],
                    recordedBy: actor,
                    recordedAt: "2026-10-24T01:10:00Z",
                  },
                ];
                run.history = run.results;
              }
              if (v.input.action === "PUBLISH") template.status = "ACTIVE";
              data = {
                bmsChecklistCommand: {
                  status: "OK",
                  id: v.input.id,
                  version: run.version,
                },
              };
            }
          }
          if(q.includes('MaterialForRun'))data={bmsMaterialForRun:null};
          if(q.includes('ImprovementForRun'))data={bmsImprovementForRun:null};
          if(q.includes('StandardReadiness'))data={bmsOperationReadiness:{configured:false,ready:false,standards:[]}};
          json = { data };
        }
        await route.fulfill({ json });
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/admin/operations`, {
        waitUntil: "domcontentloaded",
      });
      await page.screenshot({
        path: `${output}/${lang}-${width}-initial.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "FAKE Opening", exact: true })
        .click();
      const drawer = page
        .locator(".ant-drawer-body")
        .filter({ has: page.getByText("FAKE temperature", { exact: false }) });
      await drawer.getByRole("spinbutton").fill("0");
      // Locate translations from the real dictionary instead of guessing copy.
      const dictionary = readFileSync(
        new URL(`../apps/web/i18n/${lang}.ts`, import.meta.url),
        "utf8",
      );
      const section = dictionary.slice(
        dictionary.indexOf("operation_checklists:"),
      );
      const label = (key) => {
        const found = section.match(
          new RegExp(`(?:^|\\n|,)\\s*${key}:\\s*["']([^"']+)["']`),
        );
        assert.ok(found, `translation ${key}`);
        return found[1];
      };
      await drawer
        .getByRole("button", { name: label("save"), exact: true })
        .click();
      await page
        .locator(".ant-modal")
        .getByRole("button", { name: label("retry"), exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector(".ant-tag")?.textContent?.length > 0,
      );
      await page.waitForTimeout(500);
      assert.equal(writes.length, 2);
      assert.deepEqual(
        writes[0],
        writes[1],
        "Lost response retries exact payload/key",
      );
      assert.equal(writes[1].value, 0, "Zero is not missing");
      await page.screenshot({
        path: `${output}/${lang}-${width}-run.png`,
        fullPage: true,
      });
      await page.locator(".ant-drawer-open .ant-drawer-close").click();
      await page.waitForTimeout(500);
      await selectTab("templates");
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${output}/${lang}-${width}-templates-list.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: label("publish"), exact: true })
        .click();
      const modal = page.locator(".ant-modal-confirm");
      await modal.getByText(templateId, { exact: true }).waitFor();
      await modal
        .getByRole("button", { name: label("confirm"), exact: true })
        .click();
      await page.waitForTimeout(500);
      assert.equal(writes.at(-1).action, "PUBLISH");
      assert.equal(writes.at(-1).confirmed, true);
      await page
        .getByRole("button", { name: label("new_template"), exact: true })
        .click();
      await page
        .getByRole("textbox", { name: label("name"), exact: true })
        .fill("FAKE draft");
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${output}/${lang}-${width}-template.png`,
        fullPage: true,
      });
      await page.locator(".ant-drawer-open .ant-drawer-close").click();
      await selectTab("schedules");
      await selectTab("actions");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
        "No document overflow",
      );
      await page.screenshot({
        path: `${output}/${lang}-${width}-workspace.png`,
        fullPage: true,
      });
      await selectTab("runs");
      await page
        .getByPlaceholder(label("search"), { exact: true })
        .fill("FAKE search");
      await page.waitForTimeout(500);
      assert.ok(
        filters.some((f) => f.search === "FAKE search"),
        "Server-side search",
      );
      async function selectTab(key, text = label(key)) {
        const target = page.getByRole("tab", { name: text, exact: true });
        const nav = page
          .locator(".ant-tabs-nav")
          .filter({ has: target })
          .first();
        if (
          width < 600 &&
          (await nav.locator(".ant-tabs-nav-more").isVisible())
        ) {
          await nav.locator(".ant-tabs-nav-more").hover();
          const option = page.getByRole("option", {
            name: text,
            exact: true,
          });
          await option
            .waitFor({ state: "visible", timeout: 1500 })
            .catch(() => {});
          if (await option.count()) {
            await option.click();
            if ((await target.getAttribute("aria-selected")) !== "true") {
              await target.focus();
              await target.press("Enter");
            }
            return;
          }
          await page.mouse.move(0, 0);
        }
        await target.click().catch(async (e) => {
          await page.screenshot({
            path: `${output}/${lang}-${width}-tab-failure.png`,
            fullPage: true,
          });
          console.log(await nav.innerText());
          throw e;
        });
        if ((await target.getAttribute("aria-selected")) !== "true") {
          await target.focus();
          await target.press("Enter");
        }
      }
      await selectTab("followup");
      await page
        .getByRole("tab", { name: label("my_work"), exact: true })
        .waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${output}/${lang}-${width}-my-work.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: label("view"), exact: true })
        .click();
      await page
        .getByRole("button", { name: label("escalate"), exact: true })
        .click();
      await page
        .getByRole("textbox", { name: label("reason"), exact: true })
        .fill("FAKE manual escalation");
      await page
        .locator(".ant-modal")
        .getByRole("button", { name: label("confirm"), exact: true })
        .click();
      await page.waitForTimeout(400);
      assert.equal(followupWrites.at(-1).action, "ESCALATE");
      await page.locator(".ant-drawer-open .ant-drawer-close").click();
      await page.waitForTimeout(500);
      await selectTab("notices");
      await page
        .getByRole("button", { name: label("mark_read"), exact: true })
        .click();
      await page
        .locator(".ant-modal")
        .getByRole("button", { name: label("retry"), exact: true })
        .click();
      await page.waitForTimeout(400);
      const reads = followupWrites.filter((w) => w.action === "READ_NOTICE");
      assert.equal(reads.length, 2);
      assert.deepEqual(
        reads[0],
        reads[1],
        "Follow-up lost response retains exact key/payload",
      );
      assert.equal(noticeRead, true);
      await selectTab("supervision");
      await page
        .getByRole("button", { name: label("acknowledge"), exact: true })
        .click();
      await page
        .getByRole("textbox", { name: label("reason"), exact: true })
        .fill("FAKE response");
      await page
        .locator(".ant-modal")
        .getByRole("button", { name: label("confirm"), exact: true })
        .click();
      await page.waitForTimeout(400);
      assert.equal(followupWrites.at(-1).action, "ACKNOWLEDGE");
      assert.equal(followupWrites.at(-1).confirmed, true);
      await page
        .getByRole("button", {
          name: label("configure_supervisor"),
          exact: true,
        })
        .click();
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${output}/${lang}-${width}-supervisor-policy.png`,
        fullPage: true,
      });
      await page
        .locator(".ant-modal")
        .getByRole("button", { name: label("cancel"), exact: true })
        .click();
      await page
        .getByRole("button", { name: label("edit"), exact: true })
        .click();
      await page
        .locator(".ant-modal")
        .getByRole("spinbutton")
        .first()
        .fill("45");
      await page
        .locator(".ant-modal")
        .getByRole("button", { name: label("confirm"), exact: true })
        .click();
      await page.waitForTimeout(400);
      assert.equal(followupWrites.at(-1).action, "SAVE_POLICY");
      assert.equal(followupWrites.at(-1).reminderMinutes, 45);
      await selectTab("inspection_report");
      await page.getByText("50.0%", { exact: true }).waitFor();
      await page.waitForTimeout(400);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
        "Release C has no document overflow",
      );
      assert.equal(
        await page.getByText(/operation_checklists\./).count(),
        0,
        "No raw translation keys",
      );
      await page.screenshot({
        path: `${output}/${lang}-${width}-inspection-report.png`,
        fullPage: true,
      });
      const teamSection = dictionary.slice(
        dictionary.indexOf("operation_team:"),
        dictionary.indexOf("operation_checklists:"),
      );
      const tl = (k) => {
        const found = teamSection.match(new RegExp(`"${k}":\\s*"([^"]+)"`));
        assert.ok(found, `team translation ${k}`);
        return found[1];
      };
      await selectTab("templates");
      await page
        .getByRole("button", { name: label("create_run"), exact: true })
        .click();
      const modeControl = page
        .locator(".ant-modal:visible")
        .getByRole("combobox", { name: tl("assignment"), exact: true });
      await modeControl.focus();
      await modeControl.press("ArrowDown");
      await page.getByText(tl("by_duty"), { exact: true }).last().click();
      await page
        .getByRole("textbox", { name: tl("duty_key"), exact: true })
        .fill("kitchen");
      await page
        .locator(".ant-modal:visible")
        .getByRole("button", { name: label("confirm"), exact: true })
        .click();
      await page.waitForTimeout(400);
      assert.equal(writes.at(-1).assignmentMode, "DUTY");
      assert.equal(writes.at(-1).assignedTo, null);
      assert.equal(writes.at(-1).dutyKey, "kitchen");
      await selectTab("", tl("tab"));
      await page
        .getByRole("button", { name: tl("new_roster"), exact: true })
        .click();
      let teamModal = page.locator(".ant-modal:visible");
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${output}/${lang}-${width}-team-roster-empty.png`,
        fullPage: true,
      });
      await teamModal
        .getByRole("combobox", { name: tl("branch"), exact: true })
        .click();
      await page.getByText("FAKE Branch", { exact: true }).last().click();
      await teamModal
        .getByRole("textbox", { name: tl("duty_key"), exact: true })
        .fill("kitchen");
      await teamModal
        .getByRole("textbox", { name: tl("duty_name"), exact: true })
        .fill("FAKE Duty");
      await page.screenshot({
        path: `${output}/${lang}-${width}-team-roster-form.png`,
        fullPage: true,
      });
      await teamModal
        .getByRole("button", { name: tl("confirm"), exact: true })
        .click();
      await page
        .getByRole("button", { name: tl("retry"), exact: true })
        .click();
      await page.waitForTimeout(500);
      assert.deepEqual(
        teamWrites[0],
        teamWrites[1],
        "Team retry preserves exact command",
      );
      // A successful retry refreshes state; close the original confirmation form if it remains.
      if (await page.locator(".ant-modal:visible").count())
        await page
          .locator(".ant-modal:visible")
          .getByRole("button", { name: tl("close"), exact: true })
          .click();
      await page
        .getByRole("button", { name: tl("publish"), exact: true })
        .click();
      await page
        .locator(".ant-modal:visible")
        .getByRole("button", { name: tl("confirm"), exact: true })
        .click();
      await page.waitForTimeout(500);
      assert.equal(teamWrites.at(-1).action, "PUBLISH_ROSTER");
      await page.screenshot({
        path: `${output}/${lang}-${width}-team-rosters.png`,
        fullPage: true,
      });
      await selectTab("", tl("handovers"));
      await page.getByRole("button", { name: tl("open"), exact: true }).click();
      await page
        .getByRole("button", { name: tl("receive"), exact: true })
        .click();
      await page
        .locator(".ant-modal:visible")
        .getByRole("button", { name: tl("confirm"), exact: true })
        .click();
      await page.waitForTimeout(500);
      assert.equal(teamWrites.at(-1).action, "RECEIVE_HANDOVER");
      await page
        .getByRole("button", { name: tl("transfer"), exact: true })
        .click();
      await page
        .getByRole("textbox", { name: tl("note"), exact: true })
        .fill("FAKE explicit transfer");
      await page
        .locator(".ant-modal:visible")
        .getByRole("button", { name: tl("confirm"), exact: true })
        .click();
      await page.waitForTimeout(500);
      assert.equal(teamWrites.at(-1).action, "TRANSFER_ITEM");
      assert.equal(teamWrites.at(-1).itemVersion, 1);
      await page.screenshot({
        path: `${output}/${lang}-${width}-team-handover.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "FAKE pending", exact: true })
        .click();
      await page
        .getByText("FAKE temperature", { exact: false })
        .first()
        .waitFor();
      await page.waitForTimeout(500);
      await page.locator(".ant-drawer-open .ant-drawer-close").click();
      await page.waitForTimeout(500);
      await selectTab("", tl("summary"));
      await page
        .getByRole("tabpanel", { name: tl("summary"), exact: true })
        .getByRole("combobox", { name: tl("branch"), exact: true })
        .click();
      await page.getByText("FAKE Branch", { exact: true }).last().click();
      await page
        .getByRole("button", { name: tl("confirm_day"), exact: true })
        .click();
      await page
        .getByRole("textbox", { name: tl("note"), exact: true })
        .fill("FAKE manager reviewed");
      await page
        .locator(".ant-modal:visible")
        .getByRole("button", { name: tl("confirm"), exact: true })
        .click();
      await page.waitForTimeout(500);
      assert.equal(teamWrites.at(-1).action, "CONFIRM_DAY");
      assert.equal(teamWrites.at(-1).fingerprint, "fake-fingerprint");
      await page.screenshot({
        path: `${output}/${lang}-${width}-team-summary.png`,
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
        "Release D no document overflow",
      );
      assert.equal(
        await page.getByText(/operation_team\./).count(),
        0,
        "No raw D keys",
      );
      await page
        .getByRole("button", { name: tl("notifications"), exact: true })
        .click();
      await page.getByRole("button", { name: tl("read"), exact: true }).click();
      await page.waitForTimeout(400);
      assert.equal(teamWrites.at(-1).source, "TEAM");
      await page.screenshot({
        path: `${output}/${lang}-${width}-operations-bell.png`,
        fullPage: true,
      });
      await page
        .locator(".ant-drawer-open")
        .getByRole("link", { name: tl("open"), exact: true })
        .click();
      await page.getByText("FAKE handover note", { exact: true }).waitFor();
      await page.waitForTimeout(400);
      await page.locator(".ant-drawer-open .ant-drawer-close").click();
      await page.goto(`${base}/admin/operations?roster=${rosterId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByText("FAKE Duty", { exact: false }).first().waitFor();
      await page.waitForTimeout(400);
      await page.goto(`${base}/admin/manual`, {
        waitUntil: "domcontentloaded",
      });
      const manualLink = page.locator('a[href="/admin/operations"]').first();
      await manualLink.waitFor();
      await manualLink.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${lang}-${width}-manual.png` });
      assert.deepEqual(errors, [], "No page runtime errors");
      deny = true;
      await page.goto(`${base}/admin/operations`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByText(label("denied"), { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "FAKE Opening", exact: true })
          .count(),
        0,
      );
      await context.close();
      console.log(
        `PASS ${lang} ${width}px: UI, SDL, retry, confirmation, denial, overflow`,
      );
    }
} finally {
  await browser.close();
}
