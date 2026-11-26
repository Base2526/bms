// Authenticated desktop-bridge fixture for the real restaurant POS route; no database writes.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE
  || new URL("../apps/web/node_modules/playwright/index.mjs", import.meta.url).href);
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3194";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Use a local fixture server only");
const out = ".test-output/restaurant-kiosk-pos-browser";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const takeawayId = "aaaaaaaa-0000-4000-8000-000000000001";
const dineId = "bbbbbbbb-0000-4000-8000-000000000002";
const firstCheck = "cccccccc-0000-4000-8000-000000000003";
const splitCheck = "dddddddd-0000-4000-8000-000000000004";
const now = new Date().toISOString();
const request = (id, serviceMode, status, checkId = null) => ({ id, serviceMode, status, checkId,
  submittedAt: now, rejectionReason: null, checkStatus: checkId ? "OPEN" : null,
  orderId: checkId ? "eeeeeeee-0000-4000-8000-000000000005" : null,
  items: [{ sku: "FAKE-FOOD", productName: "ข้าวผัด", size: "L", packQty: 1, modifierCodes: [] }] });
const submissions = [request(takeawayId, "TAKEAWAY", "ACCEPTED", firstCheck),
  request(dineId, "DINE_IN", "PENDING")];
const floor = { areas: [{ id: "area-1", name: "โซนหน้า", sortOrder: 0 }],
  tables: [{ id: "table-1", areaId: "area-1", code: "T1", name: "โต๊ะหนึ่ง", seats: 4,
    shape: "rect", positionX: 20, positionY: 20, blocked: false, status: "OCCUPIED",
    check: null, checks: [firstCheck, splitCheck].map((id, index) => ({ id, status: "OPEN",
      guestCount: 2, amountDue: 50, openedAt: now, itemCount: 1, unsentCount: 0,
      version: 1, reservedVersion: 1, splitGroupNo: index + 1, serviceMode: "DINE_IN" })) }],
  takeawayChecks: [] };
