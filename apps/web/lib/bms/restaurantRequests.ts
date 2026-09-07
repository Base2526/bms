import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getClient } from '@/lib/db';
import { beginTenantTx } from './tenant';
import { resolveOrCreateCustomer } from './customers';
import { createOrderInTx, type OrderItemInput } from './orders';
import type { Channel } from './pipeline';
import { restaurantOrderingStateInTx } from './restaurantOrdering';
import { userCanAccessLocation } from './locations';
import { createCheckoutToken } from './checkoutToken';
import {
  agreedRestaurantQuantities, normalizeRestaurantRequestItems, requestQuoteLines,
  restaurantRequestFingerprint, RestaurantRequestRejection,
  type RestaurantRequestItem, type RestaurantRequestLine,
} from './restaurantRequestPolicy';

/**
 * Shop-state refusals reuse createOrderInTx's status vocabulary so the model and the
 * deterministic customer replies both already know how to explain them — see
 * RESTAURANT_REQUEST_REFUSAL_STATUSES. Item-level problems stay a
 * RestaurantRequestRejection: their text names a SKU or a modifier group, which is guidance
 * for the model, not a sentence to read out to a customer.
 */
type RestaurantRequestRefusal =
  | { status: 'ORDERING_PAUSED' | 'ORDERING_CLOSED' }
  | { status: 'LOCATION_REQUIRED'; locations: Array<{ id: string; name: string; branchCode: string | null }> }
  | { status: 'FULFILLMENT_REQUIRED' };

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function audit(client: PoolClient, tenantId: string, actor: string, action: string, id: string, meta: object) {
  await client.query(`INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
    VALUES ($1,$2,$3,$4,$5::jsonb)`, [tenantId, actor, action, id, JSON.stringify(meta)]);
}

// Catalog validation only: never check or mutate inventory to receive requested quantities.
async function resolveLines(client: PoolClient, tenantId: string, items: RestaurantRequestItem[]): Promise<RestaurantRequestLine[]> {
  const lines: RestaurantRequestLine[] = [];
  for (const item of items) {
    const product = await client.query<{ name: string }>(`SELECT p.name FROM bms_products p
      JOIN bms_product_variants v ON v.tenant_id=p.tenant_id AND v.product_sku=p.sku AND v.code=$3 AND v.active
      WHERE p.tenant_id=$1 AND p.sku=$2 AND p.active
        AND EXISTS (SELECT 1 FROM bms_product_sales_surfaces s WHERE s.tenant_id=p.tenant_id
          AND s.product_sku=p.sku AND s.surface='CUSTOMER_AI' AND s.enabled)
        AND EXISTS (SELECT 1 FROM bms_product_sales_surfaces s WHERE s.tenant_id=p.tenant_id
          AND s.product_sku=p.sku AND s.surface='ONLINE_ORDER' AND s.enabled)`, [tenantId, item.sku, item.size]);
    if (!product.rows[0]) throw new RestaurantRequestRejection(`ไม่พบสินค้าหรือตัวเลือกที่เปิดรับ: ${item.sku} / ${item.size}`);
    let unitName: string | null = null;
    if (item.packCode) {
      const pack = await client.query<{ unit_name: string }>(`SELECT unit_name FROM bms_product_packs
        WHERE tenant_id=$1 AND product_sku=$2 AND upper(pack_code)=$3 AND active
          AND (size=$4 OR size IS NULL) ORDER BY size NULLS LAST LIMIT 1`, [tenantId, item.sku, item.packCode, item.size]);
      if (!pack.rows[0]) throw new RestaurantRequestRejection(`ไม่พบหน่วยขาย ${item.packCode} ของ ${item.sku}`);
      unitName = pack.rows[0].unit_name;
    }
    const modifiers = await client.query<{ code: string; name: string }>(`SELECT m.code,m.name FROM bms_product_modifiers m
      JOIN bms_product_modifier_groups g ON g.tenant_id=m.tenant_id AND g.id=m.group_id AND g.active
      WHERE m.tenant_id=$1 AND m.product_sku=$2 AND m.size=$3 AND m.active`, [tenantId, item.sku, item.size]);
    const names = new Map(modifiers.rows.map((row) => [row.code.toUpperCase(), row.name]));
    for (const code of item.modifierCodes ?? []) if (!names.has(code)) throw new RestaurantRequestRejection(`ไม่พบตัวเลือก ${code} ของ ${item.sku}`);
    const groups = await client.query<{ name: string; min_select: number; max_select: number | null; selected: string }>(`
      SELECT g.name,g.min_select,g.max_select,count(m.code)::text AS selected
      FROM bms_product_modifier_groups g LEFT JOIN bms_product_modifiers m
        ON m.tenant_id=g.tenant_id AND m.group_id=g.id AND m.active AND upper(m.code)=ANY($4::text[])
      WHERE g.tenant_id=$1 AND g.product_sku=$2 AND g.size=$3 AND g.active GROUP BY g.id`,
      [tenantId, item.sku, item.size, item.modifierCodes ?? []]);
    for (const group of groups.rows) {
      if (Number(group.selected) < group.min_select || (group.max_select != null && Number(group.selected) > group.max_select)) {
        throw new RestaurantRequestRejection(`กรุณาเลือก ${group.name} ให้ครบตามตัวเลือกของร้าน สำหรับ ${product.rows[0].name}`);
      }
    }
    lines.push({ ...item, name: product.rows[0].name, unitName,
      modifierNames: (item.modifierCodes ?? []).map((code) => names.get(code)!) });
  }
  return lines;
}

