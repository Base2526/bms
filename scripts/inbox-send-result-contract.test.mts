import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function sendResult(serviceResult: Record<string, unknown>) {
  const resolver = loadWithStubs("apps/web/graphql/bmsInbox.ts", {
    "@/lib/bms/inbox": { sendStaffMessage: async () => serviceResult },
    "@/lib/bms/inboxMedia": { safeInboxAttachmentUrl: (url: unknown) => typeof url === "string" ? url : null },
    "@/lib/bms/permissions": { requirePermission: async () => {} },
    "@/lib/bms/tenant": { getTenantId: () => "FAKE-tenant" },
    "@/lib/auth": { requireAuth: () => ({ scope: "admin" }) },
    "@/lib/bms/platform": { isPlatformAdmin: async () => false },
    "graphql/error": { GraphQLError: Error },
  }).bmsInboxResolvers;
  return resolver.Mutation.bmsSendMessage(null, { id: "FAKE-chat", body: "hello" },
    { admin: { id: "FAKE-actor", role: "Manager" } });
}

test("saved reply distinguishes provider failure from unsupported outbound delivery", async () => {
  const failed = await sendResult({ status: "SENT", delivered: false, deliveryFailed: true });
  assert.equal(failed.delivered, false);
  assert.equal(failed.needsReview, true);
  assert.match(failed.message, /ส่งออกไม่สำเร็จ.*บันทึกข้อความไว้แล้ว/);

  const savedOnly = await sendResult({ status: "SENT", delivered: false });
  assert.equal(savedOnly.needsReview, false);
  assert.match(savedOnly.message, /ยังไม่รองรับการส่งออกจาก Inbox/);
});

test("accepted provider reply with an unsaved delivery state asks staff to review", async () => {
  const result = await sendResult({ status: "SENT", delivered: true, statusUnconfirmed: true });
  assert.equal(result.delivered, true);
  assert.equal(result.needsReview, true);
  assert.match(result.message, /ยังบันทึกสถานะการส่งไม่ได้/);
});
