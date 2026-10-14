import type { PoolClient } from "pg";

export const ACTIVE_TAX_DOCUMENT_BLOCK_MESSAGE =
  "บิลนี้มีเอกสารภาษีที่ยังใช้งานอยู่ กรุณาคืนผ่านหน้า POS เพื่อออกใบลดหนี้";

/**
 * เอกสารขายที่ "ยังมียอดคงเหลือ" = ยังไม่ถูกยกเลิก และใบลดหนี้ที่มีผลอยู่ยังลดไม่ครบยอด
 * ใบที่ลดหนี้ครบแล้ว (เช่นยกเลิกออร์เดอร์ที่ออกใบเต็มไปแล้ว) ไม่ขวางการคืนเงินต่อ
 */
export const OUTSTANDING_SALES_DOCUMENT_SQL = `d.doc_type IN ('ABBREVIATED','FULL') AND d.cancelled_at IS NULL
        AND d.grand_total - COALESCE((
          SELECT SUM(cn.grand_total) FROM bms_tax_documents cn
           WHERE cn.tenant_id = d.tenant_id AND cn.references_document_id = d.id
             AND cn.doc_type = 'CREDIT_NOTE' AND cn.cancelled_at IS NULL
        ), 0) > 0.005`;

/** Money-changing back-office paths may not leave an issued invoice active. */
export async function assertNoActiveSalesTaxDocumentInTx(
  client: PoolClient,
  tenantId: string,
  orderId: string
): Promise<void> {
  const active = await client.query(
    `SELECT 1 FROM bms_tax_documents d
      WHERE d.tenant_id = $1 AND d.order_id = $2
        AND ${OUTSTANDING_SALES_DOCUMENT_SQL}
      LIMIT 1`,
    [tenantId, orderId]
  );
  if (active.rowCount) throw new Error(ACTIVE_TAX_DOCUMENT_BLOCK_MESSAGE);
}
