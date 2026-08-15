// =============================================================
// BMS POS — ขายหน้าร้าน (channel = "pos")
// -------------------------------------------------------------
// POS ไม่ใช่ระบบใหม่ — เป็นช่องทางที่ 8 ที่เรียก business logic ตัวเดิม
// ห้ามไฟล์นี้ INSERT/UPDATE bms_orders / bms_inventory เองนอกจากขั้นตอน
// "จ่ายของออกจากร้าน" ที่ไม่มีที่อื่นทำ (ดู fulfilPosOrderInTx)
//
// สิ่งที่ต่างจากขายออนไลน์:
//   • ของออกจากร้านทันที → PENDING → PAID → COMPLETED ไม่ผ่าน PACKING/SHIPPED
//     และไม่แตะ bms_shipments เลย
//   • ตัดสต็อกทันทีที่จ่ายเงินเสร็จ ไม่ใช่ตอนแพ็ค
//   • เลือก lot แบบ FEFO และห้ามจ่าย lot ที่หมดอายุ (7.85)
//   • ยิงบาร์โค้ดได้ทั้งแผงและกล่อง — คนละบาร์โค้ด คนละราคา (7.86)
//
// สิ่งที่ **ไม่** ต่าง: กฎการขายยาทั้งหมด evaluatePharmacySale() ยังเป็น
// ประตูเดียวและตัดสินเหมือนทุกช่องทาง หน้าเคาน์เตอร์ไม่มีทางลัด
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { createOrder, cancelOrder, type OrderItemInput } from "./orders";
import { confirmPayment, submitPayment, type PaymentMethod } from "./payments";
import { recordOrderMovements } from "./movements";
import { assertPharmacyPolicyReadyToOpenShift } from "./pharmacy/policyReadiness";

export const POS_CHANNEL = "pos" as const;

// ---------------------------------------------------------------
// ยิงบาร์โค้ด → สินค้า + หน่วยขาย
// ---------------------------------------------------------------

export type PosScanHit = {
  sku: string;
  productName: string;
  /** ชื่อสั้นสำหรับพิมพ์ใบเสร็จ (ยังไม่มีคอลัมน์แยก — ใช้ชื่อเต็มไปก่อน) */
  receiptName: string;
  size: string;
  packCode: string;
  unitName: string;
  /** 1 pack = กี่หน่วยฐาน */
  baseQty: number;
  /** ราคาต่อ 1 pack */
  packPrice: number;
  /** ราคาต่อหน่วยฐานตาม bms_products (ไว้เทียบให้เห็นส่วนลดยกกล่อง) */
  basePrice: number;
};

/**
 * หาสินค้าจากบาร์โค้ด/QR ที่ยิงมา — ดูที่ bms_product_packs ก่อน (7.86)
 * แล้วค่อย fallback ไป bms_products.barcode ของเดิม
 *
 * ยังไม่ได้ลบ bms_products.barcode ทิ้งเพราะ products.ts ใช้ค้นหาอยู่ —
 * ตราบใดที่ยังมี 2 ที่ ต้องอ่านทั้งคู่ ไม่งั้นสินค้าที่เพิ่มก่อน 7.86 จะยิงไม่เจอ
 */
