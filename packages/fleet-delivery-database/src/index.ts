import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { IntegrationEnvelopeV1 } from "@bms/fleet-delivery-contracts";
import { canonicalJson, type JsonValue } from "@bms/fleet-delivery-domain";

export function createDatabasePool(connectionString: string, max = 10): Pool {
  return new Pool({ connectionString, max, connectionTimeoutMillis: 3_000, idleTimeoutMillis: 30_000 });
}

export async function principalHasMapping(
  pool: Pool,
  principalSubject: string,
  tenantRef: string,
  branchRef: string,
  producer: IntegrationEnvelopeV1["producer"],
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM fleet_delivery.integration_mappings
      WHERE principal_subject = $1
        AND external_tenant_ref = $2
        AND external_branch_ref = $3
        AND allowed_producer = $4
        AND active = true
      LIMIT 1`,
    [principalSubject, tenantRef, branchRef, producer],
  );
  return result.rowCount === 1;
}

export type StoreInboxResult = "STORED" | "DUPLICATE" | "BODY_MISMATCH";

export async function storeInboxEnvelope(
  client: PoolClient,
  envelope: IntegrationEnvelopeV1,
): Promise<StoreInboxResult> {
  const bodyHash = createHash("sha256")
    .update(canonicalJson(envelope as unknown as JsonValue), "utf8")
    .digest("hex");
  const existing = await client.query<{ body_sha256: string }>(
    `SELECT body_sha256
       FROM fleet_delivery.inbox_events
      WHERE producer = $1 AND message_id = $2`,
    [envelope.producer, envelope.messageId],
  );
  if (existing.rows[0]) {
    return existing.rows[0].body_sha256 === bodyHash ? "DUPLICATE" : "BODY_MISMATCH";
  }
  await client.query(
    `INSERT INTO fleet_delivery.inbox_events (
       tenant_ref, branch_ref, producer, message_id, message_type, aggregate_type,
       aggregate_ref, aggregate_version, body_sha256, envelope
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      envelope.tenantRef,
      envelope.branchRef,
      envelope.producer,
      envelope.messageId,
      envelope.messageType,
      envelope.aggregateType,
      envelope.aggregateRef,
      envelope.aggregateVersion,
      bodyHash,
      JSON.stringify(envelope),
    ],
  );
  return "STORED";
}

export async function isServiceTokenRevoked(
  pool: Pool,
  input: { issuer: string; subject: string; jti: string; keyId?: string },
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM fleet_delivery.service_principal_revocations
      WHERE issuer = $1
        AND principal_subject = $2
        AND (token_jti = $3 OR ($4::text IS NOT NULL AND key_id = $4))
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [input.issuer, input.subject, input.jti, input.keyId ?? null],
  );
  return result.rowCount === 1;
}

export type ClaimedOutboxEvent = {
  id: string;
  tenantRef: string;
  branchRef: string;
  destination: string;
  envelope: unknown;
  attempts: number;
};

export async function claimOutbox(
  pool: Pool,
  workerId: string,
  limit: number,
  leaseSeconds: number,
): Promise<ClaimedOutboxEvent[]> {
  const result = await pool.query<{
    id: string;
    tenant_ref: string;
    branch_ref: string;
    destination: string;
    envelope: unknown;
    attempts: number;
  }>("SELECT * FROM fleet_delivery.claim_outbox($1, $2, $3)", [workerId, limit, leaseSeconds]);
  return result.rows.map((row) => ({
    id: row.id,
    tenantRef: row.tenant_ref,
    branchRef: row.branch_ref,
    destination: row.destination,
    envelope: row.envelope,
    attempts: row.attempts,
  }));
}

export async function completeOutbox(pool: Pool, id: string, workerId: string): Promise<boolean> {
  const result = await pool.query<{ complete_outbox: boolean }>(
    "SELECT fleet_delivery.complete_outbox($1, $2)",
    [id, workerId],
  );
  return result.rows[0]?.complete_outbox === true;
}

export async function failOutbox(
  pool: Pool,
  id: string,
  workerId: string,
  errorCode: string,
  errorDetail: string,
): Promise<boolean> {
  const result = await pool.query<{ fail_outbox: boolean }>(
    "SELECT fleet_delivery.fail_outbox($1, $2, $3, $4)",
    [id, workerId, errorCode, errorDetail],
  );
  return result.rows[0]?.fail_outbox === true;
}

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('fleet-delivery-migrations-v1'))");
    await client.query(`CREATE TABLE IF NOT EXISTS public.fleet_delivery_schema_migrations (
      filename text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(migrationsDir)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
    for (const filename of files) {
      const sql = await readFile(path.join(migrationsDir, filename), "utf8");
      const sha256 = createHash("sha256").update(sql, "utf8").digest("hex");
      const existing = await client.query<{ sha256: string }>(
        "SELECT sha256 FROM public.fleet_delivery_schema_migrations WHERE filename = $1",
        [filename],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].sha256 !== sha256) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${filename}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public.fleet_delivery_schema_migrations (filename, sha256) VALUES ($1, $2)",
          [filename, sha256],
        );
        await client.query("COMMIT");
        applied.push(filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('fleet-delivery-migrations-v1'))").catch(() => undefined);
    client.release();
  }
}

export * from "./phase2.js";
export * from "./phase3.js";
export * from "./phase4.js";
export * from "./phase7.js";
export * from "./transaction.js";
