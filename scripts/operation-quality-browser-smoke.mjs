// Compiled route and committed SDL; mocked auth/transport, no live tenant writes.
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
const output = ".test-output/operation-quality-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["en", "th"])
    for (const width of [1280, 390]) {
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
      const dict = readFileSync(
        new URL(`../apps/web/i18n/${lang}.ts`, import.meta.url),
        "utf8",
      );
      const start =
        dict.indexOf("operation_quality:") + "operation_quality:".length;
      const tr = JSON.parse(
        dict
          .slice(start, dict.indexOf(",\n  operation_material:", start))
          .trim(),
      );
      const [id, location, actor, lot, hold, decision, run] = Array.from(
        { length: 7 },
        (_, n) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
      );
      const d = {
        id,
        location_id: location,
        title: "FAKE quality incident",
        category: "QUALITY",
        severity: "URGENT",
        status: "REVIEW",
        version: 1,
        assigned_to: actor,
        due_at: "2026-10-24T12:00:45.000Z",
        facts: "FAKE damaged seal",
        hypothesis: "Unconfirmed cause",
        observed_cause: "Inspected",
        run: { id: run, status: "APPROVED", version: 4 },
        holds: [
          {
            id: hold,
            lot_id: lot,
            location_id: location,
            product_sku: "FAKE-H",
            size: "BASE",
            lot_no: "FAKE-LOT",
            qty: 10,
            base_unit: "PIECE",
            status: "ACTIVE",
            version: 1,
          },
        ],
        decisions: [
          {
            id: decision,
            hold_id: hold,
            kind: "DISPOSE",
            status: "PENDING",
            qty: 2,
            proposed_by: "different-person",
            note: "FAKE disposal proposal",
          },
        ],
        events: [],
      };
      const trace = {
        root: lot,
        fingerprint: "FAKE-hash",
        lots: [{ ...d.holds[0], id: lot, held: true }],
        productions: [],
        sales: [],
        receipts: [],
        returns: [{ source_id: lot, destination_id: "FAKE-returned-lot" }],
        coverage: "RECORDED_EVIDENCE_ONLY",
        restricted: false,
      };
      let denied = false,
        drop = false;
      const writes = [],
        outcomes = new Map(),
        errors = [];
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
          if (/Quality/.test(q)) {
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
          }
          if (q.includes("MyBmsPermissions"))
            data = {
              myBmsPermissions: denied
                ? ["operations.checklist.view"]
                : [
                    "operations.checklist.view",
                    "operations.checklist.manage",
                    "operations.quality.view",
                    "operations.quality.manage",
                    "operations.quality.hold",
                    "operations.quality.review",
                    "product.view",
                    "stock.adjust",
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
                staff: [{ id: actor, name: "FAKE Manager" }],
                stations: [],
                metrics: { open: 0, overdue: 0, review: 0, actions: 0 },
                templates: [],
                runs: [],
                schedules: [],
                actions: [],
              },
            };
          if (q.includes("OperationInbox"))
            data = { bmsOperationInbox: { items: [], total: 0, unread: 0 } };
          if (q.includes("QualityWorkspace"))
            data = {
              bmsQualityWorkspace: {
                rows: [d],
                total: 1,
                open: 1,
                review: 1,
                overdue: 1,
              },
            };
          if (q.includes("QualityDetail")) data = { bmsQualityDetail: d };
          if (q.includes("QualityLots"))
            data = {
              bmsQualityLots: {
                rows: [{ ...d.holds[0], id: lot, held: false }],
                hasMore: false,
              },
            };
          if (q.includes("QualityTrace")) data = { bmsQualityTrace: trace };
          if (q.includes("QualityCommand")) {
            const i = v.input;
            writes.push(i);
            assert.equal(i.tenantId, undefined);
            assert.equal(i.confirmed, true);
            if (!outcomes.has(i.idempotencyKey)) {
              d.version++;
              if (i.action === "APPROVE") {
                d.decisions[0].status = "APPLIED";
                d.holds[0].qty = 8;
              }
              if (i.action === "SAVE_TRACE")
                d.events.unshift({
                  action: "SAVE_TRACE",
                  note: i.note,
                  created_at: "2026-10-24T12:30:00Z",
                  trace,
                });
              outcomes.set(i.idempotencyKey, {
                status: "OK",
                id,
                version: d.version,
              });
            }
            if (drop) {
              drop = false;
              return route.abort("failed");
            }
            data = { bmsQualityCommand: outcomes.get(i.idempotencyKey) };
          }
          json = { data };
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(json),
        });
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/admin/operations?quality=${id}`);
      await page
        .getByRole("heading", { name: /FAKE quality incident/ })
        .waitFor();
      await page.screenshot({
        animations: "disabled",
        path: `${output}/${lang}-${width}-detail.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: tr.UPDATE, exact: true }).click();
      await page
        .getByLabel(tr.observedCause, { exact: true })
        .fill("FAKE corrected findings");
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE findings-only edit");
      await page.getByRole("button", { name: tr.preview, exact: true }).click();
      await page.getByRole("button", { name: tr.confirm, exact: true }).click();
      await page
        .locator(".ant-modal:visible")
        .first()
        .waitFor({ state: "hidden" });
      assert.equal(
        writes.at(-1).dueAt,
        d.due_at,
        "Findings-only edits preserve exact due time, including seconds",
      );
      writes.length = 0;
      await page.getByRole("button", { name: tr.APPROVE, exact: true }).click();
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE reviewed physical disposal");
      await page.getByRole("button", { name: tr.preview, exact: true }).click();
      await page
        .locator(".ant-modal:visible")
        .last()
        .getByText("FAKE-LOT", { exact: false })
        .waitFor();
      drop = true;
      await page.getByRole("button", { name: tr.confirm, exact: true }).click();
      const retry = dict
        .slice(dict.indexOf("operation_team:"))
        .match(/"retry":\s*"([^"]+)"/)[1];
      await page.getByRole("button", { name: retry, exact: true }).click();
      await page
        .locator(".ant-modal:visible")
        .first()
        .waitFor({ state: "hidden" });
      assert.equal(writes.length, 2);
      assert.equal(writes[0].decisionId, decision);
      assert.equal(writes[0].idempotencyKey, writes[1].idempotencyKey);
      assert.equal(d.holds[0].qty, 8);
      await page
        .getByRole("button", { name: tr.trace, exact: true })
        .first()
        .click();
      await page.getByText(tr.trace_limits, { exact: true }).waitFor();
      await page
        .getByRole("heading", { name: tr.returns, exact: true })
        .waitFor();
      await page.getByText("FAKE-returned-lot", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: tr.SAVE_TRACE, exact: true })
        .click();
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE impact reviewed");
      await page.getByRole("button", { name: tr.preview, exact: true }).click();
      await page.getByRole("button", { name: tr.confirm, exact: true }).click();
      await page
        .locator(".ant-modal:visible")
        .first()
        .waitFor({ state: "hidden" });
      assert.equal(writes.at(-1).fingerprint, "FAKE-hash");
      await page.screenshot({
        animations: "disabled",
        path: `${output}/${lang}-${width}-trace.png`,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /operation_quality\./,
      );
      assert.deepEqual(errors, []);
      const bounds = await page
        .locator(".ant-drawer-open .ant-drawer-content-wrapper")
        .last()
        .boundingBox();
      assert.ok(
        bounds && bounds.x >= -2 && bounds.x + bounds.width <= width + 2,
      );
      await page.goto(`${base}/admin/manual`);
      await page.getByText(tr.scope, { exact: true }).waitFor();
      await page.screenshot({
        animations: "disabled",
        path: `${output}/${lang}-${width}-manual.png`,
        fullPage: true,
      });
      denied = true;
      await page.goto(`${base}/admin/operations?quality=${id}`);
      await page.waitForLoadState("networkidle");
      assert.equal(
        await page.getByRole("tab", { name: tr.tab, exact: true }).count(),
        0,
      );
      await ctx.close();
      console.log(
        `PASS ${lang} ${width}: compiled quality workflow, confirmed disposal, uncertain retry, trace, manual, RBAC`,
      );
    }
} finally {
  await browser.close();
}
