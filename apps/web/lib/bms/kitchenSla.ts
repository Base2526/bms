// =============================================================
// เกณฑ์เวลาของจอครัว แยกตามสถานี (9.53)
// -------------------------------------------------------------
// สถานีเป็นข้อความอิสระบน bms_product_stock_policies.kitchen_station ไม่มีตารางของตัวเอง
// ที่นี่จึงเก็บ "ค่าตั้งต่อชื่อสถานี" และสถานีที่ไม่มีแถวใช้ค่าปริยายจาก kitchenBoard.ts
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import type { KitchenSla } from "./kitchenBoard";

export type KitchenStationSla = KitchenSla & { station: string; stationId: string | null };

function normalizeStation(value: string | null | undefined): string {
  const station = String(value ?? "").trim();
  if (!station) throw new Error("ต้องระบุชื่อสถานี");
  if (station.length > 64) throw new Error("ชื่อสถานียาวเกินไป");
  return station;
}

/**
 * map พร้อมใช้กับ slaForStationRef() — **คีย์ด้วยทั้ง id ของสถานีและชื่อ**
 *
 * แถวเกณฑ์เวลายังคีย์ด้วยชื่อตามเดิม (9.53) แต่ตั้งแต่ `9.54` ตั๋วถือ id ด้วย และชื่อบนตั๋ว
 * เป็น snapshot ที่ค้างอยู่ที่ชื่อ ณ เวลาส่งครัว · ใส่ทั้งสองคีย์ทำให้ทั้งใบเก่า (หาด้วยชื่อ)
 * และใบที่เกิดหลังเปลี่ยนชื่อ (หาด้วย id) ได้เกณฑ์เดียวกัน · ชื่อสถานีไม่ซ้ำต่อร้าน และ id
 * เป็น uuid จึงไม่มีทางชนกันในแมพเดียว
 */
export async function getKitchenStationSlaMap(tenantId: string): Promise<Record<string, KitchenSla>> {
  const result = await query<{ station: string; station_id: string | null; warn_minutes: number; late_minutes: number }>(
    `SELECT sla.station, st.id AS station_id, sla.warn_minutes, sla.late_minutes
       FROM bms_kitchen_station_slas sla
       LEFT JOIN bms_kitchen_stations st
         ON st.tenant_id = sla.tenant_id AND st.name = sla.station
      WHERE sla.tenant_id = $1`,
    [tenantId]
  );
  const map: Record<string, KitchenSla> = {};
  for (const row of result.rows) {
    const sla = { warnMinutes: Number(row.warn_minutes), lateMinutes: Number(row.late_minutes) };
    map[row.station] = sla;
    if (row.station_id) map[String(row.station_id)] = sla;
  }
  return map;
}

/**
 * สถานีที่ร้านใช้จริง (จากรูปแบบสต็อกของสินค้า) คู่กับเกณฑ์ที่ตั้งไว้ — หน้าตั้งค่าต้องแสดง
 * สถานีที่ยังไม่เคยตั้งด้วย ไม่งั้นร้านต้องเดาว่าต้องพิมพ์ชื่อสถานีให้ตรงเป๊ะเอง
 */
