// =============================================================
// BMS Orders — สร้าง order + reserve สต็อกแบบ atomic
// -------------------------------------------------------------
// ทุกอย่างอยู่ในทรานแซกชันเดียว (getClient + BEGIN/COMMIT):
//   1) reserve สต็อกทุกรายการ (guard กัน oversell)
//   2) insert order + order_items (snapshot ราคา)
// ถ้ารายการใดของไม่พอ / ไม่พบ → ROLLBACK ทั้งออร์เดอร์
//
// จองแบบเรียงลำดับ (sku,size) เพื่อกัน deadlock ตอนสั่งพร้อมกัน
// =============================================================

import { getClient, query } from "@/lib/db";
import type { Channel } from "./pipeline";
import { recordOrderMovements } from "./movements";
import { resolveOrCreateCustomer } from "./customers";
import { beginTenantTx } from "./tenant";
import { resolveDefaultLocationIdInTx } from "./locations";
import { listConversationHelpers, listSystemEvents } from "./inbox";
import { listShipments, MARKETPLACE_CHANNELS } from "./shipping";
import { isCarrier, type Carrier } from "./carriers/constants";
import { quoteShipping, type ShippingFeeSource } from "./shippingRates";
import type { PoolClient } from "pg";
import { notifyOrderStatusEmail } from "./orderNotify";
import { applyCouponInTx, releaseCouponForOrdersInTx, redeemCustomerCouponForOrderInTx, releaseCustomerCouponReservationsInTx, reserveCustomerCouponInTx } from "./coupons";
import {
  composeDiscounts,
  earnPointsForOrderInTx,
  getLoyaltySettings,
  getMemberForOrderInTx,
  recordOrderDiscountsInTx,
  redeemPointsInTx,
  releasePointsForOrdersInTx,
  reviewMemberTierForOrder,
  type OrderDiscountLine,
} from "./membership";
import {
  applyPromotion,
  canonicalPriceTiers,
  isFixedPricePack,
  normalizePackCode,
  unitPriceForQty,
  type PriceTier,
  type Promotion,
} from "./pricing";
import { getVariantBasePriceInTx } from "./productPacks";
import type { VatCategory } from "./vat";
import { reverseCreditForOrderInTx } from "./storeCredit";
import {
  markRestockSubscriptionsOrdered,
  markRestockSubscriptionsPurchasedForOrder,
  reopenRestockSubscriptionsForOrders,
  markRestockSubscriptionsReadyForOrders,
} from "./restockSubscriptions";
import {
  closeAssessmentSupersededByCounterInTx,
  markAssessmentOrderCreatedInTx,
} from "./pharmacy/assessments";
import {
  checkPharmacySaleInTx,
  type PharmacySaleBlockStatus,
  type PharmacySalePolicy,
} from "./pharmacy/productPolicy";
import type { PharmacySaleBlocker } from "./pharmacy/productPolicyDecision";
import {
  normalizeCustomerIdentity,
  reorderTargetIdentity,
  type CustomerChannelIdentity,
} from "./customerIdentity";
import { validateOrderItems } from "./orderValidation";
export { validateOrderItems } from "./orderValidation";

/**
 * qty คือ "หน่วยฐาน" เสมอ (สต็อกนับเป็นหน่วยฐาน) — ถ้าลูกค้าซื้อเป็นกล่อง
 * ผู้เรียกต้องคูณ base_qty มาแล้ว แล้วส่ง pack* มาเพื่อให้ใบเสร็จพิมพ์ว่า
 * "1 กล่อง @230" แทน "10 แผง @23" (7.86)
 */
export type OrderItemInput = {
  sku: string;
  size: string;
  qty: number;
  packCode?: string | null;
  packUnitName?: string | null;
  packQty?: number | null;
  packUnitPrice?: number | null;
};

export type CreateOrderInput = {
  tenantId: string;
  channel: Channel;
  customerRef?: string | null;
  /**
   * ผูกบิลกับลูกค้าที่รู้ตัวตนแล้วโดยตรง (POS ค้นสมาชิกที่เคาน์เตอร์ — 7.96)
   * ถ้าส่งมา จะข้าม resolveOrCreateCustomer ที่หาจาก channel+customerRef
   * id ถูกตรวจว่าเป็นลูกค้าของร้านนี้ในทรานแซกชันก่อนใช้เสมอ
   */
  customerId?: string | null;
  /** แลกแต้มเป็นส่วนลดบิลนี้ — ต้องมี customerId ที่เป็นสมาชิกด้วย (7.96) */
  pointsToRedeem?: number | null;
  items: OrderItemInput[];
  editorId?: string | number | null;
  couponCode?: string | null;
  /**
   * Carrier the customer asked for. A *preference* only — the carrier actually used is
   * bms_shipments.carrier, confirmed by staff at packing time. Unknown codes are stored
   * as null rather than failing the order (7.46).
   */
  preferredCarrier?: string | null;
  /** Server-derived only. A customer/model must never supply this id. */
  pharmacyApprovedAssessmentId?: string | null;
  /**
   * เภสัชกรที่กด PIN อนุมัติจ่ายยาที่เครื่องขาย (9.29) — POS เท่านั้น
   *
   * PIN ถูกตรวจที่ route แล้ว (รูปแบบเดียวกับผู้อนุมัติส่วนลด) ที่นี่ยังตรวจใบอนุญาต
   * ซ้ำในทรานแซกชันเดียวกับที่ขยับสต็อก และเขียนหลักฐานลง
   * `bms_pos_pharmacist_authorizations` ในทรานแซกชันเดียวกันนั้น
   * · ห้ามรับ id นี้จาก client โดยไม่ตรวจ PIN
   */
  pharmacistCounterAuthorization?: { pharmacistUserId: string; note?: string | null } | null;
  /**
   * เคสในคิวเภสัชกรที่ถูก **แทนที่** ด้วยการอนุมัติที่เคาน์เตอร์ของบิลใบนี้ (9.29)
   *
   * ปิดในทรานแซกชันเดียวกับบิล ไม่ใช่ยิงทีหลัง — เคสที่ค้างแล้วมีคนไปกดอนุมัติภายหลัง
   * จะกลายเป็นใบอนุมัติที่ยังใช้ขายตะกร้าเดิมได้อีกใบ ทั้งที่ของออกจากร้านไปแล้ว
   * · id มาจากหน้าจอได้ แต่ `closeAssessmentSupersededByCounterInTx()` ตรวจว่าเป็นเคส
   *   ของเครื่อง/กะนี้และเป็นเรื่องของตะกร้าใบนี้จริงก่อนแตะแถว
   */
  pharmacySupersededAssessmentId?: string | null;
  /** สาขาที่ตัดสต็อก — ไม่ระบุ = สาขาเริ่มต้นของร้าน (7.84) */
  locationId?: string | null;
  /** POS เท่านั้น — เครื่อง/กะ/คนขาย และคีย์กันบิลซ้ำ (7.87) */
  posDeviceId?: string | null;
  posShiftId?: string | null;
  cashierUserId?: string | null;
  idempotencyKey?: string | null;
  /**
   * ส่วนลดมือเป็นบาท (ชั้นที่ 4 ต่อจาก tier → คูปอง → แต้ม)
   * > 0 ต้องมี discountApprovedBy + discountReason เสมอ — ผู้เรียกเป็นคนตรวจ
   * ว่าคนอนุมัติมีสิทธิ์จริง ที่นี่แค่ปฏิเสธบิลที่ไม่มีหลักฐานอนุมัติติดมา
   */
  /**
   * รายการเก็บเงินที่ไม่ใช่สินค้าในคลัง (8.6) — ค่าถุง ค่าบริการ ค่าห่อของขวัญ
   * อยู่ในฐาน VAT เหมือนบรรทัดสินค้า ไม่ใช่ยอดบวกท้ายบิล
   */
  extraLines?: Array<{ label: string; qty?: number; unitAmount: number; vatCategory?: VatCategory | null }> | null;
  manualDiscount?: number | null;
  /** ส่วนลดหน้าร้านต้องมีหัวหน้าอนุมัติ */
  discountApprovedBy?: string | null;
  discountReason?: string | null;
};

export type CreatedLine = {
  sku: string;
  name: string;
  size: string;
  qty: number;
  unitPrice: number;
  /** ราคาที่พิมพ์บนใบเสร็จก่อนราคาส่ง/โปรโมชัน (snapshot ไม่อ่านราคาสินค้าปัจจุบัน) */
  receiptUnitPrice: number;
  /** กติกาคิดราคาตามจำนวน/โปร ณ ตอนขาย สำหรับประเมินยอดคงเหลือหลังคืน */
  pricingSnapshot: { source: "SALE"; priceTiers: PriceTier[]; promotion: Promotion | null };
  availableAfter: number;
  packCode?: string | null;
  packUnitName?: string | null;
  packQty?: number | null;
  packUnitPrice?: number | null;
  /** snapshot ประเภท VAT ตอนขาย — สินค้าเปลี่ยนประเภททีหลังไม่กระทบใบที่ออกไปแล้ว */
  vatCategory?: string | null;
};

export type CreateOrderResult =
  | {
      status: "CREATED";
      orderId: string;
      /** ค่าสินค้า − ส่วนลด (ตรงกับ bms_orders.total_amount — ความหมายไม่เปลี่ยนตั้งแต่ก่อน 7.47) */
      total: number;
      subtotal: number;
      discount: number;
      shippingFee: number;
      /** ยอดที่ลูกค้าต้องจ่ายจริง = total + shippingFee */
      amountDue: number;
      couponCode: string | null;
      preferredCarrier: Carrier | null;
      items: CreatedLine[];
      /** ส่วนลดแยกตามที่มา (7.96) — ผลรวม = discount ด้านบนเสมอ */
      discountLines: OrderDiscountLine[];
      /** แต้มที่ถูกหักไปกับบิลนี้ (0 = ไม่ได้แลก) */
      pointsUsed: number;
    }
  | { status: "INSUFFICIENT"; sku: string; size: string; available: number; requested: number }
  | { status: "NOT_FOUND"; sku: string; size: string }
  | { status: "PACK_NOT_FOUND"; sku: string; size: string; packCode: string }
  | { status: "COUPON_INVALID"; reason: string }
  | { status: "POINTS_INVALID"; reason: string }
  | { status: "DISCOUNT_UNAPPROVED"; reason: string }
  | { status: "INVALID_ITEM"; index: number; reason: string }
  /** สินค้าชุดที่ยังไม่ได้ใส่ส่วนประกอบ — ขายไปคือของไม่ออกจากคลัง (8.8) */
  | { status: "BUNDLE_INCOMPLETE"; sku: string }
  | {
      status: PharmacySaleBlockStatus;
      sku: string;
      salePolicy: PharmacySalePolicy | "UNKNOWN";
      maxQuantity?: number;
      requested?: number;
      /** Every blocked SKU in basket order; top-level fields remain the first blocker. */
      blockers?: PharmacySaleBlocker[];
    }
  | { status: "EMPTY" };

/**
 * รวมรายการซ้ำเฉพาะ sku+size+หน่วยขายเดียวกัน แล้วบวก qty
 * กล่องกับชิ้นของ SKU/size เดียวกันต้องอยู่คนละบรรทัด มิฉะนั้นราคาต่อ pack
 * จะหายและยอดบิลถูกคำนวณใหม่เป็นราคาหน่วยฐานทั้งหมด
 */
function mergeItems(items: OrderItemInput[]): OrderItemInput[] {
  const map = new Map<string, OrderItemInput>();
  for (const it of items) {
    // DB ใช้ selling unit ที่ normalize แล้วเป็นส่วนหนึ่งของ unique key ด้วย
    // จึงต้องรวม BASE/null และ pack code ต่าง case ตั้งแต่ก่อน reserve/insert
    const key = `${it.sku}__${it.size}__${normalizePackCode(it.packCode)}`;
    const cur = map.get(key);
    if (cur) {
      cur.qty += it.qty;
      if (cur.packQty != null && it.packQty != null) {
        cur.packQty += it.packQty;
      }
    } else {
      map.set(key, {
        sku: it.sku,
        size: it.size,
        qty: it.qty,
        packCode: it.packCode ?? null,
        packUnitName: it.packUnitName ?? null,
        packQty: it.packQty ?? null,
        packUnitPrice: it.packUnitPrice ?? null,
      });
    }
  }
  // เรียง deterministic เพื่อกัน deadlock
  return [...map.values()].sort((a, b) =>
    a.sku === b.sku ? a.size.localeCompare(b.size) : a.sku.localeCompare(b.sku)
  );
}