export async function receiveRestaurantRequest(input: {
  tenantId: string; channel: Channel; customerRef: string; items: unknown;
  locationId?: string | null; fulfillmentType?: string | null; requestedAt?: string | null;
  note?: string | null; couponCode?: string | null; confirmedFingerprint?: string | null;
}) {
  const items = normalizeRestaurantRequestItems(input.items);
  const note = input.note?.trim() || '';
  if (note.length > 1000) throw new RestaurantRequestRejection('หมายเหตุต้องไม่เกิน 1000 ตัวอักษร');
  const date = input.requestedAt ? new Date(input.requestedAt) : null;
  if (date && !Number.isFinite(date.getTime())) throw new RestaurantRequestRejection('วันเวลาที่ต้องการไม่ถูกต้อง');
  const requestedAt = date?.toISOString() ?? null;
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId);
    const state = await restaurantOrderingStateInTx(client, input.tenantId);
    if (!state.isRestaurant || input.channel === 'pos') throw new RestaurantRequestRejection('รับคำขอนี้ได้เฉพาะแชทร้านอาหาร');
    const refuse = async (refusal: RestaurantRequestRefusal) => {
      await client.query('ROLLBACK');
      return refusal;
    };
    if (!state.accepting) return await refuse({ status: state.reason === 'PAUSED' ? 'ORDERING_PAUSED' : 'ORDERING_CLOSED' });
    const locations = await client.query<{ id: string; name: string; branch_code: string | null }>(
      `SELECT id,name,branch_code FROM bms_locations
      WHERE tenant_id=$1 AND active ORDER BY (code='MAIN') DESC,is_head_office DESC,created_at LIMIT 21`, [input.tenantId]);
    const locationId = input.locationId || (locations.rows.length === 1 ? locations.rows[0].id : null);
    if (!locationId || !locations.rows.some((row) => row.id === locationId)) {
      return await refuse({ status: 'LOCATION_REQUIRED', locations: locations.rows.slice(0, 20)
        .map((row) => ({ id: row.id, name: row.name, branchCode: row.branch_code })) });
    }
    if (!['DELIVERY','PICKUP'].includes(input.fulfillmentType ?? '')) return await refuse({ status: 'FULFILLMENT_REQUIRED' });
    const fulfillmentType = input.fulfillmentType as 'DELIVERY' | 'PICKUP';
    const lines = await resolveLines(client, input.tenantId, items);
    const fingerprint = restaurantRequestFingerprint(items, locationId, fulfillmentType, requestedAt, note, input.couponCode ?? null);
    if (input.confirmedFingerprint !== fingerprint) {
      await client.query('ROLLBACK');
      return { status: 'CONFIRMATION_REQUIRED' as const, fingerprint, lines: requestQuoteLines(lines),
        locationName: locations.rows.find((row) => row.id === locationId)!.name, fulfillmentType, requestedAt, note,
        draft: { items, locationId, fulfillmentType, promisedAt: requestedAt, requestNote: note, couponCode: input.couponCode ?? null } };
    }
    // Serialize duplicate webhook/tool attempts for this identity across instances.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`restaurant-request:${input.tenantId}:${input.channel}:${input.customerRef}`]);
    const source = await client.query<{ id: string }>(`SELECT m.id::text FROM bms_messages m
      JOIN bms_conversations c ON c.tenant_id=m.tenant_id AND c.id=m.conversation_id
      WHERE c.tenant_id=$1 AND c.channel=$2 AND c.customer_ref=$3 AND m.sender='customer'
      ORDER BY m.created_at DESC,m.id DESC LIMIT 1`,
      [input.tenantId, input.channel, input.customerRef]);
    const sourceKey = hash(`${source.rows[0]?.id ?? 'initial'}:${fingerprint}`);
    const existing = await client.query<{ id: string }>(`SELECT id FROM bms_restaurant_order_requests
      WHERE tenant_id=$1 AND channel=$2 AND customer_ref=$3 AND
        (source_key=$4 OR (fingerprint=$5 AND status IN ('REQUESTED','CONTACTING')))
      ORDER BY created_at DESC LIMIT 1`, [input.tenantId,input.channel,input.customerRef,sourceKey,fingerprint]);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { status: 'REQUEST_RECEIVED' as const, requestId: existing.rows[0].id, replayed: true };
    }
    const customerId = await resolveOrCreateCustomer(client, input.tenantId, input.channel, input.customerRef);
    if (!customerId) throw new RestaurantRequestRejection('ไม่พบตัวตนลูกค้าสำหรับรับคำขอ');
    const saved = await client.query<{ id: string }>(`INSERT INTO bms_restaurant_order_requests
      (tenant_id,location_id,customer_id,channel,customer_ref,fingerprint,source_key,requested_items,
       fulfillment_type,requested_at,request_note,coupon_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) RETURNING id`,
      [input.tenantId,locationId,customerId,input.channel,input.customerRef,fingerprint,sourceKey,
        JSON.stringify(lines),fulfillmentType,requestedAt,note,input.couponCode ?? null]);
    await audit(client,input.tenantId,'ai:customer','restaurant.request_received',saved.rows[0].id,{ itemCount: lines.length, locationId });
    await client.query('COMMIT');
    return { status: 'REQUEST_RECEIVED' as const, requestId: saved.rows[0].id, replayed: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function listRestaurantRequests(input: {
  tenantId: string; locationId?: string | null; actorUserId?: string; channel?: string; customerRef?: string;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client,input.tenantId);
    const profile = await client.query(`SELECT 1 FROM bms_store_profile WHERE tenant_id=$1 AND business_archetype='restaurant'`, [input.tenantId]);
    if (!profile.rowCount) { await client.query('COMMIT'); return []; }
    const own = input.channel != null && input.customerRef != null;
    if (!own && !input.actorUserId) throw new RestaurantRequestRejection('ต้องระบุพนักงาน');
    const result = await client.query(`SELECT r.id,r.location_id AS "locationId",l.name AS "locationName",
      r.status,r.requested_items AS items,r.fulfillment_type AS "fulfillmentType",r.requested_at AS "requestedAt",
      ${own ? "NULL::text" : 'r.request_note'} AS note,${own ? "NULL::text" : 'r.review_note'} AS "reviewNote",
      r.agreed_items AS "agreedItems",r.order_id AS "orderId",r.version,r.created_at AS "createdAt",
      ${own ? 'NULL::text AS "customerName",NULL::text AS phone' : 'c.name AS "customerName",c.phone AS phone'}
      FROM bms_restaurant_order_requests r JOIN bms_locations l ON l.tenant_id=r.tenant_id AND l.id=r.location_id
      JOIN bms_customers c ON c.tenant_id=r.tenant_id AND c.id=r.customer_id
      WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR r.location_id=$2)
        AND ($3::text IS NULL OR (r.channel=$3 AND r.customer_ref=$4))
        AND ($5::uuid IS NULL OR NOT EXISTS (SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=r.tenant_id AND a.user_id=$5)
          OR EXISTS (SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=r.tenant_id AND a.user_id=$5 AND a.location_id=r.location_id))
      ORDER BY (r.status IN ('REQUESTED','CONTACTING')) DESC,r.created_at DESC LIMIT 50`, [input.tenantId,input.locationId ?? null,input.channel ?? null,input.customerRef ?? null,input.actorUserId ?? null]);
    await client.query('COMMIT');
    return result.rows.map(row => ({ ...row,
      ...(!own && row.orderId ? { checkoutUrl: checkoutUrl(input.tenantId, row.orderId) } : {}),
    }));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function reviewRestaurantRequest(input: {
  tenantId: string; locationId: string; actorUserId: string; id: string; version: number;
  action: 'contact' | 'confirm' | 'cancel'; quantities?: unknown; note: string; confirmed: boolean; kitchenNote?: string;
}) {
  if (![input.locationId,input.id,input.actorUserId].every(value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ||
      !Number.isInteger(input.version) || input.version < 1) throw new RestaurantRequestRejection('รหัสคำขอ สาขา หรือเวอร์ชันไม่ถูกต้อง');
  if (!(await userCanAccessLocation(input.tenantId,input.actorUserId,input.locationId))) throw new RestaurantRequestRejection('ไม่มีสิทธิ์สาขานี้');
  if (!input.confirmed || !['contact','confirm','cancel'].includes(input.action) || !input.note.trim() || input.note.length > 1000) {
    throw new RestaurantRequestRejection('ต้องยืนยันการดำเนินการและบันทึกผลการตรวจ/ติดต่อ (ไม่เกิน 1000 ตัวอักษร)');
  }
  const client = await getClient();
  try {
    await beginTenantTx(client,input.tenantId,{editorId: input.actorUserId});
    if (input.action === 'confirm' && (typeof input.kitchenNote !== 'string' || input.kitchenNote.length > 1000)) {
      throw new RestaurantRequestRejection('กรุณาตรวจข้อความส่งครัว (ไม่เกิน 1000 ตัวอักษร)');
    }
    const result = await client.query(`SELECT * FROM bms_restaurant_order_requests
      WHERE tenant_id=$1 AND id=$2 AND location_id=$3 FOR UPDATE`,[input.tenantId,input.id,input.locationId]);
    const row = result.rows[0];
    if (!row) throw new RestaurantRequestRejection('ไม่พบคำขอ');
    const reviewKey = hash(JSON.stringify([input.actorUserId,input.version,input.action,input.quantities ?? null,input.note,input.kitchenNote ?? null]));
    if (row.review_key === reviewKey) {
      await client.query('COMMIT');
      return { status: row.status, orderId: row.order_id, checkoutUrl: row.order_id ? checkoutUrl(input.tenantId,row.order_id) : null };
    }
    if (!['REQUESTED','CONTACTING'].includes(row.status) || row.version !== input.version) throw new RestaurantRequestRejection('คำขอเปลี่ยนแล้ว กรุณาโหลดใหม่');
    let orderId: string | null = null;
    let agreed: RestaurantRequestItem[] | null = null;
    const status = input.action === 'confirm' ? 'CONFIRMED' : input.action === 'cancel' ? 'CANCELLED' : 'CONTACTING';
    if (input.action === 'confirm') {
      agreed = agreedRestaurantQuantities(row.requested_items,input.quantities);
      const orderItems: OrderItemInput[] = [];
      for (const item of agreed) {
        if (!item.packCode) { orderItems.push(item); continue; }
        const packs = await client.query(`SELECT * FROM bms_product_packs WHERE tenant_id=$1 AND product_sku=$2
          AND upper(pack_code)=$3 AND active AND (size=$4 OR size IS NULL) ORDER BY size NULLS LAST LIMIT 1`,
          [input.tenantId,item.sku,item.packCode,item.size]);
        const pack = packs.rows[0];
        if (!pack) throw new RestaurantRequestRejection('หน่วยขายเปลี่ยนแล้ว กรุณาตรวจสินค้า');
        orderItems.push({...item,qty:Number(pack.base_qty)*item.qty,packQty:item.qty,
          packUnitName:pack.unit_name,packUnitPrice:pack.price == null ? null : Number(pack.price)});
      }
      const order = await createOrderInTx(client,{tenantId:input.tenantId,channel:row.channel as Channel,
        customerId:row.customer_id,customerRef:row.customer_ref,locationId:row.location_id,
        fulfillmentType:row.fulfillment_type,promisedAt:row.requested_at,couponCode:row.coupon_code,
        items:orderItems,editorId:input.actorUserId,acceptedRestaurantRequestId:input.id});
      if (order.status !== 'CREATED') {
        await client.query('ROLLBACK');
        return { status:'REVIEW_REQUIRED', reason:order, orderId:null, checkoutUrl:null };
      }
      orderId = order.orderId;
      await client.query(`UPDATE bms_orders SET restaurant_request_instructions=$3 WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId,orderId,input.kitchenNote?.trim() || null]);
      await audit(client,input.tenantId,input.actorUserId,'order.create',orderId,{restaurantRequestId:input.id});
    }
    await client.query(`UPDATE bms_restaurant_order_requests SET status=$3,agreed_items=$4::jsonb,
      agreed_at=CASE WHEN $3='CONFIRMED' THEN now() ELSE NULL END,review_note=$5,reviewed_by=$6,
      order_id=$7,review_key=$8,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId,input.id,status,agreed ? JSON.stringify(agreed) : null,input.note.trim(),input.actorUserId,orderId,reviewKey]);
    // The note text goes in the audit meta, not only on the row: review_note holds the *latest*
    // outcome, and a queue whose whole point is "call the customer and write down what was
    // agreed" would otherwise lose every earlier attempt the moment the next one is saved.
    await audit(client,input.tenantId,input.actorUserId,`restaurant.request_${input.action}`,input.id,
      {orderId,status,note:input.note.trim(),agreedQuantities:agreed?.map((item)=>item.qty) ?? null});
    await client.query('COMMIT');
    return {status,orderId,checkoutUrl:orderId ? checkoutUrl(input.tenantId,orderId) : null};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
function checkoutUrl(tenantId: string, orderId: string) {
  return `/checkout?t=${encodeURIComponent(createCheckoutToken({tenantId,orderId}))}`;
}
