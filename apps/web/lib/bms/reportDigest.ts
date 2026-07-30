// =============================================================
// BMS Report Subscriptions — สรุปยอดขายรายวัน/สัปดาห์/เดือน ส่งอีเมล/Slack/LINE
// -------------------------------------------------------------
// 1 การตั้งค่าต่อร้าน (bms_report_subscriptions) + log การส่งแบบ append-only
// (bms_report_deliveries) ให้ platform admin เห็นประวัติจริงว่าร้านไหนส่งไปเมื่อไหร่
// สำเร็จ/ล้มเหลว — คู่กับ § Channel Health/AI Provider Health pattern เดิม
//
// เวลา/period ทั้งหมดยึด Asia/Bangkok (UTC+7 คงที่ ไม่มี DST) — คำนวณด้วยเลขคณิต
// offset ตรงๆ แทน timezone library (ตาม convention เดิมของโปรเจกต์ที่ใช้ Intl.DateTimeFormat
// เป็นหลัก ไม่มี dependency ใหม่)
// =============================================================

import { query } from "@/lib/db";
import { encryptSecret, decryptSecret } from "./crypto";
import { sendEmail } from "@/lib/mailer";
import { getChannel } from "./channels";
import { getTenantName } from "./platform";
import { getStoreProfile, DEFAULT_EMAIL_THEME_COLOR } from "./storeProfile";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY";

const PAID_STATUSES = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];

// ---------------- Asia/Bangkok time helpers (UTC+7 คงที่) ----------------

function bkkNow(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // Node ICU บาง locale คืน "24" แทน "00"
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[get("weekday")] ?? 0;
  return { year, month, day, hour, weekday };
}

function bkkMidnightUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 7 * 3600 * 1000);
}

