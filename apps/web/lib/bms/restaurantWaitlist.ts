/**
 * บัตรคิวหน้าร้าน + จองโต๊ะล่วงหน้า (`9.64`)
 *
 * "คนที่ยังไม่มีโต๊ะ" เป็นรายการเดียว ไม่ใช่สองระบบ — คิวเดินเข้ากับการจองต่างกันแค่ว่ารู้
 * ล่วงหน้าหรือไม่ ส่วนสิ่งที่เกิดตอนได้โต๊ะเหมือนกันทุกประการ · เหตุผลเต็มอยู่ในหัวไฟล์
 * migration `9.64`
 *
 * โมดูลนี้ไม่แตะเงินและไม่แตะสต็อกเลย จุดเดียวที่ต่อกับของจริงคือ "พาไปนั่ง" ซึ่งเปิดบิลโต๊ะ
 * ด้วย `openRestaurantCheckInTx()` ตัวเดียวกับที่หน้าผังโต๊ะใช้ ในทรานแซกชันเดียวกับการ
 * ปิดคิว — สองสูตรของ "เปิดบิล" จะ drift แล้ววันหนึ่งคิวจะเปิดบิลที่ข้ามด่านของอีกทาง
 */
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { RestaurantCheckError } from "./restaurantPosErrors";
import { getRestaurantCheck, openRestaurantCheckInTx } from "./restaurantPos";

export const WAITLIST_OPEN_STATUSES = ["WAITING", "CALLED"] as const;
export type WaitlistCloseStatus = "CANCELLED" | "NO_SHOW";

/**
 * "วันบริการ" ของร้าน ไม่ใช่วันตามปฏิทิน
 *
 * ใช้เขตเวลาและเวลาเริ่มวันบริการชุดเดียวกับการรีเซ็ตเมนูหมดวันนี้ (`9.55`) โดยตั้งใจ —
 * ร้านเดียวที่มีเส้นแบ่งวันสองเส้นคือร้านที่ตอบไม่ได้ว่า "วันนี้" คือช่วงไหน · ร้านที่เปิดถึง
 * ตี 2 จึงได้เลขคิวเดินต่อจนถึงรอบปิดร้าน ไม่ใช่กลับไปเป็นคิว 1 ตอนเที่ยงคืนต่อหน้าคนที่รออยู่
 */
const SERVICE_DATE_SQL = `(
  (now() AT TIME ZONE COALESCE(NULLIF(profile.timezone, ''), 'Asia/Bangkok'))
  - COALESCE(profile.menu_availability_reset_time, TIME '04:00')
)::date`;

type WaitlistRow = {
  id: string;
  kind: "WALK_IN" | "RESERVATION";
  status: string;
  service_date: string;
  queue_no: number | null;
  reserved_for: Date | string | null;
  party_size: number;
  guest_name: string | null;
  guest_phone: string | null;
  note: string | null;
  preferred_table_id: string | null;
  seated_table_id: string | null;
  check_id: string | null;
  called_at: Date | string | null;
  seated_at: Date | string | null;
  closed_at: Date | string | null;
  created_at: Date | string;
  preferred_table_code?: string | null;
  seated_table_code?: string | null;
};

const iso = (value: Date | string | null) =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);

function mapEntry(row: WaitlistRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    serviceDate: String(row.service_date).slice(0, 10),
    queueNo: row.queue_no == null ? null : Number(row.queue_no),
    reservedFor: iso(row.reserved_for),
    partySize: Number(row.party_size),
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    note: row.note,
    preferredTableId: row.preferred_table_id,
    preferredTableCode: row.preferred_table_code ?? null,
    seatedTableId: row.seated_table_id,
    seatedTableCode: row.seated_table_code ?? null,
    checkId: row.check_id,
    calledAt: iso(row.called_at),
    seatedAt: iso(row.seated_at),
    closedAt: iso(row.closed_at),
    createdAt: iso(row.created_at),
  };
}

const SELECT_COLUMNS = `w.id, w.kind, w.status, w.service_date, w.queue_no, w.reserved_for,
        w.party_size, w.guest_name, w.guest_phone, w.note, w.preferred_table_id,
        w.seated_table_id, w.check_id, w.called_at, w.seated_at, w.closed_at, w.created_at,
        pt.code AS preferred_table_code, st.code AS seated_table_code`;
