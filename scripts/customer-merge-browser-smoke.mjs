import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3107";
const output = ".test-output/customer-merge-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const customer = id => ({ id, name: `FAKE ${id}`, phone: null, note: null, tags: [], total_spent: 100,
  order_count: 1, created_at: "2026-10-01", identities: [], addresses: [], orders: [], coupons: [], membership: null });
const summary = id => ({ id, name: `FAKE ${id}`, phoneHint: "…1234", memberNo: "FAKE-001", channels: [id === "keep" ? "line" : "facebook"],
  orders: 2, addresses: 1, conversations: 1, pharmacyCases: 1, points: "50", coupons: 1, storeCredit: "20.00",
  openDeposits: 1, depositPaid: "15.00", passes: 1, renewals: 0, restaurantRequests: 0, gameRequests: 0 });
let previewCalls = 0;
const writes = [];
let rejectMerge = true;
const errors = [];
try {
  for (const [lang, width, height] of [["en", 1440, 1000], ["th", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base }, { name: "lang", value: lang, url: base }]);
    await context.route(/\/api\/|\/graphql(?:\?|$)/, async route => {
      const path = new URL(route.request().url()).pathname;
      let json = {};
      if (path === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE admin", language: lang } };
      else if (path.endsWith("/graphql")) {
        const { query, variables } = route.request().postDataJSON();
        let data = {};
        if (query.includes("MyBmsPermissions")) data = { myBmsPermissions: ["customer.view", "customer.edit"] };
        else if (query.includes("BmsWorkAssistant")) data = { bmsWorkAssistant: {
          reply: "FAKE merge proposal", answerType: "ACTION", citations: [], links: [], trace: [],
          proposals: [{ tool: "merge_customers", mutation: "bmsMergeCustomers", summary: "FAKE merge proposal",
            args: { keepId: "keep", mergeId: "source", review: { confirmed: true, evidenceReference: "FAKE-AI-MUST-NOT-COUNT" } } }],
        } };
        else if (query.includes("CustomerMergePreview")) {
          previewCalls++;
          assert.equal(variables.keepId, "keep"); assert.equal(variables.mergeId, "source");
          data = { bmsCustomerMergePreview: { keep: summary("keep"), source: summary("source"), previewToken: `FAKE-preview-${previewCalls}`, expiresAt: "2099-01-01" } };
        } else if (query.includes("ReviewedCustomerMerge")) {
          writes.push(variables);
          if (rejectMerge) return route.fulfill({ json: { errors: [{ message: "FAKE stale preview: refresh required" }] } });
          data = { bmsMergeCustomers: true };
        } else if (query.includes("bmsCustomers(")) data = { bmsCustomers: [customer("keep"), customer("source")] };
        else if (query.includes("bmsCustomerLocations")) data = { bmsCustomerLocations: [] };
        else if (query.includes("bmsMe")) data = { bmsMe: { id: "FAKE-admin", email: "fake@example.invalid", tenant: { id: "FAKE-tenant", slug: "fake-shop" } } };
        json = { data };
      }
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto(`${base}/admin/customers`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      const row = page.locator('tr[data-row-key="keep"]');
      await row.getByText("FAKE keep", { exact: true }).waitFor();
      await row.getByRole("button", { name: lang === "en" ? /Merge/ : /ผสาน/ }).click();
      const picker = page.getByRole("dialog").last();
      await picker.getByRole("combobox").fill("source");
      await page.locator(".ant-select-item-option").filter({ hasText: "FAKE source" }).click();
      await picker.getByRole("button", { name: lang === "en" ? "Review impact" : "ตรวจผลกระทบ", exact: true }).click();
      const review = page.getByRole("dialog", { name: lang === "en" ? "Review customer merge" : "ตรวจสอบก่อนรวมลูกค้า", exact: true });
      await review.getByText("20.00", { exact: true }).first().waitFor();
      // Ant's exiting spinner can retain an accessible "loading" prefix.
      const confirm = review.getByRole("button", { name: lang === "en" ? /Confirm customer merge$/ : /ยืนยันรวมลูกค้า$/ });
      assert.equal(await confirm.isEnabled(), false);
      await review.getByRole("checkbox").check();
      const before = writes.length;
      await confirm.click();
      assert.equal(writes.length, before, "required evidence blocks mutation");
      const selects = review.getByRole("combobox");
      await selects.nth(0).click();
      await page.locator(".ant-select-item-option").filter({ hasText: lang === "en" ? "Same customer across channels" : "ลูกค้าคนเดียวกันจากหลายช่องทาง" }).click();
      await selects.nth(1).click();
      await page.locator(".ant-select-item-option").filter({ hasText: lang === "en" ? "Verified with the customer in both channels" : "ตรวจสอบกับลูกค้าผ่านทั้งสองช่องทาง" }).click();
      await review.getByRole("textbox").fill("FAKE-CASE-001");
      await review.getByRole("textbox").press("Tab");
      await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
      await page.screenshot({ path: `${output}/${lang}-${width}.png`, fullPage: true });
      await review.getByText(lang === "en" ? "Review customer merge" : "ตรวจสอบก่อนรวมลูกค้า", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${lang}-${width}-preview.png`, fullPage: true });
      const bounds = await review.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, JSON.stringify(bounds));
      rejectMerge = true;
      await confirm.click();
      await review.getByText("FAKE stale preview: refresh required", { exact: true }).waitFor();
      assert.equal(await review.getByRole("checkbox").isChecked(), false);
      await review.getByRole("button", { name: lang === "en" ? "Refresh preview" : "โหลดผลกระทบใหม่", exact: true }).click();
      await review.getByText("20.00", { exact: true }).first().waitFor();
      await review.getByRole("checkbox").check();
      rejectMerge = false;
      await confirm.click();
      await review.waitFor({ state: "hidden" });
      const sent = writes.at(-1);
      assert.equal(sent.review.evidenceReference, "FAKE-CASE-001");
      assert.equal(sent.review.confirmed, true);
      assert.equal(sent.review.verificationMethod, "BOTH_CHANNELS");
      assert.equal(sent.review.previewToken, `FAKE-preview-${previewCalls}`);
      // Both assistant entry points must open the same review, not execute an
      // AI-supplied confirmation/evidence. Cancel must leave the proposal usable.
      const beforeAssistants = writes.length;
      await page.getByRole("button", { name: lang === "en" ? "Open work assistant" : "เปิดผู้ช่วยการทำงาน", exact: true }).click();
      const drawer = page.locator(".ant-drawer-body");
      await drawer.getByRole("textbox").fill("FAKE merge request");
      await drawer.getByRole("textbox").press("Enter");
      await drawer.getByRole("button", { name: lang === "en" ? /^(check )?Confirm$/ : /^(check )?ยืนยัน$/ }).click();
      await review.getByText("20.00", { exact: true }).first().waitFor();
      assert.equal(await review.getByRole("textbox").inputValue(), "");
      assert.equal(await review.getByRole("checkbox").isChecked(), false);
      await review.getByRole("button", { name: lang === "en" ? "Cancel" : "ยกเลิก", exact: true }).click();
      await page.locator(".ant-drawer-close").click();
      await page.goto(`${base}/admin/assistant`, { waitUntil: "domcontentloaded" });
      const assistantInput = page.getByPlaceholder(lang === "en" ? /Type a question or command/ : /พิมพ์คำถามหรือคำสั่ง/);
      await assistantInput.fill("FAKE merge request");
      await assistantInput.press("Enter");
      await page.getByRole("button", { name: lang === "en" ? /^(check )?Confirm$/ : /^(check )?ยืนยัน$/ }).click();
      await review.getByText("20.00", { exact: true }).first().waitFor();
      assert.equal(await review.getByRole("textbox").inputValue(), "");
      assert.equal(await review.getByRole("checkbox").isChecked(), false);
      await review.getByRole("button", { name: lang === "en" ? "Cancel" : "ยกเลิก", exact: true }).click();
      assert.equal(writes.length, beforeAssistants, "assistant proposals/cancellation never merge");
    } catch (error) {
      await page.screenshot({ path: `${output}/failure-${lang}.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
  console.log("PASS: desktop EN / mobile TH, preview, evidence required, stale reset, confirmed payload, both assistant review/cancel paths");
} finally { await browser.close(); }
