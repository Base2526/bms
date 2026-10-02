import "server-only";
import crypto from "node:crypto";
import { query } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^bmsit_[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PACKAGES = new Set(["pos", "server", "server-pos"]);
const PLATFORMS = new Set(["windows", "linux", "macos", "unknown"]);
const ARCHITECTURES = new Set(["x86", "x64", "arm64", "unknown"]);
const EVENTS = new Set(["INSTALLED", "SEEN", "UPDATED", "UNINSTALLED"]);

export class RetailLocalInstallationError extends Error {
  constructor(message = "invalid_installation_report", readonly status = 400) { super(message); }
}
const text = (value: unknown, limit: number) => {
  if (typeof value !== "string" || value.length < 1 || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new RetailLocalInstallationError();
  }
  return value;
};
const optionalId = (value: unknown) => value === undefined || value === null || value === "" ? null : ID.test(text(value, 128)) ? value as string : (() => { throw new RetailLocalInstallationError(); })();

export async function recordRetailLocalInstallation(raw: unknown, secret: string) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !SECRET.test(secret)) throw new RetailLocalInstallationError("unauthorized", 401);
  const input = raw as Record<string, unknown>;
  const installationId = text(input.installationId, 36).toLowerCase();
  const packageType = text(input.packageType, 16);
  const platform = text(input.platform, 16);
  const architecture = text(input.architecture, 16);
  const event = text(input.event, 16);
  if (input.formatVersion !== 1 || !UUID.test(installationId) || !PACKAGES.has(packageType)
      || !PLATFORMS.has(platform) || !ARCHITECTURES.has(architecture) || !EVENTS.has(event)) {
    throw new RetailLocalInstallationError();
  }
  const occurredAt = new Date(text(input.occurredAt, 40));
  if (!Number.isFinite(occurredAt.getTime()) || Math.abs(Date.now() - occurredAt.getTime()) > 7 * 86400_000) throw new RetailLocalInstallationError();
  const fields = {
    osVersion: text(input.osVersion, 128), platformTarget: text(input.platformTarget, 128),
    releaseVersion: text(input.releaseVersion, 128), agentVersion: text(input.agentVersion, 64),
    tenantReference: optionalId(input.tenantReference), licenseReference: optionalId(input.licenseReference),
  };
  if (!ID.test(fields.platformTarget) || !ID.test(fields.releaseVersion) || !ID.test(fields.agentVersion)) throw new RetailLocalInstallationError();
  const hash = crypto.createHash("sha256").update(secret).digest("hex");
  await query(`INSERT INTO bms_retail_local_installation_registry
      (installation_id,secret_hash,package_type,platform,architecture,os_version,platform_target,
       release_version,agent_version,tenant_reference,license_reference,status,installed_at,last_event)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (installation_id) DO NOTHING`, [installationId, hash, packageType, platform,
    architecture, fields.osVersion, fields.platformTarget, fields.releaseVersion, fields.agentVersion,
    fields.tenantReference, fields.licenseReference, event === "UNINSTALLED" ? "UNINSTALLED" : "ACTIVE", occurredAt, event]);
  const updated = await query(`UPDATE bms_retail_local_installation_registry SET
      package_type=$3,platform=$4,architecture=$5,os_version=$6,platform_target=$7,
      release_version=$8,agent_version=$9,tenant_reference=COALESCE($10,tenant_reference),
      license_reference=COALESCE($11,license_reference),status=$12,last_seen_at=now(),last_event=$13,updated_at=now()
    WHERE installation_id=$1 AND secret_hash=$2 RETURNING installation_id`, [installationId, hash,
    packageType, platform, architecture, fields.osVersion, fields.platformTarget, fields.releaseVersion,
    fields.agentVersion, fields.tenantReference, fields.licenseReference,
    event === "UNINSTALLED" ? "UNINSTALLED" : "ACTIVE", event]);
  if (!updated.rowCount) throw new RetailLocalInstallationError("unauthorized", 401);
  return { ok: true, installationId };
}

export async function listRetailLocalInstallations(params: URLSearchParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  for (const [key, column] of Object.entries({ platform: "platform", architecture: "architecture", packageType: "package_type", releaseVersion: "release_version", status: "status" })) {
    const value = params.get(key);
    if (value) { values.push(value.slice(0, 128)); where.push(`${column}=$${values.length}`); }
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const page = Math.min(10000, Math.max(1, Math.floor(Number(params.get("page")) || 1)));
  const [rows, counts, groups] = await Promise.all([
    query(`SELECT installation_id,package_type,platform,architecture,os_version,platform_target,
        release_version,agent_version,tenant_reference,license_reference,status,installed_at,first_seen_at,last_seen_at,last_event
      FROM bms_retail_local_installation_registry ${filter}
      ORDER BY last_seen_at DESC,installation_id LIMIT 25 OFFSET $${values.length + 1}`,
      [...values, (page - 1) * 25]),
    query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status='ACTIVE')::int AS active,
        count(*) FILTER (WHERE status='ACTIVE' AND last_seen_at >= now()-interval '30 days')::int AS seen_30d,
        count(*) FILTER (WHERE license_reference IS NULL)::int AS unregistered,
        count(*) FILTER (WHERE package_type='pos')::int AS pos,
        count(*) FILTER (WHERE package_type='server')::int AS server,
        count(*) FILTER (WHERE package_type='server-pos')::int AS server_pos
      FROM bms_retail_local_installation_registry ${filter}`, values),
    query(`SELECT platform,architecture,package_type,release_version,count(*)::int AS count
      FROM bms_retail_local_installation_registry ${filter}
      GROUP BY platform,architecture,package_type,release_version
      ORDER BY count(*) DESC,platform,architecture LIMIT 100`, values),
  ]);
  return { installations: rows.rows, counts: counts.rows[0], groups: groups.rows, page };
}
