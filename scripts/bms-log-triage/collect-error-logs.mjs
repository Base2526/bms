// =============================================================
// BMS daily log triage — collector
// -------------------------------------------------------------
// ดึง error จาก system_logs (24 ชม.ล่าสุด) → จัดกลุ่ม + dedupe
// → ปิดบัง secret/PII → เขียน bms-log-report.md
// ตั้ง output has_errors ให้ workflow ตัดสินใจว่าจะเรียก AI ต่อไหม
//
// ENV:
//   BMS_LOG_DATABASE_URL  (จำเป็น) — แนะนำ user แบบ READ-ONLY
//   LOG_WINDOW_HOURS      (default 24)
//   LOG_MAX_GROUPS        (default 30)  — คุมขนาด report / ค่า token
// รัน: node scripts/bms-log-triage/collect-error-logs.mjs
// =============================================================

import { writeFileSync, appendFileSync } from "node:fs";
import pg from "pg";

const url = process.env.BMS_LOG_DATABASE_URL;
if (!url) {
  console.error("❌ missing BMS_LOG_DATABASE_URL");
  process.exit(1);
}
const HOURS = Number(process.env.LOG_WINDOW_HOURS || 24);
const MAX_GROUPS = Number(process.env.LOG_MAX_GROUPS || 30);

// ---- redaction (กัน secret/PII หลุดออกไป external) ----------
function redact(input) {
  if (!input) return input;
  return String(input)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "«email»")
    .replace(/\b(?:\+?66|0)\d{8,9}\b/g, "«phone»")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1«token»")
    .replace(/\bsk-[A-Za-z0-9\-]{8,}\b/g, "«api-key»")
    .replace(/\benc:[A-Za-z0-9+/=:]+/g, "«enc»")
    .replace(/\b[0-9a-fA-F]{32,}\b/g, "«hex»")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "«ip»");
}

const setOutput = (line) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line + "\n");
};

const { Pool } = pg;
const pool = new Pool({
  connectionString: url,
  ssl: /sslmode=require|[?&]ssl=true/.test(url) ? { rejectUnauthorized: false } : undefined,
});

const SQL = `
  SELECT category,
         COALESCE(NULLIF(error_message, ''), message) AS msg,
         count(*)::int                                  AS cnt,
         max(created_at)                                AS last_at,
         (array_agg(stack       ORDER BY created_at DESC) FILTER (WHERE stack IS NOT NULL))[1]      AS sample_stack,
         (array_agg(route_name  ORDER BY created_at DESC) FILTER (WHERE route_name IS NOT NULL))[1] AS route
    FROM system_logs
   WHERE created_at >= now() - make_interval(hours => $1)
     AND (level = 'error' OR status = 'error')
   GROUP BY category, msg
   ORDER BY cnt DESC
   LIMIT $2`;

try {
  const { rows } = await pool.query(SQL, [HOURS, MAX_GROUPS]);
  await pool.end();

  const today = new Date().toISOString().slice(0, 10);

  if (rows.length === 0) {
    writeFileSync("bms-log-report.md", `# BMS Log Triage — ${today}\n\nไม่พบ error ใน ${HOURS} ชม.ล่าสุด ✅\n`);
    setOutput("has_errors=false");
    setOutput("groups=0");
    console.log("✅ no errors in window");
    process.exit(0);
  }

  let md = `# BMS Log Triage — ${today}\n\n`;
  md += `ช่วง: ${HOURS} ชม.ล่าสุด · กลุ่ม error: **${rows.length}** · redacted แล้ว\n\n`;
  rows.forEach((r, i) => {
    md += `## ${i + 1}. [${r.category}] ${redact(r.msg)}\n`;
    md += `- เกิด **${r.cnt}** ครั้ง · ล่าสุด ${new Date(r.last_at).toISOString()}`;
    md += r.route ? ` · route \`${redact(r.route)}\`\n` : `\n`;
    if (r.sample_stack) {
      const stack = redact(r.sample_stack).split("\n").slice(0, 20).join("\n");
      md += "\n```\n" + stack + "\n```\n";
    }
    md += "\n";
  });

  writeFileSync("bms-log-report.md", md);
  setOutput("has_errors=true");
  setOutput(`groups=${rows.length}`);
  console.log(`✅ wrote bms-log-report.md (${rows.length} groups)`);
} catch (e) {
  console.error("❌ collector failed:", e?.message || e);
  process.exit(1);
}
