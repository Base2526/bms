import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { isCapabilityEnabledInTx } from "./storeCapabilities";

function mapKitchenTicket(row: any) {
  return {
    id: row.id,
    orderId: row.order_id,
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
        AND sp.stock_policy = 'RECIPE'
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
  limit = 100
) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const result = await query(
    `SELECT * FROM (
       SELECT kt.id, kt.order_id, kt.order_item_id, kt.station, kt.status,
              kt.modifier_codes, kt.created_at, kt.updated_at,
              oi.product_sku, oi.product_name, oi.size, oi.pack_qty, oi.qty
         FROM bms_kitchen_tickets kt
         JOIN bms_order_items oi
           ON oi.tenant_id = kt.tenant_id AND oi.id = kt.order_item_id
        WHERE kt.tenant_id = $1
          AND ($2::text IS NULL OR kt.status = $2)
          AND ($2::text IS NOT NULL
               OR kt.status = ANY($4::text[])
               OR (kt.status = 'SERVED' AND kt.updated_at > now() - ($5 || ' hours')::interval))
        ORDER BY kt.created_at DESC, kt.id DESC
        LIMIT $3
     ) recent
     ORDER BY recent.created_at, recent.id`,
    [tenantId, status ?? null, safeLimit, [...KITCHEN_OPEN_STATUSES], String(KITCHEN_CLOSED_VISIBLE_HOURS)]
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

const NEXT_KITCHEN_STATUS: Record<string, ReadonlySet<string>> = {
  NEW: new Set(["PREPARING", "CANCELLED"]),
  PREPARING: new Set(["READY", "CANCELLED"]),
  READY: new Set(["SERVED", "CANCELLED"]),
  SERVED: new Set(),
  CANCELLED: new Set(),
};

export async function updateKitchenTicketStatus(input: {
  tenantId: string;
  ticketId: string;
  status: string;
  actorUserId: string;
}) {
  const status = String(input.status ?? "").trim().toUpperCase();
  if (!(status in NEXT_KITCHEN_STATUS)) throw new Error("สถานะ Kitchen ticket ไม่ถูกต้อง");
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const current = await client.query<{ status: string }>(
      `SELECT status FROM bms_kitchen_tickets
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, input.ticketId]
    );
    if (!current.rowCount) throw new Error("ไม่พบ Kitchen ticket");
    const previous = current.rows[0].status;
    if (!NEXT_KITCHEN_STATUS[previous]?.has(status)) {
      throw new Error(`เปลี่ยนสถานะ Kitchen ticket จาก ${previous} เป็น ${status} ไม่ได้`);
    }
    const updated = await client.query(
      `UPDATE bms_kitchen_tickets kt SET status = $3, updated_at = now()
        FROM bms_order_items oi
        WHERE kt.tenant_id = $1 AND kt.id = $2
          AND oi.tenant_id = kt.tenant_id AND oi.id = kt.order_item_id
        RETURNING kt.*, oi.product_sku, oi.product_name, oi.size, oi.pack_qty, oi.qty`,
      [input.tenantId, input.ticketId, status]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'kitchen.ticket_status',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, input.ticketId,
        JSON.stringify({ previous, status })]
    );
    await client.query("COMMIT");
    return mapKitchenTicket(updated.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
