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

import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { createOrder, cancelOrder, type OrderItemInput } from "./orders";
import { type PaymentMethod } from "./payments";
import { recordMovement, recordOrderMovements } from "./movements";
import { assertPharmacyPolicyReadyToOpenShift } from "./pharmacy/policyReadiness";
import {
  cashRoundingDelta,
  getVatSettings,
  issueAbbreviatedInvoiceInTx,
  issueCreditNote,
  type TenantVatSettings,
} from "./taxDocuments";
import { redeemCustomerCouponForOrderInTx } from "./coupons";
import { markRestockSubscriptionsPurchasedForOrder } from "./restockSubscriptions";
import {
  earnPointsForOrderInTx,
  listOrderDiscounts,
  reversePointsForReturnInTx,
  reviewMemberTier,
  type OrderDiscountLine,
} from "./membership";

export const POS_CHANNEL = "pos" as const;

// ---------------------------------------------------------------
// เครื่องขาย + token ประจำเครื่อง
// ---------------------------------------------------------------

export type PosDevice = {
  id: string;
  tenantId: string;
  locationId: string;
  code: string;
  name: string | null;
  registeredPosNo: string | null;
  receiptPrefix: string | null;
  active: boolean;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * ออก token ให้เครื่อง — เก็บเฉพาะ hash ค่าจริงคืนครั้งเดียวตอนนี้เท่านั้น
 * ออกใหม่ = ตัวเก่าใช้ไม่ได้ทันที (ใช้ตอนเครื่องหาย)
 */
export async function issuePosDeviceToken(
  tenantId: string,
  deviceId: string
): Promise<{ token: string } | null> {
  const token = `pos_${crypto.randomBytes(32).toString("base64url")}`;
  const res = await query(
    `UPDATE bms_pos_devices
        SET token_hash = $3, token_issued_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, deviceId, hashToken(token)]
  );
  return res.rowCount ? { token } : null;
}

/**
 * ตรวจ token ที่เครื่องส่งมา — เทียบด้วย hash เท่านั้น ไม่มีที่ไหนเก็บค่าจริง
 * ไม่ผูกกับ session ของคน เพราะเครื่องหน้าร้านเปิดค้างทั้งวัน
 * สิทธิ์ของ "คน" ยังต้องเช็คแยกจาก cashierUserId/PIN อีกชั้น
 */
export async function authenticatePosDevice(token: string): Promise<PosDevice | null> {
  const raw = token.trim();
  if (!raw) return null;
  const res = await query<any>(
    `SELECT id, tenant_id, location_id, code, name, registered_pos_no, receipt_prefix, active
       FROM bms_pos_devices
      WHERE token_hash = $1 AND active`,
    [hashToken(raw)]
  );
  const r = res.rows[0];
  if (!r) return null;
  void query(
    `UPDATE bms_pos_devices SET last_seen_at = now() WHERE tenant_id = $1 AND id = $2`,
    [r.tenant_id, r.id]
  ).catch(() => {});
  return {
    id: r.id,
    tenantId: r.tenant_id,
    locationId: r.location_id,
    code: r.code,
    name: r.name ?? null,
    registeredPosNo: r.registered_pos_no ?? null,
    receiptPrefix: r.receipt_prefix ?? null,
    active: r.active,
  };
}

export async function listPosDevices(tenantId: string): Promise<PosDevice[]> {
  const res = await query<any>(
    `SELECT id, tenant_id, location_id, code, name, registered_pos_no, receipt_prefix, active
       FROM bms_pos_devices WHERE tenant_id = $1 ORDER BY code`,
    [tenantId]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    tenantId: r.tenant_id,
    locationId: r.location_id,
    code: r.code,
    name: r.name ?? null,
    registeredPosNo: r.registered_pos_no ?? null,
    receiptPrefix: r.receipt_prefix ?? null,
    active: r.active,
  }));
}

export type PosOperationalReadiness = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  activeLocations: number;
  activeDevices: number;
  pairedDevices: number;
  cashiersWithPin: number;
  cashiersReady: number;
  sellableProducts: number;
  stockedVariants: number;
  openShifts: number;
  pendingRefundCount: number;
  pendingRefundAmount: number;
};

/** ข้อเท็จจริงที่ตรวจจากฐานข้อมูลได้ก่อนเปิดเคาน์เตอร์ — ไม่แทน rehearsal/hardware checklist */
export async function getPosOperationalReadiness(tenantId: string): Promise<PosOperationalReadiness> {
  const [core, products, cashiers, refunds, vat] = await Promise.all([
    query<any>(
      `SELECT
         (SELECT COUNT(*) FROM bms_locations WHERE tenant_id = $1 AND active) AS active_locations,
         (SELECT COUNT(*) FROM bms_pos_devices WHERE tenant_id = $1 AND active) AS active_devices,
         (SELECT COUNT(*) FROM bms_pos_devices WHERE tenant_id = $1 AND active AND token_hash IS NOT NULL) AS paired_devices,
         (SELECT COUNT(*) FROM bms_pos_shifts WHERE tenant_id = $1 AND status = 'OPEN') AS open_shifts`
      , [tenantId]
    ),
    query<any>(
      `SELECT
         (SELECT COUNT(*) FROM bms_products WHERE tenant_id = $1 AND active) AS sellable_products,
         (SELECT COUNT(*)
            FROM bms_inventory i
           WHERE i.tenant_id = $1
             AND i.current_stock - i.reserved_stock > 0
             AND EXISTS (
               SELECT 1 FROM bms_pos_devices d
                WHERE d.tenant_id = i.tenant_id AND d.location_id = i.location_id AND d.active
             )) AS stocked_variants,
         (SELECT COUNT(*) FROM bms_products
           WHERE tenant_id = $1 AND active AND vat_category = 'UNKNOWN') AS unknown_vat_products`
      , [tenantId]
    ),
    query<any>(
      `SELECT
         COUNT(*) FILTER (WHERE u.pos_pin_hash IS NOT NULL) AS cashiers_with_pin,
         COUNT(*) FILTER (
           WHERE u.pos_pin_hash IS NOT NULL
             AND (r.name = 'Administrator' OR EXISTS (
               SELECT 1 FROM bms_role_permissions rp
                WHERE rp.tenant_id = $1 AND rp.role_id = u.role_id AND rp.permission = 'pos.sell'
             ))
         ) AS cashiers_ready
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1`,
      [tenantId]
    ),
    query<any>(
      `SELECT COUNT(*) AS pending_count, COALESCE(SUM(amount), 0) AS pending_amount
         FROM bms_pos_refund_allocations
        WHERE tenant_id = $1 AND status = 'PENDING'`,
      [tenantId]
    ),
    getVatSettings(tenantId),
  ]);
  const row = core.rows[0] ?? {};
  const productRow = products.rows[0] ?? {};
  const cashierRow = cashiers.rows[0] ?? {};
  const refundRow = refunds.rows[0] ?? {};
  const result: PosOperationalReadiness = {
    ready: false,
    blockers: [],
    warnings: [],
    activeLocations: Number(row.active_locations ?? 0),
    activeDevices: Number(row.active_devices ?? 0),
    pairedDevices: Number(row.paired_devices ?? 0),
    cashiersWithPin: Number(cashierRow.cashiers_with_pin ?? 0),
    cashiersReady: Number(cashierRow.cashiers_ready ?? 0),
    sellableProducts: Number(productRow.sellable_products ?? 0),
    stockedVariants: Number(productRow.stocked_variants ?? 0),
    openShifts: Number(row.open_shifts ?? 0),
    pendingRefundCount: Number(refundRow.pending_count ?? 0),
    pendingRefundAmount: Number(refundRow.pending_amount ?? 0),
  };
  if (result.activeLocations === 0) result.blockers.push("ยังไม่มีสาขาที่เปิดใช้งาน");
  if (result.activeDevices === 0) result.blockers.push("ยังไม่มีเครื่อง POS ที่เปิดใช้งาน");
  if (result.pairedDevices === 0) result.blockers.push("ยังไม่มีเครื่อง POS ที่ออก token และจับคู่แล้ว");
  if (result.cashiersReady === 0) result.blockers.push("ยังไม่มีพนักงานที่มี PIN และสิทธิ์ pos.sell");
  if (result.sellableProducts === 0) result.blockers.push("ยังไม่มีสินค้าที่เปิดขาย");
  if (result.stockedVariants === 0) result.blockers.push("ยังไม่มีสต็อกพร้อมขายในสาขาที่ผูกเครื่อง POS");
  if (result.pendingRefundCount > 0) {
    result.blockers.push(`มีรายการคืนเงินจริงค้าง ${result.pendingRefundCount} รายการ รวม ${result.pendingRefundAmount.toFixed(2)} บาท`);
  }
  if (vat.vatRegistered && Number(productRow.unknown_vat_products ?? 0) > 0) {
    result.blockers.push(`สินค้าที่เปิดขายยังไม่ระบุประเภท VAT ${Number(productRow.unknown_vat_products)} รายการ`);
  }
  if (result.pairedDevices < result.activeDevices) {
    result.warnings.push(`มีเครื่องที่เปิดใช้งานแต่ยังไม่จับคู่ ${result.activeDevices - result.pairedDevices} เครื่อง`);
  }
  if (result.openShifts > 0) result.warnings.push(`มีกะเปิดค้างอยู่ ${result.openShifts} กะ`);
  if (vat.vatRegistered && !vat.abbreviatedApproved) {
    result.warnings.push("ร้านจด VAT แต่ยังไม่ได้บันทึกการอนุมัติใช้ใบกำกับภาษีอย่างย่อ");
  }
  result.ready = result.blockers.length === 0;
  return result;
}

export async function upsertPosDevice(
  tenantId: string,
  input: {
    id?: string | null;
    locationId: string;
    code: string;
    name?: string | null;
    registeredPosNo?: string | null;
    receiptPrefix?: string | null;
    active?: boolean;
  }
): Promise<PosDevice> {
  const res = await query<any>(
    `INSERT INTO bms_pos_devices (id, tenant_id, location_id, code, name, registered_pos_no, receipt_prefix, active)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE))
     ON CONFLICT (tenant_id, code)
     DO UPDATE SET location_id = EXCLUDED.location_id,
                   name = EXCLUDED.name,
                   registered_pos_no = EXCLUDED.registered_pos_no,
                   receipt_prefix = EXCLUDED.receipt_prefix,
                   active = EXCLUDED.active,
                   updated_at = now()
     RETURNING id, tenant_id, location_id, code, name, registered_pos_no, receipt_prefix, active`,
    [input.id ?? null, tenantId, input.locationId, input.code.trim(), input.name ?? null,
      input.registeredPosNo ?? null, input.receiptPrefix ?? null, input.active ?? null]
  );
  const r = res.rows[0];
  return {
    id: r.id, tenantId: r.tenant_id, locationId: r.location_id, code: r.code,
    name: r.name ?? null, registeredPosNo: r.registered_pos_no ?? null,
    receiptPrefix: r.receipt_prefix ?? null, active: r.active,
  };
}

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
 *
 * รับ SKU ตรง ๆ ด้วย: บาร์โค้ดขาด/ลอก/สินค้ายังไม่ติดบาร์โค้ด เป็นเรื่องปกติหน้าร้าน
 * ถ้าพิมพ์รหัสสินค้าแล้วหาไม่เจอ พนักงานจะไม่มีทางขายของชิ้นนั้นเลย
 */
export async function resolvePosScan(
  tenantId: string,
  code: string,
  opts: { size?: string | null; locationId?: string | null } = {}
): Promise<PosScanHit | null> {
  const barcode = code.trim();
  if (!barcode) return null;
  // ห้าม toUpperCase() — ไซซ์จริงมีตัวพิมพ์เล็ก ("150 ml", "60 ml") การแปลงเป็น
  // "150 ML" ทำให้เทียบกับ bms_inventory ไม่ตรงแล้วขายสินค้านั้นไม่ได้เลย
  // (เทียบแบบไม่สนตัวพิมพ์แทน แล้วคืนค่าไซซ์ตามที่เก็บไว้จริง)
  const size = opts.size?.trim() || null;

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
            COALESCE(
              -- 1. ผู้เรียกระบุไซซ์มาเอง (กดเลือกจากผลค้นหา)
              (SELECT i.size FROM bms_inventory i
                WHERE i.tenant_id = p.tenant_id AND i.product_sku = p.sku
                  AND upper(i.size) = upper($3::text)
                LIMIT 1),
              -- 2. บาร์โค้ดที่ยิงมาเป็นของหน่วยขายที่ผูกไซซ์ไว้แล้ว (7.93)
              --    นี่คือทางปกติของระบบค้าปลีก: 1 บาร์โค้ด = 1 หน่วยขาย
              k.size,
              -- 3. ตกมาถึงนี่คือบาร์โค้ดเก่าที่ยังผูกกับสินค้าไม่ใช่หน่วยขาย
              --    เลือกไซซ์แรกตามตัวอักษร — ต้องนิ่ง ห้ามขึ้นกับสต็อก ไม่งั้น
              --    ยิงขวดเดิมวันนี้กับพรุ่งนี้ได้คนละขนาด
              (SELECT min(i.size) FROM bms_inventory i
                WHERE i.tenant_id = p.tenant_id AND i.product_sku = p.sku
                  AND ($4::uuid IS NULL OR i.location_id = $4))
            )                                        AS size
       FROM bms_products p
       LEFT JOIN bms_product_packs k
         ON k.tenant_id = p.tenant_id AND k.product_sku = p.sku
        AND k.barcode = $2 AND k.active
      WHERE p.tenant_id = $1
        AND p.active
        AND (k.barcode = $2 OR p.barcode = $2 OR upper(p.sku) = upper($2))
      ORDER BY (k.barcode IS NOT NULL) DESC, (p.barcode = $2) DESC
      LIMIT 1`,
    [tenantId, barcode, size, opts.locationId ?? null]
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

export type PosCashier = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  isPharmacist: boolean;
  /** false = ยังตั้ง PIN ไม่ได้ → ขายไม่ได้ (ตั้งจากหลังบ้าน) */
  hasPin: boolean;
  /** true = บัญชีนี้เข้าหลังบ้านไม่ได้ ใช้ได้เฉพาะเครื่องขาย (7.92) */
  posOnly: boolean;
};