export async function resolvePosScan(
  tenantId: string,
  code: string,
  opts: { size?: string | null } = {}
): Promise<PosScanHit | null> {
  const barcode = code.trim();
  if (!barcode) return null;
  const size = opts.size?.trim().toUpperCase() || null;

  const res = await query<{
    sku: string;
    name: string;
    base_price: string;
    pack_code: string | null;
    unit_name: string | null;
    base_qty: number | null;
    pack_price: string | null;
    size: string | null;
  }>(
    `SELECT p.sku,
            p.name,
            p.price                                  AS base_price,
            k.pack_code,
            k.unit_name,
            k.base_qty,
            k.price                                  AS pack_price,
            COALESCE($3::text, (
              SELECT i.size FROM bms_inventory i
               WHERE i.tenant_id = p.tenant_id AND i.product_sku = p.sku
               ORDER BY (i.current_stock - i.reserved_stock) DESC, i.size
               LIMIT 1
            ))                                       AS size
       FROM bms_products p
       LEFT JOIN bms_product_packs k
         ON k.tenant_id = p.tenant_id AND k.product_sku = p.sku
        AND k.barcode = $2 AND k.active
      WHERE p.tenant_id = $1
        AND p.active
        AND (k.barcode = $2 OR p.barcode = $2)
      ORDER BY (k.barcode IS NOT NULL) DESC
      LIMIT 1`,
    [tenantId, barcode, size]
  );

  const row = res.rows[0];
  if (!row || !row.size) return null;

  const basePrice = Number(row.base_price);
  const baseQty = row.base_qty ?? 1;
  // pack ไม่ตั้งราคาไว้ → ราคาต่อ pack = ราคาต่อหน่วยฐาน × base_qty (ไม่มีส่วนลดยกกล่อง)
  const packPrice = row.pack_price != null ? Number(row.pack_price) : basePrice * baseQty;

  return {
    sku: row.sku,
    productName: row.name,
    receiptName: row.name,
    size: row.size,
    packCode: row.pack_code ?? "BASE",
    unitName: row.unit_name ?? "ชิ้น",
    baseQty,
    packPrice,
    basePrice,
  };
}

// ---------------------------------------------------------------
// กะ / ลิ้นชักเงินสด
// ---------------------------------------------------------------

export type PosShift = {
  id: string;
  locationId: string;
  deviceId: string;
  status: "OPEN" | "CLOSED";
  openedBy: string;
  openedAt: string;
  openingFloat: number;
  pharmacistUserId: string | null;
  closedAt: string | null;
  expectedCash: number | null;
  countedCash: number | null;
  cashVariance: number | null;
};

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapShift(r: any): PosShift {
  return {
    id: r.id,
    locationId: r.location_id,
    deviceId: r.device_id,
    status: r.status,
    openedBy: r.opened_by,
    openedAt: toISO(r.opened_at),
    openingFloat: Number(r.opening_float),
    pharmacistUserId: r.pharmacist_user_id ?? null,
    closedAt: r.closed_at ? toISO(r.closed_at) : null,
    expectedCash: r.expected_cash == null ? null : Number(r.expected_cash),
    countedCash: r.counted_cash == null ? null : Number(r.counted_cash),
    cashVariance: r.cash_variance == null ? null : Number(r.cash_variance),
  };
}

export type OpenShiftResult =
  | { status: "OPENED"; shift: PosShift }
  | { status: "ALREADY_OPEN"; shift: PosShift }
  | { status: "DEVICE_NOT_FOUND" }
  | { status: "PHARMACIST_NOT_LICENSED" }
  | { status: "POLICY_NOT_READY"; reason: string };

/**
 * เปิดกะ = เปิดลิ้นชัก ไม่ใช่ "เข้าเวรของคนนี้" — พนักงานหลายคนขายในกะเดียวได้
 * ร้านยา: บล็อกไว้จนกว่าเภสัชกรจะรีวิว policy สินค้าครบทุกตัว (ตัวเลือก ก)
 * ไม่งั้นจะไปเจอ PHARMACY_POLICY_UNKNOWN ตอนมีลูกค้ายืนรออยู่หน้าเคาน์เตอร์
 */
