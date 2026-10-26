// Compiled route + SDL, mocked auth/transport. No live tenant writes.
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
const output = ".test-output/operation-material-browser";
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
        ),
        start =
          dict.indexOf("operation_material:") + "operation_material:".length,
        tr = JSON.parse(
          dict
            .slice(start, dict.indexOf(",\n  operation_improvement:", start))
            .trim(),
        );
      const ids = Array.from(
          { length: 8 },
          (_, n) =>
            `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
        ),
        [
          id,
          location,
          actor,
          template,
          production,
          supplier,
          link,
          inspection,
        ] = ids;
      const facts = {
        fingerprint: "FAKE-hash",
        sources: [
          {
            id: production,
            outputSku: "FAKE-PREP",
            priority: 2,
            status: "READY",
            dueAt: "2026-10-24T10:00:00Z",
          },
        ],
        lines: [
          {
            sku: "FAKE-ING",
            size: "BASE",
            baseUnit: "PIECE",
            required: 20,
            available: 0,
            shortage: 20,
            pending: 0,
            uncovered: 20,
            usableThrough: "2026-10-24",
            compatible: true,
          },
        ],
      };
      const d = {
        id,
        location_id: location,
        location_name: "FAKE Branch",
        title: "FAKE materials",
        status: "CONFIRMED",
        version: 1,
        run_id: template,
        from_date: "2026-10-24",
        to_date: "2026-10-24",
        snapshot: facts,
        live: facts,
        changed: false,
        links: [
          {
            id: link,
            product_sku: "FAKE-ING",
            size: "BASE",
            qty: 20,
            received: 0,
            pending: 20,
            unknownReceipts: 0,
            po_id: supplier,
            po_item_id: "1",
            po_status: "OPEN",
            qty_received: 0,
            needed_at: "2026-10-24T10:00:00Z",
          },
        ],
        inspections: [
          {
            id: inspection,
            product_sku: "FAKE-ING",
            size: "BASE",
            base_unit: "PIECE",
            po_id: supplier,
            link_id: link,
            run_id: template,
            version: 1,
            run_version: 4,
            run_status: "APPROVED",
            accepted_qty: 12,
            rejected_qty: 2,
            lot_no: "FAKE-LOT",
            expiry_date: "2099-12-31",
            status: "PENDING",
          },
        ],
        receipts: [],
        events: [],
      };
      let denied = false,
        drop = false,
        loads = 0;
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
          if (/Material/.test(q)) {
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
                    "operations.checklist.execute",
                    "operations.checklist.review",
                    "operations.material.view",
                    "operations.material.manage",
                    "operations.material.review",
                    "product.view",
                    "purchase.view",
                    "purchase.edit",
                    "purchase.receive",
                    "report.view",
                    "inventory.requisition.view",
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
          if (q.includes("MaterialWorkspace"))
            data = { bmsMaterialWorkspace: { rows: [d], total: 1 } };
          if (q.includes("MaterialDetail")) {
            loads++;
            data = { bmsMaterialDetail: d };
          }
          if (q.includes("MaterialPreview"))
            data = { bmsMaterialPreview: facts };
          if (q.includes("MaterialTemplates"))
            data = {
              bmsImprovementCatalog: {
                rows: [
                  {
                    id: template,
                    name: "FAKE Checklist",
                    status: "ACTIVE",
                    separate_reviewer: true,
                  },
                ],
                hasMore: false,
              },
            };
          if (q.includes("MaterialCatalog"))
            data = {
              bmsMaterialCatalog: {
                rows: [
                  {
                    id:
                      v.kind === "PRODUCTION"
                        ? production
                        : v.kind === "SUPPLIER"
                          ? supplier
                          : "1",
                    name:
                      v.kind === "PRODUCTION"
                        ? "FAKE-PREP"
                        : v.kind === "SUPPLIER"
                          ? "FAKE Supplier"
                          : "FAKE-ING",
                  },
                ],
                hasMore: false,
              },
            };
          if (q.includes("MaterialCommand")) {
            const i = v.input;
            writes.push(i);
            assert.equal(i.tenantId, undefined);
            assert.equal(i.confirmed, true);
            if (!outcomes.has(i.idempotencyKey)) {
              d.version++;
              if (i.action === "RECEIVE") {
                d.inspections[0].status = "POSTED";
                d.links[0].received = 12;
                d.links[0].pending = 8;
                d.live.lines[0].available = 12;
                d.live.lines[0].shortage = 8;
                d.live.lines[0].pending = 8;
                d.live.lines[0].uncovered = 0;
                d.receipts = [
                  {
                    id: inspection,
                    product_sku: "FAKE-ING",
                    qty: 12,
                    lot_no: "FAKE-LOT",
                    expiry_date: "2099-12-31",
                    movement_id: "99",
                    created_at: "2026-10-24T10:10:00Z",
                  },
                ];
              }
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
            data = { bmsMaterialCommand: outcomes.get(i.idempotencyKey) };
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
      await page.goto(`${base}/admin/operations?material=${id}`);
      await page.getByRole("heading", { name: /FAKE materials/ }).waitFor();
      assert.ok(loads > 0);
      await page.screenshot({
        animations: "disabled",
        path: `${output}/${lang}-${width}-detail.png`,
        fullPage: true,
      });
      const choose = async (label, value) => {
        await page.getByLabel(label, { exact: true }).first().click();
        await page
          .locator(".ant-select-dropdown:visible")
          .getByText(value, { exact: false })
          .first()
          .click();
      };
      await page
        .getByRole("button", { name: tr.CREATE_PO, exact: true })
        .click();
      await choose(tr.supplierId, "FAKE Supplier");
      await page.getByLabel(tr.unitCost, { exact: true }).fill("2");
      await page.getByLabel(tr.dueAt, { exact: true }).fill("2026-10-24T12:00");
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE explicit purchase");
      await page.getByRole("button", { name: tr.preview, exact: true }).click();
      await page.getByRole("button", { name: tr.confirm, exact: true }).click();
      await page
        .locator(".ant-modal:visible")
        .first()
        .waitFor({ state: "hidden" });
      assert.equal(writes.at(-1).action, "CREATE_PO");
      assert.equal(writes.at(-1).unitCost, 2);
      await page.getByRole("button", { name: tr.RECEIVE, exact: true }).click();
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE accepted after review");
      await page.getByRole("button", { name: tr.preview, exact: true }).click();
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
      const receipts = writes.filter((x) => x.action === "RECEIVE");
      assert.equal(receipts.length, 2);
      assert.equal(receipts[0].idempotencyKey, receipts[1].idempotencyKey);
      assert.equal(receipts[0].expectedReceived, 0);
      assert.equal(receipts[0].runVersion, 4);
      assert.equal(d.receipts.length, 1);
      await page.screenshot({
        animations: "disabled",
        path: `${output}/${lang}-${width}-received.png`,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 2,
        ),
        false,
      );
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /operation_material\./,
      );
      assert.deepEqual(errors, []);
      d.live = null;
      d.liveError = "SOURCE_OUTSIDE_WINDOW";
      d.changed = true;
      await page.goto(`${base}/admin/operations?material=${id}`);
      await page.getByText(tr.live_unavailable, { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: tr.REFRESH, exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: tr.CLOSE, exact: true })
          .isEnabled(),
        true,
      );
      await page.getByText(tr.saved_snapshot, { exact: true }).waitFor();
      await page.screenshot({
        animations: "disabled",
        path: `${output}/${lang}-${width}-historical.png`,
        fullPage: true,
      });
      const drawerBounds = await page
        .locator(".ant-drawer-open .ant-drawer-content-wrapper")
        .boundingBox();
      assert.ok(
        drawerBounds &&
          drawerBounds.x >= -2 &&
          drawerBounds.x + drawerBounds.width <= width + 2,
        JSON.stringify(drawerBounds),
      );
      d.live = facts;
      d.liveError = null;
      d.changed = false;
      await page.goto(`${base}/admin/operations`);
      const branchLabel = dict
        .slice(dict.indexOf("operation_checklists:"))
        .match(/branch:\s*"([^"]+)"/)[1];
      await choose(branchLabel, "FAKE Branch");
      const materialTab = page.getByRole("tab", { name: tr.tab, exact: true });
      if (width < 600) {
        const more = page
          .locator(".ant-tabs-nav")
          .filter({ has: materialTab })
          .first()
          .locator(".ant-tabs-nav-more");
        await more.focus();
        await more.press("Enter");
        await page.getByRole("option", { name: tr.tab, exact: true }).click();
      } else await materialTab.click();
      await page.getByRole("button", { name: tr.CREATE, exact: true }).click();
      await page
        .getByLabel(tr.title, { exact: true })
        .fill("FAKE planned materials");
      await page.getByLabel(tr.from, { exact: true }).fill("2026-10-24");
      await page.getByLabel(tr.to, { exact: true }).fill("2026-10-24");
      await choose(tr.sources, "FAKE-PREP");
      await page.keyboard.press("Escape");
      await choose(tr.templateId, "FAKE Checklist");
      await choose(tr.assignedTo, "FAKE Manager");
      await page.getByLabel(tr.dueAt, { exact: true }).fill("2026-10-24T12:00");
      await page
        .getByLabel(tr.note, { exact: true })
        .fill("FAKE explicitly selected batches");
      await page.getByRole("button", { name: tr.preview, exact: true }).click();
      await page.screenshot({
        animations: "disabled",
        path: `${output}/${lang}-${width}-preview.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: tr.confirm, exact: true }).click();
      await page
        .locator(".ant-modal:visible")
        .first()
        .waitFor({ state: "hidden" });
      assert.equal(writes.at(-1).action, "CREATE");
      assert.deepEqual(writes.at(-1).sources, [
        { id: production, priority: 2 },
      ]);
      assert.equal(writes.at(-1).fingerprint, "FAKE-hash");
      assert.equal(writes.at(-1).locationId, location);
      assert.deepEqual(errors, []);
      const manual = await page.goto(`${base}/admin/manual`);
      assert.equal(manual.status(), 200);
      await page.locator("main").waitFor();
      await page.screenshot({
        animations: "disabled",
        path: `${output}/${lang}-${width}-manual.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      denied = true;
      await page.goto(`${base}/admin/operations`);
      await page.getByRole("tab").first().waitFor();
      await page
        .getByRole("tab", { name: tr.tab, exact: true })
        .waitFor({ state: "hidden" });
      console.log(
        `PASS materials ${lang} ${width}: SDL, explicit plan preview/create, PO form, reviewed receipt, lost response replay, responsive detail, denied tab`,
      );
      await ctx.close();
    }
} finally {
  await browser.close();
}
