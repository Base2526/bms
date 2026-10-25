import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createDynamicPromptPayQrPayload,
  inspectPromptPayQrPayload,
  promptPayQrCrc,
  promptPayRecipientId,
  validateReusablePromptPayQrPayload,
} from "../apps/web/lib/bms/promptPayQr";

const root = new URL("../", import.meta.url);

function staticPromptPayQr(recipient = "0000000000000") {
  const withoutCrc = `00020101021129370016A0000006770101110213${recipient}53037645802TH6304`;
  return `${withoutCrc}${promptPayQrCrc(withoutCrc)}`;
}

function amountFreeDynamicInitiationQr(recipient = "0000000000000") {
  const withoutCrc = `00020101021229370016A0000006770101110213${recipient}53037645802TH6304`;
  return `${withoutCrc}${promptPayQrCrc(withoutCrc)}`;
}

test("PromptPay QR uses the standard CRC-16/CCITT-FALSE check", () => {
  assert.equal(promptPayQrCrc("123456789"), "29B1");
});

test("a provider static QR becomes a per-tender dynamic QR with an exact amount", () => {
  const base = staticPromptPayQr();
  assert.deepEqual(validateReusablePromptPayQrPayload(base), {
    initiationMethod: "11",
    amount: null,
    recipientType: "NATIONAL_OR_TAX_ID",
    recipientId: "0000000000000",
  });

  const dynamic = createDynamicPromptPayQrPayload(base, 123.45);
  const details = inspectPromptPayQrPayload(dynamic);
  assert.equal(details.initiationMethod, "12");
  assert.equal(details.amount, 123.45);
  assert.equal(promptPayRecipientId(details), "0000000000000");
  assert.match(dynamic, /5406123\.45/);
  assert.notEqual(dynamic, createDynamicPromptPayQrPayload(base, 123.46));
});

test("an amount-free bank QR remains reusable when the provider marks initiation as dynamic", () => {
  const bankBase = amountFreeDynamicInitiationQr();
  assert.deepEqual(validateReusablePromptPayQrPayload(bankBase), {
    initiationMethod: "12",
    amount: null,
    recipientType: "NATIONAL_OR_TAX_ID",
    recipientId: "0000000000000",
  });

  const dynamic = createDynamicPromptPayQrPayload(bankBase, 88.5);
  const details = inspectPromptPayQrPayload(dynamic);
  assert.equal(details.initiationMethod, "12");
  assert.equal(details.amount, 88.5);
  assert.equal(details.recipientId, "0000000000000");
});

test("dynamic generation rejects corrupt, amount-bearing and invalid-value bases", () => {
  const base = staticPromptPayQr();
  assert.throws(() => createDynamicPromptPayQrPayload(`${base.slice(0, -1)}0`, 10), /INVALID_CRC/);
  const dynamic = createDynamicPromptPayQrPayload(base, 10);
  assert.throws(() => validateReusablePromptPayQrPayload(dynamic), /MUST_BE_AMOUNT_FREE/);
  assert.throws(() => createDynamicPromptPayQrPayload(base, 0), /INVALID_DYNAMIC_QR_AMOUNT/);
  assert.throws(() => createDynamicPromptPayQrPayload(base, Number.NaN), /INVALID_DYNAMIC_QR_AMOUNT/);
});

test("customer display creates the QR from the configured base and current QR tender amount", async () => {
  const view = await readFile(new URL("apps/web/components/pos/CustomerDisplayView.tsx", root), "utf8");
  const retail = await readFile(new URL("apps/web/app/(pos)/pos/page.tsx", root), "utf8");
  const restaurant = await readFile(new URL("apps/web/app/(pos)/pos/restaurant/page.tsx", root), "utf8");

  assert.match(view, /createDynamicPromptPayQrPayload\(basePayload, amount\)/);
  assert.doesNotMatch(view, /<DisplayQr payload=\{state\.paymentQr\.payload\}/,
    "the customer display must never render the amount-free base as the payment QR");
  for (const source of [retail, restaurant]) {
    assert.match(source, /filter\(\(payment\) => payment\.method === "QR"\)/,
      "each register must derive the displayed amount from QR tender rows");
    assert.match(source, /\{ \.\.\.configuredQr, amount: qrAmount \}/,
      "the exact QR tender amount must travel with the provider-issued base");
  }
});
