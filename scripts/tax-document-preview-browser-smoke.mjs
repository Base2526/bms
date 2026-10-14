import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3107";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Local fixture server only");
const output = ".test-output/tax-document-preview";
await mkdir(output, { recursive: true });
const seller = { name: "FAKE ร้านทดสอบ", taxId: "0105555555554", branchCode: "00000", address: "FAKE กรุงเทพมหานคร", phone: null, locationName: "FAKE HQ" };
const buyer = { name: "FAKE ผู้ซื้อ", taxId: null, branchCode: null, address: "FAKE ที่อยู่ผู้ซื้อ", phone: null };
const invoice = { id: "full", orderId: "order", docNo: "FAKE-FULL-001", issueDate: "2026-10-14", replacesDocNo: "FAKE-ABB-001", calendarEra: "BE", seller, buyer,
  lines: [{ sku: "FAKE", name: "FAKE สินค้าทดสอบภาษาไทย", size: "M", qty: 2, unit: "ชิ้น", unitPrice: 107, amount: 214 }],
  subtotal: 214, discount: 0, shipping: 0, netBeforeVat: 200, exemptAmount: 0, vatAmount: 14, vatRate: 7, roundingAmount: 0, grandTotal: 214, amountText: "สองร้อยสิบสี่บาทถ้วน" };
const note = { id: "credit", orderId: "order", docNo: "FAKE-CN-001", issueDate: "2026-10-14", cancelledAt: null, cancelledReason: null, reason: "FAKE รับคืนสินค้า", calendarEra: "BE", seller, buyer,
  original: { docNo: invoice.docNo, docType: "FULL", issueDate: invoice.issueDate }, replacesDocNo: null,
  lines: [{ name: "FAKE สินค้าทดสอบภาษาไทย", size: "M", qty: 1, unit: "ชิ้น", amount: 107 }], lineAdjustment: -10,
  originalValue: 214, previouslyCredited: 0, correctValue: 117, difference: 97, differenceBeforeVat: 90.65, exemptAmount: 0, vatAmount: 6.35, vatRate: 7, amountText: "เก้าสิบเจ็ดบาทถ้วน" };
const rows = [["full", "FULL"], ["credit", "CREDIT_NOTE"], ["cancelled-full", "FULL"], ["cancelled-credit", "CREDIT_NOTE"]].map(([id, docType]) => ({
  id, orderId: "order", locationId: "hq", locationCode: "HQ", branchCode: "00000", deviceCode: null, docType, docNo: `FAKE-${id}`, issueDate: "2026-10-14", issuedAt: "2026-10-14T10:00:00Z",
  cancelledAt: id.startsWith("cancelled") ? "2026-10-14T11:00:00Z" : null, cancelledReason: null, buyerName: buyer.name, buyerTaxId: null, referenceDocNo: null, channel: "pos", base: 100, exempt: 0, vat: 7, total: 107, rounding: 0,
}));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-fixture", url: base }, { name: "lang", value: "th", url: base }]);
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!/\/api\/|\/graphql$/.test(url.pathname)) return route.continue();
      let json = {};
      if (url.pathname === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE", role: "Administrator", name: "FAKE admin", language: "th" } };
      else if (url.pathname === "/api/bms/tax-invoice-requests") json = { enabled: false, rows: [], hasMore: false };
      else if (url.pathname.endsWith("/graphql")) {
        const { query: q = "", variables = {} } = route.request().postDataJSON() || {};
        const data = q.includes("MyBmsPermissions") ? { myBmsPermissions: ["tax.document.view", "tax.document.issue"] }
          : q.includes("SalesTaxSummary") ? { bmsSalesTaxReport: { vatRegistered: true, sellerTaxId: seller.taxId, from: "2026-10-01", to: "2026-10-31", cancelledCount: 2,
            grandTotal: { documentCount: 4, base: 0, exempt: 0, vat: 0, total: 0, rounding: 0 }, totals: [], exceptions: [], exceptionCounts: { paidWithoutTaxDocument: 0, returnWithoutCreditNote: 0, fullReplacesOtherMonth: 0 } } }
          : q.includes("TaxDocumentList") ? { bmsTaxDocumentList: { total: rows.length, rows } }
          : q.includes("TaxEstablishments") ? { bmsTaxEstablishments: [{ locationId: "hq", code: "HQ", name: "FAKE HQ", branchCode: "00000", isHeadOffice: true }] }
          : q.includes("FullTaxInvoiceView") ? { bmsFullTaxInvoiceView: variables.documentId === "cancelled-full" ? null : invoice }
          : q.includes("CreditNoteView") ? { bmsCreditNoteView: variables.documentId === "cancelled-credit" ? { ...note, id: "cancelled-credit", cancelledAt: "2026-10-14T11:00:00Z", cancelledReason: "FAKE cancelled" } : note } : {};
        json = { data };
      }
      return route.fulfill({ json });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.setDefaultTimeout(25000);
    try {
      await page.goto(`${base}/admin/tax-documents`, { waitUntil: "domcontentloaded", timeout: 120000 });
      for (const [id, label] of [["full", "ดูใบเต็ม"], ["credit", "ดูใบลดหนี้"]]) {
        await page.locator(`tr[data-row-key="${id}"]`).getByRole("button").click();
        const dialog = page.getByRole("dialog");
        const root = dialog.locator("[data-print-root]");
        await root.waitFor();
        assert.ok((await root.innerText()).includes("14/10/2569"));
        await dialog.getByText("สำเนา", { exact: true }).first().click();
        assert.ok((await root.innerText()).includes("สำเนา"));
        assert.equal(await root.locator(".ant-card").innerText(), "ผู้ซื้อสินค้า/ผู้รับบริการ\nFAKE ผู้ซื้อ\nFAKE ที่อยู่ผู้ซื้อ");
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `modal overflow at ${width}px: ${id}`);
        await page.screenshot({ path: `${output}/${width}-${id}.png`, fullPage: true, animations: "disabled" });
        await page.emulateMedia({ media: "print" });
        assert.equal(await page.locator("[data-print-root]").count(), 1);
        await page.pdf({ path: `${output}/${width}-${id}.pdf`, format: "A4", printBackground: true });
        await page.emulateMedia({ media: "screen" });
        await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
        await root.waitFor({ state: "detached" });
      }
      for (const id of ["cancelled-full", "cancelled-credit"]) {
        await page.locator(`tr[data-row-key="${id}"]`).getByRole("button").click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: /พิมพ์/ }).waitFor();
        await page.waitForFunction(() => !document.querySelector('[data-print-root]'));
        assert.equal(await dialog.getByRole("button", { name: /พิมพ์/ }).isDisabled(), true);
        await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      await page.goto(`${base}/admin/manual`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByText(/ใบกำกับเต็มรูปออกได้เฉพาะ COMPLETED/).waitFor();
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: invoice/credit note, copy label, Thai dates, cancelled-print denial, manual; mocked API only`);
    } catch (e) {
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      throw e;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
