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
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { createOrder, cancelOrder, type OrderItemInput } from "./orders";
import { type PaymentMethod } from "./payments";
import { recordMovement, recordOrderMovements } from "./movements";
import {
  isFixedPricePack,
  isSaleTimePricingSnapshot,
  priceRemainingLines,
  type PriceTier,
  type Promotion,
} from "./pricing";
import { getVariantBasePrice, getVariantBasePriceInTx } from "./productPacks";
import { markDepositCompletedInTx, takeDeposit, type Deposit } from "./deposits";
import { chargeArInTx, precheckArCharge, reduceArForReturnInTx } from "./ar";
import {
  findStoreCredit,
  lockUsableCreditInTx,
  redeemCreditInTx,
  reverseCreditForReturnInTx,
} from "./storeCredit";
import { assertPharmacyPolicyReadyToOpenShift } from "./pharmacy/policyReadiness";
import { checkPharmacySaleInTx } from "./pharmacy/productPolicy";
import { isPharmacistReviewableBlock } from "./pharmacy/productPolicyDecision";
import { createProductReviewAssessmentOnce } from "./pharmacy/assessments";
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
  scannerMode: "FOCUS" | "PREFIX";
  scannerPrefixKey: string;
  scannerSuffixKey: string;
  scannerMaxGapMs: number;
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
    `SELECT id, tenant_id, location_id, code, name, registered_pos_no, receipt_prefix,
            scanner_mode, scanner_prefix_key, scanner_suffix_key, scanner_max_gap_ms, active
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
    scannerMode: r.scanner_mode === "PREFIX" ? "PREFIX" : "FOCUS",
    scannerPrefixKey: r.scanner_prefix_key ?? "F9",
    scannerSuffixKey: r.scanner_suffix_key ?? "Enter",
    scannerMaxGapMs: Number(r.scanner_max_gap_ms ?? 80),
    active: r.active,
  };
}

export async function listPosDevices(tenantId: string): Promise<PosDevice[]> {
  const res = await query<any>(
    `SELECT id, tenant_id, location_id, code, name, registered_pos_no, receipt_prefix,
            scanner_mode, scanner_prefix_key, scanner_suffix_key, scanner_max_gap_ms, active
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
    scannerMode: r.scanner_mode === "PREFIX" ? "PREFIX" : "FOCUS",
    scannerPrefixKey: r.scanner_prefix_key ?? "F9",
    scannerSuffixKey: r.scanner_suffix_key ?? "Enter",
    scannerMaxGapMs: Number(r.scanner_max_gap_ms ?? 80),
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
  /** สินค้าที่เปิดขายแต่ยังเป็น vat_category='UNKNOWN' — บล็อกเฉพาะร้านที่จด VAT */
  unknownVatProducts: number;
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
    unknownVatProducts: Number(productRow.unknown_vat_products ?? 0),
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
  if (vat.vatRegistered && result.unknownVatProducts > 0) {
    result.blockers.push(`สินค้าที่เปิดขายยังไม่ระบุประเภท VAT ${result.unknownVatProducts} รายการ`);
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
    scannerMode?: "FOCUS" | "PREFIX" | null;
    scannerPrefixKey?: string | null;
    scannerSuffixKey?: string | null;
    scannerMaxGapMs?: number | null;
    active?: boolean;
  },
  writeContext?: { editorId?: string | number | null; auditActor?: string | null }
): Promise<PosDevice> {
  if (input.scannerMode != null && input.scannerMode !== "FOCUS" && input.scannerMode !== "PREFIX") {
    throw new Error("โหมด Scanner ต้องเป็น FOCUS หรือ PREFIX");
  }
  // Keep these nullable through the upsert. Older callers know nothing about
  // scanner settings and must not silently reset an existing PREFIX device.
  const scannerMode = input.scannerMode ?? null;
  const scannerPrefixKey = input.scannerPrefixKey == null
    ? null
    : String(input.scannerPrefixKey).trim().toUpperCase();
  const rawScannerSuffixKey = input.scannerSuffixKey == null
    ? null
    : String(input.scannerSuffixKey).trim().toLowerCase();
  const scannerSuffixKey = rawScannerSuffixKey == null
    ? null
    : rawScannerSuffixKey === "enter"
      ? "Enter"
      : rawScannerSuffixKey === "tab"
        ? "Tab"
        : rawScannerSuffixKey;
  const scannerMaxGapMs = input.scannerMaxGapMs == null ? null : Number(input.scannerMaxGapMs);
  if (scannerPrefixKey != null && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(scannerPrefixKey)) {
    throw new Error("prefix ของ Scanner ต้องเป็นปุ่ม F1–F24");
  }
  if (scannerSuffixKey != null && scannerSuffixKey !== "Enter" && scannerSuffixKey !== "Tab") {
    throw new Error("suffix ของ Scanner ต้องเป็น Enter หรือ Tab");
  }
  if (scannerMaxGapMs != null && (!Number.isInteger(scannerMaxGapMs) || scannerMaxGapMs < 20 || scannerMaxGapMs > 1000)) {
    throw new Error("ช่วงห่างปุ่มของ Scanner ต้องอยู่ระหว่าง 20–1000 ms");
  }
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: writeContext?.editorId });
    const res = await client.query<any>(
      `INSERT INTO bms_pos_devices
         (id, tenant_id, location_id, code, name, registered_pos_no, receipt_prefix,
          scanner_mode, scanner_prefix_key, scanner_suffix_key, scanner_max_gap_ms, active)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7,
               COALESCE($8, 'FOCUS'), COALESCE($9, 'F9'), COALESCE($10, 'Enter'),
               COALESCE($11, 80), COALESCE($12, TRUE))
       ON CONFLICT (tenant_id, code)
       DO UPDATE SET location_id = EXCLUDED.location_id,
                     name = EXCLUDED.name,
                     registered_pos_no = EXCLUDED.registered_pos_no,
                     receipt_prefix = EXCLUDED.receipt_prefix,
                     scanner_mode = COALESCE($8, bms_pos_devices.scanner_mode),
                     scanner_prefix_key = COALESCE($9, bms_pos_devices.scanner_prefix_key),
                     scanner_suffix_key = COALESCE($10, bms_pos_devices.scanner_suffix_key),
                     scanner_max_gap_ms = COALESCE($11, bms_pos_devices.scanner_max_gap_ms),
                     active = EXCLUDED.active,
                     updated_at = now()
       RETURNING id, tenant_id, location_id, code, name, registered_pos_no, receipt_prefix,
                 scanner_mode, scanner_prefix_key, scanner_suffix_key, scanner_max_gap_ms, active`,
      [input.id ?? null, tenantId, input.locationId, input.code.trim(), input.name ?? null,
        input.registeredPosNo ?? null, input.receiptPrefix ?? null, scannerMode, scannerPrefixKey,
        scannerSuffixKey, scannerMaxGapMs, input.active ?? null]
    );
    const r = res.rows[0];
    if (writeContext?.auditActor) {
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1, $2, 'pos.device.upsert', $3, $4)`,
        [tenantId, writeContext.auditActor, r.id, JSON.stringify({
          code: r.code,
          scannerMode: r.scanner_mode,
          scannerPrefixKey: r.scanner_prefix_key,
          scannerSuffixKey: r.scanner_suffix_key,
          scannerMaxGapMs: Number(r.scanner_max_gap_ms),
        })]
      );
    }
    await client.query("COMMIT");
    return {
      id: r.id, tenantId: r.tenant_id, locationId: r.location_id, code: r.code,
      name: r.name ?? null, registeredPosNo: r.registered_pos_no ?? null,
      receiptPrefix: r.receipt_prefix ?? null,
      scannerMode: r.scanner_mode === "PREFIX" ? "PREFIX" : "FOCUS",
      scannerPrefixKey: r.scanner_prefix_key,
      scannerSuffixKey: r.scanner_suffix_key,
      scannerMaxGapMs: Number(r.scanner_max_gap_ms),
      active: r.active,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
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
  /**
   * ขั้นราคาส่งของสินค้านี้ (8.1) — ส่งให้จอเพื่อ "พรีวิว" ยอดเท่านั้น
   *
   * จอต้องคิดด้วยกฎเดียวกับ createOrder เป๊ะ ๆ รวมถึง scope แยก/รวมไซซ์
   * ไม่งั้นยอดที่จอโชว์กับยอดที่ server คิดต่างกัน → PAYMENT_MISMATCH · server ยัง
   * ตัดสินราคาเองตอน commit เสมอ ค่านี้ไม่ใช่ราคาที่เชื่อจาก client
   */
  priceTiers: PriceTier[];
  /** true = ต้องระบุเลขเครื่องครบทุกชิ้นก่อนขาย (8.3) — จอต้องกางช่องกรอกให้ */
  serialTracked: boolean;
  /**
   * โปรที่ใช้งานอยู่ของสินค้านี้ (8.7) — ส่งให้จอพรีวิวยอดด้วยกฎเดียวกับ createOrder
   * null = ไม่มีโปร หรือหมดช่วงเวลาไปแล้ว
   */
  promotion: Promotion | null;
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
  opts: { size?: string | null; locationId?: string | null; packCode?: string | null } = {}
): Promise<PosScanHit | null> {
  const barcode = code.trim();
  if (!barcode) return null;
  // ห้าม toUpperCase() — ไซซ์จริงมีตัวพิมพ์เล็ก ("150 ml", "60 ml") การแปลงเป็น
  // "150 ML" ทำให้เทียบกับ bms_inventory ไม่ตรงแล้วขายสินค้านั้นไม่ได้เลย
  // (เทียบแบบไม่สนตัวพิมพ์แทน แล้วคืนค่าไซซ์ตามที่เก็บไว้จริง)
  const size = opts.size?.trim() || null;
  const packCode = opts.packCode?.trim() || null;

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
            p.serial_tracked,
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
        AND (k.barcode = $2 OR (
          $5::text IS NOT NULL AND upper(p.sku) = upper($2) AND k.pack_code = $5
        ))
        AND ($3::text IS NULL OR k.size IS NULL OR upper(k.size) = upper($3))
        AND k.active
      WHERE p.tenant_id = $1
        AND p.active
        AND (
          ($5::text IS NULL AND (k.barcode = $2 OR p.barcode = $2 OR upper(p.sku) = upper($2)))
          OR ($5 = 'BASE' AND upper(p.sku) = upper($2)
              AND (k.pack_code = 'BASE' OR k.pack_code IS NULL))
          OR ($5 IS NOT NULL AND $5 <> 'BASE' AND upper(p.sku) = upper($2) AND k.pack_code = $5)
        )
      ORDER BY (k.pack_code = $5) DESC NULLS LAST,
               (k.barcode = $2) DESC NULLS LAST,
               (p.barcode = $2) DESC
      LIMIT 1`,
    [tenantId, barcode, size, opts.locationId ?? null, packCode]
  );

  const row = res.rows[0];
  if (!row || !row.size) return null;

  const promoRes = await query<any>(
    `SELECT kind, buy_qty, get_qty, bundle_price FROM bms_product_promotions
      WHERE tenant_id = $1 AND product_sku = $2 AND active
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at   IS NULL OR ends_at   >  now())
      LIMIT 1`,
    [tenantId, row.sku]
  );
  const promoRow = promoRes.rows[0];
  const promotion: Promotion | null = !promoRow
    ? null
    : promoRow.kind === "BUY_X_GET_Y"
      ? { kind: "BUY_X_GET_Y", buyQty: Number(promoRow.buy_qty), getQty: Number(promoRow.get_qty) }
      : { kind: "N_FOR_PRICE", buyQty: Number(promoRow.buy_qty), bundlePrice: Number(promoRow.bundle_price) };

  const tierRes = await query<{
    min_qty: number; unit_price: string | null; scope: PriceTier["scope"];
    discount_pct: string | null; size: string | null;
  }>(
    `SELECT min_qty, unit_price, scope, discount_pct, size FROM bms_product_price_tiers
      WHERE tenant_id = $1 AND product_sku = $2 ORDER BY min_qty`,
    [tenantId, row.sku]
  );
  const priceTiers: PriceTier[] = tierRes.rows.map((t) => ({
    minQty: Number(t.min_qty),
    scope: t.scope,
    size: t.size,
    unitPrice: t.unit_price == null ? null : Number(t.unit_price),
    discountPct: t.discount_pct == null ? null : Number(t.discount_pct),
  }));

  const basePrice = await getVariantBasePrice(tenantId, row.sku, row.size);
  if (basePrice == null) return null;
  const baseQty = row.base_qty ?? 1;
  // pack ไม่ตั้งราคาไว้ → ราคาต่อ pack = ราคาต่อหน่วยฐาน × base_qty (ไม่มีส่วนลดยกกล่อง)
  const resolvedPackCode = row.pack_code ?? "BASE";
  const packPrice = resolvedPackCode === "BASE"
    ? basePrice
    : row.pack_price != null ? Number(row.pack_price) : basePrice * baseQty;

  return {
    sku: row.sku,
    productName: row.name,
    receiptName: row.name,
    size: row.size,
    packCode: resolvedPackCode,
    unitName: row.unit_name ?? "ชิ้น",
    baseQty,
    packPrice,
    basePrice,
    priceTiers,
    serialTracked: (row as any).serial_tracked === true,
    promotion,
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

/** Staff selectable in the POS Receive tab; deliberately separate from sellers. */
export async function listPosPurchaseReceivers(tenantId: string): Promise<PosCashier[]> {
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
             WHERE rp.tenant_id = $1 AND rp.role_id = u.role_id AND rp.permission = 'purchase.receive'
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
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actingUserId });
    const target = await client.query<{ role_name: string | null }>(
      `SELECT r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1 AND u.id = $2 FOR UPDATE OF u`,
      [tenantId, userId]
    );
    if (!target.rowCount) throw new Error("ไม่พบพนักงานคนนี้ในร้าน");
    if (posOnly && target.rows[0].role_name === "Administrator") {
      throw new Error("ตั้ง Administrator เป็นบัญชีเฉพาะหน้าร้านไม่ได้");
    }
    await client.query(`UPDATE users SET pos_only = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, userId, posOnly]);
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, actingUserId, posOnly ? "pos.staff.pos_only_on" : "pos.staff.pos_only_off", userId,
        JSON.stringify({ posOnly })]
    );
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
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
export async function setCashierPin(
  tenantId: string, userId: string, pin: string, actingUserId?: string | null
): Promise<void> {
  const clean = String(pin ?? "").trim();
  if (!/^[0-9]{4,8}$/.test(clean)) throw new Error("PIN ต้องเป็นตัวเลข 4–8 หลัก");
  const hash = await bcrypt.hash(clean, 10);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actingUserId ?? userId });
    const res = await client.query(
      `UPDATE users
          SET pos_pin_hash = $3, pos_pin_set_at = now(),
              pos_pin_failures = 0, pos_pin_locked_until = NULL
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, userId, hash]
    );
    if (!res.rowCount) throw new Error("ไม่พบพนักงานคนนี้ในร้าน");
    if (actingUserId) {
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'pos.pin.set',$3,'{}'::jsonb)`,
        [tenantId, actingUserId, userId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function clearCashierPin(
  tenantId: string, userId: string, actingUserId?: string | null
): Promise<void> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actingUserId ?? userId });
    const res = await client.query(
      `UPDATE users SET pos_pin_hash = NULL, pos_pin_set_at = NULL,
                        pos_pin_failures = 0, pos_pin_locked_until = NULL
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, userId]
    );
    if (!res.rowCount) throw new Error("ไม่พบพนักงานคนนี้ในร้าน");
    if (actingUserId) {
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'pos.pin.clear',$3,'{}'::jsonb)`,
        [tenantId, actingUserId, userId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
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
    // เพิ่มจากค่าปัจจุบันในฐานข้อมูลโดยตรง ไม่คำนวณจาก snapshot ที่อ่านก่อน bcrypt
    // เพราะ bcrypt เปิดหน้าต่างให้คำขอพร้อมกันหลายตัวอ่าน failures=0 เหมือนกัน แล้ว
    // เขียน 1 ทับกันทั้งหมดจนเดา PIN แบบ parallel ได้โดยไม่เคยถูกล็อก
    const failed = await query<{ pos_pin_locked_until: Date | null }>(
      `UPDATE users
          SET pos_pin_failures = CASE
                WHEN pos_pin_locked_until > now() THEN pos_pin_failures
                WHEN pos_pin_failures + 1 >= $3 THEN 0
                ELSE pos_pin_failures + 1
              END,
              pos_pin_locked_until = CASE
                WHEN pos_pin_locked_until > now() THEN pos_pin_locked_until
                WHEN pos_pin_failures + 1 >= $3 THEN now() + ($4 || ' minutes')::interval
                ELSE pos_pin_locked_until
              END
        WHERE tenant_id = $1 AND id = $2
        RETURNING pos_pin_locked_until`,
      [tenantId, userId, PIN_MAX_FAILURES, String(PIN_LOCK_MINUTES)]
    );
    const lockedUntil = failed.rows[0]?.pos_pin_locked_until ?? null;
    return lockedUntil && lockedUntil > new Date()
      ? { ok: false, reason: "LOCKED", lockedUntil: lockedUntil.toISOString() }
      : { ok: false, reason: "WRONG_PIN" };
  }

  // ระหว่าง bcrypt อาจมีคำขอผิดอีกตัวล็อกบัญชีไปแล้ว ต้องไม่ให้ผลสำเร็จจาก snapshot
  // เก่าล้าง failure แล้วผ่าน lock ใหม่เงียบ ๆ
  const cleared = await query(
    `UPDATE users SET pos_pin_failures = 0
      WHERE tenant_id = $1 AND id = $2
        AND (pos_pin_locked_until IS NULL OR pos_pin_locked_until <= now())`,
    [tenantId, userId]
  );
  if (!cleared.rowCount) {
    const locked = await query<{ pos_pin_locked_until: Date | null }>(
      `SELECT pos_pin_locked_until FROM users WHERE tenant_id = $1 AND id = $2`,
      [tenantId, userId]
    );
    const lockedUntil = locked.rows[0]?.pos_pin_locked_until;
    return { ok: false, reason: "LOCKED", lockedUntil: lockedUntil?.toISOString() };
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

  // การรับเงินทอนตั้งต้นเข้าลิ้นชักเป็นเหตุการณ์เงิน เท่ากับตอนปิดกะ — ต้องมี audit
  // คู่กับ pos.shift.close ไม่งั้นตอนไล่ยอดจะเห็นแค่ปลายทางว่าปิดกะด้วยเงินเท่าไร
  // แต่ไม่เห็นว่าใครเป็นคนบอกว่าเริ่มด้วยเท่าไร
  const openingFloat = Math.max(0, Number(input.openingFloat ?? 0));
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: input.openedBy });
    const res = await client.query(
      `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float, pharmacist_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, device.rows[0].location_id, deviceId, input.openedBy,
        openingFloat, input.pharmacistUserId ?? null]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'pos.shift.open', $3, $4)`,
      [tenantId, input.openedBy, res.rows[0].id, JSON.stringify({
        deviceId,
        locationId: device.rows[0].location_id,
        openingFloat,
        pharmacistUserId: input.pharmacistUserId ?? null,
      })]
    );
    await client.query("COMMIT");
    return { status: "OPENED", shift: mapShift(res.rows[0]) };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
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
 * ปิดกะ: เงินที่ควรมี = เงินตั้งต้น + เงินสดที่รับในกะนี้ − เงินคืนสด
 *                        + เงินที่นำเข้าลิ้นชัก − เงินที่นำออก (7.97)
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
  | { status: "CLOSED"; shift: PosShift; partialReturnCashOut: number; cashIn: number; cashOut: number }
  | { status: "NOT_OPEN" }
  | { status: "PENDING_REFUNDS"; count: number; amount: number }
  | { status: "PENDING_EXPENSES"; count: number; amount: number }
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

    // เบิกเงินไปซื้อของแล้วต้องกลับมาลงยอดจริง/เงินทอนก่อนปิดกะ ไม่เช่นนั้น
    // cash drawer จะปิดได้ แต่รายงานค่าใช้จ่ายของวันนั้นยังไม่มีคำตอบว่าใช้จริงเท่าไร
    const pendingExpenses = await client.query<{ count: string; amount: string }>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(advanced_amount), 0)::text AS amount
         FROM bms_pos_expenses
        WHERE tenant_id = $1 AND shift_id = $2 AND status = 'OPEN'`,
      [input.tenantId, input.shiftId]
    );
    if (Number(pendingExpenses.rows[0]?.count ?? 0) > 0) {
      await client.query("ROLLBACK");
      return {
        status: "PENDING_EXPENSES",
        count: Number(pendingExpenses.rows[0].count),
        amount: Number(pendingExpenses.rows[0].amount),
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

    // เงินเข้า-ออกลิ้นชักที่ไม่ใช่การขาย (7.97) — ถอนไปฝากธนาคาร ยืมเงินทอน จ่ายค่าของ
    // ก่อนมีตารางนี้ รายการพวกนี้ทำให้ปิดกะขึ้นเงินขาดทุกครั้งโดยไม่มีที่ให้อธิบาย
    const movements = await client.query<{ cash_in: string; cash_out: string }>(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'IN'), 0)  AS cash_in,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'OUT'), 0) AS cash_out
         FROM bms_pos_cash_movements
        WHERE tenant_id = $1 AND shift_id = $2`,
      [input.tenantId, input.shiftId]
    );
    const cashIn = Number(movements.rows[0]?.cash_in ?? 0);
    const cashOut = Number(movements.rows[0]?.cash_out ?? 0);

    const expected = Number(open.rows[0].opening_float) + Number(cash.rows[0].total)
      - partialReturnCashOut + cashIn - cashOut;

    const res = await client.query(
      `UPDATE bms_pos_shifts
          SET status = 'CLOSED', closed_by = $3, closed_at = now(),
              expected_cash = $4, counted_cash = $5, note = $6, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'
        RETURNING *`,
      [input.tenantId, input.shiftId, input.closedBy, expected,
        Math.max(0, Number(input.countedCash)), input.note ?? null]
    );

    // ปิดกะคือจังหวะที่ผู้จัดการเซ็นรับเงินจากแคชเชียร์ — เงินขาด/เกินต้องมีบรรทัด
    // ของตัวเองใน audit log ไม่ใช่อยู่แค่ในคอลัมน์ของกะที่ต้องรู้ก่อนว่าจะไปหาที่ไหน
    const counted = Math.max(0, Number(input.countedCash));
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'pos.shift.close', $3, $4)`,
      [input.tenantId, input.closedBy, input.shiftId, JSON.stringify({
        expectedCash: expected,
        countedCash: counted,
        variance: Math.round((counted - expected) * 100) / 100,
        cashIn,
        cashOut,
        partialReturnCashOut,
      })]
    );

    await client.query("COMMIT");
    return { status: "CLOSED", shift: mapShift(res.rows[0]), partialReturnCashOut, cashIn, cashOut };
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
  /**
   * เลขเครื่องของแต่ละชิ้นในบรรทัดนี้ (8.3) — บังคับเมื่อสินค้าเปิด serial_tracked
   * จำนวนต้องเท่ากับจำนวนหน่วยฐานที่ขายพอดี ไม่ใช่จำนวน pack
   */
  serials?: string[] | null;
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
  /** SALE = รับเต็มยอดและส่งของทันที; DEPOSIT = จองของและรับมัดจำงวดแรก */
  mode?: "SALE" | "DEPOSIT";
  lines: PosSaleLine[];
  /** SALE จ่ายผสมได้และต้องครบยอด; DEPOSIT รับงวดแรกด้วย 1 วิธีและต้องต่ำกว่ายอดบิล */
  payments: PosPaymentInput[];
  couponCode?: string | null;
  /** สมาชิกที่พนักงานค้นเจอที่เคาน์เตอร์ — ได้ส่วนลดตามชั้นและสะสมแต้ม (7.96) */
  customerId?: string | null;
  /** แต้มที่ลูกค้าขอแลกเป็นส่วนลดบิลนี้ */
  pointsToRedeem?: number | null;
  /** ค่าบริการ/ค่าถุง ที่ไม่ใช่สินค้าในคลัง (8.6) */
  extraLines?: Array<{ label: string; qty?: number; unitAmount: number }> | null;
  /** ส่วนลดมือเป็นบาท — ต้องมาคู่กับ discountApprovedBy/discountReason เสมอ */
  manualDiscount?: number | null;
  discountApprovedBy?: string | null;
  discountReason?: string | null;
  /**
   * คนที่อนุมัติให้ปล่อยเชื่อ (9.30) — route ตรวจ PIN + สิทธิ์ `ar.sell` มาแล้ว
   *
   * ต่างจาก discountApprovedBy ข้อเดียว: **เป็นคนขายเองได้** ถ้าคนขายมีสิทธิ์
   * ร้านค้าส่งที่ขายเชื่อทุกบิลถ้าต้องตามคนที่สองมากดทุกครั้งจะเลิกใช้ระบบ —
   * กฎเดียวกับที่เภสัชกรอนุมัติตัวเองได้ที่ 9.29
   */
  creditApprovedBy?: string | null;
  pharmacyApprovedAssessmentId?: string | null;
  /**
   * เภสัชกรที่กด PIN อนุมัติจ่ายยาที่เครื่อง (9.29) — route ตรวจ PIN + ใบอนุญาตมาแล้ว
   * createOrder ตรวจใบอนุญาตซ้ำในทรานแซกชันและเขียนหลักฐานเอง
   */
  pharmacistCounterAuthorization?: { pharmacistUserId: string; note?: string | null } | null;
  /**
   * เคสในคิวเภสัชกรที่ผูกกับบิลใบนี้และ **ยังไม่ได้อนุมัติ** (9.29)
   *
   * ถ้าเภสัชกรเดินมาอนุมัติที่เครื่องแทนที่จะอนุมัติในคิว เคสนั้นต้องถูกปิด ไม่ใช่ค้างไว้ —
   * เคสที่ค้างแล้วมีคนไปกดอนุมัติทีหลังจะกลายเป็นใบอนุมัติที่ใช้ขายได้อีกใบ ทั้งที่ของ
   * ออกจากร้านไปแล้ว
   *
   * รับ id จากหน้าจอได้ แต่ **ไม่ใช่เชื่อ**: การปิดเกิดในทรานแซกชันของบิล และ
   * `closeAssessmentSupersededByCounterInTx()` ตรวจก่อนว่าเป็นเคสของเครื่องขาย
   * (`channel_id`), ของกะที่กำลังขายอยู่ และเป็นเรื่องของตะกร้าใบนี้จริง — ไม่งั้นเครื่อง
   * หนึ่งเครื่องจะปิดเคสของลูกค้าคนอื่นในร้านเดียวกันได้ด้วย id ที่เดามา
   */
  pharmacyReviewAssessmentId?: string | null;
};

