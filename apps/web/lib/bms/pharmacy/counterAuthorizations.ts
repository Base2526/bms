// =============================================================
// บันทึกการจ่ายยาที่เภสัชกรอนุมัติที่เคาน์เตอร์ (9.29) — เส้นทางอ่าน
// -------------------------------------------------------------
// `bms_pos_pharmacist_authorizations` เขียนในทรานแซกชันเดียวกับบิลที่มันอนุมัติ
// (ดู createOrder) แต่ตอนแรกไม่มีที่ไหนอ่านมันเลย ซึ่งทำให้หลักฐานที่ตั้งใจเก็บ
// ตอบคำถามของคนไม่ได้ — เภสัชกรผู้มีหน้าที่ต้องตอบได้ว่า "ใครจ่ายยาอะไรให้บิลไหน
// เมื่อไร" โดยไม่ต้องเปิด psql
//
// อ่านอย่างเดียว · ไม่มี mutation ในโมดูลนี้: หลักฐานที่แก้ได้ไม่ใช่หลักฐาน
// (ตารางนี้ GRANT ให้ bms_app แค่ SELECT/INSERT ตั้งแต่ migration แล้ว)
// =============================================================

import { query } from "@/lib/db";

export type PharmacistCounterAuthorization = {
  id: string;
  orderId: string;
  /** รหัสสั้นที่พนักงานใช้เรียกบิล (ตรงกับที่หน้า POS โชว์ตอนขายจบ) */
  orderCode: string;
  /** เลขใบกำกับ/ใบเสร็จถ้าออกแล้ว — บิลมัดจำที่ยังไม่ส่งของยังไม่มี */
  taxDocNo: string | null;
  productSku: string;
  productName: string | null;
  size: string;
  qty: number;
  /** policy ที่ถูกปลด ณ เวลานั้น (snapshot ในแถว ไม่ใช่ค่าปัจจุบันของสินค้า) */
  salePolicy: string;
  policyStatus: string;
  pharmacistUserId: string;
  pharmacistName: string | null;
  cashierName: string | null;
  note: string | null;
  createdAt: string;
};

export type PharmacistCounterAuthorizationPage = {
  items: PharmacistCounterAuthorization[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * รายการล่าสุดก่อน — คนเปิดดูมักถามถึงบิลที่เพิ่งเกิด · กรองช่วงวันได้เพราะการทบทวน
 * ของร้านยาเป็นรายเดือน/รายไตรมาส ไม่ใช่ดูแต่วันนี้
 */
export async function listPharmacistCounterAuthorizations(
  tenantId: string,
  options: { from?: string | null; to?: string | null; limit?: number; offset?: number } = {}
): Promise<PharmacistCounterAuthorizationPage> {
  const limit = Math.max(1, Math.min(200, Number(options.limit ?? 50) || 50));
  const offset = Math.max(0, Number(options.offset ?? 0) || 0);
  const from = options.from?.trim() || null;
  const to = options.to?.trim() || null;

  const res = await query<{
    id: string;
    order_id: string;
    tax_doc_no: string | null;
    product_sku: string;
    product_name: string | null;
    size: string;
    qty: number;
    sale_policy: string;
    policy_status: string;
    pharmacist_user_id: string;
    pharmacist_name: string | null;
    cashier_name: string | null;
    note: string | null;
    created_at: Date;
    total_count: number;
  }>(
    `SELECT auth.id,
            auth.order_id,
            (
              -- subquery ไม่ใช่ JOIN โดยตั้งใจ: ถ้ามีเอกสารมากกว่าหนึ่งใบต่อบิล JOIN จะ
              -- คูณจำนวนแถวแล้ว COUNT(*) OVER() ด้านล่างเพี้ยนไปด้วย
              SELECT doc.doc_no
                FROM bms_tax_documents doc
               WHERE doc.tenant_id = auth.tenant_id
                 AND doc.order_id = auth.order_id
                 -- ใบที่ถูกยกเลิกไม่ใช่ใบที่ลูกค้าถืออยู่ จึงไม่เอามาเป็นเลขอ้างอิง
                 AND doc.doc_type <> 'CREDIT_NOTE'
                 AND doc.cancelled_at IS NULL
               ORDER BY doc.issued_at DESC
               LIMIT 1
            )                         AS tax_doc_no,
            auth.product_sku,
            product.name              AS product_name,
            auth.size,
            auth.qty,
            auth.sale_policy,
            auth.policy_status,
            auth.pharmacist_user_id,
            pharmacist.name           AS pharmacist_name,
            cashier.name              AS cashier_name,
            auth.note,
            auth.created_at,
            COUNT(*) OVER()::int      AS total_count
       FROM bms_pos_pharmacist_authorizations auth
       -- สินค้าอาจถูกลบออกจากแคตาล็อกภายหลัง หลักฐานต้องยังอ่านได้ (LEFT JOIN)
       LEFT JOIN bms_products product
         ON product.tenant_id = auth.tenant_id AND product.sku = auth.product_sku
       LEFT JOIN bms_orders ord ON ord.id = auth.order_id
       LEFT JOIN users pharmacist ON pharmacist.id = auth.pharmacist_user_id
       LEFT JOIN users cashier ON cashier.id = ord.cashier_user_id
      WHERE auth.tenant_id = $1
        AND ($2::timestamptz IS NULL OR auth.created_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR auth.created_at < $3::timestamptz)
      ORDER BY auth.created_at DESC, auth.product_sku
      LIMIT $4 OFFSET $5`,
    [tenantId, from, to, limit, offset]
  );

  return {
    items: res.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      orderCode: String(row.order_id).slice(0, 8).toUpperCase(),
      taxDocNo: row.tax_doc_no ?? null,
      productSku: row.product_sku,
      productName: row.product_name ?? null,
      size: row.size,
      qty: Number(row.qty),
      salePolicy: row.sale_policy,
      policyStatus: row.policy_status,
      pharmacistUserId: row.pharmacist_user_id,
      pharmacistName: row.pharmacist_name ?? null,
      cashierName: row.cashier_name ?? null,
      note: row.note ?? null,
      // `pg` คืน TIMESTAMPTZ เป็น Date — field ใน GraphQL เป็น String! ต้อง toISOString()
      // ไม่งั้น serialize ได้ epoch number แล้วหน้าจอโชว์ Invalid Date (กับดักข้อ 1)
      createdAt: new Date(row.created_at).toISOString(),
    })),
    total: res.rows[0]?.total_count ?? 0,
    limit,
    offset,
  };
}