async function revalidateOrderPacksInTx(
  client: PoolClient,
  tenantId: string,
  items: OrderItemInput[]
): Promise<{ ok: true; items: OrderItemInput[] } | { ok: false; sku: string; size: string; packCode: string }> {
  const canonical: OrderItemInput[] = [];
  for (const item of items) {
    const packCode = String(item.packCode ?? "").trim();
    if (!isFixedPricePack(packCode)) {
      // BASE คือหน่วยฐาน ไม่ใช่ pack ราคาคงที่ แม้ caller รุ่นเก่าหรือ adapter
      // ที่ผิดพลาดจะแนบ packUnitPrice มา ห้ามปล่อยให้ค่านั้นข้ามราคาส่ง/โปรโมชัน
      // ของ service กลางได้ ส่วน packQty ยังเก็บไว้เพื่อรูปแบบใบเสร็จ POS เดิม
      canonical.push({ ...item, packUnitPrice: null });
      continue;
    }
    const result = await client.query<{
      pack_code: string;
      unit_name: string;
      base_qty: number;
      price: string | null;
      base_price: string;
    }>(
      `SELECT k.pack_code, k.unit_name, k.base_qty, k.price, p.price AS base_price
         FROM bms_product_packs k
         JOIN bms_products p ON p.tenant_id = k.tenant_id AND p.sku = k.product_sku AND p.active
        WHERE k.tenant_id = $1
          AND k.product_sku = $2
          AND upper(k.pack_code) = upper($3)
          AND k.active
          AND (k.size IS NULL OR k.size = $4)
        ORDER BY k.size NULLS LAST
        LIMIT 1`,
      [tenantId, item.sku, packCode, item.size]
    );
    const pack = result.rows[0];
    if (!pack) return { ok: false, sku: item.sku, size: item.size, packCode };
    const baseQty = Number(pack.base_qty);
    const packQty = item.packQty ?? (item.qty % baseQty === 0 ? item.qty / baseQty : null);
    if (!Number.isInteger(packQty) || Number(packQty) < 1) {
      return { ok: false, sku: item.sku, size: item.size, packCode };
    }
    canonical.push({
      ...item,
      qty: Number(packQty) * baseQty,
      packCode: pack.pack_code,
      packUnitName: pack.unit_name,
      packQty: Number(packQty),
      packUnitPrice: pack.price == null
        ? (await getVariantBasePriceInTx(client, tenantId, item.sku, item.size) ?? Number(pack.base_price)) * baseQty
        : Number(pack.price),
    });
  }
  return { ok: true, items: canonical };
}

/**
 * คิดค่าส่งของออร์เดอร์จากที่อยู่ default ของลูกค้า (ใช้ client เดิมในทรานแซกชัน)
 * ไม่มีที่อยู่ / ร้านยังไม่ตั้งค่าส่ง → 0 พร้อม source บอกเหตุผล (ไม่ throw —
 * ค่าส่งต้องไม่ทำให้การสร้างออร์เดอร์ล้ม)
 */
async function computeOrderShippingFeeInTx(
  client: PoolClient,
  args: {
    tenantId: string;
    customerId: string | null;
    subtotal: number;
    items: OrderItemInput[];
    carrier: Carrier | null;
  }
): Promise<{ fee: number; source: ShippingFeeSource }> {
  try {
    let province: string | null = null;
    let addressText: string | null = null;
    if (args.customerId) {
      const addr = await client.query<{ province: string | null; address: string }>(
        `SELECT province, address
           FROM bms_customer_addresses
          WHERE tenant_id = $1 AND customer_id = $2 AND address_type = 'shipping'
          ORDER BY is_default DESC, id
          LIMIT 1`,
        [args.tenantId, args.customerId]
      );
      province = addr.rows[0]?.province ?? null;
      addressText = addr.rows[0]?.address ?? null;
    }

    const quote = await quoteShipping({
      tenantId: args.tenantId,
      subtotal: args.subtotal,
      province,
      addressText,
      items: args.items.map((it) => ({ sku: it.sku, qty: it.qty })),
      carrier: args.carrier,
    });
    return { fee: quote.fee ?? 0, source: quote.source };
  } catch {
    // ค่าส่งคิดไม่ได้ต้องไม่ทำให้ออร์เดอร์/สต็อกที่จองไว้ล้มทั้งก้อน
    return { fee: 0, source: "none" };
  }
}

/**
 * คิดค่าส่งใหม่หลังที่อยู่จัดส่งมาถึง (เรียกจาก saveCustomerCheckoutDetails)
 * แตะเฉพาะออร์เดอร์ PENDING ที่ยังไม่มี payment PENDING/CONFIRMED — ห้ามขยับยอด
 * ของออร์เดอร์ที่ลูกค้าโอนเงินตามยอดเดิมไปแล้ว
 */
export async function recalculateOrderShipping(
  tenantId: string,
  customerId: string
): Promise<{ updated: number }> {
  const open = await query<{ id: string; total_amount: string; preferred_carrier: string | null }>(
    `SELECT o.id, o.total_amount, o.preferred_carrier
       FROM bms_orders o
      WHERE o.tenant_id = $1 AND o.customer_id = $2 AND o.status = 'PENDING'
        AND NOT EXISTS (
          SELECT 1 FROM bms_payments p
           WHERE p.tenant_id = o.tenant_id AND p.order_id = o.id
             AND p.status IN ('PENDING','CONFIRMED')
        )`,
    [tenantId, customerId]
  );
  if (open.rowCount === 0) return { updated: 0 };

  let updated = 0;
  for (const row of open.rows) {
    const itemsRes = await query<{ product_sku: string; qty: number }>(
      `SELECT product_sku, qty FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2`,
      [tenantId, row.id]
    );
    const addr = await query<{ province: string | null; address: string }>(
      `SELECT province, address FROM bms_customer_addresses
        WHERE tenant_id = $1 AND customer_id = $2 AND address_type = 'shipping'
        ORDER BY is_default DESC, id LIMIT 1`,
      [tenantId, customerId]
    );

    const quote = await quoteShipping({
      tenantId,
      subtotal: Number(row.total_amount),
      province: addr.rows[0]?.province ?? null,
      addressText: addr.rows[0]?.address ?? null,
      items: itemsRes.rows.map((r) => ({ sku: r.product_sku, qty: Number(r.qty) })),
      carrier: row.preferred_carrier,
    });

    const res = await query(
      `UPDATE bms_orders SET shipping_fee = $3, shipping_fee_source = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
          AND (shipping_fee IS DISTINCT FROM $3::numeric OR shipping_fee_source IS DISTINCT FROM $4)`,
      [tenantId, row.id, quote.fee ?? 0, quote.source]
    );
    updated += res.rowCount ?? 0;
  }
  return { updated };
}

