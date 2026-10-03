import assert from "node:assert/strict";
import test from "node:test";
import {
  taxRequestDeadline,
  taxRequestPolicy,
} from "../apps/web/lib/bms/taxRequestPolicy.ts";
import { readFileSync } from "node:fs";
import {
  taxRequestUrl,
  verifyTaxRequestToken,
  taxRequestConfiguration,
  taxRequestAccessHash,
  parseTaxRequestAccess,
} from "../apps/web/lib/bms/taxRequestToken.ts";
import {
  buildReceipt,
  type ReceiptPayload,
} from "../apps/web/lib/pos/escpos.ts";

const tenant = "11111111-1111-1111-1111-111111111111",
  order = "22222222-2222-2222-2222-222222222222";
test("Cloud receipt capability is opt-in, HTTPS-only, purpose-bound and tamper-resistant", () => {
  const keys = [
    "BMS_DEPLOYMENT_MODE",
    "BMS_TAX_REQUESTS_ENABLED",
    "BMS_PUBLIC_ORIGIN",
    "BMS_TAX_REQUEST_SECRET",
  ];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    Object.assign(process.env, {
      BMS_DEPLOYMENT_MODE: "cloud",
      BMS_TAX_REQUESTS_ENABLED: "true",
      BMS_PUBLIC_ORIGIN: "https://shop.example.test",
      BMS_TAX_REQUEST_SECRET: "FAKE-contract-test-secret",
    });
    const url = taxRequestUrl(tenant, order)!;
    assert.ok(url.startsWith("https://shop.example.test/tax-invoice/request#"));
    assert.equal(new URL(url).search, "");
    const token = new URL(url).hash.slice(1);
    assert.deepEqual(verifyTaxRequestToken(token), {
      tenantId: tenant,
      orderId: order,
    });
    assert.equal(
      taxRequestUrl(tenant, order),
      url,
      "reprints have the same request link"
    );
    assert.equal(verifyTaxRequestToken(token.replace(order, tenant)), null);
    assert.equal(verifyTaxRequestToken(token + ".extra"), null);
    process.env.BMS_TAX_REQUEST_SECRET = "rotated-secret";
    assert.equal(verifyTaxRequestToken(token), null);
    process.env.BMS_DEPLOYMENT_MODE = "retail-local";
    assert.equal(taxRequestUrl(tenant, order), null);
    assert.equal(verifyTaxRequestToken(token), null);
    process.env.BMS_DEPLOYMENT_MODE = "cloud";
    process.env.BMS_PUBLIC_ORIGIN = "http://shop.example.test";
    assert.equal(taxRequestConfiguration().enabled, false);
    process.env.BMS_PUBLIC_ORIGIN = "https://user:pass@shop.example.test";
    assert.equal(taxRequestConfiguration().enabled, false);
    process.env.BMS_PUBLIC_ORIGIN = "https://shop.example.test";
    process.env.BMS_TAX_REQUESTS_ENABLED = "false";
    assert.equal(taxRequestUrl(tenant, order), null);
  } finally {
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
});
test("tracking uses an independent 256-bit secret, stored only as a hash", () => {
  const secret = "ab".repeat(32),
    hash = taxRequestAccessHash(secret);
  assert.notEqual(hash, secret);
  assert.deepEqual(parseTaxRequestAccess(`${tenant}.${order}.${secret}`), {
    tenantId: tenant,
    id: order,
    accessHash: hash,
  });
  assert.throws(() => parseTaxRequestAccess(`${tenant}.${order}.short`));
  assert.throws(() =>
    parseTaxRequestAccess(`${tenant}.${order}.${secret}.extra`)
  );
});
test("ESC/POS stores the exact fragment URL, then prints a Model 2 QR; no QR when disabled", () => {
  const payload = {
    storeName: "FAKE",
    branchCode: "00000",
    taxId: null,
    posNo: null,
    vatIncluded: true,
    docTitle: "Receipt",
    docNo: null,
    at: "2026-10-03",
    cashier: null,
    lines: [],
    total: 107,
  } as ReceiptPayload;
  const url = `https://shop.example.test/tax-invoice/request#${tenant}.${order}.signature`;
  const bytes = Buffer.from(buildReceipt({ ...payload, taxRequestUrl: url }));
  const store = Buffer.from([29, 40, 107, url.length + 3, 0, 49, 80, 48]);
  const print = Buffer.from([29, 40, 107, 3, 0, 49, 81, 48]);
  assert.ok(bytes.includes(store));
  assert.ok(bytes.includes(Buffer.from(url)));
  assert.ok(bytes.indexOf(print) > bytes.indexOf(store));
  assert.equal(Buffer.from(buildReceipt(payload)).includes(print), false);
  assert.equal(
    Buffer.from(
      buildReceipt({ ...payload, taxRequestUrl: "javascript:bad" })
    ).includes(print),
    false
  );
});
test("7-day window is exactly 168 hours, exclusive at expiry, and counts successful submissions only", () => {
  const deadline = taxRequestDeadline("2026-10-04T14:00:00+07:00");
  assert.equal(deadline, "2026-10-11T07:00:00.000Z");
  assert.equal(
    taxRequestPolicy(deadline, 2, "PENDING", "2026-10-11T06:59:59.999Z")
      .canSubmit,
    true
  );
  assert.equal(
    taxRequestPolicy(deadline, 2, "PENDING", deadline).canSubmit,
    false
  );
  assert.equal(
    taxRequestPolicy(deadline, 0, "PENDING", "2026-10-12T00:00:00Z").expired,
    true
  );
  for (const status of ["ISSUED", "REJECTED"])
    assert.equal(
      taxRequestPolicy(deadline, 1, status, "2026-10-05T00:00:00Z").canSubmit,
      false
    );
  assert.equal(
    taxRequestPolicy(deadline, 3, "NEEDS_INFO", "2026-10-05T00:00:00Z")
      .remaining,
    0
  );
  assert.equal(
    taxRequestPolicy(deadline, 3, "NEEDS_INFO", "2026-10-05T00:00:00Z")
      .canSubmit,
    false
  );
});
test("public routes are bounded and never derive tenant/order from body; polling cannot change the form's reviewed version", () => {
  const route = readFileSync(
    new URL(
      "../apps/web/app/api/bms/tax-invoice-request/route.ts",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(route, /readRetailLocalJSON/);
  assert.match(route, /rateLimit\(/);
  assert.match(route, /no-store/);
  assert.doesNotMatch(route, /body\.(tenantId|orderId)/);
  const client = readFileSync(
    new URL(
      "../apps/web/app/tax-invoice/request/requestClient.tsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(client, /version:\s*formVersion/);
});
