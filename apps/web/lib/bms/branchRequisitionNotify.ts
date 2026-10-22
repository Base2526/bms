import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { createNotification } from "@/lib/notifications/service";

type Notice = {
  tenantId: string;
  actorId: string;
  requestId?: string;
  transferId?: string;
  kind:
    | "SUBMIT"
    | "REVIEW"
    | "TRANSFER_SENT"
    | "TRANSFER_RECEIVED"
    | "TRANSFER_DISCREPANCY";
};

/** Resolve recipients from current tenant RBAC + assigned branches, not client-provided user IDs. */
export async function requisitionNotificationRecipients(input: Notice) {
  const c = await getClient();
  try {
    await beginTenantTx(c, input.tenantId);
    const result = await c.query(
      `SELECT DISTINCT r.id,r.request_no,r.status,u.id AS user_id,u.language
      FROM bms_branch_requisitions r JOIN users u ON u.tenant_id=r.tenant_id JOIN roles role ON role.id=u.role_id
      WHERE r.tenant_id=$1 AND u.id<>$2 AND COALESCE(u.pos_only,false)=false
      AND (($3::uuid IS NOT NULL AND r.id=$3) OR ($4::uuid IS NOT NULL AND EXISTS (
        SELECT 1 FROM bms_branch_requisition_items i
        JOIN bms_branch_requisition_transfers a ON a.tenant_id=i.tenant_id AND a.item_id=i.id
        JOIN bms_stock_transfer_items ti ON ti.tenant_id=a.tenant_id AND ti.id=a.transfer_item_id
        WHERE i.tenant_id=r.tenant_id AND i.requisition_id=r.id AND ti.transfer_id=$4)))
      AND (role.name='Administrator' OR EXISTS (SELECT 1 FROM bms_role_permissions p
        WHERE p.tenant_id=r.tenant_id AND p.role_id=u.role_id AND p.permission='inventory.requisition.view'))
      AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=r.tenant_id AND a.user_id=u.id)
        OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=r.tenant_id AND a.user_id=u.id AND a.location_id=r.location_id))
      AND (($5<>'SUBMIT' AND u.id=r.created_by) OR ($5<>'REVIEW' AND (role.name='Administrator' OR EXISTS (
        SELECT 1 FROM bms_role_permissions p WHERE p.tenant_id=r.tenant_id AND p.role_id=u.role_id AND p.permission='inventory.requisition.review'))))`,
      [
        input.tenantId,
        input.actorId,
        input.requestId ?? null,
        input.transferId ?? null,
        input.kind,
      ],
    );
    await c.query("COMMIT");
    return result.rows;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}

/** Best-effort staff notices AFTER commit, like order-action notices; never change a stock/document result. */
export async function notifyBranchRequisitionCommitted(
  input: Notice,
): Promise<void> {
  const deliver = async () => {
    try {
      const recipients = await requisitionNotificationRecipients(input);
      await Promise.all(
        recipients.map(async (r) => {
          const en = r.language === "en";
          const labels = {
            SUBMIT: en ? "Awaiting review" : "รอตรวจคำขอ",
            REVIEW:
              r.status === "REJECTED"
                ? en
                  ? "Request rejected"
                  : "ไม่อนุมัติคำขอ"
                : en
                  ? "Request approved"
                  : "อนุมัติคำขอแล้ว",
            TRANSFER_SENT: en ? "Transfer sent" : "ส่งสินค้าแล้ว",
            TRANSFER_RECEIVED: en ? "Transfer received" : "รับสินค้าแล้ว",
            TRANSFER_DISCREPANCY: en
              ? "Receipt discrepancy"
              : "พบส่วนต่างตอนรับสินค้า",
          };
          await createNotification({
            user_id: r.user_id,
            type: "BMS_REQUISITION_ACTION",
            title: `${labels[input.kind]} · ${r.request_no}`,
            message: en
              ? "Open the request to review current quantities and document evidence."
              : "เปิดคำขอเพื่อตรวจจำนวนล่าสุดและหลักฐานเอกสาร",
            entity_type: "bms_requisition_action",
            entity_id: r.id,
            data: {
              kind: input.kind,
              href: `/admin/branch-requisitions?id=${r.id}`,
            },
          });
        }),
      );
    } catch (error) {
      console.error("[BMS] requisition notification failed", error);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      deliver(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
