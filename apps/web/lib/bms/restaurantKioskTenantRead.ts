import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

/** Scoped reads for kiosk proposals: their RLS policy deliberately fails closed without a tenant GUC. */
export async function kioskTenantRead<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}
