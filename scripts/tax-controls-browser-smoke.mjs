import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3107";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Local fixture server only");
const output = ".test-output/tax-controls-browser";
await mkdir(output, { recursive: true });
const seller = { name: "FAKE ร้านทดสอบ", taxId: "0105555555554", branchCode: "00000", address: "FAKE กรุงเทพมหานคร", phone: null, locationName: "FAKE HQ" };
const buyer = { name: "FAKE ผู้ซื้อ", taxId: null, branchCode: null, address: "FAKE ที่อยู่ผู้ซื้อ", phone: null };
const invoice = { id: "full", orderId: "order", docNo: "FAKE-FULL-001", issueDate: "2026-09-15", replacesDocNo: null, calendarEra: "BE", seller, buyer,
  lines: [{ sku: "FAKE", name: "FAKE สินค้าทดสอบภาษาไทย", size: "M", qty: 2, unit: "ชิ้น", unitPrice: 107, amount: 214 }],
  subtotal: 214, discount: 0, shipping: 0, netBeforeVat: 200, exemptAmount: 0, vatAmount: 14, vatRate: 7, roundingAmount: 0, grandTotal: 214, amountText: "สองร้อยสิบสี่บาทถ้วน" };
const row = { id: "full", orderId: "order", locationId: "hq", locationCode: "HQ", branchCode: "00000", deviceCode: null, docType: "FULL", docNo: invoice.docNo, issueDate: invoice.issueDate, issuedAt: "2026-09-15T10:00:00Z", cancelledAt: null, cancelledReason: null, buyerName: buyer.name, buyerTaxId: null, referenceDocNo: null, channel: "pos", base: 200, exempt: 0, vat: 14, total: 214, rounding: 0 };
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-fixture", url: base }, { name: "lang", value: "th", url: base }]);
    const requests = [];
    const permissions = ["tax.document.view", "tax.document.issue", "tax.document.adjust", "tax.period.close", "expense.view"];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!/\/api\/|\/graphql$/.test(url.pathname)) return route.continue();
      let json = {};
      if (url.pathname === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE", role: "Administrator", name: "FAKE admin", language: "th" } };
      else if (url.pathname === "/api/bms/tax-invoice-requests") json = { enabled: false, rows: [], hasMore: false };
      else if (url.pathname === "/api/bms/tax-controls") {
        if (route.request().method() === "GET") json = { actions: [], periods: [] };
        else {
          const input = route.request().postDataJSON(); requests.push(input);
          const doc = input.action === "CREDIT" || input.action === "DEBIT" ? {
            ...invoice, docNo: input.confirmed ? "FAKE-NOTE-001" : undefined, original: { docNo: invoice.docNo, issueDate: invoice.issueDate },
            issueDate: "2026-10-14", reason: input.reason, originalValue: 214, previouslyCredited: 0, correctValue: input.action === "CREDIT" ? 107 : 321,
            difference: 107, differenceBeforeVat: 100, exemptAmount: 0, vatAmount: 7, amountText: "หนึ่งร้อยเจ็ดบาทถ้วน",
            lines: [{ name: input.reason, size: "", qty: 1, unit: "รายการ", amount: 107 }],
          } : { ...invoice, buyer: input.action === "CORRECT" ? input.buyer : buyer };
          const snapshot = input.action === "CLOSE"
            ? { action: "CLOSE", month: input.month, version: 1, report: { grandTotal: { base: 200, vat: 14, total: 214 } }, purchaseReport: { totals: { vatAmount: 7 } }, reason: input.reason }
            : { action: input.action, documentType: input.action === "DEBIT" ? "DEBIT_NOTE" : input.action === "CREDIT" ? "CREDIT_NOTE" : "FULL", document: doc, copyNumber: 1, issueDate: "2026-10-14", reason: input.reason, actorName: "FAKE staff" };
          json = { status: input.confirmed ? "COMPLETED" : "PREVIEW", reviewHash: "FAKE-review-hash", id: "FAKE-action", snapshot };
        }
      } else if (url.pathname.endsWith("/graphql")) {
        const { query: q = "" } = route.request().postDataJSON() || {};
        const data = q.includes("MyBmsPermissions") ? { myBmsPermissions: permissions }
          : q.includes("SalesTaxSummary") ? { bmsSalesTaxReport: { vatRegistered: true, sellerTaxId: seller.taxId, from: "2026-09-01", to: "2026-09-30", cancelledCount: 0,
            grandTotal: { documentCount: 1, base: 200, exempt: 0, vat: 14, total: 214, rounding: 0 }, totals: [], exceptions: [], exceptionCounts: { paidWithoutTaxDocument: 0, returnWithoutCreditNote: 0, fullReplacesOtherMonth: 0 } } }
          : q.includes("TaxDocumentList") ? { bmsTaxDocumentList: { total: 1, rows: [row] } }
          : q.includes("TaxEstablishments") ? { bmsTaxEstablishments: [{ locationId: "hq", code: "HQ", name: "FAKE HQ", branchCode: "00000", isHeadOffice: true }] }
          : q.includes("FullTaxInvoiceView") ? { bmsFullTaxInvoiceView: invoice } : {};
        json = { data };
      }
      return route.fulfill({ json });
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message)); page.setDefaultTimeout(30000);
    const choose = async (locator, label) => { await locator.locator("xpath=ancestor::div[contains(@class,'ant-select-selector')]").click(); await page.locator(".ant-select-dropdown:visible").getByText(label, { exact: true }).click(); };
    try {
      await page.goto(`${base}/admin/tax-documents`, { waitUntil: "domcontentloaded", timeout: 120000 });
      for (const [action, label] of [["SUBSTITUTE", "ออกใบแทน"], ["CORRECT", "แก้ข้อมูลผู้ซื้อ ออกฉบับใหม่"], ["CREDIT", "ใบลดหนี้ปรับราคา"], ["DEBIT", "ใบเพิ่มหนี้ปรับราคา"], ["CLOSE", "เก็บฉบับปิดงวดภาษีขายและซื้อ"]]) {
        await page.getByRole("button", { name: "ทำรายการเอกสาร", exact: true }).click();
        const formDialog = page.getByRole("dialog", { name: "ทำรายการเอกสาร", exact: true });
        if (action !== "SUBSTITUTE") await choose(formDialog.locator("#action"), label);
        if (action === "CLOSE") await choose(formDialog.locator("#locationId"), "00000 · FAKE HQ");
        else {
          await choose(formDialog.locator("#documentId"), invoice.docNo);
          await formDialog.locator("#evidence").fill("FAKE customer evidence");
        }
        await formDialog.locator("#reason").fill("FAKE ปรับราคาสินค้า A");
        if (action === "CORRECT") {
          await formDialog.getByRole("checkbox").check();
          await formDialog.locator("#buyer_name").fill("FAKE corrected buyer");
          await formDialog.locator("#buyer_address").fill("FAKE corrected address");
          await formDialog.getByRole("radio", { name: "จด VAT", exact: true }).check();
          await formDialog.locator("#buyer_taxId").fill("0105555555554");
          await formDialog.locator("#buyer_branchCode").fill("00002");
        }
        if (["CREDIT", "DEBIT"].includes(action)) {
          await formDialog.locator("#base").fill("100");
          await formDialog.locator("#eventDate").fill("2026-10-14");
        }
        await formDialog.getByRole("button", { name: "ตรวจตัวอย่างก่อนยืนยัน" }).click();
        const review = page.getByRole("dialog", { name: "ตรวจเอกสารและยืนยันรายการ" });
        await review.waitFor();
        assert.equal(requests.at(-1).action, action);
        assert.notEqual(requests.at(-1).confirmed, true);
        assert.equal(await review.getByRole("button", { name: "พิมพ์", exact: true }).count(), 0);
        await review.getByRole("button", { name: "ยืนยันบันทึกเอกสาร", exact: true }).click();
        const result = page.getByRole("dialog", { name: "ดูเอกสาร", exact: true }); await result.waitFor();
        assert.equal(requests.at(-1).confirmed, true); assert.equal(requests.at(-1).reviewHash, "FAKE-review-hash");
        assert.equal(requests.at(-1).idempotencyKey, requests.at(-2).idempotencyKey);
        if (action !== "CLOSE") {
          await page.evaluate(() => document.fonts.ready);
          await result.screenshot({ path: `${output}/${width}-${action}.png`, animations: "disabled" });
          assert.equal(await page.locator("[data-print-root]").count(), 1, "only the committed document may enter print output");
          const bounds = await result.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
          assert.ok(bounds.scroll <= bounds.width + 2, `${width} ${action}: modal overflow`);
          await page.pdf({ path: `${output}/${width}-${action}.pdf`, format: "A4", printBackground: true });
        }
        await result.getByRole("button", { name: "Close", exact: true }).click();
        await result.waitFor({ state: "hidden" });
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: substitute, correction/VAT individual, credit, debit, period confirmation; mocked API only`);
    } catch (error) { await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true }); throw error; }
    finally { await context.close(); }
  }
} finally { await browser.close(); }
