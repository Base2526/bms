import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { isCapabilityEnabledInTx } from "./storeCapabilities";

function mapKitchenTicket(row: any) {
  return {
    id: row.id,
    source: row.source ?? "ORDER",
    orderId: row.order_id ?? null,
    checkId: row.check_id ?? null,
    tableCode: row.table_code ?? null,
    tableName: row.table_name ?? null,
    roundNo: row.round_no == null ? null : Number(row.round_no),
    kitchenNote: row.kitchen_note ?? null,
    orderItemId: String(row.order_item_id),
    station: row.station ?? null,
    status: row.status,
    modifierCodes: row.modifier_codes ?? [],
    productSku: row.product_sku,
    productName: row.product_name,
    size: row.size,
    packQty: row.pack_qty == null ? null : Number(row.pack_qty),
    qty: Number(row.qty),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/**
 * ตั๋วครัวเกิดจากสองเงื่อนไขพร้อมกัน: ร้านเปิดคิวครัว **และ** บรรทัดนั้นเป็นเมนูที่มีสูตร
 *
 * เดิมดูแค่ `stock_policy = 'RECIPE'` ผลคือร้านที่ใช้สูตรเพื่อ "ตัดวัตถุดิบ" อย่างเดียว
 * (preset ของ food_beverage มี RECIPE แต่ไม่มี KITCHEN_WORKFLOW) มีตั๋วงอกทุกบิลโดยไม่มี
 * หน้าจอไหนแสดงและไม่มีใครปิดมันได้ · station เป็น NULL ได้ตามเดิม กระดานมีช่อง
 * "ไม่ระบุ station" อยู่แล้ว — ร้านที่ยังไม่ได้ตั้ง station ต้องเห็นตั๋ว ไม่ใช่กระดานว่าง
 * ที่อ่านได้ว่าระบบพัง
 */
export async function enqueueKitchenTicketsInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  orderId: string
): Promise<number> {
  if (!(await isCapabilityEnabledInTx(client, tenantId, "KITCHEN_WORKFLOW"))) return 0;
  const result = await client.query(
    `INSERT INTO bms_kitchen_tickets
       (tenant_id, order_id, order_item_id, station, modifier_codes)
     SELECT oi.tenant_id, oi.order_id, oi.id, sp.kitchen_station, oi.stock_modifier_codes
       FROM bms_order_items oi
       JOIN bms_product_stock_policies sp
         ON sp.tenant_id = oi.tenant_id AND sp.product_sku = oi.product_sku
      WHERE oi.tenant_id = $1 AND oi.order_id = $2
        AND sp.stock_policy IN ('RECIPE', 'NON_STOCK')
     ON CONFLICT (tenant_id, order_item_id) DO NOTHING`,
    [tenantId, orderId]
  );
  return result.rowCount ?? 0;
}

/**
 * กระดานครัวต้องเห็น "งานที่ยังไม่จบ" เสมอ ไม่ใช่ตั๋วที่เก่าที่สุดในประวัติศาสตร์ร้าน
 *
 * เดิมเรียง `created_at` ขึ้นแล้ว LIMIT — ร้านอาหารที่ผ่านตั๋วครบเพดาน (200) จะได้ตั๋ว
 * 200 ใบแรกของร้านซึ่งเสิร์ฟไปหมดแล้วตลอดไป **ตั๋วใหม่ไม่มีวันโผล่บนกระดานอีกเลย**
 * และครัวอ่านว่า "ระบบไม่ส่งออร์เดอร์มา" ทั้งที่ขายอยู่
 *
 * ตอนนี้: ตั๋วที่ยังไม่จบ (NEW/PREPARING/READY) เห็นเสมอ · ตั๋วที่เสิร์ฟแล้วเห็นเฉพาะ 12 ชั่วโมง
 * ล่าสุด (ช่องเสิร์ฟแล้วมีประโยชน์ตอนลูกค้าทวง) · **ตั๋วที่ถูกยกเลิกไม่ขึ้นกระดานเลย** เพราะ
 * กระดานไม่มีช่องให้มัน (บิลถูก void/ยกเลิกไปแล้ว ไม่มีใครต้องทำ) การให้มันกินโควตาของเพดาน
 * คือการเบียดงานจริงออกไป · ตัดด้วยใหม่สุดก่อนแล้วค่อยเรียงกลับเป็นเก่าก่อนสำหรับลำดับการทำ
 * อาหาร — เพดานจึงทิ้งของเก่า ไม่ใช่ทิ้งของใหม่
 */
const KITCHEN_OPEN_STATUSES = ["NEW", "PREPARING", "READY"] as const;
const KITCHEN_CLOSED_VISIBLE_HOURS = 12;

export async function listKitchenTickets(
  tenantId: string,
  status?: string | null,
  limit = 100,
  /**
   * จอครัวของเครื่องหน้าร้านต้องเห็นเฉพาะสาขาของตัวเอง — คนครัวสาขา A ที่เห็นออร์เดอร์
   * ของสาขา B จะกดว่าเสิร์ฟแล้วโดยที่อาหารไม่มีใครทำ · กระดานหลังบ้านยังดูทั้งร้านตามเดิม
   * (ไม่ส่งค่านี้ = ทุกสาขา)
   */
  locationId?: string | null
) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const result = await query(
    `SELECT * FROM (
       SELECT * FROM (
         SELECT 'ORDER'::text AS source, kt.id, kt.order_id, kt.order_item_id::text,
                NULL::uuid AS check_id, NULL::text AS table_code, NULL::text AS table_name,
                NULL::integer AS round_no, NULL::text AS kitchen_note,
                kt.station, kt.status, kt.modifier_codes, kt.created_at, kt.updated_at,
                oi.product_sku, oi.product_name, oi.size, oi.pack_qty, oi.qty
           FROM bms_kitchen_tickets kt
           JOIN bms_order_items oi
             ON oi.tenant_id = kt.tenant_id AND oi.id = kt.order_item_id
           JOIN bms_orders o
             ON o.tenant_id = kt.tenant_id AND o.id = kt.order_id
          WHERE kt.tenant_id = $1
            AND ($6::uuid IS NULL OR o.location_id = $6)
         UNION ALL
         SELECT 'RESTAURANT_CHECK'::text, rt.id, NULL::uuid, ci.id::text,
                rt.check_id, tb.code, tb.name, ci.round_no, ci.kitchen_note,
                rt.station, rt.status, ci.modifier_codes, rt.created_at, rt.updated_at,
                ci.product_sku, ci.product_name, ci.size, ci.pack_qty, ci.pack_qty
           FROM bms_restaurant_kitchen_tickets rt
           JOIN bms_restaurant_check_items ci
             ON ci.tenant_id = rt.tenant_id AND ci.id = rt.check_item_id
           JOIN bms_restaurant_checks rc
             ON rc.tenant_id = rt.tenant_id AND rc.id = rt.check_id
           JOIN bms_restaurant_tables tb
             ON tb.tenant_id = rc.tenant_id AND tb.id = rc.table_id
          WHERE rt.tenant_id = $1
            AND ($6::uuid IS NULL OR rc.location_id = $6)
       ) all_tickets
       WHERE ($2::text IS NULL OR all_tickets.status = $2)
         AND ($2::text IS NOT NULL
              OR all_tickets.status = ANY($4::text[])
              OR (all_tickets.status = 'SERVED' AND all_tickets.updated_at > now() - ($5 || ' hours')::interval))
       ORDER BY all_tickets.created_at DESC, all_tickets.id DESC
       LIMIT $3
     ) recent
     ORDER BY recent.created_at, recent.id`,
    [tenantId, status ?? null, safeLimit, [...KITCHEN_OPEN_STATUSES],
      String(KITCHEN_CLOSED_VISIBLE_HOURS), locationId ?? null]
  );
  return result.rows.map(mapKitchenTicket);
}

