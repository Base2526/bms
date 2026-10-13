import { previewCustomerMerge } from "../../apps/web/lib/bms/customerMergeReview.ts";

/** Explicit fake verification for seeded/mocked customers only. */
export async function fakeCustomerMergeReview(tenantId: string, keepId: string, mergeId: string,
  actorId = "00000000-0000-4000-8000-000000000001") {
  const preview = await previewCustomerMerge(tenantId, keepId, mergeId, actorId);
  return { actorId, review: { previewToken: preview.previewToken, reason: "DUPLICATE_ENTRY" as const,
    verificationMethod: "SUPPORT_CASE" as const, evidenceReference: "FAKE-TEST-001", confirmed: true } };
}
