import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3107";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Local fixture server only");
const output = ".test-output/operating-cost-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th", "en"]) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    // Mock the idle transport too: HTTP routing does not intercept WS upgrades.
    // Never connect to a gateway; no realtime behavior is asserted by this fixture.
    await context.routeWebSocket("**/*", socket => socket.onMessage(raw => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "connection_init") socket.send(JSON.stringify({ type: "connection_ack" }));
      if (msg.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    }));
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-fixture", url: base }, { name: "lang", value: lang, url: base }]);
    let permissions = ["report.view", "expense.view", "delivery.settlement.view", "expense.manage"];
    let readFailure = false, writeFailure = false, savedInput, review = null;
    const key = "DOCUMENT:00000000-0000-4000-8000-000000000001", fingerprint = "a".repeat(64);
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!/\/api\/|\/graphql$/.test(url.pathname)) return route.continue();
      let json = {};
      if (url.pathname === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE", role: "Administrator", name: "FAKE admin", language: lang } };
      else if (url.pathname === "/api/bms/realtime/ticket") json = { ticket: "FAKE-browser-fixture" };
      else if (url.pathname.endsWith("/graphql")) {
        const { query: q = "", variables = {} } = route.request().postDataJSON() || {};
        let data = {};
        if (q.includes("MyBmsPermissions")) data = { myBmsPermissions: permissions };
        else if (q.includes("query OperatingCosts")) {
          if (readFailure) return route.fulfill({ json: { errors: [{ message: "COST_ALL_BRANCH_ACCESS_REQUIRED", extensions: { code: "FORBIDDEN" } }] } });
          const month = variables.month;
          data = { bmsOperatingCosts: { month, currency: "THB", scope: "ALL_BRANCHES", complete: !!review, truncated: false,
            unresolvedCount: review ? 0 : 1, duplicateCount: 0, operatingAmount: review ? 100 : 0, gpAmount: 0,
            depreciationAmount: 0, knownTotal: review ? 100 : 0, reviewedTotal: review ? 100 : null,
            rows: [{ key, kind: "DOCUMENT", id: key.split(":")[1], month, amount: "100.00", currency: "THB",
              category: "RENT", reference: "FAKE-RENT", eligible: true, fingerprint, state: review ? "OPERATING" : "UNREVIEWED",
              recognizedAmount: review ? 100 : null, review }] } };
        } else if (q.includes("mutation ReviewOperatingCost")) {
          savedInput = variables.input;
          if (writeFailure) return route.fulfill({ json: { errors: [{ message: "COST_REVIEW_CONFLICT", extensions: { code: "CONFLICT" } }] } });
          review = { version: 1, sourceFingerprint: fingerprint, disposition: savedInput.disposition, reason: savedInput.reason,
            duplicateKey: null, startMonth: null, lifeMonths: null, residual: null };
          data = { bmsReviewOperatingCost: { version: 1 } };
        } else if (q.includes("bmsSalesSummary")) data = { bmsSalesSummary: null, bmsInventorySummary: null,
          bmsTopSellingProducts: [], bmsManagementReport: null };
        else if (q.includes("bmsGeneratedReports")) data = { bmsGeneratedReports: [] };
        else if (q.includes("bmsLocations")) data = { bmsLocations: [] };
        else if (q.includes("bmsActingTenant")) data = { bmsActingTenant: null };
        json = { data };
      }
      return route.fulfill({ json });
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push({ message: error.message, stack: error.stack }));
    await page.addInitScript(() => window.addEventListener("unhandledrejection", event => {
      console.warn("FIXTURE_REJECTION", event.reason?.constructor?.name, event.reason?.type, event.reason?.target?.url, event.reason?.stack);
    }));
    page.on("console", msg => { if (msg.text().startsWith("FIXTURE_REJECTION")) console.log(msg.text()); });
    page.setDefaultTimeout(15000);
    const openLabel = lang === "th" ? "เปิดกระทบยอดต้นทุน" : "Open cost reconciliation";
    const detailsLabel = lang === "th" ? "ตรวจรายละเอียด" : "Review details";
    const incomplete = lang === "th" ? "ตรวจยังไม่ครบ — ยอดรวมยังไม่ทราบ" : "Review incomplete — total unknown";
    try {
      const response = await page.goto(`${base}/admin/reports`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.equal(response.status(), 200);
      await page.getByRole("button", { name: openLabel, exact: true }).click();
      const worksheet = page.getByRole("dialog").first();
      await worksheet.getByText(incomplete, { exact: true }).waitFor();
      const bounds = await worksheet.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, "worksheet fits viewport");
      assert.ok(await worksheet.locator('.ant-alert-description').evaluate(el => el.scrollWidth <= el.clientWidth + 1), "source explanation wraps");
      await page.screenshot({ path: `${output}/${lang}-${width}-incomplete.png`, animations: "disabled" });
      // On a narrow screen, the source table scrolls, not the entire dialog.
      await worksheet.getByRole("button", { name: detailsLabel }).click();
      let details = page.getByRole("dialog").last();
      await details.locator('.ant-select-selector').click();
      await page.locator('.ant-select-item-option').filter({ hasText: lang === "th" ? "ค่าเสื่อมที่ไม่ใช่เงินสด" : "Non-cash depreciation" }).click();
      await details.locator('#startMonth').fill("2026-10");
      await details.locator('#lifeMonths').fill("12");
      await details.locator('#residual').fill("10");
      await details.locator('.ant-select-selector').click();
      await page.locator('.ant-select-item-option').filter({ hasText: lang === "th" ? "ค่าใช้จ่ายดำเนินงาน" : "Operating expense" }).click();
      await details.locator('#reason').fill("FAKE reviewed rent receipt");
      await details.locator('.ant-modal-footer .ant-btn-primary').click();
      assert.equal(savedInput, undefined, "explicit confirmation is required");
      await details.locator('#confirmed').check();
      writeFailure = true;
      await details.locator('.ant-modal-footer .ant-btn-primary').click();
      await page.getByText(/COST_REVIEW_CONFLICT/).waitFor();
      assert.equal(await details.locator('#reason').inputValue(), "FAKE reviewed rent receipt", "retry preserves evidence");
      writeFailure = false;
      await details.locator('.ant-modal-footer .ant-btn-primary').click();
      await worksheet.getByText(lang === "th" ? "ตรวจรายการที่โหลดครบ (ไม่ยืนยันว่าบันทึกครบ)" : "Loaded records reviewed (not expense completeness)", { exact: true }).waitFor();
      assert.deepEqual(savedInput, { sourceKey: key, sourceFingerprint: fingerprint, expectedVersion: 0,
        disposition: "OPERATING", reason: "FAKE reviewed rent receipt", duplicateKey: null, startMonth: null, lifeMonths: null, residual: null, confirmed: true });
      await page.screenshot({ path: `${output}/${lang}-${width}-reviewed.png`, animations: "disabled" });
      readFailure = true;
      await worksheet.getByRole('button', { name: /Refresh/ }).click();
      await worksheet.getByText("COST_ALL_BRANCH_ACCESS_REQUIRED", { exact: true }).waitFor();
      assert.equal(await worksheet.getByText(/฿100\.00/).count(), 0, "error hides stale totals");
      readFailure = false; permissions = permissions.filter(p => p !== "expense.manage");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole('button', { name: openLabel }).click();
      await page.getByRole('button', { name: detailsLabel, exact: true }).click();
      details = page.getByRole('dialog').last();
      assert.equal(await details.locator('.ant-modal-footer').count(), 0, "reader cannot submit");
      assert.equal(await details.locator('#reason').isDisabled(), true);
      permissions = ["report.view"];
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole('heading', { name: /^(Reports|รายงาน)$/ }).first().waitFor();
      assert.equal(await page.getByRole('button', { name: openLabel }).count(), 0, "source permissions required");
      await page.goto(`${base}/admin/manual`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByText(lang === "th" ? /กระทบยอดต้นทุนร้านอาหารรายเดือน:/ : /Monthly restaurant cost reconciliation:/).waitFor();
      await page.screenshot({ path: `${output}/${lang}-${width}-manual.png`, fullPage: true, animations: "disabled" });
      assert.deepEqual(errors, []);
      console.log(`PASS ${lang} ${width}px: confirmation, conflict/retry, shape, readonly, denied scope, unknown totals`);
    } catch (error) {
      console.log({ pageErrors: errors });
      console.log(await page.getByRole('dialog').evaluateAll(nodes => nodes.map(el => ({ title: el.getAttribute('aria-labelledby'), buttons: [...el.querySelectorAll('button')].map(b => b.textContent) }))));
      await page.screenshot({ path: `${output}/${lang}-${width}-failure.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
