import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import crypto from "crypto";

// -------------------------------------------------------------
// Pool sizing is explicit because it stops being a per-process concern the
// moment this app runs as more than one instance: total connections to
// Postgres = POSTGRES_POOL_MAX x (web replicas), and blowing past the
// server's `max_connections` fails every instance at once rather than
// degrading. Keep the default at pg's own default (10) so single-instance
// behaviour is unchanged, and lower it per-instance when scaling out.
// -------------------------------------------------------------
function poolInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "appdb",
  user: process.env.POSTGRES_USER || "app",
  password: process.env.POSTGRES_PASSWORD || "app",
  max: poolInt("POSTGRES_POOL_MAX", 10),
  // Hand idle connections back so a scaled-out fleet doesn't pin its peak
  // connection count forever after one traffic spike.
  idleTimeoutMillis: poolInt("POSTGRES_POOL_IDLE_TIMEOUT_MS", 30_000),
  // Fail fast instead of hanging a request forever when the pool is saturated
  // or Postgres is unreachable — an unbounded wait here is what turns one slow
  // query into a whole-instance stall.
  connectionTimeoutMillis: poolInt("POSTGRES_POOL_CONNECT_TIMEOUT_MS", 10_000),
});

// A pool-level error (server restart, idle connection killed by the network)
// is emitted on the pool, not on any query. Without a listener Node treats it
// as an unhandled 'error' event and kills the process.
pool.on("error", (err) => {
  console.error("[db] idle client error (pool will reconnect)", err?.message ?? err);
});

function formatParams(params?: any[]): string {
  if (!params) return "";
  return params.map((p, i) => `$${i + 1}=${JSON.stringify(p)}`).join(", ");
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    return res;
  } catch (err: any) {
    console.error(
      `[SQL ERROR] ${err.message}\n${text.trim()}\nParams: ${formatParams(params)}`
    );
    throw err;
  }
}

export type TxContext = { revisionId: string };
export type TxWorkResult<T> = { revisionId: string; result: T };

export async function runInTransaction<T>(
  userId: string,
  work: (client: PoolClient, ctx: TxContext) => Promise<T>
): Promise<TxWorkResult<T>> {
  const client = await pool.connect();
  const revisionId = crypto.randomUUID();

  try {
    await client.query("BEGIN");

    // ✅ ใช้ set_config แทน SET LOCAL (รองรับ $1)
    await client.query(`SELECT set_config('app.editor_id',  $1, true)`, [userId]);
    await client.query(`SELECT set_config('app.revision_id', $1, true)`, [revisionId]);

    const result = await work(client, { revisionId });

    await client.query("COMMIT");
    return { revisionId, result };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

process.on("SIGINT", async () => {
  await pool.end().catch(() => void 0);
  process.exit(0);
});
