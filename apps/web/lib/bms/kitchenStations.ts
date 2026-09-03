// =============================================================
// สถานีครัว (master) — 9.54
// -------------------------------------------------------------
// ก่อน 9.54 สถานีมีอยู่แค่เป็นสตริงบน bms_product_stock_policies.kitchen_station
// ทุกอย่างที่อ้างถึงสถานีจึงอ้างด้วย "ชื่อที่พิมพ์ตรงกันเป๊ะ" และ **เปลี่ยนชื่อสถานีไม่ได้เลย**
// (แก้ชื่อ = เมนูทุกตัวชี้ไปที่สถานีที่ไม่มีอยู่ และเกณฑ์เวลาที่ตั้งไว้กลายเป็นแถวกำพร้า)
//
// สามข้อที่ต้องรู้ก่อนแก้ไฟล์นี้:
//   1. **สถานีไม่ใช่สาขา** — สต็อกยังตัดตาม location_id ของบิลเหมือนเดิม ไฟล์นี้ไม่แตะ
//      เส้นทางสต็อกหรือเงินเลยสักบรรทัด
//   2. **location_id NULL = ใช้ได้ทุกสาขา** · มีค่า = ของสาขานั้นสาขาเดียว
//   3. **ห้ามลบสถานีถาวร** ใช้ active = FALSE — ตั๋วเก่าและประวัติอ้างถึงมันอยู่
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import {
  KITCHEN_STATION_DESCRIPTION_MAX,
  KITCHEN_STATION_NAME_MAX,
  KITCHEN_STATION_SORT_MAX,
  KITCHEN_STATION_SORT_MIN,
  isValidKitchenStationCode,
  normalizeKitchenStationCode,
  normalizeKitchenStationName,
} from "./kitchenStationCode";

export {
  KITCHEN_STATION_CODE_MAX,
  KITCHEN_STATION_NAME_MAX,
  isValidKitchenStationCode,
  normalizeKitchenStationCode,
  normalizeKitchenStationName,
} from "./kitchenStationCode";

export type KitchenStation = {
  id: string;
  locationId: string | null;
  locationName: string | null;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** สถานีพร้อมตัวเลขที่หน้าตั้งค่าต้องใช้ตัดสินใจ (กี่เมนูผูกอยู่ · เกณฑ์เวลาเท่าไร) */
export type KitchenStationWithUsage = KitchenStation & {
  productCount: number;
  activeProductCount: number;
  warnMinutes: number;
  lateMinutes: number;
  slaConfigured: boolean;
};

export type KitchenStationInput = {
  code?: string | null;
  name?: string | null;
  description?: string | null;
  locationId?: string | null;
  active?: boolean | null;
  sortOrder?: number | null;
};

const toISO = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value ?? "");

function mapStation(row: any): KitchenStation {
  return {
    id: String(row.id),
    locationId: row.location_id ? String(row.location_id) : null,
    locationName: row.location_name ?? null,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
    createdAt: toISO(row.created_at),
    updatedAt: toISO(row.updated_at),
  };
}

/**
 * ค่าปริยายของเกณฑ์เวลา — ตัวเลขจริงอยู่ที่ `kitchenBoard.ts` (DEFAULT_KITCHEN_SLA)
 * ที่นี่ import ไม่ได้เพราะโมดูลนี้ลาก `pg` เข้ามา ส่วน kitchenBoard ตั้งใจไม่ import อะไรเลย
 * และหน้าจอ client import จากที่นั่น · เขียนซ้ำเป็นค่าคงที่แล้วมีเทสบังคับให้เท่ากัน
 */
const DEFAULT_WARN_MINUTES = 5;
const DEFAULT_LATE_MINUTES = 10;

