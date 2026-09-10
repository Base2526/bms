// =============================================================
// Staff order-action notifications — post-commit, best effort
// -------------------------------------------------------------
// An order write is authoritative; this module may only announce a committed
// result. Notification failure is logged and never changes the order outcome.
// Recipients are selected server-side from tenant RBAC + branch scope.
// =============================================================

import { query } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";

export type OrderActionKind = "ORDER_CREATED" | "ORDER_PAID" | "KITCHEN_TICKETS_CREATED";

type OrderActionInput = {
  tenantId: string;
  orderId: string;
  kind: OrderActionKind;
  excludeUserId?: string | null;
};

type OrderAlertRow = {
  id: string;
  channel: string;
  status: string;
  amount_due: string | number;
  location_id: string | null;
  location_name: string | null;
  branch_code: string | null;
  fulfillment_type: "DELIVERY" | "PICKUP" | null;
};

type Recipient = { id: string; language: string | null };

const REQUIRED_PERMISSIONS: Record<OrderActionKind, readonly string[]> = {
  ORDER_CREATED: ["order.view"],
  // The destination page itself reads orders. Action-only permission without order.view would
  // produce a notification that opens a forbidden/empty screen.
  ORDER_PAID: ["order.view", "order.ship"],
  KITCHEN_TICKETS_CREATED: ["order.view", "restaurant.kitchen.update"],
};

function textFor(kind: OrderActionKind, order: OrderAlertRow, language: string | null) {
  const english = language === "en";
  const shortId = order.id.slice(0, 8).toUpperCase();
  const branch = order.location_name || order.branch_code;
  const amount = Number(order.amount_due || 0).toLocaleString(english ? "en-US" : "th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  if (kind === "KITCHEN_TICKETS_CREATED") {
    return {
      title: english ? `New kitchen ticket #${shortId}` : `มีตั๋วใหม่เข้าครัว #${shortId}`,
      message: english
        ? `A new round is waiting${branch ? ` at ${branch}` : ""}. Open the kitchen board.`
        : `มีรายการรอครัวรับงาน${branch ? ` · ${branch}` : ""} เปิดกระดานครัวเพื่อตรวจสอบ`,
    };
  }

  if (kind === "ORDER_PAID") {
    return {
      title: english ? `Order paid #${shortId}` : `ออเดอร์ชำระแล้ว #${shortId}`,
      message: english
        ? `Ready for staff action · ${amount} THB${branch ? ` · ${branch}` : ""}`
        : `พร้อมให้พนักงานดำเนินการ · ${amount} บาท${branch ? ` · ${branch}` : ""}`,
    };
  }

  return {
    title: english ? `New order #${shortId}` : `มีออเดอร์ใหม่ #${shortId}`,
    message: english
      ? `${order.channel} · ${amount} THB${branch ? ` · ${branch}` : ""}`
      : `${order.channel} · ${amount} บาท${branch ? ` · ${branch}` : ""}`,
  };
}

async function deliverOrderActionNotification(input: OrderActionInput): Promise<void> {
  try {
    const orderResult = await query<OrderAlertRow>(
      `SELECT o.id, o.channel, o.status,
              (o.total_amount + o.shipping_fee + COALESCE(o.rounding_amount, 0)) AS amount_due,
              o.location_id, loc.name AS location_name, loc.branch_code, o.fulfillment_type
         FROM bms_orders o
         LEFT JOIN bms_locations loc
           ON loc.tenant_id = o.tenant_id AND loc.id = o.location_id
        WHERE o.tenant_id = $1 AND o.id = $2`,
      [input.tenantId, input.orderId]
    );
    const order = orderResult.rows[0];
    if (!order) return;

    // A counter sale is already visible to the cashier who is completing it. Dine-in
    // kitchen work is announced separately when tickets are actually committed.
    if (order.channel === "pos" && input.kind !== "KITCHEN_TICKETS_CREATED") return;

    const permissions = REQUIRED_PERMISSIONS[input.kind];
    const recipients = await query<Recipient>(
      `SELECT u.id, u.language
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1
          AND COALESCE(u.pos_only, FALSE) = FALSE
          AND ($4::uuid IS NULL OR u.id <> $4)
          AND (
            r.name = 'Administrator'
            OR NOT EXISTS (
              SELECT 1
                FROM unnest($3::text[]) required(permission)
               WHERE NOT EXISTS (
                 SELECT 1 FROM bms_role_permissions rp
                  WHERE rp.tenant_id = $1
                    AND rp.role_id = u.role_id
                    AND rp.permission = required.permission
               )
            )
          )
          AND (
            NOT EXISTS (
              SELECT 1 FROM bms_user_allowed_locations al
               WHERE al.tenant_id = $1 AND al.user_id = u.id
            )
            OR EXISTS (
              SELECT 1 FROM bms_user_allowed_locations al
               WHERE al.tenant_id = $1 AND al.user_id = u.id AND al.location_id = $2
            )
          )`,
      [input.tenantId, order.location_id, permissions, input.excludeUserId ?? null]
    );

    await Promise.all(recipients.rows.map(async (recipient) => {
      const copy = textFor(input.kind, order, recipient.language);
      try {
        await createNotification({
          user_id: recipient.id,
          type: "BMS_ORDER_ACTION",
          title: copy.title,
          message: copy.message,
          entity_type: "bms_order_action",
          entity_id: order.id,
          data: {
            kind: input.kind,
            orderId: order.id,
            status: order.status,
            locationId: order.location_id,
            fulfillmentType: order.fulfillment_type,
            href: input.kind === "KITCHEN_TICKETS_CREATED" ? "/admin/kitchen" : "/admin/orders",
          },
        });
      } catch (error) {
        console.error("[BMS] staff order notification failed:", error);
      }
    }));
  } catch (error) {
    console.error("[BMS] staff order notification lookup failed:", error);
  }
}

/**
 * Announce a committed order transition to staff who can act on that branch.
 * A stuck Redis publication must not make checkout/order creation wait forever.
 */
export async function notifyOrderActionCommitted(input: OrderActionInput): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      deliverOrderActionNotification(input),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          console.error("[BMS] staff order notification timed out");
          resolve();
        }, 2_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
