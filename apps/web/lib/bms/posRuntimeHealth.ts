import { query } from "@/lib/db";

export type PosRuntimeHealth =
  | { ok: true; database: "ok"; latencyMs: number }
  | { ok: false; database: "error"; latencyMs: number };

type DatabaseCheck = () => Promise<unknown>;

/** Readiness for a POS runtime. It intentionally exposes no database details. */
export async function checkPosRuntimeHealth(
  checkDatabase: DatabaseCheck = () => query("SELECT 1")
): Promise<PosRuntimeHealth> {
  const startedAt = performance.now();
  try {
    await checkDatabase();
    return {
      ok: true,
      database: "ok",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      ok: false,
      database: "error",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
