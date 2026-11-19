// Synthetic local browser smoke. Every API call is intercepted; no customer messages or writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const { parse } = require("graphql");
const origin = process.env.BMS_ADMIN_SMOKE_ORIGIN || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
const orderId = "11111111-1111-4111-8111-111111111111";
const permissions = ["order.view", "order.ship", "order.pay", "order.cancel", "order.return", "payment.view", "payment.submit", "payment.confirm"];
const fakeOrder = {
  id: orderId, channel: "web", customer_ref: "FAKE", status: "PENDING", total_amount: 100,
  discount_amount: 0, discountLines: [], shipping_fee: 0, amount_due: 100, deposit_paid: 0,
  deposit_balance_due: 100, deposit_status: null, coupon_code: null, fulfillmentType: "PICKUP",
  promisedAt: null, pendingRefundCount: 0, pendingRefundAmount: 0, pendingRefundSince: null,
  locationId: null, locationName: null, branchCode: null, posDeviceName: null,
  registeredPosNo: null, posShiftId: null, created_at: "2026-11-15T04:00:00Z",
  updated_at: "2026-11-15T04:00:00Z", items: [], hasShippingAddress: false,
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-order-smoke", url: origin },
      { name: "lang", value: "th", url: origin }]);
    await context.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      let body = {};
      if (pathname === "/api/auth/me") {
        body = { isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE staff" } };
      } else if (pathname === "/api/graphql") {
        const request = route.request().postDataJSON();
        const data = {};
        for (const definition of parse(request.query).definitions) {
          if (definition.kind !== "OperationDefinition") continue;
          assert.equal(definition.operation, "query", "browser smoke never performs a business mutation");
          for (const field of definition.selectionSet.selections) {
            if (field.kind !== "Field") continue;
            const name = field.name.value;
            data[field.alias?.value || name] = name === "myBmsPermissions" ? permissions
              : name === "bmsOrders" ? [fakeOrder]
              : name === "bmsPayments" || name === "bmsOrderLocations" ? [] : null;
          }
        }
        body = { data };
      } else if (pathname.endsWith("/realtime/ticket")) {
        return route.fulfill({ status: 503, json: { error: "FAKE realtime unavailable" } });
      }
      await route.fulfill({ json: body });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/admin/orders`);
    const paymentLink = page.locator(`a[href="/admin/payment?orderId=${orderId}"]`).first();
    await paymentLink.waitFor({ timeout: 30000 });
    await paymentLink.click();
    await page.waitForURL(`**/admin/payment?orderId=${orderId}`);
    const search = page.getByPlaceholder("ค้นหา payment / order / slip ref");
    await search.waitFor();
    assert.equal(await search.inputValue(), orderId);
    await page.getByRole("button", { name: "บันทึกการชำระ" }).click();
    await page.getByRole("dialog").getByText("บันทึกการชำระเงิน").waitFor();
    assert.deepEqual(errors, [], `width ${width} client errors`);
    await context.close();
  }
  console.log("order → payment link and pending-payment form render at desktop and mobile widths");
} finally {
  await browser.close();
}