function addDaysToYmd(year: number, month: number, day: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const ymd = (p: { year: number; month: number; day: number }) =>
  `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

export function computePeriod(frequency: Frequency, now = bkkNow()) {
  const todayMidnight = bkkMidnightUtc(now.year, now.month, now.day);
  if (frequency === "DAILY") {
    const start = addDaysToYmd(now.year, now.month, now.day, -1);
    return { periodStart: bkkMidnightUtc(start.year, start.month, start.day), periodEnd: todayMidnight, periodKey: `DAILY:${ymd(start)}` };
  }
  if (frequency === "WEEKLY") {
    const start = addDaysToYmd(now.year, now.month, now.day, -7);
    return { periodStart: bkkMidnightUtc(start.year, start.month, start.day), periodEnd: todayMidnight, periodKey: `WEEKLY:${ymd(start)}` };
  }
  // MONTHLY — เดือนปฏิทินก่อนหน้าเต็มเดือน
  const prevMonth = new Date(Date.UTC(now.year, now.month - 1, 1));
  prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
  const py = prevMonth.getUTCFullYear();
  const pm = prevMonth.getUTCMonth() + 1;
  return {
    periodStart: bkkMidnightUtc(py, pm, 1),
    periodEnd: bkkMidnightUtc(now.year, now.month, 1),
    periodKey: `MONTHLY:${py}-${String(pm).padStart(2, "0")}`,
  };
}

function periodLabel(frequency: Frequency, periodStart: Date, periodEnd: Date): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" }).format(d);
  if (frequency === "MONTHLY") {
    return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", month: "long", year: "numeric" }).format(periodStart);
  }
  const inclusiveEnd = new Date(periodEnd.getTime() - 1000);
  return `${fmt(periodStart)} – ${fmt(inclusiveEnd)}`;
}

const FREQ_LABEL_TH: Record<Frequency, string> = { DAILY: "รายวัน", WEEKLY: "รายสัปดาห์", MONTHLY: "รายเดือน" };

/** ตอนนี้ (Asia/Bangkok) ตรงกับเวลา/วันที่ตั้งไว้ให้ส่งไหม — ยังไม่เช็คว่าส่งไปแล้วรอบนี้หรือยัง
 *  (เช็คจาก last_period_key แยกต่างหากใน runScheduledDigests เพื่อกันส่งซ้ำถ้า cron ยิงถี่กว่า 1 ชม.) */
export function shouldSendNow(
  sub: { frequency: Frequency; sendHour: number; sendWeekday: number | null; sendDayOfMonth: number | null },
  now = bkkNow()
): boolean {
  if (now.hour !== sub.sendHour) return false;
  if (sub.frequency === "WEEKLY") return sub.sendWeekday == null || now.weekday === sub.sendWeekday;
  if (sub.frequency === "MONTHLY") return sub.sendDayOfMonth == null || now.day === sub.sendDayOfMonth;
  return true;
}

// ---------------- sales summary ----------------

export type SalesSummary = {
  revenue: number;
  orderCount: number;
  discountTotal: number;
  topProducts: { sku: string; name: string; qty: number; revenue: number }[];
  byChannel: { channel: string; orderCount: number; revenue: number }[];
};

export async function computeSalesSummary(tenantId: string, periodStart: Date, periodEnd: Date): Promise<SalesSummary> {
  const startIso = periodStart.toISOString();
  const endIso = periodEnd.toISOString();
  const [totals, topProducts, byChannel] = await Promise.all([
    query<any>(
      `SELECT COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*)::int AS order_count,
              COALESCE(SUM(discount_amount), 0) AS discount_total
         FROM bms_orders
        WHERE tenant_id = $1 AND status = ANY($2) AND created_at >= $3 AND created_at < $4`,
      [tenantId, PAID_STATUSES, startIso, endIso]
    ),
    query<any>(
      `SELECT oi.product_sku AS sku, p.name, SUM(oi.qty)::int AS qty, SUM(oi.qty * oi.unit_price) AS revenue
         FROM bms_order_items oi
         JOIN bms_orders o ON o.id = oi.order_id
         JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
        WHERE oi.tenant_id = $1 AND o.status = ANY($2) AND o.created_at >= $3 AND o.created_at < $4
        GROUP BY oi.product_sku, p.name
        ORDER BY revenue DESC LIMIT 5`,
      [tenantId, PAID_STATUSES, startIso, endIso]
    ),
    query<any>(
      `SELECT channel, COUNT(*)::int AS order_count, COALESCE(SUM(total_amount), 0) AS revenue
         FROM bms_orders
        WHERE tenant_id = $1 AND status = ANY($2) AND created_at >= $3 AND created_at < $4
        GROUP BY channel ORDER BY revenue DESC`,
      [tenantId, PAID_STATUSES, startIso, endIso]
    ),
  ]);
  return {
    revenue: Number(totals.rows[0]?.revenue ?? 0),
    orderCount: Number(totals.rows[0]?.order_count ?? 0),
    discountTotal: Number(totals.rows[0]?.discount_total ?? 0),
    topProducts: topProducts.rows.map((r) => ({ sku: r.sku, name: r.name, qty: Number(r.qty), revenue: Number(r.revenue) })),
    byChannel: byChannel.rows.map((r) => ({ channel: r.channel, orderCount: Number(r.order_count), revenue: Number(r.revenue) })),
  };
}

// ---------------- content builders ----------------

const baht = (n: number) => `${Number(n).toLocaleString("th-TH")} บาท`;
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function buildEmailHtml(opts: { tenantName: string; themeColor: string; frequency: Frequency; periodLbl: string; summary: SalesSummary }) {
  const { tenantName, themeColor, frequency, periodLbl, summary } = opts;
  const productRows = summary.topProducts
    .map(
      (p) => `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:13px;">${escapeHtml(p.name)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right;">${p.qty}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right;">${baht(p.revenue)}</td>
      </tr>`
    )
    .join("");
  const channelRows = summary.byChannel
    .map(
      (c) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;">${escapeHtml(c.channel)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right;">${c.orderCount}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right;">${baht(c.revenue)}</td>
      </tr>`
    )
    .join("");

  return `<div style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1c2b;">
    <div style="background:${themeColor};padding:22px 24px;border-radius:10px 10px 0 0;">
      <h1 style="color:#fff;margin:0;font-size:18px;">สรุปยอดขาย${FREQ_LABEL_TH[frequency]} — ${escapeHtml(tenantName)}</h1>
      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">${periodLbl}</p>
    </div>
    <div style="border:1px solid #e6e8f0;border-top:none;padding:22px 24px;border-radius:0 0 10px 10px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
        <tr>
          <td style="width:50%;">
            <div style="font-size:26px;font-weight:700;">${baht(summary.revenue)}</div>
            <div style="font-size:12px;color:#666;">ยอดขายรวม</div>
          </td>
          <td style="width:50%;">
            <div style="font-size:26px;font-weight:700;">${summary.orderCount.toLocaleString("th-TH")}</div>
            <div style="font-size:12px;color:#666;">ออเดอร์</div>
          </td>
        </tr>
      </table>
      ${
        summary.topProducts.length
          ? `<h2 style="font-size:14px;margin:0 0 8px;">สินค้าขายดี</h2>
             <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">${productRows}</table>`
          : `<p style="font-size:13px;color:#888;">ไม่มีออเดอร์ในช่วงนี้</p>`
      }
      ${
        summary.byChannel.length
          ? `<h2 style="font-size:14px;margin:0 0 8px;">แยกตามช่องทาง</h2>
             <table style="width:100%;border-collapse:collapse;">${channelRows}</table>`
          : ""
      }
      ${summary.discountTotal > 0 ? `<p style="font-size:12px;color:#888;margin-top:14px;">ส่วนลดที่มอบให้ลูกค้าในช่วงนี้: ${baht(summary.discountTotal)}</p>` : ""}
    </div>
  </div>`;
}

function buildSlackPayload(opts: { tenantName: string; frequency: Frequency; periodLbl: string; summary: SalesSummary }) {
  const { tenantName, frequency, periodLbl, summary } = opts;
  const lines = [
    `*ยอดขายรวม:* ${baht(summary.revenue)}`,
    `*ออเดอร์:* ${summary.orderCount.toLocaleString("th-TH")} รายการ`,
  ];
  if (summary.discountTotal > 0) lines.push(`*ส่วนลดที่มอบให้:* ${baht(summary.discountTotal)}`);
  const topLines = summary.topProducts.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} — ${p.qty} ชิ้น (${baht(p.revenue)})`);

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `📊 สรุปยอดขาย${FREQ_LABEL_TH[frequency]} — ${tenantName}` } },
    { type: "context", elements: [{ type: "mrkdwn", text: periodLbl }] },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];
  if (topLines.length) {
    blocks.push({ type: "divider" }, { type: "section", text: { type: "mrkdwn", text: `*สินค้าขายดี:*\n${topLines.join("\n")}` } });
  }
  return { text: `สรุปยอดขาย${FREQ_LABEL_TH[frequency]} — ${tenantName}`, blocks };
}

