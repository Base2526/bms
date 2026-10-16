import "server-only";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { isShippingZone, zoneForProvince, type ShippingZone } from "./shippingZones";
import { CARRIER_LABELS, isCarrier, type Carrier } from "./carriers/constants";

export type CarrierIntegrationStatus = "LIVE" | "MOCK" | "NONE";

export type MasterCarrier = {
  id: string;
  code: Carrier;
  countryCode: string;
  nameTh: string;
  nameEn: string;
  trackingUrlTemplate: string | null;
  trackingNoPattern: string | null;
  integrationStatus: CarrierIntegrationStatus;
  active: boolean;
  source: string;
  sourceVersion: string;
  updatedAt: string;
};

const mapCarrier = (row: any): MasterCarrier => ({
  id: row.id,
  code: row.code,
  countryCode: row.country_code,
  nameTh: row.name_th,
  nameEn: row.name_en,
  trackingUrlTemplate: row.tracking_url_template ?? null,
  trackingNoPattern: row.tracking_no_pattern ?? null,
  integrationStatus: row.integration_status,
  active: Boolean(row.active),
  source: row.source,
  sourceVersion: row.source_version,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
});

export async function listMasterCarriers(includeInactive = false): Promise<MasterCarrier[]> {
  const result = await query(
    `SELECT * FROM bms_master_carriers
      WHERE ($1 OR active)
      ORDER BY country_code, name_en, code`,
    [includeInactive]
  );
  return result.rows.filter((row) => isCarrier(row.code)).map(mapCarrier);
}

export async function getMasterCarrier(code: Carrier, includeInactive = false): Promise<MasterCarrier | null> {
  const result = await query(
    `SELECT * FROM bms_master_carriers WHERE code = $1 AND ($2 OR active)`,
    [code, includeInactive]
  );
  return result.rowCount ? mapCarrier(result.rows[0]) : null;
}

export function isSafeTrackingPattern(pattern: string | null | undefined): boolean {
  if (!pattern) return true;
  if (pattern.length > 200) return false;
  // Deliberately excludes grouping, alternation and lookarounds, preventing
  // catastrophic nested expressions while retaining ordinary carrier formats.
  return /^[A-Za-z0-9^$\[\]{}.,+?*\\d\\s_-]+$/.test(pattern);
}

export function buildTrackingSnapshot(
  carrier: Pick<MasterCarrier, "nameTh" | "trackingUrlTemplate" | "trackingNoPattern"> | null,
  code: Carrier,
  trackingNo?: string | null
): { carrierName: string; trackingUrl: string | null; trackingNoWarning: string | null } {
  const number = trackingNo?.trim() || null;
  const carrierName = carrier?.nameTh || CARRIER_LABELS[code];
  let trackingUrl: string | null = null;
  if (number && carrier?.trackingUrlTemplate) {
    const candidate = carrier.trackingUrlTemplate.replaceAll("{trackingNo}", encodeURIComponent(number));
    try {
      const parsed = new URL(candidate);
      trackingUrl = parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      trackingUrl = null;
    }
  }
  let trackingNoWarning: string | null = null;
  if (number && carrier?.trackingNoPattern && isSafeTrackingPattern(carrier.trackingNoPattern)) {
    try {
      if (!new RegExp(carrier.trackingNoPattern).test(number.slice(0, 200))) {
        trackingNoWarning = "TRACKING_NUMBER_FORMAT_MISMATCH";
      }
    } catch {
      trackingNoWarning = "TRACKING_PATTERN_INVALID";
    }
  }
  return { carrierName, trackingUrl, trackingNoWarning };
}

export async function resolveShippingZone(args: {
  tenantId: string;
  provinceCode?: string | null;
  province?: string | null;
}): Promise<ShippingZone | null> {
  const provinceCode = args.provinceCode?.trim() || null;
  if (!provinceCode) return zoneForProvince(args.province);
  const result = await query<{ zone: string }>(
    `SELECT COALESCE(o.zone, d.zone) AS zone
       FROM bms_master_th_shipping_zones d
       LEFT JOIN bms_shipping_zone_overrides o
         ON o.tenant_id = $1 AND o.province_code = d.province_code
      WHERE d.province_code = $2`,
    [args.tenantId, provinceCode]
  );
  const zone = result.rows[0]?.zone;
  // A stale/unknown code must not silently become upcountry. Legacy name
  // fallback is retained only to keep pre-master-data addresses compatible.
  return isShippingZone(zone) ? zone : zoneForProvince(args.province);
}

export async function listShippingZoneOverrides(tenantId: string) {
  const result = await query(
    `SELECT d.province_code, p.name_th, p.name_en, d.zone AS default_zone,
            o.zone AS override_zone, COALESCE(o.zone, d.zone) AS effective_zone
       FROM bms_master_th_shipping_zones d
       JOIN bms_master_th_provinces p ON p.code = d.province_code
       LEFT JOIN bms_shipping_zone_overrides o
         ON o.tenant_id = $1 AND o.province_code = d.province_code
      WHERE p.active
      ORDER BY p.name_th`,
    [tenantId]
  );
  return result.rows.map((row) => ({
    provinceCode: row.province_code,
    nameTh: row.name_th,
    nameEn: row.name_en,
    defaultZone: row.default_zone,
    overrideZone: row.override_zone ?? null,
    effectiveZone: row.effective_zone,
  }));
}

export async function setShippingZoneOverride(args: {
  tenantId: string;
  provinceCode: string;
  zone?: ShippingZone | null;
  actorId: string;
  actor: string;
}): Promise<boolean> {
  const provinceCode = args.provinceCode.trim().slice(0, 20);
  if (!provinceCode || (args.zone != null && !isShippingZone(args.zone))) return false;
  const client = await getClient();
  try {
    await beginTenantTx(client, args.tenantId, { editorId: args.actorId });
    const exists = await client.query(
      `SELECT 1 FROM bms_master_th_shipping_zones WHERE province_code = $1`,
      [provinceCode]
    );
    if (exists.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    if (args.zone == null) {
      await client.query(
        `DELETE FROM bms_shipping_zone_overrides WHERE tenant_id = $1 AND province_code = $2`,
        [args.tenantId, provinceCode]
      );
    } else {
      await client.query(
        `INSERT INTO bms_shipping_zone_overrides (tenant_id,province_code,zone)
         VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id,province_code) DO UPDATE
           SET zone=EXCLUDED.zone,updated_at=now()`,
        [args.tenantId, provinceCode, args.zone]
      );
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
       VALUES ($1,$2,'shipping.zone_override',$3,$4::jsonb)`,
      [args.tenantId, args.actor, provinceCode, JSON.stringify({ zone: args.zone ?? null })]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
