import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

const CHANNELS = new Set(["line", "facebook", "instagram", "tiktok", "shopee", "lazada", "web"]);

/**
 * Atomically claims a platform event. A false result means the platform retried an event
 * that this tenant/channel already accepted, so callers must not enter the AI/write pipeline again.
 */
export async function claimInboundEvent(
  tenantId: string,
  channel: string,
  externalEventId: string | null | undefined
): Promise<boolean> {
  const eventId = String(externalEventId || "").trim();
  if (!eventId) return true;
  if (!CHANNELS.has(channel)) throw new Error("unsupported inbound channel");
  if (eventId.length > 256) throw new Error("external event id is too long");

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query(
      `INSERT INTO bms_inbound_events (tenant_id, channel, external_event_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, channel, external_event_id) DO NOTHING`,
      [tenantId, channel, eventId]
    );
    await client.query(
      `DELETE FROM bms_inbound_events
        WHERE tenant_id = $1 AND created_at < now() - interval '30 days'`,
      [tenantId]
    );
    await client.query("COMMIT");
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
