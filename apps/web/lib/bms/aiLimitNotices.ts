import type { PoolClient } from 'pg';
import { getClient } from '@/lib/db';
import { beginTenantTx } from './tenant';
import type { AiLimitStatus } from './aiLimitStatus';

/** Called under the monthly accounting lock; no network or email delivery. */
export async function recordAiLimitNoticesInTx(client: PoolClient, tenantId: string, yearMonth: string, states: { CREDITS: AiLimitStatus; BUDGET: AiLimitStatus }) {
  for (const dimension of ['CREDITS', 'BUDGET'] as const) {
    const status = states[dimension];
    let level: string = status.startsWith('PAUSED_') ? 'PAUSED' : status;
    const previous = await client.query<{ level: string }>(
      `SELECT level FROM bms_ai_limit_notices WHERE tenant_id=$1 AND dimension=$2 AND year_month <= $3
       ORDER BY year_month DESC, created_at DESC, CASE level WHEN 'RESUMED' THEN 4 WHEN 'PAUSED' THEN 3 WHEN 'WARNING_90' THEN 2 ELSE 1 END DESC LIMIT 1`,
      [tenantId, dimension, yearMonth]);
    if (!status.startsWith('PAUSED_') && previous.rows[0]?.level === 'PAUSED') level = 'RESUMED';
    if (level === 'NORMAL') continue;
    const recipients = await client.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.tenant_id=$1 AND r.name IN ('Administrator','Manager')`, [tenantId]);
    // A future owner can still receive this threshold when provisioned later.
    if (!recipients.rowCount) continue;
    const notice = await client.query<{ id: string }>(
      `INSERT INTO bms_ai_limit_notices(tenant_id,year_month,dimension,level) VALUES($1,$2,$3,$4)
       ON CONFLICT(tenant_id,year_month,dimension,level) DO NOTHING RETURNING id`, [tenantId, yearMonth, dimension, level]);
    if (!notice.rows[0]) continue;
    const subject = dimension === 'CREDITS' ? 'เครดิต AI' : 'วงเงิน AI ส่วนกลาง';
    const message = level === 'PAUSED' ? `${subject} ไม่เพียงพอหรือยังยืนยันต้นทุนไม่ได้ บางคำขอ AI ถูกพัก — ดูสถานะปัจจุบันที่ Billing`
      : level === 'RESUMED' ? `${subject} ผ่านเงื่อนไขที่ทำให้พักคำขอก่อนหน้าแล้ว — ดูยอดและเงื่อนไขปัจจุบันที่ Billing`
      : `${subject} ใช้ถึง ${level === 'WARNING_90' ? '90' : '80'}% ของรอบ ${yearMonth} แล้ว — ตรวจสอบที่ Billing`;
    await client.query(
      `INSERT INTO notifications(id,user_id,type,title,message,entity_type,entity_id,data)
       SELECT gen_random_uuid(), recipient, 'bms_ai_limit', 'สถานะการใช้งาน AI', $3, 'bms_ai_limit_notice', $1, $4::jsonb
       FROM unnest($2::uuid[]) AS recipient`,
      [notice.rows[0].id, recipients.rows.map(r => r.id), message, JSON.stringify({ yearMonth, dimension, level })]);
  }
}

async function personalTx<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try { await beginTenantTx(client, tenantId); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function listAiLimitNotifications(tenantId: string, userId: string) {
  return personalTx(tenantId, async client => {
    const rows = await client.query(
      `SELECT n.id,n.is_read,a.dimension,a.level,a.year_month,n.created_at,
              COUNT(*) FILTER (WHERE NOT n.is_read) OVER()::int AS unread_count
       FROM notifications n JOIN bms_ai_limit_notices a ON a.id=n.entity_id
       WHERE a.tenant_id=$1 AND n.user_id=$2 AND n.entity_type='bms_ai_limit_notice'
       ORDER BY n.is_read ASC,n.created_at DESC,n.id DESC LIMIT 30`, [tenantId, userId]);
    return { unreadCount: rows.rows[0]?.unread_count ?? 0, items: rows.rows.map(r => ({
      id: r.id, isRead: r.is_read, dimension: r.dimension, level: r.level,
      yearMonth: r.year_month, createdAt: new Date(r.created_at).toISOString(),
    })) };
  });
}

export async function readAiLimitNotification(tenantId: string, userId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
  return personalTx(tenantId, async client => {
    const result = await client.query(
      `UPDATE notifications n SET is_read=true FROM bms_ai_limit_notices a
       WHERE n.id=$3 AND n.user_id=$2 AND n.entity_type='bms_ai_limit_notice'
         AND a.id=n.entity_id AND a.tenant_id=$1 RETURNING n.id`, [tenantId, userId, id]);
    return Boolean(result.rowCount);
  });
}
