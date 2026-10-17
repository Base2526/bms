import "server-only";
import type { PoolClient } from "pg";
import { query, runInTransaction } from "@/lib/db";
import { requirePlatformAdmin } from "./platform";
import { getTenantId } from "./tenant";
import { isSafeTrackingPattern } from "./shippingMaster";
import { isCarrier } from "./carriers/constants";
import { defaultShippingZoneForProvince } from "./shippingZones";

type MasterContext = { admin?: { id?: string; email?: string; tenant_id?: string } };

export type MasterBankInput = {
  id?: string | null; code: string; countryCode?: string | null; nameTh: string; nameEn: string;
  swift?: string | null; active?: boolean | null; sortOrder?: number | null;
  source?: string | null; sourceVersion?: string | null;
};
export type MasterUnitInput = {
  id?: string | null; code: string; countryCode?: string | null; nameTh: string; nameEn: string;
  aliases?: string[] | null; kind: string; baseFactor?: number | null; active?: boolean | null;
  source?: string | null; sourceVersion?: string | null;
};
export type MasterAddressInput = {
  level: string; id?: string | null; code: string; provinceCode?: string | null;
  districtCode?: string | null; nameTh: string; nameEn: string; postcode?: string | null;
  active?: boolean | null; source?: string | null; sourceVersion?: string | null;
};
export type MasterCarrierInput = {
  id?: string | null; code: string; countryCode: string; nameTh: string; nameEn: string;
  trackingUrlTemplate?: string | null; trackingNoPattern?: string | null;
  integrationStatus: string; active?: boolean | null; source?: string | null; sourceVersion?: string | null;
};

const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const code = (value: unknown, max = 20) => clean(value, max).toUpperCase();
const country = (value: unknown) => code(value || "TH", 2);
const source = (value: unknown) => clean(value, 200) || "platform-admin";
const sourceVersion = (value: unknown) => clean(value, 120) || new Date().toISOString().slice(0, 10);

function mapBank(row: any) {
  return { id: row.id, code: row.code, countryCode: row.country_code, nameTh: row.name_th,
    nameEn: row.name_en, swift: row.swift, active: row.active, sortOrder: row.sort_order,
    source: row.source, sourceVersion: row.source_version, updatedAt: row.updated_at };
}
function mapUnit(row: any) {
  return { id: row.id, code: row.code, countryCode: row.country_code, nameTh: row.name_th,
    nameEn: row.name_en, aliases: row.aliases ?? [], kind: row.kind,
    baseFactor: Number(row.base_factor), active: row.active, source: row.source,
    sourceVersion: row.source_version, updatedAt: row.updated_at };
}
function mapAddress(row: any) {
  return { level: row.level, id: row.id, code: row.code, countryCode: row.country_code,
    provinceCode: row.province_code ?? null, districtCode: row.district_code ?? null,
    nameTh: row.name_th, nameEn: row.name_en, postcode: row.postcode ?? null,
    active: row.active, source: row.source, sourceVersion: row.source_version,
    updatedAt: row.updated_at };
}

export async function listMasterBanks(search = "", includeInactive = false) {
  const q = clean(search, 120);
  const result = await query(
    `SELECT * FROM bms_master_banks
      WHERE ($1 = '' OR code ILIKE '%' || $1 || '%' OR name_th ILIKE '%' || $1 || '%'
        OR name_en ILIKE '%' || $1 || '%' OR COALESCE(swift,'') ILIKE '%' || $1 || '%')
        AND ($2 OR active)
      ORDER BY country_code, sort_order, name_th LIMIT 500`, [q, includeInactive]);
  return result.rows.map(mapBank);
}

export async function listMasterUnits(search = "", includeInactive = false) {
  const q = clean(search, 120);
  const result = await query(
    `SELECT * FROM bms_master_units
      WHERE ($1 = '' OR code ILIKE '%' || $1 || '%' OR name_th ILIKE '%' || $1 || '%'
        OR name_en ILIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE '%' || $1 || '%'))
        AND ($2 OR active)
      ORDER BY kind, name_th LIMIT 500`, [q, includeInactive]);
  return result.rows.map(mapUnit);
}

