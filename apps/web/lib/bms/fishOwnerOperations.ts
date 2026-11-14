import { createHash } from "node:crypto";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { isCapabilityEnabledInTx } from "./storeCapabilities";

export class FishOwnerError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ZONES = ["READY", "COLD_ROOM", "OTHER"] as const;
export type FishZone = typeof ZONES[number];

function uuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new FishOwnerError("INVALID_INPUT", `${name} ไม่ถูกต้อง`);
  return value;
}
function grams(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 2147483647)
    throw new FishOwnerError("INVALID_WEIGHT", "น้ำหนักต้องเป็นจำนวนกรัมที่ถูกต้อง");
  return Number(value);
}
function text(value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max)
    throw new FishOwnerError("INVALID_INPUT", "ข้อความไม่ถูกต้องหรือยาวเกินกำหนด");
  return value.trim() || null;
}
function date(value: unknown): string | null {
  const v = text(value, 10);
  if (!v) return null;
  const d = ISO.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v)
    throw new FishOwnerError("INVALID_DATE", "วันที่ไม่ถูกต้อง");
  return v;
}
async function assertAllowedLocation(client: Awaited<ReturnType<typeof getClient>>, tenant: string, actor: string, location: string) {
  const allowed = await client.query(
    `SELECT 1 FROM bms_locations l WHERE l.tenant_id=$1 AND l.id=$2 AND l.active
       AND (NOT EXISTS (SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$3)
         OR EXISTS (SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$3 AND a.location_id=l.id))`,
    [tenant, location, actor],
  );
  if (!allowed.rowCount) throw new FishOwnerError("LOCATION_FORBIDDEN", "ไม่มีสิทธิ์ในสาขานี้หรือสาขาไม่ได้เปิดใช้งาน");
}

export type StorageCountInput = {
  lotId: string;
  expectedLotGrams: number;
  expectedVersion: number | null;
  zones: Array<{ zone: FishZone; grams: number }>;
};

