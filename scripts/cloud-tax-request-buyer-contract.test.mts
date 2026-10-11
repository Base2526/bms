import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTaxRequestBuyer } from "../apps/web/lib/bms/taxInvoiceRequests.ts";

const legacy = { name: "FAKE buyer", taxId: "0105555555554", branchCode: "00000", address: "FAKE address", phone: null };
const structured = { ...legacy, buyerType: "INDIVIDUAL", addressLine1: " FAKE line 1 ", addressLine2: "FAKE line 2", province: "กรุงเทพมหานคร", postcode: "10140", email: "fake@example.test" };

test("legacy requests retain exactly their original shape", () => {
  assert.deepEqual(normalizeTaxRequestBuyer(legacy), legacy);
});
test("structured request retains contact fields and composes invoice address on the server", () => {
  const buyer = normalizeTaxRequestBuyer({ ...structured, address: "UNTRUSTED combined address", branchCode: "12345" });
  assert.equal(buyer.address, "FAKE line 1\nFAKE line 2\nกรุงเทพมหานคร\n10140");
  assert.equal(buyer.branchCode, "00000");
  assert.equal(buyer.email, "fake@example.test");
  assert.equal(buyer.buyerType, "INDIVIDUAL");
  assert.deepEqual(normalizeTaxRequestBuyer(buyer), buyer, "tracking/correction round trip is stable");
});
test("company branch survives while optional fields may be omitted", () => {
  const buyer = normalizeTaxRequestBuyer({ ...structured, buyerType: "COMPANY", branchCode: "00001", addressLine2: undefined, postcode: undefined, email: undefined });
  assert.equal(buyer.branchCode, "00001");
  assert.equal(buyer.address, "FAKE line 1\nกรุงเทพมหานคร");
  assert.equal(buyer.email, "");
});
test("invalid fields and foreign passport identifiers never bypass issuance validation", () => {
  for (const patch of [
    { buyerType: "OTHER" }, { buyerType: "" }, { province: "FAKE province" },
    { addressLine1: " " }, { postcode: "12x45" }, { email: "invalid" },
    { email: "fake@example.test\r\nBcc: other@example.test" },
    { email: "x".repeat(255) }, { taxId: "0105555555555" },
    { buyerType: "COMPANY", branchCode: "xyz" },
    { buyerType: "FOREIGNER", taxId: "FAKE-PASSPORT" },
  ]) assert.throws(() => normalizeTaxRequestBuyer({ ...structured, ...patch }));
  assert.equal(normalizeTaxRequestBuyer({ ...structured, buyerType: "FOREIGNER" }).buyerType, "FOREIGNER");
});