export async function listMasterThaiAddresses(args: {
  search?: string | null; level?: string | null; provinceCode?: string | null; districtCode?: string | null;
  includeInactive?: boolean | null; limit?: number | null;
}) {
  const q = clean(args.search, 120);
  const limit = Math.min(Math.max(Number(args.limit ?? 200), 1), 500);
  const result = await query(
    `SELECT * FROM (
       SELECT 'PROVINCE'::text level, id, code, country_code, NULL::text province_code,
              NULL::text district_code, name_th, name_en, NULL::text postcode,
              active, source, source_version, updated_at
         FROM bms_master_th_provinces
       UNION ALL
       SELECT 'DISTRICT', id, code, country_code, province_code, NULL, name_th, name_en,
              NULL, active, source, source_version, updated_at
         FROM bms_master_th_districts
       UNION ALL
       SELECT 'SUBDISTRICT', id, code, country_code, province_code, district_code,
              name_th, name_en, postcode, active, source, source_version, updated_at
         FROM bms_master_th_subdistricts
     ) address
     WHERE ($1 = '' OR code ILIKE '%' || $1 || '%' OR name_th ILIKE '%' || $1 || '%'
       OR name_en ILIKE '%' || $1 || '%' OR COALESCE(postcode,'') ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR level = $2)
       AND ($3::text IS NULL OR province_code = $3 OR (level = 'PROVINCE' AND code = $3))
       AND ($4::text IS NULL OR district_code = $4 OR (level = 'DISTRICT' AND code = $4))
       AND ($5 OR active)
     ORDER BY level, province_code NULLS FIRST, district_code NULLS FIRST, name_th
     LIMIT $6`, [q, args.level || null, args.provinceCode || null, args.districtCode || null, Boolean(args.includeInactive), limit]);
  return result.rows.map(mapAddress);
}

async function writeAudit(client: PoolClient, ctx: MasterContext, action: string, target: string, meta: object) {
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [getTenantId(ctx), String(ctx.admin?.email || ctx.admin?.id || "system"), action, target, JSON.stringify(meta)]);
}

async function platformWrite<T>(ctx: MasterContext, work: (client: PoolClient) => Promise<T>): Promise<T> {
  await requirePlatformAdmin(ctx);
  const actorId = String(ctx.admin?.id || "");
  if (!actorId) throw new Error("Unauthenticated");
  return (await runInTransaction(actorId, async (client) => {
    // Global writes use the narrow definer functions; audit rows still belong
    // to the authenticated tenant and must run with its RLS context.
    await client.query("SET LOCAL ROLE bms_app");
    await client.query(`SELECT set_config('bms.tenant_id',$1,true)`, [getTenantId(ctx)]);
    return work(client);
  })).result;
}

