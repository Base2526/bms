import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { readCustomerToken, signCustomerToken } from "./customerSecurityToken";

export type CustomerMergeReview = {
  previewToken: string;
  reason: "DUPLICATE_CHANNELS" | "DUPLICATE_ENTRY";
  verificationMethod: "BOTH_CHANNELS" | "IN_PERSON" | "SUPPORT_CASE";
  evidenceReference: string;
  confirmed: boolean;
};
export type CustomerMergeActor = { actorId: string; review: CustomerMergeReview };

export function validateCustomerMergeReview(input?: CustomerMergeActor): CustomerMergeActor {
  const review = input?.review;
  if (!input?.actorId || !review || review.confirmed !== true ||
      !["DUPLICATE_CHANNELS", "DUPLICATE_ENTRY"].includes(review.reason) ||
      !["BOTH_CHANNELS", "IN_PERSON", "SUPPORT_CASE"].includes(review.verificationMethod) ||
      typeof review.previewToken !== "string" ||
      typeof review.evidenceReference !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_:#./-]{2,119}$/.test(review.evidenceReference)) {
    throw new Error("กรุณาตรวจผลกระทบ ยืนยันตัวตน และระบุรหัสหลักฐานก่อนรวมลูกค้า / Review and verification evidence required");
  }
  return input;
}

// Counts and balances only. Never expose prescription/clinical text or identity
// credentials in a merge preview, token, or audit entry.
export async function readCustomerMergeSnapshot(client: PoolClient, tenantId: string, keepId: string, mergeId: string) {
  if (keepId === mergeId) throw new Error("เลือกลูกค้าสองรายการที่ต่างกัน / Select two different customers");
  const result = await client.query(
    `SELECT c.id, c.name, c.phone, c.email, c.member_no, c.updated_at,
       ARRAY(SELECT DISTINCT i.channel FROM bms_customer_identities i
         WHERE i.tenant_id = $1 AND i.customer_id = c.id ORDER BY i.channel) AS channels,
       ARRAY(SELECT jsonb_build_array(i.id, i.channel, i.external_ref)::text FROM bms_customer_identities i
         WHERE i.tenant_id = $1 AND i.customer_id = c.id ORDER BY i.id) AS identity_bindings,
       (SELECT COUNT(*)::int FROM bms_orders x WHERE x.tenant_id = $1 AND x.customer_id = c.id) AS orders,
       (SELECT COUNT(*)::int FROM bms_customer_addresses x WHERE x.tenant_id = $1 AND x.customer_id = c.id) AS addresses,
       (SELECT COUNT(*)::int FROM bms_conversations x WHERE x.tenant_id = $1 AND x.customer_id = c.id) AS conversations,
       (SELECT COUNT(*)::int FROM bms_pharmacy_assessments x WHERE x.tenant_id = $1 AND x.customer_id = c.id) AS pharmacy_cases,
       (SELECT COALESCE(SUM(points), 0)::text FROM bms_loyalty_ledger x WHERE x.tenant_id = $1 AND x.customer_id = c.id) AS points,
       (SELECT COUNT(*)::int FROM bms_customer_coupon_wallet x WHERE x.tenant_id = $1 AND x.customer_id = c.id) AS coupons,
       (SELECT COALESCE(SUM(balance), 0)::text FROM bms_store_credits x WHERE x.tenant_id = $1 AND x.customer_id = c.id) AS store_credit,
       (SELECT COUNT(*)::int FROM bms_pos_deposits x WHERE x.tenant_id = $1 AND x.customer_id = c.id AND status = 'OPEN') AS open_deposits,
       (SELECT COALESCE(SUM(deposit_paid), 0)::text FROM bms_pos_deposits x WHERE x.tenant_id = $1 AND x.customer_id = c.id AND status = 'OPEN') AS deposit_paid,
       (SELECT COUNT(*)::int FROM bms_board_game_member_passes x WHERE x.tenant_id = $1 AND x.customer_id = c.id) AS passes,
       (SELECT COUNT(*)::int FROM bms_board_game_pass_renewals x WHERE x.tenant_id = $1 AND x.customer_id = c.id AND status IN ('ACTIVE','PAST_DUE','PAUSED')) AS renewals,
       (SELECT COUNT(*)::int FROM bms_restaurant_waitlist x WHERE x.tenant_id = $1 AND x.customer_id = c.id) AS restaurant_requests,
       (SELECT COUNT(*)::int FROM bms_board_game_waitlist x WHERE x.tenant_id = $1 AND x.customer_id = c.id AND source = 'CHAT') AS game_requests
     FROM bms_customers c WHERE c.tenant_id = $1 AND c.id = ANY($2::uuid[]) AND c.deleted_at IS NULL
     ORDER BY c.id`, [tenantId, [keepId, mergeId]],
  );
  const keep = result.rows.find(row => row.id === keepId);
  const source = result.rows.find(row => row.id === mergeId);
  if (!keep || !source) throw new Error("ไม่พบลูกค้าที่จะรวม / Customer not found");
  return { keep, source };
}

