// Real Next route + compiled schema, mocked auth/GraphQL. No live tenant or business writes.
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
const output = ".test-output/operation-production-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["en", "th"])
    for (const width of [1280, 390]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 1000 },
        serviceWorkers: "block",
      });
      ctx.setDefaultTimeout(20000);
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
      );
      const start =
        dictionary.indexOf("operation_production:") +
        "operation_production:".length;
      const tr = JSON.parse(
        dictionary
          .slice(start, dictionary.indexOf(",\n  operation_team:", start))
          .trim(),
      );
      const id = "00000000-0000-4000-8000-000000000001",
        location = "00000000-0000-4000-8000-000000000002",
        actor = "00000000-0000-4000-8000-000000000003",
        recipe = "00000000-0000-4000-8000-000000000004";
      const template = {
        id: recipe,
        familyId: recipe,
        name: "FAKE Prep checklist",
        category: "PREP",
        version: 1,
        status: "ACTIVE",
        locationId: location,
        stationId: null,
        items: [],
        separateReviewer: true,
        createdAt: "2026-10-24T01:00:00Z",
      };
      const batch = {
        id,
        location_id: location,
        run_id: id,
        output_sku: "FAKE-PREP",
        output_size: "BASE",
        planned_qty: 10,
        actual_qty: null,
        status: "READY",
        version: 2,
        due_at: "2026-10-24T12:00:00Z",
        assigned_to: actor,
        snapshot: {
          recipeSku: "FAKE-RECIPE",
          recipeVersion: 1,
          ingredients: [
            { sku: "FAKE-ING", size: "BASE", qty: 20, baseUnit: "PIECE" },
          ],
          sop: ["FAKE mix"],
        },
        costVisible: true,
        value: null,
        unitCost: null,
        inputs: [],
        waste: [],
        events: [],
        lot: null,
      };
      const writes = [],
        errors = [],
        outcomes = new Map();
      let lose = true,
        denied = false,
        rejectRetry = false,
        rejectedAttempts = 0;
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
          if (q.includes("MyBmsPermissions"))
            data = {
              myBmsPermissions: denied
                ? []
                : [
                    "operations.checklist.view",
                    "operations.checklist.manage",
                    "operations.checklist.execute",
                    "operations.production.manage",
                    "operations.production.post",
                    "product.view",
                    "report.view",
                    "stock.adjust",
                  ],
            };
          if (/Production|ChecklistWorkspace/.test(q)) {
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
                templates: [template],
                runs: [],
                schedules: [],
                actions: [],
              },
            };
          if (q.includes("OperationInbox"))
            data = { bmsOperationInbox: { items: [], total: 0, unread: 0 } };
          if (q.includes("ProductionWorkspace"))
            data = {
              bmsProductionWorkspace: {
                rows: [batch],
                total: 1,
                recipes:
                  v.filter.recipeSearch === "FAKE-RECIPE"
                    ? [
                        {
                          id: recipe,
                          product_sku: "FAKE-RECIPE",
                          size: "BASE",
                          version: 1,
                        },
                      ]
                    : [],
                outputs:
                  v.filter.outputSearch === "FAKE-PREP"
                    ? [
                        {
                          product_sku: "FAKE-PREP",
                          size: "BASE",
                          base_unit: "PIECE",
                        },
                      ]
                    : [],
                optionsTruncated: false,
              },
            };
          if (q.includes("ProductionDetail"))
            data = { bmsProductionDetail: batch };
          if (q.includes("ProductionPreview"))
            data = {
              bmsProductionPreview: {
                output: { available: 5 },
                ingredients: [
                  { sku: "FAKE-ING", size: "BASE", qty: 20, available: 100 },
                ],
                sop: ["FAKE mix"],
              },
            };
          if (q.includes("ProductionCommand")) {
            const i = v.input;
            writes.push(i);
            if (rejectRetry) {
              rejectedAttempts++;
              if (rejectedAttempts === 1) {
                // First attempt committed; its response was lost before authorization was revoked.
                batch.version++;
                batch.lot.qty -= i.qty;
                batch.waste.push({
                  id: "FAKE-rejected-retry",
                  qty: i.qty,
                  reason: i.note,
                });
                return route.abort("connectionreset");
              }
              return route.fulfill({
                json: {
                  errors: [
                    {
                      message: "FAKE revoked permission",
                      extensions: { code: "FORBIDDEN" },
                    },
                  ],
                },
              });
            }
            if (!outcomes.has(i.idempotencyKey)) {
              if (i.action === "POST")
                Object.assign(batch, {
                  status: "POSTED",
                  version: 3,
                  actual_qty: i.actualQty,
                  produced_on: i.producedOn,
                  expiry_date: i.expiryDate,
                  value: "40.000000",
                  unitCost: "5.000000",
                  lot: { lot_no: "PREP-FAKE", qty: 8 },
                  inputs: [
                    {
                      product_sku: "FAKE-ING",
                      size: "BASE",
                      qty: 20,
                      lots: [{ id: recipe, qty: 20 }],
                    },
                  ],
                });
              if (i.action === "WASTE") {
                batch.version++;
                batch.lot.qty -= i.qty;
                batch.waste.push({ id: recipe, qty: i.qty, reason: i.note });
              }
              outcomes.set(i.idempotencyKey, {
                status: "OK",
                id,
                version: batch.version,
              });
            }
            if (i.action === "POST" && lose) {
              lose = false;
              return route.abort("connectionreset");
            }
            data = { bmsProductionCommand: outcomes.get(i.idempotencyKey) };
          }
          if(q.includes('MaterialForRun'))data={bmsMaterialForRun:null};
          if(q.includes('ImprovementForRun'))data={bmsImprovementForRun:null};
          json = { data };
        }
        await route.fulfill({ json });
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/admin/operations?production=${id}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: tr.post, exact: true }).click();
      let modal = page.locator(".ant-modal:visible");
      await modal.getByLabel(tr.actual, { exact: true }).fill("8");
      await modal.getByLabel(tr.expiry, { exact: true }).fill("2099-12-31");
      await modal
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE yield evidence");
      await modal.getByRole("button", { name: tr.review, exact: true }).click();
      await page.getByText(tr.confirm, { exact: true }).waitFor();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `${output}/${lang}-${width}-confirm.png`,
        fullPage: true,
      });
      await page
        .locator(".ant-modal:visible .ant-modal-footer .ant-btn-primary")
        .click();
      const retry =
        lang === "en" ? "Retry same command" : "ลองคำสั่งเดิมอีกครั้ง";
      // Use the real D retry translation, not assumed copy.
      const teamText = dictionary.slice(dictionary.indexOf("operation_team:"));
      const retryMatch = teamText.match(/"retry":\s*"([^"]+)"/);
      assert.ok(retryMatch);
      await page
        .getByRole("button", { name: retryMatch[1], exact: true })
        .click();
      await page.getByText("40.000000", { exact: false }).waitFor();
      assert.equal(writes[0].idempotencyKey, writes[1].idempotencyKey);
      assert.equal(writes[0].ingredients[0].baseUnit, undefined);
      await page.getByRole("button", { name: tr.waste, exact: true }).click();
      modal = page.locator(".ant-modal:visible");
      await modal.getByLabel(tr.quantity, { exact: true }).fill("2");
      await modal.getByLabel(tr.note, { exact: true }).fill("FAKE expired");
      await modal.getByRole("button", { name: tr.review, exact: true }).click();
      await page
        .locator(".ant-modal:visible .ant-modal-footer .ant-btn-primary")
        .click();
      await page.getByText("2 — FAKE expired", { exact: true }).waitFor();
      assert.equal(writes.at(-1).action, "WASTE");
      await page.locator(".ant-modal:visible").waitFor({ state: "hidden" });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${output}/${lang}-${width}-posted.png`,
        fullPage: true,
      });
      await page.locator(".ant-drawer-open .ant-drawer-close").click();
      assert.equal(await page.getByLabel(tr.from, { exact: true }).count(), 1);
      assert.equal(await page.getByLabel(tr.to, { exact: true }).count(), 1);
      const branch = page.getByRole("combobox").first();
      await branch.click();
      await page
        .locator(".ant-select-item-option")
        .filter({ hasText: "FAKE Branch" })
        .click();
      // Branch changes remount the deep-link panel; close that detail before creating.
      await page.waitForTimeout(300);
      if (await page.locator(".ant-drawer-open .ant-drawer-close").count())
        await page.locator(".ant-drawer-open .ant-drawer-close").click();
      await page.getByRole("button", { name: tr.create, exact: true }).click();
      modal = page.locator(".ant-modal:visible");
      const choose = async (label, text) => {
        await modal.getByLabel(label, { exact: true }).click();
        if (label === tr.recipe || label === tr.output)
          await modal.getByLabel(label, { exact: true }).fill(text);
        await page
          .locator(".ant-select-item-option:visible")
          .filter({ hasText: text })
          .click();
      };
      await choose(tr.recipe, "FAKE-RECIPE");
      await choose(tr.output, "FAKE-PREP");
      await choose(tr.template, "FAKE Prep checklist");
      await modal.getByLabel(tr.planned, { exact: true }).fill("10");
      await modal.getByLabel(tr.due, { exact: true }).fill("2026-10-25T12:00");
      await modal.getByRole("button", { name: tr.review, exact: true }).click();
      await page.getByText(tr.preview_hint, { exact: true }).waitFor();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `${output}/${lang}-${width}-plan.png`,
        fullPage: true,
      });
      await page
        .locator(".ant-modal:visible .ant-modal-footer .ant-btn-primary")
        .click();
      await page.waitForTimeout(300);
      assert.equal(writes.at(-1).action, "CREATE");
      assert.equal(writes.at(-1).locationId, location);
      assert.equal(writes.at(-1).tenantId, undefined);
      assert.equal(await page.getByText(/operation_production\./).count(), 0);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
      );
      assert.deepEqual(errors, []);
      // A terminal rejection after an uncertain attempt must release the retry-only modal.
      await page.locator(".ant-modal:visible").waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "FAKE-PREP / BASE", exact: true })
        .click();
      await page.getByRole("button", { name: tr.waste, exact: true }).click();
      modal = page.locator(".ant-modal:visible");
      await modal.getByLabel(tr.quantity, { exact: true }).fill("1");
      await modal
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE denied retry");
      await modal.getByRole("button", { name: tr.review, exact: true }).click();
      rejectRetry = true;
      await page
        .locator(".ant-modal:visible .ant-modal-footer .ant-btn-primary")
        .click();
      await page
        .getByRole("button", { name: retryMatch[1], exact: true })
        .click();
      await page
        .getByRole("button", { name: retryMatch[1], exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(rejectedAttempts, 2);
      assert.equal(writes.at(-1).idempotencyKey, writes.at(-2).idempotencyKey);
      assert.equal(
        batch.lot.qty,
        5,
        "only the first uncertain attempt disposed stock; a denied retry must not repeat it",
      );
      const warning = teamText.match(/"retry_denied_hint":\s*"([^"]+)"/);
      assert.ok(warning);
      await page.getByText(warning[1], { exact: true }).waitFor();
      await page.getByText("1 — FAKE denied retry", { exact: true }).waitFor();
      assert.ok(new URL(page.url()).pathname.endsWith("/admin/operations"));
      rejectRetry = false;
      await page.goto(`${base}/admin/manual`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByText(tr.tab, { exact: true }).waitFor();
      await page.getByText(tr.tab, { exact: true }).scrollIntoViewIfNeeded();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
      );
      await page.screenshot({
        path: `${output}/${lang}-${width}-manual.png`,
        fullPage: false,
      });
      denied = true;
      await page.goto(`${base}/admin/operations`);
      await page.waitForTimeout(400);
      assert.equal(
        await page
          .getByRole("button", { name: tr.create, exact: true })
          .count(),
        0,
      );
      console.log(`Production browser fixture passed: ${lang} ${width}`);
      await ctx.close();
    }
} finally {
  await browser.close();
}