const SELECT_JOINS = `LEFT JOIN bms_restaurant_tables pt
         ON pt.tenant_id = w.tenant_id AND pt.id = w.preferred_table_id
       LEFT JOIN bms_restaurant_tables st
         ON st.tenant_id = w.tenant_id AND st.id = w.seated_table_id`;

/**
 * กระดานคิวของสาขา
 *
 * คิวที่ยังรออยู่ต้องเห็นเสมอไม่ว่าจะรอมานานแค่ไหน (ตัดด้วยเวลาแล้วคิวที่รอนานที่สุดจะเป็น
 * ตัวแรกที่หายไปจากจอ ซึ่งกลับหัวกับงานของกระดานนี้) · ส่วนที่ปิดไปแล้วแสดงเฉพาะวันบริการ
 * ปัจจุบัน เพราะคำถามคือ "วันนี้เรียกใครไปแล้วบ้าง" ไม่ใช่ประวัติทั้งร้าน
 */
export async function listRestaurantWaitlist(tenantId: string, locationId: string) {
  const result = await query<WaitlistRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM bms_restaurant_waitlist w
       ${SELECT_JOINS}
       LEFT JOIN bms_store_profile profile ON profile.tenant_id = w.tenant_id
      WHERE w.tenant_id = $1 AND w.location_id = $2
        AND (w.status IN ('WAITING','CALLED') OR w.service_date = ${SERVICE_DATE_SQL})
      ORDER BY (w.status IN ('WAITING','CALLED')) DESC,
               COALESCE(w.reserved_for, w.created_at),
               w.created_at`,
    [tenantId, locationId]
  );
  const entries = result.rows.map(mapEntry);
  const open = entries.filter((entry) => entry.status === "WAITING" || entry.status === "CALLED");
  return {
    entries,
    waitingCount: open.filter((entry) => entry.status === "WAITING").length,
    calledCount: open.filter((entry) => entry.status === "CALLED").length,
    // จำนวนคนที่รออยู่จริง ไม่ใช่จำนวนคิว — โต๊ะที่ว่างพอสำหรับ 2 คนไม่ได้แปลว่ารับคิวถัดไปได้
    waitingGuests: open.reduce((sum, entry) => sum + entry.partySize, 0),
  };
}

export async function addRestaurantWaitlistEntry(input: {
  tenantId: string;
  locationId: string;
  actorUserId: string;
  kind: "WALK_IN" | "RESERVATION";
  partySize: number;
  guestName?: string | null;
  guestPhone?: string | null;
  note?: string | null;
  preferredTableId?: string | null;
  /** เฉพาะการจอง — ISO ของเวลานัด */
  reservedFor?: string | null;
}) {
  const partySize = Math.min(Math.max(Math.trunc(Number(input.partySize) || 0), 1), 500);
  const kind = input.kind === "RESERVATION" ? "RESERVATION" : "WALK_IN";
  let reservedFor: string | null = null;
  if (kind === "RESERVATION") {
    const parsed = new Date(String(input.reservedFor ?? ""));
    if (Number.isNaN(parsed.getTime())) throw new RestaurantCheckError("ระบุวันเวลาที่จองให้ถูกต้อง");
    reservedFor = parsed.toISOString();
  }
  const trim = (value: string | null | undefined, max: number) => {
    const text = String(value ?? "").trim().slice(0, max);
    return text || null;
  };

  // เลขคิวคำนวณจากแถวที่มีอยู่ในวันบริการเดียวกัน สองคนกดพร้อมกันจึงชนกันได้ —
  // unique index เป็นด่านจริง ส่วนตรงนี้ลองใหม่ให้แทนที่จะโยน error ของฐานให้คนหน้าร้านอ่าน
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const client = await getClient();
    try {
      await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
      const inserted = await client.query<{ id: string }>(
        `WITH day AS (
           SELECT ${SERVICE_DATE_SQL} AS service_date
             FROM bms_locations location
             LEFT JOIN bms_store_profile profile ON profile.tenant_id = location.tenant_id
            WHERE location.tenant_id = $1 AND location.id = $2
         )
         INSERT INTO bms_restaurant_waitlist
           (tenant_id, location_id, kind, service_date, queue_no, reserved_for, party_size,
            guest_name, guest_phone, note, preferred_table_id, created_by)
         SELECT $1, $2, $3, day.service_date,
                CASE WHEN $3 = 'WALK_IN' THEN COALESCE((
                  SELECT MAX(w.queue_no) FROM bms_restaurant_waitlist w
                   WHERE w.tenant_id = $1 AND w.location_id = $2 AND w.service_date = day.service_date
                ), 0) + 1 END,
                $4::timestamptz, $5, $6, $7, $8, $9, $10
           FROM day
         RETURNING id`,
        [input.tenantId, input.locationId, kind, reservedFor, partySize,
          trim(input.guestName, 120), trim(input.guestPhone, 40), trim(input.note, 300),
          trim(input.preferredTableId, 64), input.actorUserId]
      );
      if (!inserted.rowCount) throw new RestaurantCheckError("ไม่พบสาขานี้");
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'restaurant.waitlist_add',$3,$4::jsonb)`,
        [input.tenantId, `user:${input.actorUserId}`, inserted.rows[0].id,
          JSON.stringify({ kind, partySize, locationId: input.locationId })]
      );
      await client.query("COMMIT");
      return getRestaurantWaitlistEntry(input.tenantId, inserted.rows[0].id);
    } catch (error: any) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error?.code === "23505" && attempt < 3) continue;
      if (error?.code === "23503") throw new RestaurantCheckError("โต๊ะที่ระบุไม่ได้อยู่ในสาขานี้");
      throw error;
    } finally {
      client.release();
    }
  }
  throw new RestaurantCheckError("ออกบัตรคิวไม่สำเร็จ กรุณาลองใหม่");
}

