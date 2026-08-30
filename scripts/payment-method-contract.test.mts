import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const paymentsSource = await readFile(new URL("../apps/web/lib/bms/payments.ts", import.meta.url), "utf8");
const typeDefs = await readFile(new URL("../apps/web/graphql/typeDefs.ts", import.meta.url), "utf8");
const paymentPage = await readFile(
  new URL("../apps/web/app/(admin)/admin/payment/page.tsx", import.meta.url),
  "utf8"
);

function constArrayValues(source: string, constName: string): string[] {
  const match = source.match(new RegExp(`const ${constName}(?::[^=]+)? = \\[([^\\]]*?)\\](?: as const)?`));
  assert.ok(match, `missing const ${constName}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function enumValues(source: string, enumName: string): string[] {
  const match = source.match(new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\}`));
  assert.ok(match, `missing enum ${enumName}`);
  return match[1]
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));
}

test("GraphQL payment enum accepts every persisted payment method", () => {
  const paymentMethods = constArrayValues(paymentsSource, "PAYMENT_METHODS");
  assert.deepEqual(enumValues(typeDefs, "BmsPaymentMethod").sort(), paymentMethods.sort());
});

test("admin payment page can display POS and AR payment methods without enabling credit sale submission", () => {
  const paymentMethods = constArrayValues(paymentsSource, "PAYMENT_METHODS");
  for (const method of paymentMethods) {
    assert.match(paymentPage, new RegExp(`\\b${method}\\b`), `missing payment page handling for ${method}`);
  }
  const submitMethods = constArrayValues(paymentPage, "SUBMIT_METHODS");
  assert.deepEqual(submitMethods, paymentMethods.filter((method) => method !== "CREDIT"));
  assert.match(paymentPage, /CREDIT: t\("admin_payment\.method_credit"\)/);
});
