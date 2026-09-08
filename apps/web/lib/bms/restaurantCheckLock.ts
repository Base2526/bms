import type { PoolClient } from "pg";

/**
 * ลำดับการล็อกของบิลโต๊ะ — **กะ → บิล → ใบจอง → สต็อก → ตั๋วครัว**
 *
 * ทุกเส้นทางที่แตะบิลโต๊ะต้องไล่ล็อกตามลำดับนี้เสมอ ไม่ใช่ตามลำดับที่ข้อมูลของตัวเองมาถึง ·
 * นี่คือวิธีกัน deadlock แบบมาตรฐาน (lock ordering): ถ้าทุกทรานแซกชันขอทรัพยากรในลำดับ
 * เดียวกัน วงรอการรอจะเกิดไม่ได้เลย
 *
 * **ของจริงที่เคยกลับหัว** (แก้ 2026-09-08): จอครัวกดยกเลิกจานหนึ่งจะล็อก *แถวตั๋ว* ก่อน
 * แล้วค่อยไปขอกะ/บิล (เพราะการยกเลิกตั๋วต้องตัดบรรทัดออกจากยอด) ขณะที่ "ยกเลิกทั้งบิล"
 * ขอบิลก่อนแล้วค่อยไล่อัปเดตตั๋วทุกใบของบิลนั้น → สองอันนี้รอกันเป็นวงแล้วได้ `40P01`
 * ที่หน้าจอเห็นเป็น "เซิร์ฟเวอร์ผิดพลาด" · ทางแก้คือให้ฝั่งตั๋ว **ขอกะกับบิลให้ครบก่อน**
 * ถึงจะแตะแถวตั๋ว ไม่ใช่ให้ฝั่งบิลไปขอตั๋วก่อน (ซึ่งจะไปกลับหัวกับการส่งครัวแทน)
 *
 * ห้ามประกอบคีย์ advisory lock เองที่อื่น — คีย์คนละรูปคือล็อกคนละตัว ซึ่งแปลว่า
 * "ล็อกแล้ว" ทั้งที่ไม่ได้กันใครเลย
 */
export function restaurantCheckLockKey(tenantId: string, checkId: string) {
  return `restaurant-check:${tenantId}:${checkId}`;
}

/** ล็อกบิลข้าม instance บน client ที่กำลังเขียนอยู่ — ต้องเรียกหลัง beginTenantTx() */
export async function lockRestaurantCheckInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  checkId: string
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    restaurantCheckLockKey(tenantId, checkId),
  ]);
}

/**
 * ล็อกกะแบบ FOR KEY SHARE — โหมดเดียวกับที่ FK ของ `bms_orders.pos_shift_id` จะขอเอง
 *
 * ต้องเป็นโหมดนี้เท่านั้น: ถ้าขอแรงกว่า (FOR UPDATE) การขายสองบิลบนกะเดียวกันจะกลาย
 * เป็นคิวเดียว และถ้าไม่ขอเลย จะไปกลับหัวกับเส้นทางที่ขอกะก่อน (recordPosSale/ส่งครัว)
 */
export async function lockPosShiftInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  shiftId: string
) {
  await client.query(
    `SELECT 1 FROM bms_pos_shifts WHERE tenant_id = $1 AND id = $2 FOR KEY SHARE`,
    [tenantId, shiftId]
  );
}

/**
 * ขอกะและบิลทั้งชุดล่วงหน้าตามลำดับ canonical (เรียงตาม id) ก่อนแตะแถวตั๋ว
 *
 * เรียงก่อนเสมอเพราะคำขอหนึ่งอาจครอบหลายบิล (จอครัวกดทั้งใบ = หลายตั๋ว และเลื่อนทีละ
 * หลายใบได้ถึง 50) · สองคำขอที่ถือชุดเดียวกันแต่คนละลำดับจะรอกันเองถ้าไม่เรียง
 *
 * @returns จำนวนบิลที่ถูกล็อก (0 = ไม่มีตั๋วใบไหนเป็นของบิลโต๊ะ เช่นตั๋วของออร์เดอร์ค้าปลีก)
 */
export async function lockCheckScopeForKitchenTicketsInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  ticketIds: string[]
): Promise<number> {
  if (!ticketIds.length) return 0;
  // อ่านแบบไม่ล็อกเพื่อ "รู้ว่าต้องล็อกอะไรบ้าง" — ค่าที่ได้อาจเก่าได้ ไม่เป็นไร เพราะ
  // ผู้เรียกอ่านซ้ำใต้ล็อกอยู่แล้วและเป็นตัวตัดสินจริง · การล็อกเกินคือการรอฟรี ไม่ใช่ความผิด
  const scope = await client.query<{ check_id: string; pos_shift_id: string | null }>(
    `SELECT DISTINCT c.id AS check_id, c.pos_shift_id
       FROM bms_restaurant_kitchen_tickets t
       JOIN bms_restaurant_checks c ON c.tenant_id = t.tenant_id AND c.id = t.check_id
      WHERE t.tenant_id = $1 AND t.id = ANY($2::uuid[])`,
    [tenantId, ticketIds]
  );
  if (!scope.rowCount) return 0;
  const shiftIds = [...new Set(scope.rows.map((row) => row.pos_shift_id).filter(Boolean))].sort() as string[];
  for (const shiftId of shiftIds) await lockPosShiftInTx(client, tenantId, shiftId);
  const checkIds = [...new Set(scope.rows.map((row) => row.check_id))].sort();
  for (const checkId of checkIds) await lockRestaurantCheckInTx(client, tenantId, checkId);
  return checkIds.length;
}
