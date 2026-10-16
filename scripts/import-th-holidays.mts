import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

// Operational dependencies are owned by apps/web; resolve from its package even
// when this script is launched at the repository root (which has no package.json).
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Pool } = webRequire("pg") as typeof import("../apps/web/node_modules/pg");

type Holiday = { date: string; nameTh: string; nameEn: string; kind: "PUBLIC" | "BANK" };
type HolidayFile = { year: number; source: string; sourceVersion: string; holidays: Holiday[] };
const argv = process.argv.slice(2);
const fileArg = argv.find((value) => !value.startsWith("--"));
const apply = argv.includes("--apply");
const option = (name: string) => argv.find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1).trim();
const actorId = option("--actor-id");
const auditTenantId = option("--audit-tenant-id");
if (!fileArg) {
  console.error("Usage: npx tsx scripts/import-th-holidays.mts <year.json> [--apply --actor-id=<uuid> --audit-tenant-id=<uuid>]");
  process.exit(2);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (apply && (!actorId || !auditTenantId)) throw new Error("Apply refused: actor-id and audit-tenant-id are required");
if (actorId && !uuid.test(actorId) || auditTenantId && !uuid.test(auditTenantId)) throw new Error("Audit ids must be UUIDs");

const input = JSON.parse(await fs.readFile(path.resolve(fileArg), "utf8")) as HolidayFile;
if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200) throw new Error("year must be 2000..2200");
if (!String(input.source ?? "").trim() || !String(input.sourceVersion ?? "").trim()) throw new Error("source and sourceVersion are required");
if (!Array.isArray(input.holidays) || input.holidays.length === 0) throw new Error("holidays must be a non-empty array");
const seen = new Set<string>();
for (const row of input.holidays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || Number(row.date.slice(0, 4)) !== input.year || Number.isNaN(Date.parse(`${row.date}T00:00:00Z`))) throw new Error(`invalid date: ${row.date}`);
  if (!['PUBLIC','BANK'].includes(row.kind)) throw new Error(`invalid kind: ${row.kind}`);
  if (!String(row.nameTh ?? "").trim() || !String(row.nameEn ?? "").trim()) throw new Error(`missing names: ${row.date}`);
  const key = `${row.date}:${row.kind}`;
  if (seen.has(key)) throw new Error(`duplicate date/kind: ${key}`);
  seen.add(key);
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost", port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "appdb", user: process.env.POSTGRES_USER || "app",
  password: process.env.POSTGRES_PASSWORD || "app", max: 1,
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  if (actorId) {
    await client.query(`SELECT set_config('app.editor_id',$1,true)`, [actorId]);
    await client.query(`SELECT set_config('app.revision_id',$1,true)`, [randomUUID()]);
  }
  for (const row of input.holidays) await client.query(
    `INSERT INTO bms_master_holidays(country_code,holiday_date,name_th,name_en,kind,source,source_version)
     VALUES('TH',$1,$2,$3,$4,$5,$6)
     ON CONFLICT(country_code,holiday_date,kind) DO UPDATE SET name_th=EXCLUDED.name_th,
       name_en=EXCLUDED.name_en,source=EXCLUDED.source,source_version=EXCLUDED.source_version,
       active=TRUE,updated_at=now()`,
    [row.date, row.nameTh.trim(), row.nameEn.trim(), row.kind, input.source.trim(), input.sourceVersion.trim()],
  );
  if (apply) await client.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
     VALUES($1,$2,'platform.master_data.th_holidays_import',$3,$4::jsonb)`,
    [auditTenantId, actorId, String(input.year), JSON.stringify({ source: input.source, sourceVersion: input.sourceVersion, rows: input.holidays.length })],
  );
  const count = (await client.query(`SELECT count(*)::int AS count FROM bms_master_holidays WHERE country_code='TH' AND extract(year FROM holiday_date)=$1`, [input.year])).rows[0].count;
  await client.query(apply ? "COMMIT" : "ROLLBACK");
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", year: input.year, inputRows: input.holidays.length, resultingRows: count }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally { client.release(); await pool.end(); }
