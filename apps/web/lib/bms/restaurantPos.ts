import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { isCapabilityEnabledInTx } from "./storeCapabilities";
import { listPrimaryProductImages } from "./products";
import {
  afterOrderCancellationCommitted,
  cancelOrderInTx,
  createOrderInTx,
  type CreateOrderResult,
  type OrderItemInput,
} from "./orders";
import {
  recordPosSale,
  resolvePosScan,
  type PosPaymentInput,
  type PosSaleLine,
  type PosSaleResult,
} from "./pos";

const OPEN_CHECK_STATUSES = ["OPEN", "CLOSING"] as const;
const SETTLEMENT_LEASE_MINUTES = 5;

type CheckItemRow = {
  id: string;
  product_sku: string;
  product_name: string;
  size: string;
  pack_qty: number;
  pack_code: string | null;
  unit_name: string | null;
  base_qty: number | null;
  pack_price: string | null;
  sent_at?: string | Date | null;
  modifier_codes: string[];
  modifier_names: string[];
  kitchen_note: string | null;
  status: "NEW" | "SENT" | "CANCELLED";
  round_no: number | null;
  created_at: Date | string;
};

function iso(value: Date | string | null) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapCheckItem(row: CheckItemRow) {
  return {
    id: row.id,
    sku: row.product_sku,
    productName: row.product_name,
    size: row.size,
    packQty: Number(row.pack_qty),
    packCode: row.pack_code,
    unitName: row.unit_name,
    baseQty: row.base_qty == null ? null : Number(row.base_qty),
    packPrice: row.pack_price == null ? null : Number(row.pack_price),
    modifierCodes: row.modifier_codes ?? [],
    modifierNames: row.modifier_names ?? [],
    kitchenNote: row.kitchen_note,
    status: row.status,
    roundNo: row.round_no == null ? null : Number(row.round_no),
    createdAt: iso(row.created_at),
    // เวลาที่ส่งครัวจริง — หัวข้อ "รอบ N · ส่งครัวแล้ว HH:MM" บนแผงบิลอ่านจากค่านี้
    sentAt: row.sent_at ? iso(row.sent_at) : null,
  };
}

/**
 * บิลโต๊ะหนึ่งใบทำทีละคำขอ — แต่ **ห้ามยึด client ของ pool ไว้ระหว่างรอ**
 *
 * เวอร์ชันแรกใช้ `pg_advisory_lock()` แบบ session ซึ่งต้องยืม client จาก pool มาถือไว้
 * ตลอดงานหนึ่งชิ้น แล้วงานข้างในยังต้องยืม client อีกใบเพื่อเปิดทรานแซกชัน · pool ของ
 * แอปตั้ง `POSTGRES_POOL_MAX` ค่าปริยาย 10 ดังนั้นแค่ 5 โต๊ะกดพร้อมกัน = client ครบ 10 ใบ
 * ถูกถือโดยตัวล็อกที่รออีก 5 ใบซึ่งไม่มีวันได้ → ทุก query ของ **ทั้ง instance** (ไม่ใช่แค่
 * ร้านอาหาร) ล้มด้วย connection timeout เป็นช่วง ๆ 10 วินาที
 *
 * ตอนนี้แยกเป็นสองชั้นที่ไม่กิน client:
 *  1. mutex ในโปรเซส เรียงคำขอของบิลเดียวกันใน instance เดียว (กดปุ่มรัว ๆ)
 *  2. `pg_advisory_xact_lock()` **ในทรานแซกชันของงานเอง** กันข้าม instance โดยไม่ต้อง
 *     ยืม connection เพิ่มเลย เพราะล็อกอยู่บน client เดียวกับที่เขียนอยู่แล้ว
 *
 * ความถูกต้องข้าม instance ไม่ได้พึ่งชั้นที่ 1: ทุกเส้นทางมีด่านของตัวเองในฐาน —
 * `status = 'OPEN'` + `FOR UPDATE` ตอนแก้รายการ, `version = $n` ตอนผูกออร์เดอร์,
 * unique index ของโต๊ะที่เปิดอยู่, และคีย์กันบิลซ้ำต่อ (บิล, version) ตอนจองสต็อก
 */
const checkMutexes = new Map<string, Promise<unknown>>();

async function withCheckLock<T>(tenantId: string, checkId: string, work: () => Promise<T>): Promise<T> {
  const key = `${tenantId}:${checkId}`;
  const previous = checkMutexes.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(work);
  // เก็บ promise ที่ "ไม่ throw" ไว้เป็นคิว ไม่ให้ error ของคำขอก่อนไปคว่ำคำขอถัดไป
  const queued = run.catch(() => {});
  checkMutexes.set(key, queued);
  try {
    return await run;
  } finally {
    if (checkMutexes.get(key) === queued) checkMutexes.delete(key);
  }
}

/** ล็อกข้าม instance บน client ที่กำลังเขียนอยู่ — ต้องเรียกหลัง beginTenantTx() */
async function lockCheckInTx(client: Pick<PoolClient, "query">, tenantId: string, checkId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `restaurant-check:${tenantId}:${checkId}`,
  ]);
}

