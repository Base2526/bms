import assert from "node:assert/strict";
import test from "node:test";

import {
  createCheckoutToken,
  verifyCheckoutToken,
} from "../../apps/web/lib/bms/checkoutToken.ts";

const tenantId = "11111111-1111-1111-1111-111111111111";
const orderId = "22222222-2222-2222-2222-222222222222";

test("checkout token round-trips tenant and order scope", () => {
  const token = createCheckoutToken({ tenantId, orderId });
  const payload = verifyCheckoutToken(token);
  assert.equal(payload?.v, 1);
  assert.equal(payload?.tenantId, tenantId);
  assert.equal(payload?.orderId, orderId);
});

test("checkout token rejects a modified payload or signature", () => {
  const token = createCheckoutToken({ tenantId, orderId });
  const [payload, signature] = token.split(".");
  assert.equal(verifyCheckoutToken(`${payload}x.${signature}`), null);
  assert.equal(verifyCheckoutToken(`${payload}.${signature}x`), null);
});

test("checkout token expires", () => {
  const realNow = Date.now;
  try {
    const startedAt = realNow();
    Date.now = () => startedAt;
    const token = createCheckoutToken({
      tenantId,
      orderId,
      expiresInSeconds: 60,
    });
    Date.now = () => startedAt + 61_000;
    assert.equal(verifyCheckoutToken(token), null);
  } finally {
    Date.now = realNow;
  }
});