const session = { businessArchetype: "restaurant", device: { id: "device-1", code: "TEST", name: "Test POS" },
  location: { id: "branch-1", name: "Fixture branch", branchCode: "001", pickupQueue: { enabled: false,
    autoHideMinutes: 10, showPreparing: false, boardMessage: null } },
  shift: { id: "shift-1", openedAt: now, openingFloat: 0 },
  cashiers: [{ id: "cashier-1", name: "Fixture cashier", hasPin: true, role: "Cashier" }],
  approvers: [], kitchenOperators: [], store: { name: "Fixture restaurant", taxId: null, receiptLanguageMode: "th" },
  vat: { registered: false, priceIncludesVat: true, rate: 7, cashRounding: "NONE" } };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    let previewCheck = null;
    let acceptAttempts = 0;
    let pendingAccepted = false;
    let openedBill = null;
    const errors = [];
    await context.addInitScript(() => { window.bmsDesktop = {
      isDesktop: true, getDeviceToken: async () => "pos_FAKE_kiosk_test",
      getStorageNamespace: async () => "FAKE-kiosk", onRefreshRequested: () => () => {},
      getLanguage: async () => "th", setLanguage: async () => ({ ok: true }),
      onLanguageChanged: () => () => {},
    }; });
    await context.route("**/api/**", async (route) => {
      const req = route.request(); const url = new URL(req.url());
      if (url.pathname === "/api/graphql") return route.fulfill({ json: {
        data: { bmsPosVerifyCashier: { id: "cashier-1", name: "Fixture cashier", role: "Cashier",
          hasPin: true, posOnly: true, isPharmacist: false } },
      } });
      if (url.pathname === "/api/pos/session") return route.fulfill({ json: session });
      if (url.pathname === "/api/pos/restaurant/floor") return route.fulfill({ json: floor });
      if (url.pathname.startsWith("/api/pos/restaurant/checks/")) {
        openedBill = url.pathname.split("/").at(-1);
        return route.fulfill({ json: { check: { id: openedBill, serviceMode: "TAKEAWAY",
          tableId: null, tableCode: "TAKEAWAY", tableName: "รับกลับ", areaName: "Take away",
          status: "OPEN", guestCount: 1, amountDue: 50, unsentAmount: 0,
          estimatedTotal: 50, version: 1, reservedVersion: 1, hasCurrentOrder: true,
          reservationStatus: "PENDING", reservationLost: false, openedAt: now,
          splitGroupNo: 1, splitFromCheckId: null, items: [] } } });
      }
      if (url.pathname === "/api/pos/restaurant/kiosk") {
        if (req.method() === "GET") {
          const rows = submissions.map((row) => pendingAccepted && row.id === dineId
            ? { ...row, status: "ACCEPTED", checkId: splitCheck, checkStatus: "OPEN" } : row);
          return route.fulfill({ json: { kiosk: { active: true },
            submissions: url.searchParams.has("requestCode")
              ? rows.filter((row) => row.id.startsWith(url.searchParams.get("requestCode"))) : rows } });
        }
        const body = req.postDataJSON();
        if (body.action === "preview") {
          previewCheck = body.checkId;
          return route.fulfill({ json: { submissionId: body.submissionId, serviceMode: "DINE_IN",
            submittedLines: [{ unitPrice: 50, lineAmount: 50 }], priceChanged: true,
            quote: { fingerprint: "a".repeat(64), total: 70, lines: [{ sku: "FAKE-FOOD",
              productName: "ข้าวผัด", size: "L", packQty: 1, unitPrice: 70,
              lineAmount: 70, modifiers: [] }] },
            check: { id: body.checkId, version: 1, tableId: "table-1", tableCode: "T1",
              tableName: "โต๊ะหนึ่ง", areaName: "โซนหน้า", splitGroupNo: 2, openedAt: now } } });
        }
        if (body.action === "accept") {
          assert.equal(body.checkId, splitCheck);
          assert.equal(body.confirmedTable, true);
          assert.equal(body.confirmedPriceChange, true);
          assert.equal(body.quoteFingerprint, "a".repeat(64));
          acceptAttempts += 1;
          if (acceptAttempts === 1) return route.fulfill({ status: 409, json: { error: "Fixture accept rejected" } });
          pendingAccepted = true;
          return route.fulfill({ json: { status: "ACCEPTED", check: { id: splitCheck } } });
        }
        return route.fulfill({ status: 400, json: { error: "Unexpected fixture request" } });
      }
      if (url.pathname === "/api/pos/kitchen/tickets") return route.fulfill({ json: { tickets: [], stations: [], stationSlas: {} } });
      if (url.pathname === "/api/pos/restaurant/waitlist") return route.fulfill({ json: { entries: [], requestedCount: 0, waitingCount: 0, calledCount: 0, waitingGuests: 0 } });
      if (url.pathname === "/api/pos/restaurant/menu") return route.fulfill({ json: { items: [] } });
      if (url.pathname === "/api/pos/restaurant/qr-orders") return route.fulfill({ json: { submissions: [] } });
      if (url.pathname === "/api/pos/restaurant/service-calls") return route.fulfill({ json: { calls: [] } });
      if (url.pathname === "/api/pos/restaurant/incoming") return route.fulfill({ json: { orders: [] } });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const response = await page.goto(`${base}/pos/restaurant?screen=kiosk`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.equal(response.status(), 200);
      await page.getByRole("heading", { name: /จอสั่ง/ }).waitFor();
      await page.getByRole("button", { name: "เลือกผู้ปฏิบัติงาน" }).click();
      await page.getByRole("dialog").getByLabel("PIN 4–8 หลัก").fill("1234");
      await page.getByRole("dialog").getByRole("button", { name: "ใช้บัญชีนี้" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByLabel("รหัสคำขอที่ลูกค้าเห็น").fill(takeawayId.slice(0, 8));
      await page.getByRole("button", { name: "ค้นหาคำขอ" }).click();
      await page.locator(`article:has-text("${takeawayId.slice(0, 8).toUpperCase()}")`)
        .getByText(firstCheck.slice(0, 8).toUpperCase()).first().waitFor();
      await page.getByRole("button", { name: "เปิดบิลนี้ใน POS" }).waitFor();
      await page.getByRole("button", { name: "เปิดบิลนี้ใน POS" }).click();
      await page.waitForFunction(() => document.querySelector('button[aria-label="คำขอจากจอสั่งเอง"]')?.getAttribute("aria-pressed") === "false");
      assert.equal(openedBill, firstCheck);
      await page.getByRole("button", { name: "คำขอจากจอสั่งเอง" }).click();
      await page.locator(`article:has-text("${dineId.slice(0, 8).toUpperCase()}") select`).selectOption(splitCheck);
      await page.getByRole("button", { name: "ตรวจราคาและบิลล่าสุดจาก server" }).click();
      assert.equal(previewCheck, splitCheck);
      await page.getByText("โซนหน้า · T1 โต๊ะหนึ่ง · บิล 2", { exact: false }).waitFor();
      await page.locator(`article:has-text("${dineId.slice(0, 8).toUpperCase()}")`)
        .getByRole("button", { name: "รับและส่งครัว" }).click();
      await page.getByRole("alert").getByText("ยืนยันโต๊ะ", { exact: false }).waitFor();
      const dine = page.locator(`article:has-text("${dineId.slice(0, 8).toUpperCase()}")`);
      await dine.getByRole("checkbox").first().check();
      await dine.getByRole("checkbox").last().check();
      await dine.getByRole("button", { name: "รับและส่งครัว" }).click();
      await page.getByRole("alert").getByText("Fixture accept rejected", { exact: false }).waitFor();
      await dine.getByRole("button", { name: "รับและส่งครัว" }).click();
      await dine.getByRole("button", { name: "เปิดบิลนี้ใน POS" }).waitFor();
      assert.equal(acceptAttempts, 2);
      await page.screenshot({ path: `${out}/pos-${width}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.deepEqual(errors, []);
      console.log(`PASS POS kiosk ${width}px: authenticated fixture, request lookup, split preview, confirmations, accept error/retry, linked bill, no overflow`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
