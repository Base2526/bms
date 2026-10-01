import { query } from "@/lib/db";
import { InstallerReportError, normalizeInstallerReport, redactInstallerText, unpackInstallerReport } from "./installerReportFormat";

export async function submitInstallerReport(body: Buffer) {
  const { report, fingerprint, contentHash } = normalizeInstallerReport(await unpackInstallerReport(body));
  const result = await query<{ id: string }>(`INSERT INTO bms_installer_reports
    (content_hash,fingerprint,platform,architecture,product,installer_version,os_version,stage,report)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    ON CONFLICT (content_hash) DO UPDATE SET content_hash=EXCLUDED.content_hash RETURNING id`,
    [contentHash, fingerprint, report.platform, report.architecture, report.product, report.installerVersion, report.osVersion, report.stage, JSON.stringify(report)]);
  return { reportId: result.rows[0].id };
}

export async function listInstallerReports(params: URLSearchParams) {
  const values: unknown[] = [];
  const where = ["expires_at > now()"];
  for (const [key, column] of Object.entries({ platform: "platform", architecture: "architecture", product: "product", version: "installer_version", osVersion: "os_version", stage: "stage", status: "status", fingerprint: "fingerprint" })) {
    const value = params.get(key);
    if (value) { values.push(value.slice(0, 128)); where.push(`${column}=$${values.length}`); }
  }
  const search = params.get("q")?.trim();
  if (search) {
    values.push(`%${search.slice(0, 128).replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(id::text ILIKE $${values.length} OR report->'failure'->>'message' ILIKE $${values.length})`);
  }
  for (const key of ["from", "to"]) {
    const date = params.get(key);
    if (date) {
      const parsed = Date.parse(date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000-") || !Number.isFinite(parsed)
          || new Date(parsed).toISOString().slice(0, 10) !== date) throw new InstallerReportError("invalid_date");
      values.push(date);
      where.push(key === "from" ? `received_at >= $${values.length}::date` : `received_at < $${values.length}::date + interval '1 day'`);
    }
  }
  if (params.get("from") && params.get("to") && params.get("from")! > params.get("to")!) throw new InstallerReportError("invalid_date");
  const page = Math.min(10000, Math.max(1, Number(params.get("page")) || 1));
  const filter = where.join(" AND ");
  const [rows, counts, groups, facets] = await Promise.all([
    query(`SELECT id,received_at,platform,architecture,product,installer_version,os_version,stage,status,revision,fingerprint,
      report->'failure'->>'message' AS message FROM bms_installer_reports WHERE ${filter}
      ORDER BY received_at DESC,id LIMIT 25 OFFSET $${values.length + 1}`, [...values, (Math.floor(page) - 1) * 25]),
    query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='NEW')::int AS new,
      count(*) FILTER (WHERE status='INVESTIGATING')::int AS investigating, count(*) FILTER (WHERE status='RESOLVED')::int AS resolved
      FROM bms_installer_reports WHERE ${filter}`, values),
    query(`SELECT fingerprint,platform,architecture,product,installer_version,stage,count(*)::int AS count,
      max(received_at) AS last_seen FROM bms_installer_reports WHERE ${filter}
      GROUP BY fingerprint,platform,architecture,product,installer_version,stage ORDER BY count(*) DESC,max(received_at) DESC LIMIT 10`, values),
    query(`SELECT DISTINCT installer_version,os_version,stage FROM bms_installer_reports WHERE expires_at>now()
      ORDER BY installer_version DESC LIMIT 200`),
  ]);
  return { reports: rows.rows, counts: counts.rows[0], groups: groups.rows, facets: facets.rows, page: Math.floor(page) };
}

function validId(id: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new InstallerReportError("not_found", 404); }
export async function getInstallerReport(id: string) {
  validId(id);
  const result = await query("SELECT * FROM bms_installer_reports WHERE id=$1 AND expires_at>now()", [id]);
  if (!result.rows[0]) throw new InstallerReportError("not_found", 404);
  const { content_hash: _, ...report } = result.rows[0];
  return report;
}
export async function updateInstallerReport(id: string, input: any, adminId: string) {
  validId(id);
  if (!input || !["NEW", "INVESTIGATING", "RESOLVED"].includes(input.status) || typeof input.note !== "string"
      || input.note.length > 2048 || !Number.isInteger(input.revision)) throw new InstallerReportError();
  const result = await query(`UPDATE bms_installer_reports SET status=$2,note=$3,revision=revision+1,updated_at=now(),updated_by=$4
    WHERE id=$1 AND revision=$5 AND expires_at>now() RETURNING id`, [id, input.status, redactInstallerText(input.note), adminId, input.revision]);
  if (!result.rows.length) throw new InstallerReportError("report_changed_reload", 409);
  return getInstallerReport(id);
}
export async function purgeExpiredInstallerReports() {
  const result = await query(`DELETE FROM bms_installer_reports WHERE id IN
    (SELECT id FROM bms_installer_reports WHERE expires_at<=now() ORDER BY expires_at LIMIT 1000)`);
  return result.rowCount || 0;
}
