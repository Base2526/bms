import type { QueryResult, QueryResultRow } from "pg";
import { closeSessionTableOccupancyInTx, closeTableOccupancyInTx } from "./boardGameOccupancy";

/**
 * สถานะของโต๊ะบอร์ดเกมเป็น "ผลรวมของกลุ่มบิล" ไม่ใช่ค่าที่ตั้งเอง (`9.89`)
 * ---------------------------------------------------------------------
 * session ยังเปิดตราบใดที่มีกลุ่มไหนยังเล่นอยู่ ส่วนที่นั่ง (`9.91`) ยัง ACTIVE ตราบใดที่
 * มี session ใดบนที่นั่งนั้นยัง OPEN/CLOSING · แยกสองชั้นนี้เพื่อให้รวมโต๊ะได้โดยไม่รวมบิล
 *
 * อยู่ในไฟล์ของตัวเองเพราะผู้เรียกมีสองฝั่ง: โมดูลบอร์ดเกม (เปิด/ปิด/ยกเลิก) และเส้นทางรับเงิน
 * ของ POS (`pos.ts`) · วางไว้ในโมดูลใดโมดูลหนึ่งจะเกิด import วนกัน ส่วนการก็อปไปไว้สองที่
 * แปลว่าวันหนึ่งสองฝั่งจะตอบไม่ตรงกันว่าโต๊ะนี้ว่างหรือยัง — ไฟล์นี้จึง import เฉพาะ
 * type ของ pg และตัวเขียน occupancy ledger ที่ใช้ transaction ของผู้เรียก
 */
type QueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
};

export async function refreshSessionFromGroupsInTx(
  client: QueryClient,
  tenantId: string,
  sessionId: string
) {
  const refreshed = await client.query<{ seating_id: string | null; status: string; ended_at: Date | null }>(
    `UPDATE bms_board_game_sessions s
        SET status = agg.status,
            ended_at = CASE WHEN agg.status = 'OPEN' THEN NULL ELSE agg.ended_at END,
            guest_count = agg.guest_count,
            version = s.version + 1,
            updated_at = now()
       FROM (
         SELECT
           CASE
             WHEN count(*) FILTER (WHERE g.status = 'OPEN') > 0 THEN 'OPEN'
             WHEN count(*) FILTER (WHERE g.status = 'CLOSING') > 0 THEN 'CLOSING'
             WHEN count(*) FILTER (WHERE g.status = 'PAID') > 0 THEN 'PAID'
             ELSE 'CANCELLED'
           END AS status,
           max(g.ended_at) AS ended_at,
           COALESCE((
             SELECT count(*)
               FROM bms_board_game_session_participants p
               JOIN bms_board_game_billing_groups og
                 ON og.tenant_id = p.tenant_id AND og.id = p.billing_group_id
              WHERE p.tenant_id = $1 AND p.session_id = $2
                AND p.left_at IS NULL AND og.status = 'OPEN'
           ), 0) AS guest_count
         FROM bms_board_game_billing_groups g
        WHERE g.tenant_id = $1 AND g.session_id = $2
       ) agg
      WHERE s.tenant_id = $1 AND s.id = $2
      RETURNING s.seating_id,s.status,s.ended_at`,
    [tenantId, sessionId]
  );
  const session = refreshed.rows[0];
  // CLOSING is a recoverable payment claim, not a terminal play state. Keep the
  // membership interval open so a rejected/unknown payment can return to OPEN.
  if (session && (session.status === "PAID" || session.status === "CANCELLED") && session.ended_at) {
    await closeSessionTableOccupancyInTx(
      client,
      tenantId,
      sessionId,
      new Date(session.ended_at),
      session.status === "CANCELLED" ? "CANCELLED" : "CLOSED",
    );
  }
  const seatingId = session?.seating_id;
  if (seatingId) await refreshBoardGameSeatingInTx(client, tenantId, seatingId);
}

/**
 * ที่นั่งว่างเมื่อทุก session ที่ยังผูกอยู่จบแล้วเท่านั้น
 *
 * หลังรวมโต๊ะ session หลายก้อนแชร์ seating เดียวกันได้ การจ่ายบิลก้อนหนึ่งจึงห้ามปิดโต๊ะ
 * ถ้ายังมีอีกก้อนเล่นหรือรอเก็บเงินอยู่ สถานะ MERGED เป็นประวัติของ seating ต้นทางและห้ามเปิดกลับ
 */
export async function refreshBoardGameSeatingInTx(
  client: QueryClient,
  tenantId: string,
  seatingId: string
) {
  const refreshed = await client.query<{ status: string; closed_at: Date | null }>(
    `UPDATE bms_board_game_seatings st
        SET status = CASE WHEN EXISTS (
              SELECT 1 FROM bms_board_game_sessions s
               WHERE s.tenant_id = st.tenant_id AND s.seating_id = st.id
                 AND s.status IN ('OPEN', 'CLOSING')
            ) THEN 'ACTIVE' ELSE 'CLOSED' END,
            closed_at = CASE WHEN EXISTS (
              SELECT 1 FROM bms_board_game_sessions s
               WHERE s.tenant_id = st.tenant_id AND s.seating_id = st.id
                 AND s.status IN ('OPEN', 'CLOSING')
            ) THEN NULL ELSE COALESCE(st.closed_at, now()) END,
            version = st.version + 1,
            updated_at = now()
      WHERE st.tenant_id = $1 AND st.id = $2 AND st.status <> 'MERGED'
      RETURNING st.status, st.closed_at`,
    [tenantId, seatingId]
  );
  const row = refreshed.rows[0];
  if (row?.status === "CLOSED" && row.closed_at) {
    const status = await client.query<{ cancelled: boolean }>(
      `SELECT bool_and(status = 'CANCELLED') AS cancelled
         FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND seating_id = $2`,
      [tenantId, seatingId],
    );
    await closeTableOccupancyInTx(
      client,
      tenantId,
      seatingId,
      new Date(row.closed_at),
      status.rows[0]?.cancelled ? "CANCELLED" : "CLOSED",
    );
  }
}
