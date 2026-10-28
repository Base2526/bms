import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

/** Evidence reads must set the tenant GUC even on a non-superuser connection. */
export async function readInventoryEvidence<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
