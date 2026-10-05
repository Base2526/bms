import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pointsEarnMessage } from "../apps/web/lib/pos/pointsEarnMessage.ts";

test("desktop zero-point messages cover every server reason and unknown/legacy responses", () => {
  const messages = ["PROGRAM_DISABLED", "BELOW_MIN_SPEND", "RATE_TOO_LOW", "NO_VISIT_POINTS"].map(pointsEarnMessage);
  assert.equal(new Set(messages).size, 4);
  for (const text of messages) assert.ok(text.length > 0);
  assert.ok(pointsEarnMessage(null));
  assert.equal(pointsEarnMessage("FUTURE_REASON"), pointsEarnMessage(undefined));
});

test("purchase detail is permission-gated, scoped to the authenticated tenant and validated", () => {
  const resolver = readFileSync(new URL("../apps/web/graphql/bmsCustomers.ts", import.meta.url), "utf8");
  const detail = resolver.slice(resolver.indexOf("async bmsCustomerOrderDetail"), resolver.indexOf("Mutation:"));
  assert.match(detail, /requirePermission\(ctx, "customer.view"\)/);
  assert.match(detail, /UUID_RE.test\(args.customerId\)/);
  assert.match(detail, /UUID_RE.test\(args.orderId\)/);
  assert.match(detail, /customerOrderDetail\(getTenantId\(ctx\), args.customerId, args.orderId\)/);
});
