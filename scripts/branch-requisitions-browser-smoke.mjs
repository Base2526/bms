import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const webRequire = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { buildSchema, parse, validate, getVariableValues } =
  webRequire("graphql");
const schema = buildSchema(
  readFileSync(new URL("../schema.graphql", import.meta.url), "utf8"),
);
const { chromium } = await import(
  process.env.BMS_PLAYWRIGHT_MODULE || "playwright"
);
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
  "Local UI fixture only",
);
const output = ".test-output/branch-requisitions-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th", "en"])
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        serviceWorkers: "block",
      });
      await context.routeWebSocket("**/*", (socket) =>
        socket.onMessage((raw) => {
          const m = JSON.parse(String(raw));
          if (m.type === "connection_init")
            socket.send(JSON.stringify({ type: "connection_ack" }));
        }),
      );
      await context.addCookies([
        { name: "ADMIN_COOKIE", value: "FAKE-ui-fixture", url: base },
        { name: "lang", value: lang, url: base },
      ]);
      const permissions = [
        "inventory.requisition.view",
        "inventory.requisition.create",
        "inventory.requisition.review",
        "inventory.transfer",
        "purchase.view",
        "purchase.edit",
      ];
      const source = "00000000-0000-4000-8000-000000000001",
        dest = "00000000-0000-4000-8000-000000000002";
      let request = {
        id: "00000000-0000-4000-8000-000000000003",
        requestNo: "REQ-261022-001",
        locationId: dest,
        locationName: "FAKE Branch B",
        status: "APPROVED",
        version: 3,
        neededOn: "2026-10-25",
        priority: "NORMAL",
        note: "FAKE test request",
        creator: "FAKE Manager",
        latestActor: "FAKE Reviewer",
        createdAt: "2026-10-22T10:00:00Z",
        items: [
          {
            id: "1",
            sku: "FAKE-BOX",
            size: "BASE",
            name: "FAKE Packaging",
            requested: 20,
            approved: 15,
            remaining: 15,
            drafts: 0,
            transit: 0,
            received: 0,
            discrepancy: 0,
            status: "UNALLOCATED",
            reviewNote: "FAKE reviewed",
            transfers: [],
            purchases: [
              {
                id: "00000000-0000-4000-8000-000000000004",
                status: "CANCELLED",
                qty: 4,
                ordered: 10,
                received: 2,
              },
            ],
          },
        ],
      };
      const writes = [];
      const readFilters = [];
      let deny = false;
      let loseNextCommandResponse = false,
        failReadsAfterWrite = false,
        failReads = false;
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
              id: "FAKE",
              role: "Administrator",
              name: "FAKE Manager",
              language: lang,
            },
          };
        else if (url.pathname === "/api/bms/inventory/transfers") {
          assert.equal(route.request().method(), "GET");
          if (url.searchParams.has("id"))
            assert.equal(url.searchParams.get("id"), source);
          json = {
            locations: [],
            transfers: [
              {
                id: source,
                transferNo: "FAKE-TRANSFER",
                fromLocationId: source,
                toLocationId: dest,
                fromLocationName: "FAKE Central",
                toLocationName: "FAKE Branch B",
                status: "RECEIVED",
                note: null,
                createdAt: "2026-10-22T10:00:00Z",
                sentAt: null,
                receivedAt: null,
                receivingNote: null,
                createdByName: "FAKE Reviewer",
                items: [
                  {
                    id: 1,
                    sku: "FAKE-BOX",
                    productName: "FAKE Packaging",
                    size: "BASE",
                    qty: 2,
                    receivedQty: 2,
                    damagedQty: 0,
                    missingQty: 0,
                  },
                ],
              },
            ],
          };
        } else if (url.pathname.endsWith("/graphql")) {
          const { query: q = "", variables: v = {} } =
            route.request().postDataJSON() || {};
          let data = {};
          if (q.includes("MyBmsPermissions"))
            data = { myBmsPermissions: deny ? [] : permissions };
          else if (q.includes("query BranchRequests") && failReads)
            return route.fulfill({
              json: {
                errors: [
                  {
                    message: "FAKE refresh unavailable",
                    extensions: { code: "INTERNAL_SERVER_ERROR" },
                  },
                ],
              },
            });
          else if (q.includes("query BranchRequests")) {
            readFilters.push(v.filter);
            data = {
              bmsBranchRequisitions: {
                total: 1,
                locations: [
                  { id: source, name: "FAKE Central", active: true },
                  { id: dest, name: "FAKE Branch B", active: true },
                ],
                rows: [{ __typename: "BmsRequisition", ...request }],
              },
            };
          } else if (q.includes("query RequisitionNotices"))
            data = { bmsBranchRequisitionNotices: [{id:"FAKE-NOTICE",requestId:request.id,requestNo:request.requestNo,kind:"TRANSFER_SENT",at:"2026-10-23T01:00:00Z"}] };
          else if (q.includes("query RequisitionMetrics"))
            data = {
              bmsBranchRequisitionMetrics: {
                submittedRequests: 3,
                requestedUnits: 30,
                pendingReview: 1,
                reviewedRequests: 2,
                approvedRequests: 2,
                partialRequests: 1,
                approvedUnits: 20,
                receivedUnits: 10,
                unallocatedUnits: 10,
                overdueRequests: 1,
                discrepancyUnits: 2,
                medianReviewHours: 1.5,
                medianFulfilmentHours: null,
              },
            };
          else if (q.includes("query RequisitionDemandRequests")) {
            assert.equal(v.sku, "FAKE-BOX");
            assert.equal(v.size, "BASE");
            data = {
              bmsBranchRequisitionDemandRequests: {
                total: 1,
                rows: [
                  {
                    id: request.id,
                    requestNo: request.requestNo,
                    branch: request.locationName,
                    neededOn: request.neededOn,
                    priority: request.priority,
                    remaining: 15,
                  },
                ],
              },
            };
          } else if (q.includes("query LinkedPurchaseOrder")) {
            assert.equal(v.id, source);
            data = {
              bmsPurchaseOrder: {
                id: source,
                status: "RECEIVED",
                total: 20,
                note: "FAKE linked PO",
                qtyOrdered: 2,
                qtyReceived: 2,
                createdAt: "2026-10-22T10:00:00Z",
                updatedAt: "2026-10-22T10:00:00Z",
                supplier: { id: source, name: "FAKE Supplier" },
                items: [
                  {
                    sku: "FAKE-BOX",
                    size: "BASE",
                    supplierSku: null,
                    supplierProductName: null,
                    qtyOrdered: 2,
                    qtyReceived: 2,
                    unitCost: 10,
                  },
                ],
              },
            };
          } else if (q.includes("BmsPurchaseOrders"))
            data = { bmsPurchaseOrders: [] };
          else if (q.includes("bmsSuppliers"))
            data = { bmsSuppliers: [{ id: source, name: "FAKE Supplier" }] };
          else if (q.includes("query RequestEvents"))
            data = {
              bmsBranchRequisitionEvents: [
                {
                  action: "REVIEW",
                  note: "FAKE reviewed",
                  actor: "FAKE Manager",
                  at: "2026-10-22T10:00:00Z",
                },
              ],
            };
          else if (q.includes("query RequestCatalog"))
            data = {
              bmsBranchRequisitionCatalog: [
                {
                  __typename: "BmsRequisitionProduct",
                  sku: "FAKE-BOX",
                  size: "BASE",
                  name: "FAKE Packaging",
                },
              ],
            };
          else if (q.includes("query RequestAvailability"))
            data = {
              bmsBranchRequisitionAvailability: [
                {
                  id: source,
                  name: "FAKE Central",
                  stock: 100,
                  reserved: 10,
                  quarantine: 2,
                  available: 90,
                },
              ],
            };
          else if (q.includes("query RequestDemand"))
            data = {
              bmsBranchRequisitionDemand: {
                total: 1,
                rows: [
                  {
                    sku: "FAKE-BOX",
                    size: "BASE",
                    name: "FAKE Packaging",
                    remaining: 15,
                    requests: 1,
                  },
                ],
              },
            };
          else if (q.includes("query RequisitionSuppliers"))
            data = { bmsSuppliers: [{ id: source, name: "FAKE Supplier" }] };
          else if (q.includes("query RequisitionPOs"))
            data = { bmsPurchaseOrders: [] };
          else if (q.includes("mutation RequestCommand")) {
            const document = parse(q);
            const errors = [
              ...validate(schema, document),
              ...(getVariableValues(
                schema,
                document.definitions.find(
                  (d) => d.kind === "OperationDefinition",
                ).variableDefinitions,
                v,
              ).errors ?? []),
            ];
            assert.deepEqual(
              errors.map((e) => e.message),
              [],
              "The UI command must be accepted by the real GraphQL input contract",
            );
            writes.push(v.input);
            if (loseNextCommandResponse) {
              loseNextCommandResponse = false;
              return route.abort("connectionreset");
            }
            if (failReadsAfterWrite) failReads = true;
            data = {
              bmsBranchRequisitionCommand: {
                status: "OK",
                id: request.id,
                transferId: null,
                poId: null,
              },
            };
          }
          json = { data };
        }
        return route.fulfill({ json });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(25000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const label = (th, en) => (lang === "th" ? th : en);
      const select = async (locator, text) => {
        await locator.locator(".ant-select-selector").click();
        await page
          .locator(".ant-select-item-option:visible")
          .filter({ hasText: text })
          .click();
      };
      try {
        assert.equal(
          (
            await page.goto(`${base}/admin/branch-requisitions`, {
              waitUntil: "domcontentloaded",
              timeout: 120000,
            })
          ).status(),
          200,
        );
        await page
          .getByRole("button", { name: "REQ-261022-001", exact: true })
          .waitFor();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: `${output}/${lang}-${width}-list.png`,
          fullPage: true,
        });
        await page.locator('summary').filter({hasText:label("การแจ้งเตือนล่าสุด","Latest 20 notifications")}).click();
        await page.getByRole("button",{name:`${request.requestNo} · ${label("ส่งใบโอนแล้ว","Transfer sent")}`,exact:true}).click();
        await page.locator('.ant-drawer-content').getByText(request.note,{exact:true}).waitFor();
        await page.locator('.ant-drawer-close').click();
        const reviewRead = page.waitForResponse(
          (r) =>
            r.url().endsWith("graphql") &&
            r.request().postData()?.includes('"SUBMITTED"'),
        );
        await page
          .getByRole("button", {
            name: label("คิวรอตรวจ", "Review queue"),
            exact: true,
          })
          .click();
        await reviewRead;
        assert.ok(readFilters.some((f) => f?.status === "SUBMITTED"));
        await page
          .getByLabel(label("ต้องการตั้งแต่วันที่", "Needed from"), {
            exact: true,
          })
          .fill("2026-10-01");
        await page
          .getByRole("button", {
            name: label("สรุปการดำเนินงาน", "Operational summary"),
            exact: true,
          })
          .click();
        await page.getByText("50.0%", { exact: true }).first().waitFor();
        assert.ok(readFilters.some((f) => f?.neededFrom === "2026-10-01"));
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: `${output}/${lang}-${width}-metrics.png`,
          fullPage: true,
        });
        await page
          .getByRole("button", {
            name: label("รวมความต้องการ", "Consolidated demand"),
            exact: true,
          })
          .click();
        await page.locator(".ant-table-row-expand-icon").first().click();
        await page
          .locator(".ant-table-expanded-row")
          .getByRole("button", { name: request.requestNo, exact: true })
          .waitFor();
        await page.locator(".ant-table-row-expand-icon").first().click();
        await page
          .getByRole("button", {
            name: label("ตรวจสต็อก", "Check stock"),
            exact: true,
          })
          .click();
        await page
          .getByRole("dialog")
          .getByText("FAKE Central", { exact: true })
          .waitFor();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: label("กลับ", "Back"), exact: true })
          .click();
        await page
          .getByRole("button", { name: label("คำขอ", "Requests"), exact: true })
          .click();
        await page
          .getByRole("button", { name: "REQ-261022-001", exact: true })
          .click();
        const drawer = page.locator(".ant-drawer-content");
        await drawer
          .getByText(
            label(
              "รับเข้าตามรายการ PO (รวมทุกคำขอ): 2 / 10",
              "PO line received (all allocations): 2 / 10",
            ),
            { exact: false },
          )
          .waitFor();
        await drawer
          .getByText("FAKE reviewed", { exact: true })
          .first()
          .waitFor();
        await drawer
          .getByRole("button", {
            name: label("สร้างใบโอนฉบับร่าง", "Create transfer draft"),
            exact: true,
          })
          .click();
        let modal = page.locator(".ant-modal-content").last();
        await select(modal.locator(".ant-select").first(), "FAKE Central");
        await modal
          .getByRole("button", {
            name: label("ตรวจสอบและยืนยัน", "Review and confirm"),
            exact: true,
          })
          .click();
        const confirmation = page.locator(".ant-modal-confirm").last();
        await confirmation.getByText(/FAKE Central.*FAKE Branch B/).waitFor();
        await confirmation
          .getByRole("button", {
            name: label("ยืนยันดำเนินการ", "Confirm action"),
            exact: true,
          })
          .click();
        await page.waitForFunction(
          () => document.querySelectorAll(".ant-modal-confirm").length === 0,
        );
        assert.equal(writes.at(-1).action, "TRANSFER");
        assert.equal(writes.at(-1).sourceId, source);
        assert.equal(writes.at(-1).items[0].qty, 15);
        assert.ok(writes.at(-1).idempotencyKey);
        await drawer
          .getByRole("button", {
            name: label("สร้างและผูก PO", "Create and link PO"),
            exact: true,
          })
          .click();
        modal = page.locator(".ant-modal-content").last();
        await select(modal.locator(".ant-select").first(), "FAKE Supplier");
        await modal
          .getByRole("spinbutton", {
            name: `${label("ต้นทุนต่อหน่วย", "Unit cost")} FAKE-BOX`,
          })
          .fill("12");
        await modal.screenshot({ path: `${output}/${lang}-${width}-po.png` });
        await modal
          .getByRole("button", { name: label("กลับ", "Back"), exact: true })
          .click();
        await modal.waitFor({ state: "hidden" });
        await drawer.screenshot({
          path: `${output}/${lang}-${width}-detail.png`,
        });
        await drawer.locator(".ant-drawer-close").click();
        await page
          .getByRole("button", {
            name: label("สร้างคำขอ", "New request"),
            exact: true,
          })
          .click();
        modal = page.locator(".ant-modal-content").last();
        await select(modal.locator(".ant-select").first(), "FAKE Branch B");
        await select(modal.locator(".ant-select").last(), "FAKE Packaging");
        const faultScenario = lang === "th" && width === 1280;
        loseNextCommandResponse = faultScenario;
        await modal
          .getByRole("button", {
            name: label("บันทึกร่าง", "Save draft"),
            exact: true,
          })
          .click();
        if (faultScenario) {
          const unknownOutcome = page.getByText(
            "ยังยืนยันผลไม่ได้ ลองดำเนินการเดิมอีกครั้งเพื่อเรียกผลลัพธ์กลับมา",
            { exact: true },
          );
          await unknownOutcome.waitFor();
          await unknownOutcome.waitFor({ state: "hidden" });
          failReadsAfterWrite = true;
          await modal
            .getByRole("button", { name: "บันทึกร่าง", exact: true })
            .click();
          await page
            .getByText("โหลดข้อมูลไม่ได้ โปรดลองรีเฟรชหรือติดต่อผู้ดูแลระบบ", {
              exact: true,
            })
            .first()
            .waitFor();
          assert.deepEqual(
            writes.at(-1),
            writes.at(-2),
            "Unknown-outcome retries retain the identical key and payload",
          );
          assert.equal(
            await unknownOutcome.count(),
            0,
            "A failed refresh must not report a successful write as unknown",
          );
          failReads = false;
        }
        await page.waitForFunction(
          () =>
            document.querySelectorAll(
              '.ant-modal-wrap:not([style*="display: none"])',
            ).length === 0,
        );
        assert.equal(writes.at(-1).action, "SAVE");
        assert.equal(writes.at(-1).locationId, dest);
        assert.ok(
          !(await page.locator("body").innerText()).includes(
            "branch_requisitions.",
          ),
        );
        failReadsAfterWrite=false;
        request={...request,status:"DRAFT",version:1};
        await page.reload({waitUntil:"domcontentloaded"});
        await page.getByRole("button",{name:request.requestNo,exact:true}).click();
        await page.getByRole("button",{name:label("ส่งคำขอ","Submit request"),exact:true}).click();
        await page.locator('.ant-modal-content').last().getByRole("button",{name:label("ตรวจสอบและยืนยัน","Review and confirm"),exact:true}).click();
        await page.locator('.ant-modal-confirm').last().getByText(/FAKE-BOX\/BASE: 20/).waitFor();
        await page.locator('.ant-modal-confirm').last().getByRole("button",{name:label("กลับ","Back"),exact:true}).click();
        await page.locator('.ant-modal-content').last().getByRole("button",{name:label("กลับ","Back"),exact:true}).click();
        request={...request,status:"SUBMITTED",version:2};
        await page.reload({waitUntil:"domcontentloaded"});
        await page.getByRole("button",{name:request.requestNo,exact:true}).click();
        await page.getByRole("button",{name:label("ตรวจอนุมัติจำนวน","Review quantities"),exact:true}).click();
        const reviewModal=page.locator('.ant-modal-content').last();
        await reviewModal.getByRole("spinbutton").fill("15");
        await reviewModal.getByLabel(`${label("เหตุผลสำหรับรายการนี้","Reason for this line")} FAKE-BOX`,{exact:true}).fill("FAKE line reason");
        await reviewModal.getByRole("button",{name:label("ตรวจสอบและยืนยัน","Review and confirm"),exact:true}).click();
        await page.locator('.ant-modal-confirm').last().getByRole("button",{name:label("ยืนยันดำเนินการ","Confirm action"),exact:true}).click();
        await reviewModal.waitFor({state:"hidden"});
        assert.equal(writes.at(-1).items[0].note,"FAKE line reason");
        assert.equal(writes.at(-1).items[0].qty,15);
        await page.goto(`${base}/admin/purchase?id=${source}`, {
          waitUntil: "domcontentloaded",
        });
        await page
          .locator(".ant-table-expanded-row")
          .getByText("FAKE-BOX", { exact: true })
          .waitFor();
        await page.screenshot({
          path: `${output}/${lang}-${width}-linked-po.png`,
          fullPage: true,
        });
        await page.goto(`${base}/admin/stock-transfers?id=${source}`, {
          waitUntil: "domcontentloaded",
        });
        await page
          .locator(".ant-table-expanded-row")
          .getByText("FAKE-BOX", { exact: false })
          .first()
          .waitFor();
        await page.screenshot({
          path: `${output}/${lang}-${width}-linked-transfer.png`,
          fullPage: true,
        });
        deny = true;
        await page.goto(`${base}/admin/branch-requisitions`, {
          waitUntil: "domcontentloaded",
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page
          .getByText(
            label(
              "คุณไม่มีสิทธิ์ดูคำขอเติมสินค้าระหว่างสาขา",
              "You do not have permission to view branch requisitions.",
            ),
            { exact: true },
          )
          .waitFor();
        assert.deepEqual(errors, []);
        console.log(
          "PASS",
          lang,
          width,
          "review queue, date filters, metrics, exact demand drilldown, notices, submit summary, line review, linked documents, list, stock, schema-valid create, denial" +
            (faultScenario
              ? ", unknown-write retry and known-success refresh failure"
              : ""),
        );
      } catch (error) {
        await page.screenshot({
          path: `${output}/failure.png`,
          fullPage: true,
        });
        console.error(
          (await page.locator("body").innerText()).slice(0, 6000),
          errors,
        );
        throw error;
      } finally {
        await context.close();
      }
    }
} finally {
  await browser.close();
}
