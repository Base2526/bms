// Writes FAKE fixtures only. Use the guarded DB test runner with a disposable local schema clone.
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { query, getClient } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { upsertPosDevice } from "../apps/web/lib/bms/pos.ts";
import {
  getVatSettings,
  issueAbbreviatedInvoiceInTx,
} from "../apps/web/lib/bms/taxDocuments.ts";
import { taxRequestUrl } from "../apps/web/lib/bms/taxRequestToken.ts";
import {
  inspectTaxReceipt,
  submitTaxRequest,
  recoverTaxRequest,
  trackTaxRequest,
  reviseTaxRequest,
  listTaxRequests,
  reviewTaxRequest,
} from "../apps/web/lib/bms/taxInvoiceRequests.ts";

const envKeys = [
  "BMS_DEPLOYMENT_MODE",
  "BMS_TAX_REQUESTS_ENABLED",
  "BMS_PUBLIC_ORIGIN",
  "BMS_TAX_REQUEST_SECRET",
];
const old = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
Object.assign(process.env, {
  BMS_DEPLOYMENT_MODE: "cloud",
  BMS_TAX_REQUESTS_ENABLED: "true",
  BMS_PUBLIC_ORIGIN: "https://fake.example.test",
  BMS_TAX_REQUEST_SECRET: "FAKE-test-only",
});
const buyer = {
  name: "FAKE buyer",
  taxId: "0105555555554",
  branchCode: "00000",
  address: "FAKE address",
  phone: null,
};
let tenant = "",
  other = "",
  location = "",
  branch = "",
  user = "",
  device = "";