export async function openPosShift(input: {
  tenantId: string;
  deviceId: string;
  openedBy: string;
  openingFloat?: number;
  pharmacistUserId?: string | null;
}): Promise<OpenShiftResult> {
  const { tenantId, deviceId } = input;

  const device = await query<{ location_id: string }>(
    `SELECT location_id FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2 AND active`,
    [tenantId, deviceId]
  );
  if (!device.rowCount) return { status: "DEVICE_NOT_FOUND" };

  const existing = await query(
    `SELECT * FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2 AND status = 'OPEN'`,
    [tenantId, deviceId]
  );
  if (existing.rowCount) return { status: "ALREADY_OPEN", shift: mapShift(existing.rows[0]) };

  // ใบอนุญาตเป็นข้อเท็จจริงของคน ไม่ใช่ permission — เช็คแบบเดียวกับ approveAssessment()
  if (input.pharmacistUserId) {
    const licensed = await query<{ ok: boolean }>(
      `SELECT public.bms_is_licensed_pharmacist($1, $2) AS ok`,
      [tenantId, input.pharmacistUserId]
    );
    if (licensed.rows[0]?.ok !== true) return { status: "PHARMACIST_NOT_LICENSED" };
  }

  try {
    await assertPharmacyPolicyReadyToOpenShift(tenantId);
  } catch (e: any) {
    return { status: "POLICY_NOT_READY", reason: String(e?.message ?? e) };
  }

  const res = await query(
    `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float, pharmacist_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, device.rows[0].location_id, deviceId, input.openedBy,
      Math.max(0, Number(input.openingFloat ?? 0)), input.pharmacistUserId ?? null]
  );
  return { status: "OPENED", shift: mapShift(res.rows[0]) };
}

export async function getOpenPosShift(tenantId: string, deviceId: string): Promise<PosShift | null> {
  const res = await query(
    `SELECT * FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2 AND status = 'OPEN'`,
    [tenantId, deviceId]
  );
  return res.rowCount ? mapShift(res.rows[0]) : null;
}

/**
 * ปิดกะ: เงินที่ควรมี = เงินตั้งต้น + เงินสดที่รับในกะนี้
 * (amount ของ payment คือยอดบิล ไม่ใช่เงินที่ยื่นมา → เงินทอนหักไปแล้วในตัว)
 * ส่วนต่างคำนวณโดยฐานข้อมูล (generated column) ไม่ให้แอปคิดเอง
 */
export async function closePosShift(input: {
  tenantId: string;
  shiftId: string;
  closedBy: string;
  countedCash: number;
  note?: string | null;
}): Promise<{ status: "CLOSED"; shift: PosShift } | { status: "NOT_OPEN" }> {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId);

    const open = await client.query<{ id: string; opening_float: string }>(
      `SELECT id, opening_float FROM bms_pos_shifts
        WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN' FOR UPDATE`,
      [input.tenantId, input.shiftId]
    );
    if (!open.rowCount) {
      await client.query("ROLLBACK");
      return { status: "NOT_OPEN" };
    }

    const cash = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(pay.amount), 0) AS total
         FROM bms_payments pay
         JOIN bms_orders o ON o.id = pay.order_id
        WHERE o.tenant_id = $1 AND o.pos_shift_id = $2
          AND pay.method = 'CASH' AND pay.status = 'CONFIRMED'`,
      [input.tenantId, input.shiftId]
    );
    const expected = Number(open.rows[0].opening_float) + Number(cash.rows[0].total);

    const res = await client.query(
      `UPDATE bms_pos_shifts
          SET status = 'CLOSED', closed_by = $3, closed_at = now(),
              expected_cash = $4, counted_cash = $5, note = $6, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'
        RETURNING *`,
      [input.tenantId, input.shiftId, input.closedBy, expected,
        Math.max(0, Number(input.countedCash)), input.note ?? null]
    );

    await client.query("COMMIT");
    return { status: "CLOSED", shift: mapShift(res.rows[0]) };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// ขาย 1 บิล
// ---------------------------------------------------------------

export type PosSaleLine = {
  sku: string;
  size: string;
  /** จำนวน "หน่วยขาย" ที่ลูกค้าซื้อ เช่น 1 กล่อง (ไม่ใช่หน่วยฐาน) */
  packQty: number;
  packCode?: string | null;
  unitName?: string | null;
  baseQty?: number | null;
  packPrice?: number | null;
};

export type PosSaleInput = {
  tenantId: string;
  shiftId: string;
  cashierUserId: string;
  /** สร้างที่เครื่อง: {device}-{shift}-{seq} — ยิงซ้ำต้องได้บิลเดิม ไม่ใช่บิลใหม่ */
  idempotencyKey: string;
  lines: PosSaleLine[];
  method: PaymentMethod;
  /** เงินที่ลูกค้ายื่นมา (เงินสดเท่านั้น) */
  cashTendered?: number | null;
  /** เลขอนุมัติจากเครื่องรูดบัตร / txn id ของ e-wallet */
  paymentRef?: string | null;
  couponCode?: string | null;
  discountApprovedBy?: string | null;
  discountReason?: string | null;
  pharmacyApprovedAssessmentId?: string | null;
};

export type PosSaleResult =
  | {
      status: "SOLD";
      orderId: string;
      total: number;
      cashTendered: number | null;
      cashChange: number | null;
      /** true = คีย์นี้เคยขายไปแล้ว คืนบิลเดิม ไม่ได้ขายซ้ำ */
      replayed: boolean;
    }
  | { status: "SHIFT_NOT_OPEN" }
  | { status: "EMPTY" }
  | { status: "LOT_EXPIRED_OR_SHORT"; sku: string; size: string; sellable: number; requested: number }
  | { status: "PAYMENT_FAILED"; reason: string }
  /** ทุกสถานะปฏิเสธจาก createOrder ส่งต่อตามเดิม รวมกฎการขายยา */
  | { status: string; [k: string]: unknown };

/**
 * lot ที่ยังขายได้ = ยังไม่หมดอายุ ณ วันนี้
 * SKU ที่ยังไม่เคยบันทึก lot เลย (ยังไม่ backfill) → ปล่อยผ่าน ไม่บล็อกการขาย
 * แต่ถ้ามี lot แล้วและของที่ไม่หมดอายุไม่พอ → ปฏิเสธ ไม่ใช่ขายของหมดอายุออกไป
 */
async function checkSellableLots(
  tenantId: string,
  locationId: string,
  lines: Array<{ sku: string; size: string; qty: number }>
): Promise<{ ok: true } | { ok: false; sku: string; size: string; sellable: number; requested: number }> {
  for (const ln of lines) {
    const res = await query<{ lots: string; sellable: string }>(
      `SELECT count(*) AS lots,
              COALESCE(SUM(qty) FILTER (WHERE expiry_date IS NULL OR expiry_date >= CURRENT_DATE), 0) AS sellable
         FROM bms_inventory_lots
        WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
      [tenantId, locationId, ln.sku, ln.size]
    );
    if (Number(res.rows[0]?.lots ?? 0) === 0) continue;
    const sellable = Number(res.rows[0]?.sellable ?? 0);
    if (sellable < ln.qty) {
      return { ok: false, sku: ln.sku, size: ln.size, sellable, requested: ln.qty };
    }
  }
  return { ok: true };
}

