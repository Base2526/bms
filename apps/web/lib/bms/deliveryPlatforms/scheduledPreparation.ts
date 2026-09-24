import { getClient, query } from "@/lib/db";
import { enqueueKitchenTicketsInTx } from "../kitchen";
import { beginTenantTx } from "../tenant";

type ClaimedPreparation = {
  tenant_id: string;
  delivery_order_id: string;
  bms_order_id: string;
  claim_token: string;
};

export async function runScheduledDeliveryPreparationBatch(limit = 50) {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const claimed = await query<ClaimedPreparation>(
    `SELECT * FROM public.bms_claim_due_delivery_preparation($1, $2)`,
    [bounded, 60_000],
  );
  const summary = { claimed: claimed.rows.length, started: 0, retried: 0, skipped: 0 };
  for (const row of claimed.rows) {
    const client = await getClient();
    try {
      await beginTenantTx(client, row.tenant_id);
      const locked = await client.query(
        `SELECT 1 FROM bms_delivery_orders
          WHERE tenant_id = $1 AND id = $2 AND bms_order_id = $3
            AND local_status = 'ACCEPTED' AND preparation_claim_token = $4
            AND start_preparation_at <= now()
          FOR UPDATE`,
        [row.tenant_id, row.delivery_order_id, row.bms_order_id, row.claim_token],
      );
      if (!locked.rowCount) {
        await client.query("ROLLBACK");
        summary.skipped += 1;
        continue;
      }
      const ticketsCreated = await enqueueKitchenTicketsInTx(client, row.tenant_id, row.bms_order_id);
      await client.query(
        `UPDATE bms_delivery_orders
            SET local_status = 'PREPARING', preparing_at = COALESCE(preparing_at, now()),
                preparation_claimed_at = NULL, preparation_claim_token = NULL, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND preparation_claim_token = $3`,
        [row.tenant_id, row.delivery_order_id, row.claim_token],
      );
      await client.query(
        `INSERT INTO bms_delivery_order_events
           (tenant_id, delivery_order_id, event_kind, actor_type, source, safe_detail)
         VALUES ($1,$2,'SCHEDULED_PREPARATION_STARTED','JOB','scheduled-preparation',$3::jsonb)`,
        [row.tenant_id, row.delivery_order_id, JSON.stringify({ ticketsCreated })],
      );
      await client.query("COMMIT");
      summary.started += 1;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      const retry = await getClient();
      try {
        await beginTenantTx(retry, row.tenant_id);
        await retry.query(
          `UPDATE bms_delivery_orders
              SET preparation_claimed_at = NULL, preparation_claim_token = NULL, updated_at = now()
            WHERE tenant_id = $1 AND id = $2 AND preparation_claim_token = $3`,
          [row.tenant_id, row.delivery_order_id, row.claim_token],
        );
        await retry.query("COMMIT");
      } catch {
        try { await retry.query("ROLLBACK"); } catch {}
      } finally { retry.release(); }
      summary.retried += 1;
    } finally { client.release(); }
  }
  return summary;
}