/**
 * ยกเลิกบิลแล้วตั๋วที่ยังไม่จบต้องหยุด — ไม่งั้นครัวทำอาหารให้บิลที่ถูกยกเลิกไปแล้ว
 * เรียกในทรานแซกชันเดียวกับการ void (ไม่ใช่ทรานแซกชันที่สอง) เพราะ "เงินคืนแล้วแต่ครัว
 * ยังทำอยู่" คือสถานะที่ไม่มีใครไปตามแก้
 */
export async function cancelKitchenTicketsForOrderInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  orderId: string
): Promise<number> {
  const result = await client.query(
    `UPDATE bms_kitchen_tickets
        SET status = 'CANCELLED', updated_at = now()
      WHERE tenant_id = $1 AND order_id = $2 AND status = ANY($3::text[])`,
    [tenantId, orderId, [...KITCHEN_OPEN_STATUSES]]
  );
  return result.rowCount ?? 0;
}

/**
 * เดินหน้าได้ทีละขั้น ถอยหลังได้ทีละขั้น
 *
 * ถอยหลังมีเพราะการกดผิดที่จอครัวเกิดจริงและบ่อย (มือเปื้อน จอสัมผัสลั่น กดใบข้าง ๆ) —
 * เดิมกดพลาดเป็น "พร้อมเสิร์ฟ" แล้วแก้ไม่ได้เลย ครัวต้องจำเอาเองว่าใบไหนยังไม่เสร็จจริง
 *
 * **CANCELLED เป็นปลายทางถาวรโดยตั้งใจ ห้ามเพิ่มทางกลับ** — การยกเลิกตัดบรรทัดออกจากบิล
 * โต๊ะไปแล้วในทรานแซกชันเดียวกัน การ "ย้อนกลับ" จึงต้องเอาบรรทัดกลับเข้าบิลพร้อมจองสต็อกใหม่
 * ซึ่งเป็นการแก้บิล ไม่ใช่การแก้สถานะครัว (ทางที่ถูกคือสั่งรอบใหม่)
 */