export async function upsertMasterBank(ctx: MasterContext, input: MasterBankInput) {
  const normalized = {
    id: input.id || null, code: code(input.code, 12), countryCode: country(input.countryCode),
    nameTh: clean(input.nameTh), nameEn: clean(input.nameEn), swift: code(input.swift, 11) || null,
    active: input.active !== false, sortOrder: Math.trunc(Number(input.sortOrder ?? 0)),
    source: source(input.source), sourceVersion: sourceVersion(input.sourceVersion),
  };
  if (!normalized.code || !normalized.nameTh || !normalized.nameEn) throw new Error("BANK_FIELDS_REQUIRED");
  if (!/^[A-Z]{2}$/.test(normalized.countryCode)) throw new Error("COUNTRY_CODE_INVALID");
  if (normalized.swift && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(normalized.swift)) throw new Error("SWIFT_INVALID");
  return platformWrite(ctx, async (client) => {
    const saved = await client.query(
      `SELECT * FROM public.upsert_master_bank($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [normalized.id, normalized.code, normalized.countryCode, normalized.nameTh, normalized.nameEn,
       normalized.swift, normalized.active, normalized.sortOrder, normalized.source, normalized.sourceVersion]);
    await writeAudit(client, ctx, "platform.master_data.bank_upsert", saved.rows[0].id, { code: normalized.code, active: normalized.active });
    return mapBank(saved.rows[0]);
  });
}

export async function upsertMasterUnit(ctx: MasterContext, input: MasterUnitInput) {
  const normalized = {
    id: input.id || null, code: code(input.code, 3), countryCode: country(input.countryCode),
    nameTh: clean(input.nameTh), nameEn: clean(input.nameEn),
    aliases: [...new Set((input.aliases ?? []).map((v) => clean(v, 80)).filter(Boolean))].slice(0, 50),
    kind: code(input.kind, 20), baseFactor: Number(input.baseFactor ?? 1), active: input.active !== false,
    source: source(input.source), sourceVersion: sourceVersion(input.sourceVersion),
  };
  if (!normalized.code || !normalized.nameTh || !normalized.nameEn) throw new Error("UNIT_FIELDS_REQUIRED");
  if (!['COUNT','WEIGHT','VOLUME','LENGTH'].includes(normalized.kind)) throw new Error("UNIT_KIND_INVALID");
  if (!Number.isFinite(normalized.baseFactor) || normalized.baseFactor <= 0) throw new Error("BASE_FACTOR_INVALID");
  return platformWrite(ctx, async (client) => {
    const saved = await client.query(
      `SELECT * FROM public.upsert_master_unit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [normalized.id, normalized.code, normalized.countryCode, normalized.nameTh, normalized.nameEn,
       normalized.aliases, normalized.kind, normalized.baseFactor, normalized.active, normalized.source, normalized.sourceVersion]);
    await writeAudit(client, ctx, "platform.master_data.unit_upsert", saved.rows[0].id, { code: normalized.code, active: normalized.active });
    return mapUnit(saved.rows[0]);
  });
}

