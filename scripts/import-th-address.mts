import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { defaultShippingZoneForProvince } from "../apps/web/lib/bms/shippingZones.ts";

type Province = { code: string; nameTh: string; nameEn: string };
type District = Province & { provinceCode: string };
type Subdistrict = District & { districtCode: string; postcode: string };
type AddressFile = {
  source: string;
  sourceVersion: string;
  license: string;
  provinces: Province[];
  districts: District[];
  subdistricts: Subdistrict[];
};

const argv = process.argv.slice(2);
const args = new Set(argv);
const apply = args.has("--apply");
const option = (name: string) => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1).trim();
const actorId = option("--actor-id");
const auditTenantId = option("--audit-tenant-id");
const fileArg = argv.find((value) => !value.startsWith("--"));
if (!fileArg) {
  console.error("Usage: npx tsx scripts/import-th-address.mts <file.json> [--apply --actor-id=<uuid> --audit-tenant-id=<uuid>]");
  process.exit(2);
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (apply && (!actorId || !auditTenantId)) {
  throw new Error("Apply refused: --actor-id and --audit-tenant-id are required for the audit record");
}
if ((actorId && !uuidPattern.test(actorId)) || (auditTenantId && !uuidPattern.test(auditTenantId))) {
  throw new Error("actor-id and audit-tenant-id must be UUIDs");
}

const trim = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const required = (value: unknown, field: string, max = 200) => {
  const result = trim(value, max);
  if (!result) throw new Error(`${field} is required`);
  return result;
};

const raw = JSON.parse(await fs.readFile(path.resolve(fileArg), "utf8")) as AddressFile;
const provenance = {
  source: required(raw.source, "source"),
  sourceVersion: required(raw.sourceVersion, "sourceVersion", 120),
  license: required(raw.license, "license"),
};
if (/unknown|unspecified|tbd/i.test(provenance.license)) {
  throw new Error("Import refused: confirm the dataset licence and record it in the input file first");
}
if (!Array.isArray(raw.provinces) || !Array.isArray(raw.districts) || !Array.isArray(raw.subdistricts)) {
  throw new Error("provinces, districts and subdistricts must be arrays");
}

const unique = <T extends { code: string }>(rows: T[], label: string) => {
  const codes = new Set<string>();
  for (const row of rows) {
    row.code = required(row.code, `${label}.code`, 20);
    row.nameTh = required(row.nameTh, `${label}.nameTh`);
    row.nameEn = required(row.nameEn, `${label}.nameEn`);
    if (codes.has(row.code)) throw new Error(`duplicate ${label} code: ${row.code}`);
    codes.add(row.code);
  }
  return codes;
};
const provinceCodes = unique(raw.provinces, "province");
const districtCodes = unique(raw.districts, "district");
unique(raw.subdistricts, "subdistrict");
for (const row of raw.districts) {
  row.provinceCode = required(row.provinceCode, "district.provinceCode", 20);
  if (!provinceCodes.has(row.provinceCode)) throw new Error(`unknown province ${row.provinceCode} for district ${row.code}`);
}
for (const row of raw.subdistricts) {
  row.provinceCode = required(row.provinceCode, "subdistrict.provinceCode", 20);
  row.districtCode = required(row.districtCode, "subdistrict.districtCode", 20);
  row.postcode = required(row.postcode, "subdistrict.postcode", 5);
  if (!provinceCodes.has(row.provinceCode) || !districtCodes.has(row.districtCode)) throw new Error(`invalid hierarchy for subdistrict ${row.code}`);
  if (!/^[0-9]{5}$/.test(row.postcode)) throw new Error(`invalid postcode for subdistrict ${row.code}`);
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "appdb",
  user: process.env.POSTGRES_USER || "app",
  password: process.env.POSTGRES_PASSWORD || "app",
  max: 1,
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  if (actorId) {
    await client.query(`SELECT set_config('app.editor_id', $1, true)`, [actorId]);
    await client.query(`SELECT set_config('app.revision_id', $1, true)`, [randomUUID()]);
  }
  for (const row of raw.provinces) await client.query(
    `INSERT INTO bms_master_th_provinces (code,name_th,name_en,source,source_version)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT(code) DO UPDATE SET name_th=EXCLUDED.name_th,
       name_en=EXCLUDED.name_en,source=EXCLUDED.source,source_version=EXCLUDED.source_version,
       active=TRUE,updated_at=now()`, [row.code,row.nameTh,row.nameEn,provenance.source,provenance.sourceVersion]);
  for (const row of raw.provinces) await client.query(
    `INSERT INTO bms_master_th_shipping_zones (province_code,zone,source,source_version)
     VALUES($1,$2,'BMS legacy shipping-zone parity','pre-10.78')
     ON CONFLICT(province_code) DO NOTHING`,
    [row.code, defaultShippingZoneForProvince(row.nameTh)]);
  for (const row of raw.districts) await client.query(
    `INSERT INTO bms_master_th_districts (code,province_code,name_th,name_en,source,source_version)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(code) DO UPDATE SET province_code=EXCLUDED.province_code,
       name_th=EXCLUDED.name_th,name_en=EXCLUDED.name_en,source=EXCLUDED.source,
       source_version=EXCLUDED.source_version,active=TRUE,updated_at=now()`,
    [row.code,row.provinceCode,row.nameTh,row.nameEn,provenance.source,provenance.sourceVersion]);
  for (const row of raw.subdistricts) await client.query(
    `INSERT INTO bms_master_th_subdistricts
       (code,province_code,district_code,name_th,name_en,postcode,source,source_version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(code) DO UPDATE SET
       province_code=EXCLUDED.province_code,district_code=EXCLUDED.district_code,
       name_th=EXCLUDED.name_th,name_en=EXCLUDED.name_en,postcode=EXCLUDED.postcode,
       source=EXCLUDED.source,source_version=EXCLUDED.source_version,active=TRUE,updated_at=now()`,
    [row.code,row.provinceCode,row.districtCode,row.nameTh,row.nameEn,row.postcode,provenance.source,provenance.sourceVersion]);

  const counts = await client.query(`SELECT
    (SELECT count(*)::int FROM bms_master_th_provinces) provinces,
    (SELECT count(*)::int FROM bms_master_th_districts) districts,
    (SELECT count(*)::int FROM bms_master_th_subdistricts) subdistricts`);
  if (apply) {
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'platform.master_data.th_address_import', $3, $4::jsonb)`,
      [auditTenantId, actorId, provenance.sourceVersion, JSON.stringify({
        source: provenance.source,
        sourceVersion: provenance.sourceVersion,
        license: provenance.license,
        provinces: raw.provinces.length,
        districts: raw.districts.length,
        subdistricts: raw.subdistricts.length,
      })],
    );
  }
  if (apply) await client.query("COMMIT"); else await client.query("ROLLBACK");
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", provenance, input: {
    provinces: raw.provinces.length, districts: raw.districts.length, subdistricts: raw.subdistricts.length,
  }, resultingCounts: counts.rows[0] }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
