// =============================================================
// BMS daily log triage — collector
// -------------------------------------------------------------
// ดึงรายการ level=error จาก system_logs (24 ชม.ล่าสุด) → จัดกลุ่ม + dedupe
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
import { formatLogReport } from "./report-format.mjs";

const url = process.env.BMS_LOG_DATABASE_URL;
if (!url) {
  console.error("❌ missing BMS_LOG_DATABASE_URL");
  process.exit(1);
}
function boundedInt(raw, fallback, max) {
  const value = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`Invalid log collector limit (must be 1..${max})`);
  }
  return value;
}
const HOURS = boundedInt(process.env.LOG_WINDOW_HOURS, 24, 168);
const MAX_GROUPS = boundedInt(process.env.LOG_MAX_GROUPS, 30, 100);

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
         COALESCE(meta->>'source', 'server') AS source,
         COALESCE(NULLIF(error_message, ''), message) AS msg,
         count(*)::int                                  AS cnt,
         max(created_at)                                AS last_at,
         (array_agg(stack       ORDER BY created_at DESC) FILTER (WHERE stack IS NOT NULL))[1]      AS sample_stack,
         (array_agg(route_name  ORDER BY created_at DESC) FILTER (WHERE route_name IS NOT NULL))[1] AS route
    FROM system_logs
   WHERE created_at >= now() - make_interval(hours => $1)
     AND level = 'error'
   GROUP BY category, source, msg
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

  const md = formatLogReport(rows, { today, hours: HOURS });

  writeFileSync("bms-log-report.md", md);
  setOutput("has_errors=true");
  setOutput(`groups=${rows.length}`);
  console.log(`✅ wrote bms-log-report.md (${rows.length} groups)`);
} catch (e) {
  console.error("collector failed:", e?.code || e?.name || "Error");
  process.exit(1);
}