/** Physical placement evidence only; never changes inventory. The snapshot becomes stale on any later lot change. */
export async function saveFishStorageCount(tenant: string, actor: string, raw: StorageCountInput) {
  if (!raw || typeof raw !== "object") throw new FishOwnerError("INVALID_INPUT", "ข้อมูลตรวจนับไม่ถูกต้อง");
  const lotId = uuid(raw?.lotId, "ล็อต");
  const expected = grams(raw?.expectedLotGrams);
  if (raw.expectedVersion !== null && (!Number.isInteger(raw.expectedVersion) || raw.expectedVersion < 1))
    throw new FishOwnerError("INVALID_INPUT", "รุ่นข้อมูลไม่ถูกต้อง");
  if (!Array.isArray(raw.zones) || raw.zones.length < 1 || raw.zones.length > 3)
    throw new FishOwnerError("INVALID_INPUT", "ต้องระบุตำแหน่งปลา");
  const seen = new Set<string>();
  const zones = raw.zones.map(row => {
    if (!row || !ZONES.includes(row.zone) || seen.has(row.zone))
      throw new FishOwnerError("INVALID_INPUT", "ตำแหน่งปลาซ้ำหรือไม่ถูกต้อง");
    seen.add(row.zone);
    return { zone: row.zone, grams: grams(row.grams) };
  });
  if (zones.reduce((sum, row) => sum + row.grams, 0) !== expected)
    throw new FishOwnerError("WEIGHT_MISMATCH", "น้ำหนักแยกตำแหน่งต้องเท่ากับน้ำหนักล็อตที่ตรวจนับ");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenant, { editorId: actor });
    const lot = (await client.query<{ location_id: string; qty: number; updated_at: Date; stock_policy: string | null; base_unit: string | null; lot_tracking: boolean | null }>(
      `SELECT l.location_id,l.qty,l.updated_at,sp.stock_policy,sp.base_unit,sp.lot_tracking
         FROM bms_inventory_lots l LEFT JOIN bms_product_stock_policies sp
           ON sp.tenant_id=l.tenant_id AND sp.product_sku=l.product_sku
        WHERE l.tenant_id=$1 AND l.id=$2 FOR UPDATE OF l`,
      [tenant, lotId],
    )).rows[0];
    if (!lot) throw new FishOwnerError("LOT_NOT_FOUND", "ไม่พบล็อตนี้");
    await assertAllowedLocation(client, tenant, actor, lot.location_id);
    if (lot.stock_policy !== "WEIGHTED" || lot.base_unit !== "GRAM" || lot.lot_tracking !== true)
      throw new FishOwnerError("PRODUCT_NOT_READY", "ล็อตนี้ไม่ใช่สินค้าชั่งน้ำหนักหน่วยกรัมที่ติดตามล็อต");
    if (Number(lot.qty) !== expected) throw new FishOwnerError("STALE_LOT", "ยอดล็อตเปลี่ยนแล้ว กรุณาตรวจนับใหม่");
    const prior = (await client.query<{ id: string; version: number }>(
      `SELECT id,version FROM bms_fish_storage_counts WHERE tenant_id=$1 AND lot_id=$2 FOR UPDATE`,
      [tenant, lotId],
    )).rows[0];
    if ((prior?.version ?? null) !== raw.expectedVersion)
      throw new FishOwnerError("STALE_COUNT", "ข้อมูลตำแหน่งปลาเปลี่ยนแล้ว กรุณาโหลดใหม่");
    let countId: string;
    let version: number;
    if (prior) {
      const row = (await client.query<{ id: string; version: number }>(
        `UPDATE bms_fish_storage_counts SET lot_qty_at_count=$3,lot_updated_at_count=$4,version=version+1,
            counted_at=now(),counted_by=$5 WHERE tenant_id=$1 AND id=$2 RETURNING id,version`,
        [tenant, prior.id, expected, lot.updated_at, actor],
      )).rows[0];
      countId = row.id; version = row.version;
      await client.query(`DELETE FROM bms_fish_storage_count_lines WHERE tenant_id=$1 AND count_id=$2`, [tenant, countId]);
    } else {
      const row = (await client.query<{ id: string; version: number }>(
        `INSERT INTO bms_fish_storage_counts(tenant_id,lot_id,location_id,lot_qty_at_count,lot_updated_at_count,counted_by)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version`,
        [tenant, lotId, lot.location_id, expected, lot.updated_at, actor],
      )).rows[0];
      countId = row.id; version = row.version;
    }
    for (const row of zones) await client.query(
      `INSERT INTO bms_fish_storage_count_lines(tenant_id,count_id,zone,qty_grams) VALUES($1,$2,$3,$4)`,
      [tenant, countId, row.zone, row.grams],
    );
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
       VALUES($1,$2,'fish.storage.count',$3,$4::jsonb)`,
      [tenant, `user:${actor}`, countId, JSON.stringify({ lotId, version, totalGrams: expected, zones })],
    );
    await client.query("COMMIT");
    return { status: "SAVED" as const, countId, version };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export type DeliveryPlanInput = {
  customerId: string;
  locationId: string;
  dueOn?: string | null;
  note?: string | null;
  requestKey: string;
  lines: Array<{ sku: string; size: string; agreedGrams: number }>;
};

export async function createFishDeliveryPlan(tenant: string, actor: string, raw: DeliveryPlanInput) {
  if (!raw || typeof raw !== "object") throw new FishOwnerError("INVALID_INPUT", "ข้อมูลแผนส่งปลาไม่ถูกต้อง");
  const customerId = uuid(raw?.customerId, "ลูกค้า");
  const locationId = uuid(raw?.locationId, "สาขา");
  const dueOn = date(raw?.dueOn);
  const note = text(raw?.note, 1000);
  const requestKey = text(raw?.requestKey, 128);
  if (!requestKey || requestKey.length < 16) throw new FishOwnerError("INVALID_KEY", "รหัสคำขอไม่ถูกต้อง");
  if (!Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 100)
    throw new FishOwnerError("INVALID_LINES", "ต้องระบุปลา 1–100 รายการ");
  const keys = new Set<string>();
  const lines = raw.lines.map(line => {
    const sku = text(line?.sku, 120), size = text(line?.size, 64);
    const agreedGrams = grams(line?.agreedGrams);
    if (!sku || !size || agreedGrams === 0 || keys.has(`${sku}\0${size}`))
      throw new FishOwnerError("INVALID_LINES", "สินค้า/ไซซ์ไม่ถูกต้องหรือซ้ำกัน");
    keys.add(`${sku}\0${size}`);
    return { sku, size, agreedGrams };
  });
  const requestHash = createHash("sha256").update(JSON.stringify({ customerId, locationId, dueOn, note, lines })).digest("hex");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenant, { editorId: actor });
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,10120))`, [`${tenant}:fish-plan:${requestKey}`]);
    const prior = (await client.query<{ id: string; request_hash: string }>(
      `SELECT id,request_hash FROM bms_fish_delivery_plans WHERE tenant_id=$1 AND request_key=$2`,
      [tenant, requestKey],
    )).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw new FishOwnerError("IDEMPOTENCY_CONFLICT", "รหัสคำขอนี้เคยใช้กับข้อมูลอื่น");
      await client.query("COMMIT");
      return { status: "REPLAYED" as const, planId: prior.id };
    }
    await assertAllowedLocation(client, tenant, actor, locationId);
    if (!(await isCapabilityEnabledInTx(client, tenant, "WEIGHTED_PRODUCT")))
      throw new FishOwnerError("WEIGHTED_PRODUCT_DISABLED", "ต้องเปิดใช้งานสินค้าชั่งน้ำหนักก่อนสร้างแผนส่งปลา");
    const customer = await client.query(
      `SELECT 1 FROM bms_customers WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [tenant, customerId],
    );
    if (!customer.rowCount) throw new FishOwnerError("CUSTOMER_NOT_FOUND", "ไม่พบลูกค้าในร้านนี้");
    for (const line of lines) {
      const product = await client.query(
        `SELECT 1 FROM bms_products p JOIN bms_product_stock_policies sp
           ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku
         JOIN bms_product_variants v ON v.tenant_id=p.tenant_id AND v.product_sku=p.sku
         WHERE p.tenant_id=$1 AND p.sku=$2 AND p.active AND v.code=$3 AND v.active
           AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking`,
        [tenant, line.sku, line.size],
      );
      if (!product.rowCount) throw new FishOwnerError("PRODUCT_NOT_READY", `${line.sku}/${line.size}: ยังไม่พร้อมขายแบบชั่งน้ำหนัก`);
    }
    const plan = (await client.query<{ id: string }>(
      `INSERT INTO bms_fish_delivery_plans(tenant_id,location_id,customer_id,request_key,request_hash,due_on,note,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tenant, locationId, customerId, requestKey, requestHash, dueOn, note, actor],
    )).rows[0];
    for (const line of lines) await client.query(
      `INSERT INTO bms_fish_delivery_plan_lines(tenant_id,plan_id,sku,size,agreed_grams)
       VALUES($1,$2,$3,$4,$5)`,
      [tenant, plan.id, line.sku, line.size, line.agreedGrams],
    );
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
       VALUES($1,$2,'fish.delivery.plan.create',$3,$4::jsonb)`,
      [tenant, `user:${actor}`, plan.id, JSON.stringify({ locationId, lineCount: lines.length, totalGrams: lines.reduce((n, x) => n + x.agreedGrams, 0) })],
    );
    await client.query("COMMIT");
    return { status: "SAVED" as const, planId: plan.id };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Link an existing ordinary order. The ordinary order remains the only stock/payment authority. */
export async function attachFishDeliveryOrder(tenant: string, actor: string, planIdRaw: unknown, orderIdRaw: unknown) {
  const planId = uuid(planIdRaw, "แผนส่งปลา"), orderId = uuid(orderIdRaw, "ออร์เดอร์");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenant, { editorId: actor });
    const plan = (await client.query<{ location_id: string; customer_id: string }>(
      `SELECT location_id,customer_id FROM bms_fish_delivery_plans WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [tenant, planId],
    )).rows[0];
    if (!plan) throw new FishOwnerError("PLAN_NOT_FOUND", "ไม่พบแผนส่งปลา");
    await assertAllowedLocation(client, tenant, actor, plan.location_id);
    const order = (await client.query<{ location_id: string; customer_id: string; status: string }>(
      `SELECT location_id,customer_id,status FROM bms_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [tenant, orderId],
    )).rows[0];
    if (!order || order.location_id !== plan.location_id || order.customer_id !== plan.customer_id ||
        ["CANCELLED", "RETURNED"].includes(order.status))
      throw new FishOwnerError("ORDER_MISMATCH", "ออร์เดอร์ต้องเป็นลูกค้าและสาขาเดียวกับแผน และยังไม่ถูกยกเลิก/คืน");
    const prior = (await client.query<{ plan_id: string }>(
      `SELECT plan_id FROM bms_fish_delivery_plan_orders WHERE tenant_id=$1 AND order_id=$2`,
      [tenant, orderId],
    )).rows[0];
    if (prior) {
      if (prior.plan_id !== planId) throw new FishOwnerError("ORDER_ALREADY_LINKED", "ออร์เดอร์นี้อยู่ในแผนอื่นแล้ว");
      await client.query("COMMIT");
      return { status: "REPLAYED" as const, planId, orderId };
    }
    const orderLines = (await client.query<{ product_sku: string; size: string; qty: number }>(
      `SELECT oi.product_sku,oi.size,SUM(GREATEST(oi.qty-ret.qty,0))::integer AS qty
         FROM bms_order_items oi
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(ri.qty),0)::int AS qty
             FROM bms_pos_return_items ri JOIN bms_pos_returns pr
               ON pr.tenant_id=ri.tenant_id AND pr.id=ri.pos_return_id
            WHERE ri.tenant_id=oi.tenant_id AND ri.order_item_id=oi.id AND pr.is_void=FALSE
         ) ret ON true
        WHERE oi.tenant_id=$1 AND oi.order_id=$2 GROUP BY oi.product_sku,oi.size`,
      [tenant, orderId],
    )).rows;
    if (!orderLines.length || orderLines.every(row => Number(row.qty) === 0))
      throw new FishOwnerError("ORDER_EMPTY", "ออร์เดอร์ไม่มีปลาที่ยังไม่ถูกคืน");
    const planLines = (await client.query<{ sku: string; size: string; agreed_grams: number }>(
      `SELECT sku,size,agreed_grams FROM bms_fish_delivery_plan_lines
       WHERE tenant_id=$1 AND plan_id=$2 ORDER BY sku,size`,
      [tenant, planId],
    )).rows;
    const allowed = new Map(planLines.map(x => [`${x.sku}\0${x.size}`, Number(x.agreed_grams)]));
    if (orderLines.some(x => !allowed.has(`${x.product_sku}\0${x.size}`)))
      throw new FishOwnerError("ORDER_ITEMS_MISMATCH", "ออร์เดอร์มีสินค้าหรือไซซ์นอกแผนส่งปลา");
    const linked = (await client.query<{ product_sku: string; size: string; qty: number }>(
      `SELECT oi.product_sku,oi.size,SUM(GREATEST(oi.qty-ret.qty,0))::integer AS qty
         FROM bms_fish_delivery_plan_orders link
         JOIN bms_orders o ON o.tenant_id=link.tenant_id AND o.id=link.order_id
         JOIN bms_order_items oi ON oi.tenant_id=o.tenant_id AND oi.order_id=o.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(ri.qty),0)::int AS qty
             FROM bms_pos_return_items ri JOIN bms_pos_returns pr
               ON pr.tenant_id=ri.tenant_id AND pr.id=ri.pos_return_id
            WHERE ri.tenant_id=oi.tenant_id AND ri.order_item_id=oi.id AND pr.is_void=FALSE
         ) ret ON true
        WHERE link.tenant_id=$1 AND link.plan_id=$2 AND o.status NOT IN ('CANCELLED','RETURNED')
        GROUP BY oi.product_sku,oi.size`,
      [tenant, planId],
    )).rows;
    const totals = new Map(linked.map(x => [`${x.product_sku}\0${x.size}`, Number(x.qty)]));
    for (const row of orderLines) {
      const key = `${row.product_sku}\0${row.size}`;
      if ((totals.get(key) ?? 0) + Number(row.qty) > allowed.get(key)!)
        throw new FishOwnerError("OVER_COMMITTED", `${row.product_sku}/${row.size}: น้ำหนักออร์เดอร์เกินแผน`);
    }
    await client.query(
      `INSERT INTO bms_fish_delivery_plan_orders(tenant_id,plan_id,order_id,linked_by)
       VALUES($1,$2,$3,$4)`, [tenant, planId, orderId, actor],
    );
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
       VALUES($1,$2,'fish.delivery.order.attach',$3,$4::jsonb)`,
      [tenant, `user:${actor}`, planId, JSON.stringify({ orderId })],
    );
    await client.query("COMMIT");
    return { status: "SAVED" as const, planId, orderId };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
