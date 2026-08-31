import { getClient, query } from "@/lib/db";
import type { QueryResult, QueryResultRow } from "pg";
import { beginTenantTx } from "./tenant";
import { normalizeShopArchetype, type ShopArchetype } from "./shopArchetypes";

export const STORE_CAPABILITIES = [
  "PACK",
  "MULTI_BARCODE",
  "LOT_TRACKING",
  "EXPIRY_TRACKING",
  "FEFO",
  "WEIGHTED_PRODUCT",
  "UNIT_CONVERSION",
  "SERIAL_TRACKING",
  "PHARMACY_POLICY",
  "RECIPE",
  "MODIFIER",
  "KITCHEN_WORKFLOW",
  "WASTAGE",
] as const;

export type StoreCapabilityCode = typeof STORE_CAPABILITIES[number];

/**
 * ความสามารถที่ "สวิตช์มีผลจริง" — มีโค้ดอ่านค่านี้ก่อนทำงาน
 *
 * ที่เหลือในลิสต์ข้างบนเป็น **สถานะที่ระบบตรวจพบจากข้อมูล ไม่ใช่สวิตช์**: การขายแพ็กเกิดจาก
 * การมีแถวใน `bms_product_packs` · การกันของหมดอายุและ FEFO เกิดจากการมีแถวใน
 * `bms_inventory_lots` · การบังคับเลขเครื่องเกิดจาก `bms_products.serial_tracked` ·
 * ด่านร้านยาเกิดจาก `business_archetype = 'pharmacy'` — ปิดหรือเปิดธงพวกนี้ไม่เปลี่ยนอะไร
 * ที่เคาน์เตอร์เลย
 *
 * ⚠️ ห้ามทำให้ธงเหล่านั้นกลายเป็นสวิตช์จริงโดยไม่คิดให้จบ: "ปิด LOT_TRACKING" จะกลายเป็น
 * ปุ่มที่ขายยาหมดอายุได้ และ "ปิด PACK" จะทำให้ร้านอาหาร (preset ไม่มี PACK) ยิงแพ็กไม่ได้ทันที
 *
 * เทส `scripts/store-capability-gates-contract.test.mts` บังคับว่าลิสต์นี้ต้องตรงกับจุดที่
 * เรียก `isCapabilityEnabledInTx()` จริงในซอร์ส — เพิ่มสวิตช์โดยไม่มีคนอ่าน = เทสแดง
 */
export const GATING_CAPABILITIES = [
  "WEIGHTED_PRODUCT",
  "RECIPE",
  "MODIFIER",
  "KITCHEN_WORKFLOW",
  "WASTAGE",
] as const satisfies readonly StoreCapabilityCode[];

const GATING_SET = new Set<string>(GATING_CAPABILITIES);

/** true = สลับแล้วพฤติกรรมเปลี่ยนจริง · false = เป็นสถานะที่อ่านจากข้อมูล */
export function isGatingCapability(capability: string): boolean {
  return GATING_SET.has(capability);
}
export type StoreCapabilitySource = "PRESET" | "MANUAL";
export type StoreCapabilityStatus = "AVAILABLE" | "ENABLED" | "CONFIGURED";

export type StoreCapability = {
  capability: StoreCapabilityCode;
  enabled: boolean;
  configured: boolean;
  status: StoreCapabilityStatus;
  config: Record<string, unknown>;
  source: StoreCapabilitySource;
  /** true = สวิตช์นี้เปลี่ยนพฤติกรรมจริง · false = สถานะที่ระบบอ่านจากข้อมูล แก้ไม่ได้ */
  gating: boolean;
};

const CAPABILITY_SET = new Set<string>(STORE_CAPABILITIES);