/** จำนวนและไซซ์ที่ resolve จาก catalog แล้ว; client มีหน้าที่ส่งเฉพาะเลข serial */
type CanonicalPosSerialLine = {
  sku: string;
  size: string;
  quantity: number;
  serials: string[];
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

export type PosReceiptDiscountLine = {
  source: OrderDiscountLine["source"] | "PRICING";
  label: string;
  amount: number;
  pointsUsed: number;
};

/**
 * ส่วนลดที่ต้องพิมพ์ให้ผลรวมรายการบนกระดาษตรงกับยอดสุทธิจริง
 *
 * bms_order_discounts เก็บเฉพาะส่วนลดระดับบิล ส่วนราคาส่ง/โปรโมชันถูกฝังใน
 * unit_price/ยอดออร์เดอร์อยู่แล้ว จึงต้องเทียบกับ receipt_unit_price snapshot
 * แยกต่างหาก ห้ามอ่านราคาสินค้าปัจจุบันตอนพิมพ์ซ้ำ
 */
async function loadPosReceiptDiscountLines(
  db: {
    query<T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]): Promise<QueryResult<T>>;
  },
  tenantId: string,
  orderId: string
): Promise<PosReceiptDiscountLine[]> {
  const [head, stored] = await Promise.all([
    db.query<{
      total_amount: string;
      discount_amount: string;
      receipt_gross: string;
      extra_total: string;
    }>(
      `SELECT o.total_amount,
              o.discount_amount,
              COALESCE((
                SELECT SUM(COALESCE(oi.pack_qty, oi.qty) * oi.receipt_unit_price)
                  FROM bms_order_items oi
                 WHERE oi.tenant_id = o.tenant_id AND oi.order_id = o.id
              ), 0) AS receipt_gross,
              COALESCE((
                SELECT SUM(extra.qty * extra.unit_amount)
                  FROM bms_order_extra_lines extra
                 WHERE extra.tenant_id = o.tenant_id AND extra.order_id = o.id
              ), 0) AS extra_total
         FROM bms_orders o
        WHERE o.tenant_id = $1 AND o.id = $2`,
      [tenantId, orderId]
    ),
    db.query<{ source: OrderDiscountLine["source"]; label: string; amount: string; points_used: number }>(
      `SELECT source, label, amount, points_used
         FROM bms_order_discounts
        WHERE tenant_id = $1 AND order_id = $2
        ORDER BY id`,
      [tenantId, orderId]
    ),
  ]);
  const row = head.rows[0];
  const result: PosReceiptDiscountLine[] = [];
  if (row) {
    const productTotalBeforeOrderDiscount = Number(row.total_amount)
      + Number(row.discount_amount)
      - Number(row.extra_total);
    const pricingDiscount = Math.round(
      Math.max(0, Number(row.receipt_gross) - productTotalBeforeOrderDiscount) * 100
    ) / 100;
    if (pricingDiscount > 0) {
      result.push({
        source: "PRICING",
        label: "ส่วนลดราคาส่ง/โปรโมชั่น",
        amount: pricingDiscount,
        pointsUsed: 0,
      });
    }
  }
  result.push(...stored.rows.map((row) => ({
    source: row.source,
    label: row.label,
    amount: Number(row.amount),
    pointsUsed: Number(row.points_used ?? 0),
  })));
  return result;
}

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
      discountLines: PosReceiptDiscountLine[];
      /** แต้มที่ได้จากบิลนี้ · null = บิลนี้ไม่ผูกสมาชิก/ร้านปิดโปรแกรม */
      pointsEarned: number | null;
      /** แต้มคงเหลือของสมาชิกหลังบิลนี้ (พิมพ์บนใบเสร็จ) */
      pointsBalance: number | null;
      /** true = คีย์นี้เคยขายไปแล้ว คืนบิลเดิม ไม่ได้ขายซ้ำ */
      replayed: boolean;
    }
  | {
      status: "DEPOSIT_TAKEN";
      orderId: string;
      total: number;
      deposit: Deposit;
      /** true = คีย์นี้เคยรับมัดจำแล้ว คืนรายการเดิมโดยไม่รับเงินซ้ำ */
      replayed: boolean;
    }
  | { status: "DEPOSIT_INVALID"; reason: string }
  | { status: "SHIFT_NOT_OPEN" }
  | { status: "EMPTY" }
  | { status: "LOT_EXPIRED_OR_SHORT"; sku: string; size: string; sellable: number; requested: number }
  | { status: "INVALID_PACK"; sku: string; packCode: string }
  | { status: "PAYMENT_FAILED"; reason: string }
  | {
      status: "PAYMENT_MISMATCH";
      expected: number;
      received: number;
      subtotal?: number;
      discount?: number;
      pointsUsed?: number;
    }
  /** สินค้าที่ติดตามเลขเครื่องแต่ยังไม่ได้ระบุเลขให้ครบทุกชิ้น (8.3) */
  | { status: "SERIAL_REQUIRED"; sku: string; expected: number; received: number }
  /** เลขเครื่องนี้เคยขายไปแล้ว — เกือบแน่นอนว่ายิงกล่องผิดใบ */
  | { status: "SERIAL_ALREADY_SOLD"; sku: string; serial: string }
  /** บัตรของขวัญ/เครดิตร้านใช้ไม่ได้ (8.9) */
  | { status: "CREDIT_INVALID"; reason: string; code: string }
  | { status: "CREDIT_INSUFFICIENT"; code: string; balance: number; requested: number }
  /** ขายเชื่อไม่ได้ — ไม่มีบัญชี / ถูกระงับ / เกินวงเงิน (9.30) */
  | {
      status: "AR_NOT_ALLOWED";
      reason: string;
      code: "NO_CUSTOMER" | "NO_ACCOUNT" | "ON_HOLD" | "CLOSED" | "LIMIT_EXCEEDED";
    }
  /** ทุกสถานะปฏิเสธจาก createOrder ส่งต่อตามเดิม รวมกฎการขายยา */
  | { status: string; [k: string]: unknown };