export async function createOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  const tenantId = input.tenantId;
  const validation = validateOrderItems(input.items);
  if (!validation.ok) {
    if (validation.index === -1) return { status: "EMPTY" };
    return { status: "INVALID_ITEM", index: validation.index, reason: validation.reason };
  }
  let items = mergeItems(input.items);
  const mergedValidation = validateOrderItems(items);
  if (!mergedValidation.ok) {
    return {
      status: "INVALID_ITEM",
      index: mergedValidation.index,
      reason: "จำนวนรวมของรายการซ้ำมากเกินกว่าที่ระบบบันทึกได้",
    };
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: input.editorId });

    // Pack metadata may change after catalog lookup. Re-read it inside the
    // order transaction so active/baseQty/unit/price snapshots never come from
    // stale tool or POS payload data.
    const canonicalPacks = await revalidateOrderPacksInTx(client, tenantId, items);
    if (!canonicalPacks.ok) {
      await client.query("ROLLBACK");
      return {
        status: "PACK_NOT_FOUND",
        sku: canonicalPacks.sku,
        size: canonicalPacks.size,
        packCode: canonicalPacks.packCode,
      };
    }
    items = canonicalPacks.items;

    // Enforce pharmacy sale policy before reserving any inventory. The model,
    // UI and channel adapters are not regulatory authority.
    // channel "pos" is the physical counter; everything else reaches the shop
    // over the internet. ONLINE_SALE_PROHIBITED is the only policy that reads
    // this, and at the counter it demands a pharmacist instead of refusing
    // outright — see evaluatePharmacySale().
    const pharmacySale = await checkPharmacySaleInTx(
      client,
      tenantId,
      items,
      input.pharmacyApprovedAssessmentId,
      input.channel === "pos" ? "counter" : "online",
      // The customer row is resolved further down, but the id the caller
      // supplied is the one the register/checkout is selling to, and it is all
      // the gate needs: it only refuses when the approval names a DIFFERENT
      // patient. Passing it here keeps the check inside the same locked read of
      // the assessment row.
      input.customerId ?? null,
      // การอนุมัติที่เคาน์เตอร์ใช้ได้กับช่องทาง POS เท่านั้น — ตัดที่นี่อีกชั้นหนึ่ง
      // ไม่ต้องพึ่ง route ใดเลย (checkPharmacySaleInTx ก็ตัดด้วย channel เองอีกที)
      input.channel === "pos" ? input.pharmacistCounterAuthorization ?? null : null
    );
    if (!pharmacySale.allowed) {
      await client.query("ROLLBACK");
      return {
        status: pharmacySale.status,
        sku: pharmacySale.sku,
        salePolicy: pharmacySale.salePolicy,
        ...(pharmacySale.maxQuantity == null ? {} : { maxQuantity: pharmacySale.maxQuantity }),
        ...(pharmacySale.requested == null ? {} : { requested: pharmacySale.requested }),
        ...(pharmacySale.blockers.length === 0 ? {} : { blockers: pharmacySale.blockers }),
      };
    }

    // ---- เภสัชกรที่รับผิดชอบกะนี้ (9.29) -------------------------------
    // เขียนก่อนไปแตะ bms_inventory **โดยตั้งใจ**: finalizePosSale() ล็อกแถวกะก่อน
    // แล้วค่อยตัดสต็อก ถ้าที่นี่ทำสลับกัน (ล็อกสต็อกไว้แล้วค่อยล็อกกะ) สองคำขอที่วิ่ง
    // พร้อมกันบนกะเดียวกันจะไขว้กันเป็น deadlock (40P01) กลางบิล
    // · เขียนเฉพาะเมื่อยังว่าง — ไม่ทับคนที่ลงเวรไว้ตอนเปิดกะ (7.97 บันทึกเฉพาะกรณี
    //   คนเปิดกะเป็นเภสัชกรเอง จึงมีกะที่ไม่มีใครบันทึกไว้เลยเป็นปกติ)
    const counterAuthorizedSkus = pharmacySale.counterAuthorizedSkus ?? [];
    const counterAuthorizer =
      counterAuthorizedSkus.length > 0 ? input.pharmacistCounterAuthorization ?? null : null;
    if (counterAuthorizer && input.posShiftId) {
      await client.query(
        `UPDATE bms_pos_shifts SET pharmacist_user_id = $3
          WHERE tenant_id = $1 AND id = $2 AND pharmacist_user_id IS NULL`,
        [tenantId, input.posShiftId, counterAuthorizer.pharmacistUserId]
      );
    }

    // ---- เคสในคิวที่ถูกแทนที่ด้วยการอนุมัติที่เครื่อง (9.29) --------------
    // ปิดในทรานแซกชันนี้ ไม่ใช่ยิงหลัง commit: ถ้าคิวอนุมัติเคสคาบเกี่ยวกับการขาย เส้นทาง
    // เดิม (best-effort หลัง commit) ปิดไม่ได้เพราะไม่รับสถานะ APPROVED แล้วทิ้งใบอนุมัติ
    // ที่ยังใช้ขายตะกร้าเดิมได้อีกใบไว้เงียบ ๆ
    // · อยู่ตรงนี้ (ก่อนสต็อก) เพราะมันล็อกแถวเคส และ checkPharmacySaleInTx ก็ล็อกแถวเคส
    //   ก่อนสต็อกเหมือนกัน — ล็อกลำดับเดียวกันทุกเส้นทางคือสิ่งที่กัน deadlock
    if (counterAuthorizer && input.pharmacySupersededAssessmentId) {
      const outcome = await closeAssessmentSupersededByCounterInTx(
        client,
        tenantId,
        input.pharmacySupersededAssessmentId,
        {
          posShiftId: input.posShiftId ?? null,
          basket: items.map((it) => ({ sku: it.sku, size: it.size, qty: it.qty })),
          pharmacistUserId: counterAuthorizer.pharmacistUserId,
        }
      );
      // ไม่ล้มบิลเพราะเรื่องนี้ — ของถูกจ่ายไปแล้วตามการตัดสินของเภสัชกร · แต่ต้องเห็นใน
      // log เพราะทุกผลที่ไม่ใช่ CLOSED หมายความว่ามีเคสค้างในคิวที่ต้องมีคนไปดู
      if (outcome !== "CLOSED") {
        console.error(
          "[PHARMACY] ปิดเคสที่ถูกแทนด้วยการอนุมัติหน้าเคาน์เตอร์ไม่ได้",
          input.pharmacySupersededAssessmentId,
          outcome
        );
      }
    }

    const lines: CreatedLine[] = [];
    let total = 0;

    // ---- สินค้าชุด (8.8) ----------------------------------------
    // เซ็ตไม่มีสต็อกของตัวเอง — จำนวนที่ขายได้มาจากส่วนประกอบ · โหลดสูตรของทุกเซ็ต
    // ในบิลนี้ไว้ก่อน แล้วขั้นจองสต็อกจะไปจองที่ส่วนประกอบแทน
    const bundleRows = await client.query<{
      bundle_sku: string; component_sku: string; component_size: string; qty: number;
    }>(
      `SELECT b.bundle_sku, b.component_sku, b.component_size, b.qty
         FROM bms_product_bundle_items b
         JOIN bms_products p ON p.tenant_id = b.tenant_id AND p.sku = b.bundle_sku AND p.is_bundle
        WHERE b.tenant_id = $1 AND b.bundle_sku = ANY($2::text[])`,
      [tenantId, items.map((it) => it.sku)]
    );
    const bundleRecipe = new Map<string, Array<{ sku: string; size: string; qty: number }>>();
    for (const row of bundleRows.rows) {
      const list = bundleRecipe.get(row.bundle_sku) ?? [];
      list.push({ sku: row.component_sku, size: row.component_size, qty: Number(row.qty) });
      bundleRecipe.set(row.bundle_sku, list);
    }
    // เซ็ตที่ยังไม่ได้ใส่ส่วนประกอบขายไม่ได้ — ปล่อยผ่านคือขายของที่ไม่มีอะไรออกจากคลัง
    for (const it of items) {
      if (bundleRecipe.has(it.sku)) continue;
      const flagged = await client.query(
        `SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2 AND is_bundle`,
        [tenantId, it.sku]
      );
      if (flagged.rowCount) {
        await client.query("ROLLBACK");
        return { status: "BUNDLE_INCOMPLETE", sku: it.sku };
      }
    }

    // เก็บทั้งยอดต่อ SKU+ไซซ์และยอดรวม SKU: แต่ละ price tier เลือก scope ของตัวเอง
    const variantKey = (sku: string, size: string) => `${sku}\u0000${size}`;
    const qtyByVariant = new Map<string, number>();
    const qtyBySku = new Map<string, number>();
    const promoQtyByVariant = new Map<string, number>();
    for (const it of items) {
      const key = variantKey(it.sku, it.size);
      qtyByVariant.set(key, (qtyByVariant.get(key) ?? 0) + Math.max(0, it.qty));
      qtyBySku.set(it.sku, (qtyBySku.get(it.sku) ?? 0) + Math.max(0, it.qty));
      // Pack units count toward wholesale thresholds, but the pack row already
      // states its own price and is wholly outside promotions. Counting it here
      // would both unlock a loose-unit promo and charge those pack pieces again.
      if (it.packUnitPrice == null) {
        promoQtyByVariant.set(key, (promoQtyByVariant.get(key) ?? 0) + Math.max(0, it.qty));
      }
    }
    const productSkus = Array.from(new Set(items.map((item) => item.sku)));

    const tierRows = await client.query<{
      product_sku: string; min_qty: number; unit_price: string | null;
      scope: PriceTier["scope"]; discount_pct: string | null; size: string | null;
    }>(
      `SELECT product_sku, min_qty, unit_price, scope, discount_pct, size
         FROM bms_product_price_tiers
        WHERE tenant_id = $1 AND product_sku = ANY($2::text[])
        ORDER BY product_sku, min_qty`,
      [tenantId, productSkus]
    );
    const tiersBySku = new Map<string, PriceTier[]>();
    for (const row of tierRows.rows) {
      const list = tiersBySku.get(row.product_sku) ?? [];
      list.push({
        minQty: Number(row.min_qty),
        scope: row.scope,
        size: row.size,
        unitPrice: row.unit_price == null ? null : Number(row.unit_price),
        discountPct: row.discount_pct == null ? null : Number(row.discount_pct),
      });
      tiersBySku.set(row.product_sku, list);
    }

    // ---- โปรโมชัน ซื้อ X แถม Y / N ชิ้นราคาเดียว (8.7) -----------
    // เป็นกลไก "ราคาของกลุ่มชิ้น" ไม่ใช่ส่วนลดชั้นที่ 5 — โปรที่ร้านประกาศไว้จึงไม่ถูก
    // ตัดด้วยเพดาน max_discount_pct ของบิลนั้น (ดูเหตุผลเต็มใน migration 8.7)
    const promoRows = await client.query<any>(
      `SELECT product_sku, kind, buy_qty, get_qty, bundle_price
         FROM bms_product_promotions
        WHERE tenant_id = $1 AND product_sku = ANY($2::text[]) AND active
          AND (starts_at IS NULL OR starts_at <= now())
          AND (ends_at   IS NULL OR ends_at   >  now())`,
      [tenantId, productSkus]
    );
    const promoBySku = new Map<string, Promotion>();
    for (const row of promoRows.rows) {
      promoBySku.set(
        row.product_sku,
        row.kind === "BUY_X_GET_Y"
          ? { kind: "BUY_X_GET_Y", buyQty: Number(row.buy_qty), getQty: Number(row.get_qty) }
          : { kind: "N_FOR_PRICE", buyQty: Number(row.buy_qty), bundlePrice: Number(row.bundle_price) }
      );
    }
    /** SKU ที่คิดยอดโปรไปแล้ว — โปรคิดครั้งเดียวต่อ SKU ต่อบิล ไม่ใช่ต่อบรรทัด */
    const promoCharged = new Set<string>();

    // สาขาที่จะตัดสต็อก — ทุกรายการในบิลเดียวต้องมาจากสาขาเดียวกัน
    const locationId = input.locationId ?? (await resolveDefaultLocationIdInTx(client, tenantId));

    for (const it of items) {
      // สินค้าชุด (8.8) — จองที่ส่วนประกอบ ไม่ใช่ที่ตัวเซ็ต
      //
      // ทำก่อนขั้นจองปกติและ return ทันทีเมื่อของไม่พอ เพื่อให้ทั้งบิลล้มโดยไม่มี
      // ส่วนประกอบตัวไหนถูกจองค้าง (ROLLBACK ครอบอยู่แล้ว แต่การ return ที่นี่ทำให้
      // ข้อความบอกได้ว่าส่วนประกอบตัวไหนขาด ไม่ใช่บอกว่า "เซ็ตหมด" ซึ่งช่วยพนักงานไม่ได้)
      const recipe = bundleRecipe.get(it.sku);
      if (recipe) {
        // bms_order_items มี FK ไป bms_inventory ทุกบรรทัดจึงต้องมีแถวสต็อกอยู่จริง
        // เซ็ตได้แถวของตัวเองที่ค้างอยู่ที่ 0 ตลอด (จำนวนที่ขายได้มาจากส่วนประกอบ)
        // — สร้างให้ที่นี่เพื่อไม่ให้ร้านต้องไปสร้างแถวสต็อกของเซ็ตด้วยมือก่อนขาย
        await client.query(
          `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
           VALUES ($1,$2,$3,$4,0,0)
           ON CONFLICT (tenant_id, location_id, product_sku, size) DO NOTHING`,
          [tenantId, locationId, it.sku, it.size]
        );
        for (const part of recipe) {
          const need = part.qty * it.qty;
          const res = await client.query(
            `UPDATE bms_inventory
                SET reserved_stock = reserved_stock + $3, updated_at = now()
              WHERE tenant_id = $4 AND location_id = $5 AND product_sku = $1 AND size = $2
                AND (current_stock - reserved_stock) >= $3`,
            [part.sku, part.size, need, tenantId, locationId]
          );
          if (res.rowCount === 0) {
            const cur = await client.query<{ available: number }>(
              `SELECT (current_stock - reserved_stock) AS available FROM bms_inventory
                WHERE tenant_id = $3 AND location_id = $4 AND product_sku = $1 AND size = $2`,
              [part.sku, part.size, tenantId, locationId]
            );
            await client.query("ROLLBACK");
            if (cur.rowCount === 0) return { status: "NOT_FOUND", sku: part.sku, size: part.size };
            return {
              status: "INSUFFICIENT",
              sku: part.sku,
              size: part.size,
              available: Number(cur.rows[0].available),
              requested: need,
            };
          }
        }
      }

      // reserve แบบ atomic บน client ตัวเดียวกับทรานแซกชัน (ล็อกแถว inventory)
      // เซ็ตข้ามขั้นนี้ไป — แถว bms_inventory ของเซ็ตค้างที่ 0 ตลอดตามการออกแบบ
      const upd = recipe
        ? { rowCount: 1, rows: [{ available_after: 0 }] }
        : await client.query<{ available_after: number }>(
        `UPDATE bms_inventory
            SET reserved_stock = reserved_stock + $3, updated_at = now()
          WHERE tenant_id = $4 AND location_id = $5 AND product_sku = $1 AND size = $2
            AND (current_stock - reserved_stock) >= $3
          RETURNING (current_stock - reserved_stock) AS available_after`,
        [it.sku, it.size, it.qty, tenantId, locationId]
      );

      if (upd.rowCount === 0) {
        // แยกสาเหตุ: ไม่พบ row หรือ ของไม่พอ
        const cur = await client.query<{ available: number }>(
          `SELECT (current_stock - reserved_stock) AS available
             FROM bms_inventory
            WHERE tenant_id = $3 AND location_id = $4 AND product_sku = $1 AND size = $2`,
          [it.sku, it.size, tenantId, locationId]
        );
        await client.query("ROLLBACK");
        if (cur.rowCount === 0) {
          return { status: "NOT_FOUND", sku: it.sku, size: it.size };
        }
        return {
          status: "INSUFFICIENT",
          sku: it.sku,
          size: it.size,
          available: Number(cur.rows[0].available),
          requested: it.qty,
        };
      }

      // ดึงราคา (สินค้าต้อง active)
      const prod = await client.query<{ price: string; name: string; vat_category: string }>(
        `SELECT price, name, vat_category FROM bms_products WHERE tenant_id = $2 AND sku = $1 AND active`,
        [it.sku, tenantId]
      );
      if (prod.rowCount === 0) {
        await client.query("ROLLBACK");
        return { status: "NOT_FOUND", sku: it.sku, size: it.size };
      }

      const listPrice = await getVariantBasePriceInTx(client, tenantId, it.sku, it.size);
      if (listPrice == null) {
        await client.query("ROLLBACK");
        return { status: "NOT_FOUND", sku: it.sku, size: it.size };
      }
      const key = variantKey(it.sku, it.size);
      // ราคาส่ง (8.1) — ไม่มีขั้นไหนเข้าเงื่อนไข = ได้ราคาป้ายตามเดิม
      // บรรทัดที่ขายเป็นหน่วยขาย (pack) ไม่ถูกแตะ: ราคา pack บอกตรง ๆ ว่ากล่องนี้
      // ราคาเท่านี้ ให้สองกลไกแย่งกันตัดสินราคาจะอธิบายบิลไม่ได้
      const unitPrice = it.packUnitPrice != null
        ? listPrice
        : unitPriceForQty(
            listPrice,
            tiersBySku.get(it.sku) ?? [],
            qtyByVariant.get(key) ?? it.qty,
            qtyBySku.get(it.sku) ?? it.qty,
            it.size
          );
      // ราคาต่อหน่วยขาย (กล่อง) ถูกกว่าราคาต่อหน่วยฐาน × จำนวน เสมอ → ยอดบิลต้องคิดจาก
      // ราคาหน่วยขายเมื่อมี ส่วน unit_price ยังเป็นราคาต่อหน่วยฐานตามความหมายเดิม
      // (ผลคือ SUM(unit_price × qty) > total_amount เท่ากับส่วนลดยกกล่อง — ตั้งใจ)
      const packQty = it.packQty ?? null;
      const packUnitPrice = it.packUnitPrice ?? null;

      // โปรคิดครั้งเดียวต่อ SKU+ไซซ์ เพื่อไม่ให้ราคา/จำนวนของคนละไซซ์ปนกัน
      // บรรทัดที่ขายเป็น pack ไม่เข้าโปร ด้วยเหตุผลเดียวกับขั้นราคาส่ง
      const promo = packUnitPrice != null ? null : promoBySku.get(it.sku) ?? null;
      if (promo && !promoCharged.has(key)) {
        promoCharged.add(key);
        total += applyPromotion(listPrice, promoQtyByVariant.get(key) ?? it.qty, promo).amount;
      } else if (!promo) {
        total += packUnitPrice != null && packQty != null ? packUnitPrice * packQty : unitPrice * it.qty;
      }
      lines.push({
        sku: it.sku,
        name: prod.rows[0].name,
        size: it.size,
        qty: it.qty,
        unitPrice,
        receiptUnitPrice: packUnitPrice ?? listPrice,
        pricingSnapshot: {
          source: "SALE",
          priceTiers: canonicalPriceTiers(tiersBySku.get(it.sku) ?? []),
          promotion: promo,
        },
        availableAfter: Number(upd.rows[0].available_after),
        packCode: it.packCode ?? null,
        packUnitName: it.packUnitName ?? null,
        packQty,
        packUnitPrice,
        vatCategory: prod.rows[0].vat_category ?? "UNKNOWN",
      });
    }

    // CRM: ลูกค้าที่รู้ตัวตนแล้ว (POS ค้นสมาชิกที่เคาน์เตอร์) มาก่อน
    // ถ้าไม่มีจึงหา/สร้างจาก (tenant, channel, customerRef) ตามเดิม
    let customerId: string | null = null;
    if (input.customerId) {
      const owned = await client.query<{ id: string }>(
        `SELECT id FROM bms_customers WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, input.customerId]
      );
      if (!owned.rowCount) {
        await client.query("ROLLBACK");
        return { status: "POINTS_INVALID", reason: "ไม่พบลูกค้าที่ระบุในร้านนี้" };
      }
      customerId = owned.rows[0].id;
    } else {
      customerId = await resolveOrCreateCustomer(
        client,
        tenantId,
        input.channel,
        input.customerRef ?? null
      );
    }

    // โค้ดส่วนลด (ถ้ามี) — ตรวจ + เพิ่ม redemptions_count แบบ atomic ในทรานแซกชันเดียวกัน
    // ก่อน insert order เสมอ เพื่อให้ ROLLBACK คืนสต็อกที่จองไว้ด้วยถ้าโค้ดใช้ไม่ได้
    let couponDiscount = 0;
    let appliedCouponCode: string | null = null;
    let appliedCouponId: string | null = null;
    if (input.couponCode) {
      const couponResult = await applyCouponInTx(client, tenantId, input.couponCode, customerId, total);
      if (!couponResult.ok) {
        await client.query("ROLLBACK");
        return { status: "COUPON_INVALID", reason: couponResult.reason };
      }
      couponDiscount = couponResult.discount;
      appliedCouponCode = couponResult.code;
      appliedCouponId = couponResult.couponId; // ผูกด้วย id ที่นิ่ง — ประวัติการใช้ join ด้วย id ไม่ใช่ code
    }

    // สมาชิก (7.96): ส่วนลดตามชั้น + แลกแต้ม ซ้อนกับคูปองได้ ลำดับตายตัว
    // tier → คูปอง → แต้ม แล้วบังคับเพดานรวมต่อบิล
    // ยอดรวมทุกชั้นต้องลงที่ discount_amount ก้อนเดียว เพราะฐาน VAT/ใบกำกับ (7.88)
    // อ่านจากคอลัมน์นั้น ส่วน bms_order_discounts เก็บแค่รายละเอียดว่ามาจากไหน
    const loyaltySettings = await getLoyaltySettings(tenantId);
    const member = customerId ? await getMemberForOrderInTx(client, tenantId, customerId) : null;
    const requestedPoints = Math.max(0, Math.floor(Number(input.pointsToRedeem ?? 0)));
    if (requestedPoints > 0 && !member?.memberNo) {
      await client.query("ROLLBACK");
      return { status: "POINTS_INVALID", reason: "แลกแต้มได้เฉพาะลูกค้าที่เป็นสมาชิก" };
    }

    // ค่าบริการ/ค่าถุง (8.6) เป็นยอดที่ต้องจ่ายและอยู่ในฐาน VAT แต่ไม่ใช่สินค้า
    // จึงไม่เข้า tier/coupon/แต้ม/ส่วนลดมือ: คิดส่วนลดจาก productSubtotal ก่อน
    // แล้วค่อยบวก extraTotal กลับเข้า finalTotal
    const productSubtotal = total;
    const extraLines = (input.extraLines ?? [])
      .map((x) => ({
        label: String(x?.label ?? "").trim(),
        qty: Number(x?.qty ?? 1),
        unitAmount: Math.round(Number(x?.unitAmount) * 100) / 100,
        vatCategory: (x?.vatCategory === "N" || x?.vatCategory === "UNKNOWN" ? x.vatCategory : "V") as VatCategory,
      }))
      .filter((x) => x.label
        && Number.isInteger(x.qty) && x.qty > 0
        && Number.isFinite(x.unitAmount) && x.unitAmount >= 0);
    const extraTotal = Math.round(extraLines.reduce(
      (sum, extra) => sum + extra.unitAmount * extra.qty,
      0
    ) * 100) / 100;
    const grossSubtotal = Math.round((productSubtotal + extraTotal) * 100) / 100;

    // ส่วนลดมือ: ไม่มีหลักฐานว่าใครอนุมัติ = ไม่รับ ห้าม fallback เป็น 0 เงียบ ๆ
    // เพราะจอบอกลูกค้าไปแล้วว่าลดให้ ถ้าเงียบ ๆ ไม่ลด ยอดที่เตรียมจ่ายจะไม่ตรงกับบิล
    const manualDiscount = Math.max(0, Math.round(Number(input.manualDiscount ?? 0) * 100) / 100);
    if (manualDiscount > 0 && !(input.discountApprovedBy && input.discountReason?.trim())) {
      await client.query("ROLLBACK");
      return { status: "DISCOUNT_UNAPPROVED", reason: "ส่วนลดมือต้องมีผู้อนุมัติและเหตุผล" };
    }

    const breakdown = composeDiscounts({
      settings: loyaltySettings,
      subtotal: productSubtotal,
      // ส่วนลดชั้นสมาชิกให้เฉพาะคนที่สมัครแล้ว ไม่ใช่ทุก record ในระบบ CRM
      tier: member?.memberNo ? member.tier : null,
      couponDiscount,
      pointsRequested: requestedPoints,
      pointsAvailable: member?.pointsUsable ?? 0,
      manualDiscount,
    });
    // ชนเพดาน max_discount_pct แล้วส่วนลดมือถูกตัด = ต้องบอก ไม่ใช่ลดให้น้อยกว่าที่ตกลง
    // (composeDiscounts ตัดชั้น manual ก่อนเพื่อน เพราะย้อนคืนง่ายที่สุด)
    if (manualDiscount > 0 && breakdown.manualDiscount !== manualDiscount) {
      await client.query("ROLLBACK");
      return {
        status: "DISCOUNT_UNAPPROVED",
        reason: `ส่วนลดรวมเกินเพดาน ${loyaltySettings.maxDiscountPct}% ของบิล — ส่วนลดมือลดได้สูงสุด ฿${breakdown.manualDiscount.toFixed(2)}`,
      };
    }
    // แลกได้ไม่เท่าที่ขอ = ปฏิเสธทั้งบิล ห้ามหักให้บางส่วนเงียบ ๆ
    //
    // composeDiscounts จะ clamp จำนวนที่ขอลงมาตามแต้มที่มีและตามที่บิลรับได้อยู่แล้ว
    // ถ้าปล่อยผ่าน คนขอแลก 500 แต้ม (คาดว่าจะลด 50 บาท) แต่มี 100 จะได้บิลที่ลดแค่
    // 10 บาทโดยไม่มีสัญญาณอะไรบอก — ยอดเงินที่เตรียมจ่ายมาจากส่วนลดก้อนใหญ่
    // จอ POS ส่งค่าที่ผ่าน preview (clamp แล้ว) มาเสมอ จึงไม่ชนกฎนี้ ยกเว้นกรณี
    // แต้มเปลี่ยนไประหว่าง preview กับตอนกดรับเงิน ซึ่งต้องให้พนักงานคิดเงินใหม่
    // ไม่ใช่เงียบ ๆ ลดให้น้อยกว่าที่บอกลูกค้าไปแล้ว
    if (requestedPoints > 0 && breakdown.pointsUsed !== requestedPoints) {
      await client.query("ROLLBACK");
      const usable = member?.pointsUsable ?? 0;
      return {
        status: "POINTS_INVALID",
        reason: usable < requestedPoints
          ? `แต้มไม่พอ (ขอแลก ${requestedPoints} แต้ม แต่ใช้ได้ ${usable} แต้ม)`
          : `แลกแต้มจำนวนนี้กับบิลนี้ไม่ได้ (ขั้นต่ำ ${loyaltySettings.redeemMinPoints} แต้ม, ต้องเป็นจำนวนเท่าของ ${loyaltySettings.redeemPointsPerUnit} แต้ม, และไม่เกินเพดานส่วนลด)`,
      };
    }

    const discount = breakdown.totalDiscount;
    const discountedProductTotal = Math.max(0, productSubtotal - discount);
    const finalTotal = Math.round((discountedProductTotal + extraTotal) * 100) / 100;

    // ขนส่งที่ลูกค้าอยากได้ — เก็บเฉพาะโค้ดที่รู้จัก ที่เหลือทิ้งเป็น null (ไม่ทำให้ออร์เดอร์ล้ม)
    const preferredCarrier: Carrier | null = isCarrier(input.preferredCarrier) ? input.preferredCarrier : null;

    // ค่าส่ง (7.47) — คิดจากที่อยู่ default ของลูกค้าที่มีอยู่ "ตอนนี้"
    // แชทส่วนใหญ่ยังไม่มีที่อยู่ตอนสร้างออร์เดอร์ (identity-first checkout เก็บทีหลัง)
    // → จุดนี้อาจได้ค่าเหมา/ไม่มีค่าส่ง แล้วถูกคิดใหม่ตอนที่อยู่มาถึงผ่าน
    //   recalculateOrderShipping() ใน saveCustomerCheckoutDetails
    // ลูกค้ารับของที่เคาน์เตอร์เอง ช่องทาง POS ต้องไม่มีค่าส่ง แม้ร้านจะตั้ง
    // flat shipping สำหรับออร์เดอร์ออนไลน์ไว้ก็ตาม
    const shippingFee = input.channel === "pos"
      ? { fee: 0, source: "none" as ShippingFeeSource }
      : await computeOrderShippingFeeInTx(client, {
          tenantId,
          customerId,
          subtotal: finalTotal,
          items,
          carrier: preferredCarrier,
        });

    // สร้าง order (เริ่มที่ PENDING = รอชำระเงิน, จองสต็อกไว้แล้ว)
    // total_amount = ค่าสินค้า − ส่วนลด + ค่าบริการ (ไม่รวมค่าส่ง — 7.47)
    const ord = await client.query<{ id: string }>(
      `INSERT INTO bms_orders (tenant_id, location_id, channel, customer_ref, customer_id, status, total_amount, discount_amount, coupon_code, coupon_id, preferred_carrier, shipping_fee, shipping_fee_source,
                               pos_device_id, pos_shift_id, cashier_user_id, idempotency_key, discount_approved_by, discount_reason)
       VALUES ($1, $12, $2, $3, $4, 'PENDING', $5, $6, $7, $8, $9, $10, $11, $13, $14, $15, $16, $17, $18)
       RETURNING id`,
      [tenantId, input.channel, input.customerRef ?? null, customerId, finalTotal, discount, appliedCouponCode, appliedCouponId, preferredCarrier, shippingFee.fee, shippingFee.source,
        locationId, input.posDeviceId ?? null, input.posShiftId ?? null, input.cashierUserId ?? null,
        input.idempotencyKey ?? null, input.discountApprovedBy ?? null, input.discountReason ?? null]
    );
    const orderId = ord.rows[0].id;

    // Spend the pharmacist's approval in the same transaction that reserves the
    // stock it authorises. checkPharmacySaleInTx() above already took FOR UPDATE
    // on this row and refuses a case that is already ORDER_CREATED, so one
    // approval can only ever back one order — previously this was marked
    // fire-and-forget after commit, leaving the case spendable again.
    if (input.pharmacyApprovedAssessmentId) {
      await markAssessmentOrderCreatedInTx(
        client,
        tenantId,
        input.pharmacyApprovedAssessmentId,
        orderId,
        "system:pharmacy-order"
      );
    }

    // ---- หลักฐานการอนุมัติที่เคาน์เตอร์ (9.29) --------------------------
    // อยู่ในทรานแซกชันเดียวกับบิลที่มันอนุมัติ: บิลที่ commit แล้วจะไม่มีทางไม่มี
    // หลักฐานว่าเภสัชกรคนไหนปล่อยยาออกไป (กฎเดียวกับ audit ของการเขียนที่สำคัญ)
    if (counterAuthorizer) {
      const pharmacistUserId = counterAuthorizer.pharmacistUserId;
      const note = (counterAuthorizer.note ?? "").trim() || null;
      const authorizedSet = new Set(counterAuthorizedSkus);
      // นโยบายที่ถูกปลด ณ เวลานั้น — อ่านสด ไม่ใช่ค่าที่ client ส่งมา และเก็บเป็น
      // snapshot เพราะร้านแก้ policy ทีหลังต้องไม่เปลี่ยนความหมายของหลักฐานเดิม
      const policyNow = await client.query<{ product_sku: string; sale_policy: string; status: string }>(
        `SELECT product_sku, sale_policy, status
           FROM bms_pharmacy_product_policies
          WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
        [tenantId, [...authorizedSet]]
      );
      const policyBySku = new Map(policyNow.rows.map((row) => [row.product_sku, row]));
      // รวมจำนวนต่อ (sku, size) — บิลใบเดียวถือ SKU+ไซซ์เดียวกันได้หลายหน่วยขาย (9.21)
      // และหลักฐานควรบอกว่า "จ่ายไปเท่าไร" ไม่ใช่บอกทีละบรรทัดของหน่วยขาย
      const authorizedQty = new Map<string, { sku: string; size: string; qty: number }>();
      for (const it of items) {
        if (!authorizedSet.has(it.sku)) continue;
        const key = `${it.sku}\u0000${it.size}`;
        const cur = authorizedQty.get(key);
        if (cur) cur.qty += it.qty;
        else authorizedQty.set(key, { sku: it.sku, size: it.size, qty: it.qty });
      }
      for (const line of authorizedQty.values()) {
        const policy = policyBySku.get(line.sku);
        await client.query(
          `INSERT INTO bms_pos_pharmacist_authorizations
             (tenant_id, order_id, product_sku, size, qty, sale_policy, policy_status, pharmacist_user_id, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, order_id, product_sku, size) DO NOTHING`,
          [tenantId, orderId, line.sku, line.size, line.qty,
            policy?.sale_policy ?? "UNKNOWN", policy?.status ?? "MISSING", pharmacistUserId, note]
        );
      }
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1, $2, 'pharmacy.counter_authorization', $3, $4)`,
        [tenantId, `user:${pharmacistUserId}`, orderId, JSON.stringify({
          items: [...authorizedQty.values()].map((line) => ({
            sku: line.sku, size: line.size, qty: line.qty,
            salePolicy: policyBySku.get(line.sku)?.sale_policy ?? "UNKNOWN",
          })),
          cashierUserId: input.cashierUserId ?? null,
          hasNote: Boolean(note),
          // ทางไล่กลับไปหาเคสในคิวที่บิลนี้แทนที่ (แถว event ของเคสไม่มี orderId เพราะ
          // ตอนปิดเคส บิลยังไม่ถูกสร้าง)
          supersededAssessmentId: input.pharmacySupersededAssessmentId ?? null,
        })]
      );
    }

    await reserveCustomerCouponInTx(client, tenantId, customerId, appliedCouponId, orderId);

    // แลกแต้ม: หักออกจากยอดลูกค้าทันทีที่บิลถูกสร้าง (ไม่มี state "จองแต้ม" แยก)
    // บิลที่ถูกยกเลิกทีหลังคืนแต้มผ่าน releasePointsForOrdersInTx ใน cancelOrder
    if (breakdown.pointsUsed > 0 && customerId) {
      const redeemed = await redeemPointsInTx(client, {
        tenantId,
        customerId,
        orderId,
        points: breakdown.pointsUsed,
        discount: breakdown.pointsDiscount,
        actorUserId: input.cashierUserId ?? null,
      });
      if (!redeemed.ok) {
        await client.query("ROLLBACK");
        return { status: "POINTS_INVALID", reason: redeemed.reason };
      }
    }

    const manualLabel = `ส่วนลดหน้าร้าน — ${input.discountReason?.trim() ?? ""}`.trim();
    const discountLines: OrderDiscountLine[] = [];
    if (breakdown.tierDiscount > 0 && member?.tier) {
      discountLines.push({ source: "TIER", label: breakdown.tierLabel ?? `สมาชิก ${member.tier.name}`, amount: breakdown.tierDiscount, pointsUsed: 0 });
    }
    if (breakdown.couponDiscount > 0) {
      discountLines.push({ source: "COUPON", label: `คูปอง ${appliedCouponCode ?? ""}`.trim(), amount: breakdown.couponDiscount, pointsUsed: 0 });
    }
    if (breakdown.pointsDiscount > 0) {
      discountLines.push({ source: "POINTS", label: `แลก ${breakdown.pointsUsed} แต้ม`, amount: breakdown.pointsDiscount, pointsUsed: breakdown.pointsUsed });
    }
    if (breakdown.manualDiscount > 0) {
      discountLines.push({ source: "MANUAL", label: manualLabel, amount: breakdown.manualDiscount, pointsUsed: 0 });
    }
    await recordOrderDiscountsInTx(client, tenantId, orderId, [
      ...(breakdown.tierDiscount > 0 && member?.tier
        ? [{ source: "TIER" as const, refId: member.tier.id, label: breakdown.tierLabel ?? `สมาชิก ${member.tier.name}`, amount: breakdown.tierDiscount }]
        : []),
      ...(breakdown.couponDiscount > 0
        ? [{ source: "COUPON" as const, refId: appliedCouponId, label: `คูปอง ${appliedCouponCode ?? ""}`.trim(), amount: breakdown.couponDiscount }]
        : []),
      ...(breakdown.pointsDiscount > 0
        ? [{ source: "POINTS" as const, label: `แลก ${breakdown.pointsUsed} แต้ม`, amount: breakdown.pointsDiscount, pointsUsed: breakdown.pointsUsed }]
        : []),
      ...(breakdown.manualDiscount > 0
        ? [{ source: "MANUAL" as const, label: manualLabel, amount: breakdown.manualDiscount }]
        : []),
    ]);

    for (const extra of extraLines) {
      await client.query(
        `INSERT INTO bms_order_extra_lines (tenant_id, order_id, label, qty, unit_amount, vat_category)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, orderId, extra.label, extra.qty, extra.unitAmount, extra.vatCategory]
      );
    }

    for (const ln of lines) {
      await client.query(
        `INSERT INTO bms_order_items (tenant_id, location_id, order_id, product_sku, product_name, size, qty, unit_price,
                                      receipt_unit_price, pricing_snapshot, pack_code, pack_unit_name, pack_qty, pack_unit_price, vat_category)
         VALUES ($1, $8, $2, $3, $4, $5, $6, $7, $14, $15, $9, $10, $11, $12, $13)`,
        [tenantId, orderId, ln.sku, ln.name, ln.size, ln.qty, ln.unitPrice,
          locationId, ln.packCode ?? null, ln.packUnitName ?? null, ln.packQty ?? null, ln.packUnitPrice ?? null,
          ln.vatCategory ?? "UNKNOWN", ln.receiptUnitPrice, JSON.stringify(ln.pricingSnapshot)]
      );
    }

    // ledger: RESERVE ทุกรายการ
    await recordOrderMovements(
      client,
      [orderId],
      "RESERVE",
      `customer:${input.customerRef ?? input.channel}`
    );

    await markRestockSubscriptionsOrdered({
      tenantId,
      orderId,
      channel: input.channel,
      customerRef: input.customerRef,
      customerId,
      items,
      client,
    });
    await client.query("COMMIT");
    return {
      status: "CREATED",
      orderId,
      total: finalTotal,
      subtotal: grossSubtotal,
      discount,
      shippingFee: shippingFee.fee,
      amountDue: finalTotal + shippingFee.fee,
      couponCode: appliedCouponCode,
      preferredCarrier,
      items: lines,
      discountLines,
      pointsUsed: breakdown.pointsUsed,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export type ReorderResult = CreateOrderResult | { status: "SOURCE_NOT_FOUND" };

export type CustomerOrderStatus = {
  orderId: string;
  displayOrderId: string;
  status: string;
  total: number;
  date: string;
};

/** Customer-safe order lookup scoped to the identity established by the channel adapter. */
export async function listCustomerOrderStatuses(
  tenantId: string,
  channel: Channel,
  customerRef: string,
  limit = 10
): Promise<CustomerOrderStatus[]> {
  const boundedLimit = Math.min(Math.max(limit, 1), 20);
  const identity = normalizeCustomerIdentity(channel, customerRef);
  if (!identity) return [];
  const res = await query<{ id: string; status: string; total_amount: string; created_at: Date | string }>(
    `WITH identity AS (
       SELECT customer_id
         FROM bms_customer_identities
        WHERE tenant_id = $1 AND channel = $2 AND external_ref = $3
        LIMIT 1
     )
     SELECT orders.id, orders.status, orders.total_amount, orders.created_at
       FROM bms_orders orders
      WHERE orders.tenant_id = $1
        AND (
          orders.customer_id = (SELECT customer_id FROM identity)
          OR (
            orders.channel = $2 AND orders.customer_ref = $3
            AND (orders.customer_id IS NULL OR NOT EXISTS (SELECT 1 FROM identity))
          )
        )
      ORDER BY orders.created_at DESC LIMIT $4`,
    [tenantId, identity.channel, identity.customerRef, boundedLimit]
  );
  return res.rows.map((row) => ({
    orderId: String(row.id),
    displayOrderId: String(row.id).slice(0, 8),
    status: row.status,
    total: Number(row.total_amount),
    date: new Date(row.created_at).toISOString(),
  }));
}

export async function customerOwnsOrder(
  tenantId: string,
  channel: Channel,
  customerRef: string,
  orderId: string
): Promise<boolean> {
  const identity = normalizeCustomerIdentity(channel, customerRef);
  if (!identity) return false;
  const res = await query(
    `WITH identity AS (
       SELECT customer_id
         FROM bms_customer_identities
        WHERE tenant_id = $1 AND channel = $3 AND external_ref = $4
        LIMIT 1
     )
     SELECT 1 FROM bms_orders orders
      WHERE orders.tenant_id = $1 AND orders.id::text = $2
        AND (
          orders.customer_id = (SELECT customer_id FROM identity)
          OR (
            orders.channel = $3 AND orders.customer_ref = $4
            AND (orders.customer_id IS NULL OR NOT EXISTS (SELECT 1 FROM identity))
          )
        )
      LIMIT 1`,
    [tenantId, orderId, identity.channel, identity.customerRef]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Payment auto-selection is intentionally narrower than order history: only a
 * PENDING order from the channel currently talking to us may be selected.
 */
export async function findCustomerPayableOrder(
  tenantId: string,
  channel: Channel,
  customerRef: string,
  orderId?: string | null
): Promise<CustomerOrderStatus | null> {
  const identity = normalizeCustomerIdentity(channel, customerRef);
  if (!identity) return null;
  const res = await query<{ id: string; status: string; total_amount: string; created_at: Date | string }>(
    `WITH identity AS (
       SELECT customer_id
         FROM bms_customer_identities
        WHERE tenant_id = $1 AND channel = $2 AND external_ref = $3
        LIMIT 1
     )
     SELECT orders.id, orders.status, orders.total_amount, orders.created_at
       FROM bms_orders orders
      WHERE orders.tenant_id = $1
        AND orders.channel = $2
        AND orders.customer_ref = $3
        AND orders.status = 'PENDING'
        AND ($4::text IS NULL OR orders.id::text = $4)
        AND (
          orders.customer_id = (SELECT customer_id FROM identity)
          OR orders.customer_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM identity)
        )
      ORDER BY orders.created_at DESC
      LIMIT 1`,
    [tenantId, identity.channel, identity.customerRef, orderId ?? null]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    orderId: String(row.id),
    displayOrderId: String(row.id).slice(0, 8),
    status: row.status,
    total: Number(row.total_amount),
    date: new Date(row.created_at).toISOString(),
  };
}

/**
 * "ซื้อซ้ำ" — สร้างออร์เดอร์ใหม่จากรายการสินค้าของออร์เดอร์เก่า (channel/customer เดิม)
 * ราคาตัดตามราคาปัจจุบันของสินค้า (snapshot ใหม่) ไม่ใช่ราคาย้อนหลัง · ใช้ createOrder() เดิมทั้งหมด
 * (ระบบนี้ไม่มีสถานะ DRAFT แยก — ออร์เดอร์เริ่มที่ PENDING พร้อมจองสต็อกทันทีเหมือน createOrder ปกติ)
 */
export async function reorderFromOrder(
  tenantId: string,
  orderId: string,
  editorId?: string | number | null,
  currentIdentity?: CustomerChannelIdentity | null
): Promise<ReorderResult> {
  const src = await query<{ channel: Channel; customer_ref: string | null; preferred_carrier: string | null }>(
    `SELECT channel, customer_ref, preferred_carrier FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId]
  );
  if (src.rowCount === 0) return { status: "SOURCE_NOT_FOUND" };

  const itemsRes = await query<{ product_sku: string; size: string; qty: number }>(
    `SELECT product_sku, size, qty FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, orderId]
  );
  if (itemsRes.rowCount === 0) return { status: "EMPTY" };

  const targetIdentity = reorderTargetIdentity(
    { channel: src.rows[0].channel, customerRef: src.rows[0].customer_ref },
    currentIdentity
  );

  return createOrder({
    tenantId,
    channel: targetIdentity.channel as Channel,
    customerRef: targetIdentity.customerRef,
    items: itemsRes.rows.map((r) => ({ sku: r.product_sku, size: r.size, qty: Number(r.qty) })),
    editorId,
    // Same customer reordering — keep the carrier they asked for last time.
    preferredCarrier: src.rows[0].preferred_carrier,
  });
}

// ---- transition แบบไม่ขยับสต็อก (pay / pack / complete) — tenant-scoped -----
async function transition(
  tenantId: string,
  orderId: string,
  from: string[],
  to: string
): Promise<boolean> {
  const res = await query(
    `UPDATE bms_orders SET status = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = ANY($3)`,
    [tenantId, orderId, from, to]
  );
  return (res.rowCount ?? 0) > 0;
}

/** จ่ายเงินแล้ว: PENDING → PAID */
export async function payOrder(tenantId: string, orderId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const ord = await client.query(
      `UPDATE bms_orders SET status = 'PAID', paid_at = COALESCE(paid_at, now()), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
      [tenantId, orderId]
    );
    if ((ord.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    await redeemCustomerCouponForOrderInTx(client, tenantId, orderId);
    // แต้มสะสม (7.96) — ให้ทุกช่องทางที่บิลถึงสถานะ PAID ไม่ใช่แค่หน้าร้าน
    // ลูกค้าสั่งทาง LINE/TikTok แล้วโอนเงิน ต้องได้แต้มเหมือนเดินมาซื้อเอง
    await earnPointsForOrderInTx(client, { tenantId, orderId });
    await markRestockSubscriptionsPurchasedForOrder({ tenantId, orderId, client });
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
  void reviewMemberTierForOrder(tenantId, orderId);
  void notifyOrderStatusEmail(tenantId, orderId, "paid");
  return true;
}
/** แพ็คของ: PAID → PACKING */
export async function packOrder(tenantId: string, orderId: string): Promise<boolean> {
  const ok = await transition(tenantId, orderId, ["PAID"], "PACKING");
  if (ok) void notifyOrderStatusEmail(tenantId, orderId, "packing");
  return ok;
}
/** ปิดงาน: SHIPPED → COMPLETED */
export async function completeOrder(tenantId: string, orderId: string): Promise<boolean> {
  const ok = await transition(tenantId, orderId, ["SHIPPED"], "COMPLETED");
  if (ok) void notifyOrderStatusEmail(tenantId, orderId, "completed");
  return ok;
}

/**
 * จัดส่งจริง: PACKING → SHIPPED → ตัด current+reserved (atomic, tenant-scoped)
 */
export async function shipOrder(tenantId: string, orderId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const info = await client.query<{ channel: string; customer_id: string | null }>(
      `SELECT channel, customer_id FROM bms_orders WHERE tenant_id = $1 AND id = $2 AND status = 'PACKING'`,
      [tenantId, orderId]
    );
    if (info.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    // ช่องทางที่ร้านต้องเก็บที่อยู่เอง (ไม่ใช่มาร์เก็ตเพลส) ต้องมีที่อยู่จัดส่งของลูกค้าก่อนถึงจัดส่งได้จริง
    const { channel, customer_id } = info.rows[0];
    if (!MARKETPLACE_CHANNELS.has(channel)) {
      const addr = customer_id
        ? await client.query(
            `SELECT 1 FROM bms_customer_addresses
              WHERE tenant_id = $1 AND customer_id = $2 AND address_type = 'shipping' LIMIT 1`,
            [tenantId, customer_id]
          )
        : null;
      if (!addr || addr.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
    }

    const ord = await client.query(
      `UPDATE bms_orders SET status = 'SHIPPED', updated_at = now()
        WHERE tenant_id = $2 AND id = $1 AND status = 'PACKING'`,
      [orderId, tenantId]
    );
    if (ord.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      `UPDATE bms_inventory inv
          SET current_stock  = current_stock  - oi.qty,
              reserved_stock = reserved_stock - oi.qty,
              updated_at = now()
         FROM (
           -- view ไม่ใช่ตารางตรง ๆ (8.8) — สินค้าชุดถูกแทนด้วยส่วนประกอบแล้ว
           SELECT tenant_id, location_id, product_sku, size, SUM(qty)::integer AS qty
             FROM bms_order_stock_lines WHERE order_id = $1
            GROUP BY tenant_id, location_id, product_sku, size
         ) oi
        WHERE TRUE
          AND inv.tenant_id = oi.tenant_id
          AND inv.location_id = oi.location_id
          AND inv.product_sku = oi.product_sku
          AND inv.size = oi.size`,
      [orderId]
    );

    await recordOrderMovements(client, [orderId], "SHIP", "system");

    await client.query("COMMIT");
    void notifyOrderStatusEmail(tenantId, orderId, "shipped");
    return true;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/** คืนสินค้า: (SHIPPED/COMPLETED) → RETURNED → คืนสต็อก (current += qty) */
export async function returnOrder(tenantId: string, orderId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const ord = await client.query(
      `UPDATE bms_orders SET status = 'RETURNED', returned_at = COALESCE(returned_at, now()), updated_at = now()
        WHERE tenant_id = $2 AND id = $1 AND status IN ('SHIPPED','COMPLETED')`,
      [orderId, tenantId]
    );
    if (ord.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      `UPDATE bms_inventory inv
          SET current_stock = current_stock + oi.qty, updated_at = now()
         FROM (
           -- view ไม่ใช่ตารางตรง ๆ (8.8) — สินค้าชุดถูกแทนด้วยส่วนประกอบแล้ว
           SELECT tenant_id, location_id, product_sku, size, SUM(qty)::integer AS qty
             FROM bms_order_stock_lines WHERE order_id = $1
            GROUP BY tenant_id, location_id, product_sku, size
         ) oi
        WHERE TRUE
          AND inv.tenant_id = oi.tenant_id
          AND inv.location_id = oi.location_id
          AND inv.product_sku = oi.product_sku
          AND inv.size = oi.size`,
      [orderId]
    );

    await recordOrderMovements(client, [orderId], "RETURN", "system");
    // คืนทั้งบิล = แต้มต้องกลับไปเป็นเหมือนก่อนบิลนี้ (7.96) — ดึงแต้มที่ได้คืน
    // และคืนแต้มที่ลูกค้าแลกไป · ไม่ทำ = ซื้อ→ได้แต้ม→คืนของ ได้แต้มฟรี และ
    // แต้มที่แลกไปหายไปเลยทั้งที่ของถูกคืนแล้ว
    // (POS ใช้ทาง processPosReturn ซึ่งคิดตามสัดส่วนเพราะคืนบางรายการได้)
    await releasePointsForOrdersInTx(client, tenantId, [orderId], "คืนสินค้าทั้งบิล");
    // เครดิตร้านที่จ่ายมากับบิลนี้ต้องกลับไปอยู่บนบัตร (8.9) — ไม่คืนคือลูกค้าเสียเงิน
    // ที่จ่ายด้วยบัตรไปเปล่า ๆ ทั้งที่ของกลับมาแล้ว
    await reverseCreditForOrderInTx(client, tenantId, orderId);
    await reopenRestockSubscriptionsForOrders({ orderIds: [orderId], client });

    await client.query("COMMIT");
    await markRestockSubscriptionsReadyForOrders([orderId]);
    void notifyOrderStatusEmail(tenantId, orderId, "returned");
    return true;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ยกเลิก order → คืน reserved_stock (atomic, tenant-scoped)
 * ทำได้เฉพาะก่อนจัดส่ง (PENDING/PAID/PACKING)
 */
export async function cancelOrderInTx(
  client: PoolClient,
  tenantId: string,
  orderId: string
): Promise<boolean> {
    const ord = await client.query(
      `UPDATE bms_orders SET status = 'CANCELLED', cancelled_at = COALESCE(cancelled_at, now()), updated_at = now()
        WHERE tenant_id = $2 AND id = $1 AND status IN ('PENDING','PAID','PACKING')`,
      [orderId, tenantId]
    );
    if (ord.rowCount === 0) return false;

    // คืน reserved ตามรายการใน order
    await client.query(
      `UPDATE bms_inventory inv
          SET reserved_stock = reserved_stock - oi.qty, updated_at = now()
         FROM (
           -- view ไม่ใช่ตารางตรง ๆ (8.8) — สินค้าชุดถูกแทนด้วยส่วนประกอบแล้ว
           SELECT tenant_id, location_id, product_sku, size, SUM(qty)::integer AS qty
             FROM bms_order_stock_lines WHERE order_id = $1
            GROUP BY tenant_id, location_id, product_sku, size
         ) oi
        WHERE TRUE
          AND inv.tenant_id = oi.tenant_id
          AND inv.location_id = oi.location_id
          AND inv.product_sku = oi.product_sku
          AND inv.size = oi.size`,
      [orderId]
    );

    await recordOrderMovements(client, [orderId], "RELEASE", "system");
    await releaseCouponForOrdersInTx(client, [orderId]);
    await releaseCustomerCouponReservationsInTx(client, [orderId]);
    // แต้มต้องกลับสู่สถานะก่อนบิลนี้: คืนแต้มที่แลกไป + ดึงแต้มที่ได้กลับ (7.96)
    await releasePointsForOrdersInTx(client, tenantId, [orderId]);
    // เครดิตร้าน (8.9) — บิลที่ถูกยกเลิกต้องไม่กินยอดบัตรของลูกค้าไป
    await reverseCreditForOrderInTx(client, tenantId, orderId);
    await reopenRestockSubscriptionsForOrders({ orderIds: [orderId], client });

    return true;
}

/** งานหลัง commit แยกไว้ให้ workflow ที่ยกเลิก order ใน transaction ใหญ่กว่าเรียกซ้ำได้ */
export async function afterOrderCancellationCommitted(tenantId: string, orderId: string): Promise<void> {
  await markRestockSubscriptionsReadyForOrders([orderId]);
  void notifyOrderStatusEmail(tenantId, orderId, "cancelled");
}

export async function cancelOrder(tenantId: string, orderId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const cancelled = await cancelOrderInTx(client, tenantId, orderId);
    if (!cancelled) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query("COMMIT");
    await afterOrderCancellationCommitted(tenantId, orderId);
    return true;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Auto-release — ยกเลิก order สถานะ PENDING ที่ค้างเกิน N นาที แล้วคืน reserved_stock
 * ใช้เรียกจาก cron / worker เป็นระยะ (กันลูกค้าจองแล้วไม่จ่าย ค้างสต็อก)
 * ทำทั้งหมดในทรานแซกชันเดียว + FOR UPDATE SKIP LOCKED กันชนกับ cron ที่รันซ้อน
 * หมายเหตุ: ปล่อยเฉพาะ PENDING (ยังไม่จ่าย) — PAID ขึ้นไปไม่แตะ
 */
export async function releaseExpiredOrders(
  minutes: number
): Promise<{ released: number; orderIds: string[] }> {
  const mins = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 30;
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const expired = await client.query<{ id: string }>(
      `SELECT id FROM bms_orders
        WHERE status = 'PENDING'
          AND created_at < now() - make_interval(mins => $1)
        FOR UPDATE SKIP LOCKED`,
      [mins]
    );
    const ids = expired.rows.map((r) => r.id);
    if (ids.length === 0) {
      await client.query("COMMIT");
      return { released: 0, orderIds: [] };
    }

    // คืน reserved_stock ของทุก order ที่หมดอายุ
    await client.query(
      `UPDATE bms_inventory inv
          SET reserved_stock = reserved_stock - oi.qty, updated_at = now()
         FROM (
           SELECT tenant_id, location_id, product_sku, size, SUM(qty)::integer AS qty
             FROM bms_order_items WHERE order_id = ANY($1::uuid[])
            GROUP BY tenant_id, location_id, product_sku, size
         ) oi
        WHERE TRUE
          AND inv.tenant_id = oi.tenant_id
          AND inv.location_id = oi.location_id
          AND inv.product_sku = oi.product_sku
          AND inv.size = oi.size`,
      [ids]
    );

    await recordOrderMovements(client, ids, "RELEASE", "system:auto-release");
    await releaseCouponForOrdersInTx(client, ids);
    await releaseCustomerCouponReservationsInTx(client, ids);
    await reopenRestockSubscriptionsForOrders({ orderIds: ids, client });

    await client.query(
      `UPDATE bms_orders SET status = 'CANCELLED', cancelled_at = COALESCE(cancelled_at, now()), updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids]
    );

    await client.query("COMMIT");
    await markRestockSubscriptionsReadyForOrders(ids);
    return { released: ids.length, orderIds: ids };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// =============================================================
// Order Journey — เส้นทางออเดอร์ (ต้นทางแชท + stepper + timeline ละเอียด)
// -------------------------------------------------------------
// ไม่มีตาราง log ใหม่: ใช้ bms_audit_log เดิม (order.pay/pack/ship/complete/
// cancel/return) + order.created_at + conversation ต้นทาง (join 1:1 ด้วย
// tenant+channel+customer_ref) + bms_shipments · resolve ชื่อ actor จาก email
// =============================================================

type OrderStep = { status: string; at: string | null; actorName: string | null; reached: boolean; branch: boolean };
type OrderEvent = { kind: string; at: string; text: string; actorName: string | null };
type StaffRefRow = { id: string; name: string | null; avatar: string | null; email: string | null } | null;

export type OrderJourney = {
  orderId: string; channel: string; status: string;
  conversationId: string | null;
  assignedStaff: StaffRefRow;
  helpers: NonNullable<StaffRefRow>[];
  steps: OrderStep[];
  events: OrderEvent[];
  // ยอดคืนสะสม/คงเหลือสุทธิ — คำนวณจาก bms_pos_returns เดียวกับ events ด้านบน
  // ไม่ใช่ค่าใหม่: บิลที่คืนบางส่วนแล้วสถานะยังเป็น COMPLETED (ไม่เปลี่ยนเป็น RETURNED)
  // ทำให้การ์ดสรุปเดิมโชว์ "ยอดชำระสุทธิ" เท่ายอดขายเต็ม เหมือนไม่มีอะไรถูกคืนเลย
  returnedTotal: number;
  remainingAfterReturn: number;
  pendingSettlementTotal: number;
};

const MAIN_FLOW = ["PENDING", "PAID", "PACKING", "SHIPPED", "COMPLETED"] as const;
/**
 * ขายหน้าร้านไม่มีขั้นแพ็คและส่ง — ลูกค้าถือของออกจากร้านไปแล้วตอนจ่ายเงิน
 * ถ้าใช้ MAIN_FLOW ร่วมกัน PACKING/SHIPPED จะค้างเป็น "ยังไม่ถึง" ตลอดไป
 * อ่านเหมือนมีงานคงค้างทั้งที่บิลปิดแล้ว
 */
const POS_FLOW = ["PENDING", "PAID", "COMPLETED"] as const;
const ACTION_TO_STATUS: Record<string, string> = {
  "order.create": "PENDING", "order.reorder": "PENDING",
  "order.pay": "PAID", "order.pack": "PACKING", "order.ship": "SHIPPED", "order.complete": "COMPLETED",
  "order.cancel": "CANCELLED", "order.return": "RETURNED",
};
const STEP_LABEL: Record<string, string> = {
  PENDING: "สร้างออเดอร์ (รอชำระ)", PAID: "ชำระเงินแล้ว", PACKING: "แพ็คสินค้า",
  SHIPPED: "จัดส่งแล้ว", COMPLETED: "ปิดออเดอร์", CANCELLED: "ยกเลิก", RETURNED: "รับคืนสินค้า",
};
// ป้ายวิธีคืนเงิน — ชุดเดียวกับ posPaymentMethodLabel() ฝั่ง POS (app/(pos)/pos/page.tsx)
// คนละไฟล์เพราะฝั่งนั้นเป็น client component แต่ต้องอ่านออกเหมือนกันทุกที่ที่โชว์วิธีชำระ
const POS_REFUND_METHOD_LABEL: Record<string, string> = {
  CASH: "เงินสด", QR: "QR", CARD: "บัตร", WALLET: "วอลเล็ท",
  BANK_TRANSFER: "โอนเงิน", TIKTOK: "TikTok", CREDIT: "ขายเชื่อ", STORE_CREDIT: "เครดิตร้าน",
};

const jIso = (d: any) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));

