// =============================================================
// BMS audit log — บันทึกการกระทำของ admin (tenant-scoped)
// =============================================================

import { query } from "@/lib/db";
import { getTenantId } from "./tenant";

/** บันทึก audit จาก resolver (ไม่ throw — ไม่ให้ล้ม mutation หลัก) */
export async function audit(
  ctx: any,
  action: string,
  target?: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    const actor = ctx?.admin?.email || ctx?.admin?.id || "system";
    await query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [getTenantId(ctx), String(actor), action, target ?? null, JSON.stringify(meta ?? {})]
    );
  } catch (e) {
    console.error("[BMS] audit failed:", e);
  }
}

export async function listAudit(tenantId: string, limit = 100) {
  const res = await query(
    `SELECT id, actor, action, target, meta, created_at
       FROM bms_audit_log WHERE tenant_id = $1
      ORDER BY created_at DESC, id DESC LIMIT $2`,
    [tenantId, Math.min(Math.max(limit, 1), 500)]
  );
  return res.rows;
}
