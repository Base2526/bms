import { query } from "@/lib/db";
import {
  getCustomerCheckoutStatus,
  saveCustomerCheckoutDetails,
  type CustomerCheckoutMissingField,
  type SaveCustomerCheckoutDetailsInput,
} from "./customers";
import { generateInvoice } from "./documents";
import { recalculateOrderShipping } from "./orders";
import {
  configuredPaymentAccounts,
  supportsCustomerPaymentMethod,
} from "./paymentConfiguration";
import {
  submitPaymentOnce,
  type PaymentMethod,
  type SubmitPaymentOnceResult,
} from "./payments";
import { getStoreProfile, type PaymentAccount } from "./storeProfile";
import {
  createCheckoutToken,
  verifyCheckoutToken,
  type CheckoutTokenPayload,
} from "./checkoutToken";

const MARKETPLACE_CHANNELS = new Set(["lazada", "shopee"]);

export type CheckoutPaymentAccount = {
  key: string;
  method: "BANK_TRANSFER" | "QR";
  type: "BANK" | "PROMPTPAY";
  title: string;
  bankName: string | null;
  accountName: string | null;
  accountNo: string | null;
  promptpayId: string | null;
  note: string | null;
};

export type CheckoutView = {
  store: {
    name: string;
    logoUrl: string | null;
    currency: string;
  };
  order: {
    id: string;
    displayId: string;
    status: string;
    subtotal: number;
    discount: number;
    /** ค่าส่งที่คิดจริงกับออร์เดอร์นี้ (7.47) */
    shippingFee: number;
    /** ยอดที่ต้องโอน = ค่าสินค้า − ส่วนลด + ค่าส่ง */
    total: number;
    couponCode: string | null;
    createdAt: string;
    channel: string;
    items: Array<{
      sku: string;
      name: string;
      size: string;
      qty: number;
      unitPrice: number;
      amount: number;
      imageUrl: string | null;
    }>;
  };
  delivery: {
    marketplaceManaged: boolean;
    recipientName: string | null;
    phone: string | null;
    selectedAddress: {
      id: string;
      label: string | null;
      address: string;
      isDefault: boolean;
    } | null;
    addresses: Array<{
      id: string;
      label: string | null;
      address: string;
      isDefault: boolean;
    }>;
    missingFields: CustomerCheckoutMissingField[];
    complete: boolean;
  };
  payment: {
    configured: boolean;
    accounts: CheckoutPaymentAccount[];
    latest: {
      id: string;
      method: PaymentMethod;
      amount: number;
      status: string;
      slipUrl: string | null;
      slipRef: string | null;
      createdAt: string;
    } | null;
  };
  fulfillment: {
    shipmentStatus: string | null;
    carrier: string | null;
    trackingNo: string | null;
  };
};

export type CheckoutResult =
  | { ok: true; payload: CheckoutTokenPayload; checkout: CheckoutView }
  | { ok: false; reason: string };

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function publicPaymentAccounts(
  accounts: PaymentAccount[]
): CheckoutPaymentAccount[] {
  const result: CheckoutPaymentAccount[] = [];
  configuredPaymentAccounts(accounts).forEach((account, index) => {
    const type = String(account.type || "").trim().toUpperCase();
    if (type === "BANK" && clean(account.accountNo)) {
      result.push({
        key: `bank-${index}`,
        method: "BANK_TRANSFER",
        type: "BANK",
        title: clean(account.bankName) || "โอนเข้าบัญชีธนาคาร",
        bankName: clean(account.bankName),
        accountName: clean(account.accountName),
        accountNo: clean(account.accountNo),
        promptpayId: null,
        note: clean(account.note),
      });
    } else if (
      (type === "PROMPTPAY" || type === "QR") &&
      clean(account.promptpayId)
    ) {
      result.push({
        key: `promptpay-${index}`,
        method: "QR",
        type: "PROMPTPAY",
        title: "พร้อมเพย์",
        bankName: null,
        accountName: clean(account.accountName),
        accountNo: null,
        promptpayId: clean(account.promptpayId),
        note: clean(account.note),
      });
    }
  });
  return result;
}

export function createCheckoutUrl(tenantId: string, orderId: string): string {
  const token = createCheckoutToken({ tenantId, orderId });
  const base = (
    process.env.NEXT_PUBLIC_BASE_URL || "https://bms.jachoei.com"
  ).replace(/\/$/, "");
  return `${base}/checkout?t=${encodeURIComponent(token)}`;
}

