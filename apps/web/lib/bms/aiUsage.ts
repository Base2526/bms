// =============================================================
// BMS AI usage — นับ/เช็ค quota รายเดือนของ shared key (BYOK ไม่นับ)
// =============================================================

import { query } from "@/lib/db";
import { getTenantPlan } from "./plans";

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type AiUsage = {
  count: number; limit: number; remaining: number; unlimited: boolean;
  planCode: string; planName: string;
};

export async function getAiUsage(tenantId: string): Promise<AiUsage> {
  const plan = await getTenantPlan(tenantId);
  const ym = currentYearMonth();
  const res = await query<{ count: number }>(
    `SELECT count FROM bms_ai_usage_monthly WHERE tenant_id = $1 AND year_month = $2`,
    [tenantId, ym]
  );
  const count = res.rows[0]?.count ?? 0;
  const unlimited = plan.max_ai_messages_month < 0;
  return {
    count,
    limit: plan.max_ai_messages_month,
    remaining: unlimited ? -1 : Math.max(plan.max_ai_messages_month - count, 0),
    unlimited,
    planCode: plan.code,
    planName: plan.name,
  };
}

/**
 * เช็ค + เพิ่มการใช้งาน AI ผ่าน shared key แบบ atomic (single UPDATE ... WHERE count < limit)
 * คืน false ถ้าเกิน quota แล้ว (ไม่เพิ่ม count, ผู้เรียกต้อง fallback เป็น template)
 */
export async function tryConsumeAiQuota(tenantId: string): Promise<boolean> {
  const plan = await getTenantPlan(tenantId);
  const ym = currentYearMonth();

  if (plan.max_ai_messages_month < 0) {
    await query(
      `INSERT INTO bms_ai_usage_monthly (tenant_id, year_month, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, year_month) DO UPDATE SET
         count = bms_ai_usage_monthly.count + 1, updated_at = now()`,
      [tenantId, ym]
    );
    return true;
  }

  await query(
    `INSERT INTO bms_ai_usage_monthly (tenant_id, year_month, count)
     VALUES ($1, $2, 0)
     ON CONFLICT (tenant_id, year_month) DO NOTHING`,
    [tenantId, ym]
  );

  const upd = await query<{ count: number }>(
    `UPDATE bms_ai_usage_monthly
        SET count = count + 1, updated_at = now()
      WHERE tenant_id = $1 AND year_month = $2 AND count < $3
      RETURNING count`,
    [tenantId, ym, plan.max_ai_messages_month]
  );
  return (upd.rowCount ?? 0) > 0;
}