const ctx = () => ({
  scope: "admin",
  admin: { id: user, tenant_id: tenant, role: "Administrator" },
});
const secret = () => randomBytes(32).toString("hex");
async function bill(extra = 0) {
  const id = (
    await query(
      `INSERT INTO bms_orders(tenant_id,location_id,channel,customer_ref,status,total_amount,paid_at)
    VALUES($1,$2,'pos','FAKE-tax-request','COMPLETED',107,now()) RETURNING id`,
      [tenant, location]
    )
  ).rows[0].id;
  await query(
    `INSERT INTO bms_order_items(tenant_id,order_id,location_id,product_sku,size,qty,unit_price,line_amount,receipt_unit_price,vat_category)
    VALUES($1,$2,$3,'FAKE-tax-request','M',1,107,107,107,'V')`,
    [tenant, id, location]
  );
  if (extra) {
    await query(
      `INSERT INTO bms_order_extra_lines(tenant_id,order_id,label,qty,unit_amount,vat_category) VALUES($1,$2,'FAKE service',1,$3,'V')`,
      [tenant, id, extra]
    );
    await query(
      `UPDATE bms_orders SET total_amount=total_amount+$2 WHERE id=$1`,
      [id, extra]
    );
  }
  const c = await getClient();
  try {
    await beginTenantTx(c, tenant);
    const r = await issueAbbreviatedInvoiceInTx(c, {
      tenantId: tenant,
      orderId: id,
      locationId: location,
      deviceId: device,
      settings: await getVatSettings(tenant, c),
    });
    assert.equal(r.status, "ISSUED");
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  return { id, token: new URL(taxRequestUrl(tenant, id)!).hash.slice(1) };
}
async function claim(extra = 0) {
  const b = await bill(extra),
    key = secret();
  const r = await submitTaxRequest(b.token, buyer, key);
  return { ...b, key, access: r.access, requestId: r.access.split(".")[1] };
}
const approve = (id: string, version = 1) =>
  reviewTaxRequest(ctx(), { id, version, action: "ISSUE", confirmed: true });

test.before(async () => {
  tenant = (
    await query(
      `INSERT INTO bms_tenants(name,slug) VALUES('FAKE tax request',$1) RETURNING id`,
      [`fake-tax-request-${process.pid}`]
    )
  ).rows[0].id;
  other = (
    await query(
      `INSERT INTO bms_tenants(name,slug) VALUES('FAKE other',$1) RETURNING id`,
      [`fake-tax-other-${process.pid}`]
    )
  ).rows[0].id;
  user = (
    await query(
      `INSERT INTO users(name,username,email,role,tenant_id,password_hash,fake_test) VALUES('FAKE staff',$1,$1,'Administrator',$2,'x',TRUE) RETURNING id`,
      [`fake-tax-${process.pid}@example.invalid`, tenant]
    )
  ).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile(tenant_id,vat_registered,price_includes_vat,vat_rate,abbreviated_tax_invoice_approved,tax_id,address)
    VALUES($1,TRUE,TRUE,7,TRUE,'0105555555554','FAKE seller address')`,
    [tenant]
  );
  location = (
    await query(
      `INSERT INTO bms_locations(tenant_id,code,name,branch_code,is_head_office) VALUES($1,'MAIN','FAKE HQ','00000',TRUE) RETURNING id`,
      [tenant]
    )
  ).rows[0].id;
  branch = (
    await query(
      `INSERT INTO bms_locations(tenant_id,code,name,branch_code) VALUES($1,'BR1','FAKE branch','00001') RETURNING id`,
      [tenant]
    )
  ).rows[0].id;
  await query(
    `INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category) VALUES($1,'FAKE-tax-request','FAKE item',107,TRUE,'V')`,
    [tenant]
  );
  await query(
    `INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock) VALUES($1,$2,'FAKE-tax-request','M',100,0)`,
    [tenant, location]
  );
  device = (
    await upsertPosDevice(tenant, {
      locationId: location,
      code: "FAKE-POS",
      active: true,
    })
  ).id;
});
test("submit/recover are idempotent; receipt holders cannot retrieve someone else's buyer", async () => {
  const b = await bill(),
    key = secret();
  assert.deepEqual(Object.keys(await inspectTaxReceipt(b.token)).sort(), [
    "documentNo",
    "policy",
    "storeName",
    "total",
  ]);
  const [a, c] = await Promise.all([
    submitTaxRequest(b.token, buyer, key),
    submitTaxRequest(b.token, buyer, key),
  ]);
  assert.equal(a.access, c.access);
  assert.deepEqual(await recoverTaxRequest(b.token, key), a);
  assert.deepEqual(await recoverTaxRequest(b.token, secret()), {
    access: null,
  });
  await assert.rejects(submitTaxRequest(b.token, buyer, secret()));
  await assert.rejects(inspectTaxReceipt(b.token));
  await assert.rejects(trackTaxRequest(a.access.replace(tenant, other)));
  assert.equal((await trackTaxRequest(a.access)).buyer.name, buyer.name);
  assert.equal((await trackTaxRequest(a.access)).invoice, null);
});
test("concurrent different claimants produce one request", async () => {
  const b = await bill();
  const results = await Promise.allSettled([
    submitTaxRequest(b.token, buyer, secret()),
    submitTaxRequest(b.token, buyer, secret()),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("needs-info correction and explicit confirmation use the reviewed version; approval is atomic and preserves sale VAT", async () => {
  const r = await claim();
  await assert.rejects(
    reviewTaxRequest(ctx(), { id: r.requestId, version: 1, action: "ISSUE" })
  );
  await reviewTaxRequest(ctx(), {
    id: r.requestId,
    version: 1,
    action: "NEEDS_INFO",
    reason: "FAKE please check address",
    confirmed: true,
  });
  await assert.rejects(approve(r.requestId, 2));
  await assert.rejects(reviseTaxRequest(r.access, 1, buyer));
  await reviseTaxRequest(r.access, 2, { ...buyer, address: "FAKE corrected" });
  await assert.rejects(approve(r.requestId, 1));
  await query(`UPDATE bms_store_profile SET vat_rate=10 WHERE tenant_id=$1`, [
    tenant,
  ]);
  const issued = await approve(r.requestId, 3);
  await query(`UPDATE bms_store_profile SET vat_rate=7 WHERE tenant_id=$1`, [
    tenant,
  ]);
  assert.equal(issued.status, "ISSUED");
  assert.deepEqual(await approve(r.requestId, 3), issued);
  const tracked = await trackTaxRequest(r.access);
  assert.equal(tracked.invoice?.vatAmount, 7);
  assert.equal(tracked.invoice?.vatRate, 7);
  assert.equal(tracked.invoice?.grandTotal, 107);
  assert.equal(tracked.invoice?.buyer.address, "FAKE corrected");
  assert.ok(tracked.invoice?.replacesDocNo);
  await assert.rejects(reviseTaxRequest(r.access, 4, buyer));
  assert.equal(
    (
      await query(
        `SELECT count(*)::int n FROM bms_tax_documents WHERE tenant_id=$1 AND order_id=$2 AND doc_type='FULL'`,
        [tenant, r.id]
      )
    ).rows[0].n,
    1
  );
  await query(
    `UPDATE bms_tax_documents SET cancelled_at=now(),cancelled_reason='FAKE cancellation' WHERE tenant_id=$1 AND id=$2`,
    [tenant, issued.documentId]
  );
  const cancelled = await trackTaxRequest(r.access);
  assert.equal(cancelled.status, "DOCUMENT_CANCELLED");
  assert.equal(cancelled.invoice, null);
});
test("failed issuance leaves the request pending and original abbreviated document active", async () => {
  const r = await claim();
  await query(`UPDATE bms_store_profile SET tax_id=NULL WHERE tenant_id=$1`, [
    tenant,
  ]);
  await assert.rejects(approve(r.requestId));
  await query(
    `UPDATE bms_store_profile SET tax_id='0105555555554' WHERE tenant_id=$1`,
    [tenant]
  );
  assert.equal((await trackTaxRequest(r.access)).status, "PENDING");
  assert.equal(
    (
      await query(
        `SELECT count(*)::int n FROM bms_tax_documents WHERE tenant_id=$1 AND order_id=$2 AND cancelled_at IS NULL AND doc_type='ABBREVIATED'`,
        [tenant, r.id]
      )
    ).rows[0].n,
    1
  );
});
test("authorization, branch scope, RLS and tracking expiry fail closed", async () => {
  const r = await claim();
  await assert.rejects(
    reviewTaxRequest(
      { ...ctx(), __bmsPerms: new Set() },
      { id: r.requestId, version: 1, action: "ISSUE", confirmed: true }
    )
  );
  await assert.rejects(
    reviewTaxRequest(
      {
        scope: "admin",
        admin: { id: user, tenant_id: other, role: "Administrator" },
      },
      { id: r.requestId, version: 1, action: "ISSUE", confirmed: true }
    )
  );
  await query(
    `INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)`,
    [tenant, user, branch]
  );
  assert.equal((await listTaxRequests(ctx(), "PENDING")).rows.length, 0);
  await assert.rejects(approve(r.requestId));
  await query(
    `DELETE FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2`,
    [tenant, user]
  );
  const c = await getClient();
  try {
    await beginTenantTx(c, other);
    assert.equal(
      (
        await c.query(`SELECT id FROM bms_tax_invoice_requests WHERE id=$1`, [
          r.requestId,
        ])
      ).rowCount,
      0
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  const row = (
    await query(
      `SELECT access_hash FROM bms_tax_invoice_requests WHERE id=$1`,
      [r.requestId]
    )
  ).rows[0];
  assert.notEqual(row.access_hash, r.key);
  await query(
    `UPDATE bms_tax_invoice_requests SET access_expires_at=now()-interval '1 second' WHERE id=$1`,
    [r.requestId]
  );
  await assert.rejects(trackTaxRequest(r.access));
});
test("voided, non-completed, returned and aged receipts cannot be claimed; Retail Local cannot call any service", async () => {
  for (const kind of ["void", "pending", "returned", "aged"]) {
    const r = await bill();
    if (kind === "void")
      await query(`UPDATE bms_orders SET voided_at=now() WHERE id=$1`, [r.id]);
    if (kind === "pending")
      await query(`UPDATE bms_orders SET status='PENDING' WHERE id=$1`, [r.id]);
    if (kind === "aged")
      await query(
        `UPDATE bms_tax_documents SET issued_at=now()-interval '91 days' WHERE order_id=$1 AND tenant_id=$2`,
        [r.id, tenant]
      );
    if (kind === "returned")
      await query(
        `INSERT INTO bms_pos_returns(tenant_id,order_id,returned_by,return_mode,refund_amount,settlement_status,idempotency_key,is_void) VALUES($1,$2,$3,'PARTIAL',1,'COMPLETED',$4,FALSE)`,
        [tenant, r.id, user, secret()]
      );
    await assert.rejects(submitTaxRequest(r.token, buyer, secret()));
  }
  const r = await claim();
  process.env.BMS_DEPLOYMENT_MODE = "retail-local";
  try {
    assert.equal((await listTaxRequests(ctx(), "PENDING")).enabled, false);
    await assert.rejects(trackTaxRequest(r.access));
    await assert.rejects(approve(r.requestId));
    await assert.rejects(submitTaxRequest(r.token, buyer, r.key));
  } finally {
    process.env.BMS_DEPLOYMENT_MODE = "cloud";
  }
});
test("concurrent approval and customer correction cannot issue unreviewed buyer details", async () => {
  const r = await claim();
  const results = await Promise.allSettled([
    approve(r.requestId),
    reviseTaxRequest(r.access, 1, {
      ...buyer,
      name: "FAKE changed in another tab",
    }),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  const tracked = await trackTaxRequest(r.access);
  if (tracked.status === "ISSUED") {
    assert.equal(tracked.invoice?.buyer.name, buyer.name);
  } else {
    assert.equal(tracked.status, "PENDING");
    assert.equal(tracked.version, 2);
    assert.equal(tracked.invoice, null);
    await assert.rejects(approve(r.requestId, 1));
  }
});

test("rejected requests stay private and cannot be overwritten or reissued", async () => {
  const r = await claim();
  await reviewTaxRequest(ctx(), {
    id: r.requestId,
    version: 1,
    action: "REJECT",
    reason: "FAKE disputed receipt",
    confirmed: true,
  });
  assert.equal((await trackTaxRequest(r.access)).status, "REJECTED");
  await assert.rejects(reviseTaxRequest(r.access, 2, buyer));
  await assert.rejects(approve(r.requestId, 2));
  await assert.rejects(submitTaxRequest(r.token, buyer, secret()));
});

test("online full-invoice copy includes non-inventory service charges", async () => {
  const r = await claim(10.7);
  await approve(r.requestId);
  const invoice = (await trackTaxRequest(r.access)).invoice!;
  assert.equal(
    invoice.lines.find((line) => line.name === "FAKE service")?.amount,
    10.7
  );
  assert.equal(invoice.subtotal, 117.7);
  assert.equal(invoice.grandTotal, 117.7);
  assert.equal(invoice.vatAmount, 7.7);
});

test("three successful submissions per receipt; retries, views, invalid input and staff actions do not spend extra quota", async () => {
  const r = await claim();
  assert.equal((await trackTaxRequest(r.access)).policy.remaining, 2);
  await assert.rejects(
    reviseTaxRequest(r.access, 1, { ...buyer, taxId: "invalid" })
  );
  await reviewTaxRequest(ctx(), {
    id: r.requestId,
    version: 1,
    action: "NEEDS_INFO",
    reason: "FAKE check",
    confirmed: true,
  });
  const second = { ...buyer, address: "FAKE second" },
    third = { ...buyer, address: "FAKE third" };
  await Promise.all([
    reviseTaxRequest(r.access, 2, second),
    reviseTaxRequest(r.access, 2, second),
  ]);
  assert.equal((await trackTaxRequest(r.access)).policy.submissions, 2);
  await assert.rejects(reviseTaxRequest(r.access, 2, third)); // Same operation, different content.
  await reviseTaxRequest(r.access, 3, third);
  const state = await trackTaxRequest(r.access);
  assert.equal(state.policy.submissions, 3);
  assert.equal(state.policy.remaining, 0);
  assert.equal(state.policy.canSubmit, false);
  await assert.rejects(
    reviseTaxRequest(r.access, 4, { ...buyer, name: "FAKE fourth" }),
    /ครบ 3 ครั้ง/
  );
  await assert.rejects(submitTaxRequest(r.token, buyer, secret()));
  await reviseTaxRequest(r.access, 3, third); // Lost success response at the last available attempt.
  assert.equal(
    (await submitTaxRequest(r.token, buyer, r.key)).access,
    r.access
  ); // Initial replay after corrections.
  const history = await query(
    `SELECT submission_no,buyer FROM bms_tax_request_submissions WHERE tenant_id=$1 AND request_id=$2 ORDER BY submission_no`,
    [tenant, r.requestId]
  );
  assert.deepEqual(
    history.rows.map((x) => x.submission_no),
    [1, 2, 3]
  );
  assert.deepEqual(
    history.rows.map((x) => x.buyer.address),
    [buyer.address, second.address, third.address]
  );
  await approve(r.requestId, 4); // Issuance does not consume a fourth submission.
  await reviseTaxRequest(r.access, 3, third); // A committed replay after approval must not mutate the document.
  assert.equal(
    (await trackTaxRequest(r.access)).invoice?.buyer.address,
    third.address
  );
});

test("different simultaneous last-attempt corrections cannot exceed three submissions", async () => {
  const r = await claim();
  await reviseTaxRequest(r.access, 1, { ...buyer, address: "FAKE second" });
  const results = await Promise.allSettled([
    reviseTaxRequest(r.access, 2, { ...buyer, address: "FAKE A" }),
    reviseTaxRequest(r.access, 2, { ...buyer, address: "FAKE B" }),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await trackTaxRequest(r.access)).policy.submissions, 3);
});

test("7-day submission expiry blocks new claims and edits but permits timely approval, tracking and replay", async () => {
  const b = await bill();
  await query(
    `UPDATE bms_tax_documents SET issued_at=clock_timestamp()-interval '168 hours' WHERE tenant_id=$1 AND order_id=$2`,
    [tenant, b.id]
  );
  await assert.rejects(submitTaxRequest(b.token, buyer, secret()), /7 วัน/);
  const r = await claim(),
    second = { ...buyer, address: "FAKE within deadline" };
  await reviseTaxRequest(r.access, 1, second);
  await query(
    `UPDATE bms_tax_invoice_requests SET request_deadline=clock_timestamp() WHERE tenant_id=$1 AND id=$2`,
    [tenant, r.requestId]
  );
  assert.equal((await trackTaxRequest(r.access)).policy.expired, true);
  await assert.rejects(
    reviseTaxRequest(r.access, 2, { ...buyer, address: "FAKE too late" }),
    /7 วัน/
  );
  await reviseTaxRequest(r.access, 1, second);
  assert.equal((await trackTaxRequest(r.access)).policy.submissions, 2);
  await approve(r.requestId, 2);
  assert.equal(
    (await trackTaxRequest(r.access)).invoice?.buyer.address,
    second.address
  );
});

test("submission history is tenant-scoped and append-only to the application role", async () => {
  const r = await claim();
  const c = await getClient();
  try {
    await beginTenantTx(c, other);
    assert.equal(
      (
        await c.query(
          `SELECT * FROM bms_tax_request_submissions WHERE request_id=$1`,
          [r.requestId]
        )
      ).rowCount,
      0
    );
    await c.query("ROLLBACK");
    await beginTenantTx(c, tenant);
    await assert.rejects(
      c.query(
        `UPDATE bms_tax_request_submissions SET buyer='{}' WHERE request_id=$1`,
        [r.requestId]
      ),
      /permission denied/
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
});

test.after(async () => {
  for (const k of envKeys) {
    if (old[k] === undefined) delete process.env[k];
    else process.env[k] = old[k];
  }
  if (tenant) {
    for (const table of [
      "bms_tax_invoice_requests",
      "bms_etax_submissions",
      "bms_user_allowed_locations",
      "bms_pos_returns",
      "bms_tax_documents",
      "bms_document_counters",
      "bms_order_items",
      "bms_orders",
      "bms_pos_devices",
      "bms_inventory",
      "bms_products",
      "bms_locations",
      "bms_store_profile",
    ])
      await query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
    await query(`DELETE FROM users WHERE id=$1`, [user]);
    await query(`DELETE FROM bms_tenants WHERE id=ANY($1::uuid[])`, [
      [tenant, other],
    ]);
  }
});
