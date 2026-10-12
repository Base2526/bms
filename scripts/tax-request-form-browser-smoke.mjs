import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3003";
const output = ".test-output/tax-request-form";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "lang", value: "th", url: base }]);
    let saved = null;
    let version = 1;
    const submissions = [], errors = [];
    const policy = { canSubmit: true, expiresAt: "2026-10-18T14:00:00Z", submissions: 0, maxSubmissions: 3, remaining: 3 };
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let json = {};
      if (path === "/api/bms/tax-invoice-request") {
        const body = route.request().postDataJSON();
        if (body.action === "inspect") json = { storeName: "FAKE Shop", documentNo: "FAKE-001", total: 970, policy };
        else if (["submit", "revise"].includes(body.action)) {
          submissions.push(body);
          saved = body.buyer;
          if (body.action === "revise") version++;
          json = { access: "FAKE-private-tracking" };
        } else if (body.action === "track") json = { status: "PENDING", buyer: saved, version, policy };
      }
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(`${base}/tax-invoice/request#FAKE-receipt-token`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByText("บุคคลธรรมดา", { exact: true }).click();
      await page.getByLabel("เลขประจำตัวผู้เสียภาษี / เลขประจำตัวประชาชน", { exact: true }).fill("0105555555554");
      await page.getByLabel("ชื่อ-นามสกุล", { exact: true }).fill("FAKE Buyer");
      await page.getByLabel("ที่อยู่ในการออกใบกำกับภาษี (บรรทัดที่ 1)", { exact: true }).fill("FAKE address 1");
      await page.getByLabel("ที่อยู่ในการออกใบกำกับภาษี (บรรทัดที่ 2)", { exact: true }).fill("FAKE address 2");
      await page.getByLabel("จังหวัด", { exact: true }).click();
      await page.getByLabel("จังหวัด", { exact: true }).fill("กรุงเทพมหานคร");
      await page.getByLabel("จังหวัด", { exact: true }).press("Enter");
      await page.getByLabel("รหัสไปรษณีย์", { exact: true }).fill("10140");
      await page.getByLabel("เบอร์โทรศัพท์", { exact: true }).fill("020000000");
      const email = page.getByLabel("อีเมล (สำหรับติดต่อเรื่องการจัดส่งเอกสาร)", { exact: true });
      const submit = page.getByRole("button", { name: "ยืนยันข้อมูลและส่งคำขอ" });
      assert.equal(await email.getAttribute("aria-required"), "true");
      await submit.click();
      await page.getByText("กรุณากรอกอีเมลสำหรับติดต่อเรื่องการจัดส่งเอกสาร", { exact: true }).waitFor();
      assert.equal(submissions.length, 0, "missing email cannot submit");
      await email.fill("invalid");
      await submit.click();
      assert.equal(await email.evaluate(input => input.validity.typeMismatch), true);
      assert.equal(submissions.length, 0, "invalid email cannot submit");
      await email.fill("fake@example.test");
      await page.waitForFunction(() => !document.querySelector(".ant-form-item-explain-error"));
      await page.keyboard.press("Escape");
      await page.screenshot({ path: `${output}/${width}-form.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal overflow");
      await page.getByRole("button", { name: "ยืนยันข้อมูลและส่งคำขอ" }).click();
      await page.getByRole("heading", { name: "รอร้านตรวจสอบ" }).waitFor();
      assert.equal(submissions.length, 1);
      assert.equal(saved.buyerType, "INDIVIDUAL");
      assert.equal(saved.addressLine2, "FAKE address 2");
      assert.equal(saved.email, "fake@example.test");
      await page.reload({ waitUntil: "domcontentloaded" });
      assert.equal(await page.getByLabel("อีเมล (สำหรับติดต่อเรื่องการจัดส่งเอกสาร)", { exact: true }).inputValue(), "fake@example.test");
      await page.getByText("นิติบุคคล", { exact: true }).click();
      await page.getByLabel("รหัสสาขา 5 หลัก (สำนักงานใหญ่ 00000)", { exact: true }).fill("00001");
      await email.fill("");
      await submit.click();
      await page.getByText("กรุณากรอกอีเมลสำหรับติดต่อเรื่องการจัดส่งเอกสาร", { exact: true }).waitFor();
      assert.equal(submissions.length, 1, "a correction also requires email");
      await email.fill("fake@example.test");
      await page.getByRole("button", { name: "ยืนยันข้อมูลและส่งคำขอ" }).click();
      await page.waitForFunction(() => !document.querySelector('.ant-btn-loading'));
      assert.equal(submissions.at(-1).version, 1);
      assert.equal(saved.buyerType, "COMPANY");
      assert.equal(saved.branchCode, "00001");
      await page.getByText("Foreigner (ชาวต่างชาติ)", { exact: true }).click();
      await page.getByText(/ช่องทางออนไลน์รองรับผู้มีเลขประจำตัวผู้เสียภาษีไทย/).waitFor();
      await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "ยืนยันข้อมูลและส่งคำขอ" }).count(), 0);
      assert.equal(submissions.length, 2, "cancel does not send a request");
      await page.getByText("บุคคลธรรมดา", { exact: true }).click();
      assert.equal(await page.getByLabel("ชื่อ-นามสกุล", { exact: true }).inputValue(), "FAKE Buyer");
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: buyer selection, submit, tracking reload, company correction, foreigner notice and cancellation; mocked API only`);
    } catch (error) {
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