function validateInput(input: KitchenStationInput, current?: KitchenStation | null) {
  const name = normalizeKitchenStationName(input.name ?? current?.name ?? "");
  if (!name) throw new Error("ต้องระบุชื่อสถานี");
  if (name.length > KITCHEN_STATION_NAME_MAX) throw new Error("ชื่อสถานียาวเกินไป");

  // รหัสที่ไม่ได้ส่งมาให้ derive จากชื่อ — ร้านส่วนใหญ่ไม่เคยอยากตั้งรหัสเอง
  const rawCode = String(input.code ?? current?.code ?? "").trim();
  const code = rawCode ? normalizeKitchenStationCode(rawCode) : normalizeKitchenStationCode(name);
  if (!isValidKitchenStationCode(code)) throw new Error("รหัสสถานีต้องเป็นตัวอักษรหรือตัวเลข ไม่เกิน 32 ตัว");

  const description = String(
    input.description !== undefined ? input.description ?? "" : current?.description ?? ""
  ).trim().slice(0, KITCHEN_STATION_DESCRIPTION_MAX) || null;

  const sortRaw = input.sortOrder ?? current?.sortOrder ?? 0;
  const sortOrder = Math.trunc(Number(sortRaw));
  if (!Number.isFinite(sortOrder) || sortOrder < KITCHEN_STATION_SORT_MIN || sortOrder > KITCHEN_STATION_SORT_MAX) {
    throw new Error(`ลำดับการแสดงผลต้องอยู่ระหว่าง ${KITCHEN_STATION_SORT_MIN} ถึง ${KITCHEN_STATION_SORT_MAX}`);
  }

  const active = input.active ?? current?.active ?? true;
  return { code, name, description, sortOrder, active: Boolean(active) };
}

/**
 * สาขาต้องเป็นของร้านนี้จริง — รับ id จาก body ไม่ได้แปลว่าเชื่อ id จาก body
 * (ร้านอื่นที่รู้ uuid ของสาขาต้องไม่สามารถผูกสถานีข้ามร้านได้ แม้ FK จะกันอีกชั้น)
 */
