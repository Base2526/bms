// =============================================================
// BMS System Health — รวมสถานะที่มีอยู่แล้วของระบบเป็นจุดเดียว (2026-08)
// -------------------------------------------------------------
// จุดเริ่มคือ /admin/env, /admin/operations-schedule, Channel Health,
// AI Provider Health กระจายกันคนละหน้า ไม่มีภาพรวมเดียวว่า "ระบบตอนนี้เป็น
// ยังไง" — ไฟล์นี้ไม่สร้าง subsystem ใหม่ แค่รวม read ที่มีอยู่แล้ว
// (listAiProviderHealth/listLatestJobRunPerJob) + เพิ่ม read เล็กๆที่ยังไม่มี
// ทางดู (DB connection state, Redis ping, channel health ข้ามร้าน, failure
// incident ล่าสุด) — ทุกฟังก์ชัน platform-wide (ไม่ผูก tenant) เหมือน
// aiProviderHealth.ts/jobRuns.ts
//
// ทุกฟังก์ชัน "พังแบบไม่ทำให้หน้าพังทั้งหน้า" — migration บางตัวอาจยังไม่ apply
// ในบางเครื่อง (เช่น bms_failure_incidents/bms_job_runs) ถ้า query error ให้
// คืน ok:false + message แทน throw ออกไปให้ page.tsx crash ทั้งหน้า
// =============================================================

import { query } from "@/lib/db";
import { sharedRedisClient } from "@/lib/cache";

export type DbHealth =
  | {
      ok: true;
      active: number;
      idle: number;
      idleInTransaction: number;
      total: number;
      maxConnections: number;
      longestActiveQuerySec: number;
      dbSizeBytes: number;
    }
  | { ok: false; error: string };

export async function getDbHealth(): Promise<DbHealth> {
  try {
    const [activityRes, settingsRes, sizeRes] = await Promise.all([
      query<{
        active: string;
        idle: string;
        idle_in_tx: string;
        total: string;
        longest_active_query_sec: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE state = 'active') AS active,
           count(*) FILTER (WHERE state = 'idle') AS idle,
           count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
           count(*) AS total,
           COALESCE(
             max(EXTRACT(EPOCH FROM (now() - query_start))) FILTER (WHERE state = 'active'),
             0
           ) AS longest_active_query_sec
         FROM pg_stat_activity
         WHERE datname = current_database()`
      ),
      query<{ setting: string }>(`SELECT setting FROM pg_settings WHERE name = 'max_connections'`),
      query<{ size: string }>(`SELECT pg_database_size(current_database()) AS size`),
    ]);

    const a = activityRes.rows[0];
    return {
      ok: true,
      active: Number(a?.active ?? 0),
      idle: Number(a?.idle ?? 0),
      idleInTransaction: Number(a?.idle_in_tx ?? 0),
      total: Number(a?.total ?? 0),
      maxConnections: Number(settingsRes.rows[0]?.setting ?? 0),
      longestActiveQuerySec: Math.round(Number(a?.longest_active_query_sec ?? 0)),
      dbSizeBytes: Number(sizeRes.rows[0]?.size ?? 0),
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export type RedisHealth =
  | { ok: true; latencyMs: number; connectedClients: number | null; usedMemoryHuman: string | null }
  | { ok: false; error: string };

function parseInfoField(info: string, field: string): string | null {
  const m = info.match(new RegExp(`^${field}:(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

export async function getRedisHealth(): Promise<RedisHealth> {
  try {
    const start = Date.now();
    await sharedRedisClient.ping();
    const latencyMs = Date.now() - start;
    const info = await sharedRedisClient.info();
    const connectedClients = parseInfoField(info, "connected_clients");
    const usedMemoryHuman = parseInfoField(info, "used_memory_human");
    return {
      ok: true,
      latencyMs,
      connectedClients: connectedClients ? Number(connectedClients) : null,
      usedMemoryHuman,
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export type UnhealthyChannelRow = {
  tenantId: string;
  tenantName: string;
  channel: string;
  status: string;
  statusDetail: string | null;
  lastCheckedAt: string | null;
};

export type ChannelHealthOverview =
  | { ok: true; unhealthyCount: number; rows: UnhealthyChannelRow[] }
  | { ok: false; error: string };

/** Cross-tenant view of Channel Health (6.4) — the existing service is tenant-scoped only. */
export async function getChannelHealthOverview(limit = 30): Promise<ChannelHealthOverview> {
  try {
    const [countRes, rowsRes] = await Promise.all([
      query<{ c: string }>(
        `SELECT COUNT(*)::int AS c
           FROM bms_tenant_channels
          WHERE active = true AND status <> 'connected'`
      ),
      query<{
        tenant_id: string;
        tenant_name: string;
        channel: string;
        status: string;
        status_detail: string | null;
        last_checked_at: Date | null;
      }>(
        `SELECT tc.tenant_id, t.name AS tenant_name, tc.channel, tc.status, tc.status_detail, tc.last_checked_at
           FROM bms_tenant_channels tc
           JOIN bms_tenants t ON t.id = tc.tenant_id
          WHERE tc.active = true AND tc.status <> 'connected'
          ORDER BY tc.last_checked_at DESC NULLS LAST
          LIMIT $1`,
        [limit]
      ),
    ]);
    return {
      ok: true,
      unhealthyCount: Number(countRes.rows[0]?.c ?? 0),
      rows: rowsRes.rows.map((r) => ({
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        channel: r.channel,
        status: r.status,
        statusDetail: r.status_detail,
        lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
      })),
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export type FailureIncidentRow = {
  id: number;
  tenantId: string;
  tenantName: string;
  code: string;
  tier: "A" | "B";
  surface: string;
  channel: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type FailureIncidentsOverview =
  | { ok: true; last24hByTier: { A: number; B: number }; rows: FailureIncidentRow[] }
  | { ok: false; error: string };

/**
 * Recent bms_failure_incidents (7.36) across every tenant — the doc note for
 * that feature says explicitly there is no list page yet ("เห็นผ่าน browser/bell
 * notification + Slack + query DB ตรงเท่านั้น"). This is that missing read path,
 * read-only, no new writes.
 */
export async function getFailureIncidentsOverview(limit = 20): Promise<FailureIncidentsOverview> {
  try {
    const [tierRes, rowsRes] = await Promise.all([
      query<{ tier: "A" | "B"; c: string }>(
        `SELECT tier, COUNT(*)::int AS c
           FROM bms_failure_incidents
          WHERE created_at >= now() - interval '24 hours'
          GROUP BY tier`
      ),
      query<{
        id: number;
        tenant_id: string;
        tenant_name: string;
        code: string;
        tier: "A" | "B";
        surface: string;
        channel: string | null;
        error_message: string | null;
        created_at: Date;
      }>(
        `SELECT fi.id, fi.tenant_id, t.name AS tenant_name, fi.code, fi.tier, fi.surface,
                fi.channel, fi.error_message, fi.created_at
           FROM bms_failure_incidents fi
           JOIN bms_tenants t ON t.id = fi.tenant_id
          ORDER BY fi.created_at DESC
          LIMIT $1`,
        [limit]
      ),
    ]);

    const last24hByTier = { A: 0, B: 0 };
    for (const r of tierRes.rows) {
      if (r.tier === "A" || r.tier === "B") last24hByTier[r.tier] = Number(r.c);
    }

    return {
      ok: true,
      last24hByTier,
      rows: rowsRes.rows.map((r) => ({
        id: Number(r.id),
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        code: r.code,
        tier: r.tier,
        surface: r.surface,
        channel: r.channel,
        errorMessage: r.error_message,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}
