// =============================================================
// BMS — เลขที่เอกสารรายวันต่อร้าน (PREFIX-YYMMDD-NNN)
// -------------------------------------------------------------
// เวอร์ชันแรกของ 7.98 คิดเลขแบบ "วันที่จาก Node + COUNT(*) จาก Postgres" ซึ่งพัง
// สองทาง:
//
// 1) คนละนาฬิกา — ถ้าแอปเป็น Asia/Bangkok แต่ฐานเป็น UTC ช่วง 00:00–07:00 เวลาไทย
//    stamp จะเป็น "วันนี้" แต่ตัวนับไปนับแถวของ CURRENT_DATE ซึ่งยังเป็นเมื่อวาน
//    พอข้าม 07:00 ตัวนับรีเซ็ตกลับ 001 ทั้งที่ stamp ยังวันเดิม → เลขซ้ำของจริง
//    ไม่ใช่แค่ race ที่ต้องซวยถึงจะเจอ · แก้โดยให้ทั้งวันที่และตัวนับออกจาก SQL
//    คำสั่งเดียวกัน จะตั้ง TZ ของฐานเป็นอะไรก็ตรงกันเสมอ
//
// 2) COUNT(*)+1 สองคนกดพร้อมกันได้เลขเดียวกัน แล้ว unique index เตะทิ้งกลายเป็น
//    500 ที่หน้าคลัง · แก้ด้วย SAVEPOINT + ลองใหม่ ซึ่งลู่เข้าเสมอ: การที่ INSERT
//    ชน unique แปลว่าอีกฝั่ง commit ไปแล้ว (index บล็อกจนกว่าจะรู้ผล) การนับรอบ
//    ใหม่ใน READ COMMITTED จึงเห็นแถวนั้นแน่นอน ลำดับเลยขยับไปเลขถัดไป
//
// ต้องเรียกจากในทรานแซกชันที่เปิดไว้แล้ว (SAVEPOINT ใช้นอกทรานแซกชันไม่ได้)
// =============================================================

import type { PoolClient } from "pg";

/**
 * ตารางที่ออกเลขแบบนี้ — จงใจเป็น union ของ literal ไม่ใช่ string
 * ชื่อตารางถูกต่อเข้า SQL ตรง ๆ (parameter ใช้แทนชื่อตารางไม่ได้) การผูกชนิดไว้
 * ที่นี่คือสิ่งที่กันไม่ให้ชื่อจากที่อื่นหลุดเข้ามาได้
 */
export type DailyDocTable = "bms_stock_transfers" | "bms_stock_counts";

const MAX_ATTEMPTS = 5;

/** รหัสของ Postgres สำหรับ unique_violation */
const UNIQUE_VIOLATION = "23505";

export async function insertWithDailyDocNo<T>(
  client: PoolClient,
  args: { tenantId: string; table: DailyDocTable; prefix: string },
  insert: (docNo: string) => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await client.query<{ doc_no: string }>(
      `SELECT $2 || '-' || to_char(CURRENT_DATE, 'YYMMDD') || '-'
              || lpad(((SELECT COUNT(*) FROM ${args.table}
                         WHERE tenant_id = $1 AND created_at::date = CURRENT_DATE) + 1)::text, 3, '0')
              AS doc_no`,
      [args.tenantId, args.prefix]
    );
    const docNo = res.rows[0].doc_no;

    await client.query("SAVEPOINT daily_doc_no");
    try {
      const out = await insert(docNo);
      await client.query("RELEASE SAVEPOINT daily_doc_no");
      return out;
    } catch (err: any) {
      if (err?.code !== UNIQUE_VIOLATION || attempt >= MAX_ATTEMPTS) throw err;
      // ชนเลขกับคนที่ commit ไปก่อน — ย้อนเฉพาะ INSERT นี้ แล้วนับใหม่
      await client.query("ROLLBACK TO SAVEPOINT daily_doc_no");
    }
  }
}