/**
 * รายชื่อพนักงานให้เครื่องเลือกตอนขาย — auth ด้วย device token ของร้านตัวเอง
 * แสดงเฉพาะคนที่มีสิทธิ์ `pos.sell` จริง (7.92) — เดิมแสดงผู้ใช้ทุกคนในร้าน
 * ทำให้คนทำบัญชี/แอดมินโผล่ใน dropdown ที่เคาน์เตอร์ทั้งที่ไม่เกี่ยวกับการขาย
 *
 * คนที่ยังไม่ตั้ง PIN ยังขึ้นในรายการแต่เลือกไม่ได้ — จอแสดงให้เห็นว่าต้องไป
 * ตั้ง PIN จากหลังบ้านก่อน ดีกว่าหายไปเฉย ๆ แล้วไม่รู้ว่าทำไม
 */
export async function listPosCashiers(tenantId: string): Promise<PosCashier[]> {
  const res = await query<any>(
    `SELECT u.id, u.name, u.email, u.is_licensed_pharmacist, u.pos_only,
            r.name AS role_name,
            (u.pos_pin_hash IS NOT NULL) AS has_pin
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1
        AND (
          r.name = 'Administrator'
          OR EXISTS (
            SELECT 1 FROM bms_role_permissions rp
             WHERE rp.tenant_id = $1 AND rp.role_id = u.role_id AND rp.permission = 'pos.sell'
          )
        )
      ORDER BY (u.pos_pin_hash IS NULL), u.name NULLS LAST, u.email`,
    [tenantId]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    name: r.name ?? null,
    email: r.email ?? null,
    role: r.role_name ?? null,
    isPharmacist: Boolean(r.is_licensed_pharmacist),
    hasPin: Boolean(r.has_pin),
    posOnly: Boolean(r.pos_only),
  }));
}

/**
 * ตั้งค่าบัญชีพนักงานหน้าร้าน (7.92)
 *
 * posOnly = TRUE ปิดทางเข้า /admin ให้บัญชีนั้นทันที (loginAdmin ปฏิเสธ
 * ตั้งแต่ก่อนตรวจสิทธิ์) — ใช้กับคนที่มีหน้าที่คิดเงินอย่างเดียว
 *
 * ห้ามตั้งกับตัวเอง และห้ามตั้งกับ Administrator — ทั้งสองกรณีคือการล็อก
 * คนออกจากหลังบ้านโดยที่อาจไม่มีใครเข้าไปแก้คืนได้
 */
export async function setCashierAccountMode(
  tenantId: string,
  userId: string,
  posOnly: boolean,
  actingUserId: string
): Promise<void> {
  if (posOnly && userId === actingUserId) {
    throw new Error("ตั้งบัญชีตัวเองเป็นเฉพาะหน้าร้านไม่ได้ — จะเข้าหลังบ้านไม่ได้อีก");
  }
  const target = await query<{ role_name: string | null }>(
    `SELECT r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND u.id = $2`,
    [tenantId, userId]
  );
  if (!target.rowCount) throw new Error("ไม่พบพนักงานคนนี้ในร้าน");
  if (posOnly && target.rows[0].role_name === "Administrator") {
    throw new Error("ตั้ง Administrator เป็นบัญชีเฉพาะหน้าร้านไม่ได้");
  }
  await query(`UPDATE users SET pos_only = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, userId, posOnly]);
}

/** พนักงานทุกคนในร้าน (ไม่กรองสิทธิ์) — สำหรับหน้าจัดการฝั่งแอดมิน */
export async function listTenantStaff(tenantId: string): Promise<PosCashier[]> {
  const res = await query<any>(
    `SELECT u.id, u.name, u.email, u.is_licensed_pharmacist, u.pos_only,
            r.name AS role_name,
            (u.pos_pin_hash IS NOT NULL) AS has_pin
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1
      ORDER BY r.name NULLS LAST, u.name NULLS LAST, u.email`,
    [tenantId]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    name: r.name ?? null,
    email: r.email ?? null,
    role: r.role_name ?? null,
    isPharmacist: Boolean(r.is_licensed_pharmacist),
    hasPin: Boolean(r.has_pin),
    posOnly: Boolean(r.pos_only),
  }));
}

// ---------------------------------------------------------------
// PIN พนักงานหน้าร้าน (7.90)
// ---------------------------------------------------------------

const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MINUTES = 15;

export type PinVerifyResult =
  | { ok: true; userId: string; name: string | null; isPharmacist: boolean }
  | { ok: false; reason: "NO_PIN" | "WRONG_PIN" | "LOCKED"; lockedUntil?: string };

/**
 * ตั้ง/เปลี่ยน PIN — เรียกจากหลังบ้านเท่านั้น (permission pos.pin.manage)
 * PIN สั้นโดยธรรมชาติ จึงจำกัดจำนวนครั้งที่กดผิดแทนการบังคับความยาว
 */
export async function setCashierPin(tenantId: string, userId: string, pin: string): Promise<void> {
  const clean = String(pin ?? "").trim();
  if (!/^[0-9]{4,8}$/.test(clean)) throw new Error("PIN ต้องเป็นตัวเลข 4–8 หลัก");
  const hash = await bcrypt.hash(clean, 10);
  const res = await query(
    `UPDATE users
        SET pos_pin_hash = $3, pos_pin_set_at = now(),
            pos_pin_failures = 0, pos_pin_locked_until = NULL
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId, hash]
  );
  if (!res.rowCount) throw new Error("ไม่พบพนักงานคนนี้ในร้าน");
}

export async function clearCashierPin(tenantId: string, userId: string): Promise<void> {
  await query(
    `UPDATE users SET pos_pin_hash = NULL, pos_pin_set_at = NULL,
                      pos_pin_failures = 0, pos_pin_locked_until = NULL
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId]
  );
}

/**
 * ตรวจ PIN ที่จอขายส่งมา
 * นับครั้งที่ผิดแล้วล็อกชั่วคราว — PIN 4 หลักเดาได้ใน 10,000 ครั้ง
 * ถ้าไม่จำกัดจำนวนครั้ง การมี PIN แทบไม่ต่างจากไม่มี
 */
export async function verifyCashierPin(
  tenantId: string,
  userId: string,
  pin: string
): Promise<PinVerifyResult> {
  const res = await query<any>(
    `SELECT id, name, pos_pin_hash, pos_pin_failures, pos_pin_locked_until, is_licensed_pharmacist
       FROM users WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId]
  );
  const u = res.rows[0];
  if (!u || !u.pos_pin_hash) return { ok: false, reason: "NO_PIN" };

  if (u.pos_pin_locked_until && new Date(u.pos_pin_locked_until) > new Date()) {
    return { ok: false, reason: "LOCKED", lockedUntil: new Date(u.pos_pin_locked_until).toISOString() };
  }

  const match = await bcrypt.compare(String(pin ?? ""), u.pos_pin_hash);
  if (!match) {
    const failures = Number(u.pos_pin_failures ?? 0) + 1;
    const lock = failures >= PIN_MAX_FAILURES;
    await query(
      `UPDATE users
          SET pos_pin_failures = $3,
              pos_pin_locked_until = CASE WHEN $4 THEN now() + ($5 || ' minutes')::interval ELSE pos_pin_locked_until END
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, userId, lock ? 0 : failures, lock, String(PIN_LOCK_MINUTES)]
    );
    return { ok: false, reason: lock ? "LOCKED" : "WRONG_PIN" };
  }

  if (Number(u.pos_pin_failures ?? 0) > 0) {
    await query(`UPDATE users SET pos_pin_failures = 0 WHERE tenant_id = $1 AND id = $2`, [tenantId, userId]);
  }
  return { ok: true, userId: u.id, name: u.name ?? null, isPharmacist: Boolean(u.is_licensed_pharmacist) };
}

export async function cashierHasPermission(
  tenantId: string,
  userId: string,
  permission: string
): Promise<boolean> {
  const res = await query<{ name: string | null; has_permission: boolean }>(
    `SELECT r.name,
            CASE
              WHEN r.name = 'Administrator' THEN TRUE
              ELSE EXISTS (
                SELECT 1
                  FROM bms_role_permissions rp
                 WHERE rp.tenant_id = $1
                   AND rp.role_id = u.role_id
                   AND rp.permission = $3
              )
            END AS has_permission
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND u.id = $2
      LIMIT 1`,
    [tenantId, userId, permission]
  );
  return Boolean(res.rows[0]?.has_permission);
}

async function cashierHasPermissionInTx(
  client: PoolClient,
  tenantId: string,
  userId: string,
  permission: string
): Promise<boolean> {
  const res = await client.query<{ has_permission: boolean }>(
    `SELECT CASE
              WHEN r.name = 'Administrator' THEN TRUE
              ELSE EXISTS (
                SELECT 1
                  FROM bms_role_permissions rp
                 WHERE rp.tenant_id = $1
                   AND rp.role_id = u.role_id
                   AND rp.permission = $3
              )
            END AS has_permission
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND u.id = $2
      LIMIT 1`,
    [tenantId, userId, permission]
  );
  return Boolean(res.rows[0]?.has_permission);
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

export async function getPosShiftReturnSummary(tenantId: string, deviceId: string, shiftId: string) {
  const res = await query<any>(
    `SELECT COUNT(DISTINCT pr.id)::int AS return_count,
            COALESCE(SUM(a.amount), 0) AS return_total,
            COALESCE(SUM(a.amount) FILTER (WHERE a.status = 'COMPLETED'), 0) AS settled_total,
            COALESCE(SUM(a.amount) FILTER (WHERE a.status = 'PENDING'), 0) AS pending_total,
            COUNT(a.id) FILTER (WHERE a.status = 'PENDING')::int AS pending_count
       FROM bms_orders o
       JOIN bms_pos_returns pr
         ON pr.tenant_id = o.tenant_id AND pr.order_id = o.id AND pr.pos_device_id = $2
       LEFT JOIN bms_pos_refund_allocations a
         ON a.tenant_id = pr.tenant_id AND a.pos_return_id = pr.id
      WHERE o.tenant_id = $1 AND o.pos_shift_id = $3 AND o.pos_device_id = $2`,
    [tenantId, deviceId, shiftId]
  );
  const row = res.rows[0] ?? {};
  return {
    returnCount: Number(row.return_count ?? 0),
    returnTotal: Number(row.return_total ?? 0),
    settledTotal: Number(row.settled_total ?? 0),
    pendingTotal: Number(row.pending_total ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
  };
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
}): Promise<
  | { status: "CLOSED"; shift: PosShift; partialReturnCashOut: number }
  | { status: "NOT_OPEN" }
  | { status: "PENDING_REFUNDS"; count: number; amount: number }
> {
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

    const pendingRefunds = await client.query<{ count: string; amount: string }>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(a.amount), 0)::text AS amount
         FROM bms_pos_refund_allocations a
         JOIN bms_pos_returns pr ON pr.id = a.pos_return_id AND pr.tenant_id = a.tenant_id
         JOIN bms_orders o ON o.id = pr.order_id AND o.tenant_id = pr.tenant_id
        WHERE a.tenant_id = $1 AND o.pos_shift_id = $2 AND a.status = 'PENDING'`,
      [input.tenantId, input.shiftId]
    );
    if (Number(pendingRefunds.rows[0]?.count ?? 0) > 0) {
      await client.query("ROLLBACK");
      return {
        status: "PENDING_REFUNDS",
        count: Number(pendingRefunds.rows[0].count),
        amount: Number(pendingRefunds.rows[0].amount),
      };
    }

    const cash = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(pay.amount), 0) AS total
         FROM bms_payments pay
         JOIN bms_orders o ON o.id = pay.order_id AND o.tenant_id = pay.tenant_id
        WHERE o.tenant_id = $1 AND o.pos_shift_id = $2
          AND pay.method = 'CASH' AND pay.status IN ('CONFIRMED','REFUNDED')`,
      [input.tenantId, input.shiftId]
    );
    const partialReturns = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(a.amount), 0) AS total
         FROM bms_pos_refund_allocations a
         JOIN bms_pos_returns pr ON pr.id = a.pos_return_id AND pr.tenant_id = a.tenant_id
         JOIN bms_orders o ON o.id = pr.order_id AND o.tenant_id = pr.tenant_id
        WHERE a.tenant_id = $1
          AND o.pos_shift_id = $2
          AND a.method = 'CASH'
          AND a.status = 'COMPLETED'`,
      [input.tenantId, input.shiftId]
    );
    const partialReturnCashOut = Number(partialReturns.rows[0]?.total ?? 0);
    const expected = Number(open.rows[0].opening_float) + Number(cash.rows[0].total) - partialReturnCashOut;

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
    return { status: "CLOSED", shift: mapShift(res.rows[0]), partialReturnCashOut };
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

