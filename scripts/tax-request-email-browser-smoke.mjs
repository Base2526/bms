import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3003";
const output = ".test-output/tax-request-email";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-fixture", url: base }, { name: "lang", value: "th", url: base }]);
    let row = { id: "11111111-1111-4111-8111-111111111111", orderId: "FAKE-order", status: "PENDING", version: 1,
      createdAt: "2026-10-12T10:00:00Z", locationName: "FAKE shop", branchCode: "00000", receiptNo: "FAKE-001", total: 107,
      submissionCount: 1, requestDeadline: "2026-10-19T10:00:00Z", email: null,
      buyer: { name: "FAKE ผู้ซื้อทดสอบ", taxId: "0105555555554", branchCode: "00000", address: "FAKE กรุงเทพมหานคร 10140", email: "fake@example.test" } };
    const writes = [], errors = [];
    await context.route(/\/api\/|\/graphql(?:\?|$)/, async route => {
      const url = new URL(route.request().url());
      let json = {};
      if (url.pathname === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE", role: "Administrator", name: "FAKE admin", language: "th" } };
      else if (url.pathname === "/api/bms/tax-invoice-requests") {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON(); writes.push(body);
          row = { ...row, status: "ISSUED", version: 2, email: { id: "22222222-2222-4222-8222-222222222222", status: body.action === "EMAIL" ? "PENDING" : "FAILED", errorCode: body.action === "EMAIL" ? null : "PDF_FAILED", recipient: row.buyer.email, createdAt: row.createdAt, finishedAt: body.action === "EMAIL" ? null : row.createdAt } };
          json = { status: "ISSUED", documentId: "FAKE-document", emailId: row.email.id };
        } else json = { enabled: true, rows: url.searchParams.get("status") === row.status ? [row] : [], hasMore: false };
      } else if (url.pathname.endsWith("/graphql")) {
        const q = route.request().postDataJSON()?.query || "";
        const data = q.includes("MyBmsPermissions") ? { myBmsPermissions: ["tax.document.view", "tax.document.issue"] }
          : q.includes("SalesTaxSummary") ? { bmsSalesTaxReport: { vatRegistered: true, sellerTaxId: "0105555555554", from: "2026-10-01", to: "2026-10-31", cancelledCount: 0,
            grandTotal: { documentCount: 0, base: 0, exempt: 0, vat: 0, total: 0, rounding: 0 }, totals: [], exceptions: [], exceptionCounts: { paidWithoutTaxDocument: 0, returnWithoutCreditNote: 0, fullReplacesOtherMonth: 0 } } }
          : q.includes("TaxDocumentList") ? { bmsTaxDocumentList: { total: 0, rows: [] } }
          : q.includes("TaxEstablishments") ? { bmsTaxEstablishments: [] } : {};
        json = { data };
      }
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(`${base}/admin/tax-documents`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByRole("button", { name: "ตรวจคำขอ", exact: true }).click();
      const modal = page.getByRole("dialog");
      const checkbox = modal.getByRole("checkbox");
      assert.equal(await checkbox.isChecked(), true);
      await checkbox.uncheck();
      await modal.getByRole("button", { name: "ยืนยันดำเนินการ", exact: true }).waitFor();
      await checkbox.check();
      await modal.getByText("fake@example.test", { exact: true }).last().waitFor();
      const emailNotice = modal.locator(".ant-alert").filter({ hasText: "ส่งสำเนา PDF ไปยังอีเมลนี้หลังออกเอกสาร ไม่ใช่การส่ง e-Tax" });
      await emailNotice.locator(".ant-alert-close-icon").click();
      await emailNotice.waitFor({ state: "hidden" });
      assert.equal(writes.length, 0, "dismissing the notice must not send an email");
      assert.equal(await checkbox.isChecked(), true, "dismissing the notice must not change the email choice");
      await modal.getByRole("button", { name: "ยกเลิก", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "ตรวจคำขอ", exact: true }).click();
      await emailNotice.waitFor({ state: "visible" });
      assert.equal(writes.length, 0, "reopening confirmation must not send an email");
      await emailNotice.locator(".ant-alert-close-icon").click();
      await emailNotice.waitFor({ state: "hidden" });
      await page.screenshot({ path: `${output}/${width}-confirm.png`, fullPage: true, animations: "disabled" });
      const bounds = await modal.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await modal.getByRole("button", { name: "ออกใบกำกับและส่งอีเมล", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      assert.equal(writes.length, 1);
      assert.equal(writes[0].sendEmail, true);
      assert.equal(writes[0].emailRecipient, "fake@example.test");
      const card = page.locator(".ant-card").filter({ has: page.getByText("คำขอใบกำกับภาษีออนไลน์", { exact: true }) });
      await card.getByText("ส่งไม่สำเร็จ", { exact: true }).waitFor();
      await card.getByText("สร้างไฟล์ PDF ใบกำกับไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบก่อนส่งอีกครั้ง", { exact: true }).waitFor();
      await card.screenshot({ path: `${output}/${width}-failure-reason.png`, animations: "disabled" });
      await card.getByRole("button", { name: "ส่งอีเมลอีกครั้ง", exact: true }).click();
      await modal.getByText(/ตรวจอีเมลผู้รับก่อนส่งอีกครั้ง/).waitFor();
      await modal.getByRole("button", { name: "ยืนยันส่งอีเมล", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      await card.getByText("รอส่ง", { exact: true }).waitFor();
      assert.equal(await card.getByRole("button", { name: "ส่งอีเมลอีกครั้ง", exact: true }).isDisabled(), true);
      // Simulate worker completion; the UI must pick it up by polling without another user action.
      row = { ...row, email: { ...row.email, status: "SENT", finishedAt: row.createdAt } };
      await card.getByText("ผู้ให้บริการรับส่งแล้ว", { exact: true }).waitFor();
      assert.equal(await card.getByText("สร้างไฟล์ PDF ใบกำกับไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบก่อนส่งอีกครั้ง", { exact: true }).count(), 0);
      assert.equal(writes.length, 2);
      assert.equal(writes[1].action, "EMAIL");
      assert.equal(writes[1].expectedEmailId, "22222222-2222-4222-8222-222222222222");
      assert.ok(writes[1].emailKey);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: notice dismissal, opt-out, issue + email, reviewed resend and polled completion; mocked API only`);
    } catch (error) {
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      console.error((await page.locator("body").innerText()).slice(-2000));
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