function buildLineText(opts: { tenantName: string; frequency: Frequency; periodLbl: string; summary: SalesSummary }) {
  const { tenantName, frequency, periodLbl, summary } = opts;
  const top = summary.topProducts.slice(0, 3).map((p, i) => `${i + 1}. ${p.name} (${p.qty} ชิ้น)`).join("\n");
  return [
    `📊 สรุปยอดขาย${FREQ_LABEL_TH[frequency]} — ${tenantName}`,
    periodLbl,
    "",
    `ยอดขาย: ${baht(summary.revenue)}`,
    `ออเดอร์: ${summary.orderCount.toLocaleString("th-TH")} รายการ`,
    top ? `\nสินค้าขายดี:\n${top}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

// ---------------- subscription CRUD ----------------

export type ReportSubscription = {
  tenantId: string;
  frequency: Frequency;
  sendHour: number;
  sendWeekday: number | null;
  sendDayOfMonth: number | null;
  emailEnabled: boolean;
  recipientEmail: string | null;
  slackEnabled: boolean;
  hasSlackWebhook: boolean;
  lineEnabled: boolean;
  lineUserId: string | null;
  enabled: boolean;
  lastSentAt: string | null;
  lastStatus: string | null;
  lastPeriodKey: string | null;
};

function mapRow(r: any): ReportSubscription {
  return {
    tenantId: r.tenant_id,
    frequency: (r.frequency ?? "DAILY") as Frequency,
    sendHour: r.send_hour ?? 8,
    sendWeekday: r.send_weekday ?? null,
    sendDayOfMonth: r.send_day_of_month ?? null,
    emailEnabled: r.email_enabled ?? false,
    recipientEmail: r.recipient_email ?? null,
    slackEnabled: r.slack_enabled ?? false,
    hasSlackWebhook: !!r.slack_webhook_url,
    lineEnabled: r.line_enabled ?? false,
    lineUserId: r.line_user_id ?? null,
    enabled: r.enabled ?? false,
    lastSentAt: r.last_sent_at instanceof Date ? r.last_sent_at.toISOString() : (r.last_sent_at ?? null),
    lastStatus: r.last_status ?? null,
    lastPeriodKey: r.last_period_key ?? null,
  };
}

export async function getReportSubscription(tenantId: string): Promise<ReportSubscription> {
  const { rows } = await query<any>(`SELECT * FROM bms_report_subscriptions WHERE tenant_id = $1`, [tenantId]);
  return mapRow(rows[0] ?? { tenant_id: tenantId });
}

export type ReportSubscriptionOverview = ReportSubscription & { tenantName: string; tenantSlug: string };

/** cross-tenant — platform admin เท่านั้น (เหมือน listTenants()) */
export async function listReportSubscriptions(): Promise<ReportSubscriptionOverview[]> {
  const { rows } = await query<any>(
    `SELECT t.id AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
            s.frequency, s.send_hour, s.send_weekday, s.send_day_of_month,
            s.email_enabled, s.recipient_email, s.slack_enabled, s.slack_webhook_url,
            s.line_enabled, s.line_user_id, s.enabled, s.last_sent_at, s.last_status, s.last_period_key
       FROM bms_tenants t
       LEFT JOIN bms_report_subscriptions s ON s.tenant_id = t.id
      ORDER BY t.name`
  );
  return rows.map((r) => ({ ...mapRow(r), tenantName: r.tenant_name, tenantSlug: r.tenant_slug }));
}

export type ReportDelivery = {
  id: string;
  frequency: Frequency;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  channel: "EMAIL" | "SLACK" | "LINE";
  status: "SUCCESS" | "FAILED";
  error: string | null;
  createdAt: string;
};

export async function listReportDeliveries(tenantId: string, limit = 50): Promise<ReportDelivery[]> {
  const { rows } = await query<any>(
    `SELECT id, frequency, period_key, period_start, period_end, channel, status, error, created_at
       FROM bms_report_deliveries WHERE tenant_id = $1
      ORDER BY created_at DESC, id DESC LIMIT $2`,
    [tenantId, Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map((r) => ({
    id: String(r.id),
    frequency: r.frequency,
    periodKey: r.period_key,
    periodStart: r.period_start instanceof Date ? r.period_start.toISOString() : r.period_start,
    periodEnd: r.period_end instanceof Date ? r.period_end.toISOString() : r.period_end,
    channel: r.channel,
    status: r.status,
    error: r.error,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));
}

export type UpsertReportSubscriptionInput = {
  frequency?: Frequency;
  sendHour?: number;
  sendWeekday?: number | null;
  sendDayOfMonth?: number | null;
  emailEnabled?: boolean;
  recipientEmail?: string | null;
  slackEnabled?: boolean;
  slackWebhookUrl?: string | null; // undefined = คงเดิม, null/"" = ล้าง, string = ตั้งใหม่
  lineEnabled?: boolean;
  lineUserId?: string | null;
  enabled?: boolean;
};

export async function upsertReportSubscription(tenantId: string, input: UpsertReportSubscriptionInput): Promise<ReportSubscription> {
  const cur = await query<any>(`SELECT * FROM bms_report_subscriptions WHERE tenant_id = $1`, [tenantId]);
  const prev = cur.rows[0];

  const frequency = (input.frequency ?? prev?.frequency ?? "DAILY") as Frequency;
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(frequency)) throw new Error("ความถี่ไม่ถูกต้อง");

  const sendHour = input.sendHour ?? prev?.send_hour ?? 8;
  if (!Number.isInteger(sendHour) || sendHour < 0 || sendHour > 23) throw new Error("เวลาส่งต้องเป็นชั่วโมง 0-23 น.");

  let sendWeekday = input.sendWeekday !== undefined ? input.sendWeekday : (prev?.send_weekday ?? 1);
  let sendDayOfMonth = input.sendDayOfMonth !== undefined ? input.sendDayOfMonth : (prev?.send_day_of_month ?? 1);
  if (frequency === "WEEKLY") {
    if (sendWeekday == null || sendWeekday < 0 || sendWeekday > 6) throw new Error("กรุณาเลือกวันในสัปดาห์ที่จะส่ง");
  } else {
    sendWeekday = null;
  }
  if (frequency === "MONTHLY") {
    if (sendDayOfMonth == null || sendDayOfMonth < 1 || sendDayOfMonth > 28) throw new Error("กรุณาเลือกวันที่ 1-28 ของเดือนที่จะส่ง");
  } else {
    sendDayOfMonth = null;
  }

  const emailEnabled = input.emailEnabled ?? prev?.email_enabled ?? true;
  const recipientEmail = input.recipientEmail !== undefined ? (input.recipientEmail?.trim() || null) : (prev?.recipient_email ?? null);
  if (emailEnabled && !recipientEmail) throw new Error("กรุณาระบุอีเมลผู้รับก่อนเปิดใช้งานช่องทางอีเมล");

  const slackEnabled = input.slackEnabled ?? prev?.slack_enabled ?? false;
  const slackWebhookUrl =
    input.slackWebhookUrl !== undefined
      ? (input.slackWebhookUrl && input.slackWebhookUrl.trim() ? encryptSecret(input.slackWebhookUrl.trim()) : null)
      : (prev?.slack_webhook_url ?? null);
  if (slackEnabled && !slackWebhookUrl) throw new Error("กรุณาระบุ Slack webhook URL ก่อนเปิดใช้งานช่องทาง Slack");

  const lineEnabled = input.lineEnabled ?? prev?.line_enabled ?? false;
  const lineUserId = input.lineUserId !== undefined ? (input.lineUserId?.trim() || null) : (prev?.line_user_id ?? null);
  if (lineEnabled && !lineUserId) throw new Error("กรุณาระบุ LINE user id ก่อนเปิดใช้งานช่องทาง LINE");

  const enabled = input.enabled ?? prev?.enabled ?? false;
  if (enabled && !emailEnabled && !slackEnabled && !lineEnabled) {
    throw new Error("ต้องเปิดอย่างน้อย 1 ช่องทาง (อีเมล/Slack/LINE) ก่อนเปิดใช้งานระบบส่งรายงาน");
  }

  await query(
    `INSERT INTO bms_report_subscriptions
       (tenant_id, frequency, send_hour, send_weekday, send_day_of_month,
        email_enabled, recipient_email, slack_enabled, slack_webhook_url,
        line_enabled, line_user_id, enabled, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       frequency = EXCLUDED.frequency,
       send_hour = EXCLUDED.send_hour,
       send_weekday = EXCLUDED.send_weekday,
       send_day_of_month = EXCLUDED.send_day_of_month,
       email_enabled = EXCLUDED.email_enabled,
       recipient_email = EXCLUDED.recipient_email,
       slack_enabled = EXCLUDED.slack_enabled,
       slack_webhook_url = EXCLUDED.slack_webhook_url,
       line_enabled = EXCLUDED.line_enabled,
       line_user_id = EXCLUDED.line_user_id,
       enabled = EXCLUDED.enabled,
       updated_at = now()`,
    [tenantId, frequency, sendHour, sendWeekday, sendDayOfMonth, emailEnabled, recipientEmail, slackEnabled, slackWebhookUrl, lineEnabled, lineUserId, enabled]
  );

  return getReportSubscription(tenantId);
}

// ---------------- sending ----------------

type ChannelResult = { channel: "EMAIL" | "SLACK" | "LINE"; ok: boolean; error?: string };

async function sendEmailChannel(recipientEmail: string | null, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  if (!recipientEmail) return { ok: false, error: "ไม่ได้ตั้งอีเมลผู้รับ" };
  try {
    await sendEmail({ to: recipientEmail, subject, html });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "ส่งอีเมลไม่สำเร็จ" };
  }
}

async function sendSlackChannel(encryptedWebhookUrl: string | null, payload: any): Promise<{ ok: boolean; error?: string }> {
  const url = decryptSecret(encryptedWebhookUrl);
  if (!url) return { ok: false, error: "ไม่ได้ตั้ง Slack webhook" };
  try {
    const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!resp.ok) return { ok: false, error: `Slack ตอบกลับ ${resp.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "ส่ง Slack ไม่สำเร็จ" };
  }
}

async function sendLineChannel(tenantId: string, lineUserId: string | null, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!lineUserId) return { ok: false, error: "ไม่ได้ตั้ง LINE user id" };
  const cfg = await getChannel(tenantId, "line");
  if (!cfg?.access_token) return { ok: false, error: "ร้านยังไม่ได้เชื่อม LINE OA (ไม่มี access token)" };
  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.access_token}` },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text }] }),
    });
    if (!resp.ok) return { ok: false, error: `LINE push ตอบกลับ ${resp.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "ส่ง LINE ไม่สำเร็จ" };
  }
}