export type PosPaymentInput = {
  method: PaymentMethod;
  amount: number;
  /** เงินที่ลูกค้ายื่นมา — เงินสดเท่านั้น ใช้คำนวณเงินทอน */
  cashTendered?: number | null;
  /** เลขอนุมัติจากเครื่องรูดบัตร / txn id ของ e-wallet */
  ref?: string | null;
};

export type PosSaleInput = {
  tenantId: string;
  deviceId: string;
  shiftId: string;
  cashierUserId: string;
  /** สร้างที่เครื่อง: {device}-{shift}-{seq} — ยิงซ้ำต้องได้บิลเดิม ไม่ใช่บิลใหม่ */
  idempotencyKey: string;
  lines: PosSaleLine[];
  /** จ่ายผสมได้ เช่น สด 500 + บัตร 300 — ผลรวมต้องเท่ายอดบิลพอดี */
  payments: PosPaymentInput[];
  couponCode?: string | null;
  /** สมาชิกที่พนักงานค้นเจอที่เคาน์เตอร์ — ได้ส่วนลดตามชั้นและสะสมแต้ม (7.96) */
  customerId?: string | null;
  /** แต้มที่ลูกค้าขอแลกเป็นส่วนลดบิลนี้ */
  pointsToRedeem?: number | null;
  discountApprovedBy?: string | null;
  discountReason?: string | null;
  pharmacyApprovedAssessmentId?: string | null;
};

/**
 * ตัวเลขภาษีที่ "ออกไปกับใบกำกับจริง" ไม่ใช่ค่าที่คำนวณใหม่ทีหลัง
 * จอขายเอาไปพิมพ์บนใบเสร็จได้ตรง ๆ — ห้ามให้ client คิด total × 7/107 เอง
 * เพราะบิลที่มีสินค้ายกเว้น VAT ปนจะได้ตัวเลขไม่ตรงกับเอกสารที่ยื่นสรรพากร
 */
export type PosReceiptVat = {
  rate: number;
  taxableAmount: number;
  exemptAmount: number;
  vatAmount: number;
  /** ฐานก่อน VAT ของทั้งบิล = taxable − vat + exempt */
  netBeforeVat: number;
  roundingAmount: number;
};

/** แถวจาก bms_tax_documents → ตัวเลขที่ใบเสร็จใช้ · null = บิลนี้ไม่มีใบกำกับ */
function mapReceiptVat(row: {
  vat_rate?: string | number | null;
  taxable_amount?: string | number | null;
  exempt_amount?: string | number | null;
  vat_amount?: string | number | null;
  rounding_amount?: string | number | null;
}): PosReceiptVat | null {
  if (row.vat_amount == null && row.taxable_amount == null) return null;
  const taxable = Number(row.taxable_amount ?? 0);
  const exempt = Number(row.exempt_amount ?? 0);
  const vat = Number(row.vat_amount ?? 0);
  return {
    rate: Number(row.vat_rate ?? 0),
    taxableAmount: taxable,
    exemptAmount: exempt,
    vatAmount: vat,
    netBeforeVat: Math.round((taxable - vat + exempt) * 100) / 100,
    roundingAmount: Number(row.rounding_amount ?? 0),
  };
}

export type PosSaleResult =
  | {
      status: "SOLD";
      orderId: string;
      total: number;
      cashTendered: number | null;
      cashChange: number | null;
      /** เลขใบกำกับภาษีอย่างย่อ — null เมื่อร้านยังไม่จด VAT */
      docNo: string | null;
      /** null เมื่อร้านยังไม่จด VAT (ไม่มีใบกำกับให้อ้าง) */
      vat: PosReceiptVat | null;
      /** ยอดปัดเศษเงินสดที่บวกเข้าไปแล้วใน total (0 = ไม่ได้ปัด) */
      roundingAmount: number;
      /** ส่วนลดแยกตามที่มา สำหรับพิมพ์บนใบเสร็จ (7.96) */
      discountLines: OrderDiscountLine[];
      /** แต้มที่ได้จากบิลนี้ · null = บิลนี้ไม่ผูกสมาชิก/ร้านปิดโปรแกรม */
      pointsEarned: number | null;
      /** แต้มคงเหลือของสมาชิกหลังบิลนี้ (พิมพ์บนใบเสร็จ) */
      pointsBalance: number | null;
      /** true = คีย์นี้เคยขายไปแล้ว คืนบิลเดิม ไม่ได้ขายซ้ำ */
      replayed: boolean;
    }
  | { status: "SHIFT_NOT_OPEN" }
  | { status: "EMPTY" }
  | { status: "LOT_EXPIRED_OR_SHORT"; sku: string; size: string; sellable: number; requested: number }
  | { status: "INVALID_PACK"; sku: string; packCode: string }
  | { status: "PAYMENT_FAILED"; reason: string }
  | { status: "PAYMENT_MISMATCH"; expected: number; received: number }
  /** ทุกสถานะปฏิเสธจาก createOrder ส่งต่อตามเดิม รวมกฎการขายยา */
  | { status: string; [k: string]: unknown };

export type PosRecentReceipt = {
  orderId: string;
  docNo: string | null;
  /** สมาชิกที่ผูกกับบิลนี้ (7.96) — null = บิลไม่ผูกสมาชิก · ใช้ตอนกด "เปลี่ยนสินค้า"
      เพื่อยกสมาชิกเดิมมาที่บิลใหม่ ไม่ให้พนักงานต้องค้นซ้ำแล้วลืม */
  memberNo: string | null;
  memberName: string | null;
  vat: PosReceiptVat | null;
  roundingAmount: number;
  orderStatus: string;
  total: number;
  cashTendered: number | null;
  cashChange: number | null;
  paymentMethod: PaymentMethod | null;
  paymentRef: string | null;
  soldAt: string;
  cashierName: string | null;
  payments: Array<{
    id: string;
    method: PaymentMethod;
    amount: number;
    ref: string | null;
    cashTendered: number | null;
    cashChange: number | null;
  }>;
  refunds: Array<PosRefundAllocation & {
    posReturnId: string;
    returnMode: "FULL" | "PARTIAL";
    returnNote: string | null;
    returnedAt: string;
  }>;
  lines: Array<{
    orderItemId: number;
    sku: string;
    receiptName: string;
    size: string;
    packCode: string;
    baseQty: number;
    packPrice: number;
    basePrice: number;
    packQty: number;
    returnedPackQty: number;
    refundablePackQty: number;
    unitName: string;
    lineTotal: number;
  }>;
};

/**
 * แปลง cart เป็น OrderItem จากข้อมูลปัจจุบันในฐานเท่านั้น ราคา/baseQty/unitName
 * ที่ browser ส่งมาเป็นข้อมูลแสดงผลและห้ามเป็น authority ของยอดหรือสต็อก
 */
async function canonicalizePosSaleLines(
  tenantId: string,
  locationId: string,
  lines: PosSaleLine[]
): Promise<
  | { ok: true; items: OrderItemInput[] }
  | { ok: false; sku: string; packCode: string }