export function customerMergeDigest(snapshot: unknown): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function publicSummary(row: Record<string, any>) {
  return {
    id: row.id, name: row.name, memberNo: row.member_no,
    phoneHint: row.phone ? `…${String(row.phone).slice(-4)}` : null,
    channels: row.channels,
    orders: row.orders, addresses: row.addresses, conversations: row.conversations,
    pharmacyCases: row.pharmacy_cases, points: row.points, coupons: row.coupons,
    storeCredit: row.store_credit, openDeposits: row.open_deposits, depositPaid: row.deposit_paid,
    passes: row.passes, renewals: row.renewals,
    restaurantRequests: row.restaurant_requests, gameRequests: row.game_requests,
  };
}

export async function previewCustomerMerge(tenantId: string, keepId: string, mergeId: string, actorId: string) {
  if (!actorId) throw new Error("Authenticated actor required");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const snapshot = await readCustomerMergeSnapshot(client, tenantId, keepId, mergeId);
    const exp = Math.floor(Date.now() / 1000) + 10 * 60;
    const previewToken = signCustomerToken("customer-merge-v1", {
      tenantId, keepId, mergeId, actorId, digest: customerMergeDigest(snapshot), exp,
    });
    await client.query("COMMIT");
    return { keep: publicSummary(snapshot.keep), source: publicSummary(snapshot.source), previewToken,
      expiresAt: new Date(exp * 1000).toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export function assertCustomerMergePreview(tenantId: string, keepId: string, mergeId: string, input: CustomerMergeActor, snapshot: unknown) {
  const token = readCustomerToken("customer-merge-v1", input.review.previewToken);
  if (!token || token.tenantId !== tenantId || token.keepId !== keepId || token.mergeId !== mergeId ||
      token.actorId !== input.actorId || token.digest !== customerMergeDigest(snapshot)) {
    throw new Error("ข้อมูลเปลี่ยนหรือหมดเวลายืนยัน กรุณาตรวจผลกระทบใหม่ / Refresh the merge preview");
  }
}

export function customerMergeAuditMeta(mergeId: string, input: CustomerMergeActor, snapshot: Awaited<ReturnType<typeof readCustomerMergeSnapshot>>) {
  // Deliberately omit names/contact details/member numbers and the bearer token.
  const counts = (row: Record<string, any>) => {
    const keys = ["channels", "orders", "addresses", "conversations", "pharmacy_cases", "points", "coupons",
      "store_credit", "open_deposits", "deposit_paid", "passes", "renewals", "restaurant_requests", "game_requests"];
    return Object.fromEntries(keys.map(key => [key, row[key]]));
  };
  return { version: 1, mergedId: mergeId, reason: input.review.reason,
    verificationMethod: input.review.verificationMethod, evidenceReference: input.review.evidenceReference,
    confirmed: true, previewDigest: customerMergeDigest(snapshot),
    impact: { keep: counts(snapshot.keep), source: counts(snapshot.source) } };
}