/**
 * ของออกจากร้านแล้ว: PAID → COMPLETED + ตัด current/reserved + จอง lot แบบ FEFO
 * ไม่ผ่าน PACKING/SHIPPED และไม่สร้าง shipment — หน้าร้านไม่มีอะไรให้ส่ง
 */
async function fulfilPosOrderInTx(client: PoolClient, tenantId: string, orderId: string): Promise<void> {
  const ord = await client.query(
    `UPDATE bms_orders SET status = 'COMPLETED', updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'PAID'`,
    [tenantId, orderId]
  );
  if (ord.rowCount === 0) throw new Error("บิลไม่ได้อยู่สถานะ PAID — ตัดสต็อกไม่ได้");

  await client.query(
    `UPDATE bms_inventory inv
        SET current_stock  = current_stock  - oi.qty,
            reserved_stock = reserved_stock - oi.qty,
            updated_at = now()
       FROM bms_order_items oi
      WHERE oi.order_id = $1
        AND inv.tenant_id = oi.tenant_id
        AND inv.location_id = oi.location_id
        AND inv.product_sku = oi.product_sku
        AND inv.size = oi.size`,
    [orderId]
  );

  // FEFO: หมดอายุใกล้สุดก่อน ข้าม lot ที่หมดอายุแล้ว
  // ตัดได้เท่าที่มี lot บันทึกไว้ — SKU ที่ยังไม่ backfill lot จะไม่มีแถวผูก
  // (ตรวจส่วนที่ยังไม่ผูกได้จาก query invariant ท้าย 7.85)
  const items = await client.query<{ id: string; location_id: string; product_sku: string; size: string; qty: number }>(
    `SELECT id, location_id, product_sku, size, qty FROM bms_order_items WHERE order_id = $1`,
    [orderId]
  );
  for (const it of items.rows) {
    let remaining = it.qty;
    const lots = await client.query<{ id: string; qty: number }>(
      `SELECT id, qty FROM bms_inventory_lots
        WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4
          AND qty > 0 AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        ORDER BY expiry_date NULLS LAST, received_at
        FOR UPDATE`,
      [tenantId, it.location_id, it.product_sku, it.size]
    );
    for (const lot of lots.rows) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.qty);
      await client.query(
        `UPDATE bms_inventory_lots SET qty = qty - $2, updated_at = now() WHERE id = $1`,
        [lot.id, take]
      );
      await client.query(
        `INSERT INTO bms_order_item_lots (tenant_id, order_item_id, lot_id, qty)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (order_item_id, lot_id) DO UPDATE SET qty = bms_order_item_lots.qty + EXCLUDED.qty`,
        [tenantId, it.id, lot.id, take]
      );
      remaining -= take;
    }
  }

  // ledger ใช้ SHIP เหมือนขายออนไลน์ = "ของออกจากร้านตามบิลนี้"
  // ไม่เพิ่มชนิดใหม่เพราะทุกรายงานที่นับยอดจ่ายออกต้องแก้ตาม — แยกหน้าร้าน/ออนไลน์
  // ด้วย bms_orders.channel = 'pos' แทน
  await recordOrderMovements(client, [orderId], "SHIP", "pos");
}