export type PosRecentReceipt = {
  orderId: string;
  docNo: string | null;
  /** เครื่อง/สาขาต้นทางของบิลนี้ — ใช้แยก "ค้นเจอเพื่อดู/พิมพ์" ออกจาก "คืนได้ที่เครื่องนี้" */
  posDeviceId: string | null;
  locationName: string | null;
  branchCode: string | null;
  posLabel: string | null;
  /** สมาชิกที่ผูกกับบิลนี้ (7.96) — null = บิลไม่ผูกสมาชิก · ใช้ตอนกด "เปลี่ยนสินค้า"
      เพื่อยกสมาชิกเดิมมาที่บิลใหม่ ไม่ให้พนักงานต้องค้นซ้ำแล้วลืม */
  memberNo: string | null;
  memberName: string | null;
  memberPhone: string | null;
  vat: PosReceiptVat | null;
  roundingAmount: number;
  orderStatus: string;
  /** ยกเลิกแล้วเมื่อไร (7.97) — null = ยังไม่ถูกยกเลิก */
  voidedAt: string | null;
  /** กะที่บิลนี้เกิด — จอใช้ตัดสินว่ายังกด "ยกเลิกบิล" ได้ไหม (void ได้เฉพาะกะที่ยังเปิด) */
  shiftId: string | null;
  total: number;
  cashTendered: number | null;
  cashChange: number | null;
  paymentMethod: PaymentMethod | null;
  paymentRef: string | null;
  soldAt: string;
  cashierName: string | null;
  /** ราคาส่ง/โปรโมชัน + ส่วนลดระดับบิล ตาม snapshot ตอนขาย */
  discountLines: PosReceiptDiscountLine[];
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
  /** ลำดับเหตุการณ์คืนของบิลนี้ ใช้หน้า POS อธิบายบิลขายเดิม -> รับคืน -> คืนเงินจริง */
  returnEvents: Array<{
    id: string;
    returnMode: "FULL" | "PARTIAL";
    isVoid: boolean;
    refundAmount: number;
    pricingAdjustmentAmount: number;
    remainingAmount: number | null;
    settlementStatus: "PENDING" | "COMPLETED";
    note: string | null;
    returnedAt: string;
    returnedByName: string | null;
    approvedByName: string | null;
    creditNoteNo: string | null;
    items: Array<{
      orderItemId: number;
      sku: string;
      receiptName: string;
      size: string;
      packQty: number;
      refundAmount: number;
    }>;
    refunds: Array<PosRefundAllocation & {
      completedAt: string | null;
      completedByName: string | null;
    }>;
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
  | { ok: true; items: OrderItemInput[]; serialLines: CanonicalPosSerialLine[] }
  | { ok: false; sku: string; packCode: string }
> {
  const items: OrderItemInput[] = [];
  const serialLines: CanonicalPosSerialLine[] = [];
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
      serial_tracked: boolean;
    }>(
      `SELECT COALESCE(sized_base.price, shared_base.price, p.price) AS base_price,
              p.serial_tracked,
              k.pack_code,
              k.unit_name,
              k.base_qty,
              k.price AS pack_price,
              (SELECT i.size FROM bms_inventory i
                WHERE i.tenant_id = p.tenant_id AND i.location_id = $3
                  AND i.product_sku = p.sku AND upper(i.size) = upper($5)
                LIMIT 1) AS stored_size
         FROM bms_products p
         LEFT JOIN LATERAL (
           SELECT pack_code, unit_name, base_qty, price
             FROM bms_product_packs
            WHERE tenant_id = p.tenant_id
              AND product_sku = p.sku
              AND upper(pack_code) = $4
              AND active
              AND (size IS NULL OR upper(size) = upper($5))
            ORDER BY (size IS NOT NULL) DESC
            LIMIT 1
         ) k ON TRUE
         LEFT JOIN bms_product_packs sized_base
           ON sized_base.tenant_id = p.tenant_id
          AND sized_base.product_sku = p.sku
          AND upper(sized_base.size) = upper($5)
          AND sized_base.is_base AND sized_base.active
         LEFT JOIN bms_product_packs shared_base
           ON shared_base.tenant_id = p.tenant_id
          AND shared_base.product_sku = p.sku
          AND shared_base.size IS NULL
          AND shared_base.is_base AND shared_base.active
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
      // BASE คือหน่วยฐานและต้องให้ createOrder ใช้ราคาส่ง/โปรโมชันได้
      // มีเพียง packCode ที่ตั้งชื่อแยกเท่านั้นที่ยึดราคาแพ็กคงที่
      packUnitPrice: isFixedPricePack(packCode) ? packPrice : null,
    });
    if (row.serial_tracked) {
      serialLines.push({
        sku,
        size: row.stored_size ?? size,
        quantity: packQty * baseQty,
        serials: (line.serials ?? []).map((value) => String(value ?? "").trim()).filter(Boolean),
      });
    }
  }
  return { ok: true, items, serialLines };
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
              COALESCE(SUM(qty) FILTER (WHERE expiry_date IS NULL OR expiry_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date), 0) AS sellable
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
         -- อ่านจาก view ไม่ใช่ bms_order_items ตรง ๆ (8.8) — บรรทัดที่เป็นสินค้าชุด
         -- ถูกแทนด้วยส่วนประกอบแล้ว · ถ้าอ่านตารางตรง ๆ จะไปลดสต็อกของเซ็ตซึ่งเป็น 0
         -- ตลอด แล้วชน CHECK (current_stock >= 0) กลางการปิดบิล
         SELECT tenant_id, location_id, product_sku, size, SUM(qty)::integer AS qty
           FROM bms_order_stock_lines WHERE tenant_id = $2 AND order_id = $1
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
  // view ไม่ใช่ตารางตรง ๆ (8.8) — ส่วนประกอบของสินค้าชุดที่เป็นสินค้ามีล็อตต้องถูก
  // ตัดล็อตด้วย · ถ้าอ่านตารางตรง ๆ สต็อกจะลด (view ถูกใช้ข้างบนแล้ว) แต่ล็อตไม่ลด
  // แล้วยอดล็อตกับยอดสต็อกแยกกันเงียบ ๆ จนกว่าจะมีคนไปกระทบยอด
  const items = await client.query<{ id: string; location_id: string; product_sku: string; size: string; qty: number }>(
    `SELECT order_item_id AS id, location_id, product_sku, size, qty
       FROM bms_order_stock_lines WHERE tenant_id = $1 AND order_id = $2`,
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
          AND qty > 0 AND (expiry_date IS NULL OR expiry_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date)
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
  const isDeposit = input.mode === "DEPOSIT";

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
  if (!isDeposit) {
    const replay = await findSaleByIdempotencyKey(tenantId, input.deviceId, input.shiftId, key);
    if (replay) return replay;
  }

  const requestedPayments = input.payments
    .map((payment) => ({
      ...payment,
      amount: Math.round(Number(payment.amount) * 100) / 100,
      cashTendered: payment.cashTendered == null ? null : Math.round(Number(payment.cashTendered) * 100) / 100,
      ref: payment.ref?.trim() || null,
    }))
    .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);
  if (requestedPayments.length === 0) return { status: "PAYMENT_FAILED", reason: "ต้องระบุการชำระเงิน" };
  if (isDeposit && requestedPayments.length !== 1) {
    return { status: "DEPOSIT_INVALID", reason: "มัดจำครั้งแรกรับได้ครั้งละ 1 วิธีชำระเงิน" };
  }
  if (isDeposit && requestedPayments[0]?.method === "STORE_CREDIT") {
    return { status: "DEPOSIT_INVALID", reason: "ยังไม่รองรับเครดิตร้านเป็นเงินมัดจำ" };
  }
  const invalidCash = requestedPayments.find(
    (payment) => payment.method === "CASH" && payment.cashTendered != null
      && (!Number.isFinite(payment.cashTendered) || payment.cashTendered < payment.amount)
  );
  if (invalidCash) return { status: "PAYMENT_FAILED", reason: "เงินสดที่รับมาต้องไม่น้อยกว่ายอดเงินสด" };
  const roundingSettings = await getVatSettings(tenantId);
  const cashOnly = requestedPayments.every((payment) => payment.method === "CASH");
  const applyCashRounding = (baseDue: number) => {
    const roundingAmount = cashOnly && roundingSettings.cashRounding !== "NONE"
      ? cashRoundingDelta(baseDue, roundingSettings.cashRounding)
      : 0;
    return {
      roundingAmount,
      amountDue: Math.round((baseDue + roundingAmount) * 100) / 100,
    };
  };

  // ราคา จำนวนชิ้นต่อ pack และไซซ์จริงมาจากฐานข้อมูลก่อนตรวจ serial เสมอ
  // ห้ามใช้ baseQty ที่ browser ส่งมาเป็น authority เพราะปลอมเป็น 1 เพื่อข้ามกฎได้
  const canonical = await canonicalizePosSaleLines(tenantId, shift.location_id, input.lines);
  if (!canonical.ok) return { status: "INVALID_PACK", sku: canonical.sku, packCode: canonical.packCode };
  const items = canonical.items;
  if (items.length === 0) return { status: "EMPTY" };

  // ---- เลขเครื่อง (8.3) ----
  // ตรวจก่อนเรียก createOrder โดยตั้งใจ: ล้มตรงนี้ยังไม่มีสต็อกถูกตัด ไม่มีแต้มถูกหัก
  // ไม่มีคูปองถูกนับ · จำนวนที่ต้องมีใช้ canonical pack conversion ด้านบน
  if (!isDeposit) {
    const serialCheck = await validatePosSaleSerials(tenantId, canonical.serialLines);
    if (serialCheck) return serialCheck;
  }

  // ---- บัตรของขวัญ / เครดิตร้าน (8.9) ----
  // ตรวจก่อนสร้างบิลเช่นเดียวกับเลขเครื่อง: บัตรผิด/ยอดไม่พอ ต้องล้มก่อนตัดสต็อก
  // การหักจริงเกิดในทรานแซกชันที่ปิดการขาย (finalizePosSale) พร้อม FOR UPDATE
  for (const payment of input.payments) {
    if (payment.method !== "STORE_CREDIT") continue;
    const code = (payment.ref ?? "").trim();
    if (!code) return { status: "PAYMENT_FAILED", reason: "จ่ายด้วยบัตรต้องระบุโค้ดบัตร" };
    const credit = await findStoreCredit(tenantId, code);
    if (!credit) return { status: "CREDIT_INVALID", reason: "ไม่พบบัตรนี้", code };
    if (credit.status !== "ACTIVE") return { status: "CREDIT_INVALID", reason: "บัตรนี้ใช้ไม่ได้แล้ว", code };
    if (credit.expiresAt && new Date(credit.expiresAt).getTime() <= Date.now()) {
      return { status: "CREDIT_INVALID", reason: "บัตรนี้หมดอายุแล้ว", code };
    }
    if (credit.balance + 0.001 < payment.amount) {
      return { status: "CREDIT_INSUFFICIENT", code, balance: credit.balance, requested: payment.amount };
    }
  }

  // ---- ขายเชื่อ (9.30) ----
  // ด่านแรกก่อนสร้างบิลด้วยเหตุผลเดียวกับบัตรของขวัญ: เกินวงเงินต้องล้มก่อนตัดสต็อก
  // ไม่ใช่หลังจากที่ของถูกจองไปแล้ว · การตัดสินใจจริงเกิดซ้ำใน chargeArInTx พร้อม
  // FOR UPDATE เพราะสองเครื่องขายเชื่อให้ลูกค้าคนเดียวกันพร้อมกันได้
  const arAmount = Math.round(
    requestedPayments
      .filter((payment) => payment.method === "CREDIT")
      .reduce((sum, payment) => sum + payment.amount, 0) * 100
  ) / 100;
  if (arAmount > 0) {
    if (isDeposit) {
      return { status: "DEPOSIT_INVALID", reason: "มัดจำเป็นการรับเงิน ไม่ใช่การขายเชื่อ" };
    }
    // หนี้ที่ไม่รู้ว่าใครเป็นหนี้ไม่ใช่ลูกหนี้ — walk-in ขายเชื่อไม่ได้
    if (!input.customerId) {
      return {
        status: "AR_NOT_ALLOWED",
        code: "NO_CUSTOMER",
        reason: "ขายเชื่อต้องระบุลูกค้าก่อน",
      };
    }
    const verdict = await precheckArCharge(tenantId, input.customerId, arAmount);
    if (!verdict.ok) {
      return { status: "AR_NOT_ALLOWED", code: verdict.code, reason: verdict.reason };
    }
  }

  const existing = await findPosOrderByIdempotencyKey(tenantId, input.deviceId, input.shiftId, key);
  if (existing) {
    if (isDeposit) {
      if (existing.status !== "PENDING") {
        return { status: "DEPOSIT_INVALID", reason: `คีย์บิลนี้ถูกใช้กับสถานะ ${existing.status} แล้ว` };
      }
      return takeInitialPosDeposit({ input, shift, orderId: existing.orderId, payments: requestedPayments });
    }
    if (existing.status !== "PENDING" && existing.status !== "PAID") {
      return { status: "PAYMENT_FAILED", reason: `คีย์บิลนี้ถูกใช้กับสถานะ ${existing.status} แล้ว` };
    }
    const rounded = applyCashRounding(existing.amountDue);
    const paid = Math.round(requestedPayments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
    if (Math.abs(paid - rounded.amountDue) > 0.01) {
      return { status: "PAYMENT_MISMATCH", expected: rounded.amountDue, received: paid };
    }
    return finalizePosSale({
      input, shift, orderId: existing.orderId, amountDue: rounded.amountDue,
      payments: requestedPayments, replayed: true, serialLines: canonical.serialLines,
      roundingAmount: rounded.roundingAmount,
    });
  }

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
    extraLines: input.extraLines ?? null,
    manualDiscount: input.manualDiscount ?? null,
    discountApprovedBy: input.discountApprovedBy ?? null,
    discountReason: input.discountReason ?? null,
    pharmacyApprovedAssessmentId: input.pharmacyApprovedAssessmentId ?? null,
    pharmacistCounterAuthorization: input.pharmacistCounterAuthorization ?? null,
    // ปิดเฉพาะเมื่อการอนุมัติที่เคาน์เตอร์ถูกใช้จริง (createOrder เช็คซ้ำเอง)
    pharmacySupersededAssessmentId: input.pharmacyReviewAssessmentId ?? null,
  }).catch(async (err: any) => {
    // ชนคีย์กันบิลซ้ำ = อีกคำขอสร้างบิลเดียวกันไปแล้ว (23505 = unique_violation)
    if (err?.code === "23505") return null;
    throw err;
  });

  if (created === null) {
    if (!isDeposit) {
      const again = await findSaleByIdempotencyKey(tenantId, input.deviceId, input.shiftId, key);
      if (again) return again;
    }
    const pending = await findPosOrderByIdempotencyKey(tenantId, input.deviceId, input.shiftId, key);
    if (pending && ["PENDING", "PAID"].includes(pending.status)) {
      if (isDeposit) {
        if (pending.status !== "PENDING") {
          return { status: "DEPOSIT_INVALID", reason: `คีย์บิลนี้ถูกใช้กับสถานะ ${pending.status} แล้ว` };
        }
        return takeInitialPosDeposit({ input, shift, orderId: pending.orderId, payments: requestedPayments });
      }
      const rounded = applyCashRounding(pending.amountDue);
      const paid = Math.round(requestedPayments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
      if (Math.abs(paid - rounded.amountDue) > 0.01) {
        return { status: "PAYMENT_MISMATCH", expected: rounded.amountDue, received: paid };
      }
      return finalizePosSale({
        input, shift, orderId: pending.orderId, amountDue: rounded.amountDue,
        payments: requestedPayments, replayed: true, serialLines: canonical.serialLines,
        roundingAmount: rounded.roundingAmount,
      });
    }
    return { status: "PAYMENT_FAILED", reason: "คีย์บิลซ้ำแต่สถานะเดิมไม่สามารถทำต่อได้" };
  }
  if (created.status !== "CREATED") return created as PosSaleResult;

  const orderId = created.orderId;
  if (isDeposit) {
    const taken = await takeInitialPosDeposit({
      input,
      shift,
      orderId,
      payments: requestedPayments,
    });
    if (taken.status !== "DEPOSIT_TAKEN") {
      // createOrder จองสต็อกและอาจใช้คูปอง/แต้มไว้แล้ว ต้องคืนทุกอย่างถ้ารับมัดจำไม่ได้
      await cancelOrder(tenantId, orderId);
    }
    // ไม่ต้องประทับใบอนุมัติที่นี่ — createOrder ทำในทรานแซกชันของตัวเองแล้ว
    // หมายเหตุที่ตั้งใจ: มัดจำที่รับไม่สำเร็จถูก cancelOrder แต่ใบอนุมัติยังนับว่าใช้แล้ว
    // ลูกค้าต้องให้เภสัชกรตรวจใหม่ — เลือกทางที่เข้มกว่าไว้ก่อน เพราะทางกลับกัน
    // (คืนใบอนุมัติเมื่อยกเลิกบิล) เปิดช่องให้ยกเลิกเพื่อเอาใบอนุมัติกลับมาใช้ซ้ำ
    return taken;
  }
  const rounded = applyCashRounding(created.amountDue);
  const amountDue = rounded.amountDue;

  // ปัดเศษเงินสด (7.95) — เฉพาะบิลที่จ่ายสดล้วน เพราะบัตร/QR รับเต็มจำนวนได้อยู่แล้ว
  // ยอดปัดเก็บแยกบนบิล ไม่ใช่ส่วนลด จึงไม่แตะฐาน VAT (ตรงกับบรรทัด
  // "ยอดเงินปัดเศษ" บนใบกำกับจริงที่ใช้อ้างอิง)
  const paid = Math.round(requestedPayments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
  if (Math.abs(paid - amountDue) > 0.01) {
    await cancelOrder(tenantId, orderId);
    return {
      status: "PAYMENT_MISMATCH",
      expected: amountDue,
      received: paid,
      subtotal: created.subtotal,
      discount: created.discount,
      pointsUsed: created.pointsUsed,
    };
  }
  const sold = await finalizePosSale({
    input, shift, orderId, amountDue, payments: requestedPayments, replayed: false,
    serialLines: canonical.serialLines,
    roundingAmount: rounded.roundingAmount,
  });
  if (sold.status === "SERIAL_ALREADY_SOLD") {
    // createOrder จองสต็อกใน transaction ก่อนหน้าไว้แล้ว คู่แข่งอาจขาย serial
    // เดียวกันระหว่าง precheck กับ commit; ยกเลิกบิลใหม่เพื่อไม่ทิ้ง reserved_stock ค้าง
    await cancelOrder(tenantId, orderId);
  }

  // ทบทวนชั้นสมาชิกหลังบิลปิด (7.96) — นอกทรานแซกชันโดยตั้งใจ ล้มได้ไม่กระทบ
  // การขายที่เกิดขึ้นแล้ว · ถ้ารอ cron รายเดือน ลูกค้าที่ซื้อครบเกณฑ์วันนี้จะยัง
  // ไม่ได้ส่วนลดชั้นใหม่ในบิลถัดไป ซึ่งเป็นเรื่องที่พนักงานหน้าร้านต้องมาอธิบาย
  if (sold.status === "SOLD" && input.customerId) {
    void reviewMemberTier(input.tenantId, input.customerId).catch((e) =>
      console.error("[POS] ทบทวนชั้นสมาชิกหลังขายไม่สำเร็จ", input.customerId, e)
    );
  }
  // ปิดเคสในคิวที่ถูกแทนที่ด้วยการอนุมัติที่เคาน์เตอร์ (9.29) เกิดในทรานแซกชันของ
  // createOrder แล้ว (closeAssessmentSupersededByCounterInTx) — ที่นี่เคยยิงแบบ
  // best-effort หลัง commit ซึ่งปิดเคสที่คิวเพิ่งอนุมัติไม่ได้ (ไม่รับสถานะ APPROVED)
  // แล้วทิ้งใบอนุมัติที่ยังใช้ขายตะกร้าเดิมได้อีกใบไว้เงียบ ๆ

  // การประทับว่าใบอนุมัติถูกใช้แล้ว ย้ายไปอยู่ในทรานแซกชันของ createOrder แล้ว
  // (markAssessmentOrderCreatedInTx) — ที่นี่เคยยิงแบบ fire-and-forget หลัง commit
  // ซึ่งถ้าล้ม ใบอนุมัติจะยังใช้ซ้ำได้ทั้งที่ของออกจากคลังไปแล้ว

  return sold;
}

async function takeInitialPosDeposit(args: {
  input: PosSaleInput;
  shift: { id: string; location_id: string; device_id: string };
  orderId: string;
  payments: PosPaymentInput[];
}): Promise<PosSaleResult> {
  const payment = args.payments[0];
  if (!payment) return { status: "DEPOSIT_INVALID", reason: "ต้องระบุยอดมัดจำ" };

  const result = await takeDeposit({
    tenantId: args.input.tenantId,
    orderId: args.orderId,
    amount: payment.amount,
    method: payment.method,
    deviceId: args.input.deviceId,
    shiftId: args.shift.id,
    expectedLocationId: args.shift.location_id,
    createdBy: args.input.cashierUserId,
    idempotencyKey: args.input.idempotencyKey,
  });
  if (result.status !== "TAKEN") {
    return { status: "DEPOSIT_INVALID", reason: result.reason };
  }
  return {
    status: "DEPOSIT_TAKEN",
    orderId: args.orderId,
    total: result.deposit.totalAmount,
    deposit: result.deposit,
    replayed: Boolean(result.replayed),
  };
}

async function finalizePosSale(args: {
  input: PosSaleInput;
  shift: { id: string; location_id: string; device_id: string };
  orderId: string;
  amountDue: number;
  payments: PosPaymentInput[];
  replayed: boolean;
  /** SKU/size/จำนวนที่ resolve จากฐานข้อมูลแล้ว ใช้บังคับ serial ใน transaction */
  serialLines?: CanonicalPosSerialLine[];
  /** เก็บพร้อม payment/stock/tax ใน transaction เดียวกัน */
  roundingAmount?: number;
  /**
   * ยอดที่บิลนี้ "เคยรับไว้แล้ว" อย่างถูกต้อง — ใช้กับบิลมัดจำเท่านั้น (9.0)
   *
   * ปกติบิลค้างที่มีรายการชำระเงินอยู่แล้วถือว่าน่าสงสัยและถูกปฏิเสธ (กันการรับเงิน
   * ซ้ำจากบิลเดิม) · บิลมัดจำมีเงินมัดจำอยู่จริงตามการออกแบบ จึงต้องบอกยอดที่คาดไว้
   * มาด้วย แล้วด่านนี้เปลี่ยนจาก "ห้ามมีเลย" เป็น "ต้องมีเท่าที่บอกมาพอดี"
   * — ยังจับกรณีมีรายการเกินมาได้เหมือนเดิม
   */
  alreadyPaid?: number;
  /**
   * ปิดมัดจำใน transaction เดียวกับเงิน/สต็อก/ภาษี พร้อม re-stamp ผู้ส่งมอบจริง
   * ค่า expected ใช้จับ add/settle ที่ชนกัน ไม่ให้คำขอเก่าปิดยอดใหม่เงียบ ๆ
   */
  depositSettlement?: { expectedDepositPaid: number; expectedTotal: number };
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

    if (args.depositSettlement) {
      const deposit = await client.query<{ deposit_paid: string; total_amount: string }>(
        `SELECT deposit_paid, total_amount
           FROM bms_pos_deposits
          WHERE tenant_id = $1 AND order_id = $2 AND status = 'OPEN'
            AND location_id = $3
          FOR UPDATE`,
        [input.tenantId, orderId, shift.location_id]
      );
      const row = deposit.rows[0];
      if (!row) throw new Error("ไม่พบมัดจำที่เปิดอยู่ในสาขาของเครื่องนี้");
      if (
        Math.abs(Number(row.deposit_paid) - args.depositSettlement.expectedDepositPaid) > 0.01
        || Math.abs(Number(row.total_amount) - args.depositSettlement.expectedTotal) > 0.01
      ) {
        throw new Error("ยอดมัดจำเปลี่ยนระหว่างรับชำระ กรุณาโหลดรายการใหม่");
      }

      const stamped = await client.query(
        `UPDATE bms_orders
            SET pos_device_id = $3, pos_shift_id = $4, cashier_user_id = $5, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
        [input.tenantId, orderId, input.deviceId, shift.id, input.cashierUserId]
      );
      if (!stamped.rowCount) throw new Error("บิลมัดจำไม่ได้อยู่สถานะรอชำระ");
    }

    const orderLock = await client.query<{ status: string; total_amount: string; shipping_fee: string | null; rounding_amount: string | null }>(
      `SELECT status, total_amount, shipping_fee, rounding_amount FROM bms_orders
        WHERE tenant_id = $1 AND id = $2 AND pos_shift_id = $3
          AND pos_device_id = $4 AND cashier_user_id = $5
        FOR UPDATE`,
      [input.tenantId, orderId, shift.id, input.deviceId, input.cashierUserId]
    );
    if (!orderLock.rowCount) throw new Error("บิลไม่ตรงกับเครื่อง กะ หรือพนักงานผู้ขาย");
    const current = orderLock.rows[0];
    const roundingAmount = args.roundingAmount ?? Number(current.rounding_amount ?? 0);
    if (Math.abs(Number(current.rounding_amount ?? 0) - roundingAmount) > 0.001) {
      await client.query(
        `UPDATE bms_orders SET rounding_amount = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, orderId, roundingAmount]
      );
    }
    const lockedDue = Number(current.total_amount) + Number(current.shipping_fee ?? 0) + roundingAmount;
    if (Math.abs(lockedDue - amountDue) > 0.01) throw new Error("ยอดบิลเปลี่ยนระหว่างรับชำระ");

    let cashTendered: number | null = null;
    let cashChange: number | null = null;
    if (current.status === "PENDING") {
      // ล็อกแถวก่อน แล้วรวมยอดจากแถวที่ล็อกได้ — Postgres ไม่ยอมให้ FOR UPDATE
      // อยู่กับ aggregate ในคำสั่งเดียว
      const active = await client.query<{ amount: string }>(
        `SELECT amount FROM bms_payments
          WHERE tenant_id = $1 AND order_id = $2 AND status IN ('PENDING','CONFIRMED')
          FOR UPDATE`,
        [input.tenantId, orderId]
      );
      const expectedPaid = Math.round((args.alreadyPaid ?? 0) * 100) / 100;
      const foundPaid = Math.round(
        active.rows.reduce((sum, r) => sum + Number(r.amount), 0) * 100
      ) / 100;
      if (Math.abs(foundPaid - expectedPaid) > 0.01) {
        // ยอดที่มีอยู่ไม่ตรงกับที่คาด = มีการรับเงินที่ไม่ได้อยู่ในแผน ต้องมีคนดู
        throw new Error(
          expectedPaid > 0
            ? `ยอดที่รับไว้แล้วไม่ตรง (คาด ${expectedPaid} พบ ${foundPaid})`
            : "บิลค้างมีรายการชำระเงินเดิม ต้องตรวจสอบก่อนทำต่อ"
        );
      }

      for (const payment of payments) {
        const tendered = payment.method === "CASH"
          ? (payment.cashTendered == null ? payment.amount : Number(payment.cashTendered))
          : null;
        const change = tendered == null ? null : Math.round((tendered - payment.amount) * 100) / 100;
        await client.query(
          `INSERT INTO bms_payments
             (tenant_id, order_id, method, amount, status, slip_ref, verified_by,
              cash_tendered, cash_change, confirmed_at, updated_at)
           VALUES ($1, $2, $3, $4, 'CONFIRMED', $5, $6, $7, $8, now(), now())`,
          [input.tenantId, orderId, payment.method, payment.amount, payment.ref ?? null,
            input.cashierUserId, tendered, change]
        );
        if (tendered != null) {
          cashTendered = (cashTendered ?? 0) + tendered;
          cashChange = (cashChange ?? 0) + Number(change ?? 0);
        }
      }

      const paidOrder = await client.query(
        `UPDATE bms_orders SET status = 'PAID', paid_at = COALESCE(paid_at, now()), updated_at = now()
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
    // บัตรของขวัญ / เครดิตร้าน (8.9) — หักในทรานแซกชันเดียวกับการขาย
    //
    // ล็อกแถวบัตรด้วย FOR UPDATE เพราะบัตรใบเดียวถูกยิงสองเครื่องพร้อมกันได้
    // (คนซื้อบัตรให้กันแล้วใช้พร้อมกัน) ถ้าไม่ล็อก ทั้งสองเห็นยอดเดิมแล้วหักเกินยอด
    for (const payment of payments) {
      if (payment.method !== "STORE_CREDIT") continue;
      const code = (payment.ref ?? "").trim();
      const usable = await lockUsableCreditInTx(client, input.tenantId, code);
      if (!usable.ok) throw new Error(`บัตร ${code}: ${usable.reason}`);
      if (usable.balance + 0.001 < payment.amount) {
        throw new Error(`บัตร ${code} ยอดไม่พอ (เหลือ ${usable.balance})`);
      }
      await redeemCreditInTx(client, input.tenantId, {
        creditId: usable.creditId,
        orderId,
        amount: payment.amount,
        actorUserId: input.cashierUserId,
      });
    }

    // ขายเชื่อ (9.30) — ตั้งหนี้ในทรานแซกชันเดียวกับสต็อกและใบกำกับ
    //
    // ต้องอยู่ **หลัง** fulfilPosOrderInTx เพื่อให้ลำดับล็อกเป็น สต็อก → บัญชีลูกหนี้
    // ตรงกับเส้นทางคืนของ (ซึ่งล็อกสต็อกก่อนแล้วค่อยลดหนี้) · สลับที่ = deadlock 40P01
    // เมื่อบิลหนึ่งกำลังขายเชื่อพร้อมกับอีกบิลกำลังคืนของของลูกค้าคนเดียวกัน
    //
    // ล้มที่นี่ = ทั้งบิลถูก ROLLBACK ซึ่งเป็นสิ่งที่ต้องการ: ของออกจากร้านโดยไม่มี
    // ใครเป็นหนี้ กู้คืนด้วยมือไม่ได้เพราะไม่เหลือร่องรอยว่าตั้งใจให้ใครเป็นหนี้
    const arTotal = Math.round(
      payments.filter((p) => p.method === "CREDIT").reduce((sum, p) => sum + p.amount, 0) * 100
    ) / 100;
    if (arTotal > 0) {
      if (!input.customerId) throw new Error("ขายเชื่อต้องระบุลูกค้าก่อน");
      await chargeArInTx(client, input.tenantId, {
        customerId: input.customerId,
        orderId,
        amount: arTotal,
        locationId: shift.location_id,
        shiftId: shift.id,
        actorUserId: input.cashierUserId,
        approvedBy: input.creditApprovedBy ?? input.cashierUserId,
      });
    }

    // เลขเครื่อง (8.3) — ในทรานแซกชันเดียวกับการขาย
    // บิลที่ commit แล้วต้องไม่มีทางขาดเลขเครื่องของสินค้าที่บังคับเลขเครื่อง
    // ไม่งั้นประวัติประกันมีรูโดยไม่มีใครรู้จนวันที่มีคนมาเคลม
    await recordSerialsInTx(client, input.tenantId, shift.location_id, orderId, args.serialLines ?? []);

    if (args.depositSettlement) {
      await markDepositCompletedInTx(client, input.tenantId, orderId);
    }

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
    const receiptDiscountLines = await loadPosReceiptDiscountLines(client, input.tenantId, orderId);

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
      discountLines: receiptDiscountLines,
      pointsEarned: hasMember ? Number(loyaltyRow?.earned ?? 0) : null,
      pointsBalance: hasMember ? Number(loyaltyRow?.balance ?? 0) : null,
      // ผู้เรียกที่รู้ค่าปัดเศษจริงจะเขียนทับให้ (recordPosSale) — ทางที่มาถึงตรงนี้
      // โดยไม่ผ่านการปัด (เช่น replay บิลที่ค้างสถานะ) ไม่มีการปัดเพิ่มอยู่แล้ว
      roundingAmount,
      replayed,
    };
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch {}
    if (err instanceof PosSerialAlreadySoldError) {
      return { status: "SERIAL_ALREADY_SOLD", sku: err.sku, serial: err.serial };
    }
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
    discountLines: await loadPosReceiptDiscountLines({ query }, tenantId, row.id),
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
  opts: { query?: string | null; locationId?: string | null } = {}
): Promise<PosRecentReceipt[]> {
  const q = String(opts.query ?? "").trim();
  const matchedProduct = q
    ? await resolvePosScan(tenantId, q, { locationId: opts.locationId ?? null })
    : null;
  const matchedSku = matchedProduct?.sku ?? null;
  const matchedSize = matchedProduct?.size ?? null;
  const orderRes = await query<{
    id: string;
    pos_device_id: string | null;
    pos_device_code: string | null;
    pos_registered_pos_no: string | null;
    location_name: string | null;
    branch_code: string | null;
    total_amount: string;
    discount_amount: string;
    extra_total: string;
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
    member_phone: string | null;
    voided_at: Date | null;
    pos_shift_id: string | null;
  }>(
    `SELECT o.id,
            o.pos_device_id,
            o.voided_at,
            o.pos_shift_id,
            o.total_amount,
            o.discount_amount,
            o.shipping_fee,
            o.rounding_amount AS order_rounding,
            o.status,
            o.created_at,
            dev.code AS pos_device_code,
            dev.registered_pos_no AS pos_registered_pos_no,
            loc.name AS location_name,
            loc.branch_code,
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
            extras.extra_total,
            cust.member_no,
            cust.name AS member_name,
            cust.phone AS member_phone
       FROM bms_orders o
       LEFT JOIN bms_pos_devices dev ON dev.tenant_id = o.tenant_id AND dev.id = o.pos_device_id
       LEFT JOIN bms_locations loc ON loc.tenant_id = o.tenant_id AND loc.id = dev.location_id
       LEFT JOIN users u ON u.id = o.cashier_user_id AND u.tenant_id = o.tenant_id
       LEFT JOIN bms_customers cust ON cust.tenant_id = o.tenant_id AND cust.id = o.customer_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(extra.qty * extra.unit_amount), 0) AS extra_total
           FROM bms_order_extra_lines extra
          WHERE extra.tenant_id = o.tenant_id AND extra.order_id = o.id
       ) extras ON TRUE
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
        AND ($5::boolean OR o.pos_device_id = $2)
        AND o.channel = 'pos'
        AND o.status IN ('COMPLETED', 'RETURNED')
        AND (
          $4::text IS NULL
          OR o.id::text ILIKE '%' || $4 || '%'
          OR COALESCE(doc.doc_no, '') ILIKE '%' || $4 || '%'
          OR COALESCE(cust.member_no, '') ILIKE '%' || $4 || '%'
          OR COALESCE(cust.name, '') ILIKE '%' || $4 || '%'
          OR regexp_replace(COALESCE(cust.phone, ''), '[^0-9+]', '', 'g')
             ILIKE '%' || regexp_replace($4, '[^0-9+]', '', 'g') || '%'
          OR EXISTS (
            SELECT 1
              FROM bms_order_items oi
             WHERE oi.tenant_id = o.tenant_id
               AND oi.order_id = o.id
               AND (
                 upper(oi.product_sku) = upper($4)
                 OR COALESCE(oi.product_name, '') ILIKE '%' || $4 || '%'
                 OR (
                   $6::text IS NOT NULL
                   AND upper(oi.product_sku) = upper($6)
                   AND ($7::text IS NULL OR upper(oi.size) = upper($7))
                 )
               )
          )
        )
      ORDER BY (o.pos_device_id = $2) DESC, o.created_at DESC, o.id DESC
      LIMIT $3`,
    [
      tenantId,
      deviceId,
      Math.min(Math.max(limit, 1), 20),
      q || null,
      Boolean(q),
      matchedSku,
      matchedSize,
    ]
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
    receipt_unit_price: string;
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
            oi.receipt_unit_price,
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
    const receiptUnitPrice = Number(line.receipt_unit_price);
    const mapped = {
      orderItemId: line.id,
      sku: line.product_sku,
      receiptName: line.product_name,
      size: line.size,
      packCode: line.pack_code ?? "BASE",
      baseQty: Math.max(1, Math.round(line.qty / Math.max(1, packQty))),
      packPrice: receiptUnitPrice,
      basePrice: Number(line.unit_price),
      packQty,
      returnedPackQty: Number(line.returned_pack_qty ?? 0),
      refundablePackQty: Math.max(0, packQty - Number(line.returned_pack_qty ?? 0)),
      unitName: line.pack_unit_name ?? "ชิ้น",
      lineTotal: packQty * receiptUnitPrice,
    };
    const existing = linesByOrder.get(line.order_id) ?? [];
    existing.push(mapped);
    linesByOrder.set(line.order_id, existing);
  }

  const storedDiscounts = await query<{
    order_id: string;
    source: OrderDiscountLine["source"];
    label: string;
    amount: string;
    points_used: number;
  }>(
    `SELECT order_id, source, label, amount, points_used
       FROM bms_order_discounts
      WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])
      ORDER BY order_id, id`,
    [tenantId, orderIds]
  );
  const discountLinesByOrder = new Map<string, PosReceiptDiscountLine[]>();
  for (const row of orderRes.rows) {
    const receiptGross = (linesByOrder.get(row.id) ?? [])
      .reduce((sum, line) => sum + line.lineTotal, 0);
    const productTotalBeforeOrderDiscount = Number(row.total_amount)
      + Number(row.discount_amount)
      - Number(row.extra_total);
    const pricingDiscount = Math.round(
      Math.max(0, receiptGross - productTotalBeforeOrderDiscount) * 100
    ) / 100;
    if (pricingDiscount > 0) {
      discountLinesByOrder.set(row.id, [{
        source: "PRICING",
        label: "ส่วนลดราคาส่ง/โปรโมชั่น",
        amount: pricingDiscount,
        pointsUsed: 0,
      }]);
    }
  }
  for (const row of storedDiscounts.rows) {
    const existing = discountLinesByOrder.get(row.order_id) ?? [];
    existing.push({
      source: row.source,
      label: row.label,
      amount: Number(row.amount),
      pointsUsed: Number(row.points_used ?? 0),
    });
    discountLinesByOrder.set(row.order_id, existing);
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
            a.id, a.payment_id, a.method, a.amount, a.status, a.external_ref,
            a.completed_at, COALESCE(completed_user.name, completed_user.email) AS completed_by_name
       FROM bms_pos_returns pr
       JOIN bms_pos_refund_allocations a
         ON a.tenant_id = pr.tenant_id AND a.pos_return_id = pr.id
       LEFT JOIN users completed_user
         ON completed_user.tenant_id = a.tenant_id AND completed_user.id = a.completed_by
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

  const returnRows = await query<any>(
    `SELECT pr.order_id, pr.id, pr.return_mode, pr.is_void, pr.refund_amount,
            pr.pricing_adjustment_amount, pr.remaining_amount_after_return,
            pr.settlement_status, pr.note, pr.created_at,
            COALESCE(returned_user.name, returned_user.email) AS returned_by_name,
            COALESCE(approved_user.name, approved_user.email) AS approved_by_name,
            credit.doc_no AS credit_note_no
       FROM bms_pos_returns pr
       LEFT JOIN users returned_user
         ON returned_user.tenant_id = pr.tenant_id AND returned_user.id = pr.returned_by
       LEFT JOIN users approved_user
         ON approved_user.tenant_id = pr.tenant_id AND approved_user.id = pr.approved_by
       LEFT JOIN LATERAL (
         SELECT doc_no
           FROM bms_tax_documents
          WHERE tenant_id = pr.tenant_id
            AND order_id = pr.order_id
            AND doc_type = 'CREDIT_NOTE'
            AND cancelled_at IS NULL
            AND credit_reason LIKE '%[' || pr.id::text || ']%'
          ORDER BY issued_at DESC, id DESC
          LIMIT 1
       ) credit ON TRUE
      WHERE pr.tenant_id = $1 AND pr.order_id = ANY($2::uuid[])
      ORDER BY pr.created_at, pr.id`,
    [tenantId, orderIds]
  );
  const returnItemRows = await query<any>(
    `SELECT pr.order_id, pri.pos_return_id, pri.order_item_id, pri.pack_qty,
            pri.refund_amount, oi.product_sku, oi.product_name, oi.size
       FROM bms_pos_return_items pri
       JOIN bms_pos_returns pr
         ON pr.tenant_id = pri.tenant_id AND pr.id = pri.pos_return_id
       JOIN bms_order_items oi
         ON oi.tenant_id = pri.tenant_id AND oi.id = pri.order_item_id
      WHERE pri.tenant_id = $1 AND pr.order_id = ANY($2::uuid[])
      ORDER BY pr.created_at, pri.id`,
    [tenantId, orderIds]
  );
  const returnItemsByReturn = new Map<string, PosRecentReceipt["returnEvents"][number]["items"]>();
  for (const row of returnItemRows.rows) {
    const existing = returnItemsByReturn.get(row.pos_return_id) ?? [];
    existing.push({
      orderItemId: Number(row.order_item_id),
      sku: String(row.product_sku),
      receiptName: String(row.product_name),
      size: String(row.size),
      packQty: Number(row.pack_qty),
      refundAmount: Number(row.refund_amount),
    });
    returnItemsByReturn.set(row.pos_return_id, existing);
  }
  const returnRefundsByReturn = new Map<string, PosRecentReceipt["returnEvents"][number]["refunds"]>();
  for (const row of refundsRes.rows) {
    const existing = returnRefundsByReturn.get(row.pos_return_id) ?? [];
    existing.push({
      ...mapRefundAllocation(row),
      completedAt: row.completed_at ? toISO(row.completed_at) : null,
      completedByName: row.completed_by_name ?? null,
    });
    returnRefundsByReturn.set(row.pos_return_id, existing);
  }
  const returnEventsByOrder = new Map<string, PosRecentReceipt["returnEvents"]>();
  for (const row of returnRows.rows) {
    const existing = returnEventsByOrder.get(row.order_id) ?? [];
    existing.push({
      id: row.id,
      returnMode: row.return_mode,
      isVoid: Boolean(row.is_void),
      refundAmount: Number(row.refund_amount),
      pricingAdjustmentAmount: Number(row.pricing_adjustment_amount ?? 0),
      remainingAmount: row.remaining_amount_after_return == null
        ? null
        : Number(row.remaining_amount_after_return),
      settlementStatus: row.settlement_status,
      note: row.note ?? null,
      returnedAt: toISO(row.created_at),
      returnedByName: row.returned_by_name ?? null,
      approvedByName: row.approved_by_name ?? null,
      creditNoteNo: row.credit_note_no ?? null,
      items: returnItemsByReturn.get(row.id) ?? [],
      refunds: returnRefundsByReturn.get(row.id) ?? [],
    });
    returnEventsByOrder.set(row.order_id, existing);
  }

  return orderRes.rows.map((row) => ({
    orderId: row.id,
    docNo: row.doc_no ?? null,
    posDeviceId: row.pos_device_id ?? null,
    locationName: row.location_name ?? null,
    branchCode: row.branch_code ?? null,
    posLabel: row.pos_registered_pos_no ?? row.pos_device_code ?? null,
    vat: mapReceiptVat(row),
    roundingAmount: Number(row.order_rounding ?? 0),
    orderStatus: row.status,
    voidedAt: row.voided_at ? toISO(row.voided_at) : null,
    shiftId: row.pos_shift_id ?? null,
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
    memberPhone: row.member_phone ?? null,
    discountLines: discountLinesByOrder.get(row.id) ?? [],
    payments: paymentsByOrder.get(row.id) ?? [],
    refunds: refundsByOrder.get(row.id) ?? [],
    returnEvents: returnEventsByOrder.get(row.id) ?? [],
    lines: linesByOrder.get(row.id) ?? [],
  }));
}

export type PosReturnResult =
  | {
      status: "RETURNED";
      /** เลขใบลดหนี้ที่ออกให้การคืนครั้งนี้ — null เมื่อร้านไม่ได้จด VAT */
      creditNoteNo?: string | null;
      posReturnId: string;
      orderId: string;
      refundAmount: number;
      /** เวลาที่สร้างรายการคืนจริงจากฐานข้อมูล (คงเดิมเมื่อ replay idempotency key) */
      returnedAt: string;
      returnedItems: Array<{ orderItemId: number; packQty: number; refundAmount: number }>;
      settlementStatus: "PENDING" | "COMPLETED";
      refunds: PosRefundAllocation[];
      pricingAdjustmentAmount: number;
      remainingAmount: number;
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
  | { status: "REPRICE_PAYMENT_REQUIRED"; additionalAmount: number; remainingAmount: number }
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
      /** เวลาที่สร้างรายการคืนจริงจากฐานข้อมูล (คงเดิมเมื่อ replay idempotency key) */
      returnedAt: string;
      returnedItems: Array<{ orderItemId: number; packQty: number; refundAmount: number }>;
      settlementStatus: "PENDING" | "COMPLETED";
      refunds: PosRefundAllocation[];
      /** ยอดคืนที่ลดลงเพราะจำนวนคงเหลือไม่ผ่านราคาตามจำนวนเดิม */
      pricingAdjustmentAmount: number;
      /** มูลค่าสุทธิที่ยังคงอยู่บนการขายเดิมหลังการคืนครั้งนี้ */
      remainingAmount: number;
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
  | { status: "REPRICE_PAYMENT_REQUIRED"; additionalAmount: number; remainingAmount: number }
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
    creditNoteNo: result.creditNoteNo,
    posReturnId: result.posReturnId,
    orderId: result.orderId,
    refundAmount: result.refundAmount,
    returnedAt: result.returnedAt,
    returnedItems: result.returnedItems,
    settlementStatus: result.settlementStatus,
    refunds: result.refunds,
    pricingAdjustmentAmount: result.pricingAdjustmentAmount,
    remainingAmount: result.remainingAmount,
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

/**
 * ใบลดหนี้อยู่นอก tx การคืนโดยตั้งใจ แต่ retry ของ POS ต้องกลับมาทำส่วนนี้ซ้ำได้ด้วย:
 * ถ้าคำตอบหายหลัง COMMIT แต่ก่อน/หลังออกเอกสาร การยิง idempotency key เดิมต้อง
 * ได้เลขเดิมหรือเติมเอกสารที่ยังขาด ไม่ใช่ replay เฉพาะ stock/refund แล้วข้ามภาษี
 */
async function ensurePosReturnCreditNote(input: {
  tenantId: string;
  orderId: string;
  posReturnId: string;
  mode: "FULL" | "PARTIAL";
  refundAmount: number;
  actorUserId: string;
  returnedItems: Array<{ orderItemId: number; refundAmount: number }>;
}): Promise<string | null> {
  // คืนของได้ 0 บาทเมื่อของที่เก็บไว้เสียสิทธิ์โปรพอดีกับมูลค่าของที่คืน
  // ไม่มีมูลค่าให้ลดหนี้ จึงไม่ควรสร้างเอกสาร 0 บาทหรือรายงาน error หลอก
  if (input.refundAmount <= 0) return null;
  try {
    const note = await issueCreditNote({
      tenantId: input.tenantId,
      orderId: input.orderId,
      amount: input.refundAmount,
      reason: input.mode === "FULL" ? "รับคืนสินค้าทั้งบิล" : "รับคืนสินค้าบางรายการ",
      issuedBy: input.actorUserId,
      returnRef: input.posReturnId,
      returnedItems: input.returnedItems,
    });
    return note.status === "ISSUED" || note.status === "ALREADY_ISSUED"
      ? note.document.docNo
      : null;
  } catch (e) {
    console.error("[POS] ออกใบลดหนี้ไม่สำเร็จ", input.orderId, e);
    return null;
  }
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
  /**
   * true = การยกเลิกบิลที่กดผิด ไม่ใช่ลูกค้าเอาของมาคืน (7.97)
   * เครื่องจักรคืนของเหมือนกันทุกอย่าง ต่างแค่ธงที่ทำให้รายงานการคืนกรองออกได้
   * — ไม่งั้นการกดผิดจะไปปลุกสัญญาณจับทุจริตใน pos-return-audit
   */
  isVoid?: boolean;
  /** เหตุผลและกะของการยกเลิก — ใช้ประทับบิล/ยกเลิกใบกำกับใน tx เดียวกัน (ดู § void) */
  voidReason?: string | null;
  voidShiftId?: string | null;
}): Promise<PosPartialReturnResult> {
  const requestedMap = new Map<number, number>();
  for (const line of input.lines) {
    if (!Number.isInteger(line.orderItemId) || !Number.isInteger(line.packQty) || line.packQty <= 0) continue;
    requestedMap.set(line.orderItemId, (requestedMap.get(line.orderItemId) ?? 0) + line.packQty);
  }
  if (input.mode === "PARTIAL" && requestedMap.size === 0) return { status: "EMPTY" };

  const client = await getClient();
  let clientReleased = false;
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });

    const replay = await client.query<{
      id: string;
      order_id: string;
      pos_device_id: string | null;
      return_mode: "FULL" | "PARTIAL";
      refund_amount: string;
      settlement_status: "PENDING" | "COMPLETED";
      created_at: unknown;
      pricing_adjustment_amount: string;
      remaining_amount_after_return: string | null;
    }>(
      `SELECT id, order_id, pos_device_id, return_mode, refund_amount, settlement_status,
              created_at, pricing_adjustment_amount, remaining_amount_after_return
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
      // issueCreditNote เปิด tenant transaction ของตัวเอง จึงคืน connection นี้ก่อน
      // ป้องกัน deadlock เมื่อ instance ตั้ง POSTGRES_POOL_MAX=1
      client.release();
      clientReleased = true;
      const returnedItems = items.rows.map((row) => ({
        orderItemId: Number(row.order_item_id),
        packQty: Number(row.pack_qty),
        refundAmount: Number(row.refund_amount),
      }));
      const creditNoteNo = input.isVoid
        ? null
        : await ensurePosReturnCreditNote({
            tenantId: input.tenantId,
            orderId: input.orderId,
            posReturnId: existing.id,
            mode: existing.return_mode,
            refundAmount: Number(existing.refund_amount),
            actorUserId: input.actorUserId,
            returnedItems: returnedItems.map((item) => ({
              orderItemId: item.orderItemId,
              refundAmount: item.refundAmount,
            })),
          });
      return {
        status: "PARTIAL_RETURNED",
        posReturnId: existing.id,
        orderId: input.orderId,
        refundAmount: Number(existing.refund_amount),
        returnedAt: toISO(existing.created_at),
        returnedItems,
        settlementStatus: existing.settlement_status,
        refunds: refunds.rows.map(mapRefundAllocation),
        pricingAdjustmentAmount: Number(existing.pricing_adjustment_amount ?? 0),
        remainingAmount: Number(existing.remaining_amount_after_return ?? 0),
        creditNoteNo,
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
      discount_amount: string;
      extra_total: string;
    }>(
      `SELECT id, status, channel, pos_device_id, total_amount, shipping_fee,
              discount_amount,
              COALESCE((
                SELECT SUM(extra.qty * extra.unit_amount)
                  FROM bms_order_extra_lines extra
                 WHERE extra.tenant_id = bms_orders.tenant_id
                   AND extra.order_id = bms_orders.id
              ), 0) AS extra_total
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
      receipt_unit_price: string;
      pricing_snapshot: unknown;
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
              oi.receipt_unit_price,
              oi.pricing_snapshot,
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

    const rawCalculated = [...requestedMap.entries()].map(([orderItemId, packQty]) => {
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
    const rawRefundAmount = Math.round(rawCalculated.reduce(
      (sum, line) => sum + line.refundAmount, 0
    ) * 100) / 100;

    // ประเมิน "สินค้าที่ลูกค้าเก็บไว้" ใหม่ด้วยกติกาที่ snapshot ตอนขาย
    // ตัวอย่าง: 5 × 100 ได้ราคาส่ง 90 = 450; คืน 1 แล้วเหลือ 4 ไม่ถึงขั้นต่ำ
    // มูลค่าคงเหลือจึงเป็น 400 และคืนได้ 50 ไม่ใช่รักษาราคาส่งแล้วคืน 90
    const remainingPricing = priceRemainingLines(
      orderItems.map((item) => ({
        id: item.id,
        sku: item.product_sku,
        size: item.size,
        qty: Number(item.qty),
        packQty: Number(item.pack_qty ?? item.qty),
        returnedPackQty: Number(item.returned_pack_qty ?? 0),
        receiptUnitPrice: Number(item.receipt_unit_price),
        packUnitPrice: item.pack_unit_price == null ? null : Number(item.pack_unit_price),
        pricingSnapshot: item.pricing_snapshot,
      })),
      requestedMap
    );
    const allReturned = remainingPricing.lines.every((line) => line.remainingPackQty === 0);
    const hasExactSaleTimeRules = orderItems.every((item) =>
      isSaleTimePricingSnapshot(item.pricing_snapshot)
    );
    const extraTotal = Number(order.extra_total ?? 0);
    const originalPricingSubtotal = Math.max(0,
      Number(order.total_amount) + Number(order.discount_amount ?? 0) - extraTotal);
    const originalProductNet = Math.max(0, Number(order.total_amount) - extraTotal);
    // ส่วนลดระดับบิลเดิม (สมาชิก/คูปอง/แต้ม/มือ) ยังคงตามสัดส่วนเดิม
    // เปลี่ยนเฉพาะกลไกราคาตามจำนวนและโปร ซึ่งต้องตรวจจำนวนใหม่
    const orderDiscountRatio = originalPricingSubtotal > 0
      ? Math.min(1, originalProductNet / originalPricingSubtotal)
      : 1;
    const previousRefundAmount = Math.round(orderItems.reduce(
      (sum, item) => sum + Number(item.returned_refund_amount ?? 0), 0
    ) * 100) / 100;
    const desiredRemainingAmount = allReturned
      ? 0
      : hasExactSaleTimeRules
        ? Math.round((
            Number(order.shipping_fee ?? 0)
            + extraTotal
            + remainingPricing.pricingSubtotal * orderDiscountRatio
          ) * 100) / 100
        : Math.max(0, Math.round((
            orderAmount - previousRefundAmount - rawRefundAmount
          ) * 100) / 100);
    const targetCumulativeRefund = Math.max(0,
      Math.round((orderAmount - desiredRemainingAmount) * 100) / 100);
    const roundedRefundAmount = Math.round(
      (targetCumulativeRefund - previousRefundAmount) * 100
    ) / 100;
    if (roundedRefundAmount < 0) {
      await client.query("ROLLBACK");
      return {
        status: "REPRICE_PAYMENT_REQUIRED",
        additionalAmount: Math.max(0, Math.round(Math.abs(roundedRefundAmount) * 100) / 100),
        remainingAmount: desiredRemainingAmount,
      };
    }
    const pricingAdjustmentAmount = hasExactSaleTimeRules
      ? Math.max(0, Math.round((rawRefundAmount - roundedRefundAmount) * 100) / 100)
      : 0;
    const remainingAmount = Math.max(0,
      Math.round((orderAmount - previousRefundAmount - roundedRefundAmount) * 100) / 100);

    // ใบลดหนี้ต้องแจกยอดคืนลงแต่ละบรรทัด และผลรวมต้องตรงยอดเงินจริง
    const weightTotal = rawCalculated.reduce((sum, line) => (
      sum + (line.refundAmount > 0
        ? line.refundAmount
        : line.packQty * Number(line.item.receipt_unit_price))
    ), 0);
    let allocatedRefund = 0;
    const calculated = rawCalculated.map((line, index) => {
      const weight = line.refundAmount > 0
        ? line.refundAmount
        : line.packQty * Number(line.item.receipt_unit_price);
      const refundAmount = index === rawCalculated.length - 1
        ? Math.round((roundedRefundAmount - allocatedRefund) * 100) / 100
        : Math.round((roundedRefundAmount * (weightTotal > 0 ? weight / weightTotal : 0)) * 100) / 100;
      allocatedRefund += refundAmount;
      return { ...line, refundAmount };
    });

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

    const ret = await client.query<{ id: string; created_at: unknown }>(
      `INSERT INTO bms_pos_returns
         (tenant_id, order_id, pos_device_id, returned_by, approved_by, return_mode,
          refund_amount, settlement_status, idempotency_key, note, is_void,
          pricing_adjustment_amount, remaining_amount_after_return)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9, $10, $11, $12)
       RETURNING id, created_at`,
      [input.tenantId, input.orderId, input.deviceId, input.actorUserId, approvedBy,
        input.mode, roundedRefundAmount, input.idempotencyKey, input.note ?? null,
        input.isVoid === true, pricingAdjustmentAmount, remainingAmount]
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
    /** ส่วนที่หักออกจากหนี้แทนการจ่ายเงินคืน (9.30) */
    let arRefundAmount = 0;
    const refunds: PosRefundAllocation[] = [];
    for (const payment of payments.rows) {
      if (remainingRefund <= 0.001) break;
      const available = Math.max(0, Number(payment.amount) - Number(payment.allocated));
      const amount = Math.round(Math.min(available, remainingRefund) * 100) / 100;
      if (amount <= 0) continue;
      // ขายเชื่อ (9.30) จบทันทีเหมือนเงินสด: การลดหนี้ไม่มีขาที่ต้องไปทำกับธนาคาร
      // หรือเครื่องรูดบัตร · ถ้าปล่อยเป็น PENDING กะจะปิดไม่ได้จนกว่าจะมีคนไปกด
      // ยืนยันการคืนเงินที่ไม่มีเงินให้คืน
      const completed = payment.method === "CASH" || payment.method === "CREDIT";
      if (payment.method === "CREDIT") arRefundAmount = Math.round((arRefundAmount + amount) * 100) / 100;
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
          `UPDATE bms_payments SET status = 'REFUNDED', verified_by = $3,
              refunded_at = COALESCE(refunded_at, now()), updated_at = now()
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

    if (allReturned) {
      await client.query(
        `UPDATE bms_orders SET status = 'RETURNED', returned_at = COALESCE(returned_at, now()), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'COMPLETED'`,
        [input.tenantId, input.orderId]
      );
      // เลขเครื่อง (8.3) — ปลดเฉพาะตอนคืนครบทั้งบิล
      //
      // คืนบางส่วนปลดไม่ได้ เพราะระบบไม่รู้ว่าลูกค้าเอา "เครื่องไหน" มาคืน — เก็บเลข
      // ตอนขายเป็นชุดต่อบรรทัด ไม่ได้ผูกเลขกับชิ้นที่คืน · เดาว่าเป็นเครื่องแรกในชุด
      // แล้วบันทึกจะทำให้ประวัติประกันชี้ผิดเครื่อง ซึ่งแย่กว่าไม่ปลดเลย
      // (ที่ปลดได้คือกรณีคืนทั้งบิล ซึ่งของทุกชิ้นกลับมาแน่นอน)
      await client.query(
        `UPDATE bms_product_serials
            SET status = 'RETURNED', returned_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND order_id = $2 AND status = 'SOLD'`,
        [input.tenantId, input.orderId]
      );
    }
    // แต้มสะสม (7.96) — ต้องอยู่ใน tx เดียวกับสต็อกและเงินที่คืน
    // ไม่ทำข้อนี้: ซื้อ → ได้แต้ม → คืนของ → เก็บแต้มไว้ = ปั๊มแต้มฟรี
    // ratio คิดจากยอดคืนครั้งนี้ ÷ ยอดสุทธิบิลเดิม (ผลรวมทุกครั้งไม่เกิน 1
    // เพราะ remainingRefund ด้านบนบังคับว่าคืนเกินยอดที่จ่ายมาไม่ได้)
    const refundRatio = orderAmount > 0 ? roundedRefundAmount / orderAmount : 0;
    const loyaltyReversal = await reversePointsForReturnInTx(client, {
      tenantId: input.tenantId,
      orderId: input.orderId,
      posReturnId,
      ratio: refundRatio,
      actorUserId: input.actorUserId,
    });

    // เครดิตร้าน (8.9) — ส่วนที่จ่ายด้วยบัตรต้องกลับเข้าบัตรเดิมตามสัดส่วนที่คืน
    // ไม่ทำ = ลูกค้าที่จ่ายด้วยบัตรแล้วคืนของ เสียเงินบนบัตรไปเปล่า ๆ
    // (ทาง cancelOrder มีของตัวเองแล้ว แต่การคืนของ POS ไม่ผ่านทางนั้น)
    await reverseCreditForReturnInTx(client, input.tenantId, {
      orderId: input.orderId,
      posReturnId,
      ratio: refundRatio,
      actorUserId: input.actorUserId,
    });

    // ลูกหนี้การค้า (9.30) — ส่วนที่ยังไม่ได้จ่ายต้องหายไปจากหนี้ ไม่ใช่จ่ายเงินคืน
    //
    // ยอดมาจากตัว allocation ที่เพิ่งสร้าง ไม่ใช่จาก ratio: allocation ถูกจำกัดด้วย
    // "ยอดที่จ่ายมาด้วยวิธีนี้ลบที่คืนไปแล้ว" อยู่แล้ว จึงตรงเป๊ะและไม่มีเศษสะสม
    // ต่างจากการคูณสัดส่วนซึ่งคืนบางส่วนหลายครั้งแล้วปัดเศษเพี้ยนได้
    if (arRefundAmount > 0) {
      await reduceArForReturnInTx(client, input.tenantId, {
        orderId: input.orderId,
        posReturnId,
        amount: arRefundAmount,
        actorUserId: input.actorUserId,
        isVoid: input.isVoid === true,
      });
    }

    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'pos.return', $3, $4)`,
      [input.tenantId, input.actorUserId, input.orderId, JSON.stringify({
        posReturnId,
        mode: input.mode,
        refundAmount: roundedRefundAmount,
        approvedBy,
        settlementStatus,
        pricingAdjustmentAmount,
        remainingAmount,
        pointsReversed: loyaltyReversal.earnedReversed,
        pointsReturned: loyaltyReversal.redeemedReturned,
        // การยกเลิกบิลเดินผ่านเครื่องจักรตัวเดียวกับการคืน — ติดธงไว้ ไม่งั้นรายงาน
        // ที่นับ "การคืน" จาก audit log จะนับบิลที่กดผิดรวมไปด้วย
        isVoid: input.isVoid === true,
      })]
    );

    // ---- ยกเลิกบิล: ประทับตราในทรานแซกชันเดียวกับเงินที่คืน (7.97) ----------
    //
    // เดิมสองอย่างนี้อยู่คนละทรานแซกชัน (คืนเงินจบ → เปิด tx ใหม่มาประทับ) ซึ่ง
    // เปิดช่องที่เครื่องดับกลางทางแล้วบิลถูกคืนเงินไปแล้วแต่ voided_at ยังว่าง
    // ใบกำกับยังไม่ถูกยกเลิก และกดซ้ำจะได้ ALREADY_RETURNED เพราะด่านตรวจของ
    // voidPosSale เห็นว่ามีการคืนแล้ว → บิลค้างสถานะที่แก้ได้ด้วยมือเท่านั้น
    //
    // ใบกำกับถูก "ยกเลิก" ไม่ใช่ "ลบ" — เลขที่ออกไปแล้วต้องคงอยู่ในลำดับเสมอ
    // ใบที่หายไปจากลำดับเลขคือสิ่งแรกที่ผู้ตรวจสอบจะถาม และตอบไม่ได้
    if (input.isVoid) {
      const voidReason = (input.voidReason ?? "").trim();
      await client.query(
        `UPDATE bms_orders SET voided_at = now(), voided_by = $3, void_reason = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND voided_at IS NULL`,
        [input.tenantId, input.orderId, input.actorUserId, voidReason]
      );
      await client.query(
        `UPDATE bms_tax_documents
            SET cancelled_at = now(), cancelled_reason = $3
          WHERE tenant_id = $1 AND order_id = $2 AND cancelled_at IS NULL`,
        [input.tenantId, input.orderId, `ยกเลิกบิล: ${voidReason}`]
      );
      // การลบยอดขายออกจากกะคือช่องทุจริตตรงที่สุดที่ POS มี — ต้องมีบรรทัดของตัวเอง
      // ใน audit log กลาง พร้อมชื่อผู้อนุมัติ ไม่ใช่แค่ voided_by บนบิล
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1, $2, 'pos.void', $3, $4)`,
        [input.tenantId, input.actorUserId, input.orderId, JSON.stringify({
          shiftId: input.voidShiftId ?? null,
          deviceId: input.deviceId,
          approvedBy: input.approvedByUserId ?? null,
          reason: voidReason,
          refundAmount: roundedRefundAmount,
        })]
      );
    }

    await client.query("COMMIT");
    // ใบลดหนี้ใช้ transaction แยกตาม invariant ของ tax document อย่าถือ connection
    // การคืนค้างไว้ระหว่างเปิด transaction ใบลดหนี้ (pool ขนาด 1 จะรอกันตลอดไป)
    client.release();
    clientReleased = true;

    // ใบลดหนี้ (7.95) — รับคืนสินค้าแล้วต้องออกเอกสารลดยอด ไม่ใช่ลบบิลทิ้ง
    // ออกนอกทรานแซกชันการคืนโดยตั้งใจ: ของคืนเข้าคลังและเงินคืนไปแล้ว
    // การออกเอกสารล้มต้องไม่ย้อนสิ่งที่เกิดขึ้นจริงหน้าเคาน์เตอร์
    // ร้านที่ไม่ได้จด VAT จะได้ NOT_VAT_REGISTERED แล้วข้ามไปเอง
    const creditNoteNo = input.isVoid
      ? null
      : await ensurePosReturnCreditNote({
          tenantId: input.tenantId,
          orderId: input.orderId,
          posReturnId,
          mode: input.mode,
          refundAmount: roundedRefundAmount,
          actorUserId: input.actorUserId,
          // ส่งรายการที่คืนจริงไปด้วย — คืนเฉพาะของยกเว้น VAT ต้องไม่ลด VAT
          returnedItems: returnedItems.map((item) => ({
            orderItemId: item.orderItemId,
            refundAmount: item.refundAmount,
          })),
        });

    return {
      status: "PARTIAL_RETURNED",
      posReturnId,
      orderId: input.orderId,
      refundAmount: roundedRefundAmount,
      returnedAt: toISO(ret.rows[0].created_at),
      returnedItems,
      settlementStatus,
      refunds,
      pricingAdjustmentAmount,
      remainingAmount,
      creditNoteNo,
      pointsReversed: loyaltyReversal.earnedReversed,
      pointsReturned: loyaltyReversal.redeemedReturned,
      replayed: false,
    };
  } catch (err) {
    if (!clientReleased) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    throw err;
  } finally {
    if (!clientReleased) client.release();
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
        `UPDATE bms_payments SET status = 'REFUNDED', verified_by = $3,
            refunded_at = COALESCE(refunded_at, now()), updated_at = now()
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

// ---------------------------------------------------------------
// พักบิล (7.97)
// ---------------------------------------------------------------
//
// ตะกร้าที่พักไว้ไม่จองสต็อกโดยตั้งใจ (ดูเหตุผลในไฟล์ migration) จึงไม่มีอะไร
// ต้องคืนตอนลบ — ลบทิ้งได้ตรง ๆ · ราคาไม่ถูกล็อกด้วย: cart ที่เก็บไว้มีแค่
// sku/size/แพ็ก/จำนวน ตอนเรียกกลับมา createOrder คิดราคาจาก catalog ใหม่เสมอ
// ถ้าล็อกราคาไว้ ร้านที่ขึ้นราคาตอนบ่ายจะขายราคาเช้าให้บิลที่พักค้างไว้

export type PosParkedSale = {
  id: string;
  label: string;
  itemCount: number;
  subtotalHint: number;
  cart: unknown;
  parkedByName: string | null;
  createdAt: string;
  pharmacyReview: {
    assessmentId: string;
    caseCode: string;
    status: string | null;
    canResume: boolean;
    requiresSafetyCheck: boolean;
  } | null;
};

type PosParkedCartPayload = {
  version: 2;
  lines: unknown[];
  member?: unknown;
  pointsToRedeem?: string;
  couponCode?: string;
  extraLines?: unknown;
  pharmacyReview?: {
    assessmentId?: string | null;
    caseCode?: string | null;
    requiresSafetyCheck?: boolean;
  } | null;
};

function parkedCartLines(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as any).lines)) {
    return (raw as any).lines;
  }
  return [];
}

function parkedPharmacyReview(raw: unknown): {
  assessmentId: string;
  caseCode: string;
  requiresSafetyCheck: boolean;
} | null {
  const review = raw && typeof raw === "object"
    ? ((raw as any).pharmacyReview ?? (raw as any).meta?.pharmacyReview ?? null)
    : null;
  const assessmentId = typeof review?.assessmentId === "string" ? review.assessmentId.trim() : "";
  if (!assessmentId) return null;
  const caseCode = typeof review?.caseCode === "string" && review.caseCode.trim()
    ? review.caseCode.trim()
    : assessmentId.slice(0, 8);
  return {
    assessmentId,
    caseCode,
    requiresSafetyCheck: review?.requiresSafetyCheck === true,
  };
}

function parkedReviewCanResume(status: string | null | undefined): boolean {
  return status === "APPROVED";
}

/** เพดานต่อกะ — พักได้ไม่จำกัดแล้วรายการจะยาวจนเรียกกลับผิดใบ ซึ่งแย่กว่าพักไม่ได้ */
const MAX_PARKED_PER_SHIFT = 20;

export async function listParkedSales(
  tenantId: string, shiftId: string
): Promise<PosParkedSale[]> {
  const res = await query(
    `SELECT p.id, p.label, p.item_count, p.subtotal_hint, p.cart, p.created_at,
            COALESCE(u.name, u.email) AS parked_by_name
       FROM bms_pos_parked_sales p
       LEFT JOIN users u ON u.id = p.parked_by
      WHERE p.tenant_id = $1 AND p.shift_id = $2
      ORDER BY p.created_at DESC`,
    [tenantId, shiftId]
  );
  const reviewIds = Array.from(new Set(
    res.rows
      .map((row: any) => parkedPharmacyReview(row.cart)?.assessmentId ?? null)
      .filter((value): value is string => Boolean(value))
  ));
  const reviewStatusById = new Map<string, string>();
  if (reviewIds.length > 0) {
    const reviews = await query<{ id: string; status: string }>(
      `SELECT id, status
         FROM bms_pharmacy_assessments
        WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [tenantId, reviewIds]
    );
    for (const row of reviews.rows) reviewStatusById.set(row.id, row.status);
  }
  return res.rows.map((r: any) => ({
    id: r.id,
    label: r.label,
    itemCount: Number(r.item_count ?? 0),
    subtotalHint: Number(r.subtotal_hint ?? 0),
    cart: r.cart,
    parkedByName: r.parked_by_name ?? null,
    createdAt: toISO(r.created_at),
    pharmacyReview: (() => {
      const review = parkedPharmacyReview(r.cart);
      if (!review) return null;
      const status = reviewStatusById.get(review.assessmentId) ?? null;
      return {
        assessmentId: review.assessmentId,
        caseCode: review.caseCode,
        status,
        canResume: parkedReviewCanResume(status),
        requiresSafetyCheck: review.requiresSafetyCheck,
      };
    })(),
  }));
}

export type ParkSaleResult =
  | { status: "PARKED"; parked: PosParkedSale }
  | { status: "SHIFT_NOT_OPEN" }
  | { status: "TOO_MANY"; limit: number }
  | { status: "EMPTY" };

export async function parkSale(input: {
  tenantId: string;
  deviceId: string;
  shiftId: string;
  parkedBy: string;
  label: string;
  cart: unknown;
  itemCount: number;
  subtotalHint: number;
}): Promise<ParkSaleResult> {
  const label = input.label.trim();
  if (!label) return { status: "EMPTY" };
  if (parkedCartLines(input.cart).length === 0) return { status: "EMPTY" };

  const shift = await query<{ id: string; location_id: string }>(
    `SELECT id, location_id FROM bms_pos_shifts
      WHERE tenant_id = $1 AND id = $2 AND device_id = $3 AND status = 'OPEN'`,
    [input.tenantId, input.shiftId, input.deviceId]
  );
  if (!shift.rowCount) return { status: "SHIFT_NOT_OPEN" };

  const count = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pos_parked_sales WHERE tenant_id = $1 AND shift_id = $2`,
    [input.tenantId, input.shiftId]
  );
  if (Number(count.rows[0]?.n ?? 0) >= MAX_PARKED_PER_SHIFT) {
    return { status: "TOO_MANY", limit: MAX_PARKED_PER_SHIFT };
  }

  const res = await query(
    `INSERT INTO bms_pos_parked_sales
       (tenant_id, location_id, device_id, shift_id, parked_by, label, cart, item_count, subtotal_hint)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, label, item_count, subtotal_hint, cart, created_at`,
    [input.tenantId, shift.rows[0].location_id, input.deviceId, input.shiftId, input.parkedBy,
      label, JSON.stringify(input.cart), Math.max(0, Math.trunc(input.itemCount)),
      Math.max(0, Math.round(Number(input.subtotalHint) * 100) / 100)]
  );
  const r: any = res.rows[0];
  return {
    status: "PARKED",
    parked: {
      id: r.id, label: r.label, itemCount: Number(r.item_count), subtotalHint: Number(r.subtotal_hint),
      cart: r.cart, parkedByName: null, createdAt: toISO(r.created_at),
      pharmacyReview: (() => {
        const review = parkedPharmacyReview(r.cart);
        if (!review) return null;
        return {
          assessmentId: review.assessmentId,
          caseCode: review.caseCode,
          status: null,
          canResume: false,
          requiresSafetyCheck: review.requiresSafetyCheck,
        };
      })(),
    },
  };
}

/**
 * เรียกบิลพักกลับมา = อ่านตะกร้าแล้วลบแถวทิ้งในคำสั่งเดียว
 * ทำเป็นสองขั้น (อ่านแล้วค่อยลบ) ไม่ได้ เพราะสองเครื่องที่แชร์กะเดียวกันจะเรียก
 * ใบเดียวกันกลับมาพร้อมกันแล้วได้ตะกร้าซ้ำสองจอ
 */
export async function resumeParkedSale(
  tenantId: string, shiftId: string, parkedId: string
): Promise<
  | { status: "RESUMED"; cart: unknown; label: string }
  | { status: "NOT_FOUND" }
  | { status: "PHARMACY_REVIEW_PENDING"; assessmentId: string; caseCode: string; reviewStatus: string | null }
> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const parked = await client.query<{ cart: unknown; label: string }>(
      `SELECT cart, label
         FROM bms_pos_parked_sales
        WHERE tenant_id = $1 AND shift_id = $2 AND id = $3
        FOR UPDATE`,
      [tenantId, shiftId, parkedId]
    );
    if (!parked.rowCount) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
    }
    const review = parkedPharmacyReview(parked.rows[0].cart);
    if (review) {
      const assessment = await client.query<{ status: string }>(
        `SELECT status
           FROM bms_pharmacy_assessments
          WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, review.assessmentId]
      );
      const reviewStatus = assessment.rows[0]?.status ?? null;
      if (!parkedReviewCanResume(reviewStatus)) {
        await client.query("ROLLBACK");
        return {
          status: "PHARMACY_REVIEW_PENDING",
          assessmentId: review.assessmentId,
          caseCode: review.caseCode,
          reviewStatus,
        };
      }
    }
    await client.query(
      `DELETE FROM bms_pos_parked_sales
        WHERE tenant_id = $1 AND shift_id = $2 AND id = $3`,
      [tenantId, shiftId, parkedId]
    );
    await client.query("COMMIT");
    return { status: "RESUMED", cart: parked.rows[0].cart, label: parked.rows[0].label };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteParkedSale(
  tenantId: string, shiftId: string, parkedId: string
): Promise<boolean> {
  const res = await query(
    `DELETE FROM bms_pos_parked_sales WHERE tenant_id = $1 AND shift_id = $2 AND id = $3`,
    [tenantId, shiftId, parkedId]
  );
  return (res.rowCount ?? 0) > 0;
}

export type PosPharmacyReviewRequestResult =
  | { status: "REVIEW_REQUESTED"; assessmentId: string; caseCode: string; parked: PosParkedSale }
  | {
      status: "REVIEW_REQUESTED_UNPARKED";
      assessmentId: string;
      caseCode: string;
      reason: string;
      limit?: number;
      requiresSafetyCheck?: boolean;
    }
  | { status: "SHIFT_NOT_OPEN" }
  | { status: "EMPTY" }
  | { status: "TOO_MANY"; limit: number }
  | { status: "INVALID_PACK"; sku: string; packCode: string }
  | { status: "NOT_REQUIRED" }
  | {
      status:
        | "PHARMACY_POLICY_UNKNOWN"
        | "PHARMACY_PRESCRIPTION_REQUIRED"
        | "PHARMACY_ONLINE_SALE_PROHIBITED"
        | "PHARMACY_QUANTITY_LIMIT_EXCEEDED";
      sku: string;
      salePolicy: string;
      maxQuantity?: number;
      requested?: number;
      blockers?: Array<{ status: string; sku: string; salePolicy: string; maxQuantity?: number; requested?: number }>;
    };

async function findParkedSaleByAssessmentId(
  tenantId: string,
  shiftId: string,
  assessmentId: string,
): Promise<PosParkedSale | null> {
  const parked = await query<any>(
    `SELECT p.id, p.label, p.item_count, p.subtotal_hint, p.cart, p.created_at,
            COALESCE(u.name, u.email) AS parked_by_name
       FROM bms_pos_parked_sales p
       LEFT JOIN users u ON u.id = p.parked_by
      WHERE p.tenant_id = $1
        AND p.shift_id = $2
        AND p.cart->'pharmacyReview'->>'assessmentId' = $3
      ORDER BY p.created_at DESC
      LIMIT 1`,
    [tenantId, shiftId, assessmentId]
  );
  if (!parked.rowCount) return null;
  const reviewStatus = await query<{ status: string }>(
    `SELECT status
       FROM bms_pharmacy_assessments
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, assessmentId]
  );
  const row = parked.rows[0];
  const review = parkedPharmacyReview(row.cart);
  const status = reviewStatus.rows[0]?.status ?? null;
  return {
    id: row.id,
    label: row.label,
    itemCount: Number(row.item_count ?? 0),
    subtotalHint: Number(row.subtotal_hint ?? 0),
    cart: row.cart,
    parkedByName: row.parked_by_name ?? null,
    createdAt: toISO(row.created_at),
    pharmacyReview: review
      ? {
          assessmentId: review.assessmentId,
          caseCode: review.caseCode,
          status,
          canResume: parkedReviewCanResume(status),
          requiresSafetyCheck: review.requiresSafetyCheck,
        }
      : null,
  };
}

export async function requestPosPharmacyReview(input: {
  tenantId: string;
  deviceId: string;
  shiftId: string;
  cashierUserId: string;
  idempotencyKey: string;
  customerId?: string | null;
  label: string;
  lines: PosSaleLine[];
  parkedCart: PosParkedCartPayload | unknown;
  itemCount: number;
  subtotalHint: number;
}): Promise<PosPharmacyReviewRequestResult> {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 240) {
    throw new Error("idempotencyKey ไม่ถูกต้อง");
  }
  const shiftRes = await query<{ id: string; location_id: string; device_id: string }>(
    `SELECT id, location_id, device_id
       FROM bms_pos_shifts
      WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'`,
    [input.tenantId, input.shiftId]
  );
  if (!shiftRes.rowCount) return { status: "SHIFT_NOT_OPEN" };
  const shift = shiftRes.rows[0];
  if (shift.device_id !== input.deviceId) return { status: "SHIFT_NOT_OPEN" };
  const parkedCount = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pos_parked_sales WHERE tenant_id = $1 AND shift_id = $2`,
    [input.tenantId, input.shiftId]
  );
  if (Number(parkedCount.rows[0]?.n ?? 0) >= MAX_PARKED_PER_SHIFT) {
    return { status: "TOO_MANY", limit: MAX_PARKED_PER_SHIFT };
  }

  const canonical = await canonicalizePosSaleLines(input.tenantId, shift.location_id, input.lines);
  if (!canonical.ok) return { status: "INVALID_PACK", sku: canonical.sku, packCode: canonical.packCode };
  const items = canonical.items;
  if (items.length === 0) return { status: "EMPTY" };

  const client = await getClient();
  let reviewableSkus = new Set<string>();
  let requiresSafetyCheck = false;
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.cashierUserId });
    const pharmacySale = await checkPharmacySaleInTx(client, input.tenantId, items, null, "counter");
    await client.query("ROLLBACK");
    if (pharmacySale.allowed) return { status: "NOT_REQUIRED" };
    const blockers = pharmacySale.blockers ?? [];
    // เกณฑ์อยู่ที่ productPolicyDecision.ts ที่เดียว และใช้ชุดของ **เคาน์เตอร์** ซึ่งกว้าง
    // กว่าออนไลน์หนึ่งตัว: ยาที่ต้องมีใบสั่งแพทย์ · เคสจากเครื่องขายส่งเข้าคิวได้เพราะของ
    // ถูกส่งมือต่อมือที่ร้าน ไม่ได้ส่งออกไปทางอินเทอร์เน็ต · หน้าร้านจึงมีสองทางเลือกพร้อมกัน:
    // กด PIN ที่เครื่อง (9.29) หรือส่งเข้าคิวถ้าต้องซักประวัติยาว/เภสัชกรไม่อยู่
    const reviewable = blockers.filter((blocker) => isPharmacistReviewableBlock(blocker.status, "counter"));
    if (reviewable.length === 0 || reviewable.length !== blockers.length) {
      const blocker = blockers.find((candidate): candidate is typeof candidate & {
        status:
          | "PHARMACY_POLICY_UNKNOWN"
          | "PHARMACY_PRESCRIPTION_REQUIRED"
          | "PHARMACY_ONLINE_SALE_PROHIBITED"
          | "PHARMACY_QUANTITY_LIMIT_EXCEEDED";
      } => !isPharmacistReviewableBlock(candidate.status, "counter"));
      if (!blocker) return { status: "NOT_REQUIRED" };
      return {
        status: blocker.status,
        sku: blocker.sku,
        salePolicy: blocker.salePolicy,
        ...(blocker.maxQuantity == null ? {} : { maxQuantity: blocker.maxQuantity }),
        ...(blocker.requested == null ? {} : { requested: blocker.requested }),
        ...(blockers.length === 0 ? {} : { blockers }),
      };
    }
    reviewableSkus = new Set(reviewable.map((blocker) => blocker.sku));
    requiresSafetyCheck = reviewable.some((blocker) => blocker.status === "PHARMACY_SAFETY_CHECK_REQUIRED");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }

  const reviewItems = items
    .filter((item) => reviewableSkus.has(item.sku))
    .map((item) => ({ sku: item.sku, size: item.size, qty: item.qty }));
  if (reviewItems.length === 0) return { status: "NOT_REQUIRED" };

  const created = await createProductReviewAssessmentOnce({
    tenantId: input.tenantId,
    channelId: POS_CHANNEL,
    customerId: input.customerId ?? null,
    locationId: shift.location_id,
    items: reviewItems,
    requiresSafetyCheck,
    sourceMeta: {
      source: "pos",
      shiftId: input.shiftId,
      deviceId: input.deviceId,
      cashierUserId: input.cashierUserId,
      idempotencyKey,
      label: input.label.trim(),
    },
  });
  const assessmentId = created.assessmentId;
  const caseCode = assessmentId.slice(0, 8);
  const existingParked = await findParkedSaleByAssessmentId(input.tenantId, input.shiftId, assessmentId);
  if (existingParked) {
    return { status: "REVIEW_REQUESTED", assessmentId, caseCode, parked: existingParked };
  }
  const parkedPayload = Array.isArray(input.parkedCart)
    ? {
        version: 2 as const,
        lines: input.parkedCart,
        pharmacyReview: { assessmentId, caseCode, requiresSafetyCheck },
      }
    : {
        ...(input.parkedCart as Record<string, unknown>),
        version: 2 as const,
        lines: parkedCartLines(input.parkedCart),
        pharmacyReview: { assessmentId, caseCode, requiresSafetyCheck },
      };
  const parked = await parkSale({
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    shiftId: input.shiftId,
    parkedBy: input.cashierUserId,
    label: input.label,
    cart: parkedPayload,
    itemCount: input.itemCount,
    subtotalHint: input.subtotalHint,
  });
  if (parked.status !== "PARKED") {
    return {
      status: "REVIEW_REQUESTED_UNPARKED",
      assessmentId,
      caseCode,
      ...(parked.status === "TOO_MANY" ? { limit: parked.limit } : {}),
      requiresSafetyCheck,
      reason:
        parked.status === "TOO_MANY"
          ? `พักบิลได้สูงสุด ${parked.limit} บิลต่อกะ`
          : parked.status === "SHIFT_NOT_OPEN"
            ? "กะปิดไปแล้ว"
            : "พักบิลไม่สำเร็จ",
    };
  }
  return { status: "REVIEW_REQUESTED", assessmentId, caseCode, parked: parked.parked };
}

// ---------------------------------------------------------------
// เงินเข้า-ออกลิ้นชัก (7.97)
// ---------------------------------------------------------------

export type PosCashMovement = {
  id: string;
  direction: "IN" | "OUT";
  amount: number;
  reason: string;
  actorName: string | null;
  approvedByName: string | null;
  createdAt: string;
};

export async function listCashMovements(
  tenantId: string, shiftId: string
): Promise<PosCashMovement[]> {
  const res = await query(
    `SELECT m.id, m.direction, m.amount, m.reason, m.created_at,
            COALESCE(a.name, a.email) AS actor_name,
            COALESCE(p.name, p.email) AS approved_by_name
       FROM bms_pos_cash_movements m
       LEFT JOIN users a ON a.id = m.actor_user_id
       LEFT JOIN users p ON p.id = m.approved_by
      WHERE m.tenant_id = $1 AND m.shift_id = $2
      ORDER BY m.created_at`,
    [tenantId, shiftId]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    direction: r.direction,
    amount: Number(r.amount),
    reason: r.reason,
    actorName: r.actor_name ?? null,
    approvedByName: r.approved_by_name ?? null,
    createdAt: toISO(r.created_at),
  }));
}

export type CashMovementResult =
  /**
   * drawerAfter = null เมื่อร้านเปิดโหมดนับปิดตา (8.0)
   *
   * ตัวเลขนี้คือ "ยอดที่ควรมีในลิ้นชัก" ตรง ๆ — ถ้าคืนให้ตอนกะยังเปิด แคชเชียร์
   * นำเงินเข้า ฿1 ครั้งเดียวก็อ่านคำตอบของการนับปิดตาได้ทั้งหมด
   */
  | { status: "RECORDED"; movement: PosCashMovement; drawerAfter: number | null; replayed: boolean }
  | { status: "SHIFT_NOT_OPEN" }
  | { status: "INVALID"; reason: string }
  /** available = null ด้วยเหตุผลเดียวกัน — ยังปฏิเสธรายการ แต่ไม่บอกว่าเหลือเท่าไร */
  | { status: "WOULD_OVERDRAW"; available: number | null };

/**
 * บันทึกเงินเข้า/ออกลิ้นชัก
 *
 * เงินออกห้ามเกินเงินที่ควรอยู่ในลิ้นชักตอนนั้น — ไม่ใช่เพราะระบบรู้ว่ามีเงินจริง
 * เท่าไร แต่เพราะรายการที่ทำให้ยอด "ที่ควรมี" ติดลบคือรายการที่กรอกผิดแน่นอน
 * (เช่น พิมพ์ 5000 แทน 500) ปล่อยผ่านแล้วตัวเลขปิดกะจะอธิบายไม่ได้ทั้งกะ
 */
export async function recordCashMovement(input: {
  tenantId: string;
  deviceId: string;
  shiftId: string;
  direction: "IN" | "OUT";
  amount: number;
  reason: string;
  actorUserId: string;
  approvedByUserId?: string | null;
  idempotencyKey: string;
}): Promise<CashMovementResult> {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { status: "INVALID", reason: "จำนวนเงินไม่ถูกต้อง" };
  const reason = input.reason.trim();
  if (!reason) return { status: "INVALID", reason: "ต้องระบุเหตุผล" };
  if (reason.length > 200) return { status: "INVALID", reason: "เหตุผลยาวเกินไป" };
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 240) {
    return { status: "INVALID", reason: "idempotencyKey ไม่ถูกต้อง" };
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });

    // ล็อกแถวกะไว้ระหว่างคิดยอด — สองเครื่องที่แชร์กะเดียวกันถอนพร้อมกันได้ไม่งั้น
    const shift = await client.query<{ id: string; opening_float: string }>(
      `SELECT id, opening_float FROM bms_pos_shifts
        WHERE tenant_id = $1 AND id = $2 AND device_id = $3 AND status = 'OPEN'
        FOR UPDATE`,
      [input.tenantId, input.shiftId, input.deviceId]
    );
    if (!shift.rowCount) {
      await client.query("ROLLBACK");
      return { status: "SHIFT_NOT_OPEN" };
    }

    const drawer = await drawerExpectedInTx(client, input.tenantId, input.shiftId, Number(shift.rows[0].opening_float));
    // โหมดนับปิดตายังต้องกันการถอนเกิน (รายการที่ทำให้ยอดติดลบคือรายการที่กรอกผิด)
    // แต่ห้ามบอกว่าเหลือเท่าไร ไม่งั้นข้อความ error กลายเป็นช่องอ่านคำตอบ
    const blind = (await getVatSettings(input.tenantId)).blindClose;
    const replay = await client.query<any>(
      `SELECT id, direction, amount, reason, created_at
         FROM bms_pos_cash_movements
        WHERE tenant_id = $1 AND idempotency_key = $2`,
      [input.tenantId, idempotencyKey]
    );
    if (replay.rows[0]) {
      const r = replay.rows[0];
      await client.query("ROLLBACK");
      return {
        status: "RECORDED",
        replayed: true,
        drawerAfter: blind ? null : drawer,
        movement: {
          id: r.id, direction: r.direction, amount: Number(r.amount), reason: r.reason,
          actorName: null, approvedByName: null, createdAt: toISO(r.created_at),
        },
      };
    }
    if (input.direction === "OUT" && amount > drawer + 0.001) {
      await client.query("ROLLBACK");
      return { status: "WOULD_OVERDRAW", available: blind ? null : drawer };
    }

    const res = await client.query(
      `INSERT INTO bms_pos_cash_movements
         (tenant_id, shift_id, device_id, direction, amount, reason, actor_user_id, approved_by, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, direction, amount, reason, created_at`,
      [input.tenantId, input.shiftId, input.deviceId, input.direction, amount, reason,
        input.actorUserId, input.approvedByUserId ?? null, idempotencyKey]
    );

    // เงินที่เข้า-ออกลิ้นชักโดยไม่ผ่านการขายต้องอยู่ใน audit log กลางด้วย ไม่ใช่
    // เฉพาะในตารางของตัวเอง — คนที่ตรวจว่า "ใครหยิบเงินออกบ้างเดือนนี้" ไล่จาก
    // audit log ที่เดียว ไม่ได้รู้ว่ามีตาราง bms_pos_cash_movements อยู่
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'pos.cash.movement', $3, $4)`,
      [input.tenantId, input.actorUserId, res.rows[0].id, JSON.stringify({
        shiftId: input.shiftId,
        deviceId: input.deviceId,
        direction: input.direction,
        amount,
        reason,
        approvedBy: input.approvedByUserId ?? null,
      })]
    );
    await client.query("COMMIT");

    const r: any = res.rows[0];
    return {
      status: "RECORDED",
      replayed: false,
      drawerAfter: blind
        ? null
        : Math.round((drawer + (input.direction === "IN" ? amount : -amount)) * 100) / 100,
      movement: {
        id: r.id, direction: r.direction, amount: Number(r.amount), reason: r.reason,
        actorName: null, approvedByName: null, createdAt: toISO(r.created_at),
      },
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * เงินสดที่ "ควรอยู่" ในลิ้นชักตอนนี้ — สูตรเดียวกับตอนปิดกะเป๊ะ ๆ
 * ถ้าสองที่คิดต่างกัน ตัวเลขที่จอเตือนตอนถอนเงินจะไม่ตรงกับที่ปิดกะฟ้อง
 */
export async function drawerExpectedInTx(
  client: PoolClient, tenantId: string, shiftId: string, openingFloat: number
): Promise<number> {
  const res = await client.query<{ cash_sales: string; cash_refunds: string; cash_in: string; cash_out: string }>(
    `SELECT
       (SELECT COALESCE(SUM(pay.amount), 0)
          FROM bms_payments pay
          JOIN bms_orders o ON o.id = pay.order_id AND o.tenant_id = pay.tenant_id
         WHERE o.tenant_id = $1 AND o.pos_shift_id = $2
           AND pay.method = 'CASH' AND pay.status IN ('CONFIRMED','REFUNDED')) AS cash_sales,
       (SELECT COALESCE(SUM(a.amount), 0)
          FROM bms_pos_refund_allocations a
          JOIN bms_pos_returns pr ON pr.id = a.pos_return_id AND pr.tenant_id = a.tenant_id
          JOIN bms_orders o ON o.id = pr.order_id AND o.tenant_id = pr.tenant_id
         WHERE a.tenant_id = $1 AND o.pos_shift_id = $2
           AND a.method = 'CASH' AND a.status = 'COMPLETED') AS cash_refunds,
       (SELECT COALESCE(SUM(amount), 0) FROM bms_pos_cash_movements
         WHERE tenant_id = $1 AND shift_id = $2 AND direction = 'IN') AS cash_in,
       (SELECT COALESCE(SUM(amount), 0) FROM bms_pos_cash_movements
         WHERE tenant_id = $1 AND shift_id = $2 AND direction = 'OUT') AS cash_out`,
    [tenantId, shiftId]
  );
  const r = res.rows[0];
  return Math.round((openingFloat + Number(r.cash_sales) - Number(r.cash_refunds)
    + Number(r.cash_in) - Number(r.cash_out)) * 100) / 100;
}

// ---------------------------------------------------------------
// ยกเลิกบิล — void (7.97)
// ---------------------------------------------------------------
//
// ทำไมไม่ใช้ "คืนสินค้า" แทนไปเลย: ปลายทางเหมือนกันจริง (ของกลับเข้าสต็อก
// เงินกลับหาลูกค้า แต้มถูกดึงคืน) แต่ความหมายทางบัญชีและทางการจัดการต่างกัน
//   - การคืน = ขายสำเร็จแล้วลูกค้าเปลี่ยนใจ → ต้องอยู่ในรายงานการคืน
//   - void   = บิลนี้ไม่ควรเกิดตั้งแต่แรก (สแกนซ้ำ กดผิดคน ลูกค้าเปลี่ยนใจก่อนออกจากเคาน์เตอร์)
// ถ้าบังคับให้ void เดินทางเดียวกับการคืน แคชเชียร์ที่กดผิดวันละสองครั้งจะไป
// ปลุกสัญญาณ "คืนถี่ผิดปกติ" ใน pos-return-audit ทุกสัปดาห์จนไม่มีใครเชื่อสัญญาณนั้นอีก
//
// ข้อจำกัดที่ตั้งใจให้แคบ:
//   - เฉพาะบิลในกะที่ยังเปิดอยู่ ปิดกะแล้ว void ไม่ได้ (เงินถูกนับส่งไปแล้ว)
//   - บิลที่เคยคืนบางส่วนมาก่อน void ไม่ได้ ต้องเดินทางการคืนให้จบ
// สองข้อนี้ทำให้ void เป็น "ยางลบของนาทีนี้" ไม่ใช่ประตูหลังสำหรับลบยอดขายย้อนหลัง

export type VoidPosSaleResult =
  | { status: "VOIDED"; orderId: string; refundAmount: number }
  | { status: "NOT_FOUND" }
  | { status: "SHIFT_CLOSED" }
  | { status: "ALREADY_RETURNED" }
  | { status: "NOT_VOIDABLE"; reason: string };

export async function voidPosSale(input: {
  tenantId: string;
  deviceId: string;
  shiftId: string;
  orderId: string;
  actorUserId: string;
  approvedByUserId: string;
  reason: string;
  idempotencyKey: string;
}): Promise<VoidPosSaleResult> {
  const reason = input.reason.trim();
  if (!reason) return { status: "NOT_VOIDABLE", reason: "ต้องระบุเหตุผล" };
  if (reason.length > 200) return { status: "NOT_VOIDABLE", reason: "เหตุผลยาวเกินไป" };

  const check = await query<{ status: string; pos_shift_id: string | null; shift_status: string | null; voided_at: Date | null; returns: string }>(
    `SELECT o.status, o.pos_shift_id, o.voided_at, s.status AS shift_status,
            (SELECT COUNT(*)::text FROM bms_pos_returns r
              WHERE r.tenant_id = o.tenant_id AND r.order_id = o.id) AS returns
       FROM bms_orders o
       LEFT JOIN bms_pos_shifts s ON s.id = o.pos_shift_id AND s.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1 AND o.id = $2 AND o.pos_device_id = $3`,
    [input.tenantId, input.orderId, input.deviceId]
  );
  const row = check.rows[0];
  if (!row) return { status: "NOT_FOUND" };
  // ยิงซ้ำเพราะเน็ตหลุด: บิลที่ void ไปแล้วตอบว่าสำเร็จ ไม่ใช่ error
  if (row.voided_at) return { status: "VOIDED", orderId: input.orderId, refundAmount: 0 };
  if (row.pos_shift_id !== input.shiftId || row.shift_status !== "OPEN") return { status: "SHIFT_CLOSED" };
  if (Number(row.returns ?? 0) > 0) return { status: "ALREADY_RETURNED" };
  if (!["COMPLETED", "PAID"].includes(row.status)) {
    return { status: "NOT_VOIDABLE", reason: `บิลสถานะ ${row.status} ยกเลิกไม่ได้` };
  }

  // เครื่องจักรคืนของทั้งชุด: สต็อก ล็อต แต้ม เงินคืน — ใช้ตัวเดียวกับการคืนสินค้า
  // ที่ผ่านการทดสอบมาแล้ว การเขียนทางคืนของขึ้นมาใหม่สำหรับ void คือการสร้าง
  // ทางที่สองที่ต้องถูกต้องเท่ากันแต่ไม่มีใครทดสอบเท่ากัน
  const result = await processPosReturn({
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    orderId: input.orderId,
    actorUserId: input.actorUserId,
    approvedByUserId: input.approvedByUserId,
    mode: "FULL",
    lines: [],
    note: `ยกเลิกบิล: ${reason}`,
    idempotencyKey: input.idempotencyKey,
    // การประทับตรา void (voided_at + ยกเลิกใบกำกับ + audit) เกิดข้างในทรานแซกชัน
    // เดียวกับการคืนเงิน ไม่ใช่ทรานแซกชันที่สองข้างนอกนี้ — ดูเหตุผลที่ § void ใน
    // processPosReturn · ผลคือ "คืนเงินแล้วแต่บิลไม่ถูกประทับ" เกิดขึ้นไม่ได้อีก
    isVoid: true,
    voidReason: reason,
    voidShiftId: input.shiftId,
  });
  if (result.status !== "PARTIAL_RETURNED") {
    return { status: "NOT_VOIDABLE", reason: `ยกเลิกไม่สำเร็จ (${result.status})` };
  }

  return { status: "VOIDED", orderId: input.orderId, refundAmount: result.refundAmount };
}

// ---------------------------------------------------------------
// รายงานสรุปกะ — X/Z report (7.97)
// ---------------------------------------------------------------
//
// X = ดูระหว่างกะยังเปิด (ไม่ปิดอะไร) · Z = ดูหลังปิดกะ
// โค้ดเดียวกัน ต่างแค่กะที่ขอดูปิดไปหรือยัง จึงไม่แยกฟังก์ชัน
//
// นี่คือกระดาษที่ผู้จัดการเซ็นรับเงินจากแคชเชียร์ทุกกะ ตัวเลขทุกตัวต้องมาจาก
// ฐานข้อมูลตรง ๆ ห้ามให้จอรวมเอง

export type PosShiftReport = {
  shiftId: string;
  deviceCode: string;
  locationName: string | null;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  openedByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  openingFloat: number;
  /** ยอดขายสุทธิ (ไม่รวมบิลที่ถูก void) */
  salesTotal: number;
  billCount: number;
  voidCount: number;
  voidTotal: number;
  returnCount: number;
  returnTotal: number;
  discountTotal: number;
  byMethod: Array<{ method: string; count: number; amount: number }>;
  byCashier: Array<{ cashier: string; billCount: number; amount: number }>;
  cashIn: number;
  cashOut: number;
  cashRefunds: number;
  /** ค่าใช้จ่ายที่ปิดยอดแล้วเท่านั้น; ไม่เอาการนำฝากธนาคาร/ย้ายเงินมาปน */
  expenseCount: number;
  expenseTotal: number;
  /** ค่าใช้จ่ายที่เจ้าของสำรองจ่ายเอง ไม่ได้ออกจากลิ้นชัก */
  personalExpenseCount: number;
  personalExpenseTotal: number;
  /** ค่าใช้จ่ายที่หักจากกระเป๋าเงินสดย่อยของสาขา ไม่ได้ออกจากลิ้นชัก */
  pettyCashExpenseCount: number;
  pettyCashExpenseTotal: number;
  openExpenseCount: number;
  openExpenseAmount: number;
  /** จำนวนครั้งที่เปิดลิ้นชักโดยไม่ขาย (8.0) — เปิดถี่ผิดปกติคือสัญญาณที่ต้องดู */
  noSaleCount: number;
  /**
   * เงินสดที่ควรอยู่ในลิ้นชัก
   *
   * **null เมื่อกะยังเปิดและร้านเปิดโหมดนับปิดตา (8.0)** — คนนับต้องไม่เห็นเลขนี้
   * ก่อนกรอกยอดที่นับได้ ไม่งั้นกรอกให้ตรงได้เลยแล้ว variance เป็น 0 ตลอด
   * ระบบจึงจับเงินขาดไม่ได้จริง · หลังปิดกะแล้วแสดงตามปกติ
   */
  expectedCash: number | null;
  /** true = เลขถูกซ่อนเพราะโหมดนับปิดตา ไม่ใช่เพราะคำนวณไม่ได้ */
  expectedCashHidden: boolean;
  countedCash: number | null;
  cashVariance: number | null;
};

export async function getPosShiftReport(
  tenantId: string, shiftId: string, deviceId?: string | null
): Promise<PosShiftReport | null> {
  const head = await query<any>(
    `SELECT s.id, s.status, s.opened_at, s.closed_at, s.opening_float,
            s.expected_cash, s.counted_cash, s.cash_variance,
            d.code AS device_code, l.name AS location_name,
            COALESCE(uo.name, uo.email) AS opened_by_name,
            COALESCE(uc.name, uc.email) AS closed_by_name
       FROM bms_pos_shifts s
       JOIN bms_pos_devices d ON d.id = s.device_id AND d.tenant_id = s.tenant_id
       LEFT JOIN bms_locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
       LEFT JOIN users uo ON uo.id = s.opened_by
       LEFT JOIN users uc ON uc.id = s.closed_by
      WHERE s.tenant_id = $1 AND s.id = $2
        AND ($3::uuid IS NULL OR s.device_id = $3)`,
    [tenantId, shiftId, deviceId ?? null]
  );
  if (!head.rowCount) return null;
  const h = head.rows[0];

  // บิลที่ถูก void ต้องออกจากยอดขายทุกตัวเลข ไม่ใช่แค่ไม่นับใบ — ไม่งั้นยอดขาย
  // ของกะจะไม่ตรงกับเงินที่นับได้ แล้วผู้จัดการจะเซ็นรับด้วยตัวเลขที่ผิด
  const [sales, methods, cashiers, movements, returns, expenses, noSales, vat] = await Promise.all([
    query<any>(
      `SELECT COUNT(*) FILTER (WHERE voided_at IS NULL)::text AS bills,
              COALESCE(SUM(total_amount) FILTER (WHERE voided_at IS NULL), 0) AS sales,
              COALESCE(SUM(discount_amount) FILTER (WHERE voided_at IS NULL), 0) AS discounts,
              COUNT(*) FILTER (WHERE voided_at IS NOT NULL)::text AS voids,
              COALESCE(SUM(total_amount) FILTER (WHERE voided_at IS NOT NULL), 0) AS void_total
         FROM bms_orders
        WHERE tenant_id = $1 AND pos_shift_id = $2
          AND status IN ('COMPLETED','RETURNED')`,
      [tenantId, shiftId]
    ),
    query<any>(
      `SELECT pay.method, COUNT(*)::text AS n, COALESCE(SUM(pay.amount), 0) AS amount
         FROM bms_payments pay
         JOIN bms_orders o ON o.id = pay.order_id AND o.tenant_id = pay.tenant_id
        WHERE o.tenant_id = $1 AND o.pos_shift_id = $2
          AND o.voided_at IS NULL AND pay.status IN ('CONFIRMED','REFUNDED')
        GROUP BY pay.method ORDER BY pay.method`,
      [tenantId, shiftId]
    ),
    query<any>(
      `SELECT COALESCE(u.name, u.email, 'ไม่ทราบ') AS cashier,
              COUNT(*)::text AS bills, COALESCE(SUM(o.total_amount), 0) AS amount
         FROM bms_orders o
         LEFT JOIN users u ON u.id = o.cashier_user_id
        WHERE o.tenant_id = $1 AND o.pos_shift_id = $2 AND o.voided_at IS NULL
          AND o.status IN ('COMPLETED','RETURNED')
        GROUP BY 1 ORDER BY 3 DESC`,
      [tenantId, shiftId]
    ),
    query<any>(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'IN'), 0)  AS cash_in,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'OUT'), 0) AS cash_out
         FROM bms_pos_cash_movements WHERE tenant_id = $1 AND shift_id = $2`,
      [tenantId, shiftId]
    ),
    // นับเฉพาะการคืนของจริง — void ถูกกรองออกด้วย is_void
    query<any>(
      `SELECT COUNT(*)::text AS n, COALESCE(SUM(pr.refund_amount), 0) AS amount,
              COALESCE((
                SELECT SUM(a.amount)
                  FROM bms_pos_refund_allocations a
                  JOIN bms_pos_returns pr2 ON pr2.id = a.pos_return_id AND pr2.tenant_id = a.tenant_id
                  JOIN bms_orders o2 ON o2.id = pr2.order_id AND o2.tenant_id = pr2.tenant_id
                 WHERE a.tenant_id = $1 AND o2.pos_shift_id = $2 AND pr2.is_void = FALSE
                   AND a.method = 'CASH' AND a.status = 'COMPLETED'
              ), 0) AS cash_refunds
         FROM bms_pos_returns pr
         JOIN bms_orders o ON o.id = pr.order_id AND o.tenant_id = pr.tenant_id
        WHERE pr.tenant_id = $1 AND o.pos_shift_id = $2 AND pr.is_void = FALSE`,
      [tenantId, shiftId]
    ),
    query<any>(
      `SELECT COUNT(*) FILTER (WHERE status = 'SETTLED')::text AS settled_count,
              COALESCE(SUM(actual_amount) FILTER (WHERE status = 'SETTLED'), 0) AS settled_total,
              COUNT(*) FILTER (WHERE status = 'SETTLED' AND funding_source = 'PERSONAL')::text AS personal_count,
              COALESCE(SUM(actual_amount) FILTER (
                WHERE status = 'SETTLED' AND funding_source = 'PERSONAL'
              ), 0) AS personal_total,
              COUNT(*) FILTER (WHERE status = 'SETTLED' AND funding_source = 'PETTY_CASH')::text AS petty_cash_count,
              COALESCE(SUM(actual_amount) FILTER (
                WHERE status = 'SETTLED' AND funding_source = 'PETTY_CASH'
              ), 0) AS petty_cash_total,
              COUNT(*) FILTER (WHERE status = 'OPEN')::text AS open_count,
              COALESCE(SUM(advanced_amount) FILTER (WHERE status = 'OPEN'), 0) AS open_amount
         FROM bms_pos_expenses
        WHERE tenant_id = $1 AND shift_id = $2`,
      [tenantId, shiftId]
    ),
    query<any>(
      `SELECT COUNT(*)::text AS n FROM bms_pos_no_sales WHERE tenant_id = $1 AND shift_id = $2`,
      [tenantId, shiftId]
    ),
    getVatSettings(tenantId),
  ]);

  const s = sales.rows[0], m = movements.rows[0], r = returns.rows[0], e = expenses.rows[0];
  const cashSales = Number(methods.rows.find((x: any) => x.method === "CASH")?.amount ?? 0);
  const cashIn = Number(m.cash_in), cashOut = Number(m.cash_out);
  const cashRefunds = Number(r.cash_refunds ?? 0);
  const openingFloat = Number(h.opening_float);
  const expectedCashHidden = h.status === "OPEN" && vat.blindClose;

  return {
    shiftId: h.id,
    deviceCode: h.device_code,
    locationName: h.location_name ?? null,
    status: h.status,
    openedAt: toISO(h.opened_at),
    openedByName: h.opened_by_name ?? null,
    closedAt: h.closed_at ? toISO(h.closed_at) : null,
    closedByName: h.closed_by_name ?? null,
    openingFloat,
    salesTotal: Number(s.sales),
    billCount: Number(s.bills),
    voidCount: Number(s.voids),
    voidTotal: Number(s.void_total),
    returnCount: Number(r.n ?? 0),
    returnTotal: Number(r.amount ?? 0),
    discountTotal: Number(s.discounts),
    byMethod: methods.rows.map((x: any) => ({ method: x.method, count: Number(x.n), amount: Number(x.amount) })),
    byCashier: cashiers.rows.map((x: any) => ({ cashier: x.cashier, billCount: Number(x.bills), amount: Number(x.amount) })),
    cashIn,
    cashOut,
    cashRefunds,
    expenseCount: Number(e.settled_count ?? 0),
    expenseTotal: Number(e.settled_total ?? 0),
    personalExpenseCount: Number(e.personal_count ?? 0),
    personalExpenseTotal: Number(e.personal_total ?? 0),
    pettyCashExpenseCount: Number(e.petty_cash_count ?? 0),
    pettyCashExpenseTotal: Number(e.petty_cash_total ?? 0),
    openExpenseCount: Number(e.open_count ?? 0),
    openExpenseAmount: Number(e.open_amount ?? 0),
    noSaleCount: Number(noSales.rows[0]?.n ?? 0),
    // กะที่ปิดแล้วใช้ตัวเลขที่บันทึกไว้ตอนปิด ไม่คิดใหม่ — คิดใหม่แล้วรายงานที่พิมพ์
    // วันนี้จะไม่ตรงกับกระดาษที่เซ็นไปเมื่อวาน ถ้ามีใครแก้ข้อมูลย้อนหลัง
    //
    // กะที่ยังเปิด + โหมดนับปิดตา = ไม่บอกเลขนี้กับใครทั้งนั้น รวมถึงผู้จัดการ
    // เพราะเลขที่หลุดออกจากจอไปแล้วห้ามคนบอกต่อไม่ได้ (blind close ที่ยกเว้น
    // บางคนไม่ใช่ blind close)
    expectedCash: expectedCashHidden
      ? null
      : h.expected_cash != null
        ? Number(h.expected_cash)
        : Math.round((openingFloat + cashSales - cashRefunds + cashIn - cashOut) * 100) / 100,
    expectedCashHidden,
    countedCash: h.counted_cash == null ? null : Number(h.counted_cash),
    cashVariance: h.cash_variance == null ? null : Number(h.cash_variance),
  };
}

// ---------------------------------------------------------------
// เปิดลิ้นชักโดยไม่ขาย — no-sale (8.0)
// ---------------------------------------------------------------
//
// ห้ามไม่ได้: แลกแบงก์ย่อยให้ลูกค้าเป็นงานประจำ และถ้าระบบไม่ให้ทำ พนักงานจะ
// เปิดลิ้นชักด้วยมือ (ทุกลิ้นชักมีคันโยกฉุกเฉินใต้เครื่อง) แล้วไม่เหลือร่องรอยเลย
// การควบคุมจึงอยู่ที่ "ทุกครั้งต้องมีบันทึกว่าใครเปิดและทำไม" ไม่ใช่การกั้น
//
// จำนวนครั้งที่เปิดโดยไม่ขายเป็นสัญญาณทุจริตคลาสสิก — จึงโผล่บนสรุปกะ

export type PosNoSale = {
  id: string;
  reason: string;
  actorName: string | null;
  createdAt: string;
};

export async function listNoSales(tenantId: string, shiftId: string): Promise<PosNoSale[]> {
  const res = await query(
    `SELECT n.id, n.reason, n.created_at, COALESCE(u.name, u.email) AS actor_name
       FROM bms_pos_no_sales n
       LEFT JOIN users u ON u.id = n.actor_user_id
      WHERE n.tenant_id = $1 AND n.shift_id = $2
      ORDER BY n.created_at`,
    [tenantId, shiftId]
  );
  return res.rows.map((r: any) => ({
    id: r.id, reason: r.reason, actorName: r.actor_name ?? null, createdAt: toISO(r.created_at),
  }));
}

export async function recordNoSale(input: {
  tenantId: string; deviceId: string; shiftId: string; actorUserId: string; reason: string;
}): Promise<{ status: "RECORDED" } | { status: "SHIFT_NOT_OPEN" } | { status: "INVALID"; reason: string }> {
  const reason = input.reason.trim();
  if (!reason) return { status: "INVALID", reason: "ต้องระบุเหตุผลที่เปิดลิ้นชัก" };
  if (reason.length > 200) return { status: "INVALID", reason: "เหตุผลยาวเกินไป" };

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const shift = await client.query(
      `SELECT id FROM bms_pos_shifts
        WHERE tenant_id = $1 AND id = $2 AND device_id = $3 AND status = 'OPEN'
        FOR UPDATE`,
      [input.tenantId, input.shiftId, input.deviceId]
    );
    if (!shift.rowCount) {
      await client.query("ROLLBACK");
      return { status: "SHIFT_NOT_OPEN" };
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bms_pos_no_sales (tenant_id, shift_id, device_id, actor_user_id, reason)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [input.tenantId, input.shiftId, input.deviceId, input.actorUserId, reason]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'pos.no_sale',$3,$4)`,
      [input.tenantId, input.actorUserId, inserted.rows[0].id,
        JSON.stringify({ shiftId: input.shiftId, deviceId: input.deviceId, reason })]
    );
    await client.query("COMMIT");
    return { status: "RECORDED" };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// คืนสินค้าโดยไม่มีใบเสร็จ — blind return (8.2)
// ---------------------------------------------------------------
//
// ช่องทุจริตที่ตรงที่สุดของร้านค้าปลีก: เอาของที่ไม่ได้ซื้อ (หรือขโมยมา) มาคืนเอาเงิน
// จึงบังคับสามชั้นพร้อมกัน — หัวหน้ากด PIN, ต้องมีเหตุผล, และราคาที่คืนห้ามเกิน
// ราคาขายปัจจุบัน (ไม่งั้นจ่ายออกได้ไม่จำกัดด้วยการพิมพ์ตัวเลขเอง)
//
// เงินสดที่จ่ายออกถูกบันทึกเป็น "เงินออกจากลิ้นชัก" ในตารางเดียวกับ 7.97 โดยตั้งใจ
// เพราะยอดเงินที่ควรมีตอนปิดกะมีสูตรเดียวเท่านั้น การเพิ่มแหล่งเงินออกใหม่โดยไม่
// เข้าสูตรนั้น = ปิดกะแล้วเงินขาดโดยไม่มีใครอธิบายได้
//
// ⚠️ ไม่ออกใบลดหนี้: ไม่มีใบกำกับต้นทางให้อ้างอิง แถวนี้เป็นหลักฐานภายในให้บัญชี
// จัดการต่อ ไม่ใช่เอกสารภาษี

export type BlindReturnResult =
  | { status: "RETURNED"; blindReturnId: string; refundAmount: number; replayed: boolean }
  | { status: "SHIFT_NOT_OPEN" }
  | { status: "EMPTY" }
  | { status: "INVALID"; reason: string }
  | { status: "PRICE_TOO_HIGH"; sku: string; maxUnitRefund: number; requested: number }
  | { status: "NOT_ENOUGH_CASH"; available: number | null };

export async function blindReturnPosSale(input: {
  tenantId: string;
  deviceId: string;
  shiftId: string;
  actorUserId: string;
  approvedByUserId: string;
  reason: string;
  customerId?: string | null;
  customerNote?: string | null;
  lines: Array<{ sku: string; size: string; qty: number; unitRefund: number }>;
  idempotencyKey: string;
}): Promise<BlindReturnResult> {
  if (input.actorUserId.trim().toLowerCase() === input.approvedByUserId.trim().toLowerCase()) {
    return { status: "INVALID", reason: "ผู้อนุมัติต้องเป็นคนละคนกับพนักงานที่รับคืน" };
  }
  const reason = input.reason.trim();
  if (!reason) return { status: "INVALID", reason: "ต้องระบุเหตุผล" };
  if (reason.length > 300) return { status: "INVALID", reason: "เหตุผลยาวเกินไป" };
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 240) {
    return { status: "INVALID", reason: "idempotencyKey ไม่ถูกต้อง" };
  }

  const lines = input.lines
    .map((l) => ({
      sku: l.sku.trim(),
      size: l.size.trim(),
      qty: Math.trunc(Number(l.qty)),
      unitRefund: Math.round(Number(l.unitRefund) * 100) / 100,
    }))
    .filter((l) => l.sku && l.size && Number.isInteger(l.qty) && l.qty > 0
      && Number.isFinite(l.unitRefund) && l.unitRefund >= 0);
  if (lines.length === 0) return { status: "EMPTY" };

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });

    // ล็อกกะก่อนเช็ก replay: สองคำขอที่ใช้ key เดียวกันพร้อมกันจะเข้าแถวกัน
    // คำขอหลังจึงเห็น head ที่คำขอแรก commit แล้ว แทนที่จะชน unique index เป็น 500
    // เลือกกะปิดแล้วด้วยเพื่อให้ response ที่หายก่อนปิดกะยัง replay ได้
    const shift = await client.query<{ id: string; location_id: string; opening_float: string; status: string }>(
      `SELECT id, location_id, opening_float, status FROM bms_pos_shifts
        WHERE tenant_id = $1 AND id = $2 AND device_id = $3 FOR UPDATE`,
      [input.tenantId, input.shiftId, input.deviceId]
    );
    const replay = await client.query<{ id: string; refund_amount: string }>(
      `SELECT id, refund_amount FROM bms_pos_blind_returns
        WHERE tenant_id = $1 AND idempotency_key = $2`,
      [input.tenantId, idempotencyKey]
    );
    if (replay.rows[0]) {
      await client.query("ROLLBACK");
      return {
        status: "RETURNED",
        blindReturnId: replay.rows[0].id,
        refundAmount: Number(replay.rows[0].refund_amount),
        replayed: true,
      };
    }
    if (!shift.rowCount || shift.rows[0].status !== "OPEN") {
      await client.query("ROLLBACK");
      return { status: "SHIFT_NOT_OPEN" };
    }
    const locationId = shift.rows[0].location_id;

    if (input.customerId) {
      const customer = await client.query(
        `SELECT 1 FROM bms_customers WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.customerId]
      );
      if (!customer.rowCount) {
        await client.query("ROLLBACK");
        return { status: "INVALID", reason: "ลูกค้าที่ระบุไม่ได้อยู่ในร้านนี้" };
      }
    }

    // ราคาที่คืนห้ามเกินราคาขายปัจจุบัน — ไม่มีบิลต้นทางให้ยึด ราคาป้ายวันนี้จึงเป็น
    // เพดานเดียวที่ตรวจได้ · ถ้าไม่มีเพดาน พนักงานพิมพ์เลขอะไรก็ได้แล้วเงินออกตามนั้น
    let refundAmount = 0;
    for (const line of lines) {
      const variant = await client.query(
        `SELECT 1 FROM bms_inventory
          WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
        [input.tenantId, locationId, line.sku, line.size]
      );
      const maxUnitRefund = await getVariantBasePriceInTx(client, input.tenantId, line.sku, line.size);
      if (!variant.rowCount || maxUnitRefund == null) {
        await client.query("ROLLBACK");
        return { status: "INVALID", reason: `ไม่พบสินค้า ${line.sku} ขนาด ${line.size} ที่เปิดขายอยู่ในสาขานี้` };
      }
      if (line.unitRefund > maxUnitRefund + 0.001) {
        await client.query("ROLLBACK");
        return { status: "PRICE_TOO_HIGH", sku: line.sku, maxUnitRefund, requested: line.unitRefund };
      }
      refundAmount += line.unitRefund * line.qty;
    }
    refundAmount = Math.round(refundAmount * 100) / 100;

    // เงินสดต้องมีพอจริง — จ่ายเงินที่ลิ้นชักไม่มีให้จ่ายไม่ได้ในโลกจริง
    const drawer = await drawerExpectedInTx(client, input.tenantId, input.shiftId, Number(shift.rows[0].opening_float));
    if (refundAmount > drawer + 0.001) {
      await client.query("ROLLBACK");
      const blind = (await getVatSettings(input.tenantId)).blindClose;
      return { status: "NOT_ENOUGH_CASH", available: blind ? null : drawer };
    }

    const head = await client.query<{ id: string }>(
      `INSERT INTO bms_pos_blind_returns
         (tenant_id, location_id, device_id, shift_id, returned_by, approved_by,
          reason, customer_id, customer_note, refund_amount, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [input.tenantId, locationId, input.deviceId, input.shiftId, input.actorUserId,
        input.approvedByUserId, reason, input.customerId ?? null, input.customerNote ?? null,
        refundAmount, idempotencyKey]
    );
    const blindReturnId = head.rows[0].id;

    for (const line of lines) {
      await client.query(
        `INSERT INTO bms_pos_blind_return_items
           (tenant_id, blind_return_id, product_sku, size, qty, unit_refund)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.tenantId, blindReturnId, line.sku, line.size, line.qty, line.unitRefund]
      );
      // ของกลับเข้าสต็อกที่สาขาของเครื่องนี้ · ไม่คืนล็อตเพราะไม่รู้ว่าของมาจากล็อตไหน
      // (ไม่มีบิลต้นทาง) — ลงเป็นของเข้าใหม่ที่ไม่ผูกล็อต ซึ่งตรงกับความจริง
      await client.query(
        `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
         VALUES ($1,$2,$3,$4,$5,0)
         ON CONFLICT (tenant_id, location_id, product_sku, size)
           DO UPDATE SET current_stock = bms_inventory.current_stock + EXCLUDED.current_stock, updated_at = now()`,
        [input.tenantId, locationId, line.sku, line.size, line.qty]
      );
      await recordMovement(client, {
        tenantId: input.tenantId, locationId, sku: line.sku, size: line.size,
        type: "RETURN", qty: line.qty,
        note: `คืนไม่มีใบเสร็จ: ${reason}`, actor: input.actorUserId,
      });
    }

    // เงินออกลงตารางเดียวกับเงินลิ้นชักปกติ เพื่อให้สูตรเงินที่ควรมีตอนปิดกะมีที่เดียว
    if (refundAmount > 0) {
      await client.query(
        `INSERT INTO bms_pos_cash_movements
           (tenant_id, shift_id, device_id, direction, amount, reason, actor_user_id, approved_by)
         VALUES ($1,$2,$3,'OUT',$4,$5,$6,$7)`,
        [input.tenantId, input.shiftId, input.deviceId, refundAmount,
          `คืนสินค้าไม่มีใบเสร็จ: ${reason}`, input.actorUserId, input.approvedByUserId]
      );
    }

    // นี่คือเส้นทางรับของและจ่ายเงินออกโดยไม่มีใบเสร็จต้นทาง จึงต้องมีหลักฐาน
    // กลางใน transaction เดียวกับ stock/cash ไม่ใช่อาศัยเฉพาะตารางเฉพาะทาง
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'pos.blind_return',$3,$4)`,
      [input.tenantId, input.actorUserId, blindReturnId, JSON.stringify({
        shiftId: input.shiftId,
        deviceId: input.deviceId,
        approvedBy: input.approvedByUserId,
        customerId: input.customerId ?? null,
        refundAmount,
        lineCount: lines.length,
        reason,
      })]
    );

    await client.query("COMMIT");
    return { status: "RETURNED", blindReturnId, refundAmount, replayed: false };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// เลขเครื่อง / IMEI (8.3)
// ---------------------------------------------------------------
//
// ล็อต (7.85) ตอบว่า "ของมาจากชุดไหน" · serial ตอบว่า "เครื่องเลขนี้ขายให้ใครวันไหน"
// ซึ่งเป็นคำถามที่เกิดขึ้นตอนลูกค้าเอาของมาเคลมประกัน
//
// เก็บตอนขาย ไม่ใช่ตอนรับเข้า — ร้านเล็กไม่มีใครนั่งยิง 50 เครื่องเข้าระบบตอนของมาถึง
// แต่ตอนขายต้องหยิบกล่องมาสแกนอยู่แล้ว

/**
 * ตรวจเลขเครื่องก่อนเปิดบิล — คืน null เมื่อผ่าน
 *
 * ตรวจสองอย่าง: ครบจำนวนไหม และเลขนั้นเคยขายไปแล้วหรือยัง
 * อย่างที่สองสำคัญกว่าที่คิด — พนักงานหยิบกล่องผิดใบเป็นเรื่องปกติ และถ้าปล่อยผ่าน
 * ประวัติประกันจะชี้ไปที่ลูกค้าคนก่อน ซึ่งเป็นความผิดพลาดที่รู้ตอนมีคนมาเคลมแล้ว
 */
async function validatePosSaleSerials(
  tenantId: string,
  lines: CanonicalPosSerialLine[]
): Promise<PosSaleResult | null> {
  const skus = Array.from(new Set(lines.map((l) => l.sku)));
  if (skus.length === 0) return null;

  const tracked = await query<{ sku: string }>(
    `SELECT sku FROM bms_products
      WHERE tenant_id = $1 AND sku = ANY($2::text[]) AND serial_tracked`,
    [tenantId, skus]
  );
  if (tracked.rowCount === 0) return null;
  const trackedSkus = new Set(tracked.rows.map((r) => r.sku));

  const allGiven: string[] = [];
  for (const line of lines) {
    if (!trackedSkus.has(line.sku)) continue;
    const need = line.quantity;
    const given = line.serials
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
    if (given.length !== need) {
      return { status: "SERIAL_REQUIRED", sku: line.sku, expected: need, received: given.length };
    }
    allGiven.push(...given);
  }
  // ต้องตรวจทั้งบิล ไม่ใช่ทีละบรรทัด: serial เดียวกันอาจถูกยิงในสองบรรทัด
  if (new Set(allGiven).size !== allGiven.length) {
    const seen = new Set<string>();
    let duplicate = "";
    for (const serial of allGiven) {
      if (seen.has(serial)) {
        duplicate = serial;
        break;
      }
      seen.add(serial);
    }
    const owner = lines.find((line) => line.serials.includes(duplicate));
    return { status: "SERIAL_REQUIRED", sku: owner?.sku ?? "", expected: allGiven.length, received: new Set(allGiven).size };
  }
  if (allGiven.length > 0) {
    const clash = await query<{ product_sku: string; serial: string }>(
      `SELECT product_sku, serial FROM bms_product_serials
        WHERE tenant_id = $1 AND serial = ANY($2::text[]) AND status = 'SOLD'
        LIMIT 1`,
      [tenantId, allGiven]
    );
    if (clash.rowCount) {
      return { status: "SERIAL_ALREADY_SOLD", sku: clash.rows[0].product_sku, serial: clash.rows[0].serial };
    }
  }
  return null;
}

class PosSerialAlreadySoldError extends Error {
  constructor(readonly sku: string, readonly serial: string) {
    super(`serial ${serial} ถูกขายไปแล้ว`);
  }
}

/**
 * บันทึกเลขเครื่องผูกกับบิล — เรียกในทรานแซกชันที่ปิดการขายเท่านั้น
 *
 * ต้องอยู่ในทรานแซกชันเดียวกับการขาย: บิลที่ commit แล้วต้องไม่มีทางขาดเลขเครื่อง
 * ของสินค้าที่บังคับเลขเครื่อง ไม่งั้นประวัติประกันมีรูโดยไม่มีใครรู้
 *
 * ON CONFLICT DO UPDATE เพื่อรองรับเครื่องที่ถูกคืนมาแล้วขายใหม่ (status RETURNED
 * → SOLD) ซึ่งเป็นเรื่องปกติของสินค้ามือสอง/เครื่องเปลี่ยนคืน
 */
async function recordSerialsInTx(
  client: PoolClient,
  tenantId: string,
  locationId: string,
  orderId: string,
  lines: CanonicalPosSerialLine[]
): Promise<void> {
  for (const line of lines) {
    const serials = line.serials.map((x) => String(x ?? "").trim()).filter(Boolean);
    if (serials.length === 0) continue;
    for (const serial of serials) {
      const written = await client.query(
        `INSERT INTO bms_product_serials
           (tenant_id, product_sku, size, serial, status, location_id, order_id, sold_at)
         VALUES ($1,$2,$3,$4,'SOLD',$5,$6,now())
         ON CONFLICT (tenant_id, serial) DO UPDATE
           SET status = 'SOLD', order_id = EXCLUDED.order_id, sold_at = now(),
               product_sku = EXCLUDED.product_sku, size = EXCLUDED.size,
               location_id = EXCLUDED.location_id, returned_at = NULL, updated_at = now()
          WHERE bms_product_serials.status = 'RETURNED'
          RETURNING id`,
        [tenantId, line.sku, line.size, serial, locationId, orderId]
      );
      // ON CONFLICT รอ transaction คู่แข่งก่อนประเมิน WHERE จึงปิด race ที่ precheck
      // ทั้งสองคำขอเห็นว่า serial ยังว่างพร้อมกัน แล้วคำขอหลังขโมยแถว SOLD ไปไม่ได้
      if (!written.rowCount) throw new PosSerialAlreadySoldError(line.sku, serial);
    }
  }
}

export type ProductSerial = {
  serial: string;
  sku: string;
  size: string;
  status: "IN_STOCK" | "SOLD" | "RETURNED";
  orderId: string | null;
  soldAt: string | null;
  returnedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
};

/**
 * ค้นว่าเครื่องเลขนี้ขายให้ใครวันไหน — คำถามเดียวที่ทำให้ฟีเจอร์นี้คุ้มค่า
 * ใช้ตอนลูกค้าเอาของมาเคลมประกันโดยไม่มีใบเสร็จ
 */
export async function findSerial(tenantId: string, serial: string): Promise<ProductSerial | null> {
  const code = serial.trim();
  if (!code) return null;
  const res = await query<any>(
    `SELECT s.serial, s.product_sku, s.size, s.status, s.order_id, s.sold_at, s.returned_at,
            c.name AS customer_name, c.phone AS customer_phone
       FROM bms_product_serials s
       LEFT JOIN bms_orders o ON o.id = s.order_id AND o.tenant_id = s.tenant_id
       LEFT JOIN bms_customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
      WHERE s.tenant_id = $1 AND s.serial = $2`,
    [tenantId, code]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    serial: r.serial,
    sku: r.product_sku,
    size: r.size,
    status: r.status,
    orderId: r.order_id ?? null,
    soldAt: r.sold_at ? toISO(r.sold_at) : null,
    returnedAt: r.returned_at ? toISO(r.returned_at) : null,
    customerName: r.customer_name ?? null,
    customerPhone: r.customer_phone ?? null,
  };
}

/** เลขเครื่องทั้งหมดของบิล — พิมพ์บนใบเสร็จ/ใบรับประกันได้ */
export async function listSerialsForOrder(tenantId: string, orderId: string): Promise<ProductSerial[]> {
  const res = await query<any>(
    `SELECT serial, product_sku, size, status, order_id, sold_at, returned_at
       FROM bms_product_serials
      WHERE tenant_id = $1 AND order_id = $2 ORDER BY product_sku, serial`,
    [tenantId, orderId]
  );
  return res.rows.map((r: any) => ({
    serial: r.serial, sku: r.product_sku, size: r.size, status: r.status,
    orderId: r.order_id ?? null,
    soldAt: r.sold_at ? toISO(r.sold_at) : null,
    returnedAt: r.returned_at ? toISO(r.returned_at) : null,
    customerName: null, customerPhone: null,
  }));
}

// ---------------------------------------------------------------
// ปิดบิลมัดจำ — ลูกค้ามารับของและจ่ายส่วนที่เหลือ (9.0)
// ---------------------------------------------------------------
//
// ใช้ finalizePosSale ตัวเดียวกับการขายปกติโดยตั้งใจ: การรับของคือจุดที่การขาย
// เกิดขึ้นจริง จึงต้องได้ทุกอย่างที่การขายได้ — ตัดสต็อก ตัดล็อต FEFO ออกใบกำกับ
// ให้แต้ม บันทึก audit · เขียนเส้นทางที่สองขึ้นมาคือมีสองที่ที่ต้องถูกต้องเท่ากัน
//
// ⚠️ ใบกำกับภาษีออกที่นี่ ไม่ใช่ตอนวางมัดจำ — ตรงกับจุดที่กรรมสิทธิ์โอนจริง

export type SettleDepositResult =
  | PosSaleResult
  | { status: "DEPOSIT_NOT_FOUND" }
  | { status: "BALANCE_MISMATCH"; expected: number; received: number };

export async function settleDepositSale(input: {
  tenantId: string;
  deviceId: string;
  shiftId: string;
  cashierUserId: string;
  orderId: string;
  payments: PosPaymentInput[];
  serialLines?: Array<{ sku: string; size: string; serials: string[] }>;
}): Promise<SettleDepositResult> {
  const shiftRes = await query<{ id: string; location_id: string; device_id: string }>(
    `SELECT id, location_id, device_id FROM bms_pos_shifts
      WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'`,
    [input.tenantId, input.shiftId]
  );
  if (!shiftRes.rowCount) return { status: "SHIFT_NOT_OPEN" };
  const shift = shiftRes.rows[0];
  if (shift.device_id !== input.deviceId) return { status: "SHIFT_NOT_OPEN" };

  const dep = await query<{ total_amount: string; deposit_paid: string; status: string }>(
    `SELECT total_amount, deposit_paid, status FROM bms_pos_deposits
      WHERE tenant_id = $1 AND order_id = $2 AND location_id = $3`,
    [input.tenantId, input.orderId, shift.location_id]
  );
  const row = dep.rows[0];
  if (!row || row.status !== "OPEN") return { status: "DEPOSIT_NOT_FOUND" };

  const balance = Math.round((Number(row.total_amount) - Number(row.deposit_paid)) * 100) / 100;
  const requested = input.payments
    .map((p) => ({ ...p, amount: Math.round(Number(p.amount) * 100) / 100 }))
    .filter((p) => Number.isFinite(p.amount) && p.amount > 0);
  const paid = Math.round(requested.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;

  // ยอดต้องตรงกับส่วนที่ค้างพอดี — เหตุผลเดียวกับกฎ PAYMENT_MISMATCH ของการขายปกติ
  // จ่ายเกิน/ขาดแล้วปล่อยผ่านคือเก็บเงินไม่ตรงกับที่ระบบคิด
  if (Math.abs(paid - balance) > 0.01) {
    return { status: "BALANCE_MISMATCH", expected: balance, received: paid };
  }

  // บิลมัดจำไม่ได้ผ่าน recordPosSale ตอนสร้าง จึงต้องอ่านจำนวน serial จาก order
  // ที่จองไว้จริงก่อนส่งมอบ ห้ามปิดด้วย lines=[] แล้วทำให้บิลขายสำเร็จแต่ประกันมีรู
  const requiredSerials = await query<{ product_sku: string; size: string; quantity: string }>(
    `SELECT oi.product_sku, oi.size, SUM(oi.qty)::text AS quantity
       FROM bms_order_items oi
       JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
      WHERE oi.tenant_id = $1 AND oi.order_id = $2 AND p.serial_tracked
      GROUP BY oi.product_sku, oi.size
      ORDER BY oi.product_sku, oi.size`,
    [input.tenantId, input.orderId]
  );
  const supplied = input.serialLines ?? [];
  const serialLines: CanonicalPosSerialLine[] = requiredSerials.rows.map((required) => ({
    sku: required.product_sku,
    size: required.size,
    quantity: Number(required.quantity),
    serials: supplied
      .filter((line) => line.sku === required.product_sku && line.size.toUpperCase() === required.size.toUpperCase())
      .flatMap((line) => line.serials.map((serial) => serial.trim()).filter(Boolean)),
  }));
  const serialCheck = await validatePosSaleSerials(input.tenantId, serialLines);
  if (serialCheck) return serialCheck;

  const settled = await finalizePosSale({
    input: {
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      shiftId: input.shiftId,
      cashierUserId: input.cashierUserId,
      idempotencyKey: `deposit-settle-${input.orderId}`,
      lines: [],
      payments: requested,
    },
    shift,
    orderId: input.orderId,
    // ยอดบิลเต็ม ไม่ใช่ยอดคงเหลือ
    //
    // finalizePosSale ตรวจว่ายอดบิลไม่เปลี่ยนระหว่างรับชำระโดยเทียบกับ total_amount
    // ของบิล · ส่งยอดคงเหลือมาจะถูกตีว่า "ยอดบิลเปลี่ยน" ทันที · และใบกำกับต้องแสดง
    // ยอดเต็มของบิลอยู่แล้ว เพราะนั่นคือมูลค่าที่ขายจริง ส่วนเงินมัดจำเป็นแถว payment
    // ที่ลงไว้ก่อนหน้าแล้ว การส่งยอดเต็มจึงถูกทั้งการตรวจและตัวเลขบนเอกสาร
    amountDue: Number(row.total_amount),
    payments: requested,
    replayed: false,
    serialLines,
    // เงินมัดจำที่ลงไว้แล้วเป็นของถูกต้อง — บอกยอดที่คาดไว้เพื่อให้ด่านตรวจ
    // เปลี่ยนจาก "ห้ามมีรายการเดิม" เป็น "ต้องมีเท่านี้พอดี"
    alreadyPaid: Number(row.deposit_paid),
    depositSettlement: {
      expectedDepositPaid: Number(row.deposit_paid),
      expectedTotal: Number(row.total_amount),
    },
  });
  return settled;
}
