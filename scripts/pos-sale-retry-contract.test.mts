import assert from "node:assert/strict";
import test from "node:test";
import { PosConnectionError, posErrorConnectionStatus } from "../packages/pos-client-core/src/operation.ts";
import { mustRetainSaleAttempt, PosSaleResultError } from "../packages/pos-client-core/src/saleRetry.ts";

test("pending or incomplete sale results retain identity; terminal refusals release a fresh attempt", () => {
  for (const result of [null, {}, { status: "PAYMENT_FAILED" }, { status: "SERVER_ERROR" }, { status: "SOLD" }, { status: "DEPOSIT_TAKEN" }]) {
    assert.equal(mustRetainSaleAttempt(result), true);
  }
  for (const status of ["SOLD", "DEPOSIT_TAKEN", "PAYMENT_MISMATCH", "SHIFT_NOT_OPEN", "SERIAL_ALREADY_SOLD", "PHARMACY_REVIEW_REQUIRED", "COUPON_INVALID", "POINTS_INVALID"]) {
    assert.equal(mustRetainSaleAttempt({ status, orderId: "fixture" }), false);
  }
});

test("connection classification uses transport evidence, never business wording or payment certainty", () => {
  for (const error of [new PosConnectionError("timeout"), { networkError: new TypeError("fetch") }, { httpStatus: 408 }, { httpStatus: 503 }]) {
    assert.equal(posErrorConnectionStatus(error), "offline");
  }
  for (const error of [
    new PosSaleResultError("VAT category missing", { status: "PAYMENT_FAILED" }),
    new PosSaleResultError("missing result", null),
    { code: "FORBIDDEN", httpStatus: 403 },
    { graphQLErrors: [{ extensions: { code: "INTERNAL_SERVER_ERROR" } }] },
    { networkError: { statusCode: 403 } },
  ]) assert.equal(posErrorConnectionStatus(error), "online");
  for (const error of [null, new Error("local validation"), new Error("Keychain failed")]) {
    assert.equal(posErrorConnectionStatus(error), null);
  }
});