const NEXT_KITCHEN_STATUS: Record<string, ReadonlySet<string>> = {
  NEW: new Set(["PREPARING", "CANCELLED"]),
  PREPARING: new Set(["READY", "NEW", "CANCELLED"]),
  READY: new Set(["SERVED", "PREPARING", "CANCELLED"]),
  SERVED: new Set(["READY"]),
  CANCELLED: new Set(),
};


/**
 * ผลที่ต้องเกิดกับ "บิลโต๊ะ" เมื่อครัวยกเลิกตั๋ว — อาหารไม่ได้ทำ บรรทัดต้องหลุดจากยอด
 *
 * รับเป็น hook ไม่ import ตรง ๆ เพราะ kitchen.ts เป็นโมดูลปลายทาง (import แค่ db/tenant/
 * storeCapabilities) ถ้า import restaurantPos จะเกิดวง
 * kitchen → restaurantPos → orders → kitchen
 */
export type RestaurantCheckLineCancelHook = (
  client: PoolClient,
  input: { tenantId: string; checkId: string; checkItemId: string; actorUserId: string }
) => Promise<{ dropped: boolean; amountDue: number | null }>;

export type UpdateKitchenTicketInput = {
  tenantId: string;
  ticketId: string;
  status: string;
  actorUserId: string;
  /**
   * **required โดยตั้งใจ** — ผู้เรียกที่ลืมส่งจะไม่ compile แทนที่จะเงียบแล้วเก็บเงินค่าอาหาร
   * ที่ครัวยกเลิกไปแล้ว · ผู้เรียกมีสองที่ (route ของเครื่องขาย และ resolver ของกระดาน
   * หลังบ้าน) ซึ่งต้องให้ผลเหมือนกัน ไม่ใช่อย่างใดอย่างหนึ่งลดยอดให้
   */
  onRestaurantCheckLineCancelled: RestaurantCheckLineCancelHook;
  /**
   * เครื่องหน้าร้านเลื่อนได้เฉพาะตั๋วของสาขาตัวเอง — จอครัวกรองตามสาขาแล้ว ด่านนี้กันการ
   * ยิง id ตรง ๆ ไปเลื่อนอาหารของสาขาอื่น (กระดานหลังบ้านไม่ส่งค่านี้ = ดูแลได้ทั้งร้าน)
   */
  expectedLocationId?: string | null;
};