> {
  const items: OrderItemInput[] = [];
  for (const line of lines) {
    const sku = String(line.sku ?? "").trim();
    // ดูเหตุผลที่ห้าม toUpperCase() ที่ resolvePosScan — ไซซ์ที่มีหน่วยตัวพิมพ์เล็ก
    // จะหาสต๊อกไม่เจอ แล้วขายไม่ได้ทั้งที่ของอยู่บนชั้น
    const size = String(line.size ?? "").trim();
    const packQty = Number(line.packQty);
    if (!sku || !size || !Number.isInteger(packQty) || packQty <= 0) continue;
    const packCode = String(line.packCode ?? "BASE").trim().toUpperCase() || "BASE";
    const res = await query<{
      base_price: string;
      pack_code: string | null;
      unit_name: string | null;
      base_qty: number | null;
      pack_price: string | null;
      stored_size: string | null;
    }>(
      `SELECT p.price AS base_price,
              k.pack_code,
              k.unit_name,
              k.base_qty,
              k.price AS pack_price,
              (SELECT i.size FROM bms_inventory i
                WHERE i.tenant_id = p.tenant_id AND i.location_id = $3
                  AND i.product_sku = p.sku AND upper(i.size) = upper($5)
                LIMIT 1) AS stored_size
         FROM bms_products p
         LEFT JOIN bms_product_packs k
           ON k.tenant_id = p.tenant_id
          AND k.product_sku = p.sku
          AND upper(k.pack_code) = $4
          AND k.active
          -- ผูกไซซ์ด้วย (7.93): pack ของ "10 เม็ด" กับ "100 เม็ด" คนละราคา
          -- pack เก่าที่ size เป็น NULL ยังใช้ได้กับทุกไซซ์
          AND (k.size IS NULL OR upper(k.size) = upper($5))
        WHERE p.tenant_id = $1
          AND p.sku = $2
          AND p.active
          AND EXISTS (
            SELECT 1 FROM bms_inventory i
             WHERE i.tenant_id = p.tenant_id
               AND i.location_id = $3
               AND i.product_sku = p.sku
               AND upper(i.size) = upper($5)
          )
        LIMIT 1`,
      [tenantId, sku, locationId, packCode, size]
    );
    const row = res.rows[0];
    if (!row || (packCode !== "BASE" && !row.pack_code)) {
      return { ok: false, sku, packCode };
    }
    const baseQty = row.base_qty ?? 1;
    const basePrice = Number(row.base_price);
    const packPrice = row.pack_price == null ? basePrice * baseQty : Number(row.pack_price);
    items.push({
      sku,
      // ใช้ไซซ์ตามที่เก็บใน bms_inventory ไม่ใช่ที่ client ส่งมา —
      // order item ต้องตรงกับแถวสต็อกเป๊ะ ไม่งั้น FK/การตัดสต็อกพลาด
      size: row.stored_size ?? size,
      qty: packQty * baseQty,
      packCode,
      packUnitName: row.unit_name ?? "ชิ้น",
      packQty,
      packUnitPrice: packPrice,
    });
  }
  return { ok: true, items };
}

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
async function fulfilPosOrderInTx(
  client: PoolClient,
  tenantId: string,
  orderId: string,
  taxArgs: { locationId: string; deviceId: string | null; issuedBy: string; settings: TenantVatSettings }
): Promise<{ docNo: string | null; vat: PosReceiptVat | null; vatIssue: string | null }> {
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
       FROM (
         SELECT tenant_id, location_id, product_sku, size, SUM(qty)::integer AS qty
           FROM bms_order_items WHERE tenant_id = $2 AND order_id = $1
          GROUP BY tenant_id, location_id, product_sku, size
       ) oi
      WHERE TRUE
        AND inv.tenant_id = oi.tenant_id
        AND inv.location_id = oi.location_id
        AND inv.product_sku = oi.product_sku
        AND inv.size = oi.size`,
    [orderId, tenantId]
  );

  // FEFO: หมดอายุใกล้สุดก่อน ข้าม lot ที่หมดอายุแล้ว
  // ตัดได้เท่าที่มี lot บันทึกไว้ — SKU ที่ยังไม่ backfill lot จะไม่มีแถวผูก
  // (ตรวจส่วนที่ยังไม่ผูกได้จาก query invariant ท้าย 7.85)
  const items = await client.query<{ id: string; location_id: string; product_sku: string; size: string; qty: number }>(
    `SELECT id, location_id, product_sku, size, qty
       FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, orderId]
  );
  for (const it of items.rows) {
    let remaining = it.qty;
    const tracked = await client.query(
      `SELECT 1 FROM bms_inventory_lots
        WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4
        LIMIT 1`,
      [tenantId, it.location_id, it.product_sku, it.size]
    );
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
        `UPDATE bms_inventory_lots SET qty = qty - $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, lot.id, take]
      );
      await client.query(
        `INSERT INTO bms_order_item_lots (tenant_id, order_item_id, lot_id, qty)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (order_item_id, lot_id) DO UPDATE SET qty = bms_order_item_lots.qty + EXCLUDED.qty`,
        [tenantId, it.id, lot.id, take]
      );
      remaining -= take;
    }
    if (tracked.rowCount && remaining > 0) {
      throw new Error(`lot ที่ขายได้ไม่พอสำหรับ ${it.product_sku}/${it.size} (ขาด ${remaining})`);
    }
  }

  // ledger ใช้ SHIP เหมือนขายออนไลน์ = "ของออกจากร้านตามบิลนี้"
  // ไม่เพิ่มชนิดใหม่เพราะทุกรายงานที่นับยอดจ่ายออกต้องแก้ตาม — แยกหน้าร้าน/ออนไลน์
  // ด้วย bms_orders.channel = 'pos' แทน
  await recordOrderMovements(client, [orderId], "SHIP", "pos");

  // ใบกำกับอย่างย่อออกในทรานแซกชันเดียวกับการปิดการขาย — บิลที่ตัดสต็อกแล้ว
  // แต่ไม่มีเลขเอกสารคือบิลที่อธิบายกับสรรพากรไม่ได้
  const issued = await issueAbbreviatedInvoiceInTx(client, {
    tenantId,
    orderId,
    locationId: taxArgs.locationId,
    deviceId: taxArgs.deviceId,
    issuedBy: taxArgs.issuedBy,
    settings: taxArgs.settings,
  });
  if (issued.status === "ISSUED" || issued.status === "ALREADY_ISSUED") {
    const doc = issued.document;
    return {
      docNo: doc.docNo,
      vat: {
        rate: doc.vatRate,
        taxableAmount: doc.taxableAmount,
        exemptAmount: doc.exemptAmount,
        vatAmount: doc.vatAmount,
        netBeforeVat: Math.round((doc.taxableAmount - doc.vatAmount + doc.exemptAmount) * 100) / 100,
        roundingAmount: doc.roundingAmount,
      },
      vatIssue: null,
    };
  }
  // ร้านที่ยังไม่จด VAT ขายได้ตามปกติ แค่ไม่มีใบกำกับ — ไม่ใช่ error
  if (issued.status === "NOT_VAT_REGISTERED") return { docNo: null, vat: null, vatIssue: null };
  // ร้านจด VAT แล้วแต่สินค้ายังไม่ระบุประเภทภาษี = ออกใบไม่ได้ ต้องหยุดทั้งบิล
  throw new Error(
    issued.status === "VAT_CATEGORY_MISSING"
      ? `ออกใบกำกับไม่ได้: ยังไม่ได้ระบุประเภท VAT ของ ${issued.skus.join(", ")}`
      : `ออกใบกำกับไม่ได้: ${issued.status}`
  );
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
  if (shift.device_id !== input.deviceId) return { status: "SHIFT_NOT_OPEN" };

  const key = input.idempotencyKey.trim();
  if (!key || key.length > 240) return { status: "PAYMENT_FAILED", reason: "idempotencyKey ไม่ถูกต้อง" };

  // ยิงซ้ำเพราะ response หายกลางทาง: COMPLETED คืนบิลเดิม ส่วน PENDING
  // เดิน settlement เดิมต่อได้โดยไม่สร้าง order/payment ซ้ำ
  const replay = await findSaleByIdempotencyKey(tenantId, input.deviceId, input.shiftId, key);
  if (replay) return replay;

  const requestedPayments = input.payments
    .map((payment) => ({
      ...payment,
      amount: Math.round(Number(payment.amount) * 100) / 100,
      cashTendered: payment.cashTendered == null ? null : Math.round(Number(payment.cashTendered) * 100) / 100,
      ref: payment.ref?.trim() || null,
    }))
    .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);
  if (requestedPayments.length === 0) return { status: "PAYMENT_FAILED", reason: "ต้องระบุการชำระเงิน" };
  const invalidCash = requestedPayments.find(
    (payment) => payment.method === "CASH" && payment.cashTendered != null
      && (!Number.isFinite(payment.cashTendered) || payment.cashTendered < payment.amount)
  );
  if (invalidCash) return { status: "PAYMENT_FAILED", reason: "เงินสดที่รับมาต้องไม่น้อยกว่ายอดเงินสด" };

  const existing = await findPosOrderByIdempotencyKey(tenantId, input.deviceId, input.shiftId, key);
  if (existing) {
    if (existing.status !== "PENDING" && existing.status !== "PAID") {
      return { status: "PAYMENT_FAILED", reason: `คีย์บิลนี้ถูกใช้กับสถานะ ${existing.status} แล้ว` };
    }
    const paid = Math.round(requestedPayments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
    if (Math.abs(paid - existing.amountDue) > 0.01) {
      return { status: "PAYMENT_MISMATCH", expected: existing.amountDue, received: paid };
    }
    return finalizePosSale({ input, shift, orderId: existing.orderId, amountDue: existing.amountDue, payments: requestedPayments, replayed: true });
  }

  const canonical = await canonicalizePosSaleLines(tenantId, shift.location_id, input.lines);
  if (!canonical.ok) return { status: "INVALID_PACK", sku: canonical.sku, packCode: canonical.packCode };
  const items = canonical.items;
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
    idempotencyKey: key,
    editorId: input.cashierUserId,
    couponCode: input.couponCode ?? null,
    customerId: input.customerId ?? null,
    pointsToRedeem: input.pointsToRedeem ?? null,
    discountApprovedBy: input.discountApprovedBy ?? null,
    discountReason: input.discountReason ?? null,
    pharmacyApprovedAssessmentId: input.pharmacyApprovedAssessmentId ?? null,
  }).catch(async (err: any) => {
    // ชนคีย์กันบิลซ้ำ = อีกคำขอสร้างบิลเดียวกันไปแล้ว (23505 = unique_violation)
    if (err?.code === "23505") return null;
    throw err;
  });

  if (created === null) {
    const again = await findSaleByIdempotencyKey(tenantId, input.deviceId, input.shiftId, key);
    if (again) return again;
    const pending = await findPosOrderByIdempotencyKey(tenantId, input.deviceId, input.shiftId, key);
    if (pending && ["PENDING", "PAID"].includes(pending.status)) {
      return finalizePosSale({ input, shift, orderId: pending.orderId, amountDue: pending.amountDue, payments: requestedPayments, replayed: true });
    }
    return { status: "PAYMENT_FAILED", reason: "คีย์บิลซ้ำแต่สถานะเดิมไม่สามารถทำต่อได้" };
  }
  if (created.status !== "CREATED") return created as PosSaleResult;

  const orderId = created.orderId;
  let amountDue = created.amountDue;

  // ปัดเศษเงินสด (7.95) — เฉพาะบิลที่จ่ายสดล้วน เพราะบัตร/QR รับเต็มจำนวนได้อยู่แล้ว
  // ยอดปัดเก็บแยกบนบิล ไม่ใช่ส่วนลด จึงไม่แตะฐาน VAT (ตรงกับบรรทัด
  // "ยอดเงินปัดเศษ" บนใบกำกับจริงที่ใช้อ้างอิง)
  const roundingSettings = await getVatSettings(tenantId);
  const cashOnly = input.payments.length > 0 && input.payments.every((p) => p.method === "CASH");
  let roundingApplied = 0;
  if (cashOnly && roundingSettings.cashRounding !== "NONE") {
    const delta = cashRoundingDelta(amountDue, roundingSettings.cashRounding);
    if (delta !== 0) {
      roundingApplied = delta;
      await query(`UPDATE bms_orders SET rounding_amount = $2, updated_at = now() WHERE tenant_id = $1 AND id = $3`,
        [tenantId, delta, orderId]);
      amountDue = Math.round((amountDue + delta) * 100) / 100;
    }
  }
  const paid = Math.round(requestedPayments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
  if (Math.abs(paid - amountDue) > 0.01) {
    await cancelOrder(tenantId, orderId);
    return { status: "PAYMENT_MISMATCH", expected: amountDue, received: paid };
  }
  const sold = await finalizePosSale({
    input, shift, orderId, amountDue, payments: requestedPayments, replayed: false,
  });

  // ทบทวนชั้นสมาชิกหลังบิลปิด (7.96) — นอกทรานแซกชันโดยตั้งใจ ล้มได้ไม่กระทบ
  // การขายที่เกิดขึ้นแล้ว · ถ้ารอ cron รายเดือน ลูกค้าที่ซื้อครบเกณฑ์วันนี้จะยัง
  // ไม่ได้ส่วนลดชั้นใหม่ในบิลถัดไป ซึ่งเป็นเรื่องที่พนักงานหน้าร้านต้องมาอธิบาย
  if (sold.status === "SOLD" && input.customerId) {
    void reviewMemberTier(input.tenantId, input.customerId).catch((e) =>
      console.error("[POS] ทบทวนชั้นสมาชิกหลังขายไม่สำเร็จ", input.customerId, e)
    );
  }

  return sold.status === "SOLD" ? { ...sold, roundingAmount: roundingApplied } : sold;
}

async function finalizePosSale(args: {
  input: PosSaleInput;
  shift: { id: string; location_id: string; device_id: string };
  orderId: string;
  amountDue: number;
  payments: PosPaymentInput[];
  replayed: boolean;
}): Promise<PosSaleResult> {
  const { input, shift, orderId, amountDue, payments, replayed } = args;
  const vatSettings = await getVatSettings(input.tenantId);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.cashierUserId });
    const shiftLock = await client.query(
      `SELECT 1 FROM bms_pos_shifts
        WHERE tenant_id = $1 AND id = $2 AND device_id = $3 AND status = 'OPEN'
        FOR UPDATE`,
      [input.tenantId, shift.id, input.deviceId]
    );
    if (!shiftLock.rowCount) throw new Error("กะถูกปิดแล้วก่อนบันทึกการขาย");

    const orderLock = await client.query<{ status: string; total_amount: string; shipping_fee: string | null }>(
      `SELECT status, total_amount, shipping_fee FROM bms_orders
        WHERE tenant_id = $1 AND id = $2 AND pos_shift_id = $3
          AND pos_device_id = $4 AND cashier_user_id = $5
        FOR UPDATE`,
      [input.tenantId, orderId, shift.id, input.deviceId, input.cashierUserId]
    );
    if (!orderLock.rowCount) throw new Error("บิลไม่ตรงกับเครื่อง กะ หรือพนักงานผู้ขาย");
    const current = orderLock.rows[0];
    const lockedDue = Number(current.total_amount) + Number(current.shipping_fee ?? 0);
    if (Math.abs(lockedDue - amountDue) > 0.01) throw new Error("ยอดบิลเปลี่ยนระหว่างรับชำระ");

    let cashTendered: number | null = null;
    let cashChange: number | null = null;
    if (current.status === "PENDING") {
      const active = await client.query(
        `SELECT 1 FROM bms_payments
          WHERE tenant_id = $1 AND order_id = $2 AND status IN ('PENDING','CONFIRMED')
          LIMIT 1 FOR UPDATE`,
        [input.tenantId, orderId]
      );
      if (active.rowCount) throw new Error("บิลค้างมีรายการชำระเงินเดิม ต้องตรวจสอบก่อนทำต่อ");

      for (const payment of payments) {
        const tendered = payment.method === "CASH"
          ? (payment.cashTendered == null ? payment.amount : Number(payment.cashTendered))
          : null;
        const change = tendered == null ? null : Math.round((tendered - payment.amount) * 100) / 100;
        await client.query(
          `INSERT INTO bms_payments
             (tenant_id, order_id, method, amount, status, slip_ref, verified_by,
              cash_tendered, cash_change, updated_at)
           VALUES ($1, $2, $3, $4, 'CONFIRMED', $5, $6, $7, $8, now())`,
          [input.tenantId, orderId, payment.method, payment.amount, payment.ref ?? null,
            input.cashierUserId, tendered, change]
        );
        if (tendered != null) {
          cashTendered = (cashTendered ?? 0) + tendered;
          cashChange = (cashChange ?? 0) + Number(change ?? 0);
        }
      }

      const paidOrder = await client.query(
        `UPDATE bms_orders SET status = 'PAID', updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
        [input.tenantId, orderId]
      );
      if (!paidOrder.rowCount) throw new Error("บิลไม่ได้อยู่สถานะรอชำระ");
      await redeemCustomerCouponForOrderInTx(client, input.tenantId, orderId);
      // แต้มสะสม (7.96) — ให้หลังบิลเป็น PAID เท่านั้น และอยู่ใน tx เดียวกับเงิน
      // UNIQUE (tenant_id, order_id, 'EARN') กันแต้มซ้ำเมื่อเครื่องยิงคีย์เดิมซ้ำ
      await earnPointsForOrderInTx(client, {
        tenantId: input.tenantId,
        orderId,
        actorUserId: input.cashierUserId,
      });
      await markRestockSubscriptionsPurchasedForOrder({ tenantId: input.tenantId, orderId, client });
    } else if (current.status === "PAID") {
      const cash = await client.query<{ tendered: string; change: string }>(
        `SELECT COALESCE(SUM(cash_tendered), 0) AS tendered,
                COALESCE(SUM(cash_change), 0) AS change
           FROM bms_payments
          WHERE tenant_id = $1 AND order_id = $2 AND status = 'CONFIRMED'`,
        [input.tenantId, orderId]
      );
      cashTendered = Number(cash.rows[0]?.tendered ?? 0) || null;
      cashChange = Number(cash.rows[0]?.change ?? 0) || null;
    } else {
      throw new Error(`บิลอยู่สถานะ ${current.status} ไม่สามารถปิดการขายได้`);
    }

    const fulfilled = await fulfilPosOrderInTx(client, input.tenantId, orderId, {
      locationId: shift.location_id,
      deviceId: shift.device_id,
      issuedBy: input.cashierUserId,
      settings: vatSettings,
    });
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'pos.sale', $3, $4)`,
      [input.tenantId, input.cashierUserId, orderId, JSON.stringify({ shiftId: shift.id, deviceId: input.deviceId })]
    );

    // ตัวเลขสมาชิกที่ต้องพิมพ์บนใบเสร็จ — อ่านในทรานแซกชันเดียวกับที่เพิ่งเขียน
    // (ทาง replay บิลที่ PAID อยู่แล้วจะได้แต้มที่เคยให้ไป ไม่ใช่ 0)
    const loyalty = await client.query<{ earned: string; balance: number | null }>(
      `SELECT COALESCE((
                SELECT SUM(l.points) FROM bms_loyalty_ledger l
                 WHERE l.tenant_id = o.tenant_id AND l.order_id = o.id AND l.kind = 'EARN'
              ), 0) AS earned,
              c.points_balance AS balance
         FROM bms_orders o
         LEFT JOIN bms_customers c ON c.tenant_id = o.tenant_id AND c.id = o.customer_id
        WHERE o.tenant_id = $1 AND o.id = $2`,
      [input.tenantId, orderId]
    );
    const discountRows = await client.query<{ source: string; label: string; amount: string; points_used: number }>(
      `SELECT source, label, amount, points_used FROM bms_order_discounts
        WHERE tenant_id = $1 AND order_id = $2 ORDER BY id`,
      [input.tenantId, orderId]
    );

    await client.query("COMMIT");
    const loyaltyRow = loyalty.rows[0];
    const hasMember = loyaltyRow?.balance != null;
    return {
      status: "SOLD",
      orderId,
      total: amountDue,
      cashTendered,
      cashChange,
      docNo: fulfilled.docNo,
      vat: fulfilled.vat,
      discountLines: discountRows.rows.map((row) => ({
        source: row.source as OrderDiscountLine["source"],
        label: row.label,
        amount: Number(row.amount),
        pointsUsed: Number(row.points_used ?? 0),
      })),
      pointsEarned: hasMember ? Number(loyaltyRow?.earned ?? 0) : null,
      pointsBalance: hasMember ? Number(loyaltyRow?.balance ?? 0) : null,
      // ผู้เรียกที่รู้ค่าปัดเศษจริงจะเขียนทับให้ (recordPosSale) — ทางที่มาถึงตรงนี้
      // โดยไม่ผ่านการปัด (เช่น replay บิลที่ค้างสถานะ) ไม่มีการปัดเพิ่มอยู่แล้ว
      roundingAmount: 0,
      replayed,
    };
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return { status: "PAYMENT_FAILED", reason: String(err?.message ?? err) };
  } finally {
    client.release();
  }
}

async function findPosOrderByIdempotencyKey(
  tenantId: string,
  deviceId: string,
  shiftId: string,
  key: string
): Promise<{ orderId: string; status: string; amountDue: number } | null> {
  const res = await query<{ id: string; status: string; total_amount: string; shipping_fee: string | null }>(
    `SELECT id, status, total_amount, shipping_fee
       FROM bms_orders
      WHERE tenant_id = $1 AND idempotency_key = $2 AND channel = 'pos'
        AND pos_device_id = $3 AND pos_shift_id = $4
      LIMIT 1`,
    [tenantId, key, deviceId, shiftId]
  );
  const row = res.rows[0];
  return row ? {
    orderId: row.id,
    status: row.status,
    amountDue: Number(row.total_amount) + Number(row.shipping_fee ?? 0),
  } : null;
}

async function findSaleByIdempotencyKey(
  tenantId: string,
  deviceId: string,
  shiftId: string,
  key: string
): Promise<(PosSaleResult & { status: "SOLD" }) | null> {
  const res = await query<{
    id: string;
    total_amount: string;
    shipping_fee: string | null;
    cash_tendered: string | null;
    cash_change: string | null;
    doc_no: string | null;
    order_rounding: string | null;
    vat_rate: string | null;
    taxable_amount: string | null;
    exempt_amount: string | null;
    vat_amount: string | null;
    rounding_amount: string | null;
    points_earned: string | null;
    points_balance: number | null;
  }>(
    `SELECT o.id, o.total_amount, o.shipping_fee, o.rounding_amount AS order_rounding,
            pay.cash_tendered, pay.cash_change,
            doc.doc_no, doc.vat_rate, doc.taxable_amount, doc.exempt_amount,
            doc.vat_amount, doc.rounding_amount,
            cust.points_balance,
            COALESCE((
              SELECT SUM(l.points) FROM bms_loyalty_ledger l
               WHERE l.tenant_id = o.tenant_id AND l.order_id = o.id AND l.kind = 'EARN'
            ), 0) AS points_earned
       FROM bms_orders o
       LEFT JOIN bms_customers cust ON cust.tenant_id = o.tenant_id AND cust.id = o.customer_id
       LEFT JOIN LATERAL (
         SELECT SUM(cash_tendered) AS cash_tendered, SUM(cash_change) AS cash_change
           FROM bms_payments
          WHERE tenant_id = o.tenant_id AND order_id = o.id
            AND status IN ('CONFIRMED','REFUNDED')
       ) pay ON TRUE
       LEFT JOIN bms_tax_documents doc
         ON doc.tenant_id = o.tenant_id AND doc.order_id = o.id
        AND doc.doc_type = 'ABBREVIATED' AND doc.cancelled_at IS NULL
      WHERE o.tenant_id = $1 AND o.idempotency_key = $2
        AND o.channel = 'pos' AND o.status IN ('COMPLETED','RETURNED')
        AND o.pos_device_id = $3 AND o.pos_shift_id = $4
      LIMIT 1`,
    [tenantId, key, deviceId, shiftId]
  );
  const row = res.rows[0];
  if (!row) return null;
  // ยอดปัดเศษเก็บแยกใน rounding_amount และไม่ถูกบวกกลับเข้า total_amount
  // ต้องบวกตอนอ่านเสมอ ไม่งั้นบิลที่พิมพ์ซ้ำจะแสดงยอดคนละตัวกับเงินที่รับจริง
  const rounding = Number(row.order_rounding ?? 0);
  return {
    status: "SOLD",
    orderId: row.id,
    total: Math.round((Number(row.total_amount) + Number(row.shipping_fee ?? 0) + rounding) * 100) / 100,
    cashTendered: row.cash_tendered == null ? null : Number(row.cash_tendered),
    cashChange: row.cash_change == null ? null : Number(row.cash_change),
    docNo: row.doc_no ?? null,
    vat: mapReceiptVat(row),
    roundingAmount: rounding,
    discountLines: await listOrderDiscounts(tenantId, row.id),
    pointsEarned: row.points_balance == null ? null : Number(row.points_earned ?? 0),
    pointsBalance: row.points_balance == null ? null : Number(row.points_balance),
    replayed: true,
  };
}

export async function getLatestPosSale(
  tenantId: string,
  deviceId: string
): Promise<PosRecentReceipt | null> {
  const rows = await listRecentPosSales(tenantId, deviceId, 1);
  return rows[0] ?? null;
}

export async function listRecentPosSales(
  tenantId: string,
  deviceId: string,
  limit = 5,
  opts: { query?: string | null } = {}
): Promise<PosRecentReceipt[]> {
  const q = String(opts.query ?? "").trim();
  const orderRes = await query<{
    id: string;
    total_amount: string;
    shipping_fee: string | null;
    status: string;
    created_at: string | Date;
    cashier_name: string | null;
    payment_method: PaymentMethod | null;
    payment_ref: string | null;
    cash_tendered: string | null;
    cash_change: string | null;
    doc_no: string | null;
    order_rounding: string | null;
    vat_rate: string | null;
    taxable_amount: string | null;
    exempt_amount: string | null;
    vat_amount: string | null;
    rounding_amount: string | null;
    member_no: string | null;
    member_name: string | null;
  }>(
    `SELECT o.id,
            o.total_amount,
            o.shipping_fee,
            o.rounding_amount AS order_rounding,
            o.status,
            o.created_at,
            u.name AS cashier_name,
            pay.method AS payment_method,
            pay.slip_ref AS payment_ref,
            pay.cash_tendered,
            pay.cash_change,
            doc.doc_no,
            doc.vat_rate,
            doc.taxable_amount,
            doc.exempt_amount,
            doc.vat_amount,
            doc.rounding_amount,
            cust.member_no,
            cust.name AS member_name
       FROM bms_orders o
       LEFT JOIN users u ON u.id = o.cashier_user_id AND u.tenant_id = o.tenant_id
       LEFT JOIN bms_customers cust ON cust.tenant_id = o.tenant_id AND cust.id = o.customer_id
       LEFT JOIN LATERAL (
         SELECT method, slip_ref, cash_tendered, cash_change
           FROM bms_payments
          WHERE tenant_id = o.tenant_id
            AND order_id = o.id
            AND status IN ('CONFIRMED','REFUNDED')
          ORDER BY created_at DESC, id DESC
          LIMIT 1
       ) pay ON TRUE
       LEFT JOIN bms_tax_documents doc
         ON doc.tenant_id = o.tenant_id AND doc.order_id = o.id
        AND doc.doc_type = 'ABBREVIATED'
        AND doc.cancelled_at IS NULL
      WHERE o.tenant_id = $1
        AND o.pos_device_id = $2
        AND o.channel = 'pos'
        AND o.status IN ('COMPLETED', 'RETURNED')
        AND (
          $4::text IS NULL
          OR o.id::text ILIKE '%' || $4 || '%'
          OR COALESCE(doc.doc_no, '') ILIKE '%' || $4 || '%'
        )
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $3`,
    [tenantId, deviceId, Math.min(Math.max(limit, 1), 20), q || null]
  );
  if (!orderRes.rows.length) return [];
  const orderIds = orderRes.rows.map((row) => row.id);

  const linesRes = await query<{
    id: number;
    order_id: string;
    product_sku: string;
    product_name: string;
    size: string;
    pack_code: string | null;
    pack_qty: number | null;
    qty: number;
    pack_unit_name: string | null;
    pack_unit_price: string | null;
    unit_price: string;
    returned_pack_qty: string | null;
  }>(
    `SELECT oi.id,
            oi.order_id,
            oi.product_sku,
            oi.product_name,
            oi.size,
            oi.pack_code,
            oi.pack_qty,
            oi.qty,
            oi.pack_unit_name,
            oi.pack_unit_price,
            oi.unit_price,
            COALESCE((
              SELECT SUM(pri.pack_qty)
                FROM bms_pos_return_items pri
                JOIN bms_pos_returns pr ON pr.id = pri.pos_return_id
               WHERE pri.tenant_id = oi.tenant_id
                 AND pri.order_item_id = oi.id
                 AND pr.order_id = oi.order_id
            ), 0) AS returned_pack_qty
       FROM bms_order_items oi
      WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])
      ORDER BY order_id, id`,
    [tenantId, orderIds]
  );

  const linesByOrder = new Map<string, PosRecentReceipt["lines"]>();
  for (const line of linesRes.rows) {
    const packQty = line.pack_qty ?? line.qty;
    const unitPrice = line.pack_unit_price == null ? Number(line.unit_price) : Number(line.pack_unit_price);
    const mapped = {
      orderItemId: line.id,
      sku: line.product_sku,
      receiptName: line.product_name,
      size: line.size,
      packCode: line.pack_code ?? "BASE",
      baseQty: Math.max(1, Math.round(line.qty / Math.max(1, packQty))),
      packPrice: unitPrice,
      basePrice: Number(line.unit_price),
      packQty,
      returnedPackQty: Number(line.returned_pack_qty ?? 0),
      refundablePackQty: Math.max(0, packQty - Number(line.returned_pack_qty ?? 0)),
      unitName: line.pack_unit_name ?? "ชิ้น",
      lineTotal: packQty * unitPrice,
    };
    const existing = linesByOrder.get(line.order_id) ?? [];
    existing.push(mapped);
    linesByOrder.set(line.order_id, existing);
  }

  const paymentsRes = await query<{
    id: string;
    order_id: string;
    method: PaymentMethod;
    amount: string;
    slip_ref: string | null;
    cash_tendered: string | null;
    cash_change: string | null;
  }>(
    `SELECT id, order_id, method, amount, slip_ref, cash_tendered, cash_change
       FROM bms_payments
      WHERE tenant_id = $1
        AND order_id = ANY($2::uuid[])
        AND status IN ('CONFIRMED','REFUNDED')
      ORDER BY created_at, id`,
    [tenantId, orderIds]
  );

  const paymentsByOrder = new Map<string, PosRecentReceipt["payments"]>();
  for (const payment of paymentsRes.rows) {
    const existing = paymentsByOrder.get(payment.order_id) ?? [];
    existing.push({
      id: payment.id,
      method: payment.method,
      amount: Number(payment.amount),
      ref: payment.slip_ref ?? null,
      cashTendered: payment.cash_tendered == null ? null : Number(payment.cash_tendered),
      cashChange: payment.cash_change == null ? null : Number(payment.cash_change),
    });
    paymentsByOrder.set(payment.order_id, existing);
  }

  const refundsRes = await query<any>(
    `SELECT pr.order_id, pr.id AS pos_return_id, pr.return_mode, pr.note, pr.created_at,
            a.id, a.payment_id, a.method, a.amount, a.status, a.external_ref
       FROM bms_pos_returns pr
       JOIN bms_pos_refund_allocations a
         ON a.tenant_id = pr.tenant_id AND a.pos_return_id = pr.id
      WHERE pr.tenant_id = $1 AND pr.order_id = ANY($2::uuid[])
      ORDER BY pr.created_at, a.created_at, a.id`,
    [tenantId, orderIds]
  );
  const refundsByOrder = new Map<string, PosRecentReceipt["refunds"]>();
  for (const row of refundsRes.rows) {
    const existing = refundsByOrder.get(row.order_id) ?? [];
    existing.push({
      ...mapRefundAllocation(row),
      posReturnId: row.pos_return_id,
      returnMode: row.return_mode,
      returnNote: row.note ?? null,
      returnedAt: toISO(row.created_at),
    });
    refundsByOrder.set(row.order_id, existing);
  }

  return orderRes.rows.map((row) => ({
    orderId: row.id,
    docNo: row.doc_no ?? null,
    vat: mapReceiptVat(row),
    roundingAmount: Number(row.order_rounding ?? 0),
    orderStatus: row.status,
    total:
      Math.round(
        (Number(row.total_amount) + Number(row.shipping_fee ?? 0) + Number(row.order_rounding ?? 0)) * 100
      ) / 100,
    cashTendered: row.cash_tendered == null ? null : Number(row.cash_tendered),
    cashChange: row.cash_change == null ? null : Number(row.cash_change),
    paymentMethod: row.payment_method ?? null,
    paymentRef: row.payment_ref ?? null,
    soldAt: toISO(row.created_at),
    cashierName: row.cashier_name ?? null,
    memberNo: row.member_no ?? null,
    memberName: row.member_no ? (row.member_name ?? null) : null,
    payments: paymentsByOrder.get(row.id) ?? [],
    refunds: refundsByOrder.get(row.id) ?? [],
    lines: linesByOrder.get(row.id) ?? [],
  }));
}

export type PosReturnResult =
  | {
      status: "RETURNED";
      posReturnId: string;
      orderId: string;
      refundAmount: number;
      settlementStatus: "PENDING" | "COMPLETED";
      refunds: PosRefundAllocation[];
      replayed: boolean;
    }
  | { status: "ORDER_NOT_FOUND" }
  | { status: "ORDER_NOT_POS" }
  | { status: "INVALID_ORDER_STATUS"; current: string }
  | { status: "NO_CONFIRMED_PAYMENTS" }
  | { status: "IDEMPOTENCY_CONFLICT" }
  | { status: "EMPTY" }
  | { status: "ITEM_NOT_FOUND"; orderItemId: number }
  | { status: "RETURN_QTY_EXCEEDED"; orderItemId: number; remaining: number; requested: number }
  | { status: "APPROVAL_REQUIRED"; reason: string };

export type PosRefundAllocation = {
  id: string;
  paymentId: string;
  method: PaymentMethod;
  amount: number;
  status: "PENDING" | "COMPLETED";
  externalRef: string | null;
};

export type PosPartialReturnResult =
  | {
      status: "PARTIAL_RETURNED";
      /** เลขใบลดหนี้ที่ออกให้การคืนครั้งนี้ — null เมื่อร้านไม่ได้จด VAT */
      creditNoteNo?: string | null;
      posReturnId: string;
      orderId: string;
      refundAmount: number;
      returnedItems: Array<{ orderItemId: number; packQty: number; refundAmount: number }>;
      settlementStatus: "PENDING" | "COMPLETED";
      refunds: PosRefundAllocation[];
      /** แต้มที่ดึงคืนเพราะการคืนครั้งนี้ (7.96) */
      pointsReversed?: number;
      /** แต้มที่คืนให้ลูกค้าเพราะบิลเดิมใช้แต้มไป */
      pointsReturned?: number;
      replayed: boolean;
    }
  | { status: "ORDER_NOT_FOUND" }
  | { status: "ORDER_NOT_POS" }
  | { status: "INVALID_ORDER_STATUS"; current: string }
  | { status: "NO_CONFIRMED_PAYMENTS" }
  | { status: "IDEMPOTENCY_CONFLICT" }
  | { status: "EMPTY" }
  | { status: "ITEM_NOT_FOUND"; orderItemId: number }
  | { status: "RETURN_QTY_EXCEEDED"; orderItemId: number; remaining: number; requested: number }
  | { status: "APPROVAL_REQUIRED"; reason: string; refundAmount: number };

function approvalRuleForRefundAmount(refundAmount: number): {
  requiredPermission: string | null;
  reason: string | null;
} {
  if (refundAmount >= 2000) {
    return {
      requiredPermission: "payment.refund",
      reason: "คืนสินค้าตั้งแต่ 2,000 บาทขึ้นไป ต้องให้ผู้มีสิทธิ์ refund อนุมัติ",
    };
  }
  if (refundAmount >= 500) {
    return {
      requiredPermission: "payment.refund",
      reason: "คืนสินค้าตั้งแต่ 500 บาทขึ้นไป ต้องให้ผู้มีสิทธิ์ refund อนุมัติ",
    };
  }
  return { requiredPermission: null, reason: null };
}

export async function returnPosSale(input: {
  tenantId: string;
  deviceId: string;
  orderId: string;
  actorUserId: string;
  note?: string | null;
  approvedByUserId?: string | null;
  idempotencyKey: string;
}): Promise<PosReturnResult> {
  const result = await processPosReturn({ ...input, mode: "FULL", lines: [] });
  if (result.status !== "PARTIAL_RETURNED") return result;
  return {
    status: "RETURNED",
    posReturnId: result.posReturnId,
    orderId: result.orderId,
    refundAmount: result.refundAmount,
    settlementStatus: result.settlementStatus,
    refunds: result.refunds,
    replayed: result.replayed,
  };
}

export async function partiallyReturnPosSale(input: {
  tenantId: string;
  deviceId: string;
  orderId: string;
  actorUserId: string;
  lines: Array<{ orderItemId: number; packQty: number }>;
  note?: string | null;
  approvedByUserId?: string | null;
  idempotencyKey: string;
}): Promise<PosPartialReturnResult> {
  return processPosReturn({ ...input, mode: "PARTIAL" });
}

async function processPosReturn(input: {
  tenantId: string;
  deviceId: string;
  orderId: string;
  actorUserId: string;
  mode: "FULL" | "PARTIAL";
  lines: Array<{ orderItemId: number; packQty: number }>;
  note?: string | null;
  approvedByUserId?: string | null;
  idempotencyKey: string;
}): Promise<PosPartialReturnResult> {
  const requestedMap = new Map<number, number>();
  for (const line of input.lines) {
    if (!Number.isInteger(line.orderItemId) || !Number.isInteger(line.packQty) || line.packQty <= 0) continue;
    requestedMap.set(line.orderItemId, (requestedMap.get(line.orderItemId) ?? 0) + line.packQty);
  }
  if (input.mode === "PARTIAL" && requestedMap.size === 0) return { status: "EMPTY" };

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });

    const replay = await client.query<{
      id: string;
      order_id: string;
      pos_device_id: string | null;
      return_mode: "FULL" | "PARTIAL";
      refund_amount: string;
      settlement_status: "PENDING" | "COMPLETED";
    }>(
      `SELECT id, order_id, pos_device_id, return_mode, refund_amount, settlement_status
         FROM bms_pos_returns
        WHERE tenant_id = $1 AND idempotency_key = $2
        LIMIT 1`,
      [input.tenantId, input.idempotencyKey]
    );
    if (replay.rows[0]) {
      const existing = replay.rows[0];
      if (existing.order_id !== input.orderId
          || existing.pos_device_id !== input.deviceId
          || existing.return_mode !== input.mode) {
        await client.query("ROLLBACK");
        return { status: "IDEMPOTENCY_CONFLICT" };
      }
      const [items, refunds] = await Promise.all([
        client.query<{ order_item_id: string; pack_qty: number; refund_amount: string }>(
          `SELECT order_item_id, pack_qty, refund_amount FROM bms_pos_return_items
            WHERE tenant_id = $1 AND pos_return_id = $2 ORDER BY id`,
          [input.tenantId, existing.id]
        ),
        client.query<any>(
          `SELECT id, payment_id, method, amount, status, external_ref
             FROM bms_pos_refund_allocations
            WHERE tenant_id = $1 AND pos_return_id = $2 ORDER BY created_at, id`,
          [input.tenantId, existing.id]
        ),
      ]);
      await client.query("ROLLBACK");
      return {
        status: "PARTIAL_RETURNED",
        posReturnId: existing.id,
        orderId: input.orderId,
        refundAmount: Number(existing.refund_amount),
        returnedItems: items.rows.map((row) => ({
          orderItemId: Number(row.order_item_id),
          packQty: Number(row.pack_qty),
          refundAmount: Number(row.refund_amount),
        })),
        settlementStatus: existing.settlement_status,
        refunds: refunds.rows.map(mapRefundAllocation),
        replayed: true,
      };
    }

    const orderRes = await client.query<{
      id: string;
      status: string;
      channel: string;
      pos_device_id: string | null;
      total_amount: string;
      shipping_fee: string | null;
    }>(
      `SELECT id, status, channel, pos_device_id, total_amount, shipping_fee
         FROM bms_orders
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [input.tenantId, input.orderId]
    );
    const order = orderRes.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return { status: "ORDER_NOT_FOUND" };
    }
    if (order.channel !== POS_CHANNEL) {
      await client.query("ROLLBACK");
      return { status: "ORDER_NOT_POS" };
    }
    if (order.pos_device_id !== input.deviceId) {
      await client.query("ROLLBACK");
      return { status: "ORDER_NOT_FOUND" };
    }
    if (order.status !== "COMPLETED") {
      await client.query("ROLLBACK");
      return { status: "INVALID_ORDER_STATUS", current: order.status };
    }

    const itemsRes = await client.query<{
      id: number;
      order_id: string;
      tenant_id: string;
      location_id: string;
      product_sku: string;
      size: string;
      qty: number;
      pack_qty: number | null;
      pack_unit_price: string | null;
      unit_price: string;
      returned_pack_qty: string | null;
      returned_refund_amount: string | null;
    }>(
      `SELECT oi.id,
              oi.order_id,
              oi.tenant_id,
              oi.location_id,
              oi.product_sku,
              oi.size,
              oi.qty,
              oi.pack_qty,
              oi.pack_unit_price,
              oi.unit_price,
              COALESCE((
                SELECT SUM(pri.pack_qty)
                  FROM bms_pos_return_items pri
                  JOIN bms_pos_returns pr ON pr.id = pri.pos_return_id
                 WHERE pri.tenant_id = oi.tenant_id
                   AND pri.order_item_id = oi.id
                   AND pr.order_id = oi.order_id
              ), 0) AS returned_pack_qty,
              COALESCE((
                SELECT SUM(pri.refund_amount)
                  FROM bms_pos_return_items pri
                  JOIN bms_pos_returns pr ON pr.id = pri.pos_return_id
                 WHERE pri.tenant_id = oi.tenant_id
                   AND pri.order_item_id = oi.id
                   AND pr.order_id = oi.order_id
              ), 0) AS returned_refund_amount
         FROM bms_order_items oi
        WHERE oi.tenant_id = $1
          AND oi.order_id = $2
        ORDER BY oi.id
        FOR UPDATE`,
      [input.tenantId, input.orderId]
    );

    // bms_order_items.id เป็น BIGSERIAL และ pg คืน int8 มาเป็น "string" (ไม่มี
    // setTypeParser ในโปรเจกต์นี้) ส่วน orderItemId ที่ผู้เรียกส่งมาเป็น number
    // ถ้าไม่แปลงให้เป็นชนิดเดียวกัน byId.get(978) จะไม่เจอ "978" แล้วการคืนสินค้า
    // แบบระบุรายการจะตอบ ITEM_NOT_FOUND ทุกครั้ง (คืนทั้งบิลไม่โดนเพราะสร้าง
    // requestedMap จาก row.id เอง ชนิดจึงตรงกันโดยบังเอิญ)
    const orderItems = itemsRes.rows.map((row) => ({ ...row, id: Number(row.id) }));
    const byId = new Map(orderItems.map((row) => [row.id, row]));
    if (input.mode === "PARTIAL") for (const [orderItemId, packQty] of requestedMap) {
      const line = { orderItemId, packQty };
      const item = byId.get(line.orderItemId);
      if (!item) {
        await client.query("ROLLBACK");
        return { status: "ITEM_NOT_FOUND", orderItemId: line.orderItemId };
      }
      const originalPackQty = item.pack_qty ?? item.qty;
      const remaining = Math.max(0, originalPackQty - Number(item.returned_pack_qty ?? 0));
      if (line.packQty > remaining) {
        await client.query("ROLLBACK");
        return { status: "RETURN_QTY_EXCEEDED", orderItemId: line.orderItemId, remaining, requested: line.packQty };
      }
    }

    if (input.mode === "FULL") {
      for (const item of orderItems) {
        const originalPackQty = item.pack_qty ?? item.qty;
        const remaining = Math.max(0, originalPackQty - Number(item.returned_pack_qty ?? 0));
        if (remaining > 0) requestedMap.set(item.id, remaining);
      }
      if (requestedMap.size === 0) {
        await client.query("ROLLBACK");
        return { status: "EMPTY" };
      }
    }

    const orderAmount = Math.round((Number(order.total_amount) + Number(order.shipping_fee ?? 0)) * 100) / 100;
    const grossTotal = orderItems.reduce((sum, item) => {
      const packQty = item.pack_qty ?? item.qty;
      const price = item.pack_unit_price == null ? Number(item.unit_price) : Number(item.pack_unit_price);
      return sum + packQty * price;
    }, 0);
    if (!(grossTotal > 0) || !(orderAmount >= 0)) throw new Error("ยอดบิลสำหรับคำนวณคืนเงินไม่ถูกต้อง");

    const lineNetTotals = new Map<number, number>();
    let allocatedNet = 0;
    orderItems.forEach((item, index) => {
      const packQty = item.pack_qty ?? item.qty;
      const price = item.pack_unit_price == null ? Number(item.unit_price) : Number(item.pack_unit_price);
      const lineNet = index === orderItems.length - 1
        ? Math.round((orderAmount - allocatedNet) * 100) / 100
        : Math.round((orderAmount * ((packQty * price) / grossTotal)) * 100) / 100;
      lineNetTotals.set(item.id, lineNet);
      allocatedNet += lineNet;
    });

    const calculated = [...requestedMap.entries()].map(([orderItemId, packQty]) => {
      const item = byId.get(orderItemId)!;
      const originalPackQty = item.pack_qty ?? item.qty;
      const remainingPackQty = originalPackQty - Number(item.returned_pack_qty ?? 0);
      const remainingLineRefund = Math.max(0,
        Number(lineNetTotals.get(item.id) ?? 0) - Number(item.returned_refund_amount ?? 0));
      const refundAmount = packQty === remainingPackQty
        ? Math.round(remainingLineRefund * 100) / 100
        : Math.min(remainingLineRefund, Math.round(((lineNetTotals.get(item.id) ?? 0) * packQty / originalPackQty) * 100) / 100);
      return { item, packQty, refundAmount };
    });
    const roundedRefundAmount = Math.round(calculated.reduce((sum, line) => sum + line.refundAmount, 0) * 100) / 100;

    const approvalRule = approvalRuleForRefundAmount(roundedRefundAmount);
    let approvedBy = input.approvedByUserId?.trim() || null;
    if (approvalRule.requiredPermission) {
      const actorCanApprove = await cashierHasPermissionInTx(
        client, input.tenantId, input.actorUserId, approvalRule.requiredPermission
      );
      const approverCanApprove = approvedBy
        ? await cashierHasPermissionInTx(client, input.tenantId, approvedBy, approvalRule.requiredPermission)
        : false;
      if (!actorCanApprove && !approverCanApprove) {
        await client.query("ROLLBACK");
        return {
          status: "APPROVAL_REQUIRED",
          reason: approvalRule.reason || "ต้องมีผู้อนุมัติ",
          refundAmount: roundedRefundAmount,
        };
      }
      // ถ้าแคชเชียร์มีสิทธิ์อนุมัติเอง ให้เก็บตัวตนไว้ใน audit column ด้วย
      // ไม่ปล่อย approved_by เป็น NULL จนรายงานแยกไม่ออกว่าอนุมัติแล้วหรือข้อมูลขาด
      if (!approvedBy && actorCanApprove) approvedBy = input.actorUserId;
    }

    const ret = await client.query<{ id: string }>(
      `INSERT INTO bms_pos_returns
         (tenant_id, order_id, pos_device_id, returned_by, approved_by, return_mode,
          refund_amount, settlement_status, idempotency_key, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9)
       RETURNING id`,
      [input.tenantId, input.orderId, input.deviceId, input.actorUserId, approvedBy,
        input.mode, roundedRefundAmount, input.idempotencyKey, input.note ?? null]
    );
    const posReturnId = ret.rows[0].id;

    const returnedItems: Array<{ orderItemId: number; packQty: number; refundAmount: number }> = [];

    for (const line of calculated) {
      const item = line.item;
      const originalPackQty = item.pack_qty ?? item.qty;
      const baseQtyPerPack = Math.max(1, Math.round(item.qty / Math.max(1, originalPackQty)));
      const baseQtyToReturn = line.packQty * baseQtyPerPack;

      const inventory = await client.query(
        `UPDATE bms_inventory
            SET current_stock = current_stock + $2, updated_at = now()
          WHERE tenant_id = $1
            AND location_id = $3
            AND product_sku = $4
            AND size = $5`,
        [input.tenantId, baseQtyToReturn, item.location_id, item.product_sku, item.size]
      );
      if (!inventory.rowCount) throw new Error(`ไม่พบสต็อก ${item.product_sku}/${item.size} สำหรับรับคืน`);

      const returnItem = await client.query<{ id: string }>(
        `INSERT INTO bms_pos_return_items
           (tenant_id, pos_return_id, order_item_id, qty, pack_qty, refund_amount)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [input.tenantId, posReturnId, item.id, baseQtyToReturn, line.packQty, line.refundAmount]
      );

      let remainingBase = baseQtyToReturn;
      const lotsRes = await client.query<{ lot_id: string; available_to_return: number }>(
        `SELECT oil.lot_id,
                (oil.qty - COALESCE((
                  SELECT SUM(pril.qty)
                    FROM bms_pos_return_item_lots pril
                    JOIN bms_pos_return_items pri ON pri.id = pril.pos_return_item_id
                   WHERE pril.tenant_id = oil.tenant_id
                     AND pri.order_item_id = oil.order_item_id
                     AND pril.lot_id = oil.lot_id
                ), 0))::integer AS available_to_return
           FROM bms_order_item_lots oil
          WHERE oil.tenant_id = $1 AND oil.order_item_id = $2
          ORDER BY id`,
        [input.tenantId, item.id]
      );
      for (const lot of lotsRes.rows) {
        if (remainingBase <= 0) break;
        const giveBack = Math.min(remainingBase, Math.max(0, lot.available_to_return));
        if (giveBack <= 0) continue;
        await client.query(
          `UPDATE bms_inventory_lots
              SET qty = qty + $3, updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [input.tenantId, lot.lot_id, giveBack]
        );
        await client.query(
          `INSERT INTO bms_pos_return_item_lots (tenant_id, pos_return_item_id, lot_id, qty)
           VALUES ($1, $2, $3, $4)`,
          [input.tenantId, returnItem.rows[0].id, lot.lot_id, giveBack]
        );
        remainingBase -= giveBack;
      }
      if (lotsRes.rowCount && remainingBase > 0) {
        throw new Error(`จำนวน lot ต้นทางของ ${item.product_sku}/${item.size} ไม่พอสำหรับรับคืน`);
      }
      await recordMovement(client, {
        tenantId: input.tenantId,
        locationId: item.location_id,
        sku: item.product_sku,
        size: item.size,
        type: "RETURN",
        qty: baseQtyToReturn,
        refOrderId: input.orderId,
        note: `POS return ${posReturnId}`,
        actor: input.actorUserId,
      });
      returnedItems.push({ orderItemId: item.id, packQty: line.packQty, refundAmount: line.refundAmount });
    }

    const payments = await client.query<{
      id: string; method: PaymentMethod; amount: string; allocated: string;
    }>(
      `SELECT p.id, p.method, p.amount,
              COALESCE((SELECT SUM(a.amount) FROM bms_pos_refund_allocations a
                         WHERE a.tenant_id = p.tenant_id AND a.payment_id = p.id), 0) AS allocated
         FROM bms_payments p
        WHERE p.tenant_id = $1 AND p.order_id = $2
          AND p.status IN ('CONFIRMED','REFUNDED')
        ORDER BY p.created_at, p.id
        FOR UPDATE`,
      [input.tenantId, input.orderId]
    );
    if (!payments.rowCount) {
      await client.query("ROLLBACK");
      return { status: "NO_CONFIRMED_PAYMENTS" };
    }

    let remainingRefund = roundedRefundAmount;
    const refunds: PosRefundAllocation[] = [];
    for (const payment of payments.rows) {
      if (remainingRefund <= 0.001) break;
      const available = Math.max(0, Number(payment.amount) - Number(payment.allocated));
      const amount = Math.round(Math.min(available, remainingRefund) * 100) / 100;
      if (amount <= 0) continue;
      const completed = payment.method === "CASH";
      const allocation = await client.query<any>(
        `INSERT INTO bms_pos_refund_allocations
           (tenant_id, pos_return_id, payment_id, method, amount, status,
            completed_by, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 CASE WHEN $6 = 'COMPLETED' THEN now() ELSE NULL END)
         RETURNING id, payment_id, method, amount, status, external_ref`,
        [input.tenantId, posReturnId, payment.id, payment.method, amount,
          completed ? "COMPLETED" : "PENDING", completed ? input.actorUserId : null]
      );
      refunds.push(mapRefundAllocation(allocation.rows[0]));
      remainingRefund = Math.round((remainingRefund - amount) * 100) / 100;

      if (completed && Number(payment.allocated) + amount >= Number(payment.amount) - 0.01) {
        await client.query(
          `UPDATE bms_payments SET status = 'REFUNDED', verified_by = $3, updated_at = now()
            WHERE tenant_id = $1 AND id = $2 AND status = 'CONFIRMED'`,
          [input.tenantId, payment.id, input.actorUserId]
        );
      }
    }
    if (remainingRefund > 0.01) throw new Error(`ยอด payment ที่ยังคืนได้ไม่พอ (ขาด ${remainingRefund.toFixed(2)})`);

    const settlementStatus: "PENDING" | "COMPLETED" = refunds.every((refund) => refund.status === "COMPLETED")
      ? "COMPLETED"
      : "PENDING";
    await client.query(
      `UPDATE bms_pos_returns SET settlement_status = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, posReturnId, settlementStatus]
    );

    const allReturned = orderItems.every((item) => {
      const original = item.pack_qty ?? item.qty;
      return Number(item.returned_pack_qty ?? 0) + Number(requestedMap.get(item.id) ?? 0) >= original;
    });
    if (allReturned) {
      await client.query(
        `UPDATE bms_orders SET status = 'RETURNED', updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'COMPLETED'`,
        [input.tenantId, input.orderId]
      );
    }
    // แต้มสะสม (7.96) — ต้องอยู่ใน tx เดียวกับสต็อกและเงินที่คืน
    // ไม่ทำข้อนี้: ซื้อ → ได้แต้ม → คืนของ → เก็บแต้มไว้ = ปั๊มแต้มฟรี
    // ratio คิดจากยอดคืนครั้งนี้ ÷ ยอดสุทธิบิลเดิม (ผลรวมทุกครั้งไม่เกิน 1
    // เพราะ remainingRefund ด้านบนบังคับว่าคืนเกินยอดที่จ่ายมาไม่ได้)
    const loyaltyReversal = await reversePointsForReturnInTx(client, {
      tenantId: input.tenantId,
      orderId: input.orderId,
      posReturnId,
      ratio: orderAmount > 0 ? roundedRefundAmount / orderAmount : 0,
      actorUserId: input.actorUserId,
    });

    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'pos.return', $3, $4)`,
      [input.tenantId, input.actorUserId, input.orderId, JSON.stringify({
        posReturnId,
        mode: input.mode,
        refundAmount: roundedRefundAmount,
        approvedBy,
        settlementStatus,
        pointsReversed: loyaltyReversal.earnedReversed,
        pointsReturned: loyaltyReversal.redeemedReturned,
      })]
    );

    await client.query("COMMIT");

    // ใบลดหนี้ (7.95) — รับคืนสินค้าแล้วต้องออกเอกสารลดยอด ไม่ใช่ลบบิลทิ้ง
    // ออกนอกทรานแซกชันการคืนโดยตั้งใจ: ของคืนเข้าคลังและเงินคืนไปแล้ว
    // การออกเอกสารล้มต้องไม่ย้อนสิ่งที่เกิดขึ้นจริงหน้าเคาน์เตอร์
    // ร้านที่ไม่ได้จด VAT จะได้ NOT_VAT_REGISTERED แล้วข้ามไปเอง
    let creditNoteNo: string | null = null;
    try {
      const note = await issueCreditNote({
        tenantId: input.tenantId,
        orderId: input.orderId,
        amount: roundedRefundAmount,
        reason: input.mode === "FULL" ? "รับคืนสินค้าทั้งบิล" : "รับคืนสินค้าบางรายการ",
        issuedBy: input.actorUserId,
        returnRef: posReturnId,
        // ส่งรายการที่คืนจริงไปด้วย — คืนเฉพาะของยกเว้น VAT ต้องไม่ลด VAT
        returnedItems: returnedItems.map((i) => ({
          orderItemId: i.orderItemId,
          refundAmount: i.refundAmount,
        })),
      });
      if (note.status === "ISSUED" || note.status === "ALREADY_ISSUED") {
        creditNoteNo = note.document.docNo;
      }
    } catch (e) {
      console.error("[POS] ออกใบลดหนี้ไม่สำเร็จ", input.orderId, e);
    }

    return {
      status: "PARTIAL_RETURNED",
      posReturnId,
      orderId: input.orderId,
      refundAmount: roundedRefundAmount,
      returnedItems,
      settlementStatus,
      refunds,
      creditNoteNo,
      pointsReversed: loyaltyReversal.earnedReversed,
      pointsReturned: loyaltyReversal.redeemedReturned,
      replayed: false,
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

function mapRefundAllocation(row: any): PosRefundAllocation {
  return {
    id: String(row.id),
    paymentId: String(row.payment_id),
    method: row.method as PaymentMethod,
    amount: Number(row.amount),
    status: row.status as "PENDING" | "COMPLETED",
    externalRef: row.external_ref ?? null,
  };
}

export type CompletePosRefundResult =
  | { status: "COMPLETED"; allocation: PosRefundAllocation; returnSettlementStatus: "PENDING" | "COMPLETED"; replayed: boolean }
  | { status: "NOT_FOUND" }
  | { status: "APPROVAL_REQUIRED" }
  | { status: "REFERENCE_REQUIRED" };

/** ยืนยันหลังคืนเงินจริงผ่านเครื่องบัตร/QR/wallet แล้วเท่านั้น */
export async function completePosRefundAllocation(input: {
  tenantId: string;
  deviceId: string;
  allocationId: string;
  actorUserId: string;
  externalRef?: string | null;
}): Promise<CompletePosRefundResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    if (!(await cashierHasPermissionInTx(client, input.tenantId, input.actorUserId, "payment.refund"))) {
      await client.query("ROLLBACK");
      return { status: "APPROVAL_REQUIRED" };
    }
    const res = await client.query<any>(
      `SELECT a.*, pr.order_id
         FROM bms_pos_refund_allocations a
         JOIN bms_pos_returns pr ON pr.id = a.pos_return_id AND pr.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1 AND a.id = $2 AND pr.pos_device_id = $3
        FOR UPDATE`,
      [input.tenantId, input.allocationId, input.deviceId]
    );
    const row = res.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
    }
    if (row.status === "COMPLETED") {
      const statusRes = await client.query<{ settlement_status: "PENDING" | "COMPLETED" }>(
        `SELECT settlement_status FROM bms_pos_returns WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, row.pos_return_id]
      );
      await client.query("ROLLBACK");
      return {
        status: "COMPLETED",
        allocation: mapRefundAllocation(row),
        returnSettlementStatus: statusRes.rows[0]?.settlement_status ?? "PENDING",
        replayed: true,
      };
    }
    const externalRef = input.externalRef?.trim() || null;
    if (row.method !== "CASH" && !externalRef) {
      await client.query("ROLLBACK");
      return { status: "REFERENCE_REQUIRED" };
    }
    const updated = await client.query<any>(
      `UPDATE bms_pos_refund_allocations
          SET status = 'COMPLETED', external_ref = $3, completed_by = $4,
              completed_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, payment_id, method, amount, status, external_ref`,
      [input.tenantId, input.allocationId, externalRef, input.actorUserId]
    );
    const paid = await client.query<{ amount: string; completed: string }>(
      `SELECT p.amount,
              COALESCE(SUM(a.amount) FILTER (WHERE a.status = 'COMPLETED'), 0) AS completed
         FROM bms_payments p
         LEFT JOIN bms_pos_refund_allocations a
           ON a.tenant_id = p.tenant_id AND a.payment_id = p.id
        WHERE p.tenant_id = $1 AND p.id = $2
        GROUP BY p.id, p.amount`,
      [input.tenantId, row.payment_id]
    );
    if (Number(paid.rows[0]?.completed ?? 0) >= Number(paid.rows[0]?.amount ?? 0) - 0.01) {
      await client.query(
        `UPDATE bms_payments SET status = 'REFUNDED', verified_by = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'CONFIRMED'`,
        [input.tenantId, row.payment_id, input.actorUserId]
      );
    }
    const pending = await client.query(
      `SELECT 1 FROM bms_pos_refund_allocations
        WHERE tenant_id = $1 AND pos_return_id = $2 AND status = 'PENDING' LIMIT 1`,
      [input.tenantId, row.pos_return_id]
    );
    const returnSettlementStatus: "PENDING" | "COMPLETED" = pending.rowCount ? "PENDING" : "COMPLETED";
    await client.query(
      `UPDATE bms_pos_returns SET settlement_status = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, row.pos_return_id, returnSettlementStatus]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'pos.refund.complete', $3, $4)`,
      [input.tenantId, input.actorUserId, row.order_id,
        JSON.stringify({ allocationId: input.allocationId, method: row.method, amount: Number(row.amount) })]
    );
    await client.query("COMMIT");
    return {
      status: "COMPLETED",
      allocation: mapRefundAllocation(updated.rows[0]),
      returnSettlementStatus,
      replayed: false,
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
