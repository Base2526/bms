import type { PoolClient } from "pg";

export const ACTIVE_TAX_DOCUMENT_BLOCK_MESSAGE =
  "บิลนี้มีเอกสารภาษีที่ยังใช้งานอยู่ กรุณาคืนผ่านหน้า POS เพื่อออกใบลดหนี้";

/** Money-changing back-office paths may not leave an issued invoice active. */
export async function assertNoActiveSalesTaxDocumentInTx(
  client: PoolClient,
  tenantId: string,
  orderId: string
): Promise<void> {
  const active = await client.query(
    `SELECT 1 FROM bms_tax_documents
      WHERE tenant_id = $1 AND order_id = $2
        AND doc_type IN ('ABBREVIATED','FULL') AND cancelled_at IS NULL
      LIMIT 1`,
    [tenantId, orderId]
  );
  if (active.rowCount) throw new Error(ACTIVE_TAX_DOCUMENT_BLOCK_MESSAGE);
}
