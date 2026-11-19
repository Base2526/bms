import assert from "node:assert/strict";
import test from "node:test";
import { createUiTranslator } from "../apps/web/i18n/uiText.ts";
import { operatorMessage } from "../apps/web/lib/operatorMessage.ts";

test("operator messages turn business codes into actionable Thai and English", () => {
  const th = createUiTranslator("th");
  const en = createUiTranslator("en");
  for (const code of [
    "COST_ALLOCATION_PREVIEW_STALE",
    "VALUATION_CURRENCY_REVIEW_REQUIRED",
    "ACTUAL_INVENTORY_COST_UNKNOWN",
    "RETURN_COST_REVERSAL_UNVERIFIED",
    "PRICE_PUBLISH_EXCLUSIVE_CHECKOUT_UNSUPPORTED",
    "PRICE_PUBLISH_INVALID_PACK",
    "COST_ALL_BRANCH_ACCESS_REQUIRED",
    "COST_REVIEW_CONFLICT",
  ]) {
    const thai = operatorMessage(code, th);
    const english = operatorMessage(code, en);
    assert.match(thai, /[ก-๙]/);
    assert.doesNotMatch(thai, new RegExp(code));
    assert.match(english, /[a-z]/i);
    assert.doesNotMatch(english, /[ก-๙]/);
    assert.doesNotMatch(english, new RegExp(code));
  }
});

test("GraphQL business code takes precedence over a generic extension", () => {
  const th = createUiTranslator("th");
  const error = Object.assign(new Error("COST_ALLOCATION_ALL_BRANCH_ACCESS_REQUIRED"), {
    graphQLErrors: [{ extensions: { code: "INTERNAL_SERVER_ERROR" } }],
  });
  assert.match(operatorMessage(error, th), /ทุกสาขา/);
});

test("uncertain writes tell operators to check before retrying", () => {
  const th = createUiTranslator("th");
  assert.match(operatorMessage(new Error("SERVER_ERROR"), th, "write"), /ตรวจรายการล่าสุดก่อนกดซ้ำ/);
  assert.match(operatorMessage(new Error("SERVER_ERROR"), th, "read"), /รีเฟรช/);
  assert.match(operatorMessage(new Error("NetworkError when attempting to fetch resource."), th, "write"), /ตรวจรายการล่าสุดก่อนกดซ้ำ/);
  assert.match(operatorMessage(new Error("Response not successful: Received status code 502"), th, "read"), /รีเฟรช/);
  assert.match(operatorMessage(new Error("Response not successful: Received status code 502"), th, "write"), /ตรวจรายการล่าสุดก่อนกดซ้ำ/);
  assert.match(operatorMessage("FUTURE_BUSINESS_CODE", th), /FUTURE_BUSINESS_CODE/);
});
