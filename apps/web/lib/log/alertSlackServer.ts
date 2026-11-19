import "server-only";

import crypto from "crypto";
import { query } from "@/lib/db";
import { sanitizeLogValue } from "./sanitize";

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
  const fingerprint = [s.action, s.category, s.error_message || s.message, s.platform, s.app_version]
    .map((value) => String(value ?? "")).join("\u0000");
  return `critical::${crypto.createHash("sha256").update(fingerprint).digest("hex")}`;
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

async function claimSlackAlert(dedupeKey: string): Promise<string | null> {
  const { rows } = await query<{ last_sent_at: string }>(
    `INSERT INTO slack_alert_dedupe(dedupe_key, last_sent_at)
     VALUES ($1, now())
     ON CONFLICT (dedupe_key)
     DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at
       WHERE slack_alert_dedupe.last_sent_at < now() - interval '10 minutes'
     RETURNING last_sent_at`,
    [dedupeKey]
  );
  return rows[0]?.last_sent_at ?? null;
}

async function releaseSlackAlert(dedupeKey: string, claimedAt: string) {
  await query(
    `DELETE FROM slack_alert_dedupe WHERE dedupe_key = $1 AND last_sent_at = $2::timestamptz`,
    [dedupeKey, claimedAt]
  );
}

export async function maybeAlertSlackForLog(signal: SlackLogSignal) {
  try {
    const webhook = (process.env.SLACK_WEBHOOK_URL || "").trim();
    if (!webhook) return;
    if (!isCritical(signal)) return;

    // Threshold: only alert if repeated in last 10 minutes.
    const action = (signal.action || "").trim() || null;
    const category = (signal.category || "").trim();
    const diagnostic = signal.error_message || signal.message || "";
    const platform = (signal.platform || "").trim() || null;
    const appVersion = (signal.app_version || "").trim() || null;

    const { rows } = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM system_logs
        WHERE level = 'error'
          AND category = $1
          AND COALESCE(NULLIF(error_message, ''), message) = $2
          AND ($3::text IS NULL OR (action = $3 OR meta->>'action' = $3))
          AND ($4::text IS NULL OR (platform = $4 OR meta->>'platform' = $4))
          AND ($5::text IS NULL OR (app_version = $5 OR meta->>'appVersion' = $5))
          AND created_at > (now() - interval '10 minutes')`,
      [category, diagnostic, action, platform, appVersion]
    );

    const count = rows?.[0]?.count ?? 0;
    if (count < 3) return;
    const dedupeKey = buildDedupeKey(signal);
    const claimedAt = await claimSlackAlert(dedupeKey);
    if (!claimedAt) return;

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

    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Slack webhook returned HTTP ${response.status}`);
    } catch (error) {
      await releaseSlackAlert(dedupeKey, claimedAt);
      throw error;
    }
  } catch (e) {
    console.error("[maybeAlertSlackForLog] failed", sanitizeLogValue(e));
  }
}
