import "server-only";

import { query } from "@/lib/db";

type SlackLogSignal = {
  level: string;
  action?: string | null;
  category?: string | null;
  message?: string | null;
  error_message?: string | null;
  platform?: string | null;
  app_version?: string | null;
  created_by?: number | null;
  correlation_id?: string | null;
  session_id?: string | null;
};

function buildDedupeKey(s: SlackLogSignal) {
  const action = (s.action || "").trim() || "UNKNOWN_ACTION";
  const platform = (s.platform || "").trim() || "unknown";
  const app = (s.app_version || "").trim() || "unknown";
  return ["critical", action, platform, app].join("::");
}

function isCritical(s: SlackLogSignal) {
  const level = String(s.level || "").toLowerCase();
  if (level !== "error") return false;

  const action = String(s.action || "");
  if (/^AUDIO_/i.test(action)) return true;
  if (/MESSAGE_RENDER_ERROR/i.test(action)) return true;
  if (/UNCAUGHT_ERROR|UNHANDLED_REJECTION/i.test(action)) return true;

  const category = String(s.category || "");
  if (/graphql|network|chat|audio/i.test(category)) return true;

  return false;
}

async function shouldSendSlack(dedupeKey: string, windowSeconds: number) {
  const { rows } = await query<{ last_sent_at: string }>(
    `SELECT last_sent_at
       FROM slack_alert_dedupe
      WHERE dedupe_key = $1
      LIMIT 1`,
    [dedupeKey]
  );

  if (!rows[0]?.last_sent_at) return true;
  const last = new Date(rows[0].last_sent_at).getTime();
  return Date.now() - last > windowSeconds * 1000;
}

async function markSlackSent(dedupeKey: string) {
  await query(
    `INSERT INTO slack_alert_dedupe(dedupe_key, last_sent_at)
     VALUES ($1, now())
     ON CONFLICT (dedupe_key)
     DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at`,
    [dedupeKey]
  );
}

export async function maybeAlertSlackForLog(signal: SlackLogSignal) {
  try {
    const webhook = (process.env.SLACK_WEBHOOK_URL || "").trim();
    if (!webhook) return;
    if (!isCritical(signal)) return;

    const dedupeKey = buildDedupeKey(signal);
    const okToSend = await shouldSendSlack(dedupeKey, 10 * 60);
    if (!okToSend) return;

    // Threshold: only alert if repeated in last 10 minutes.
    const action = (signal.action || "").trim() || null;
    const platform = (signal.platform || "").trim() || null;
    const appVersion = (signal.app_version || "").trim() || null;

    const { rows } = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM system_logs
        WHERE level = 'error'
          AND ($1::text IS NULL OR (action = $1 OR meta->>'action' = $1))
          AND ($2::text IS NULL OR (platform = $2 OR meta->>'platform' = $2))
          AND ($3::text IS NULL OR (app_version = $3 OR meta->>'appVersion' = $3))
          AND created_at > (now() - interval '10 minutes')`,
      [action, platform, appVersion]
    );

    const count = rows?.[0]?.count ?? 0;
    if (count < 3) return;

    const env = process.env.NODE_ENV || "unknown";
    const title = `CRITICAL: ${action || signal.category || "error"} (${platform || "unknown"} v${appVersion || "?"})`;

    const textLines = [
      `*Env:* ${env}`,
      `*Action:* ${action || "-"}`,
      `*Category:* ${signal.category || "-"}`,
      `*Error:* ${(signal.error_message || "").slice(0, 600) || "-"}`,
      `*Message:* ${(signal.message || "").slice(0, 600) || "-"}`,
      `*User:* ${signal.created_by ?? "-"}`,
      `*Correlation:* ${signal.correlation_id || "-"}`,
      `*Session:* ${signal.session_id || "-"}`,
      `*Count (10m):* ${count}`,
    ];

    const payload = {
      text: title,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${title}*\n${textLines.join("\n")}` },
        },
      ],
    };

    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await markSlackSent(dedupeKey);
  } catch (e) {
    console.error("[maybeAlertSlackForLog] failed", e);
  }
}