const PRESETS: Partial<Record<ShopArchetype, readonly StoreCapabilityCode[]>> = {
  mini_mart: ["PACK", "MULTI_BARCODE", "LOT_TRACKING", "EXPIRY_TRACKING", "WEIGHTED_PRODUCT"],
  pet_supply: ["PACK", "MULTI_BARCODE", "LOT_TRACKING", "EXPIRY_TRACKING", "WEIGHTED_PRODUCT"],
  pharmacy: ["PACK", "MULTI_BARCODE", "LOT_TRACKING", "EXPIRY_TRACKING", "FEFO", "PHARMACY_POLICY"],
  building_materials: ["PACK", "MULTI_BARCODE", "UNIT_CONVERSION", "WEIGHTED_PRODUCT", "SERIAL_TRACKING"],
  restaurant: ["RECIPE", "MODIFIER", "KITCHEN_WORKFLOW", "WASTAGE"],
  food_beverage: ["PACK", "LOT_TRACKING", "EXPIRY_TRACKING", "RECIPE", "MODIFIER", "WASTAGE"],
  fashion: ["PACK", "MULTI_BARCODE"],
  home_kitchen: ["PACK", "MULTI_BARCODE", "SERIAL_TRACKING"],
  beauty_personal_care: ["PACK", "MULTI_BARCODE", "LOT_TRACKING", "EXPIRY_TRACKING"],
  gadgets_accessories: ["PACK", "MULTI_BARCODE", "SERIAL_TRACKING"],
  b2b_wholesale: ["PACK", "MULTI_BARCODE", "UNIT_CONVERSION"],
  gifts_seasonal: ["PACK", "MULTI_BARCODE"],
};

export function isStoreCapability(value: string): value is StoreCapabilityCode {
  return CAPABILITY_SET.has(value);
}

export function presetCapabilitiesForArchetype(
  archetype: string | null | undefined
): ReadonlySet<StoreCapabilityCode> {
  const normalized = normalizeShopArchetype(archetype);
  return new Set(normalized ? PRESETS[normalized] ?? [] : []);
}

type CapabilityOverrideRow = {
  capability: string;
  enabled: boolean;
  config: unknown;
  source: StoreCapabilitySource;
};

type QueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]): Promise<QueryResult<T>>;
};

async function configuredCapabilities(
  client: QueryClient,
  tenantId: string
): Promise<Set<StoreCapabilityCode>> {
  const configured = new Set<StoreCapabilityCode>();
  const result = await client.query<{ capability: StoreCapabilityCode }>(
    `SELECT capability
       FROM (
         SELECT 'PACK'::text AS capability
          WHERE EXISTS (SELECT 1 FROM bms_product_packs WHERE tenant_id = $1 AND active AND NOT is_base)
         UNION ALL SELECT 'MULTI_BARCODE'
          WHERE EXISTS (SELECT 1 FROM bms_product_packs WHERE tenant_id = $1 AND active AND barcode IS NOT NULL)
         UNION ALL SELECT 'LOT_TRACKING'
          WHERE EXISTS (SELECT 1 FROM bms_product_stock_policies WHERE tenant_id = $1 AND lot_tracking)
         UNION ALL SELECT 'EXPIRY_TRACKING'
          WHERE EXISTS (SELECT 1 FROM bms_product_stock_policies WHERE tenant_id = $1 AND expiry_tracking)
         UNION ALL SELECT 'FEFO'
          WHERE EXISTS (SELECT 1 FROM bms_product_stock_policies WHERE tenant_id = $1 AND fefo)
         UNION ALL SELECT 'WEIGHTED_PRODUCT'
          WHERE EXISTS (SELECT 1 FROM bms_product_stock_policies WHERE tenant_id = $1 AND stock_policy = 'WEIGHTED')
         UNION ALL SELECT 'UNIT_CONVERSION'
          WHERE EXISTS (SELECT 1 FROM bms_product_packs WHERE tenant_id = $1 AND active AND base_qty <> 1)
         UNION ALL SELECT 'SERIAL_TRACKING'
          WHERE EXISTS (SELECT 1 FROM bms_products WHERE tenant_id = $1 AND serial_tracked)
         UNION ALL SELECT 'PHARMACY_POLICY'
          WHERE EXISTS (SELECT 1 FROM bms_pharmacy_product_policies WHERE tenant_id = $1)
         UNION ALL SELECT 'RECIPE'
          WHERE EXISTS (SELECT 1 FROM bms_product_recipes WHERE tenant_id = $1 AND active)
         UNION ALL SELECT 'MODIFIER'
          WHERE EXISTS (SELECT 1 FROM bms_product_modifiers WHERE tenant_id = $1 AND active)
         UNION ALL SELECT 'KITCHEN_WORKFLOW'
          WHERE EXISTS (SELECT 1 FROM bms_product_stock_policies WHERE tenant_id = $1 AND kitchen_station IS NOT NULL)
         UNION ALL SELECT 'WASTAGE'
          WHERE EXISTS (SELECT 1 FROM bms_inventory_wastage WHERE tenant_id = $1)
       ) configured`,
    [tenantId]
  );
  for (const row of result.rows) configured.add(row.capability);
  return configured;
}

