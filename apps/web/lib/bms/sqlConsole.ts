// =============================================================
// BMS Dev SQL Console — platform admin only
// -------------------------------------------------------------
// runReadOnlySql(): SELECT/WITH เท่านั้น, บังคับ Postgres-level READ ONLY transaction +
//   statement_timeout + wrap เป็น subquery มี LIMIT เสมอ — ใช้ได้ทุก environment (รวม production)
// runSql(): เขียนได้ (INSERT/UPDATE/DELETE/...) — ปิดใช้งานเสมอเมื่อ NODE_ENV=production
//   ไม่มี env flag ให้เปิดข้าม ต่างจาก fake seeder โดยตั้งใจ (ความเสี่ยงคนละระดับกัน)
//
// คำเตือน: แม้ read-only-mode "ปลอดภัยที่สุดเท่าที่จะเป็นไปได้" สำหรับ tool ประเภทนี้ ก็ยังคืนข้อมูล
// ข้าม tenant ได้ทั้งหมด (query() ไม่ผ่าน RLS session var) — ต้องเป็น platform admin เท่านั้น (เช็คที่
// resolver ผ่าน requirePlatformAdmin()) และทุก query ถูก audit เต็มข้อความเสมอ (ข้อยกเว้นจงใจจาก
// "ไม่เก็บ raw args" ปกติของ audit log — ความรับผิดชอบสำคัญกว่าตรงนี้)
// =============================================================

import { getClient } from "@/lib/db";

export type SqlConsoleResult = {
  ok: boolean;
  columns: string[];
  rows: unknown[];
  rowCount: number;
  durationMs: number;
  error: string | null;
};

const ROW_LIMIT = 200;
const STATEMENT_TIMEOUT_MS = 5000;

const READ_ONLY_BANNED_KEYWORDS = [
  "insert", "update", "delete", "drop", "alter", "truncate", "grant", "revoke",
  "create", "copy", "vacuum", "call", "do", "into", "set", "reindex", "cluster",
  "listen", "notify", "lock", "refresh", "comment", "execute", "dblink",
  "lo_import", "lo_export", "pg_read_file", "pg_write_file",
  "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf",
];

// แม้ write-mode (dev-only) ก็ยังกันคำสั่งระดับทำลายทั้ง cluster/instance ไว้เสมอ
const CATASTROPHIC_KEYWORDS = [
  "dblink", "lo_import", "lo_export", "pg_read_file", "pg_write_file",
  "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf",
  "reindex", "vacuum", "cluster", "grant", "revoke", "dropdb", "createdb",
];

function hasKeyword(sql: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}\\b`, "i").test(sql);
}

/** ตัด ; ท้ายสุดออก + reject หลาย statement/คีย์เวิร์ดอันตราย ก่อนส่งเข้า Postgres จริง */
function cleanAndValidate(sqlRaw: string, opts: { allowWrite: boolean }): string {
  let sql = String(sqlRaw || "").trim();
  if (!sql) throw new Error("กรุณาใส่คำสั่ง SQL");

  sql = sql.replace(/;\s*$/, "");
  if (sql.includes(";")) {
    throw new Error("รองรับคำสั่งเดียวต่อครั้งเท่านั้น (ห้ามมี ; กลางข้อความ — ป้องกัน stacked query)");
  }

  if (!opts.allowWrite) {
    if (!/^(select|with)\b/i.test(sql)) {
      throw new Error("โหมด read-only รับได้เฉพาะคำสั่งที่ขึ้นต้นด้วย SELECT หรือ WITH เท่านั้น");
    }
    for (const kw of READ_ONLY_BANNED_KEYWORDS) {
      if (hasKeyword(sql, kw)) {
        throw new Error(`ห้ามใช้คำสั่ง/คีย์เวิร์ด "${kw.toUpperCase()}" ในโหมด read-only`);
      }
    }
  } else {
    for (const kw of CATASTROPHIC_KEYWORDS) {
      if (hasKeyword(sql, kw)) {
        throw new Error(`ห้ามใช้คำสั่ง/คีย์เวิร์ด "${kw.toUpperCase()}" แม้ใน write-mode (dev)`);
      }
    }
  }
  return sql;
}

/** write-mode (bmsRunSql) ปิดเสมอใน production — ไม่มี env flag ให้เปิดข้าม */
export function sqlConsoleWriteDisabled(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function runReadOnlySql(sqlRaw: string): Promise<SqlConsoleResult> {
  const start = Date.now();
  let sql: string;
  try {
    sql = cleanAndValidate(sqlRaw, { allowWrite: false });
  } catch (err: any) {
    return { ok: false, columns: [], rows: [], rowCount: 0, durationMs: Date.now() - start, error: err.message };
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    // Postgres-level guard สุดท้าย (สำคัญที่สุด) — แม้ regex ข้างบนหลุด ทรานแซกชันนี้เขียนอะไรไม่ได้เลย
    await client.query("SET TRANSACTION READ ONLY");
    // wrap เป็น subquery เสมอ: (1) บังคับ LIMIT ไม่ว่า user จะใส่มาเองหรือไม่ (2) ทำให้ ; ตรงกลาง
    // (ที่หลุด validation มาได้ในทางทฤษฎี) กลายเป็น syntax error แทนที่จะรันหลาย statement จริง
    const wrapped = `SELECT * FROM (${sql}) AS console_query LIMIT ${ROW_LIMIT}`;
    const res = await client.query(wrapped);
    await client.query("ROLLBACK"); // read-only เสมอ — ไม่มีอะไรต้อง commit
    return {
      ok: true,
      columns: (res.fields ?? []).map((f) => f.name),
      rows: res.rows ?? [],
      rowCount: res.rows?.length ?? 0,
      durationMs: Date.now() - start,
      error: null,
    };
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return { ok: false, columns: [], rows: [], rowCount: 0, durationMs: Date.now() - start, error: err.message || "query failed" };
  } finally {
    client.release();
  }
}

export async function runSql(sqlRaw: string): Promise<SqlConsoleResult> {
  const start = Date.now();
  if (sqlConsoleWriteDisabled()) {
    return { ok: false, columns: [], rows: [], rowCount: 0, durationMs: 0, error: "Write mode ปิดใช้งานเมื่อ NODE_ENV=production เสมอ" };
  }

  let sql: string;
  try {
    sql = cleanAndValidate(sqlRaw, { allowWrite: true });
  } catch (err: any) {
    return { ok: false, columns: [], rows: [], rowCount: 0, durationMs: Date.now() - start, error: err.message };
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const res = await client.query(sql);
    await client.query("COMMIT");
    return {
      ok: true,
      columns: (res.fields ?? []).map((f) => f.name),
      rows: res.rows ?? [],
      rowCount: res.rowCount ?? res.rows?.length ?? 0,
      durationMs: Date.now() - start,
      error: null,
    };
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return { ok: false, columns: [], rows: [], rowCount: 0, durationMs: Date.now() - start, error: err.message || "query failed" };
  } finally {
    client.release();
  }
}