/**
 * แกนของการเลื่อนสถานะหนึ่งใบ — **ต้องถูกเรียกในทรานแซกชันที่เปิดไว้แล้วเท่านั้น**
 *
 * แยกออกมาเพื่อให้การเลื่อนทีละใบกับการเลื่อนทั้งรอบ (updateKitchenTicketsStatus) ใช้
 * สูตรเดียวกันจริง ๆ ไม่ใช่สองสูตรที่ต้องคอยไล่ให้ตรงกัน — โดยเฉพาะการตัดบรรทัดออกจาก
 * บิลโต๊ะตอนยกเลิก และการเขียน audit ซึ่งต้องอยู่ในทรานแซกชันเดียวกับการเปลี่ยนสถานะ
 */
async function updateKitchenTicketStatusInTx(client: PoolClient, input: UpdateKitchenTicketInput) {
  const status = String(input.status ?? "").trim().toUpperCase();
  if (!(status in NEXT_KITCHEN_STATUS)) throw new Error("สถานะ Kitchen ticket ไม่ถูกต้อง");
  {
    const locationId = input.expectedLocationId ?? null;
    let current = await client.query<{ status: string; source: "ORDER" | "RESTAURANT_CHECK" }>(
      `SELECT kt.status, 'ORDER'::text AS source FROM bms_kitchen_tickets kt
         JOIN bms_orders o ON o.tenant_id = kt.tenant_id AND o.id = kt.order_id
        WHERE kt.tenant_id = $1 AND kt.id = $2
          AND ($3::uuid IS NULL OR o.location_id = $3)
        FOR UPDATE OF kt`,
      [input.tenantId, input.ticketId, locationId]
    );
    if (!current.rowCount) {
      current = await client.query<{ status: string; source: "ORDER" | "RESTAURANT_CHECK" }>(
        `SELECT rt.status, 'RESTAURANT_CHECK'::text AS source
           FROM bms_restaurant_kitchen_tickets rt
           JOIN bms_restaurant_checks rc ON rc.tenant_id = rt.tenant_id AND rc.id = rt.check_id
          WHERE rt.tenant_id = $1 AND rt.id = $2
            AND ($3::uuid IS NULL OR rc.location_id = $3)
          FOR UPDATE OF rt`,
        [input.tenantId, input.ticketId, locationId]
      );
    }
    if (!current.rowCount) throw new Error("ไม่พบ Kitchen ticket");
    const previous = current.rows[0].status;
    const source = current.rows[0].source;
    if (!NEXT_KITCHEN_STATUS[previous]?.has(status)) {
      throw new Error(`เปลี่ยนสถานะ Kitchen ticket จาก ${previous} เป็น ${status} ไม่ได้`);
    }
    const updated = source === "ORDER"
      ? await client.query(
          `UPDATE bms_kitchen_tickets kt SET status = $3, updated_at = now()
            FROM bms_order_items oi
            WHERE kt.tenant_id = $1 AND kt.id = $2
              AND oi.tenant_id = kt.tenant_id AND oi.id = kt.order_item_id
            RETURNING 'ORDER'::text AS source, kt.*, oi.product_sku, oi.product_name,
                      oi.size, oi.pack_qty, oi.qty, NULL::uuid AS check_id,
                      NULL::text AS table_code, NULL::text AS table_name,
                      NULL::integer AS round_no, NULL::text AS kitchen_note`,
          [input.tenantId, input.ticketId, status]
        )
      : await client.query(
          `UPDATE bms_restaurant_kitchen_tickets rt SET status = $3, updated_at = now()
            FROM bms_restaurant_check_items ci,
                 bms_restaurant_checks rc,
                 bms_restaurant_tables tb
            WHERE rt.tenant_id = $1 AND rt.id = $2
              AND ci.tenant_id = rt.tenant_id AND ci.id = rt.check_item_id
              AND rc.tenant_id = rt.tenant_id AND rc.id = rt.check_id
              AND tb.tenant_id = rc.tenant_id AND tb.id = rc.table_id
            RETURNING 'RESTAURANT_CHECK'::text AS source, rt.id, NULL::uuid AS order_id,
                      ci.id::text AS order_item_id, rt.check_id, tb.code AS table_code,
                      tb.name AS table_name, ci.round_no, ci.kitchen_note, rt.station,
                      rt.status, ci.modifier_codes, rt.created_at, rt.updated_at,
                      ci.product_sku, ci.product_name, ci.size, ci.pack_qty, ci.pack_qty AS qty`,
          [input.tenantId, input.ticketId, status]
        );
    // ครัวยกเลิกอาหารของบิลโต๊ะ → ตัดบรรทัดออกจากยอดใน transaction เดียวกันนี้
    // (แยก transaction แล้วครึ่งหลังล้ม = ตั๋วถูกยกเลิกแต่ลูกค้ายังถูกคิดเงิน)
    let billDropped: { dropped: boolean; amountDue: number | null } = { dropped: false, amountDue: null };
    if (source === "RESTAURANT_CHECK" && status === "CANCELLED") {
      const row = updated.rows[0] as { check_id: string | null; order_item_id: string | null };
      if (row.check_id && row.order_item_id) {
        billDropped = await input.onRestaurantCheckLineCancelled(client, {
          tenantId: input.tenantId,
          checkId: row.check_id,
          checkItemId: String(row.order_item_id),
          actorUserId: input.actorUserId,
        });
      }
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'kitchen.ticket_status',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, input.ticketId,
        JSON.stringify({ previous, status, source, billLineDropped: billDropped.dropped, amountDue: billDropped.amountDue })]
    );
    return { ...mapKitchenTicket(updated.rows[0]), billLineDropped: billDropped.dropped, checkAmountDue: billDropped.amountDue };
  }
}

