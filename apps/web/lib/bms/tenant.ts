// =============================================================
// BMS multi-tenant helper
// -------------------------------------------------------------
// Phase 1: admin ที่มีอยู่ยังไม่มี tenant_id ใน JWT → ใช้ default tenant
// เมื่อทำ signup (Phase 3) ค่อยผูก tenant_id เข้า session/token
// =============================================================

import type { PoolClient } from "pg";

export const DEFAULT_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/** ดึง tenant_id ปัจจุบันจาก context (fallback = default) */
export function getTenantId(ctx: any): string {
  return ctx?.admin?.tenant_id || ctx?.tenant_id || DEFAULT_TENANT_ID;
}

/**
 * เปิดทรานแซกชันแบบ tenant-scoped: BEGIN + ลดสิทธิ์เป็น role bms_app + set GUC
 * ทำให้ RLS บังคับใช้จริง (เขียนข้ามร้านไม่ได้แม้ WHERE พลาด) — revert เมื่อ COMMIT/ROLLBACK
 */
export async function beginTenantTx(client: PoolClient, tenantId: string): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE bms_app");
  await client.query("SELECT set_config('bms.tenant_id', $1, true)", [tenantId]);
}
