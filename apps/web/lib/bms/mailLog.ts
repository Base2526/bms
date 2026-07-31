// =============================================================
// BMS Mail Log — บันทึกทุกอีเมลที่ระบบสั่งส่งจริง (ดู db/migrations/7.40)
// -------------------------------------------------------------
// เขียนจากจุดเดียวคือ sendEmail() ใน lib/mailer.ts (ครอบคลุมทุก caller
// อัตโนมัติ ไม่ต้องแก้ทุกจุดที่ส่งอีเมลถ้ามี caller ใหม่ในอนาคต)
// อ่านเฉพาะฝั่ง /admin/mail-log (platform admin เท่านั้น — ดู bmsMailLog.ts)
// =============================================================

import { query } from "@/lib/db";

export type MailLogCategory = "digest" | "order" | "auth" | "support" | "test" | "other";
export type MailProvider = "sendgrid" | "gmail";
export type MailStatus = "success" | "error";

export type MailLogRow = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  category: MailLogCategory;
  provider: MailProvider;
  toEmail: string;
  fromEmail: string | null;
  subject: string | null;
  status: MailStatus;
  messageId: string | null;
  statusCode: number | null;
  error: string | null;
  html: string | null;
  textBody: string | null;
  triggeredBy: string | null;
  createdAt: string;
};

function mapRow(r: any): MailLogRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name ?? null,
    category: r.category,
    provider: r.provider,
    toEmail: r.to_email,
    fromEmail: r.from_email,
    subject: r.subject,
    status: r.status,
    messageId: r.message_id,
    statusCode: r.status_code,
    error: r.error,
    html: r.html,
    textBody: r.text_body,
    triggeredBy: r.triggered_by,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

// best-effort เสมอ — ห้าม throw ออกไปกระทบ sendEmail() ที่กำลังส่งจริง
// (เหมือน pattern audit()/addLog() เดิม)
export async function recordMailLog(entry: {
  tenantId?: string | null;
  category?: MailLogCategory;
  provider: MailProvider;
  to: string;
  from?: string | null;
  subject?: string | null;
  status: MailStatus;
  messageId?: string | null;
  statusCode?: number | null;
  error?: string | null;
  html?: string | null;
  text?: string | null;
  triggeredBy?: string | null;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO bms_mail_log
         (tenant_id, category, provider, to_email, from_email, subject, status,
          message_id, status_code, error, html, text_body, triggered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        entry.tenantId ?? null,
        entry.category ?? "other",
        entry.provider,
        entry.to,
        entry.from ?? null,
        entry.subject ?? null,
        entry.status,
        entry.messageId ?? null,
        entry.statusCode ?? null,
        entry.error ?? null,
        entry.html ?? null,
        entry.text ?? null,
        entry.triggeredBy ?? null,
      ]
    );
  } catch (e) {
    console.error("[BMS] mail log insert failed:", e);
  }
}

export type MailLogFilter = {
  q?: string;
  status?: MailStatus;
  provider?: MailProvider;
  category?: MailLogCategory;
  tenantId?: string;
  page?: number;
  pageSize?: number;
};

export async function listMailLog(filter: MailLogFilter): Promise<{ items: MailLogRow[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: any[] = [];

  if (filter.status) { params.push(filter.status); where.push(`m.status = $${params.length}`); }
  if (filter.provider) { params.push(filter.provider); where.push(`m.provider = $${params.length}`); }
  if (filter.category) { params.push(filter.category); where.push(`m.category = $${params.length}`); }
  if (filter.tenantId) { params.push(filter.tenantId); where.push(`m.tenant_id = $${params.length}`); }
  if (filter.q && filter.q.trim()) {
    params.push(`%${filter.q.trim().toLowerCase()}%`);
    where.push(`(lower(m.to_email) LIKE $${params.length} OR lower(m.subject) LIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM bms_mail_log m ${whereSql}`,
    params
  );

  const listParams = [...params, pageSize, offset];
  const rowsRes = await query(
    `SELECT m.*, t.name AS tenant_name
       FROM bms_mail_log m
       LEFT JOIN bms_tenants t ON t.id = m.tenant_id
       ${whereSql}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return { items: rowsRes.rows.map(mapRow), total: Number(countRes.rows[0]?.count ?? 0) };
}

export async function getMailLog(id: string): Promise<MailLogRow | null> {
  const res = await query(
    `SELECT m.*, t.name AS tenant_name
       FROM bms_mail_log m
       LEFT JOIN bms_tenants t ON t.id = m.tenant_id
      WHERE m.id = $1`,
    [id]
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

export type MailLogStats = {
  total: number;
  success: number;
  error: number;
  topErrorProvider: MailProvider | null;
};

// สรุปย้อนหลัง 24 ชม. — ใช้กับ stat tile บนหน้า /admin/mail-log
export async function getMailLogStats(): Promise<MailLogStats> {
  const res = await query<{ status: MailStatus; provider: MailProvider; count: string }>(
    `SELECT status, provider, COUNT(*) AS count
       FROM bms_mail_log
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY status, provider`
  );

  let success = 0;
  let error = 0;
  const errorByProvider: Record<string, number> = {};
  for (const r of res.rows) {
    const count = Number(r.count);
    if (r.status === "success") success += count;
    else {
      error += count;
      errorByProvider[r.provider] = (errorByProvider[r.provider] ?? 0) + count;
    }
  }
  const topErrorProvider = (Object.keys(errorByProvider).sort(
    (a, b) => errorByProvider[b] - errorByProvider[a]
  )[0] as MailProvider) ?? null;

  return { total: success + error, success, error, topErrorProvider };
}
