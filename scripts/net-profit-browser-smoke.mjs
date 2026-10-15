import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3107";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Local fixture server only");
const output = ".test-output/net-profit-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th", "en"]) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-fixture", url: base }, { name: "lang", value: lang, url: base }]);
    await context.routeWebSocket("**/*", socket => socket.onMessage(raw => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "connection_init") socket.send(JSON.stringify({ type: "connection_ack" }));
      if (msg.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    }));
    let permissions = ["report.view", "expense.view", "delivery.settlement.view", "tax.document.view"];
    let mode = "complete", holdNext = false, held, initialMonth, requests = 0;
    const branch = "00000000-0000-4000-8000-000000000001";
    const totals = incomplete => ({ complete: !incomplete, knownSalesRevenue: "100.00", knownReturnRevenue: "0.00", netRevenue: "100.00",
      knownSalesCost: "20.00", returnQuantityCostBasis: "0.00", netCost: incomplete ? null : "20.00", grossProfit: incomplete ? null : "80.00",
      knownOperatingExpense: "5.00", knownGpExpense: "0.00", knownDepreciationExpense: "0.00", knownExpenseTotal: "5.00", expenseTotal: "5.00",
      netProfit: incomplete ? null : "75.00", refundCompleted: "0.00", creditReductionCompleted: "0.00" });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!/\/api\/|\/graphql$/.test(url.pathname)) return route.continue();
      let json = {};
      if (url.pathname === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE", role: "Administrator", name: "FAKE", language: lang } };
      else if (url.pathname === "/api/bms/realtime/ticket") json = { ticket: "FAKE-fixture" };
      else if (url.pathname.endsWith("/graphql")) {
        const { query: q = "", variables = {} } = route.request().postDataJSON() || {};
        let data = {};
        if (q.includes("MyBmsPermissions")) data = { myBmsPermissions: permissions };
        else if (q.includes("query NetProfitReport")) {
          requests++; assert.deepEqual(Object.keys(variables), ["month"]); initialMonth ??= variables.month;
          const captured = mode, isHeld = holdNext; let done;
          if (isHeld) {
            holdNext = false;
            const completion = new Promise(resolve => { done = resolve; });
            await new Promise(resolve => { held = { release: resolve, completion }; });
          }
          const incomplete = captured === "incomplete";
          const amounts = totals(incomplete); if (isHeld) amounts.netProfit = "999.00";
          const group = { locationId: branch, locationName: "FAKE Branch", channel: "pos", bucketOnly: false, sharedBranchCost: false, ...amounts };
          if (captured === "error") data = { bmsNetProfit: { status: "REJECTED", errorCode: "NET_PROFIT_CURRENCY_REVIEW_REQUIRED" } };
          else data = { bmsNetProfit: { status: "OK", month: variables.month, observedAt: "2026-10-15T00:00:00Z", complete: !incomplete,
            truncated: false, eventCount: 1, basis: "RECORDED_MONTHLY_PRE_INCOME_TAX_V1", costBasis: "CATALOG_AT_SALE_NOT_PURCHASE_LOT",
            returnBasis: "SALE_VAT_ALLOCATION_COST_REVERSAL_UNKNOWN", expenseBasis: "REVIEWED_SOURCE_MONTH_NOT_CASH_DATE",
            totals: amounts, branches: [group], channels: [group], issues: incomplete ? [{ code: "RETURN_COST_REVERSAL_UNVERIFIED", count: 1 }] : [],
            samples: incomplete ? [{ key: "RETURN:FAKE", code: "RETURN_COST_REVERSAL_UNVERIFIED" }] : [] } };
          try { return await route.fulfill({ json: { data } }); } finally { done?.(); }
        } else if (q.includes("bmsSalesSummary")) data = { bmsSalesSummary: null, bmsInventorySummary: null, bmsTopSellingProducts: [], bmsManagementReport: null };
        else if (q.includes("bmsGeneratedReports")) data = { bmsGeneratedReports: [] };
        else if (q.includes("bmsLocations")) data = { bmsLocations: [] };
        else if (q.includes("bmsActingTenant")) data = { bmsActingTenant: null };
        assert.ok(!q.includes("mutation"), "read-only workflow must not send mutations");
        json = { data };
      }
      return route.fulfill({ json });
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message)); page.setDefaultTimeout(20000);
    const label = (th, en) => lang === "th" ? th : en;
    const open = label("เปิดกำไรสุทธิจากหลักฐาน", "Open recorded net profit");
    try {
      assert.equal((await page.goto(`${base}/admin/reports`, { waitUntil: "domcontentloaded", timeout: 120000 })).status(), 200);
      await page.getByRole("button", { name: open, exact: true }).click();
      const dialog = page.getByRole("dialog");
      const profit = dialog.locator('[data-profit-field="netProfit"]');
      await profit.getByText("฿75.00", { exact: true }).waitFor();
      const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 1000, "report scrolls within viewport");
      assert.ok(await dialog.locator(".ant-modal-body").evaluate(node => node.scrollWidth <= node.clientWidth + 1), "only tables scroll horizontally, not the worksheet");
      assert.ok((await dialog.locator('[data-profit-field="knownSalesRevenue"]').boundingBox()).height < 30, "money stays on one line");
      await dialog.screenshot({ path: `${output}/${lang}-${width}-complete.png`, animations: "disabled" });
      holdNext = true;
      const pending = page.waitForRequest(r => r.postData()?.includes("query NetProfitReport"));
      await dialog.getByRole("button", { name: /Refresh/ }).click(); await pending;
      assert.equal(await profit.count(), 0, "loading hides old result");
      const nextMonth = initialMonth === "2026-09" ? "2026-08" : "2026-09";
      const monthInput = dialog.locator("input").first(); await monthInput.fill(nextMonth); await monthInput.press("Enter");
      await profit.getByText("฿75.00", { exact: true }).waitFor();
      assert.equal(await monthInput.inputValue(), nextMonth); assert.ok(held);
      held.release(); await held.completion;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await profit.textContent(), "฿75.00", "late previous-month result must not replace current month");
      // An old rejected request must not replace a newer successful month either.
      mode = "error"; holdNext = true;
      const oldError = page.waitForRequest(r => r.postData()?.includes("query NetProfitReport"));
      await dialog.getByRole("button", { name: /Refresh/ }).click(); await oldError;
      mode = "complete"; await monthInput.fill(initialMonth); await monthInput.press("Enter");
      await profit.getByText("฿75.00", { exact: true }).waitFor();
      held.release(); await held.completion;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await profit.textContent(), "฿75.00");
      assert.equal(await dialog.getByText("NET_PROFIT_CURRENCY_REVIEW_REQUIRED", { exact: true }).count(), 0);
      mode = "incomplete";
      await dialog.getByRole("button", { name: /Refresh/ }).click();
      await profit.getByText(label("ยังไม่ทราบ", "Unknown"), { exact: true }).waitFor();
      await dialog.getByText("RETURN_COST_REVERSAL_UNVERIFIED", { exact: true }).first().waitFor();
      await dialog.screenshot({ path: `${output}/${lang}-${width}-incomplete.png`, animations: "disabled" });
      await profit.scrollIntoViewIfNeeded();
      await dialog.screenshot({ path: `${output}/${lang}-${width}-profit-detail.png`, animations: "disabled" });
      mode = "error"; await dialog.getByRole("button", { name: /Refresh/ }).click();
      await dialog.getByText("NET_PROFIT_CURRENCY_REVIEW_REQUIRED", { exact: true }).waitFor(); assert.equal(await profit.count(), 0);
      mode = "complete"; await dialog.getByRole("button", { name: /Refresh/ }).click(); await profit.getByText("฿75.00", { exact: true }).waitFor();
      await dialog.locator(".ant-modal-close").click();
      permissions = permissions.filter(p => p !== "tax.document.view");
      await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("heading", { name: /^(Reports|รายงาน)$/ }).first().waitFor();
      assert.equal(await page.getByRole("button", { name: open, exact: true }).count(), 0);
      await page.goto(`${base}/admin/manual`, { waitUntil: "domcontentloaded" });
      await page.getByText(lang === "th" ? /กำไรสุทธิจากหลักฐาน: รายงาน/ : /Recorded net profit: Reports/).waitFor();
      assert.ok(requests >= 6); assert.deepEqual(errors, []);
      console.log(`PASS ${lang} ${width}px: known/unknown profit, delayed month response, stale hiding, retry, read-only permissions and manual`);
    } catch (error) {
      console.log({ errors }); await page.screenshot({ path: `${output}/${lang}-${width}-failure.png`, fullPage: true }); throw error;
    } finally { held?.release(); await context.close(); }
  }
} finally { await browser.close(); }