export async function listStoreCapabilities(tenantId: string): Promise<StoreCapability[]> {
  const [profile, overrides, configured] = await Promise.all([
    query<{ business_archetype: string | null }>(
      `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1`,
      [tenantId]
    ),
    query<CapabilityOverrideRow>(
      `SELECT capability, enabled, config, source
         FROM bms_store_capabilities
        WHERE tenant_id = $1`,
      [tenantId]
    ),
    configuredCapabilities({ query }, tenantId),
  ]);
  const preset = presetCapabilitiesForArchetype(profile.rows[0]?.business_archetype);
  const overrideMap = new Map(
    overrides.rows.filter((row) => isStoreCapability(row.capability)).map((row) => [row.capability, row])
  );

  return STORE_CAPABILITIES.map((capability) => {
    const override = overrideMap.get(capability);
    const enabled = override?.enabled ?? preset.has(capability);
    const isConfigured = enabled && configured.has(capability);
    return {
      capability,
      enabled,
      configured: isConfigured,
      status: isConfigured ? "CONFIGURED" : enabled ? "ENABLED" : "AVAILABLE",
      config: override?.config && typeof override.config === "object"
        ? override.config as Record<string, unknown>
        : {},
      source: override?.source ?? "PRESET",
      gating: isGatingCapability(capability),
    };
  });
}

export async function isCapabilityEnabledInTx(
  client: QueryClient,
  tenantId: string,
  capability: StoreCapabilityCode
): Promise<boolean> {
  const result = await client.query<{ enabled: boolean | null; business_archetype: string | null }>(
    `SELECT c.enabled, sp.business_archetype
       FROM bms_store_profile sp
       LEFT JOIN bms_store_capabilities c
         ON c.tenant_id = sp.tenant_id AND c.capability = $2
      WHERE sp.tenant_id = $1`,
    [tenantId, capability]
  );
  const row = result.rows[0];
  if (!row) return false;
  return row.enabled ?? presetCapabilitiesForArchetype(row.business_archetype).has(capability);
}

export async function upsertStoreCapability(
  tenantId: string,
  input: { capability: string; enabled: boolean; config?: unknown },
  editorId?: string | null
): Promise<StoreCapability> {
  if (!isStoreCapability(input.capability)) throw new Error("ความสามารถของร้านไม่ถูกต้อง");
  // ธงที่ไม่มีใครอ่านต้องเขียนไม่ได้ ไม่ใช่เขียนได้แล้วไม่มีผล — override ที่ไม่มีความหมาย
  // ทำให้หน้าจอบอกว่าร้าน "ปิด" ความสามารถที่ยังทำงานอยู่จริง ซึ่งอันตรายกว่าไม่มีสวิตช์
  if (!isGatingCapability(input.capability)) {
    throw new Error(
      `${input.capability} เป็นสถานะที่ระบบอ่านจากข้อมูลของร้าน ไม่ใช่สวิตช์ — เปลี่ยนที่ข้อมูลของสินค้าแทน`
    );
  }
  const config = input.config ?? {};
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("การตั้งค่าความสามารถต้องเป็น object");
  }
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    await client.query(
      `INSERT INTO bms_store_capabilities (tenant_id, capability, enabled, config, source)
       VALUES ($1,$2,$3,$4::jsonb,'MANUAL')
       ON CONFLICT (tenant_id, capability) DO UPDATE SET
         enabled = EXCLUDED.enabled, config = EXCLUDED.config,
         source = 'MANUAL', updated_at = now()`,
      [tenantId, input.capability, Boolean(input.enabled), JSON.stringify(config)]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  const capability = (await listStoreCapabilities(tenantId))
    .find((entry) => entry.capability === input.capability);
  if (!capability) throw new Error("ไม่พบความสามารถหลังบันทึก");
  return capability;
}

export async function resetStoreCapability(
  tenantId: string,
  capability: string,
  editorId?: string | null
): Promise<StoreCapability> {
  if (!isStoreCapability(capability)) throw new Error("ความสามารถของร้านไม่ถูกต้อง");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    await client.query(
      `DELETE FROM bms_store_capabilities WHERE tenant_id = $1 AND capability = $2`,
      [tenantId, capability]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  const resolved = (await listStoreCapabilities(tenantId))
    .find((entry) => entry.capability === capability);
  if (!resolved) throw new Error("ไม่พบความสามารถหลังคืนค่า preset");
  return resolved;
}
