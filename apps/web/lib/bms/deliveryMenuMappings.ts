import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAPPING_KINDS = new Set(["ITEM", "VARIANT", "MODIFIER"]);
const MAPPING_STATUSES = new Set(["UNMAPPED", "SUGGESTED", "VERIFIED", "STALE", "DISABLED"]);

function requiredText(value: unknown, max = 500) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max) throw new Error("DELIVERY_MAPPING_TEXT_INVALID");
  return text;
}

function optionalText(value: unknown, max = 500) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
}

export async function listDeliveryMappings(tenantId: string, integrationId?: string | null) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const locations = await client.query<any>(
    `SELECT lm.id, lm.integration_id, i.provider, i.environment, lm.provider_store_id,
            lm.provider_store_name, lm.location_id, l.name AS location_name, lm.active,
            lm.timezone, lm.last_synced_at
       FROM bms_delivery_location_mappings lm
       JOIN bms_delivery_integrations i ON i.tenant_id = lm.tenant_id AND i.id = lm.integration_id
       JOIN bms_locations l ON l.tenant_id = lm.tenant_id AND l.id = lm.location_id
      WHERE lm.tenant_id = $1 AND ($2::uuid IS NULL OR lm.integration_id = $2)
      ORDER BY i.provider, l.name, lm.provider_store_id`,
    [tenantId, integrationId || null],
  );
    const menus = await client.query<any>(
    `SELECT mm.id, mm.integration_id, mm.location_mapping_id, mm.mapping_kind,
            mm.provider_item_id, mm.provider_variant_id, mm.provider_modifier_id,
            mm.product_sku, mm.size, mm.modifier_code, mm.provider_name_snapshot,
            mm.provider_price_snapshot, mm.mapping_status, mm.verified_at,
            mm.provider_catalog_version, mm.last_synced_at
       FROM bms_delivery_menu_mappings mm
      WHERE mm.tenant_id = $1 AND ($2::uuid IS NULL OR mm.integration_id = $2)
      ORDER BY mm.location_mapping_id, mm.provider_name_snapshot, mm.provider_item_id`,
    [tenantId, integrationId || null],
  );
    const availableLocations = await client.query<any>(
      `SELECT id,code,name FROM bms_locations WHERE tenant_id=$1 AND active ORDER BY name,code`,
      [tenantId],
    );
    const catalog = await client.query<any>(
      `SELECT p.sku,p.name,v.code AS size,COALESCE(v.display_name,v.code) AS variant_name,
              COALESCE(array_agg(DISTINCT m.code ORDER BY m.code)
                FILTER (WHERE m.code IS NOT NULL AND m.active),'{}') AS modifier_codes
         FROM bms_products p
         JOIN bms_product_variants v ON v.tenant_id=p.tenant_id AND v.product_sku=p.sku AND v.active
         JOIN bms_product_sales_surfaces s ON s.tenant_id=p.tenant_id AND s.product_sku=p.sku
                                           AND s.surface='ONLINE_ORDER' AND s.enabled
         LEFT JOIN bms_product_modifiers m ON m.tenant_id=p.tenant_id AND m.product_sku=p.sku AND m.size=v.code
        WHERE p.tenant_id=$1 AND p.active
        GROUP BY p.sku,p.name,v.code,v.display_name,v.sort_order
        ORDER BY p.name,p.sku,v.sort_order,v.code`,
      [tenantId],
    );
    await client.query("COMMIT");
    return { locations: locations.rows, menus: menus.rows, availableLocations: availableLocations.rows, catalog: catalog.rows };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function upsertDeliveryLocationMapping(input: {
  tenantId: string; actorUserId: string; id?: string | null; integrationId: string;
  locationId: string; providerStoreId: unknown; providerStoreName?: unknown;
  timezone?: unknown; active: boolean;
}) {
  if (![input.integrationId, input.locationId].every((id) => UUID_RE.test(id)) || (input.id && !UUID_RE.test(input.id))) {
    throw new Error("DELIVERY_MAPPING_ID_INVALID");
  }
  const storeId = requiredText(input.providerStoreId, 500);
  const storeName = optionalText(input.providerStoreName, 500);
  const timezone = optionalText(input.timezone, 100) ?? "Asia/Bangkok";
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { throw new Error("DELIVERY_TIMEZONE_INVALID"); }
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const scope = await client.query(
      `SELECT 1 FROM bms_delivery_integrations i
        JOIN bms_locations l ON l.tenant_id = i.tenant_id
       WHERE i.tenant_id = $1 AND i.id = $2 AND l.id = $3
       FOR SHARE OF i, l`,
      [input.tenantId, input.integrationId, input.locationId],
    );
    if (!scope.rowCount) throw new Error("DELIVERY_MAPPING_SCOPE_INVALID");
    const saved = await client.query<{ id: string }>(
      `INSERT INTO bms_delivery_location_mappings
         (id, tenant_id, integration_id, provider_store_id, provider_store_name, location_id, active, timezone)
       VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, integration_id, provider_store_id) DO UPDATE SET
         provider_store_name = EXCLUDED.provider_store_name, location_id = EXCLUDED.location_id,
         active = EXCLUDED.active, timezone = EXCLUDED.timezone, updated_at = now()
       RETURNING id`,
      [input.id ?? null, input.tenantId, input.integrationId, storeId, storeName, input.locationId, input.active, timezone],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'delivery.location_mapping_saved',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, saved.rows[0].id,
        JSON.stringify({ integrationId: input.integrationId, locationId: input.locationId, active: input.active })],
    );
    await client.query("COMMIT");
    return { id: saved.rows[0].id };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function upsertDeliveryMenuMapping(input: {
  tenantId: string; actorUserId: string; id?: string | null; integrationId: string;
  locationMappingId: string; mappingKind: unknown; providerItemId: unknown;
  providerVariantId?: unknown; providerModifierId?: unknown; providerName: unknown;
  providerPrice?: unknown; productSku?: unknown; size?: unknown; modifierCode?: unknown;
  mappingStatus: unknown; providerCatalogVersion?: unknown;
}) {
  if (![input.integrationId, input.locationMappingId].every((id) => UUID_RE.test(id)) || (input.id && !UUID_RE.test(input.id))) {
    throw new Error("DELIVERY_MAPPING_ID_INVALID");
  }
  const mappingKind = String(input.mappingKind ?? "").toUpperCase();
  const mappingStatus = String(input.mappingStatus ?? "").toUpperCase();
  if (!MAPPING_KINDS.has(mappingKind) || !MAPPING_STATUSES.has(mappingStatus)) throw new Error("DELIVERY_MAPPING_STATE_INVALID");
  const providerItemId = requiredText(input.providerItemId);
  const providerVariantId = optionalText(input.providerVariantId);
  const providerModifierId = optionalText(input.providerModifierId);
  const providerName = requiredText(input.providerName, 500);
  const productSku = optionalText(input.productSku, 200);
  const size = optionalText(input.size, 100);
  const modifierCode = optionalText(input.modifierCode, 100);
  const price = input.providerPrice === null || input.providerPrice === undefined || input.providerPrice === ""
    ? null : Number(input.providerPrice);
  if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error("DELIVERY_MAPPING_PRICE_INVALID");
  if (mappingKind === "MODIFIER" && !providerModifierId) throw new Error("DELIVERY_PROVIDER_MODIFIER_REQUIRED");
  if (["VERIFIED", "STALE"].includes(mappingStatus) && (!productSku || !size)) throw new Error("DELIVERY_MAPPING_TARGET_REQUIRED");
  if (mappingStatus === "VERIFIED" && mappingKind === "MODIFIER" && !modifierCode) throw new Error("DELIVERY_MODIFIER_TARGET_REQUIRED");
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const scope = await client.query(
      `SELECT 1 FROM bms_delivery_location_mappings
        WHERE tenant_id = $1 AND id = $2 AND integration_id = $3 FOR SHARE`,
      [input.tenantId, input.locationMappingId, input.integrationId],
    );
    if (!scope.rowCount) throw new Error("DELIVERY_MAPPING_SCOPE_INVALID");
    if (mappingStatus === "VERIFIED") {
      const target = await client.query(
        `SELECT 1
           FROM bms_products p
           JOIN bms_product_variants v ON v.tenant_id = p.tenant_id AND v.product_sku = p.sku
                                      AND v.code = $3 AND v.active
           JOIN bms_product_sales_surfaces s ON s.tenant_id = p.tenant_id AND s.product_sku = p.sku
                                            AND s.surface = 'ONLINE_ORDER' AND s.enabled
          WHERE p.tenant_id = $1 AND p.sku = $2 AND p.active
            AND ($4::text <> 'MODIFIER' OR EXISTS (
              SELECT 1 FROM bms_product_modifiers m
               WHERE m.tenant_id = p.tenant_id AND m.product_sku = p.sku
                 AND m.size = $3 AND m.code = $5 AND m.active
            ))`,
        [input.tenantId, productSku, size, mappingKind, modifierCode],
      );
      if (!target.rowCount) throw new Error("DELIVERY_MAPPING_TARGET_NOT_SELLABLE");
    }
    const saved = await client.query<{ id: string }>(
      `INSERT INTO bms_delivery_menu_mappings (
         id, tenant_id, integration_id, location_mapping_id, mapping_kind,
         provider_item_id, provider_variant_id, provider_modifier_id, product_sku, size,
         modifier_code, provider_name_snapshot, provider_price_snapshot, mapping_status,
         verified_by, verified_at, provider_catalog_version
       ) VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 CASE WHEN $14 = 'VERIFIED' THEN $15::uuid ELSE NULL END,
                 CASE WHEN $14 = 'VERIFIED' THEN now() ELSE NULL END,$16)
       ON CONFLICT (tenant_id, location_mapping_id, mapping_kind, provider_item_id,
                    COALESCE(provider_variant_id, ''), COALESCE(provider_modifier_id, '')) DO UPDATE SET
         product_sku = EXCLUDED.product_sku, size = EXCLUDED.size, modifier_code = EXCLUDED.modifier_code,
         provider_name_snapshot = EXCLUDED.provider_name_snapshot,
         provider_price_snapshot = EXCLUDED.provider_price_snapshot,
         mapping_status = EXCLUDED.mapping_status, verified_by = EXCLUDED.verified_by,
         verified_at = EXCLUDED.verified_at, provider_catalog_version = EXCLUDED.provider_catalog_version,
         updated_at = now()
       RETURNING id`,
      [input.id ?? null, input.tenantId, input.integrationId, input.locationMappingId, mappingKind,
        providerItemId, providerVariantId, providerModifierId, productSku, size, modifierCode,
        providerName, price, mappingStatus, input.actorUserId, optionalText(input.providerCatalogVersion, 200)],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'delivery.menu_mapping_saved',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, saved.rows[0].id,
        JSON.stringify({ integrationId: input.integrationId, locationMappingId: input.locationMappingId,
          mappingKind, mappingStatus, providerItemId, productSku, size, modifierCode })],
    );
    await client.query("COMMIT");
    return { id: saved.rows[0].id };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}