export async function recordPosSale(input: PosSaleInput): Promise<PosSaleResult> {
  const { tenantId } = input;

  const shiftRes = await query<{ id: string; location_id: string; device_id: string }>(
    `SELECT id, location_id, device_id FROM bms_pos_shifts
      WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'`,
    [tenantId, input.shiftId]
  );
  if (!shiftRes.rowCount) return { status: "SHIFT_NOT_OPEN" };
  const shift = shiftRes.rows[0];

  // ยิงซ้ำเพราะ response หายกลางทาง → คืนบิลเดิม ห้ามขายซ้ำ
  const replay = await findSaleByIdempotencyKey(tenantId, input.idempotencyKey);
  if (replay) return replay;

  const items: OrderItemInput[] = input.lines
    .filter((ln) => ln.sku && ln.size && Number.isInteger(ln.packQty) && ln.packQty > 0)
    .map((ln) => {
      const baseQty = ln.baseQty && ln.baseQty > 0 ? ln.baseQty : 1;
      return {
        sku: ln.sku,
        size: ln.size,
        qty: ln.packQty * baseQty, // สต็อกนับเป็นหน่วยฐานเสมอ
        packCode: ln.packCode ?? null,
        packUnitName: ln.unitName ?? null,
        packQty: ln.packQty,
        packUnitPrice: ln.packPrice ?? null,
      };
    });
  if (items.length === 0) return { status: "EMPTY" };

  const lotCheck = await checkSellableLots(
    tenantId,
    shift.location_id,
    items.map((it) => ({ sku: it.sku, size: it.size, qty: it.qty }))
  );
  if (!lotCheck.ok) {
    return {
      status: "LOT_EXPIRED_OR_SHORT",
      sku: lotCheck.sku,
      size: lotCheck.size,
      sellable: lotCheck.sellable,
      requested: lotCheck.requested,
    };
  }

  // ประตูกฎการขายยา + จองสต็อก อยู่ใน createOrder ทั้งคู่ — POS ไม่ทำเอง
  const created = await createOrder({
    tenantId,
    channel: POS_CHANNEL,
    items,
    locationId: shift.location_id,
    posDeviceId: shift.device_id,
    posShiftId: shift.id,
    cashierUserId: input.cashierUserId,
    idempotencyKey: input.idempotencyKey,
    editorId: input.cashierUserId,
    couponCode: input.couponCode ?? null,
    discountApprovedBy: input.discountApprovedBy ?? null,
    discountReason: input.discountReason ?? null,
    pharmacyApprovedAssessmentId: input.pharmacyApprovedAssessmentId ?? null,
  }).catch(async (err: any) => {
    // ชนคีย์กันบิลซ้ำ = อีกคำขอสร้างบิลเดียวกันไปแล้ว (23505 = unique_violation)
    if (err?.code === "23505") return null;
    throw err;
  });

  if (created === null) {
    const again = await findSaleByIdempotencyKey(tenantId, input.idempotencyKey);
    if (again) return again;
    return { status: "PAYMENT_FAILED", reason: "บิลซ้ำแต่หาบิลเดิมไม่เจอ" };
  }
  if (created.status !== "CREATED") return created as PosSaleResult;

  const orderId = created.orderId;
  const amountDue = created.amountDue;

  // จ่ายเงิน — เวอร์ชันนี้รับ 1 วิธีต่อบิล (confirmPayment เทียบยอดเต็มบิล)
  // จ่ายสด+โอนผสมกันต้องรอ split payment ในเฟสถัดไป
  try {
    const submitted = await submitPayment({
      tenantId,
      orderId,
      method: input.method,
      amount: amountDue,
      slipRef: input.paymentRef ?? null,
      actor: input.cashierUserId,
    });
    if (submitted.status !== "SUBMITTED") {
      await cancelOrder(tenantId, orderId);
      return { status: "PAYMENT_FAILED", reason: submitted.status };
    }

    const confirmed = await confirmPayment(tenantId, submitted.paymentId, input.cashierUserId);
    if (confirmed.status !== "CONFIRMED") {
      await cancelOrder(tenantId, orderId);
      return { status: "PAYMENT_FAILED", reason: confirmed.status };
    }

    const tendered = input.method === "CASH" && input.cashTendered != null
      ? Math.max(0, Number(input.cashTendered))
      : null;
    const change = tendered != null ? Math.max(0, Math.round((tendered - amountDue) * 100) / 100) : null;
    if (tendered != null) {
      await query(
        `UPDATE bms_payments SET cash_tendered = $2, cash_change = $3, updated_at = now() WHERE id = $1`,
        [submitted.paymentId, tendered, change]
      );
    }

    const client = await getClient();
    try {
      await beginTenantTx(client, tenantId, { editorId: input.cashierUserId });
      await fulfilPosOrderInTx(client, tenantId, orderId);
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }

    return {
      status: "SOLD",
      orderId,
      total: amountDue,
      cashTendered: tendered,
      cashChange: change,
      replayed: false,
    };
  } catch (err: any) {
    // เงินรับไปแล้วแต่ตัดสต็อกไม่ผ่าน = บิลค้างที่ PAID ต้องให้คนมาเคลียร์
    // ห้าม cancel เงียบ ๆ เพราะเงินอยู่ในลิ้นชักแล้ว
    return { status: "PAYMENT_FAILED", reason: String(err?.message ?? err) };
  }
}

async function findSaleByIdempotencyKey(
  tenantId: string,
  key: string
): Promise<(PosSaleResult & { status: "SOLD" }) | null> {
  const res = await query<{
    id: string;
    total_amount: string;
    shipping_fee: string | null;
    cash_tendered: string | null;
    cash_change: string | null;
  }>(
    `SELECT o.id, o.total_amount, o.shipping_fee, pay.cash_tendered, pay.cash_change
       FROM bms_orders o
       LEFT JOIN bms_payments pay
         ON pay.order_id = o.id AND pay.status = 'CONFIRMED'
      WHERE o.tenant_id = $1 AND o.idempotency_key = $2
      LIMIT 1`,
    [tenantId, key]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    status: "SOLD",
    orderId: row.id,
    total: Number(row.total_amount) + Number(row.shipping_fee ?? 0),
    cashTendered: row.cash_tendered == null ? null : Number(row.cash_tendered),
    cashChange: row.cash_change == null ? null : Number(row.cash_change),
    replayed: true,
  };
}
