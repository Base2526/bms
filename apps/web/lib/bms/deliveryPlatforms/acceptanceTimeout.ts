import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "../tenant";

type ClaimedAcceptance = { tenant_id: string; delivery_order_id: string; claim_token: string };

/**
 * The public contracts currently available do not establish a safe automatic
 * reject/refund lifecycle for any adapter that can be enabled live. Expiry is
 * therefore a hard local accept block and a human incident, never a guessed
 * provider command or a silent cancellation of a platform-confirmed payment.
 */
export async function processExpiredDeliveryAcceptances(limit = 50) {
  const claimed = await query<ClaimedAcceptance>(
    `SELECT * FROM bms_claim_expired_delivery_acceptance($1,$2)`,
    [Math.min(Math.max(Math.trunc(limit), 1), 100), 120_000],
  );
  let actionRequired = 0;
  let failed = 0;
  for (const claim of claimed.rows) {
    const client = await getClient();
    try {
      await beginTenantTx(client, claim.tenant_id);
      const order = await client.query<{ id: string; provider: string; provider_status: string | null; bms_order_id: string | null }>(
        `SELECT id,provider,provider_status,bms_order_id FROM bms_delivery_orders
          WHERE tenant_id=$1 AND id=$2 AND acceptance_claim_token=$3
            AND local_status IN ('RECEIVED','AWAITING_ACCEPTANCE') FOR UPDATE`,
        [claim.tenant_id, claim.delivery_order_id, claim.claim_token],
      );
      if (!order.rowCount) {
        await client.query("ROLLBACK");
        continue;
      }
      await client.query(
        `UPDATE bms_delivery_orders SET local_status='ACTION_REQUIRED',acceptance_claimed_at=NULL,
                acceptance_claim_token=NULL,updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND acceptance_claim_token=$3`,
        [claim.tenant_id, claim.delivery_order_id, claim.claim_token],
      );
      await client.query(
        `INSERT INTO bms_delivery_order_events
          (tenant_id,delivery_order_id,event_kind,actor_type,source,safe_detail)
         VALUES ($1,$2,'ACCEPTANCE_DEADLINE_EXPIRED','SYSTEM','acceptance-timeout',$3::jsonb)`,
        [claim.tenant_id, claim.delivery_order_id,
          JSON.stringify({ provider: order.rows[0].provider, providerStatus: order.rows[0].provider_status,
            resolution: "MANUAL_PROVIDER_ACTION_REQUIRED" })],
      );
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
         VALUES ($1,'system:delivery-acceptance-timeout','delivery.acceptance_expired',$2,$3::jsonb)`,
        [claim.tenant_id, claim.delivery_order_id,
          JSON.stringify({ bmsOrderId: order.rows[0].bms_order_id, provider: order.rows[0].provider,
            reservationReleased: false, reason: "provider reject/refund contract not verified" })],
      );
      await client.query("COMMIT");
      actionRequired += 1;
    } catch (error) {
      failed += 1;
      try { await client.query("ROLLBACK"); } catch {}
      const retry = await getClient();
      try {
        await beginTenantTx(retry, claim.tenant_id);
        await retry.query(
          `UPDATE bms_delivery_orders SET acceptance_claimed_at=NULL,acceptance_claim_token=NULL,updated_at=now()
            WHERE tenant_id=$1 AND id=$2 AND acceptance_claim_token=$3`,
          [claim.tenant_id, claim.delivery_order_id, claim.claim_token],
        );
        await retry.query("COMMIT");
      } catch {
        try { await retry.query("ROLLBACK"); } catch {}
      } finally { retry.release(); }
      console.error("[delivery acceptance timeout]", error);
    } finally { client.release(); }
  }
  return { claimed: claimed.rowCount, actionRequired, failed };
}
