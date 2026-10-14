import type { PoolClient } from "pg";

export const ACTIVE_TAX_DOCUMENT_BLOCK_MESSAGE =
  "บิลนี้มีเอกสารภาษีที่ยังใช้งานอยู่ กรุณาคืนผ่านหน้า POS เพื่อออกใบลดหนี้";

/** Money-changing back-office paths may not leave an issued invoice active. */
export async function assertNoActiveSalesTaxDocumentInTx(
  client: PoolClient,
  tenantId: string,
  orderId: string
): Promise<void> {
  // Serialize the check with full issuance, which locks this same order first.
  // Checking documents before acquiring the order lock permits a concurrent
  // issuer to commit between the check and the cancellation/return update.
  await client.query(
    `SELECT id FROM bms_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, orderId]
  );
  const active = await client.query(
    `SELECT 1 FROM bms_tax_documents
      WHERE tenant_id = $1 AND order_id = $2
        AND doc_type IN ('ABBREVIATED','FULL') AND cancelled_at IS NULL
      LIMIT 1`,
    [tenantId, orderId]
  );
  if (active.rowCount) throw new Error(ACTIVE_TAX_DOCUMENT_BLOCK_MESSAGE);
}