/** ส่งจริง 1 รอบให้ 1 ร้าน — ใช้ทั้ง cron (runScheduledDigests) และปุ่ม "ส่งทดสอบตอนนี้"
 *  isTest=true จะไม่อัปเดต last_sent_at/last_period_key ของ subscription (กันรบกวน schedule จริง)
 *  แต่ยัง log ลง bms_report_deliveries ด้วย period_key คำนำหน้า "TEST:" ให้เห็นในประวัติเหมือนกัน */
export async function sendDigestForTenant(
  tenantId: string,
  frequency: Frequency,
  periodStart: Date,
  periodEnd: Date,
  periodKey: string,
  opts: { isTest?: boolean } = {}
): Promise<{ results: ChannelResult[]; overallStatus: "SUCCESS" | "PARTIAL" | "FAILED" }> {
  const rawSub = await query<any>(`SELECT * FROM bms_report_subscriptions WHERE tenant_id = $1`, [tenantId]);
  const sub = rawSub.rows[0];
  if (!sub) throw new Error("ร้านนี้ยังไม่ได้ตั้งค่าระบบส่งรายงาน");

  const [tenantName, profile, summary] = await Promise.all([
    getTenantName(tenantId),
    getStoreProfile(tenantId),
    computeSalesSummary(tenantId, periodStart, periodEnd),
  ]);
  const name = tenantName || "ร้านค้า";
  const themeColor = profile.emailThemeColor || DEFAULT_EMAIL_THEME_COLOR;
  const periodLbl = periodLabel(frequency, periodStart, periodEnd);
  const suffix = opts.isTest ? " (ทดสอบ)" : "";

  const results: ChannelResult[] = [];
  if (sub.email_enabled) {
    const html = buildEmailHtml({ tenantName: name, themeColor, frequency, periodLbl, summary });
    const r = await sendEmailChannel(sub.recipient_email, `สรุปยอดขาย${FREQ_LABEL_TH[frequency]}${suffix} — ${name}`, html);
    results.push({ channel: "EMAIL", ...r });
  }
  if (sub.slack_enabled) {
    const payload = buildSlackPayload({ tenantName: name, frequency, periodLbl, summary });
    const r = await sendSlackChannel(sub.slack_webhook_url, payload);
    results.push({ channel: "SLACK", ...r });
  }
  if (sub.line_enabled) {
    const text = buildLineText({ tenantName: name, frequency, periodLbl, summary }) + (opts.isTest ? "\n\n(นี่คือข้อความทดสอบ)" : "");
    const r = await sendLineChannel(tenantId, sub.line_user_id, text);
    results.push({ channel: "LINE", ...r });
  }

  const loggedPeriodKey = opts.isTest ? `TEST:${periodKey}` : periodKey;
  for (const r of results) {
    await query(
      `INSERT INTO bms_report_deliveries (tenant_id, frequency, period_key, period_start, period_end, channel, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, frequency, loggedPeriodKey, periodStart.toISOString(), periodEnd.toISOString(), r.channel, r.ok ? "SUCCESS" : "FAILED", r.error ?? null]
    );
  }

  const overallStatus: "SUCCESS" | "PARTIAL" | "FAILED" =
    results.length === 0 ? "FAILED" : results.every((r) => r.ok) ? "SUCCESS" : results.some((r) => r.ok) ? "PARTIAL" : "FAILED";

  if (!opts.isTest) {
    await query(
      `UPDATE bms_report_subscriptions SET last_sent_at = now(), last_period_key = $2, last_status = $3, updated_at = now() WHERE tenant_id = $1`,
      [tenantId, periodKey, overallStatus]
    );
  }

  return { results, overallStatus };
}

/** ทดสอบส่งทันที — ใช้ "24 ชั่วโมงล่าสุด" เป็น period เสมอ (ไม่ผูกกับ frequency/schedule ที่ตั้งไว้
 *  เพื่อให้เห็นข้อมูลจริงของร้านตอนนี้ทันที ไม่ต้องรอรอบจริง) */
export async function sendTestDigest(tenantId: string): Promise<{ results: ChannelResult[]; overallStatus: "SUCCESS" | "PARTIAL" | "FAILED" }> {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 24 * 3600 * 1000);
  return sendDigestForTenant(tenantId, "DAILY", periodStart, periodEnd, "TEST-NOW", { isTest: true });
}

/** cron entrypoint — สแกนทุกร้านที่เปิดใช้งาน ส่งเฉพาะร้านที่ตรงตารางเวลาและยังไม่เคยส่งรอบนี้
 *  ออกแบบให้เรียกถี่แค่ไหนก็ได้ (เช่นทุกชั่วโมง) โดย idempotency มาจาก last_period_key ไม่ใช่ความถี่ cron */
export async function runScheduledDigests(): Promise<{ processed: number; sent: number; results: any[] }> {
  const now = bkkNow();
  const { rows: subs } = await query<any>(
    `SELECT tenant_id, frequency, send_hour, send_weekday, send_day_of_month, last_period_key
       FROM bms_report_subscriptions WHERE enabled = true`
  );
  const out: any[] = [];
  for (const s of subs) {
    const cfg = { frequency: s.frequency as Frequency, sendHour: s.send_hour, sendWeekday: s.send_weekday, sendDayOfMonth: s.send_day_of_month };
    if (!shouldSendNow(cfg, now)) continue;
    const { periodStart, periodEnd, periodKey } = computePeriod(cfg.frequency, now);
    if (s.last_period_key === periodKey) continue; // ส่งไปแล้วรอบนี้
    try {
      const result = await sendDigestForTenant(s.tenant_id, cfg.frequency, periodStart, periodEnd, periodKey);
      out.push({ tenantId: s.tenant_id, periodKey, ...result });
    } catch (err: any) {
      out.push({ tenantId: s.tenant_id, periodKey, error: err?.message || "send failed" });
    }
  }
  return { processed: subs.length, sent: out.length, results: out };
}
