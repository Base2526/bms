import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3003";
const output = ".test-output/customer-purchase-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base }, { name: "lang", value: "th", url: base }]);
let customerReads = 0, detailReads = 0, balance = 0, detailFails = false;
const errors = [], mutations = [];
await context.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  let json = {};
  if (path === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE admin", language: "th" } };
  else if (path === "/api/graphql") {
    const { query, variables } = route.request().postDataJSON();
    let data = {};
    if (/\bmutation\b/.test(query)) mutations.push(query);
    if (query.includes("MyBmsPermissions")) data = { myBmsPermissions: ["customer.view"] };
    else if (query.includes("CustomerPurchaseDetail")) {
      detailReads++;
      assert.equal(variables.customerId, "FAKE-customer");
      assert.equal(variables.orderId, "FAKE-order");
      if (detailFails) return route.fulfill({ json: { errors: [{ message: "FAKE read error" }] } });
      data = { bmsCustomerOrderDetail: { id: "FAKE-order", orderAmount: 110, discountAmount: 10,
        shippingAmount: 0, vatAmount: 7.20, roundingAmount: 0, totalAmount: 110, lines: [
        { kind: "PRODUCT", label: "FAKE ขนม", sku: "FAKE-SNACK", size: "BASE", qty: 2, saleQty: 2, unitName: null, unitAmount: 30, lineAmount: 60 },
        { kind: "SERVICE", label: "FAKE ค่าเล่นบอร์ดเกม 60 นาที", sku: null, size: null, qty: 1, saleQty: 1, unitName: null, unitAmount: 60, lineAmount: 60 },
      ], points: [{ kind: "EARN", points: 110 }, { kind: "REVERSE", points: -10 }] } };
    } else if (query.includes("bmsCustomers(")) {
      customerReads++;
      data = { bmsCustomers: [{ id: "FAKE-customer", name: "FAKE Member", phone: null, note: null, tags: [],
        total_spent: 110, order_count: 1, created_at: "2026-10-05T12:00:00Z", addresses: [], identities: [], coupons: [],
        orders: [{ id: "FAKE-order", channel: "pos", status: "COMPLETED", total_amount: 110, created_at: "2026-10-05T12:00:00Z" }],
        membership: { memberNo: "FAKE-001", memberSince: "2026-10-01", enrollmentChannel: "POS", enrolledLocationId: null,
          enrolledLocationName: null, enrolledBranchCode: null, enrolledPosDeviceId: null, enrolledPosDeviceName: null,
          enrolledRegisteredPosNo: null, enrolledShiftId: null, enrolledByUserId: null, enrolledByName: null,
          pointsBalance: balance, pointsUsable: balance, tier: null },
      }] };
    } else if (query.includes("bmsCustomerLocations")) data = { bmsCustomerLocations: [] };
    json = { data };
  }
  return route.fulfill({ json });
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.clock.install();
  await page.goto(`${base}/admin/customers`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const member = page.locator('tr[data-row-key="FAKE-customer"]');
  await member.getByText("FAKE Member", { exact: true }).waitFor();
  assert.equal(detailReads, 0, "details load only when opened");
  balance = 110;
  const beforeFocus = customerReads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.querySelector('tr[data-row-key="FAKE-customer"]').textContent.includes("คงเหลือ 110"));
  assert.ok(customerReads > beforeFocus);
  await member.locator("button.ant-table-row-expand-icon").click();
  const order = page.locator('tr[data-row-key="FAKE-order"]');
  await order.getByRole("button", { name: /ดูบิล/ }).click();
  await page.getByText("FAKE ค่าเล่นบอร์ดเกม 60 นาที", { exact: true }).waitFor();
  await page.getByText("FAKE ขนม", { exact: true }).waitFor();
  await page.getByText("ได้รับ: +110", { exact: true }).waitFor();
  await page.getByText("ปรับคืนจากการคืน/ยกเลิก: -10", { exact: true }).waitFor();
  await page.getByRole("columnheader", { name: "ราคา/หน่วย", exact: true }).waitFor();
  await page.getByText("ยอดรวมพร้อมค่าจัดส่ง", { exact: true }).waitFor();
  await page.getByText("110.00 ฿", { exact: true }).first().waitFor();
  const desktopBounds = await page.getByRole("region", { name: "รายละเอียดรายการ", exact: true }).boundingBox();
  assert.ok(desktopBounds && desktopBounds.x >= 220 && desktopBounds.x + desktopBounds.width <= 1440, JSON.stringify(desktopBounds));
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  // Apollo polling uses browser timers; advance them without a real 15-second wait.
  const beforePoll = customerReads;
  await page.clock.runFor(16_000);
  assert.ok(customerReads > beforePoll, "visible customer query polls");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenReads = customerReads + detailReads;
  await page.clock.runFor(16_000);
  assert.equal(customerReads + detailReads, hiddenReads, "hidden page does not poll");
  detailFails = true;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByText("โหลดรายละเอียดบิลไม่สำเร็จ", { exact: true }).waitFor();
  detailFails = false;
  await page.getByRole("button", { name: /ลองใหม่/ }).click();
  await page.getByText("FAKE ค่าเล่นบอร์ดเกม 60 นาที", { exact: true }).waitFor();
  await order.locator("button.ant-table-row-expand-icon").click();
  const collapsedReads = detailReads;
  await page.clock.runFor(16_000);
  assert.equal(detailReads, collapsedReads, "collapsed bill stops polling");
  await order.locator("button.ant-table-row-expand-icon").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("FAKE ค่าเล่นบอร์ดเกม 60 นาที", { exact: true }).waitFor();
  const bounds = await page.getByRole("region", { name: "รายละเอียดรายการ", exact: true }).boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, JSON.stringify(bounds));
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, []);
  console.log("PASS details, saved service/product labels, ledger, focus refresh, visible polling, hidden/collapsed stop, retry, desktop/mobile; no mutations");
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw error;
} finally { await browser.close(); }