export async function upsertMasterThaiAddress(ctx: MasterContext, input: MasterAddressInput) {
  const level = code(input.level, 20);
  if (!['PROVINCE','DISTRICT','SUBDISTRICT'].includes(level)) throw new Error("ADDRESS_LEVEL_INVALID");
  const normalized = {
    id: input.id || null, code: clean(input.code, 20), provinceCode: clean(input.provinceCode, 20) || null,
    districtCode: clean(input.districtCode, 20) || null, nameTh: clean(input.nameTh), nameEn: clean(input.nameEn),
    postcode: clean(input.postcode, 5) || null, active: input.active !== false,
    source: source(input.source), sourceVersion: sourceVersion(input.sourceVersion),
  };
  if (!normalized.code || !normalized.nameTh || !normalized.nameEn) throw new Error("ADDRESS_FIELDS_REQUIRED");
  if (level !== 'PROVINCE' && !normalized.provinceCode) throw new Error("PROVINCE_CODE_REQUIRED");
  if (level === 'SUBDISTRICT' && (!normalized.districtCode || !/^[0-9]{5}$/.test(normalized.postcode || ''))) throw new Error("SUBDISTRICT_FIELDS_INVALID");
  return platformWrite(ctx, async (client) => {
    let saved;
    if (level === 'PROVINCE') {
      saved = await client.query(`SELECT 'PROVINCE'::text level,* FROM public.upsert_master_th_province($1,$2,$3,$4,$5,$6,$7)`, [normalized.id, normalized.code, normalized.nameTh, normalized.nameEn, normalized.active, normalized.source, normalized.sourceVersion]);
      await client.query(
        `SELECT public.ensure_master_province_shipping_zone($1,$2)`,
        [normalized.code, defaultShippingZoneForProvince(normalized.nameTh)]
      );
    } else if (level === 'DISTRICT') {
      saved = await client.query(`SELECT 'DISTRICT'::text level,* FROM public.upsert_master_th_district($1,$2,$3,$4,$5,$6,$7,$8)`, [normalized.id, normalized.code, normalized.provinceCode, normalized.nameTh, normalized.nameEn, normalized.active, normalized.source, normalized.sourceVersion]);
    } else {
      saved = await client.query(`SELECT 'SUBDISTRICT'::text level,* FROM public.upsert_master_th_subdistrict($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [normalized.id, normalized.code, normalized.provinceCode, normalized.districtCode, normalized.nameTh, normalized.nameEn, normalized.postcode, normalized.active, normalized.source, normalized.sourceVersion]);
    }
    await writeAudit(client, ctx, `platform.master_data.${level.toLowerCase()}_upsert`, saved.rows[0].id, { code: normalized.code, active: normalized.active });
    return mapAddress(saved.rows[0]);
  });
}

export async function upsertMasterCarrier(ctx: MasterContext, input: MasterCarrierInput) {
  const normalized = {
    id: input.id || null,
    code: code(input.code, 24),
    countryCode: country(input.countryCode),
    nameTh: clean(input.nameTh),
    nameEn: clean(input.nameEn),
    trackingUrlTemplate: clean(input.trackingUrlTemplate, 2048) || null,
    trackingNoPattern: clean(input.trackingNoPattern, 200) || null,
    integrationStatus: code(input.integrationStatus, 10),
    active: input.active !== false,
    source: source(input.source),
    sourceVersion: sourceVersion(input.sourceVersion),
  };
  if (!isCarrier(normalized.code) || !normalized.nameTh || !normalized.nameEn) throw new Error("CARRIER_FIELDS_INVALID");
  if (!/^[A-Z]{2}$/.test(normalized.countryCode)) throw new Error("COUNTRY_CODE_INVALID");
  if (!['LIVE','MOCK','NONE'].includes(normalized.integrationStatus)) throw new Error("INTEGRATION_STATUS_INVALID");
  if (normalized.trackingUrlTemplate) {
    let url: URL;
    try { url = new URL(normalized.trackingUrlTemplate.replaceAll("{trackingNo}", "TEST")); }
    catch { throw new Error("TRACKING_URL_TEMPLATE_INVALID"); }
    if (url.protocol !== "https:" || !normalized.trackingUrlTemplate.includes("{trackingNo}")) {
      throw new Error("TRACKING_URL_TEMPLATE_INVALID");
    }
  }
  if (!isSafeTrackingPattern(normalized.trackingNoPattern)) throw new Error("TRACKING_PATTERN_UNSAFE");
  return platformWrite(ctx, async (client) => {
    const saved = await client.query(
      `SELECT * FROM public.upsert_master_carrier($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [normalized.id,normalized.code,normalized.countryCode,normalized.nameTh,normalized.nameEn,
       normalized.trackingUrlTemplate,normalized.trackingNoPattern,normalized.integrationStatus,
       normalized.active,normalized.source,normalized.sourceVersion]
    );
    await writeAudit(client, ctx, "platform.master_data.carrier_upsert", saved.rows[0].id, {
      code: normalized.code, active: normalized.active, integrationStatus: normalized.integrationStatus,
    });
    return {
      id: saved.rows[0].id, code: saved.rows[0].code, countryCode: saved.rows[0].country_code,
      nameTh: saved.rows[0].name_th, nameEn: saved.rows[0].name_en,
      trackingUrlTemplate: saved.rows[0].tracking_url_template,
      trackingNoPattern: saved.rows[0].tracking_no_pattern,
      integrationStatus: saved.rows[0].integration_status, active: saved.rows[0].active,
      source: saved.rows[0].source, sourceVersion: saved.rows[0].source_version,
      updatedAt: saved.rows[0].updated_at,
    };
  });
}