async function requireRestaurantTenant(tenantId: string) {
  const result = await query<{ business_archetype: string | null }>(
    `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  if (result.rows[0]?.business_archetype !== "restaurant") {
    throw new Error("ฟังก์ชันนี้ใช้ได้เฉพาะร้านที่ตั้ง Shop archetype เป็น restaurant");
  }
}

export async function listRestaurantFloor(tenantId: string, locationId: string) {
  await requireRestaurantTenant(tenantId);
  const [areas, tables] = await Promise.all([
    query<any>(
      `SELECT id, name, sort_order
         FROM bms_restaurant_areas
        WHERE tenant_id = $1 AND location_id = $2 AND active
        ORDER BY sort_order, name`,
      [tenantId, locationId]
    ),
    query<any>(
      `SELECT t.id, t.area_id, t.code, t.name, t.seats, t.sort_order, t.blocked,
              c.id AS check_id, c.status AS check_status, c.guest_count,
              c.amount_due, c.opened_at, c.version, c.reserved_version,
              COUNT(i.id) FILTER (WHERE i.status <> 'CANCELLED')::integer AS item_count,
              COUNT(i.id) FILTER (WHERE i.status = 'NEW')::integer AS unsent_count
         FROM bms_restaurant_tables t
         LEFT JOIN bms_restaurant_checks c
           ON c.tenant_id = t.tenant_id AND c.table_id = t.id
          AND c.status = ANY($3::text[])
         LEFT JOIN bms_restaurant_check_items i
           ON i.tenant_id = c.tenant_id AND i.check_id = c.id
        WHERE t.tenant_id = $1 AND t.location_id = $2 AND t.active
        GROUP BY t.id, c.id
        ORDER BY t.sort_order, t.code`,
      [tenantId, locationId, [...OPEN_CHECK_STATUSES]]
    ),
  ]);
  return {
    areas: areas.rows.map((row) => ({ id: row.id, name: row.name, sortOrder: Number(row.sort_order) })),
    tables: tables.rows.map((row) => ({
      id: row.id,
      areaId: row.area_id,
      code: row.code,
      name: row.name,
      seats: Number(row.seats),
      blocked: Boolean(row.blocked),
      status: row.blocked ? "BLOCKED" : row.check_id ? "OCCUPIED" : "AVAILABLE",
      check: row.check_id ? {
        id: row.check_id,
        status: row.check_status,
        guestCount: Number(row.guest_count),
        amountDue: Number(row.amount_due),
        openedAt: iso(row.opened_at),
        itemCount: Number(row.item_count),
        unsentCount: Number(row.unsent_count),
        version: Number(row.version),
        reservedVersion: row.reserved_version == null ? null : Number(row.reserved_version),
      } : null,
    })),
  };
}

// รายการที่ "ขายให้ลูกค้าที่โต๊ะได้" สำหรับกริดเลือกสั่งอาหาร (แทนการพิมพ์ค้นหาทุกครั้ง)
//
// **ห้ามกรองด้วย stock_policy = 'RECIPE'** — เหตุผลเดียวกันกับตั๋วครัวใน
// sendRestaurantKitchenRound: น้ำเปล่า/เบียร์/ของหวานสำเร็จรูปเป็น DIRECT ไม่มีสูตร
// กรอง RECIPE = ของพวกนั้นสั่งไม่ได้เลย และร้านที่ยังไม่ได้ผูกสูตรให้เมนูไหนเลยจะเห็น
// กริดว่างทั้งที่มีของขายอยู่ ซึ่งอ่านได้ว่า "ระบบพัง"
//
// สิ่งที่ต้องซ่อนคือ **วัตถุดิบ** และวัตถุดิบนิยามได้จากข้อมูล ไม่ต้องพึ่งหมวดหมู่ที่คนพิมพ์เอง:
// มันคือของที่ถูกสูตร/ตัวเลือกอื่นกินเข้าไป (อยู่ใน recipe_items หรือ modifier_items)
// หมูสับจึงหาย แต่น้ำเปล่าที่ไม่ได้เป็นส่วนประกอบของอะไรยังอยู่
// ของที่เป็นทั้งวัตถุดิบและขายเดี่ยว (เช่นไข่ดาวขายแยก) จะถูกซ่อนด้วย — ยอมรับค่าเริ่มต้นที่
// ปลอดภัยกว่า แล้วให้ช่องพิมพ์ค้นหาที่หน้าจอเป็นทางไปถึงของที่ไม่อยู่ในกริด
//
// `price > 0` ปิดช่องที่เหลือ: วัตถุดิบที่ยังไม่มีสูตรไหนใช้ (เพิ่งเพิ่มเข้ามา) ไม่เข้าเงื่อนไข
// "เป็นส่วนประกอบ" จึงยังหลุดเข้ากริด · ร้านตั้งราคาวัตถุดิบเป็น 0 เพราะไม่ได้ขายแยกอยู่แล้ว
// และของที่ขายที่โต๊ะต้องมีราคา การปล่อยแถว ฿0 ขึ้นกริด = เปิดทางให้กดขายอาหารฟรี
//
// ไม่ใช้ inStockOnly แบบ listSellableProducts เพราะเมนู RECIPE ไม่ถือสต็อกของตัวเอง
// (แถว bms_inventory ของมันค้างที่ 0 ตลอด — ของจริงเช็คจากวัตถุดิบตอนสั่ง) กรองด้วยจะ
// ทำให้เมนูทุกตัวหายจากกริดเงียบ ๆ
export async function listRestaurantMenu(tenantId: string, locationId: string) {
  await requireRestaurantTenant(tenantId);
  const res = await query<{
    sku: string;
    name: string;
    price: string;
    kitchen_station: string | null;
    has_modifiers: boolean;
    sizes: Array<{ size: string; available: number }> | null;
  }>(
    `SELECT p.sku, p.name, p.price, sp.kitchen_station,
            EXISTS (
              SELECT 1 FROM bms_product_modifiers m
               WHERE m.tenant_id = p.tenant_id AND m.product_sku = p.sku AND m.active
            ) AS has_modifiers,
            (SELECT jsonb_agg(jsonb_build_object(
                'size', i.size, 'available', (i.current_stock - i.reserved_stock)
              ) ORDER BY i.size)
               FROM bms_inventory i
              WHERE i.tenant_id = p.tenant_id AND i.product_sku = p.sku
                AND i.location_id = $2
            ) AS sizes
       FROM bms_products p
       LEFT JOIN bms_product_stock_policies sp
         ON sp.tenant_id = p.tenant_id AND sp.product_sku = p.sku
      WHERE p.tenant_id = $1 AND p.active AND p.price > 0
        AND NOT EXISTS (
          SELECT 1 FROM bms_product_recipe_items ri
            JOIN bms_product_recipes r
              ON r.tenant_id = ri.tenant_id AND r.id = ri.recipe_id AND r.active
           WHERE ri.tenant_id = p.tenant_id AND ri.component_sku = p.sku
        )
        AND NOT EXISTS (
          SELECT 1 FROM bms_product_modifier_items mi
            JOIN bms_product_modifiers m
              ON m.tenant_id = mi.tenant_id AND m.id = mi.modifier_id AND m.active
           WHERE mi.tenant_id = p.tenant_id AND mi.component_sku = p.sku
        )
      ORDER BY sp.kitchen_station NULLS LAST, p.name`,
    [tenantId, locationId]
  );
  const skus = res.rows.map((row) => row.sku);
  const images = await listPrimaryProductImages(tenantId, skus);
  return res.rows.map((row) => {
    const sizes = row.sizes ?? [];
    return {
      sku: row.sku,
      name: row.name,
      price: Number(row.price),
      kitchenStation: row.kitchen_station,
      hasModifiers: row.has_modifiers,
      availableSizes: sizes,
      availableTotal: sizes.reduce((sum, s) => sum + Math.max(0, Number(s.available)), 0),
      imageUrl: images.get(row.sku) ?? null,
    };
  });
}

export async function createDefaultRestaurantFloor(input: {
  tenantId: string;
  locationId: string;
  actorUserId: string;
  tableCount?: number;
}) {
  await requireRestaurantTenant(input.tenantId);
  const tableCount = Math.min(Math.max(Math.trunc(input.tableCount ?? 12), 1), 50);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const area = await client.query<{ id: string }>(
      `INSERT INTO bms_restaurant_areas (tenant_id, location_id, name, sort_order)
       VALUES ($1,$2,'โซนหน้าร้าน',0)
       ON CONFLICT (tenant_id, location_id, name)
       DO UPDATE SET active = TRUE, updated_at = now()
       RETURNING id`,
      [input.tenantId, input.locationId]
    );
    for (let index = 1; index <= tableCount; index += 1) {
      const code = `T${String(index).padStart(2, "0")}`;
      await client.query(
        `INSERT INTO bms_restaurant_tables
           (tenant_id, location_id, area_id, code, name, seats, sort_order)
         VALUES ($1,$2,$3,$4,$5,2,$6)
         ON CONFLICT (tenant_id, location_id, code)
         DO UPDATE SET active = TRUE, updated_at = now()`,
        [input.tenantId, input.locationId, area.rows[0].id, code, `โต๊ะ ${index}`, index]
      );
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.floor_setup',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, input.locationId, JSON.stringify({ tableCount })]
    );
    await client.query("COMMIT");
    return listRestaurantFloor(input.tenantId, input.locationId);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function openRestaurantCheck(input: {
  tenantId: string;
  locationId: string;
  deviceId: string;
  shiftId: string;
  tableId: string;
  guestCount: number;
  note?: string | null;
  actorUserId: string;
}) {
  await requireRestaurantTenant(input.tenantId);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const shift = await client.query(
      `SELECT 1 FROM bms_pos_shifts
        WHERE tenant_id = $1 AND id = $2 AND device_id = $3 AND location_id = $4 AND status = 'OPEN'
        FOR UPDATE`,
      [input.tenantId, input.shiftId, input.deviceId, input.locationId]
    );
    if (!shift.rowCount) throw new Error("ต้องเปิดกะของเครื่องนี้ก่อนเปิดโต๊ะ");
    const table = await client.query(
      `SELECT 1 FROM bms_restaurant_tables
        WHERE tenant_id = $1 AND id = $2 AND location_id = $3 AND active AND NOT blocked
        FOR UPDATE`,
      [input.tenantId, input.tableId, input.locationId]
    );
    if (!table.rowCount) throw new Error("โต๊ะนี้ไม่พร้อมใช้งาน");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bms_restaurant_checks
         (tenant_id, location_id, table_id, pos_device_id, pos_shift_id, guest_count, note, opened_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [input.tenantId, input.locationId, input.tableId, input.deviceId, input.shiftId,
        Math.min(Math.max(Math.trunc(input.guestCount), 1), 500), input.note?.trim() || null, input.actorUserId]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.check_open',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, inserted.rows[0].id,
        JSON.stringify({ tableId: input.tableId, guestCount: input.guestCount })]
    );
    await client.query("COMMIT");
    return getRestaurantCheck(input.tenantId, inserted.rows[0].id);
  } catch (error: any) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error?.code === "23505") throw new Error("โต๊ะนี้มีบิลเปิดอยู่แล้ว");
    throw error;
  } finally {
    client.release();
  }
}

export async function getRestaurantCheck(tenantId: string, checkId: string, locationId?: string | null) {
  const result = await query<any>(
    `SELECT c.*, t.code AS table_code, t.name AS table_name, a.name AS area_name
       FROM bms_restaurant_checks c
       JOIN bms_restaurant_tables t ON t.tenant_id = c.tenant_id AND t.id = c.table_id
       JOIN bms_restaurant_areas a ON a.tenant_id = t.tenant_id AND a.id = t.area_id
      WHERE c.tenant_id = $1 AND c.id = $2
        AND ($3::uuid IS NULL OR c.location_id = $3)`,
    [tenantId, checkId, locationId ?? null]
  );
  if (!result.rowCount) return null;
  const itemResult = await query<CheckItemRow>(
    `SELECT id, product_sku, product_name, size, pack_qty, pack_code, unit_name,
            base_qty, pack_price, modifier_codes, modifier_names, kitchen_note,
            status, round_no, created_at, sent_at
       FROM bms_restaurant_check_items
      WHERE tenant_id = $1 AND check_id = $2 AND status <> 'CANCELLED'
      ORDER BY created_at, id`,
    [tenantId, checkId]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    tableId: row.table_id,
    tableCode: row.table_code,
    tableName: row.table_name,
    areaName: row.area_name,
    status: row.status,
    guestCount: Number(row.guest_count),
    note: row.note,
    amountDue: Number(row.amount_due),
    version: Number(row.version),
    reservedVersion: row.reserved_version == null ? null : Number(row.reserved_version),
    hasCurrentOrder: Boolean(row.current_order_id),
    openedAt: iso(row.opened_at),
    items: itemResult.rows.map(mapCheckItem),
  };
}

export async function addRestaurantCheckItem(input: {
  tenantId: string;
  locationId: string;
  checkId: string;
  actorUserId: string;
  sku: string;
  size?: string | null;
  packCode?: string | null;
  packQty: number;
  modifierCodes?: string[] | null;
  kitchenNote?: string | null;
}) {
  const hit = await resolvePosScan(input.tenantId, input.sku, {
    locationId: input.locationId,
    size: input.size ?? null,
    packCode: input.packCode ?? null,
  });
  if (!hit) throw new Error("ไม่พบเมนูหรือหน่วยขายนี้");
  const allowed = new Map(hit.modifiers.map((modifier) => [modifier.code, modifier.name]));
  const modifierCodes = Array.from(new Set((input.modifierCodes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean))).sort();
  const invalid = modifierCodes.find((code) => !allowed.has(code));
  if (invalid) throw new Error(`ตัวเลือก ${invalid} ไม่ได้เปิดใช้กับเมนูนี้`);
  const packQty = Math.min(Math.max(Math.trunc(input.packQty), 1), 9999);

  return withCheckLock(input.tenantId, input.checkId, async () => {
    const client = await getClient();
    try {
      await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
      await lockCheckInTx(client, input.tenantId, input.checkId);
      const check = await client.query(
        `SELECT 1 FROM bms_restaurant_checks
          WHERE tenant_id = $1 AND id = $2 AND location_id = $3 AND status = 'OPEN'
          FOR UPDATE`,
        [input.tenantId, input.checkId, input.locationId]
      );
      if (!check.rowCount) throw new Error("บิลนี้ไม่อยู่ในสถานะที่เพิ่มอาหารได้");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bms_restaurant_check_items
           (tenant_id, check_id, product_sku, product_name, size, pack_qty,
            pack_code, unit_name, base_qty, pack_price, modifier_codes,
            modifier_names, kitchen_note, added_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [input.tenantId, input.checkId, hit.sku, hit.productName, hit.size, packQty,
          hit.packCode, hit.unitName, hit.baseQty, hit.packPrice, modifierCodes,
          modifierCodes.map((code) => allowed.get(code) ?? code), input.kitchenNote?.trim() || null,
          input.actorUserId]
      );
      await client.query(
        `UPDATE bms_restaurant_checks
            SET version = version + 1, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.checkId]
      );
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'restaurant.item_add',$3,$4::jsonb)`,
        [input.tenantId, `user:${input.actorUserId}`, input.checkId,
          JSON.stringify({ itemId: inserted.rows[0].id, sku: hit.sku, size: hit.size,
            packCode: hit.packCode, packQty, modifierCount: modifierCodes.length })]
      );
      await client.query("COMMIT");
      return getRestaurantCheck(input.tenantId, input.checkId);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  });
}

/**
 * แก้จำนวนลูกค้าของบิลที่เปิดอยู่ (เช่น กรอกผิดตอนเปิดโต๊ะ หรือมีคนมาเพิ่ม)
 *
 * **ไม่ขยับ `version` โดยตั้งใจ** — version คือ "เนื้อหาที่สั่ง" ซึ่งผูกกับคีย์กันบิลซ้ำ
 * ของออร์เดอร์จอง (`restaurant:<id>:v<version>`) จำนวนคนไม่เปลี่ยนของที่ครัวต้องทำ
 * และไม่เปลี่ยนเงิน การขยับ version จะทำให้รอบที่ส่งครัวไปแล้วถูกมองว่าเก่าโดยไม่มีเหตุ
 */
export async function setRestaurantCheckGuestCount(input: {
  tenantId: string;
  locationId: string;
  checkId: string;
  actorUserId: string;
  guestCount: number;
}) {
  const guestCount = Math.min(Math.max(Math.trunc(input.guestCount), 1), 500);
  return withCheckLock(input.tenantId, input.checkId, async () => {
    const client = await getClient();
    try {
      await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
      await lockCheckInTx(client, input.tenantId, input.checkId);
      const updated = await client.query<{ guest_count: number }>(
        `UPDATE bms_restaurant_checks
            SET guest_count = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND location_id = $3 AND status IN ('OPEN', 'CLOSING')
        RETURNING guest_count`,
        [input.tenantId, input.checkId, input.locationId, guestCount]
      );
      if (!updated.rowCount) throw new Error("บิลนี้ไม่อยู่ในสาขาหรือสถานะที่แก้จำนวนคนได้");
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'restaurant.guest_count',$3,$4::jsonb)`,
        [input.tenantId, `user:${input.actorUserId}`, input.checkId, JSON.stringify({ guestCount })]
      );
      await client.query("COMMIT");
      return getRestaurantCheck(input.tenantId, input.checkId);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function removeRestaurantCheckItem(input: {
  tenantId: string;
  locationId: string;
  checkId: string;
  itemId: string;
  actorUserId: string;
}) {
  return withCheckLock(input.tenantId, input.checkId, async () => {
    const client = await getClient();
    try {
      await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
      await lockCheckInTx(client, input.tenantId, input.checkId);
      const removed = await client.query(
        `UPDATE bms_restaurant_check_items i
            SET status = 'CANCELLED', updated_at = now()
           FROM bms_restaurant_checks c
          WHERE i.tenant_id = $1 AND i.id = $2 AND i.check_id = $3 AND i.status = 'NEW'
            AND c.tenant_id = i.tenant_id AND c.id = i.check_id AND c.status = 'OPEN'
            AND c.location_id = $4
          RETURNING i.id`,
        [input.tenantId, input.itemId, input.checkId, input.locationId]
      );
      if (!removed.rowCount) throw new Error("ลบได้เฉพาะรายการที่ยังไม่ส่งครัว");
      await client.query(
        `UPDATE bms_restaurant_checks SET version = version + 1, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.checkId]
      );
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'restaurant.item_remove',$3,$4::jsonb)`,
        [input.tenantId, `user:${input.actorUserId}`, input.checkId,
          JSON.stringify({ itemId: input.itemId })]
      );
      await client.query("COMMIT");
      return getRestaurantCheck(input.tenantId, input.checkId);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  });
}

function toOrderItem(row: CheckItemRow): OrderItemInput {
  const baseQty = Math.max(1, Number(row.base_qty ?? 1));
  return {
    sku: row.product_sku,
    size: row.size,
    qty: Number(row.pack_qty) * baseQty,
    packCode: row.pack_code,
    packUnitName: row.unit_name,
    packQty: Number(row.pack_qty),
    packUnitPrice: row.pack_price == null ? null : Number(row.pack_price),
    modifierCodes: row.modifier_codes ?? [],
  };
}

function toPosLine(row: CheckItemRow): PosSaleLine {
  return {
    sku: row.product_sku,
    size: row.size,
    packQty: Number(row.pack_qty),
    packCode: row.pack_code,
    unitName: row.unit_name,
    baseQty: row.base_qty == null ? null : Number(row.base_qty),
    packPrice: row.pack_price == null ? null : Number(row.pack_price),
    modifierCodes: row.modifier_codes ?? [],
  };
}

export async function sendRestaurantKitchenRound(input: {
  tenantId: string;
  locationId: string;
  deviceId: string;
  shiftId: string;
  checkId: string;
  actorUserId: string;
}): Promise<{ status: "SENT"; check: Awaited<ReturnType<typeof getRestaurantCheck>>; kitchenTickets: number } | CreateOrderResult> {
  return withCheckLock(input.tenantId, input.checkId, async () => {
    const client = await getClient();
    try {
      await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
      // createOrderInTx และ finalizePosSale ล็อกกะก่อนสต็อกเสมอ การแทน reservation
      // จึงต้องยึดลำดับเดียวกันก่อน cancelOrderInTx ไปแตะแถว inventory
      await client.query(
        `SELECT 1 FROM bms_pos_shifts WHERE tenant_id = $1 AND id = $2 FOR KEY SHARE`,
        [input.tenantId, input.shiftId]
      );
      await lockCheckInTx(client, input.tenantId, input.checkId);
      // ทุกขั้นตั้งแต่คืน reservation รุ่นก่อนจนผูก order รุ่นใหม่อยู่ใน transaction เดียวกัน
      // ถ้ารอบใหม่จองไม่ได้ ROLLBACK จะเก็บ order+reservation เดิมไว้ให้ครัวที่กำลังทำต่อได้
      const checkResult = await client.query<any>(
        `SELECT * FROM bms_restaurant_checks
          WHERE tenant_id = $1 AND id = $2 AND location_id = $3 AND status = 'OPEN'
          FOR UPDATE`,
        [input.tenantId, input.checkId, input.locationId]
      );
      if (!checkResult.rowCount) throw new Error("บิลนี้ไม่อยู่ในสาขาหรือสถานะที่ส่งครัวได้");
      const check = checkResult.rows[0];
      const items = await client.query<CheckItemRow>(
        `SELECT * FROM bms_restaurant_check_items
          WHERE tenant_id = $1 AND check_id = $2 AND status <> 'CANCELLED'
          ORDER BY created_at, id
          FOR UPDATE`,
        [input.tenantId, input.checkId]
      );
      if (!items.rowCount) throw new Error("ยังไม่มีรายการอาหารในบิล");
      const unsent = items.rows.filter((item) => item.status === "NEW");
      if (unsent.length === 0 && check.current_order_id
          && Number(check.reserved_version) === Number(check.version)) {
        await client.query("COMMIT");
        return {
          status: "SENT" as const,
          check: await getRestaurantCheck(input.tenantId, input.checkId),
          kitchenTickets: 0,
        };
      }

      if (check.current_order_id) {
        const cancelled = await cancelOrderInTx(client, input.tenantId, check.current_order_id);
        if (!cancelled) throw new Error("บิลจองเดิมไม่อยู่ในสถานะที่สร้างรอบใหม่ได้");
        // คีย์ผูกกับเนื้อหา check version เดิม ต้องคืนพร้อม order ที่ถูกแทนที่
        await client.query(
          `UPDATE bms_orders SET idempotency_key = NULL, updated_at = now()
            WHERE tenant_id = $1 AND id = $2 AND status = 'CANCELLED'`,
          [input.tenantId, check.current_order_id]
        );
      }

      const reservationKey = `restaurant:${input.checkId}:v${check.version}`;
      const created = await createOrderInTx(client, {
        tenantId: input.tenantId,
        channel: "pos",
        items: items.rows.map(toOrderItem),
        locationId: input.locationId,
        posDeviceId: input.deviceId,
        posShiftId: input.shiftId,
        cashierUserId: input.actorUserId,
        editorId: input.actorUserId,
        idempotencyKey: reservationKey,
        restaurantCheckId: input.checkId,
      });
      if (created.status !== "CREATED") {
        await client.query("ROLLBACK");
        return created;
      }

      const round = await client.query<{ next_round: number }>(
        `SELECT COALESCE(MAX(round_no), 0) + 1 AS next_round
           FROM bms_restaurant_check_items
          WHERE tenant_id = $1 AND check_id = $2`,
        [input.tenantId, input.checkId]
      );
      const roundNo = Number(round.rows[0].next_round);
      const sent = await client.query<{ id: string }>(
        `UPDATE bms_restaurant_check_items
            SET status = 'SENT', round_no = $3, sent_by = $4, sent_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND check_id = $2 AND status = 'NEW'
          RETURNING id`,
        [input.tenantId, input.checkId, roundNo, input.actorUserId]
      );
      // ตั๋วครัวของบิลโต๊ะครอบ **ทุกรายการที่ส่ง** ไม่ใช่เฉพาะเมนูที่มีสูตร (RECIPE)
      //
      // เส้นทาง retail (enqueueKitchenTicketsInTx) กรอง RECIPE เพราะบิลค้าปลีกมี SKU ที่
      // ไม่ใช่อาหารปนอยู่เต็มไปหมด · บิลโต๊ะไม่ใช่แบบนั้น: ทุกบรรทัดคือของที่ต้องมีคนยกไป
      // เสิร์ฟ · กรอง RECIPE ที่นี่ = น้ำเปล่า/เบียร์/ของหวานสำเร็จรูปไม่โผล่บนจอครัว-บาร์เลย
      // และร้านที่ยังไม่ได้ผูกสูตรให้เมนูไหนเลยจะเห็นจอครัวว่างทั้งที่ออร์เดอร์วิ่งอยู่ ซึ่ง
      // อ่านได้ว่า "ระบบพัง" · station เป็น NULL ได้ตามเดิม (จอมีช่อง "ไม่ระบุ station")
      const kitchenOn = await isCapabilityEnabledInTx(client, input.tenantId, "KITCHEN_WORKFLOW");
      const tickets = kitchenOn && sent.rowCount
        ? await client.query(
            `INSERT INTO bms_restaurant_kitchen_tickets
               (tenant_id, check_id, check_item_id, station)
             SELECT i.tenant_id, i.check_id, i.id, p.kitchen_station
               FROM bms_restaurant_check_items i
               LEFT JOIN bms_product_stock_policies p
                 ON p.tenant_id = i.tenant_id AND p.product_sku = i.product_sku
              WHERE i.tenant_id = $1 AND i.check_id = $2 AND i.id = ANY($3::uuid[])
             ON CONFLICT (tenant_id, check_item_id) DO NOTHING`,
            [input.tenantId, input.checkId, sent.rows.map((row) => row.id)]
          )
        : { rowCount: 0 };
      // ประทับเครื่อง/กะที่ให้บริการรอบนี้ลงบนบิลโต๊ะ — ยอดขายและค่าคอมต้องไปอยู่กับกะที่
      // ทำงานจริง (กฎเดียวกับบิลมัดจำที่ 9.0 ประทับใหม่ตอนส่งของ)
      const linked = await client.query(
        `UPDATE bms_restaurant_checks
            SET current_order_id = $3, reserved_version = version,
                amount_due = $4, pos_device_id = $6, pos_shift_id = $7, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN' AND version = $5`,
        [input.tenantId, input.checkId, created.orderId, created.amountDue, check.version,
          input.deviceId, input.shiftId]
      );
      if (!linked.rowCount) throw new Error("บิลเปลี่ยนระหว่างส่งครัว กรุณาลองใหม่");
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'restaurant.kitchen_send',$3,$4::jsonb)`,
        [input.tenantId, `user:${input.actorUserId}`, input.checkId,
          JSON.stringify({ roundNo, itemCount: sent.rowCount, orderId: created.orderId })]
      );
      await client.query("COMMIT");
      return {
        status: "SENT" as const,
        check: await getRestaurantCheck(input.tenantId, input.checkId),
        kitchenTickets: tickets.rowCount ?? 0,
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function moveRestaurantCheck(input: {
  tenantId: string;
  locationId: string;
  checkId: string;
  targetTableId: string;
  actorUserId: string;
}) {
  return withCheckLock(input.tenantId, input.checkId, async () => {
    const client = await getClient();
    try {
      await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
      await lockCheckInTx(client, input.tenantId, input.checkId);
      const moved = await client.query<{ previous_table_id: string }>(
        `WITH current AS (
           SELECT table_id AS previous_table_id FROM bms_restaurant_checks
            WHERE tenant_id = $1 AND id = $2 AND location_id = $3 AND status = 'OPEN'
            FOR UPDATE
         )
         UPDATE bms_restaurant_checks c
            SET table_id = $4, updated_at = now()
           FROM current
          WHERE c.tenant_id = $1 AND c.id = $2
            AND EXISTS (
              SELECT 1 FROM bms_restaurant_tables t
               WHERE t.tenant_id = $1 AND t.id = $4 AND t.location_id = $3 AND t.active AND NOT t.blocked
            )
          RETURNING current.previous_table_id`,
        [input.tenantId, input.checkId, input.locationId, input.targetTableId]
      );
      if (!moved.rowCount) throw new Error("ย้ายโต๊ะไม่ได้");
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'restaurant.check_move',$3,$4::jsonb)`,
        [input.tenantId, `user:${input.actorUserId}`, input.checkId,
          JSON.stringify({ from: moved.rows[0].previous_table_id, to: input.targetTableId })]
      );
      await client.query("COMMIT");
      return getRestaurantCheck(input.tenantId, input.checkId);
    } catch (error: any) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error?.code === "23505") throw new Error("โต๊ะปลายทางมีบิลเปิดอยู่แล้ว");
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function cancelRestaurantCheck(input: {
  tenantId: string;
  locationId: string;
  checkId: string;
  actorUserId: string;
  reason: string;
  approvedByUserId?: string | null;
}) {
  return withCheckLock(input.tenantId, input.checkId, async () => {
    const client = await getClient();
    let releasedOrderId: string | null = null;
    try {
      await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
      await lockCheckInTx(client, input.tenantId, input.checkId);
      // order, reservation, kitchen tickets, check และ audit ต้องยกเลิกพร้อมกัน
      // ไม่เช่นนั้น transaction หลังล้มจะเหลือโต๊ะ OPEN ที่ไม่มี stock reservation รองรับ
      const current = await client.query<{
        current_order_id: string | null;
        requires_void_approval: boolean;
      }>(
        `SELECT c.current_order_id,
                (c.current_order_id IS NOT NULL OR EXISTS (
                  SELECT 1 FROM bms_restaurant_check_items i
                   WHERE i.tenant_id = c.tenant_id AND i.check_id = c.id
                     AND i.status = 'SENT'
                )) AS requires_void_approval
           FROM bms_restaurant_checks c
          WHERE c.tenant_id = $1 AND c.id = $2 AND c.location_id = $3
            AND c.status IN ('OPEN','CLOSING')
            AND (
              c.status = 'OPEN'
              OR COALESCE(c.settlement_started_at, '-infinity'::timestamptz)
                   < now() - ($4::int * interval '1 minute')
            )
            AND NOT EXISTS (
              SELECT 1 FROM bms_orders o
               WHERE o.tenant_id = c.tenant_id AND o.restaurant_check_id = c.id
                 AND o.status NOT IN ('PENDING','CANCELLED')
            )
          FOR UPDATE`,
        [input.tenantId, input.checkId, input.locationId, SETTLEMENT_LEASE_MINUTES]
      );
      if (!current.rowCount) {
        const state = await client.query<{ status: string }>(
          `SELECT status FROM bms_restaurant_checks
            WHERE tenant_id = $1 AND id = $2 AND location_id = $3`,
          [input.tenantId, input.checkId, input.locationId]
        );
        if (state.rows[0]?.status === "CLOSING") {
          throw new Error("บิลนี้กำลังรับชำระเงิน กรุณารอให้รายการเดิมเสร็จหรือลองใหม่ภายหลัง");
        }
        throw new Error("บิลนี้ยกเลิกไม่ได้ (ปิดไปแล้วหรือเก็บเงินแล้ว)");
      }
      if (current.rows[0].requires_void_approval && (
        !input.approvedByUserId || input.approvedByUserId === input.actorUserId
      )) {
        throw new Error("บิลที่ส่งครัวหรือจองสต็อกแล้วต้องให้ผู้มีสิทธิ์ pos.void คนที่สองอนุมัติ");
      }
      releasedOrderId = current.rows[0].current_order_id;
      if (releasedOrderId) {
        const cancelled = await cancelOrderInTx(client, input.tenantId, releasedOrderId);
        if (!cancelled) throw new Error("บิลจองเดิมไม่อยู่ในสถานะที่ยกเลิกได้");
        await client.query(
          `UPDATE bms_orders SET idempotency_key = NULL, updated_at = now()
            WHERE tenant_id = $1 AND id = $2 AND status = 'CANCELLED'`,
          [input.tenantId, releasedOrderId]
        );
      }
      await client.query(
        `UPDATE bms_restaurant_kitchen_tickets
            SET status = 'CANCELLED', updated_at = now()
          WHERE tenant_id = $1 AND check_id = $2 AND status IN ('NEW','PREPARING','READY')`,
        [input.tenantId, input.checkId]
      );
      await client.query(
        `UPDATE bms_restaurant_checks
            SET status = 'CANCELLED', closed_by = $3, closed_at = now(),
                settlement_attempt_id = NULL, settlement_started_at = NULL,
                note = concat_ws(E'\n', note, $4::text), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status IN ('OPEN','CLOSING')`,
        [input.tenantId, input.checkId, input.actorUserId, `ยกเลิก: ${input.reason.trim().slice(0, 300)}`]
      );
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'restaurant.check_cancel',$3,$4::jsonb)`,
        [input.tenantId, `user:${input.actorUserId}`, input.checkId,
          JSON.stringify({
            reason: input.reason.trim().slice(0, 300),
            approvedByUserId: input.approvedByUserId ?? null,
          })]
      );
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
    if (releasedOrderId) {
      await afterOrderCancellationCommitted(input.tenantId, releasedOrderId).catch((error) => {
        // transaction ยกเลิกเสร็จแล้ว งานแจ้งเตือนหลัง commit ล้มต้องไม่หลอก POS ว่าบิลยังอยู่
        console.error("[restaurant] งานหลังยกเลิก order ไม่สำเร็จ", {
          checkId: input.checkId,
          orderId: releasedOrderId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return { status: "CANCELLED" as const };
  });
}

/** คืนบิลที่ค้างระหว่างเก็บเงินให้กลับมาแก้ไข/ยกเลิกได้ (CLOSING เป็นสถานะชั่วคราวเท่านั้น) */
async function reopenClosingCheck(
  tenantId: string,
  checkId: string,
  actorUserId: string,
  settlementAttemptId: string
) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    await lockCheckInTx(client, tenantId, checkId);
    await client.query(
      `UPDATE bms_restaurant_checks c
          SET status = 'OPEN', settlement_attempt_id = NULL,
              settlement_started_at = NULL, updated_at = now()
        WHERE c.tenant_id = $1 AND c.id = $2 AND c.status = 'CLOSING'
          AND c.settlement_attempt_id = $3
          AND EXISTS (
            SELECT 1 FROM bms_orders o
             WHERE o.tenant_id = c.tenant_id AND o.id = c.current_order_id
               AND o.status = 'PENDING'
          )`,
      [tenantId, checkId, settlementAttemptId]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function settleRestaurantCheck(input: {
  tenantId: string;
  locationId: string;
  deviceId: string;
  shiftId: string;
  checkId: string;
  actorUserId: string;
  payments: PosPaymentInput[];
}): Promise<PosSaleResult> {
  return withCheckLock(input.tenantId, input.checkId, async () => {
    // Prepare settlement in one locked tenant transaction. The process mutex above only protects
    // this instance; without the xact advisory lock two registers on different instances could
    // overwrite cashier/shift on the same PENDING order immediately before finalizePosSale locks it.
    const settlementAttemptId = randomUUID();
    let key = "";
    let items: { rows: CheckItemRow[] } = { rows: [] };
    const prepare = await getClient();
    try {
      await beginTenantTx(prepare, input.tenantId, { editorId: input.actorUserId });
      const shift = await prepare.query(
        `SELECT 1 FROM bms_pos_shifts
          WHERE tenant_id = $1 AND id = $2 AND device_id = $3 AND location_id = $4
            AND status = 'OPEN'
          FOR KEY SHARE`,
        [input.tenantId, input.shiftId, input.deviceId, input.locationId]
      );
      if (!shift.rowCount) throw new Error("กะของเครื่องนี้ไม่ได้เปิดอยู่");
      await lockCheckInTx(prepare, input.tenantId, input.checkId);
      const checkResult = await prepare.query<any>(
        `SELECT c.*, o.status AS order_status, o.idempotency_key AS order_key,
                o.pos_device_id AS order_device_id, o.pos_shift_id AS order_shift_id,
                o.cashier_user_id AS order_cashier_user_id
           FROM bms_restaurant_checks c
           JOIN bms_orders o
             ON o.tenant_id = c.tenant_id AND o.id = c.current_order_id
          WHERE c.tenant_id = $1 AND c.id = $2 AND c.location_id = $3
            AND c.status IN ('OPEN','CLOSING','PAID')
          FOR UPDATE OF c, o`,
        [input.tenantId, input.checkId, input.locationId]
      );
      if (!checkResult.rowCount) throw new Error("บิลนี้ไม่ได้เปิดอยู่ในสาขาของเครื่องนี้");
      const check = checkResult.rows[0];
      if (!check.current_order_id || Number(check.reserved_version) !== Number(check.version)) {
        throw new Error("มีรายการที่ยังไม่ส่งครัว กรุณาส่งครัวก่อนคิดเงิน");
      }
      key = String(check.order_key ?? "").trim();
      if (!key) throw new Error("บิลจองนี้ไม่มี idempotency key จึงไม่สามารถเก็บเงินอย่างปลอดภัยได้");

      if ((check.status === "CLOSING" || check.status === "PAID") && (
        check.order_device_id !== input.deviceId
        || check.order_shift_id !== input.shiftId
        || check.order_cashier_user_id !== input.actorUserId
      )) {
        throw new Error("บิลนี้ถูกคิดเงินที่เครื่องอื่นแล้ว กรุณาเปิดใบเสร็จจากเครื่องเดิม");
      }

      if (
        check.status === "CLOSING"
        && check.settlement_started_at
        && new Date(check.settlement_started_at).getTime()
          >= Date.now() - SETTLEMENT_LEASE_MINUTES * 60_000
      ) {
        throw new Error("บิลนี้กำลังรับชำระเงิน กรุณารอผลรายการเดิมก่อนลองใหม่");
      }

      if (check.order_status === "PENDING") {
        // CLOSING may be an idempotent retry after a lost response. Only the same register request
        // may continue it; another cashier/device must wait instead of stealing the order identity.
        const restamped = await prepare.query(
          `UPDATE bms_orders
              SET pos_device_id = $3, pos_shift_id = $4, cashier_user_id = $5,
                  idempotency_key = COALESCE(idempotency_key, $7), updated_at = now()
            WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'
              AND restaurant_check_id = $6`,
          [input.tenantId, check.current_order_id, input.deviceId, input.shiftId,
            input.actorUserId, input.checkId, key]
        );
        if (!restamped.rowCount) throw new Error("บิลจองเปลี่ยนสถานะระหว่างเริ่มคิดเงิน");
      } else if (!(
        (check.status === "CLOSING" || check.status === "PAID")
        && check.order_status === "COMPLETED"
      )) {
        throw new Error(`บิลจองของโต๊ะนี้อยู่สถานะ ${check.order_status ?? "ไม่พบ"} คิดเงินซ้ำไม่ได้`);
      }

      items = await prepare.query<CheckItemRow>(
        `SELECT * FROM bms_restaurant_check_items
          WHERE tenant_id = $1 AND check_id = $2 AND status = 'SENT'
          ORDER BY created_at, id`,
        [input.tenantId, input.checkId]
      );
      if (!items.rows.length) throw new Error("บิลนี้ไม่มีรายการที่ส่งครัวแล้ว");
      if (check.status !== "PAID") {
        const claimed = await prepare.query(
          `UPDATE bms_restaurant_checks
              SET status = 'CLOSING', settlement_idempotency_key = $3,
                  pos_device_id = $4, pos_shift_id = $5,
                  settlement_attempt_id = $7, settlement_started_at = now(), updated_at = now()
            WHERE tenant_id = $1 AND id = $2
              AND (
                status = 'OPEN'
                OR (
                  status = 'CLOSING'
                  AND COALESCE(settlement_started_at, '-infinity'::timestamptz)
                    < now() - ($6::int * interval '1 minute')
                )
              )`,
          [input.tenantId, input.checkId, key, input.deviceId, input.shiftId,
            SETTLEMENT_LEASE_MINUTES, settlementAttemptId]
        );
        if (!claimed.rowCount) throw new Error("บิลนี้มีรายการรับชำระเงินอื่นกำลังทำงานอยู่");
      }
      await prepare.query("COMMIT");
    } catch (error) {
      try { await prepare.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      prepare.release();
    }

    // บิลค้างที่ CLOSING แก้รายการไม่ได้และยกเลิกไม่ได้ — ถ้าการเก็บเงิน throw (เน็ต/ฐานล้ม)
    // แล้วไม่คืนสถานะ โต๊ะนั้นจะค้างใช้งานไม่ได้ตลอดไป จึงคืนเป็น OPEN ทุกทางออกที่ไม่ใช่ SOLD
    const result = await recordPosSale({
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      shiftId: input.shiftId,
      cashierUserId: input.actorUserId,
      idempotencyKey: key,
      restaurantCheckId: input.checkId,
      restaurantSettlementAttemptId: settlementAttemptId,
      lines: items.rows.map(toPosLine),
      payments: input.payments,
    }).catch(async (error) => {
      await reopenClosingCheck(
        input.tenantId,
        input.checkId,
        input.actorUserId,
        settlementAttemptId
      );
      throw error;
    });
    if (result.status !== "SOLD") {
      await reopenClosingCheck(
        input.tenantId,
        input.checkId,
        input.actorUserId,
        settlementAttemptId
      );
    }
    return result;
  });
}
