import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3003";
const output = ".test-output/dashboard-actions";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const [width, manage] of [[1440, true], [390, true], [1440, false]]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base }, { name: "lang", value: "th", url: base }]);
    const actions = Array.from({ length: 30 }, (_, index) => ({
      id: `FAKE-${index}`, priority: index === 0 ? "CRITICAL" : "HIGH", title: `งานทดสอบ ${index}`, titleEn: `FAKE Task ${index}`,
      evidence: { count: index + 1 }, expectedImpact: "ผลกระทบทดสอบ", expectedImpactEn: "FAKE impact", confidence: 0.85,
      ownerName: null, dueAt: "2026-01-01T10:00:00Z", deepLink: "/admin/orders", status: index < 5 ? "NEW" : index < 8 ? "ACCEPTED" : "EXPIRED",
      statusReason: index >= 8 ? "signal_cleared" : null, measuredOutcome: null,
    }));
    const calls = [], mutations = [], errors = [];
    let metricsReads = 0, failList = false;
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let json = {};
      if (path === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE admin", language: "th" } };
      else if (path === "/api/graphql") {
        const { query: q, variables: v = {} } = route.request().postDataJSON();
        let data = {};
        if (/\bmutation\b/.test(q)) mutations.push({ q, v });
        if (q.includes("MyBmsPermissions")) data = { myBmsPermissions: ["report.view", ...(manage ? ["action.manage"] : [])] };
        else if (q.includes("DashboardActionList")) {
          calls.push(v);
          if (failList) return route.fulfill({ json: { errors: [{ message: "FAKE failed read" }] } });
          const filtered = actions.filter(a => v.group === "ALL" || a.status === v.group || v.group === "HISTORY" && ["EXPIRED", "COMPLETED", "DISMISSED"].includes(a.status));
          data = { bmsActions: filtered.slice(v.offset, v.offset + v.limit) };
        } else if (q.includes("DashboardActionMetrics")) {
          metricsReads++;
          data = { bmsActionMetrics: { acceptanceRate: 0.2, completionRate: 0.1, avgTimeToActionMinutes: 3, measuredOutcomeCount: 2 } };
        } else if (q.includes("bmsRefreshActions")) data = { bmsRefreshActions: 8 };
        else if (q.includes("bmsTransitionAction")) {
          assert.ok(manage);
          const a = actions.find(a => a.id === v.id);
          a.status = v.status;
          a.statusReason = v.reason;
          a.measuredOutcome = v.measuredOutcome;
          data = { bmsTransitionAction: { id: a.id, status: a.status } };
        } else if (q.includes("bmsDashboard")) data = { bmsDashboard: {
          revenueTotal: 3500, revenueToday: 500, orderCount: 5, lowStockCount: 4, customerCount: 3,
          ordersByStatus: [], topProducts: [], topCustomers: [], salesDaily: [], couponSummary: null,
        } };
        else if (q.includes("bmsChannelHealth")) data = { bmsChannels: [], bmsChannelHealth: [] };
        else if (q.includes("bmsOperationalAlerts")) data = { bmsOperationalAlerts: { packingOverdueCount: 0, slipPendingCount: 0, reservationExpiringCount: 0, chatWaitingCount: 0 } };
        else if (q.includes("bmsInventoryActionCenter")) data = { bmsInventoryActionCenter: { summary: {
          lowStockCount: 4, outOfStockCount: 3, stockoutWithin7DaysCount: 0, purchaseSuggestionCount: 0,
          totalSuggestedQty: 0, slowMovingCount: 0, deadStockCount: 0, expiringLotCount: 0, expiringUnits: 0,
          windowDays: 30, coverageDays: 30, disclaimer: "FAKE fixture",
        }, lowStock: [], stockoutRisk: [], purchaseSuggestions: [], slowMoving: [], expiringLots: [] } };
        else if (q.includes("bmsAiConfig")) data = { bmsAiConfig: { has_key: true }, bmsAiUsage: null };
        else if (q.includes("bmsAiFailureSummary")) data = { bmsAiFailureSummary: { days: 7, totalToolCalls: 0, errorCalls: 0, handoffCount: 0, topFailingTools: [] } };
        json = { data };
      }
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    const tasks = page.getByRole("region", { name: "งานที่ต้องทำวันนี้" });
    const drawer = page.getByRole("dialog");
    try {
      await page.goto(`${base}/admin/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await tasks.getByRole("button", { name: "งานทดสอบ 0", exact: true }).waitFor();
      assert.equal(await tasks.locator("article").count(), 3);
      assert.equal(await tasks.getByText(/เลยกำหนด/).count(), 3, "overdue live tasks remain actionable");
      assert.equal(await tasks.getByText(/signal_cleared|ผลกระทบทดสอบ/).count(), 0);
      assert.equal(metricsReads, 0, "30-day metrics are not loaded on the dashboard");
      const taskBox = await tasks.boundingBox();
      if (width === 1440) assert.ok(taskBox.height <= 350, JSON.stringify(taskBox));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${output}/${width}-${manage ? "manager" : "reader"}.png`, fullPage: false });
      if (manage) {
        await tasks.getByRole("button", { name: "รับทำ", exact: true }).first().click();
        await tasks.getByRole("button", { name: "งานทดสอบ 3", exact: true }).waitFor();
        assert.equal(actions[0].status, "ACCEPTED");
      } else {
        assert.equal(await tasks.getByRole("button", { name: "รับทำ", exact: true }).count(), 0);
        assert.equal(await tasks.getByRole("button", { name: "อัปเดตสัญญาณ", exact: true }).count(), 0);
      }
      await tasks.getByRole("tab", { name: "กำลังทำ", exact: true }).click();
      await tasks.getByRole("button", { name: `งานทดสอบ ${manage ? 0 : 5}`, exact: true }).waitFor();
      await tasks.getByRole("button", { name: `งานทดสอบ ${manage ? 0 : 5}`, exact: true }).click();
      await drawer.getByText("ผลกระทบทดสอบ", { exact: true }).waitFor();
      assert.equal(await drawer.getByRole("link", { name: /เปิดหน้าที่เกี่ยวข้อง/ }).getAttribute("href"), "/admin/orders");
      if (manage) {
        page.once("dialog", d => d.dismiss());
        await drawer.getByRole("button", { name: "เสร็จแล้ว", exact: true }).click();
        assert.equal(actions[0].status, "ACCEPTED", "cancelled completion must not mutate");
        page.once("dialog", d => d.accept("FAKE finished"));
        await drawer.getByRole("button", { name: "เสร็จแล้ว", exact: true }).click();
        await drawer.getByRole("tab", { name: "ทั้งหมด", exact: true }).waitFor();
        assert.equal(actions[0].status, "COMPLETED");
        assert.deepEqual(actions[0].measuredOutcome, { note: "FAKE finished" });
      } else await drawer.getByRole("button", { name: "กลับรายการงาน", exact: true }).click();
      await drawer.getByRole("tab", { name: "ประวัติ", exact: true }).click();
      await drawer.getByText("หมดอายุ", { exact: true }).first().waitFor();
      assert.equal(await drawer.locator("article").count(), 20);
      await drawer.getByRole("button", { name: "หน้าถัดไป", exact: true }).click();
      await drawer.getByText("หน้า 2", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.ant-drawer article').length < 20);
      assert.ok(calls.some(v => v.group === "HISTORY" && v.offset === 20));
      assert.equal(await drawer.getByRole("button", { name: "หน้าถัดไป", exact: true }).isDisabled(), true);
      assert.ok(metricsReads > 0);
      const drawerBox = await drawer.boundingBox();
      assert.ok(drawerBox.x >= 0 && drawerBox.x + drawerBox.width <= width);
      await page.screenshot({ path: `${output}/${width}-history.png`, fullPage: false });
      await drawer.locator(".ant-drawer-close").click();
      failList = true;
      await tasks.getByRole("tab", { name: "ต้องทำ", exact: true }).click();
      if (manage) await tasks.getByRole("button", { name: "อัปเดตสัญญาณ", exact: true }).click();
      else await tasks.getByRole("button", { name: "ดูงานทั้งหมด", exact: true }).click();
      await page.getByText("โหลดหรืออัปเดตงานไม่สำเร็จ", { exact: true }).first().waitFor();
      failList = false;
      await page.getByRole("button", { name: "ลองใหม่", exact: true }).first().click();
      await page.getByText("โหลดหรืออัปเดตงานไม่สำเร็จ", { exact: true }).first().waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      if (!manage) assert.equal(mutations.length, 0);
      assert.ok(mutations.every(({ q }) => /bmsRefreshActions|bmsTransitionAction/.test(q)));
      console.log(`PASS ${width}px ${manage ? "manager" : "reader"}: compact preview, overdue, detail, history pagination, permissions, failure/retry; fixture-only writes`);
    } catch (error) {
      console.error((await page.locator("body").innerText()).slice(-3000));
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
