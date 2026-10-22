import assert from "node:assert/strict";
import test from "node:test";
import { checkoutFixture } from "./testing/restaurantCheckoutHarness.mts";

test("pickup checkout needs contact only and does not read or disclose saved shipping addresses", async () => {
  const { service, calls } = checkoutFixture({ type: "PICKUP" });
  const result = await service.getCheckoutByToken("signed");
  assert.equal(result.checkout.delivery.complete, true);
  assert.deepEqual(result.checkout.delivery.missingFields, []);
  assert.deepEqual(result.checkout.delivery.addresses, []);
  assert.equal(result.checkout.delivery.selectedAddress, null);
  assert.equal(result.checkout.fulfillment.locationName, "FAKE Branch");
  assert.equal(calls.some(sql => sql.includes("bms_customer_addresses")), false);
});

test("pickup with complete contact can submit a slip without address, using server amount and scope", async () => {
  const { service, calls } = checkoutFixture({ type: "PICKUP" });
  const result = await service.submitCheckoutPaymentByToken("signed", { method: "BANK_TRANSFER", slipUrl: "/private/FAKE" });
  assert.equal(result.ok, true);
  assert.equal(result.result.status, "SUBMITTED");
  assert.equal(calls.filter(call => call === "payment:PENDING").length, 1);
});

test("pickup still requires every missing contact field before accepting payment", async () => {
  for (const field of ["recipientName", "phone"]) {
    const { service, calls } = checkoutFixture({ type: "PICKUP", missing: [field, "shippingAddress"] });
    const view = await service.getCheckoutByToken("signed");
    assert.deepEqual(view.checkout.delivery.missingFields, [field]);
    const result = await service.submitCheckoutPaymentByToken("signed", { method: "QR", slipUrl: "/private/FAKE" });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.reason, /ที่อยู่/);
    assert.equal(calls.includes("payment:PENDING"), false);
  }
});

test("delivery, legacy retail and unknown fulfillment still require shipping address", async () => {
  for (const type of ["DELIVERY", null, "pickup", "UNRECOGNIZED"]) {
    const { service, calls } = checkoutFixture({ type });
    const view = await service.getCheckoutByToken("signed");
    assert.equal(view.checkout.delivery.complete, false);
    assert.deepEqual(view.checkout.delivery.missingFields, ["shippingAddress"]);
    const result = await service.submitCheckoutPaymentByToken("signed", { method: "QR", slipUrl: "/private/FAKE", fulfillmentType: "PICKUP" });
    assert.equal(result.ok, false);
    assert.equal(calls.includes("payment:PENDING"), false);
  }
});

test("marketplace checkout still directs payment to its platform", async () => {
  const { service, calls } = checkoutFixture({ type: "PICKUP", channel: "foodpanda" });
  const result = await service.submitCheckoutPaymentByToken("signed", { method: "QR", slipUrl: "/private/FAKE" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Seller Center/);
  assert.equal(calls.includes("payment:PENDING"), false);
});

test("invalid tokens cannot reach database or payment services", async () => {
  const { service, calls } = checkoutFixture({ type: "PICKUP", invalidToken: true });
  assert.equal((await service.getCheckoutByToken("invalid")).ok, false);
  assert.deepEqual(calls, []);
});

test("pickup replies in Thai and English describe only verified branch/contact facts", async () => {
  for (const language of ["th", "en"]) {
    const { service } = checkoutFixture({ type: "PICKUP" });
    const reply = await service.orderCheckoutChatReply("tenant", "order", "fallback", language);
    assert.match(reply, /FAKE Branch/);
    assert.match(reply, /checkout\?t=/);
    assert.match(reply, language === "en" ? /no shipping address is needed/ : /ไม่ต้องกรอกที่อยู่จัดส่ง/);
    assert.doesNotMatch(reply, /FAKE private address|0000000000|อาหารพร้อมรับ|food is ready/);
  }
});

test("pickup replies ask for missing contact, while delivery retains its address request", async () => {
  const pickup = checkoutFixture({ type: "PICKUP", missing: ["phone", "shippingAddress"] });
  const reply = await pickup.service.orderCheckoutChatReply("tenant", "order", "fallback", "en");
  assert.match(reply, /Still needed: phone number\./);
  const delivery = checkoutFixture({ type: "DELIVERY" });
  assert.match(await delivery.service.orderCheckoutChatReply("tenant", "order", "fallback", "en"), /Still needed: shipping address\./);
});