export async function getRestaurantWaitlistEntry(tenantId: string, entryId: string) {
  const result = await query<WaitlistRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM bms_restaurant_waitlist w
       ${SELECT_JOINS}
      WHERE w.tenant_id = $1 AND w.id = $2`,
    [tenantId, entryId]
  );
  return result.rowCount ? mapEntry(result.rows[0]) : null;
}

/** เรียกคิว — ยังไม่ปิดแถว เพราะคนที่ถูกเรียกแล้วยังไม่มาเป็นเรื่องที่ต้องเห็นบนกระดาน */
export async function callRestaurantWaitlistEntry(input: {
  tenantId: string; locationId: string; entryId: string; actorUserId: string;
}) {
  const updated = await runWaitlistUpdate(input, `
    UPDATE bms_restaurant_waitlist
       SET status = 'CALLED', called_at = COALESCE(called_at, now()),
           updated_by = $4, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND location_id = $3 AND status = 'WAITING'
     RETURNING id`, "restaurant.waitlist_call", {});
  if (!updated) throw new RestaurantCheckError("เรียกคิวได้เฉพาะคิวที่ยังรออยู่");
  return getRestaurantWaitlistEntry(input.tenantId, input.entryId);
}

/**
 * ปิดคิวโดยไม่ได้นั่ง — ยกเลิกเอง หรือเรียกแล้วไม่มา
 *
 * แยกสองเหตุผลไว้คนละสถานะโดยตั้งใจ: "ลูกค้าเปลี่ยนใจ" กับ "เรียกแล้วไม่มา" เป็นคนละตัวเลข
 * เวลาร้านมาดูว่าคิวยาวเกินไปไหม · ยุบเป็นค่าเดียวแล้วคำถามนั้นตอบไม่ได้อีกเลย
 */
export async function closeRestaurantWaitlistEntry(input: {
  tenantId: string; locationId: string; entryId: string; actorUserId: string;
  status: WaitlistCloseStatus; reason?: string | null;
}) {
  // ปิดคิวทางนี้ได้แค่สองแบบ — "ได้โต๊ะ" ต้องผ่าน seatRestaurantWaitlistEntry() เท่านั้น
  // เพราะมันต้องเปิดบิลจริงในทรานแซกชันเดียวกัน (CHECK ของตารางบังคับว่า SEATED ต้องมีบิล)
  if (input.status !== "CANCELLED" && input.status !== "NO_SHOW") {
    throw new RestaurantCheckError("สถานะปิดคิวไม่ถูกต้อง");
  }
  const updated = await runWaitlistUpdate(input, `
    UPDATE bms_restaurant_waitlist
       SET status = $5, closed_at = now(), updated_by = $4, updated_at = now(),
           note = CASE WHEN $6::text IS NULL THEN note ELSE concat_ws(E'\\n', note, $6::text) END
     WHERE tenant_id = $1 AND id = $2 AND location_id = $3 AND status IN ('WAITING','CALLED')
     RETURNING id`, "restaurant.waitlist_close",
    { extra: [input.status, String(input.reason ?? "").trim().slice(0, 200) || null],
      meta: { status: input.status } });
  if (!updated) throw new RestaurantCheckError("คิวนี้ปิดไปแล้วหรือได้โต๊ะไปแล้ว");
  return getRestaurantWaitlistEntry(input.tenantId, input.entryId);
}

async function runWaitlistUpdate(
  input: { tenantId: string; locationId: string; entryId: string; actorUserId: string },
  sql: string,
  action: string,
  options: { extra?: unknown[]; meta?: Record<string, unknown> }
) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const updated = await client.query(sql, [
      input.tenantId, input.entryId, input.locationId, input.actorUserId,
      ...(options.extra ?? []),
    ]);
    if (!updated.rowCount) { await client.query("ROLLBACK"); return false; }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, action, input.entryId,
        JSON.stringify(options.meta ?? {})]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * พาคิวไปนั่ง — เปิดบิลโต๊ะและปิดคิวในทรานแซกชันเดียว
 *
 * จำนวนลูกค้าของบิลมาจากขนาดปาร์ตี้ที่จดไว้ตอนรับคิว จึงไม่ต้องถามซ้ำตอนที่โต๊ะว่างพอดี
 * และแคชเชียร์กำลังรีบ · โต๊ะที่ถูกจองไว้ (preferred) เป็นแค่คำใบ้ ไม่ใช่การล็อกโต๊ะ —
 * ล็อกโต๊ะไว้ล่วงหน้าแปลว่าโต๊ะนั้นขายไม่ได้ทั้งที่ว่างอยู่ ซึ่งร้านจริงไม่ทำ
 */
export async function seatRestaurantWaitlistEntry(input: {
  tenantId: string;
  locationId: string;
  deviceId: string;
  shiftId: string;
  entryId: string;
  tableId: string;
  actorUserId: string;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const entry = await client.query<{ party_size: number; kind: string; queue_no: number | null }>(
      `SELECT party_size, kind, queue_no FROM bms_restaurant_waitlist
        WHERE tenant_id = $1 AND id = $2 AND location_id = $3 AND status IN ('WAITING','CALLED')
        FOR UPDATE`,
      [input.tenantId, input.entryId, input.locationId]
    );
    if (!entry.rowCount) throw new RestaurantCheckError("คิวนี้ปิดไปแล้วหรือได้โต๊ะไปแล้ว");
    const checkId = await openRestaurantCheckInTx(client, {
      tenantId: input.tenantId,
      locationId: input.locationId,
      deviceId: input.deviceId,
      shiftId: input.shiftId,
      tableId: input.tableId,
      guestCount: Number(entry.rows[0].party_size),
      actorUserId: input.actorUserId,
    });
    await client.query(
      `UPDATE bms_restaurant_waitlist
          SET status = 'SEATED', seated_table_id = $4, check_id = $5,
              seated_at = now(), closed_at = now(), updated_by = $6, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND location_id = $3`,
      [input.tenantId, input.entryId, input.locationId, input.tableId, checkId, input.actorUserId]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.waitlist_seat',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, input.entryId,
        JSON.stringify({ tableId: input.tableId, checkId, queueNo: entry.rows[0].queue_no })]
    );
    await client.query("COMMIT");
    return {
      status: "SEATED" as const,
      entry: await getRestaurantWaitlistEntry(input.tenantId, input.entryId),
      check: await getRestaurantCheck(input.tenantId, checkId),
    };
  } catch (error: any) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error?.code === "23505") throw new RestaurantCheckError("โต๊ะนี้มีบิลเปิดอยู่แล้ว");
    throw error;
  } finally {
    client.release();
  }
}
