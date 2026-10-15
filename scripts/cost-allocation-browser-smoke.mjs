import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3107";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Local fixture server only");
const output = ".test-output/cost-allocation-browser";
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
    let permissions = ["report.view", "expense.view", "delivery.settlement.view", "tax.document.view", "expense.manage"];
    let saved = null, writeFailure = false, readFailure = false, held = null, holdNext = false, savedInput;
    const key = "DOCUMENT:00000000-0000-4000-8000-000000000099", branch = "00000000-0000-4000-8000-000000000001";
    const fingerprint = "a".repeat(64);
    const snapshot = input => ({ version: 1, month: input.month, sourceKey: key, amount: "100.00", fingerprint,
      currency: "THB", salesBasis: "PAID_PRODUCT_ACTIVITY_BEFORE_RETURNS_V1", rule: input.rule,
      allocations: [{ locationId: branch, channel: null, basisWeight: "1", amount: "100.00" }] });
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
        else if (q.includes("query CostAllocations")) {
          if (readFailure) data = { bmsCostAllocations: { status: "REJECTED", errorCode: "COST_ALLOCATION_CURRENCY_REVIEW_REQUIRED" } };
          else data = { bmsCostAllocations: { status: "OK", errorCode: null, month: variables.month, currency: "THB", complete: !!saved,
            truncated: false, unresolvedCount: saved ? 0 : 1, knownAllocated: saved ? "100.00" : "0.00", allocatedTotal: saved ? "100.00" : null,
            reviewedTotal: "100.00", locations: [{ id: branch, name: "FAKE Branch" }],
            groups: saved ? [{ locationId: branch, channel: null, amount: "100.00" }] : [],
            rows: [{ sourceKey: key, reference: "FAKE-RENT", classification: "OPERATING", amount: "100.00", state: saved ? "CURRENT" : "UNALLOCATED", issue: null,
              version: saved ? 1 : 0, snapshot: saved }] } };
        } else if (q.includes("query PreviewCostAllocation")) {
          if (holdNext) { holdNext = false; await new Promise(resolve => { held = resolve; }); }
          data = { bmsPreviewCostAllocation: { status: "READY", errorCode: null, expectedVersion: saved ? 1 : 0, snapshot: snapshot(variables.input) } };
        } else if (q.includes("mutation SaveCostAllocation")) {
          savedInput = variables.input;
          if (writeFailure) data = { bmsSaveCostAllocation: { status: "REJECTED", errorCode: "COST_ALLOCATION_PREVIEW_STALE", version: null, replayed: null } };
          else { saved = snapshot(variables.input); data = { bmsSaveCostAllocation: { status: "SAVED", errorCode: null, version: 1, replayed: false } }; }
        } else if (q.includes("bmsSalesSummary")) data = { bmsSalesSummary: null, bmsInventorySummary: null, bmsTopSellingProducts: [], bmsManagementReport: null };
        else if (q.includes("bmsGeneratedReports")) data = { bmsGeneratedReports: [] };
        else if (q.includes("bmsLocations")) data = { bmsLocations: [] };
        else if (q.includes("bmsActingTenant")) data = { bmsActingTenant: null };
        json = { data };
      }
      return route.fulfill({ json });
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message)); page.setDefaultTimeout(20000);
    const label = (th, en) => lang === "th" ? th : en;
    const open = label("เปิดปันส่วนค่าใช้จ่าย", "Open expense allocation");
    const detailsLabel = label("ตรวจรายละเอียด", "Review details");
    const previewLabel = label("ดูตัวอย่างปันส่วน", "Preview allocation");
    // Ant's exiting spinner can retain an accessible "loading" prefix after busy=false.
    // Match the action suffix without depending on animation completion in headless tabs.
    const previewName = new RegExp(`${previewLabel}$`);
    const saveLabel = label("บันทึกปันส่วนเวอร์ชันใหม่", "Save new allocation version");
    try {
      assert.equal((await page.goto(`${base}/admin/reports`, { waitUntil: "domcontentloaded", timeout: 120000 })).status(), 200);
      await page.getByRole("button", { name: open, exact: true }).click();
      const worksheet = page.getByRole("dialog").first();
      await worksheet.getByText(label("ปันส่วนไม่ครบหรือหลักฐานเปลี่ยน — ยอดรวมยังไม่ทราบ", "Allocation incomplete or stale — full total unknown"), { exact: true }).waitFor();
      let bounds = await worksheet.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await worksheet.getByRole("button", { name: detailsLabel, exact: true }).click();
      let details = page.getByRole("dialog").last();
      await details.locator("#reason").fill("FAKE reviewed allocation");
      bounds = await details.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await details.screenshot({ path: `${output}/${lang}-${width}-details.png`, animations: "disabled" });
      holdNext = true;
      const previewRequest = page.waitForRequest(r => r.postData()?.includes("query PreviewCostAllocation"));
      await details.getByRole("button", { name: previewName }).click(); await previewRequest;
      assert.equal(await details.locator("#reason").isDisabled(), true);
      assert.equal(await details.locator("#method").isDisabled(), true);
      // Closing the source invalidates a held response; reopening must not inherit its confirmation.
      await details.locator(".ant-modal-close").click();
      await worksheet.getByRole("button", { name: detailsLabel, exact: true }).click(); details = page.getByRole("dialog").last();
      const oldResponse = page.waitForResponse(r => r.request().postData()?.includes("query PreviewCostAllocation"));
      assert.ok(held); held(); await oldResponse;
      assert.equal(await details.getByRole("checkbox").count(), 0);
      await details.locator("#reason").fill("FAKE latest allocation");
      await details.getByRole("button", { name: previewName }).click();
      await details.getByRole("checkbox").waitFor();
      assert.equal(await details.getByRole("button", { name: saveLabel }).isDisabled(), true); assert.equal(savedInput, undefined);
      await details.getByRole("checkbox").check(); writeFailure = true;
      await details.getByRole("button", { name: saveLabel }).click();
      await page.getByText(/COST_ALLOCATION_PREVIEW_STALE/).waitFor();
      assert.equal(await details.getByRole("checkbox").count(), 0);
      assert.equal(await details.locator("#reason").inputValue(), "FAKE latest allocation");
      writeFailure = false;
      await details.getByRole("button", { name: previewName }).click(); await details.getByRole("checkbox").check();
      await details.getByRole("button", { name: saveLabel }).click();
      await worksheet.getByText(label("ปันส่วนหลักฐานที่ตรวจครบแล้ว (ไม่ยืนยันว่าบันทึกรายจ่ายครบ)", "Loaded reviewed costs allocated (not proof all expenses were entered)"), { exact: true }).waitFor();
      assert.equal(savedInput.expectedVersion, 0); assert.equal(savedInput.previewFingerprint, fingerprint); assert.equal(savedInput.confirmed, true);
      assert.equal(savedInput.tenantId, undefined); assert.equal(savedInput.amount, undefined);
      await page.screenshot({ path: `${output}/${lang}-${width}-saved.png`, animations: "disabled" });
      readFailure = true;
      await worksheet.getByRole("button", { name: /Refresh/ }).click();
      await worksheet.getByText("COST_ALLOCATION_CURRENCY_REVIEW_REQUIRED", { exact: true }).waitFor();
      assert.equal(await worksheet.getByText(/฿100\.00/).count(), 0);
      readFailure = false; permissions = permissions.filter(p => p !== "expense.manage");
      await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: open, exact: true }).click();
      await page.getByRole("button", { name: detailsLabel, exact: true }).click(); details = page.getByRole("dialog").last();
      assert.equal(await details.locator("#reason").isDisabled(), true);
      assert.equal(await details.getByRole("button", { name: previewName }).count(), 0);
      permissions = permissions.filter(p => p !== "tax.document.view");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /^(Reports|รายงาน)$/ }).first().waitFor();
      assert.equal(await page.getByRole("button", { name: open, exact: true }).count(), 0);
      await page.goto(`${base}/admin/manual`, { waitUntil: "domcontentloaded" });
      await page.getByText(lang === "th" ? /ปันส่วนค่าใช้จ่าย: รายงาน/ : /Expense allocation: Reports/).waitFor();
      assert.deepEqual(errors, []);
      console.log(`PASS ${lang} ${width}px: delayed preview, close/reopen, explicit confirmation, stale rejection, retry, read-only and permissions`);
    } catch (error) {
      console.log({ errors, dialogs: await page.getByRole("dialog").allTextContents() }); await page.screenshot({ path: `${output}/${lang}-${width}-failure.png`, fullPage: true }); throw error;
    } finally { if (held) held(); await context.close(); }
  }
} finally { await browser.close(); }