export async function updateKitchenTicketStatus(input: UpdateKitchenTicketInput) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const ticket = await updateKitchenTicketStatusInTx(client, input);
    await client.query("COMMIT");
    return ticket;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/** ปุ่มเดียวบนจอครัวเลื่อนได้ทั้งใบ ซึ่งเป็นได้หลายตั๋ว — จำกัดไว้กันคำขอที่ยิงทั้งกระดาน */
export const KITCHEN_BULK_LIMIT = 50;

/**
 * เลื่อนหลายตั๋ว "ทั้งหมดหรือไม่เลื่อนเลย" ในทรานแซกชันเดียว
 *
 * จอครัวรวม 3 แก้วของโต๊ะเดียวเป็นใบเดียว ปุ่มจึงต้องขยับทั้ง 3 แถว · ถ้าปล่อยให้จอยิง
 * ทีละใบ ใบที่ล้มกลางทางจะทิ้งครึ่งหนึ่งไว้ที่สถานะเก่า แล้วครัวเห็นงานเดียวกันโผล่สองช่อง
 * พร้อมกันโดยไม่มีใครอธิบายได้ · ล้มใบไหนก็ rollback ทั้งชุดแล้วให้กดใหม่
 */
export async function updateKitchenTicketsStatus(input: Omit<UpdateKitchenTicketInput, "ticketId"> & {
  ticketIds: string[];
}) {
  const ids = [...new Set((input.ticketIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error("ต้องระบุตั๋วอย่างน้อยหนึ่งใบ");
  if (ids.length > KITCHEN_BULK_LIMIT) {
    throw new Error(`เลื่อนได้สูงสุด ${KITCHEN_BULK_LIMIT} รายการต่อครั้ง`);
  }
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const tickets = [];
    for (const ticketId of ids) {
      tickets.push(await updateKitchenTicketStatusInTx(client, { ...input, ticketId }));
    }
    await client.query("COMMIT");
    return tickets;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
