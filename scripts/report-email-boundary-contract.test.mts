import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function harness(options: { owned?: boolean; deleted?: boolean; sendError?: boolean } = {}) {
  const calls = { queries: [] as unknown[][], reads: [] as string[], sends: [] as any[], audits: [] as any[] };
  const report = loadWithStubs("apps/web/lib/bms/reportEmail.ts", {
    "@/lib/db": { query: async (...args: unknown[]) => {
      calls.queries.push(args);
      return { rows: [{ report_type: "SALES", format: "XLSX", filename: "server.xlsx",
        original_name: "sales/november.xlsx", mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        relpath: "tenant-a/private/report.xlsx", deleted_at: options.deleted ? new Date() : null }] };
    } },
    "./audit": { audit: async (...args: any[]) => { calls.audits.push(args); } },
    "@/lib/mailer": { sendEmail: async (...args: any[]) => {
      calls.sends.push(args);
      if (options.sendError) throw new Error("FAKE provider failure");
    } },
    "@/lib/storage": { readStoredFile: async (path: string) => {
      calls.reads.push(path);
      return Buffer.from("FAKE report bytes");
    } },
    "./storeProfile": { getStoreProfile: async () => ({ contactEmail: "owner@example.com" }) },
    "./platform": { getTenantName: async () => "<Fake Shop>" },
    "./reportEngine": { findGeneratedReportByFileId: async () => options.owned === false ? null : { fileId: 42 } },
  });
  return { report, calls };
}

test("report email rejects malformed recipient and foreign/deleted report before file access or send", async () => {
  const invalid = harness();
  await assert.rejects(invalid.report.emailGeneratedReport("tenant-a", {}, { fileId: 42, to: "bad address" }), /อีเมล/);
  assert.equal(invalid.calls.queries.length, 0);

  const foreign = harness({ owned: false });
  await assert.rejects(foreign.report.emailGeneratedReport("tenant-a", {}, { fileId: 42, to: "owner@example.com" }), /ไม่พบรายงาน/);
  assert.equal(foreign.calls.queries.length, 0);
  assert.equal(foreign.calls.sends.length, 0);

  const deleted = harness({ deleted: true });
  await assert.rejects(deleted.report.emailGeneratedReport("tenant-a", {}, { fileId: 42, to: "owner@example.com" }), /ถูกลบ/);
  assert.equal(deleted.calls.reads.length, 0);
  assert.equal(deleted.calls.sends.length, 0);
});

test("confirmed report email attaches only the owned file and audits the destination", async () => {
  const { report, calls } = harness();
  const ctx = { userId: "actor-a" };
  const result = await report.emailGeneratedReport("tenant-a", ctx, { fileId: 42,
    to: " owner@example.com ", subject: "November report" });
  assert.deepEqual(result, { fileId: 42, to: "owner@example.com", reportType: "SALES", format: "XLSX" });
  assert.equal(calls.queries.length, 1);
  assert.match(String(calls.queries[0][0]), /gr\.tenant_id = \$1 AND gr\.file_id = \$2/);
  assert.deepEqual(calls.queries[0][1], ["tenant-a", 42]);
  assert.deepEqual(calls.reads, ["tenant-a/private/report.xlsx"]);
  assert.equal(calls.sends.length, 1);
  assert.equal(calls.sends[0][0].to, "owner@example.com");
  assert.equal(calls.sends[0][0].attachments[0].filename, "sales_november.xlsx");
  assert.deepEqual(calls.sends[0][0].attachments[0].content, Buffer.from("FAKE report bytes"));
  assert.match(calls.sends[0][0].html, /&lt;Fake Shop&gt;/);
  assert.deepEqual(calls.audits[0].slice(0, 3), [ctx, "report.email", "42"]);
});

test("provider failure is surfaced and does not record a successful send audit", async () => {
  const { report, calls } = harness({ sendError: true });
  await assert.rejects(report.emailGeneratedReport("tenant-a", {}, { fileId: 42,
    to: "owner@example.com" }), /provider failure/);
  assert.equal(calls.sends.length, 1);
  assert.equal(calls.audits.length, 0);
});