export async function getCheckoutByToken(
  token: string
): Promise<CheckoutResult> {
  const payload = verifyCheckoutToken(token);
  if (!payload) {
    return { ok: false, reason: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว" };
  }

  const orderResult = await query<{
    id: string;
    channel: string;
    customer_ref: string | null;
    customer_id: string | null;
    status: string;
    created_at: Date | string;
    customer_name: string | null;
    customer_phone: string | null;
  }>(
    `SELECT o.id, o.channel, o.customer_ref, o.customer_id, o.status, o.created_at,
            c.name AS customer_name, c.phone AS customer_phone
       FROM bms_orders o
       LEFT JOIN bms_customers c
         ON c.tenant_id = o.tenant_id
        AND c.id = o.customer_id
        AND c.deleted_at IS NULL
      WHERE o.tenant_id = $1 AND o.id = $2
      LIMIT 1`,
    [payload.tenantId, payload.orderId]
  );
  const order = orderResult.rows[0];
  if (!order) return { ok: false, reason: "ไม่พบออร์เดอร์นี้" };

  const [
    invoice,
    profile,
    addressesResult,
    paymentResult,
    shipmentResult,
  ] = await Promise.all([
    generateInvoice(payload.tenantId, payload.orderId),
    getStoreProfile(payload.tenantId),
    order.customer_id
      ? query<{
          id: string;
          label: string | null;
          address: string;
          is_default: boolean;
        }>(
          `SELECT id::text, label, address, is_default
             FROM bms_customer_addresses
            WHERE tenant_id = $1
              AND customer_id = $2
              AND address_type = 'shipping'
            ORDER BY is_default DESC, id`,
          [payload.tenantId, order.customer_id]
        )
      : Promise.resolve({ rows: [] } as {
          rows: Array<{
            id: string;
            label: string | null;
            address: string;
            is_default: boolean;
          }>;
        }),
    query<{
      id: string;
      method: PaymentMethod;
      amount: string;
      status: string;
      slip_url: string | null;
      slip_ref: string | null;
      created_at: Date | string;
    }>(
      `SELECT id, method, amount, status, slip_url, slip_ref, created_at
         FROM bms_payments
        WHERE tenant_id = $1 AND order_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [payload.tenantId, payload.orderId]
    ),
    query<{
      status: string;
      carrier: string;
      tracking_no: string | null;
    }>(
      `SELECT status, carrier, tracking_no
         FROM bms_shipments
        WHERE tenant_id = $1 AND order_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [payload.tenantId, payload.orderId]
    ),
  ]);
  if (!invoice) return { ok: false, reason: "ไม่พบรายละเอียดออร์เดอร์นี้" };

  const marketplaceManaged = MARKETPLACE_CHANNELS.has(order.channel);
  const checkoutStatus =
    order.customer_ref && !marketplaceManaged
      ? await getCustomerCheckoutStatus(
          payload.tenantId,
          order.channel,
          order.customer_ref
        )
      : null;
  const addresses = addressesResult.rows.map((address) => ({
    id: String(address.id),
    label: clean(address.label),
    address: address.address,
    isDefault: address.is_default,
  }));
  const selectedAddress = addresses[0] ?? null;
  const accounts = publicPaymentAccounts(profile.paymentAccounts);
  const latest = paymentResult.rows[0];

  return {
    ok: true,
    payload,
    checkout: {
      store: {
        name: invoice.store.name || "ร้านค้า",
        logoUrl: profile.logoUrl,
        currency: profile.currency || "THB",
      },
      order: {
        id: order.id,
        displayId: invoice.number,
        status: order.status,
        subtotal: invoice.subtotal,
        discount: invoice.discount,
        // generateInvoice() คิด shippingFee/total (รวมค่าส่ง) มาให้แล้ว — อย่าคำนวณซ้ำที่นี่
        shippingFee: invoice.shippingFee ?? 0,
        total: invoice.total,
        couponCode: invoice.couponCode,
        createdAt: new Date(order.created_at).toISOString(),
        channel: order.channel,
        items: invoice.lines.map((line) => ({
          ...line,
          imageUrl: null,
        })),
      },
      delivery: {
        marketplaceManaged,
        recipientName:
          checkoutStatus?.hasRecipientName === true
            ? clean(order.customer_name)
            : null,
        phone:
          checkoutStatus?.hasPhone === true ? clean(order.customer_phone) : null,
        selectedAddress,
        addresses,
        missingFields: marketplaceManaged
          ? []
          : checkoutStatus?.missingFields ?? [
              "recipientName",
              "phone",
              "shippingAddress",
            ],
        complete:
          marketplaceManaged || checkoutStatus?.missingFields.length === 0,
      },
      payment: {
        configured: accounts.length > 0,
        accounts,
        latest: latest
          ? {
              id: latest.id,
              method: latest.method,
              amount: Number(latest.amount),
              status: latest.status,
              slipUrl: latest.slip_url,
              slipRef: latest.slip_ref,
              createdAt: new Date(latest.created_at).toISOString(),
            }
          : null,
      },
      fulfillment: {
        shipmentStatus: shipmentResult.rows[0]?.status ?? null,
        carrier: shipmentResult.rows[0]?.carrier ?? null,
        trackingNo: shipmentResult.rows[0]?.tracking_no ?? null,
      },
    },
  };
}

export async function saveCheckoutDeliveryByToken(
  token: string,
  input: SaveCustomerCheckoutDetailsInput
): Promise<CheckoutResult> {
  const payload = verifyCheckoutToken(token);
  if (!payload) {
    return { ok: false, reason: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว" };
  }
  const orderResult = await query<{
    channel: string;
    customer_ref: string | null;
    status: string;
  }>(
    `SELECT channel, customer_ref, status
       FROM bms_orders
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [payload.tenantId, payload.orderId]
  );
  const order = orderResult.rows[0];
  if (!order) return { ok: false, reason: "ไม่พบออร์เดอร์นี้" };
  if (MARKETPLACE_CHANNELS.has(order.channel)) {
    return {
      ok: false,
      reason: "ออร์เดอร์นี้ใช้ข้อมูลจัดส่งจาก Seller Center",
    };
  }
  if (!["PENDING", "PAID", "PACKING"].includes(order.status)) {
    return { ok: false, reason: "ออร์เดอร์นี้ไม่สามารถแก้ข้อมูลจัดส่งได้แล้ว" };
  }
  if (!order.customer_ref) {
    return { ok: false, reason: "ออร์เดอร์นี้ไม่มีตัวตนลูกค้าที่แก้ไขได้" };
  }

  const { customerId } = await saveCustomerCheckoutDetails(
    payload.tenantId,
    order.channel,
    order.customer_ref,
    input
  );
  // ที่อยู่เพิ่งมาถึง/เปลี่ยน → คิดค่าส่งใหม่ก่อนลูกค้าจ่าย ไม่งั้นยอดที่โชว์จะเป็นค่าส่งเดิม
  // (เฉพาะออร์เดอร์ PENDING ที่ยังไม่มี payment — ดู recalculateOrderShipping)
  if (customerId) await recalculateOrderShipping(payload.tenantId, customerId);
  return getCheckoutByToken(token);
}

export async function submitCheckoutPaymentByToken(
  token: string,
  input: {
    method: PaymentMethod;
    slipUrl: string;
    slipRef?: string | null;
  }
): Promise<
  | { ok: true; result: SubmitPaymentOnceResult; checkout: CheckoutView }
  | { ok: false; reason: string }
> {
  const current = await getCheckoutByToken(token);
  if (!current.ok) return current;
  const { payload, checkout } = current;
  if (checkout.delivery.marketplaceManaged) {
    return {
      ok: false,
      reason: "ออร์เดอร์นี้ชำระเงินผ่าน Seller Center",
    };
  }
  if (!checkout.delivery.complete) {
    return { ok: false, reason: "กรุณากรอกข้อมูลจัดส่งที่ยังขาดก่อน" };
  }
  if (checkout.order.status !== "PENDING") {
    return { ok: false, reason: "ออร์เดอร์นี้ไม่อยู่ในสถานะรอชำระเงิน" };
  }

  const profile = await getStoreProfile(payload.tenantId);
  if (
    !["BANK_TRANSFER", "QR"].includes(input.method) ||
    !supportsCustomerPaymentMethod(profile.paymentAccounts, input.method)
  ) {
    return {
      ok: false,
      reason: "ช่องทางชำระเงินนี้ไม่ได้ถูกตั้งค่าไว้สำหรับร้าน",
    };
  }

  const result = await submitPaymentOnce({
    tenantId: payload.tenantId,
    orderId: payload.orderId,
    method: input.method,
    amount: null,
    slipUrl: input.slipUrl,
    slipRef: clean(input.slipRef),
    note: "แจ้งชำระผ่าน public checkout",
    actor: "customer:checkout",
  });
  if (
    result.status === "ORDER_NOT_FOUND" ||
    result.status === "BAD_METHOD"
  ) {
    return { ok: false, reason: "บันทึกการแจ้งชำระไม่สำเร็จ" };
  }
  const refreshed = await getCheckoutByToken(token);
  if (!refreshed.ok) return refreshed;
  return { ok: true, result, checkout: refreshed.checkout };
}

function missingFieldLabel(field: CustomerCheckoutMissingField): string {
  if (field === "recipientName") return "ชื่อผู้รับ";
  if (field === "phone") return "เบอร์โทรศัพท์";
  return "ที่อยู่จัดส่ง";
}

export async function orderCheckoutChatReply(
  tenantId: string,
  orderId: string,
  fallback: string
): Promise<string> {
  try {
    const token = createCheckoutToken({ tenantId, orderId });
    const result = await getCheckoutByToken(token);
    if (!result.ok) return fallback;
    const checkout = result.checkout;
    const itemLines = checkout.order.items
      .map(
        (item) =>
          `• ${item.name} ไซซ์ ${item.size} × ${item.qty}`
      )
      .join("\n");
    // แยกค่าส่งให้เห็นเสมอเมื่อมีการคิดค่าส่ง — ยอด total รวมค่าส่งอยู่แล้ว (7.47)
    // ถ้าไม่แยก ลูกค้าจะเห็นยอดสูงกว่าราคาสินค้าที่คุยกันไว้แล้วสงสัย
    const amountLines =
      checkout.order.shippingFee > 0
        ? [
            `ค่าสินค้า ${(checkout.order.total - checkout.order.shippingFee).toLocaleString("th-TH")} บาท`,
            `ค่าส่ง ${checkout.order.shippingFee.toLocaleString("th-TH")} บาท`,
            `รวมที่ต้องชำระ ${checkout.order.total.toLocaleString("th-TH")} บาท`,
          ].join("\n")
        : `รวม ${checkout.order.total.toLocaleString("th-TH")} บาท`;

    const parts = [
      "รับออร์เดอร์แล้วค่ะ ✅",
      itemLines,
      amountLines,
      `เลขออร์เดอร์: ${checkout.order.displayId}`,
    ];

    if (checkout.delivery.marketplaceManaged) {
      parts.push(
        "ข้อมูลผู้รับ ที่อยู่ และการชำระเงินจะใช้จาก Seller Center จึงไม่ต้องกรอกซ้ำค่ะ"
      );
      return parts.join("\n");
    }
    if (checkout.delivery.complete) {
      parts.push(
        "พบข้อมูลผู้รับ เบอร์โทร และที่อยู่จัดส่งเดิมแล้ว ระบบจะใช้ข้อมูลเดิมให้อัตโนมัติค่ะ"
      );
    } else {
      parts.push(
        `ยังขาด ${checkout.delivery.missingFields
          .map(missingFieldLabel)
          .join(" และ ")} — ในลิงก์จะแสดงให้กรอกเฉพาะข้อมูลที่ขาดค่ะ`
      );
    }

    const url = createCheckoutUrl(tenantId, orderId);
    parts.push(
      checkout.payment.configured
        ? `ตรวจสอบข้อมูลและแจ้งชำระเงินได้ที่นี่ค่ะ:\n${url}`
        : `ตรวจสอบออร์เดอร์และข้อมูลจัดส่งได้ที่นี่ค่ะ:\n${url}`
    );
    if (!checkout.payment.configured) {
      parts.push(
        "ตอนนี้ร้านยังไม่ได้ระบุช่องทางชำระเงินไว้ ระบบจึงยังไม่แนะนำวิธีชำระเงินค่ะ"
      );
    }
    return parts.join("\n\n");
  } catch (error) {
    console.error("[BMS] checkout chat reply failed:", error);
    return fallback;
  }
}