export async function listKitchenStationSlas(tenantId: string): Promise<Array<KitchenStationSla & { configured: boolean }>> {
  const result = await query<{ station: string; station_id: string | null; warn_minutes: number | null; late_minutes: number | null }>(
    `SELECT s.station, st.id AS station_id, sla.warn_minutes, sla.late_minutes
       FROM (
         SELECT DISTINCT btrim(kitchen_station) AS station
           FROM bms_product_stock_policies
          WHERE tenant_id = $1 AND btrim(COALESCE(kitchen_station, '')) <> ''
         UNION
         SELECT station FROM bms_kitchen_station_slas WHERE tenant_id = $1
         UNION
         -- สถานีที่ร้านเพิ่งสร้างและยังไม่มีเมนูผูก ต้องตั้งเกณฑ์เวลาได้ตั้งแต่วันแรก (9.54)
         SELECT name FROM bms_kitchen_stations WHERE tenant_id = $1 AND active
       ) s
       LEFT JOIN bms_kitchen_station_slas sla
         ON sla.tenant_id = $1 AND sla.station = s.station
       LEFT JOIN bms_kitchen_stations st
         ON st.tenant_id = $1 AND st.name = s.station
      ORDER BY st.sort_order NULLS LAST, s.station`,
    [tenantId]
  );
  return result.rows.map((row) => ({
    station: row.station,
    stationId: row.station_id ? String(row.station_id) : null,
    warnMinutes: row.warn_minutes == null ? 5 : Number(row.warn_minutes),
    lateMinutes: row.late_minutes == null ? 10 : Number(row.late_minutes),
    configured: row.warn_minutes != null,
  }));
}

export async function upsertKitchenStationSla(
  tenantId: string,
  input: { station: string; warnMinutes: number; lateMinutes: number },
  editorId?: string | null
): Promise<KitchenStationSla> {
  const station = normalizeStation(input.station);
  const warnMinutes = Math.trunc(Number(input.warnMinutes));
  const lateMinutes = Math.trunc(Number(input.lateMinutes));
  // ตรวจที่ชั้นแอปด้วย ไม่ใช่ปล่อยให้ CHECK ของฐานเป็นคนบอก — ข้อความของ Postgres
  // อ่านไม่รู้เรื่องสำหรับคนตั้งค่าหน้าร้าน
  if (!Number.isFinite(warnMinutes) || !Number.isFinite(lateMinutes)) {
    throw new Error("เกณฑ์เวลาต้องเป็นตัวเลข");
  }
  if (warnMinutes < 0 || lateMinutes <= 0 || lateMinutes > 600) {
    throw new Error("เกณฑ์เวลาต้องอยู่ระหว่าง 0 ถึง 600 นาที");
  }
  if (warnMinutes >= lateMinutes) {
    throw new Error("เวลาเตือน (เหลือง) ต้องน้อยกว่าเวลาสาย (แดง)");
  }
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId });
    const result = await client.query<{ station: string; warn_minutes: number; late_minutes: number }>(
      `INSERT INTO bms_kitchen_station_slas (tenant_id, station, warn_minutes, late_minutes)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, station) DO UPDATE
         SET warn_minutes = EXCLUDED.warn_minutes,
             late_minutes = EXCLUDED.late_minutes,
             updated_at = now()
       RETURNING station, warn_minutes, late_minutes`,
      [tenantId, station, warnMinutes, lateMinutes]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'kitchen.station_sla',$3,$4::jsonb)`,
      [tenantId, editorId ? `user:${editorId}` : "system", station,
        JSON.stringify({ warnMinutes, lateMinutes })]
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    const linked = await client.query<{ id: string }>(
      `SELECT id FROM bms_kitchen_stations WHERE tenant_id = $1 AND name = $2`,
      [tenantId, station]
    );
    return {
      station: row.station,
      stationId: linked.rows[0]?.id ? String(linked.rows[0].id) : null,
      warnMinutes: Number(row.warn_minutes),
      lateMinutes: Number(row.late_minutes),
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/** ลบค่าตั้งของสถานี = กลับไปใช้ค่าปริยาย (ไม่ใช่ปิดการเตือน) */
export async function clearKitchenStationSla(
  tenantId: string,
  station: string,
  editorId?: string | null
): Promise<boolean> {
  const name = normalizeStation(station);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId });
    const result = await client.query(
      `DELETE FROM bms_kitchen_station_slas WHERE tenant_id = $1 AND station = $2`,
      [tenantId, name]
    );
    if (result.rowCount) {
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'kitchen.station_sla_cleared',$3,'{}'::jsonb)`,
        [tenantId, editorId ? `user:${editorId}` : "system", name]
      );
    }
    await client.query("COMMIT");
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
