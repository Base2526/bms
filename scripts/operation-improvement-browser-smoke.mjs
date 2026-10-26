// Real compiled route/schema; mocked auth and transport. No live business writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { buildSchema, parse, validate, getVariableValues } = require("graphql");
const schema = buildSchema(
  readFileSync(new URL("../schema.graphql", import.meta.url), "utf8"),
);
const { chromium } = await import(
  process.env.BMS_PLAYWRIGHT_MODULE || "playwright"
);
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3018";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".test-output/operation-improvement-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of process.env.BMS_SMOKE_LANG
    ? [process.env.BMS_SMOKE_LANG]
    : ["en", "th"])
    for (const width of process.env.BMS_SMOKE_WIDTH
      ? [Number(process.env.BMS_SMOKE_WIDTH)]
      : [1280, 390]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 1000 },
        serviceWorkers: "block",
      });
      ctx.setDefaultTimeout(15000);
      await ctx.routeWebSocket("**/*", (s) =>
        s.onMessage((raw) => {
          if (JSON.parse(String(raw)).type === "connection_init")
            s.send(JSON.stringify({ type: "connection_ack" }));
        }),
      );
      await ctx.addCookies([
        { name: "ADMIN_COOKIE", value: "FAKE-ui-fixture", url: base },
        { name: "lang", value: lang, url: base },
      ]);
      const dictionary = readFileSync(
          new URL(`../apps/web/i18n/${lang}.ts`, import.meta.url),
          "utf8",
        ),
        start =
          dictionary.indexOf("operation_improvement:") +
          "operation_improvement:".length;
      const tr = JSON.parse(
        dictionary
          .slice(start, dictionary.indexOf(",\n  operation_production:", start))
          .trim(),
      );
      const team = dictionary.slice(dictionary.indexOf("operation_team:")),
        retry = team.match(/"retry":\s*"([^"]+)"/)[1];
      const ids = Array.from(
          { length: 8 },
          (_, n) =>
            `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
        ),
        [standard, location, actor, learner, template, action, issue, review] =
          ids;
      const source = {
        id: template,
        name: "FAKE Kitchen checklist",
        version: 1,
        type: "CHECKLIST",
        items: [],
      };
      const st = {
        id: standard,
        family_id: standard,
        location_id: location,
        duty_key: "kitchen",
        title: "FAKE Kitchen SOP",
        body: "FAKE pinned instructions",
        source,
        status: "ACTIVE",
        version: 1,
        training_required: true,
        learning: [],
        history: [],
        versions: [{ id: standard, version: 1, status: "ACTIVE" }],
      };
      const problem = {
        id: issue,
        location_id: location,
        title: "FAKE recurring temperature",
        category: "cold-chain",
        severity: "HIGH",
        owner_id: learner,
        hypothesis: "FAKE hypothesis",
        cause: "FAKE observed cause",
        status: "OPEN",
        version: 1,
        sources: [
          {
            id: action,
            run_id: action,
            item_key: "temperature",
            status: "VERIFIED",
            due_at: "2026-10-24T12:00:00Z",
          },
        ],
        followups: [],
        history: [],
      };
      let hasIssue = false,
        denied = false,
        loseAck = true,
        acknowledged = false,
        trained = false,
        assessment = null,
        saved = null,
        learningSequence = 1000,
        readinessReads = 0,
        catalogKinds = [];
      const writes = [],
        outcomes = new Map(),
        errors = [],
        requests = [];
      const branchFacts = {
        locationId: location,
        due: 1,
        onTime: 0,
        onTimePercent: 0,
        cancelled: 1,
        future: 1,
        backlog: [],
        repeats: [],
        yields: [],
        wasteValue: { known: "0.000000", unknown: 1, total: null },
        handover: { missing: 1, onTime: 0, late: 0, waiting: 1, cancelled: 0 },
        sources: {
          runs: [],
          production: [],
          waste: [],
          rosters: [],
          handovers: [],
          readiness: [
            {
              roster_id: template,
              location_id: location,
              assigned_to: learner,
              duty_key: "kitchen",
              standard_id: standard,
              training_required: true,
              acknowledged: false,
              trained: false,
              assessment: null,
            },
          ],
          issues: [problem],
        },
      };
      const report = {
        week: { from: "2026-10-24", to: "2026-10-30" },
        asOf: "2026-10-24T10:00:00Z",
        fingerprint: "FAKE-sha256",
        branches: [branchFacts],
        reviews: [],
      };
      await ctx.route("**/*", async (route) => {
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
          if (/Improvement|StandardReadiness|OperationWeeklyReport/.test(q)) {
            const doc = parse(q);
            assert.deepEqual(
              [
                ...validate(schema, doc),
                ...(getVariableValues(
                  schema,
                  doc.definitions.find((x) => x.kind === "OperationDefinition")
                    .variableDefinitions,
                  v,
                ).errors ?? []),
              ].map((x) => x.message),
              [],
            );
            requests.push(q);
          }
          if (q.includes("MyBmsPermissions"))
            data = {
              myBmsPermissions: denied
                ? ["operations.checklist.view"]
                : [
                    "operations.checklist.view",
                    "operations.checklist.manage",
                    "operations.checklist.execute",
                    "operations.checklist.review",
                    "operations.standard.manage",
                    "operations.standard.assess",
                    "operations.improvement.manage",
                    "operations.summary.review",
                    "operations.roster.manage",
                    "product.view",
                    "report.view",
                  ],
            };
          if (q.includes("ChecklistWorkspace"))
            data = {
              bmsChecklistWorkspace: {
                actorId: actor,
                total: 0,
                locations: [
                  { id: location, name: "FAKE Branch", active: true },
                ],
                staff: [
                  { id: actor, name: "FAKE Manager" },
                  { id: learner, name: "FAKE Learner" },
                ],
                stations: [],
                metrics: { open: 0, overdue: 0, review: 0, actions: 0 },
                templates: [
                  {
                    id: template,
                    familyId: template,
                    name: source.name,
                    category: "SAFETY",
                    version: 1,
                    status: "ACTIVE",
                    locationId: location,
                    stationId: null,
                    items: [],
                    separateReviewer: true,
                    createdAt: "2026-10-24T00:00:00Z",
                  },
                ],
                runs: [],
                schedules: [],
                actions: [],
              },
            };
          if (q.includes("OperationInbox"))
            data = { bmsOperationInbox: { items: [], total: 0, unread: 0 } };
          if (q.includes("ImprovementWorkspace"))
            data = {
              bmsImprovementWorkspace: {
                standards: [st],
                standardTotal: 1,
                issues: hasIssue ? [problem] : [],
                issueTotal: hasIssue ? 1 : 0,
                actorId: actor,
              },
            };
          if (q.includes("ImprovementDetail"))
            data = {
              bmsImprovementDetail:
                v.kind === "STANDARD"
                  ? st
                  : v.kind === "ISSUE"
                    ? problem
                    : saved,
            };
          if (q.includes("StandardReadiness")) {
            readinessReads++;
            data = {
              bmsOperationReadiness: {
                configured: true,
                ready: acknowledged && trained && assessment === "PASS",
                standards: [{ ...st, acknowledged, trained, assessment }],
              },
            };
          }
          if (q.includes("ImprovementCatalog")) {
            catalogKinds.push(v.kind);
            data = {
              bmsImprovementCatalog: {
                rows: [
                  { ...source, status: "ACTIVE", separate_reviewer: true },
                ],
                hasMore: false,
              },
            };
          }
          if (q.includes("ImprovementSources"))
            data = {
              bmsImprovementSources: {
                rows: [
                  {
                    id: action,
                    run_id: action,
                    item_key: "temperature",
                    status: "VERIFIED",
                    name: "FAKE original failure",
                    location_id: location,
                  },
                ],
                hasMore: false,
              },
            };
          if (q.includes("OperationWeeklyReport"))
            data = { bmsOperationWeeklyReport: report };
          if (q.includes("query ChecklistRun"))
            data = {
              bmsChecklistRun: {
                id: template,
                templateId: template,
                snapshot: {
                  name: source.name,
                  version: 1,
                  separateReviewer: true,
                  items: [],
                },
                locationId: location,
                assignedTo: learner,
                status: "OPEN",
                version: 1,
                dueAt: "2026-10-25T12:00:00Z",
                createdAt: "2026-10-24T10:00:00Z",
                startedAt: null,
                submittedAt: null,
                reviewedAt: null,
                reviewedBy: null,
                results: [],
                history: [],
                events: [],
                actions: [],
                evidence: [],
                assignmentEvidence: {},
              },
            };
          if (q.includes("ImprovementForRun"))
            data = {
              bmsImprovementForRun: {
                title: problem.title,
                target: "FAKE verify target",
              },
            };
          if (q.includes("ProductionForRun"))
            data = { bmsProductionForRun: null };
          if(q.includes('MaterialForRun'))data={bmsMaterialForRun:null};
          if (q.includes("ImprovementCommand")) {
            const i = v.input;
            writes.push(i);
            assert.equal(i.tenantId, undefined);
            assert.equal(i.confirmed, true);
            if (!outcomes.has(i.idempotencyKey)) {
              if (i.action === "ACK_STANDARD") {
                acknowledged = true;
                st.learning.push({
                  id: "1",
                  staff_id: actor,
                  kind: "ACK",
                  evidence: "FAKE acknowledged",
                  actor,
                });
              }
              if (i.action === "RECORD_TRAINING") {
                trained = true;
                st.learning.push({
                  id: "2",
                  staff_id: learner,
                  kind: "TRAINED",
                  evidence: i.note,
                  actor,
                });
              }
              if (i.action === "ASSESS_STANDARD") {
                assessment = i.outcome;
                st.learning.push({
                  id: String(learningSequence++),
                  staff_id: learner,
                  kind: i.outcome,
                  evidence: i.note,
                  actor,
                });
              }
              if (i.action === "ASSESS_STANDARD") {
                // Real histories stay capped at 100; readiness must still refresh.
                while (st.learning.length < 100)
                  st.learning.unshift({
                    id: String(learningSequence++),
                    staff_id: learner,
                    kind: "TRAINED",
                    evidence: "FAKE older evidence",
                    actor,
                  });
                st.learning = st.learning.slice(-100);
              }
              if (i.action === "PUBLISH_STANDARD") st.version++;
              if (i.action === "CREATE_ISSUE") hasIssue = true;
              if (i.action === "CREATE_FOLLOWUP") {
                problem.version++;
                problem.followups.push({
                  run_id: template,
                  target: i.target,
                  status: "OPEN",
                  assigned_to: learner,
                  due_at: i.dueAt,
                  baseline: {
                    issue: { cause: problem.cause, status: "OPEN", version: 1 },
                  },
                });
              }
              if (i.action === "CONFIRM_WEEK") {
                saved = {
                  id: review,
                  location_id: location,
                  version: 1,
                  note: i.note,
                  reviewed_by: actor,
                  snapshot: structuredClone(report),
                  history: [],
                };
                report.reviews = [
                  {
                    id: review,
                    location_id: location,
                    version: 1,
                    fingerprint: report.fingerprint,
                  },
                ];
              }
              outcomes.set(i.idempotencyKey, {
                status: "OK",
                id: i.action === "CREATE_ISSUE" ? issue : (i.id ?? standard),
                version: 1,
              });
            }
            if (i.action === "ACK_STANDARD" && loseAck) {
              loseAck = false;
              return route.abort("connectionreset");
            }
            data = { bmsImprovementCommand: outcomes.get(i.idempotencyKey) };
          }
          json = { data };
        }
        return route.fulfill({ json });
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      const selectTab = async (text) => {
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
          const option = page.getByRole("option", { name: text, exact: true });
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
        const box = await target.boundingBox();
        if (width < 600 && box && (box.x < 0 || box.x + box.width > width)) {
          // AntD's touch tab strip hides its overflow menu; use its supported keyboard activation.
          await target.focus();
          await page.keyboard.press("Enter");
          return;
        } else await target.click();
        if ((await target.getAttribute("aria-selected")) !== "true") {
          await target.focus();
          await target.press("Enter");
        }
      };
      const select = async (label, text) => {
        const modal = page.locator(".ant-modal:visible").last();
        try {
          await modal
            .getByRole("combobox", { name: label, exact: true })
            .click();
        } catch (e) {
          await page.screenshot({
            path: `${output}/${lang}-${width}-error.png`,
            fullPage: true,
          });
          console.log(
            await modal.locator("input").evaluateAll((xs) =>
              xs.map((x) => ({
                id: x.id,
                role: x.getAttribute("role"),
                aria: x.getAttribute("aria-label"),
              })),
            ),
          );
          throw e;
        }
        await page
          .locator(".ant-select-item-option:visible")
          .filter({ hasText: text })
          .click();
      };
      const confirm = async () => {
        await page
          .locator(".ant-modal:visible")
          .last()
          .getByRole("button", { name: tr.preview, exact: true })
          .click();
        try {
          await page.getByText(tr.confirm_title, { exact: true }).waitFor();
        } catch (e) {
          await page.screenshot({
            path: `${output}/${lang}-${width}-error.png`,
            fullPage: true,
          });
          console.log(
            await page
              .locator(".ant-form-item-explain-error")
              .allTextContents(),
          );
          throw e;
        }
        await page
          .locator(".ant-modal:visible .ant-modal-footer .ant-btn-primary")
          .click();
      };
      await page.goto(`${base}/admin/operations?improvement=1`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByRole("tab", { name: tr.standards, exact: true })
        .waitFor();
      await page.getByRole("combobox").first().click();
      await page
        .locator(".ant-select-item-option:visible")
        .filter({ hasText: "FAKE Branch" })
        .click();
      await page
        .getByRole("button", { name: tr.detail, exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: tr.ACK_STANDARD, exact: true })
        .click();
      await confirm();
      await page.getByRole("button", { name: retry, exact: true }).click();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll(".ant-modal")].some(
            (x) => x.getClientRects().length,
          ),
      );
      assert.equal(writes[0].idempotencyKey, writes[1].idempotencyKey);
      assert.equal(st.learning.filter((x) => x.kind === "ACK").length, 1);
      await page
        .getByRole("button", { name: tr.RECORD_TRAINING, exact: true })
        .click();
      await select(tr.staffId, "FAKE Learner");
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE practical exercise");
      await confirm();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll(".ant-modal")].some(
            (x) => x.getClientRects().length,
          ),
      );
      await page
        .getByRole("button", { name: tr.ASSESS_STANDARD, exact: true })
        .click();
      await select(tr.staffId, "FAKE Learner");
      await select(tr.outcome, tr.passed);
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE assessed evidence");
      await confirm();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll(".ant-modal")].some(
            (x) => x.getClientRects().length,
          ),
      );
      await page.screenshot({
        path: `${output}/${lang}-${width}-learning.png`,
        fullPage: true,
      });
      const priorReadinessReads = readinessReads;
      await page
        .getByRole("button", { name: tr.ASSESS_STANDARD, exact: true })
        .click();
      await select(tr.staffId, "FAKE Learner");
      await select(tr.outcome, tr.practice);
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE practice needed after reassessment");
      await confirm();
      await page
        .locator(".ant-drawer-open .ant-alert")
        .filter({ hasText: tr.readiness_hint })
        .getByText(tr.practice, { exact: true })
        .waitFor();
      assert.ok(readinessReads > priorReadinessReads);
      assert.equal(st.learning.length, 100);
      await page
        .getByRole("button", { name: tr.new_version, exact: true })
        .click();
      await page.getByLabel(tr.body, { exact: true }).fill("FAKE revised SOP");
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE revision requires new evidence");
      await confirm();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll(".ant-modal")].some(
            (x) => x.getClientRects().length,
          ),
      );
      assert.equal(writes.at(-1).carryAcknowledgement, false);
      assert.equal(writes.at(-1).carryTraining, false);
      assert.equal(writes.at(-1).version, 1);
      await page.locator(".ant-drawer-open .ant-drawer-close").click();
      await selectTab(tr.issues);
      await page
        .getByRole("button", { name: tr.CREATE_ISSUE, exact: true })
        .click();
      await select(tr.actionId, "FAKE original failure");
      await page.getByLabel(tr.title, { exact: true }).fill(problem.title);
      await page.getByLabel(tr.category, { exact: true }).fill("cold-chain");
      await select(tr.ownerId, "FAKE Learner");
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE issue evidence");
      await confirm();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll(".ant-modal")].some(
            (x) => x.getClientRects().length,
          ),
      );
      await page
        .getByRole("button", { name: tr.detail, exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: tr.CREATE_FOLLOWUP, exact: true })
        .click();
      await select(tr.templateId, source.name);
      assert.equal(
        catalogKinds.at(-1),
        "FOLLOWUP",
        "filter eligible templates on the server before pagination",
      );
      await select(tr.assignedTo, "FAKE Learner");
      await page.getByLabel(tr.dueAt, { exact: true }).fill("2026-10-25T12:00");
      await page
        .getByLabel(tr.target, { exact: true })
        .fill("FAKE verify target");
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE corrective plan");
      await confirm();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll(".ant-modal")].some(
            (x) => x.getClientRects().length,
          ),
      );
      await page
        .getByRole("cell", { name: "FAKE verify target", exact: true })
        .waitFor();
      await page.screenshot({
        path: `${output}/${lang}-${width}-issue.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: tr.open_run, exact: true })
        .last()
        .click();
      await page
        .locator(".ant-drawer-open")
        .last()
        .getByText("FAKE verify target", { exact: true })
        .waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${output}/${lang}-${width}-assignee-brief.png`,
        fullPage: true,
      });
      await page.locator(".ant-drawer-open .ant-drawer-close").last().click();
      await page.waitForTimeout(350);
      await page.locator(".ant-drawer-open .ant-drawer-close").click();
      await selectTab(tr.weekly);
      await page.getByLabel(tr.from, { exact: true }).fill("2026-10-24");
      await page
        .getByRole("button", { name: tr.CONFIRM_WEEK, exact: true })
        .click();
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE weekly review");
      await confirm();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll(".ant-modal")].some(
            (x) => x.getClientRects().length,
          ),
      );
      assert.equal(writes.at(-1).fingerprint, report.fingerprint);
      assert.equal(writes.at(-1).locationId, location);
      await page
        .getByRole("button", { name: tr.saved_snapshot, exact: true })
        .click();
      await page.getByText(tr.immutable_hint, { exact: true }).waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${output}/${lang}-${width}-weekly.png`,
        fullPage: true,
      });
      await page.locator(".ant-drawer-open .ant-drawer-close").click();
      assert.equal(await page.getByText(/operation_improvement\./).count(), 0);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
      );
      assert.deepEqual(errors, []);
      await page.goto(`${base}/admin/manual`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByText(tr.tab, { exact: true }).waitFor();
      assert.equal(await page.getByText(/operation_improvement\./).count(), 0);
      denied = true;
      await page.goto(`${base}/admin/operations?improvement=1`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByRole("tab", { name: tr.standards, exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: tr.PUBLISH_STANDARD, exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.getByRole("tab", { name: tr.weekly, exact: true }).count(),
        0,
      );
      assert.ok(requests.some((x) => x.includes("ImprovementCatalog")));
      assert.ok(requests.some((x) => x.includes("StandardReadiness")));
      console.log(
        `PASS Release F ${lang} ${width}px: learning, publish, issues, canonical followup, weekly confirmation, retry, permissions, translations`,
      );
      await ctx.close();
    }
} finally {
  await browser.close();
}
