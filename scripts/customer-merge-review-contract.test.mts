import assert from "node:assert/strict";
import test from "node:test";
import { signCustomerToken } from "../apps/web/lib/bms/customerSecurityToken.ts";

test("customer merge review boundaries and transactional audit", async (t) => {
  const calls: { sql: string; params: any[] }[] = [];
  const rows = ["keep", "merge"].map(id => ({ id, name: "FAKE Person", phone: "0000001234", email: "fake@example.invalid",
    member_no: null, updated_at: "2026-01-01", channels: ["line"], identity_bindings: [`["${id}","line","FAKE-private-ref"]`], orders: 2, addresses: 1, conversations: 1,
    pharmacy_cases: 1, points: "10", coupons: 1, store_credit: "20.00", open_deposits: 1, deposit_paid: "15.00",
    passes: 0, renewals: 0, restaurant_requests: 0, game_requests: 0, tags: [], followup_opt_out: false }));
  let failAudit = false;
  const globalDb = globalThis as any;
  const oldPool = globalDb.__bmsPostgresPool;
  globalDb.__bmsPostgresPool = { connect: async () => ({ release() {}, query: async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("INSERT INTO bms_audit_log") && failAudit) throw new Error("audit unavailable");
    const found = sql.includes("SELECT c.id, c.name") || sql.includes("SELECT id, name, phone, email") ? rows
      : sql.includes("COUNT(*)::int AS count FROM bms_board_game_waitlist") ? [{ count: 0 }] : [];
    return { rows: found, rowCount: found.length };
  } }) };
  try {
    const { previewCustomerMerge, customerMergeDigest, assertCustomerMergePreview, validateCustomerMergeReview } =
      await import("../apps/web/lib/bms/customerMergeReview.ts");
    const { mergeCustomers } = await import("../apps/web/lib/bms/customers.ts");
    const preview = await previewCustomerMerge("tenant-a", "keep", "merge", "staff-a");
    const confirmation = { actorId: "staff-a", review: { previewToken: preview.previewToken,
      reason: "DUPLICATE_CHANNELS" as const, verificationMethod: "BOTH_CHANNELS" as const,
      evidenceReference: "CASE-FAKE-001", confirmed: true } };
    const snapshot = { keep: rows[0], source: rows[1] };
    await t.test("GraphQL denies preview and execution without customer.edit before service reads", async () => {
      const { bmsCustomersResolvers } = await import("../apps/web/graphql/bmsCustomers.ts");
      const ctx = { admin: { id: "staff-a", tenant_id: "tenant-a" }, __bmsPerms: new Set(["customer.view"]) };
      calls.length = 0;
      await assert.rejects(bmsCustomersResolvers.Query.bmsCustomerMergePreview(null, { keepId: "keep", mergeId: "merge" }, ctx),
        (error: any) => error.extensions?.code === "FORBIDDEN");
      await assert.rejects(bmsCustomersResolvers.Mutation.bmsMergeCustomers(null,
        { keepId: "keep", mergeId: "merge", review: confirmation.review }, ctx),
        (error: any) => error.extensions?.code === "FORBIDDEN");
      assert.equal(calls.length, 0);
      // Restore a preview read for the following SQL-scope assertion.
      await previewCustomerMerge("tenant-a", "keep", "merge", "staff-a");
    });
    await t.test("preview hides clinical/contact content and token contains only binding metadata", () => {
      assert.equal(preview.keep.phoneHint, "…1234");
      assert.doesNotMatch(JSON.stringify(preview), /0000001234|fake@example/);
      assert.doesNotMatch(JSON.stringify(preview), /FAKE-private-ref|identity_bindings/);
      const payload = Buffer.from(preview.previewToken.split(".")[1], "base64url").toString();
      assert.doesNotMatch(payload, /FAKE Person|1234|fake@example/);
      assert.match(payload, /staff-a/);
      assert.match(calls.find(c => c.sql.includes("SELECT c.id, c.name"))!.sql, /c.tenant_id = \$1/);
    });
    await t.test("missing confirmation, method or evidence cannot write", async () => {
      calls.length = 0;
      await assert.rejects(mergeCustomers("tenant-a", "keep", "merge"), /required/);
      for (const review of [{ ...confirmation.review, confirmed: false }, { ...confirmation.review, evidenceReference: "" },
        { ...confirmation.review, verificationMethod: "NAME_MATCH" }]) {
        assert.throws(() => validateCustomerMergeReview({ actorId: "staff-a", review } as any), /required/);
      }
      assert.equal(calls.length, 0);
    });
    await t.test("preview cannot cross tenant, actor, pair, direction, expiry or changed balances", () => {
      assertCustomerMergePreview("tenant-a", "keep", "merge", confirmation, snapshot);
      for (const [tenant, keep, merge, actor] of [["other", "keep", "merge", "staff-a"], ["tenant-a", "merge", "keep", "staff-a"],
        ["tenant-a", "keep", "stranger", "staff-a"], ["tenant-a", "keep", "merge", "staff-b"]]) {
        assert.throws(() => assertCustomerMergePreview(tenant, keep, merge, { ...confirmation, actorId: actor }, snapshot), /Refresh/);
      }
      assert.throws(() => assertCustomerMergePreview("tenant-a", "keep", "merge", confirmation,
        { ...snapshot, source: { ...snapshot.source, points: "900" } }), /Refresh/);
      assert.throws(() => assertCustomerMergePreview("tenant-a", "keep", "merge", confirmation,
        { ...snapshot, source: { ...snapshot.source, identity_bindings: ['["merge","line","FAKE-other-account"]'] } }), /Refresh/);
      const expired = signCustomerToken("customer-merge-v1", { tenantId: "tenant-a", keepId: "keep", mergeId: "merge",
        actorId: "staff-a", digest: customerMergeDigest(snapshot), exp: 1 });
      assert.throws(() => assertCustomerMergePreview("tenant-a", "keep", "merge",
        { ...confirmation, review: { ...confirmation.review, previewToken: expired } }, snapshot), /Refresh/);
    });
    await t.test("success records evidence and impact before commit with revision actor", async () => {
      calls.length = 0;
      assert.equal(await mergeCustomers("tenant-a", "keep", "merge", confirmation), true);
      const audit = calls.find(c => c.sql.includes("INSERT INTO bms_audit_log"))!;
      assert.deepEqual(audit.params.slice(0, 3), ["tenant-a", "staff-a", "keep"]);
      const meta = JSON.parse(audit.params[3]);
      assert.equal(meta.evidenceReference, "CASE-FAKE-001");
      assert.equal(meta.impact.source.store_credit, "20.00");
      assert.doesNotMatch(audit.params[3], /FAKE Person|fake@example|0000001234|customer-merge-v1|FAKE-private-ref|identity_bindings/);
      assert.equal(calls.at(-1)?.sql, "COMMIT");
      assert.ok(calls.some(c => c.sql.includes("app.editor_id") && c.params[0] === "staff-a"));
      assert.equal(calls[1].sql, "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    });
    await t.test("audit failure rolls back the merge", async () => {
      calls.length = 0; failAudit = true;
      await assert.rejects(mergeCustomers("tenant-a", "keep", "merge", confirmation), /audit unavailable/);
      assert.equal(calls.at(-1)?.sql, "ROLLBACK");
      assert.ok(!calls.some(c => c.sql === "COMMIT"));
    });
    await t.test("stale preview fails before moving any data", async () => {
      calls.length = 0; failAudit = false; rows[1].points = "11";
      await assert.rejects(mergeCustomers("tenant-a", "keep", "merge", confirmation), /Refresh/);
      assert.ok(!calls.some(c => /^(UPDATE|DELETE|INSERT)/.test(c.sql.trim())));
    });
  } finally { globalDb.__bmsPostgresPool = oldPool; }
});