export async function getOrderJourney(tenantId: string, orderId: string): Promise<OrderJourney | null> {
  const o = await query<{
    channel: string; customer_ref: string | null; status: string; created_at: any; updated_at: any;
    cashier_name: string | null; total_amount: string; shipping_fee: string;
  }>(
    `SELECT o.channel, o.customer_ref, o.status, o.created_at, o.updated_at,
            o.total_amount, o.shipping_fee,
            u.name AS cashier_name
       FROM bms_orders o
       LEFT JOIN users u ON u.id = o.cashier_user_id AND u.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1 AND o.id = $2`,
    [tenantId, orderId]
  );
  if (o.rowCount === 0) return null;
  const ord = o.rows[0];
  const isPos = ord.channel === "pos";

  // POS ไม่เขียน audit order.pay (เขียน pos.sale แทน) จึงต้องอ่านการชำระเงินจาก
  // bms_payments ตรง ๆ ไม่งั้น stepper บอกว่า "ยังไม่ชำระ" ทั้งที่เก็บเงินไปแล้ว
  // และ timeline ก็ไม่มีบรรทัดไหนบอกว่ารับเงินมาเท่าไหร่
  const posPayment = isPos
    ? (await query<{ method: string; amount: string; created_at: any }>(
        `SELECT method, amount, created_at
           FROM bms_payments
          WHERE tenant_id = $1 AND order_id = $2 AND status IN ('CONFIRMED', 'REFUNDED')
          ORDER BY created_at, id
          LIMIT 1`,
        [tenantId, orderId]
      )).rows[0] ?? null
    : null;

  // คืนสินค้า/ยกเลิกบิลที่เคาน์เตอร์ (7.91/7.97) เขียน audit เป็น pos.return/pos.void
  // ไม่ใช่ order.% เลย จึงไม่เคยผ่านตัวกรองข้างล่างนี้ — บิลที่คืนไปแล้วดูเหมือนไม่มี
  // อะไรเกิดขึ้นเลยในหน้านี้ ทั้งที่ POS มีประวัติเต็ม (BillHistoryPanel) อ่านจาก
  // bms_pos_returns ตรง ๆ แทนการ parse audit meta — ตารางเดียวกับที่ฝั่ง POS ใช้
  // จึงได้เหตุผล/ผู้อนุมัติ/ใบลดหนี้ครบเหมือนกัน ไม่ใช่แค่สรุปยอด
  const posReturnRows = isPos
    ? (await query<{
        id: string; return_mode: string; is_void: boolean; refund_amount: string;
        settlement_status: string;
        note: string | null; created_at: any;
        returned_by_name: string | null; approved_by_name: string | null;
        credit_note_no: string | null;
      }>(
        `SELECT pr.id, pr.return_mode, pr.is_void, pr.refund_amount, pr.settlement_status, pr.note, pr.created_at,
                COALESCE(returned_user.name, returned_user.email) AS returned_by_name,
                COALESCE(approved_user.name, approved_user.email) AS approved_by_name,
                credit.doc_no AS credit_note_no
           FROM bms_pos_returns pr
           LEFT JOIN users returned_user
             ON returned_user.tenant_id = pr.tenant_id AND returned_user.id = pr.returned_by
           LEFT JOIN users approved_user
             ON approved_user.tenant_id = pr.tenant_id AND approved_user.id = pr.approved_by
           LEFT JOIN LATERAL (
             SELECT doc_no FROM bms_tax_documents
              WHERE tenant_id = pr.tenant_id AND order_id = pr.order_id
                AND doc_type = 'CREDIT_NOTE' AND cancelled_at IS NULL
                AND credit_reason LIKE '%[' || pr.id::text || ']%'
              ORDER BY issued_at DESC, id DESC LIMIT 1
           ) credit ON TRUE
          WHERE pr.tenant_id = $1 AND pr.order_id = $2
          ORDER BY pr.created_at, pr.id`,
        [tenantId, orderId]
      )).rows
    : [];

  // ยืนยันคืนเงินจริงของช่องทางที่เดินเรื่องแยก (โอน/บัตร) เกิดทีหลัง pos.return ได้
  // เป็นคนละเวลา ไม่ใช่บรรทัดเดียวกัน — ไม่งั้นดูเหมือนเงินยังไม่คืนทั้งที่ยืนยันแล้ว
  const posRefundSettleRows = posReturnRows.length > 0
    ? (await query<{
        method: string; amount: string; external_ref: string | null; completed_at: any;
        completed_by_name: string | null;
      }>(
        `SELECT a.method, a.amount, a.external_ref, a.completed_at,
                COALESCE(u.name, u.email) AS completed_by_name
           FROM bms_pos_refund_allocations a
           JOIN bms_pos_returns pr ON pr.tenant_id = a.tenant_id AND pr.id = a.pos_return_id
           LEFT JOIN users u ON u.tenant_id = a.tenant_id AND u.id = a.completed_by
          WHERE a.tenant_id = $1 AND pr.order_id = $2 AND a.status = 'COMPLETED'
          ORDER BY a.completed_at, a.id`,
        [tenantId, orderId]
      )).rows
    : [];

  // audit เกี่ยวกับ order นี้ (target = orderId) — resolve ชื่อ actor จาก email
  const auditRows = (await query<{ actor: string | null; action: string; created_at: any }>(
    `SELECT actor, action, created_at FROM bms_audit_log
      WHERE tenant_id = $1 AND target = $2 AND action LIKE 'order.%'
      ORDER BY created_at, id`,
    [tenantId, orderId]
  )).rows;

  const emails = new Set<string>();
  auditRows.forEach((r) => { if (r.actor && !r.actor.startsWith("system:") && r.actor.includes("@")) emails.add(r.actor); });
  const nameByEmail = new Map<string, string>();
  if (emails.size) {
    const u = await query<{ email: string; name: string | null }>(
      `SELECT email, name FROM users WHERE email = ANY($1::text[])`, [[...emails]]
    );
    u.rows.forEach((x) => nameByEmail.set(x.email, x.name || x.email));
  }
  const actorName = (a: string | null) => (!a ? null : a.startsWith("system:") ? "ระบบ" : (nameByEmail.get(a) ?? a));

  // audit ล่าสุดต่อ status (กันกดซ้ำ)
  const lastByStatus = new Map<string, { at: string; actorName: string | null }>();
  for (const r of auditRows) {
    const st = ACTION_TO_STATUS[r.action];
    if (st) lastByStatus.set(st, { at: jIso(r.created_at)!, actorName: actorName(r.actor) });
  }

  // ---- steps (เส้นหลัก + กิ่ง cancel/return) ----
  const steps: OrderStep[] = (isPos ? POS_FLOW : MAIN_FLOW).map((st) => {
    const hit = lastByStatus.get(st);
    if (st === "PENDING") return { status: st, at: jIso(ord.created_at), actorName: hit?.actorName ?? "ระบบ", reached: true, branch: false };
    // ขายหน้าร้าน: การรับเงินยืนยันด้วยแถว payment ไม่ใช่ audit
    if (isPos && st === "PAID" && posPayment) {
      return {
        status: st,
        at: jIso(posPayment.created_at),
        actorName: ord.cashier_name ?? "ระบบ",
        reached: true,
        branch: false,
      };
    }
    // COMPLETED อาจมาจาก auto (จัดส่งถึง / ปิดบิลที่เครื่องขาย) ที่ไม่ได้ audit → fallback updated_at
    if (!hit && st === "COMPLETED" && ord.status === "COMPLETED") {
      return {
        status: st,
        at: jIso(ord.updated_at),
        actorName: isPos ? (ord.cashier_name ?? "ระบบ") : "ระบบ",
        reached: true,
        branch: false,
      };
    }
    return { status: st, at: hit?.at ?? null, actorName: hit?.actorName ?? null, reached: !!hit, branch: false };
  });
  for (const b of ["CANCELLED", "RETURNED"]) {
    const hit = lastByStatus.get(b);
    if (hit) steps.push({ status: b, at: hit.at, actorName: hit.actorName, reached: true, branch: true });
  }

  // ---- source conversation (join 1:1) + staff + helpers ----
  let conversationId: string | null = null;
  let assignedStaff: StaffRefRow = null;
  let helpers: NonNullable<StaffRefRow>[] = [];
  let convStart: string | null = null;
  const sysEvents: { kind: string; at: string; actorName: string; targetName: string | null }[] = [];
  if (ord.customer_ref) {
    const conv = (await query<{ id: string; created_at: any; assigned_to_user_id: string | null; an: string | null; av: string | null; ae: string | null }>(
      `SELECT c.id, c.created_at, c.assigned_to_user_id,
              u.name AS an, u.avatar AS av, u.email AS ae
         FROM bms_conversations c
         LEFT JOIN users u ON u.id = c.assigned_to_user_id
        WHERE c.tenant_id = $1 AND c.channel = $2 AND c.customer_ref = $3
        LIMIT 1`,
      [tenantId, ord.channel, ord.customer_ref]
    )).rows[0];
    if (conv) {
      conversationId = conv.id;
      convStart = jIso(conv.created_at);
      if (conv.assigned_to_user_id) assignedStaff = { id: conv.assigned_to_user_id, name: conv.an, avatar: conv.av, email: conv.ae };
      const hs = await listConversationHelpers(tenantId, conv.id);
      helpers = hs.map((h: any) => ({ id: h.id, name: h.name ?? null, avatar: h.avatar ?? null, email: h.email ?? null }));
      const se = await listSystemEvents(tenantId, conv.id);
      se.filter((e) => e.kind === "assign" || e.kind === "helper_add" || e.kind === "helper_remove")
        .forEach((e) => sysEvents.push({ kind: e.kind, at: e.at, actorName: e.actorName, targetName: e.targetName }));
    }
  }

  // ---- shipment (tracking) ----
  const shipRows = await listShipments(tenantId, { orderId });

  // ---- รวม timeline ละเอียด ----
  const events: OrderEvent[] = [];
  if (convStart) events.push({ kind: "chat_start", at: convStart, text: `ลูกค้าทักผ่าน ${ord.channel} · เริ่มบทสนทนา`, actorName: null });
  events.push({
    kind: "order_status",
    at: jIso(ord.created_at)!,
    text: isPos ? "เปิดบิลที่เครื่องขาย → PENDING" : "สร้างออเดอร์ → PENDING",
    actorName: lastByStatus.get("PENDING")?.actorName ?? (isPos ? (ord.cashier_name ?? "ระบบ") : "ระบบ"),
  });
  // เงินที่รับมาต้องอยู่ใน timeline — ก่อนหน้านี้บิล POS ที่เก็บเงินแล้วมีแค่บรรทัด
  // "สร้างออเดอร์" บรรทัดเดียว คนที่เปิดดูเพื่อตรวจยอดจะไม่เห็นว่ารับเงินไปเท่าไหร่
  if (posPayment) {
    const amount = Number(posPayment.amount).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    events.push({
      kind: "payment",
      at: jIso(posPayment.created_at)!,
      text: `รับชำระ ${posPayment.method} ฿${amount} → PAID`,
      actorName: ord.cashier_name ?? "ระบบ",
    });
  }
  for (const e of sysEvents) {
    const text = e.kind === "assign" ? `มอบหมายแชทให้ ${e.targetName}`
      : e.kind === "helper_add" ? `เพิ่ม ${e.targetName} เป็นผู้ช่วยตอบ`
      : `ถอด ${e.targetName} ออกจากผู้ช่วยตอบ`;
    events.push({ kind: e.kind, at: e.at, text, actorName: e.actorName });
  }
  for (const r of auditRows) {
    if (r.action === "order.create" || r.action === "order.reorder") continue; // แทนด้วย event "สร้างออเดอร์ → PENDING" ด้านบนแล้ว (กันซ้ำ)
    const st = ACTION_TO_STATUS[r.action];
    if (st) events.push({ kind: "order_status", at: jIso(r.created_at)!, text: `${STEP_LABEL[st]} → ${st}`, actorName: actorName(r.actor) });
  }
  for (const s of shipRows as any[]) {
    const track = s.tracking_no ? ` · เลขพัสดุ ${s.tracking_no}` : "";
    events.push({ kind: "shipment", at: jIso(s.created_at)!, text: `สร้างพัสดุ ${s.carrier}${track}`, actorName: null });
  }
  // คืนสินค้า/ยกเลิกบิลที่เคาน์เตอร์ — เดิมไม่โผล่ในหน้านี้เลยเพราะ audit action เป็น
  // pos.return/pos.void ไม่ใช่ order.% (ดูคอมเมนต์ตอนดึง posReturnRows ด้านบน)
  for (const r of posReturnRows) {
    const amount = Number(r.refund_amount).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const reasonText = r.note ? ` · เหตุผล: ${r.note}` : "";
    const creditText = r.credit_note_no ? ` · ใบลดหนี้ ${r.credit_note_no}` : "";
    const actor = r.approved_by_name && r.approved_by_name !== r.returned_by_name
      ? `${r.returned_by_name ?? "ไม่พบข้อมูล"} · อนุมัติโดย ${r.approved_by_name}`
      : (r.returned_by_name ?? "ไม่พบข้อมูล");
    const title = r.is_void
      ? "ยกเลิกบิล"
      : r.return_mode === "FULL" ? "คืนสินค้าทั้งบิล" : "คืนสินค้าบางรายการ";
    events.push({
      kind: r.is_void ? "pos_void" : "pos_return",
      at: jIso(r.created_at)!,
      text: `${title} · คืนเงิน ฿${amount}${reasonText}${creditText}`,
      actorName: actor,
    });
  }
  // ยืนยันคืนเงินจริงของช่องทางที่เดินเรื่องแยก (โอน/บัตร) — เกิดทีหลัง pos.return ได้
  // เป็นคนละเวลา ไม่รวมเป็นบรรทัดเดียวกัน ไม่งั้นดูเหมือนเงินยังไม่คืนทั้งที่ยืนยันแล้ว
  for (const s of posRefundSettleRows) {
    if (!s.completed_at) continue;
    const amount = Number(s.amount).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const method = POS_REFUND_METHOD_LABEL[s.method] ?? s.method;
    const refText = s.external_ref ? ` (อ้างอิง ${s.external_ref})` : "";
    events.push({
      kind: "pos_refund_settle",
      at: jIso(s.completed_at)!,
      text: `ยืนยันคืนเงินจริง ${method} ฿${amount}${refText}`,
      actorName: s.completed_by_name ?? "ไม่พบข้อมูล",
    });
  }
  // ปิดบิลหน้าร้านก็ไม่มี audit order.complete — ถ้าไม่เติมที่นี่ stepper จะติ๊ก COMPLETED
  // แต่ timeline ไม่มีบรรทัดปิดบิล อ่านแล้วขัดกันเอง
  if (isPos && ord.status === "COMPLETED" && !lastByStatus.get("COMPLETED")) {
    events.push({
      kind: "order_status",
      at: jIso(ord.updated_at)!,
      text: "ปิดบิลที่เครื่องขาย → COMPLETED",
      actorName: ord.cashier_name ?? "ระบบ",
    });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  // ยอดคืนสะสม/คงเหลือสุทธิ — ตัวเลขเดียวกับที่ getReceiptRefundSummary() ฝั่ง POS คิด
  // (sum ยอดคืนของทุก pos_return แล้ว clamp คงเหลือไม่ให้ติดลบ) แต่คำนวณที่นี่แทน
  // เพราะหน้า Order ไม่มี state ของ POS ให้เรียกใช้ร่วม
  const orderAmountDue = Number(ord.total_amount ?? 0) + Number(ord.shipping_fee ?? 0);
  const returnedTotal = Math.round(
    posReturnRows.reduce((sum, r) => sum + Number(r.refund_amount ?? 0), 0) * 100
  ) / 100;
  const pendingSettlementTotal = Math.round(
    posReturnRows
      .filter((r) => r.settlement_status === "PENDING")
      .reduce((sum, r) => sum + Number(r.refund_amount ?? 0), 0) * 100
  ) / 100;
  const remainingAfterReturn = Math.max(0, Math.round((orderAmountDue - returnedTotal) * 100) / 100);

  return {
    orderId, channel: ord.channel, status: ord.status, conversationId, assignedStaff, helpers, steps, events,
    returnedTotal, remainingAfterReturn, pendingSettlementTotal,
  };
}
