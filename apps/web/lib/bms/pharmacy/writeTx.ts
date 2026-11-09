import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "../tenant";

export async function withPharmacyWriteTx<T>(
  tenantId: string,
  actorId: string,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function auditPharmacyWriteInTx(
  client: PoolClient,
  tenantId: string,
  actorId: string,
  action: string,
  target: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, actorId, action, target, JSON.stringify(meta)]
  );
}