async function resolveLocationInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  locationId: string | null | undefined
): Promise<string | null> {
  const id = String(locationId ?? "").trim();
  if (!id) return null;
  const found = await client.query(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  if (!found.rowCount) throw new Error("ไม่พบสาขานี้ในร้าน");
  return id;
}

/**
 * รายการสถานีของร้าน
 *
 * `locationId` กรองแบบ "ที่ใช้ได้ที่สาขานี้" = สถานีระดับร้าน (NULL) **บวก** สถานีของสาขานั้น
 * ไม่ใช่ `location_id = $2` ตรง ๆ — ไม่งั้นสาขาที่ยังไม่มีสถานีของตัวเองจะไม่มีสถานีให้เลือกเลย
 * ทั้งที่สถานีระดับร้านใช้ได้อยู่แล้ว
 */
export async function listKitchenStations(
  tenantId: string,
  options?: { locationId?: string | null; includeInactive?: boolean; stationId?: string | null }
): Promise<KitchenStationWithUsage[]> {
  const locationId = String(options?.locationId ?? "").trim() || null;
  const stationId = String(options?.stationId ?? "").trim() || null;
  // ขอสถานีเดียวโดยตรง = ต้องได้แถวนั้นเสมอ แม้จะถูกปิดใช้งานหรือผูกกับสาขาอื่น (mutation
  // คืนสิ่งที่มันเพิ่งเขียน ไม่ใช่ "สิ่งที่ตัวกรองยอมให้เห็น")
  const includeInactive = options?.includeInactive === true || stationId !== null;
  const result = await query(
    `SELECT st.*, loc.name AS location_name,
            COALESCE(station_usage.product_count, 0) AS product_count,
            COALESCE(station_usage.active_product_count, 0) AS active_product_count,
            sla.warn_minutes, sla.late_minutes
       FROM bms_kitchen_stations st
       LEFT JOIN bms_locations loc
         ON loc.tenant_id = st.tenant_id AND loc.id = st.location_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS product_count,
                COUNT(*) FILTER (WHERE p.active)::int AS active_product_count
           FROM bms_product_stock_policies sp
           JOIN bms_products p
             ON p.tenant_id = sp.tenant_id AND p.sku = sp.product_sku
          WHERE sp.tenant_id = st.tenant_id AND sp.kitchen_station_id = st.id
       ) station_usage ON TRUE
       LEFT JOIN bms_kitchen_station_slas sla
         ON sla.tenant_id = st.tenant_id AND sla.station = st.name
      WHERE st.tenant_id = $1
        AND ($2::boolean OR st.active)
        AND ($4::uuid IS NOT NULL
             OR $3::uuid IS NULL OR st.location_id IS NULL OR st.location_id = $3)
        AND ($4::uuid IS NULL OR st.id = $4)
      ORDER BY st.active DESC, st.sort_order, st.name`,
    [tenantId, includeInactive, locationId, stationId]
  );
  return result.rows.map((row: any) => ({
    ...mapStation(row),
    productCount: Number(row.product_count ?? 0),
    activeProductCount: Number(row.active_product_count ?? 0),
    warnMinutes: row.warn_minutes == null ? DEFAULT_WARN_MINUTES : Number(row.warn_minutes),
    lateMinutes: row.late_minutes == null ? DEFAULT_LATE_MINUTES : Number(row.late_minutes),
    slaConfigured: row.warn_minutes != null,
  }));
}

/** สถานีเดียวพร้อมตัวเลขการใช้งาน — mutation คืนรูปเดียวกับที่หน้าตั้งค่าแสดงอยู่ */
export async function getKitchenStation(
  tenantId: string,
  stationId: string
): Promise<KitchenStationWithUsage | null> {
  const [station] = await listKitchenStations(tenantId, { stationId });
  return station ?? null;
}

/**
 * สถานีที่ตั๋วใบหนึ่งควรถูกส่งไป — **ตัดสินในทรานแซกชันที่สร้างตั๋ว ไม่ใช่ที่หน้าจอ**
 *
 * กติกาเรื่องสาขา: สถานีเฉพาะสาขาใช้ได้เฉพาะบิลของสาขานั้น · บิลของสาขาอื่นที่ขายเมนู
 * เดียวกันได้ `null` แล้วตั๋วไปช่อง "ไม่ระบุสถานี" ซึ่งยังเห็นและยังกดได้ · ทางเลือกอื่นคือ
 * ส่งตั๋วไปครัวที่ไม่มีอยู่ในสาขานั้น = อาหารไม่มีใครทำโดยไม่มีใครรู้
 *
 * **สถานีที่ปิดใช้งานยังรับตั๋วได้** โดยตั้งใจ — ปิดสถานีทั้งที่ยังมีเมนูผูกอยู่แล้วให้ตั๋ว
 * หายไปเฉย ๆ คือการทำอาหารหล่นระหว่างทาง หน้าตั้งค่าเตือนตั้งแต่ตอนกดปิดแทน (ดู
 * archiveKitchenStation) และ readiness ของสินค้าเตือนซ้ำอีกชั้น
 */
/**
 * นิพจน์ SQL ที่ตัดสินว่า "ตั๋วใบนี้ขึ้นสถานีไหน" — **ที่เดียวของทั้งระบบ**
 *
 * มีผู้เรียกสามที่ (คิวครัวของบิลค้าปลีก · รอบครัวของบิลโต๊ะ · การอ่านตัวเดียวด้านล่าง)
 * ถ้าต่างคนต่างเขียน CASE ของตัวเอง วันหนึ่งเส้นทางหนึ่งจะยอมส่งตั๋วข้ามสาขาไปครัวที่ไม่มี
 * อยู่จริง แล้วอาหารจานนั้นไม่มีใครทำโดยไม่มีใครรู้
 *
 * ผู้เรียกต้อง join `bms_product_stock_policies` และ LEFT JOIN `bms_kitchen_stations`
 * (ผ่าน `kitchen_station_id`) มาให้ แล้วบอก SQL ของ "สาขาของบิล" เข้ามา
 */
export function kitchenStationColumnsSql(opts: {
  station?: string;
  policy?: string;
  orderLocation: string;
}): { id: string; name: string } {
  const st = opts.station ?? "st";
  const sp = opts.policy ?? "sp";
  // สถานีเฉพาะสาขาใช้ได้เฉพาะบิลของสาขานั้น · บิลของสาขาอื่นตกไป "ไม่ระบุสถานี" ซึ่งยังขึ้น
  // กระดานและยังกดได้ — ดีกว่าส่งไปครัวที่สาขานั้นไม่มี
  const usable = `${st}.id IS NOT NULL AND (${st}.location_id IS NULL OR ${st}.location_id = ${opts.orderLocation})`;
  return {
    id: `CASE WHEN ${usable} THEN ${st}.id END`,
    // ไม่มีแถวหลัก = สถานีที่ยังไม่ถูกยกระดับ (นำเข้าไฟล์ยุคเก่า) ยังต้องขึ้นกระดานด้วยชื่อตัวเอง
    name: `CASE WHEN ${usable} THEN ${st}.name
                WHEN ${st}.id IS NULL THEN NULLIF(btrim(COALESCE(${sp}.kitchen_station, '')), '')
           END`,
  };
}

/**
 * ตัดสินว่าจะ "เก็บ" สถานีอะไรไว้กับสินค้าหนึ่งตัว — ใช้ร่วมกันโดยทุกเส้นทางที่เขียนสถานี
 *
 * มีสองทางเข้า: `stationId` (ทางใหม่ตั้งแต่ 9.54 — หน้ารูปแบบสต็อกใช้ทางนี้) และ `stationName`
 * ที่เป็นชื่อล้วน (ฟอร์มสินค้า/สคริปต์/ตัวสร้างข้อมูลตัวอย่าง) · **id ชนะเสมอ และชื่อเป็นค่าที่ derive**
 * ถ้าปล่อยให้ผู้เรียกส่งชื่อมาคู่กับ id คนละตัว สินค้าจะชี้สถานี A แต่ป้ายบนจอครัวเขียนว่า B
 * แล้วไม่มีทางรู้ว่าอันไหนคือความจริง
 *
 * ผู้เรียกมีสองที่ (ฟอร์มสินค้า `upsertProduct` และรูปแบบสต็อก `upsertProductStockPolicy`)
 * ซึ่งต้องให้ผลเหมือนกันเป๊ะ — เขียนแยกกันสองชุดแล้ววันหนึ่งทางหนึ่งจะยอมรับ id ของร้านอื่น
 * หรือเลิกยกชื่อขึ้นเป็นแถวหลัก
 */
export async function resolveKitchenStationForProductInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  input: { stationId?: string | null; stationName?: string | null }
): Promise<{ id: string | null; name: string | null }> {
  const stationId = String(input.stationId ?? "").trim() || null;
  if (stationId) {
    const station = await client.query<{ name: string }>(
      `SELECT name FROM bms_kitchen_stations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, stationId]
    );
    if (!station.rowCount) throw new Error("ไม่พบสถานีครัวนี้ในร้าน");
    return { id: stationId, name: station.rows[0].name };
  }
  const name = normalizeKitchenStationName(input.stationName);
  if (!name) return { id: null, name: null };
  // ทางเก่า: ยกชื่อขึ้นเป็นแถวหลักให้เลย ไม่งั้นสถานีกำพร้าจะงอกขึ้นเรื่อย ๆ — ชื่อที่ไม่มี
  // แถวหลักไม่มีในดรอปดาวน์ เปิด/ปิดไม่ได้ และเรียงลำดับไม่ได้
  const station = await ensureKitchenStationByNameInTx(client, tenantId, name);
  return { id: station?.id ?? null, name: station?.name ?? name };
}

/**
 * ยกชื่อสถานีที่มาทางเส้นทางเก่า (ชื่อล้วน) ขึ้นเป็นแถวหลัก
 *
 * "ทางเก่า" คือผู้เรียก service ที่ส่งแต่ชื่อ — ฟอร์มสินค้า, `devSeed`, สคริปต์ของร้าน
 * (**ไฟล์นำเข้าสินค้ายังไม่มีคอลัมน์สถานีเลย** ดู HEADER_MAP ใน ImportModal ก่อนอ้างถึงมัน)
 *
 * **ไม่ทำแบบนี้ = สถานีกำพร้างอกขึ้นเรื่อย ๆ** — ชื่อที่ไม่มีแถวหลักจะไม่มีในดรอปดาวน์
 * ไม่มีลำดับ เปิด/ปิดไม่ได้ และตั้งเกณฑ์เวลาให้ได้ก็ต่อเมื่อพิมพ์ชื่อตรงเป๊ะ ซึ่งเป็นอาการที่
 * `9.54` ทำมาเพื่อเลิก · สร้างเป็นสถานีระดับร้าน (location_id NULL) เพราะผู้เรียกทางนี้
 * ไม่เคยรู้จักสาขา
 *
 * ต้องเรียกในทรานแซกชันของผู้เรียก — ชื่อกับ id ของสินค้าต้อง commit พร้อมกัน ไม่งั้นสินค้า
 * ชี้ไปสถานีที่ rollback หายไปแล้ว
 */
export async function ensureKitchenStationByNameInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  rawName: string | null | undefined
): Promise<{ id: string; name: string } | null> {
  const name = normalizeKitchenStationName(rawName);
  if (!name) return null;
  const existing = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM bms_kitchen_stations WHERE tenant_id = $1 AND name = $2`,
    [tenantId, name]
  );
  if (existing.rowCount) return { id: String(existing.rows[0].id), name: existing.rows[0].name };

  const base = normalizeKitchenStationCode(name);
  // ชื่อคนละชื่อที่ derive ได้รหัสเดียวกัน ("ครัว-ร้อน" กับ "ครัว ร้อน") ต้องได้แถวคนละแถว
  // ไม่ใช่แถวใดแถวหนึ่งหายไป — ต่อท้ายเลขแบบเดียวกับที่ไมเกรชัน `9.54` ทำกับข้อมูลเดิม
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const code = attempt === 1 ? base : `${base.slice(0, 28)}_${attempt}`;
    const inserted = await client.query<{ id: string; name: string }>(
      `INSERT INTO bms_kitchen_stations (tenant_id, location_id, code, name)
       VALUES ($1, NULL, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id, name`,
      [tenantId, code, name]
    );
    if (inserted.rowCount) return { id: String(inserted.rows[0].id), name: inserted.rows[0].name };
    // ชนแล้ว: อาจเป็นรหัสซ้ำ (ลองรหัสถัดไป) หรือชื่อซ้ำเพราะมีคนสร้างพร้อมกัน (ใช้ของเขา)
    const raced = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM bms_kitchen_stations WHERE tenant_id = $1 AND name = $2`,
      [tenantId, name]
    );
    if (raced.rowCount) return { id: String(raced.rows[0].id), name: raced.rows[0].name };
  }
  throw new Error("สร้างสถานีครัวไม่สำเร็จ: รหัสสถานีซ้ำเกินกว่าจะหาเลขว่างได้");
}

export async function createKitchenStation(
  tenantId: string,
  input: KitchenStationInput,
  editorId?: string | null
): Promise<KitchenStation> {
  const values = validateInput(input);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    const locationId = await resolveLocationInTx(client, tenantId, input.locationId);
    const inserted = await client.query(
      `INSERT INTO bms_kitchen_stations
         (tenant_id, location_id, code, name, description, active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [tenantId, locationId, values.code, values.name, values.description, values.active, values.sortOrder]
    ).catch(rethrowUniqueViolation);
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'kitchen.station_create',$3,$4::jsonb)`,
      [tenantId, editorId ? `user:${editorId}` : "system", inserted.rows[0].id,
        JSON.stringify({ code: values.code, name: values.name, locationId, sortOrder: values.sortOrder })]
    );
    await client.query("COMMIT");
    return mapStation(inserted.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function updateKitchenStation(
  tenantId: string,
  stationId: string,
  input: KitchenStationInput,
  editorId?: string | null
): Promise<KitchenStation> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    const existing = await client.query(
      `SELECT * FROM bms_kitchen_stations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, stationId]
    );
    if (!existing.rowCount) throw new Error("ไม่พบสถานีครัวนี้");
    const current = mapStation(existing.rows[0]);
    const values = validateInput(input, current);
    const locationId = input.locationId !== undefined
      ? await resolveLocationInTx(client, tenantId, input.locationId)
      : current.locationId;

    const updated = await client.query(
      `UPDATE bms_kitchen_stations
          SET location_id = $3, code = $4, name = $5, description = $6,
              active = $7, sort_order = $8, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenantId, stationId, locationId, values.code, values.name, values.description,
        values.active, values.sortOrder]
    ).catch(rethrowUniqueViolation);

    // ⚠️ เกณฑ์เวลา (9.53) คีย์ด้วย "ชื่อ" สถานี — เปลี่ยนชื่อแล้วไม่ย้ายคีย์ตาม แปลว่าสถานี
    // เงียบ ๆ กลับไปใช้ค่าปริยาย 5/10 โดยไม่มีใครรู้ · ลบแถวกำพร้าที่ถือชื่อใหม่อยู่ก่อน
    // (ชื่อที่ไม่มีสถานีไหนใช้แล้ว) ไม่งั้น UPDATE ชนคีย์หลัก
    if (values.name !== current.name) {
      await client.query(
        `DELETE FROM bms_kitchen_station_slas WHERE tenant_id = $1 AND station = $2`,
        [tenantId, values.name]
      );
      await client.query(
        `UPDATE bms_kitchen_station_slas SET station = $3, updated_at = now()
          WHERE tenant_id = $1 AND station = $2`,
        [tenantId, current.name, values.name]
      );
      // สตริงบน stock policy คือ fallback ของผู้อ่านรุ่นก่อน 9.54 — ต้องตามชื่อใหม่ไปด้วย
      // ตั๋วที่ออกไปแล้ว **ไม่ถูกแตะ**: มันคือ snapshot ของชื่อ ณ เวลาที่ครัวเห็นจริง
      await client.query(
        `UPDATE bms_product_stock_policies SET kitchen_station = $3, updated_at = now()
          WHERE tenant_id = $1 AND kitchen_station_id = $2`,
        [tenantId, stationId, values.name]
      );
    }

    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'kitchen.station_update',$3,$4::jsonb)`,
      [tenantId, editorId ? `user:${editorId}` : "system", stationId,
        JSON.stringify({
          before: { code: current.code, name: current.name, active: current.active, locationId: current.locationId },
          after: { code: values.code, name: values.name, active: values.active, locationId },
        })]
    );
    await client.query("COMMIT");
    return mapStation(updated.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * ปิดใช้งานสถานี — **ไม่ใช่การลบ** ตั๋วเก่า ประวัติ และเกณฑ์เวลาของมันยังอยู่ครบ
 *
 * ปิดทั้งที่ยังมีเมนูที่เปิดขายผูกอยู่ = อาหารของเมนูเหล่านั้นจะไปโผล่ช่อง "ไม่ระบุสถานี"
 * ในสาขาที่ไม่มีครัวนั้น จึงบล็อกไว้ก่อนและบอกจำนวน · ร้านที่ตั้งใจจริงส่ง `force` มาได้
 * (เช่นปิดครัวที่เลิกใช้แล้วโดยจะไปย้ายเมนูทีหลัง)
 */
export async function archiveKitchenStation(
  tenantId: string,
  stationId: string,
  editorId?: string | null,
  options?: { force?: boolean }
): Promise<KitchenStation> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    const existing = await client.query(
      `SELECT * FROM bms_kitchen_stations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, stationId]
    );
    if (!existing.rowCount) throw new Error("ไม่พบสถานีครัวนี้");
    const current = mapStation(existing.rows[0]);

    const linked = await client.query<{ active_products: number }>(
      `SELECT COUNT(*)::int AS active_products
         FROM bms_product_stock_policies sp
         JOIN bms_products p ON p.tenant_id = sp.tenant_id AND p.sku = sp.product_sku
        WHERE sp.tenant_id = $1 AND sp.kitchen_station_id = $2 AND p.active`,
      [tenantId, stationId]
    );
    const activeProducts = Number(linked.rows[0]?.active_products ?? 0);
    if (activeProducts > 0 && options?.force !== true) {
      throw new Error(
        `ยังมีสินค้าที่เปิดขาย ${activeProducts} รายการผูกกับสถานีนี้ — ย้ายไปสถานีอื่นก่อน หรือยืนยันเพื่อปิดทั้งที่ยังผูกอยู่`
      );
    }

    const updated = await client.query(
      `UPDATE bms_kitchen_stations SET active = FALSE, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, stationId]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'kitchen.station_archive',$3,$4::jsonb)`,
      [tenantId, editorId ? `user:${editorId}` : "system", stationId,
        JSON.stringify({ code: current.code, name: current.name, activeProducts, forced: options?.force === true })]
    );
    await client.query("COMMIT");
    return mapStation(updated.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * ชื่อสถานีที่ยังถูกใช้อยู่จริงแต่ไม่มีแถวหลัก — ข้อมูลตกค้างที่หน้าตั้งค่าต้องไม่ซ่อน
 *
 * หลัง `9.54` ทุกชื่อที่มีอยู่ ณ เวลา migrate ได้แถวหลักไปแล้ว ลิสต์นี้จึงว่างในกรณีปกติ
 * มันจะไม่ว่างเมื่อมีคนเขียนสตริงเข้ามาทางเส้นทางเก่า (นำเข้าไฟล์/สคริปต์) — ซ่อนไว้แปลว่า
 * ร้านมีสถานีที่แก้เกณฑ์เวลาไม่ได้และไม่รู้ว่ามันมาจากไหน
 */
export async function listUnmappedKitchenStationNames(tenantId: string): Promise<string[]> {
  const result = await query<{ station: string }>(
    `SELECT DISTINCT btrim(sp.kitchen_station) AS station
       FROM bms_product_stock_policies sp
      WHERE sp.tenant_id = $1
        AND sp.kitchen_station_id IS NULL
        AND btrim(COALESCE(sp.kitchen_station, '')) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM bms_kitchen_stations st
           WHERE st.tenant_id = sp.tenant_id AND st.name = btrim(sp.kitchen_station)
        )
      ORDER BY 1
      LIMIT 100`,
    [tenantId]
  );
  return result.rows.map((row) => row.station);
}

/** ทำให้ข้อความ unique violation ของ Postgres อ่านรู้เรื่องที่หน้าตั้งค่า */
function rethrowUniqueViolation(error: any): never {
  if (error?.code === "23505") {
    const constraint = String(error?.constraint ?? "");
    if (constraint.includes("name")) throw new Error("มีสถานีชื่อนี้อยู่แล้วในร้าน");
    throw new Error("มีสถานีที่ใช้รหัสนี้อยู่แล้ว");
  }
  throw error;
}
