import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3003";
const output = ".test-output/board-game-offer-checkout";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const cashier = { id: "FAKE-cashier", name: "FAKE Cashier", hasPin: true, role: "Cashier", posOnly: true, approvals: [] };
const startedAt = "2026-10-07T03:00:00Z", endedAt = "2026-10-07T06:00:00Z";
try {
  for (const width of [1440, 390]) for (const scenario of ["APPLIED", "INELIGIBLE", "LEGACY"]) {
    const applied = scenario === "APPLIED";
    const amount = applied ? 100 : 150;
    const line = { participantId: "FAKE-person", displayName: "FAKE Player", participantType: "GENERAL", billingGroupNo: 1,
      rateCode: "FAKE", rateName: "ทั่วไป", joinedAt: startedAt, actualEndedAt: endedAt, chargedUntil: endedAt,
      actualMinutes: 180, billableMinutes: 180, hourlyRate: 50, amount, grossAmount: 150,
      coveredMinutes: 0, coveredAmount: 0, offerDiscountAmount: applied ? 50 : 0,
      offerPaidMinutes: applied ? 120 : null, offerFreeMinutes: applied ? 60 : null };
    const group = { id: "FAKE-group", groupNo: 1, status: "CLOSING", amountDue: amount, tabAmount: 0,
      endedAt, currentOrderId: null, chargeSnapshot: [line], tabItems: [] };
    const detail = { id: "FAKE-session", status: "CLOSING", billingMode: "OPEN_ENDED", guestCount: 1,
      startedAt, endedAt, expectedEndAt: null, nextAlertAt: null, alertStatus: "NORMAL", alertBeforeMinutes: 10,
      amountDue: amount, tableId: "FAKE-table", originTableId: "FAKE-table", originTableCode: "FAKE", originTableName: "FAKE Table",
      seatingId: "FAKE-seating", sessionIds: ["FAKE-session"], sessionCount: 1, billingGroupCount: 1, awaitingPaymentCount: 1,
      billingGroups: [group], participants: [], games: [], identityHolds: [] };
    const workspace = { floor: { areas: [{ id: "FAKE-area", name: "FAKE Area", sortOrder: 0 }], tables: [{ id: "FAKE-table", areaId: "FAKE-area",
      code: "FAKE", name: "FAKE Table", seats: 4, sortOrder: 0, blocked: false, openSession: detail }] },
      rates: [], library: [], serviceCalls: [], waitlist: { entries: [], tables: [], waitingCount: 0, calledCount: 0,
        confirmedReservationCount: 0, requestedReservationCount: 0, waitingGuests: 0, longestWaitMinutes: 0 } };
    const checkout = { id: group.id, sessionId: detail.id, groupNo: 1, sessionGroupCount: 1,
      tableCode: "FAKE", tableName: "FAKE Table", billingMode: "OPEN_ENDED", startedAt, endedAt,
      amountDue: amount, tabAmount: 0, tabPricingDiscountAmount: 0, tabItemCount: 0, totalDue: amount,
      chargeLineCount: 1, passCoveredAmount: 0, offerCode: applied ? "FAKE_2_PLUS_1" : null,
      offerName: applied ? "FAKE 2+1" : null, offerDiscountAmount: applied ? 50 : 0, chargeLines: [line], tabItems: [],
      offerEvaluation: scenario === "LEGACY" ? null : { status: scenario, evaluatedAt: endedAt, omittedCount: 0,
        checks: applied ? [] : [{ offerCode: "FAKE_2_PLUS_1", offerName: "FAKE 2+1", reason: "WEEKDAY" }] } };
    const bootstrap = { device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", scanner: { mode: "OFF" } },
      location: { id: "FAKE-location", name: "FAKE shop", branchCode: "MAIN" },
      shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 0, openedAt: startedAt }, cashiers: [cashier], approvers: [], kitchenOperators: [],
      store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null }, surface: "retail", businessArchetype: "board_game_cafe",
      vat: { registered: false, priceIncludesVat: true, rate: 7, cashRounding: "NONE" } };
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const errors = [], mutations = [], consoleErrors = [];
    await context.addCookies([{ name: "lang", value: "th", url: base }]);
    await context.addInitScript(() => {
      window.bmsDesktop = { isDesktop: true, getDeviceToken: async () => "FAKE-token", getStorageNamespace: async () => "FAKE-offer",
        getAppInfo: async () => ({ version: "0.2.14-pilot.2", platform: "darwin", arch: "arm64" }) };
    });
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
      let json = {};
      if (path === "/api/graphql") {
        const q = body?.query || "";
        let data = {};
        if (q.includes("query PosBootstrap")) data = { bmsPosSession: bootstrap };
        else if (q.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
        else if (q.includes("bmsPosBoardGameCheckout(")) {
          assert.match(q, /offerEvaluation/);
          assert.match(q, /offerPaidMinutes offerFreeMinutes/);
          data = { bmsPosBoardGameCheckout: checkout };
        } else if (q.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: [] } };
        else if (q.includes("query DesktopBenefitsPreview")) data = { bmsPosMemberPreview: {
          status: "READY", subtotal: amount, netTotal: amount, amountDue: amount, totalDiscount: 0,
          tierDiscount: 0, couponDiscount: 0, pointsDiscount: 0, manualDiscount: 0, pointsUsed: 0, loyaltyEnabled: false, member: null } };
        else if (q.includes("mutation")) mutations.push(q);
        json = { data };
      } else if (path.endsWith("/desktop-update")) json = { status: "unavailable", releases: [] };
      else if (path === "/api/pos/session") json = bootstrap;
      else if (path === "/api/pos/board-game") {
        if (body?.action === "workspace") json = workspace;
        else if (body?.action === "session") json = { session: detail };
        else if (body?.action === "service.calls") json = { calls: [] };
        else mutations.push(body?.action);
      } else if (body && !["/api/logs", "/api/ws/ticket"].includes(path)) mutations.push(path);
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    try {
      await page.goto(`${base}/pos/app`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
      await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
      await page.getByRole("button", { name: /FAKE Table/ }).click();
      await page.getByRole("button", { name: /ไปเก็บเงินบิลนี้/ }).click();
      await page.getByText("ค่าเวลาเล่น · FAKE Table", { exact: true }).waitFor();
      await page.getByText(/คิดตามเวลาที่เล่นจริง/).waitFor();
      await page.getByText(/เวลาก่อนสิทธิ์ 3 ชม\./).waitFor();
      if (applied) {
        await page.getByText(/ตามโปร: จ่าย 2 ชม\. · ฟรี 1 ชม\./).waitFor();
        await page.getByText(/ลดค่าเล่น ฿50\.00/).waitFor();
        assert.equal(await page.getByText(/เหตุผลที่โปรไม่เข้า/).count(), 0);
      } else if (scenario === "INELIGIBLE") {
        await page.getByText("เหตุผลที่โปรไม่เข้า", { exact: true }).click();
        await page.getByText(/วันที่ปิดบิลไม่ใช่วันในสัปดาห์ที่โปรกำหนด/).waitFor();
      } else await page.getByText(/บิลนี้ไม่ได้บันทึกเหตุผลการเลือกโปรไว้/).waitFor();
      assert.equal(await page.getByLabel("รับเงินมา", { exact: true }).inputValue(), String(amount));
      await page.waitForFunction(() => !Array.from(document.querySelectorAll("button"))
        .find(button => button.textContent.includes("ยืนยันรับชำระ"))?.disabled);
      const textBounds = await page.getByText("FAKE Player", { exact: true }).boundingBox();
      assert.ok(textBounds.x >= 0 && textBounds.x + textBounds.width <= width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      await page.screenshot({ path: `${output}/${width}-${scenario}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      assert.deepEqual(mutations, []);
      console.log(`PASS ${width}px ${scenario}: frozen checkout, no live writes`);
    } catch (error) {
      console.error(consoleErrors.map(message => message.slice(0, 1200)).join("\n"));
      console.error((await page.locator("body").innerText()).slice(-6500));
      await page.screenshot({ path: `${output}/${width}-${scenario}-failure.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
