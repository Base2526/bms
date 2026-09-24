// =============================================================
// รายงานสินค้าและวัตถุดิบ — ยอดยกมา · รับเข้า · จ่ายออก · คงเหลือ (อ่านอย่างเดียว)
// -------------------------------------------------------------
// ผู้ประกอบการที่จด VAT ต้องทำรายงานสินค้าและวัตถุดิบเป็นรายสถานประกอบการ รายงานนี้สร้าง
// จาก bms_stock_movements ซึ่งเป็น ledger ของทุกการขยับ current_stock (หน่วยฐานเสมอ)
//
// การจัดกลุ่ม movement:
//   รับเข้า  STOCK_IN (note "PO:" = ซื้อ, อื่น ๆ = ปรับเพิ่ม) · RETURN · TRANSFER_IN · COUNT_ADJUST/IN
//   จ่ายออก  SHIP (ขาย) · STOCK_OUT (ปรับลด) · TRANSFER_OUT · WASTAGE · COUNT_ADJUST/OUT
//   ไม่นับ   RESERVE / RELEASE (แตะแค่ reserved) · QUARANTINE_IN (ไม่เข้า current_stock)
//            TRANSFER_LOST (ของออกไปแล้วตอน TRANSFER_OUT — นับซ้ำ = จ่ายออกสองรอบ)
//
// ⚠️ ยอดที่ไม่มีหลักฐานการเคลื่อนไหว: สต็อกก่อน migration 3.4 และข้อมูลที่ seed ตรง ๆ ไม่มี
// movement ขารับเข้า ผลรวม ledger ทั้งหมดจึงอาจไม่เท่า current_stock · ส่วนต่างถูกนับเป็น
// "ยอดยกมาที่ไม่มีหลักฐาน" และแสดงแยกเสมอ — ห้ามกลืนเข้ายอดยกมาเงียบ ๆ เพราะนั่นคือสิ่งที่
// นักบัญชีต้องถาม
//
// ⚠️ มูลค่าคิดจาก bms_products.cost_price ปัจจุบัน (ไม่ใช่ FIFO/ถัวเฉลี่ย) และแสดงว่าเป็น
// ค่าประมาณ — ระบบยังไม่มีการตีราคาสินค้าคงเหลือตามวิธีบัญชี
// =============================================================

import { query } from "@/lib/db";
import { assertTaxPeriod, round2 } from "./taxReportMath";

export type StockLedgerRow = {
  locationId: string;
  branchCode: string;
  sku: string;
  size: string;
  productName: string;
  unit: string;
  /** ยอดยกมาจาก ledger (ก่อนวันแรกของช่วง) */
  openingRecorded: number;
  /** ส่วนต่าง current_stock − ผลรวม ledger ทั้งหมด (ไม่มี movement รองรับ) */
  openingUnrecorded: number;
  opening: number;
  purchased: number;
  adjustedIn: number;
  returned: number;
  transferredIn: number;
  countedUp: number;
  totalIn: number;
  sold: number;
  adjustedOut: number;
  transferredOut: number;
  wasted: number;
  countedDown: number;
  totalOut: number;
  closing: number;
  /** COUNT_ADJUST ที่ไม่มีทิศทาง (แถวเก่าก่อน 10.10 ที่อ่าน note ไม่ออก) — ไม่ถูกนับ */
  unknownCountAdjust: number;
  unitCost: number | null;
  closingValue: number | null;
};

export type StockLedgerReport = {
  period: { from: string; to: string };
  establishments: Array<{ locationId: string; code: string; name: string; branchCode: string; isHeadOffice: boolean }>;
  rows: StockLedgerRow[];
  /** รายการที่มีส่วนต่างไม่มีหลักฐาน — นักบัญชีต้องเห็น */
  unrecordedCount: number;
  unknownDirectionCount: number;
  missingCostCount: number;
  totalClosingValue: number | null;
};

const IN_TYPES_SQL = `m.type IN ('STOCK_IN','RETURN','TRANSFER_IN') OR (m.type = 'COUNT_ADJUST' AND m.direction = 'IN')`;
const OUT_TYPES_SQL = `m.type IN ('STOCK_OUT','SHIP','TRANSFER_OUT','WASTAGE') OR (m.type = 'COUNT_ADJUST' AND m.direction = 'OUT')`;

export async function getStockLedger(
  tenantId: string,
  input: { from: string; to: string; locationId?: string | null; allowedLocationIds?: string[] | null }
): Promise<StockLedgerReport> {
  const { from, to } = assertTaxPeriod(input.from, input.to);
  const locationId = input.locationId ?? null;
  const allowedLocationIds = input.allowedLocationIds ?? null;

  const locRes = await query<any>(
    `SELECT id, code, name, branch_code, is_head_office FROM bms_locations
      WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
        AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
      ORDER BY is_head_office DESC, branch_code, code`,
    [tenantId, locationId, allowedLocationIds]
  );
  if (locationId && !locRes.rowCount) throw new Error("ไม่พบสาขานี้ หรือสาขาไม่ได้อยู่ในร้านปัจจุบัน");

  // เวลาตัดงวดตามวันไทย เหมือนรายงานอื่นทั้งหมดใน reports.ts
  const res = await query<any>(
    `WITH bounds AS (
       SELECT ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok') AS t_from,
              (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok') AS t_to
     ),
     mv AS (
       SELECT m.location_id, m.product_sku, m.size, m.type, m.direction, m.qty, m.note, m.created_at,
              CASE WHEN ${IN_TYPES_SQL} THEN m.qty
                   WHEN ${OUT_TYPES_SQL} THEN -m.qty
                   ELSE 0 END AS signed
         FROM bms_stock_movements m
        WHERE m.tenant_id = $1 AND ($4::uuid IS NULL OR m.location_id = $4::uuid)
          AND ($5::uuid[] IS NULL OR m.location_id = ANY($5::uuid[]))
     ),
     agg AS (
       SELECT mv.location_id, mv.product_sku, mv.size,
              COALESCE(SUM(mv.signed), 0)                                                  AS all_time,
              COALESCE(SUM(mv.signed) FILTER (WHERE mv.created_at < b.t_from), 0)          AS before_from,
              COALESCE(SUM(mv.signed) FILTER (WHERE mv.created_at >= b.t_to), 0)           AS after_to,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.created_at >= b.t_from AND mv.created_at < b.t_to
                  AND mv.type = 'STOCK_IN' AND mv.note LIKE 'PO:%'), 0)                     AS purchased,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.created_at >= b.t_from AND mv.created_at < b.t_to
                  AND mv.type = 'STOCK_IN' AND (mv.note IS NULL OR mv.note NOT LIKE 'PO:%')), 0) AS adjusted_in,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.created_at >= b.t_from AND mv.created_at < b.t_to
                  AND mv.type = 'RETURN'), 0)                                               AS returned,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.created_at >= b.t_from AND mv.created_at < b.t_to
                  AND mv.type = 'TRANSFER_IN'), 0)                                          AS transferred_in,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.created_at >= b.t_from AND mv.created_at < b.t_to
                  AND mv.type = 'COUNT_ADJUST' AND mv.direction = 'IN'), 0)                 AS counted_up,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.created_at >= b.t_from AND mv.created_at < b.t_to
                  AND mv.type = 'SHIP'), 0)                                                 AS sold,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.created_at >= b.t_from AND mv.created_at < b.t_to
                  AND mv.type = 'STOCK_OUT'), 0)                                            AS adjusted_out,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.created_at >= b.t_from AND mv.created_at < b.t_to
                  AND mv.type = 'TRANSFER_OUT'), 0)                                         AS transferred_out,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.created_at >= b.t_from AND mv.created_at < b.t_to
                  AND mv.type = 'WASTAGE'), 0)                                              AS wasted,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.created_at >= b.t_from AND mv.created_at < b.t_to
                  AND mv.type = 'COUNT_ADJUST' AND mv.direction = 'OUT'), 0)                AS counted_down,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.type = 'COUNT_ADJUST' AND mv.direction IS NULL), 0)
                                                                                           AS unknown_count
         FROM mv CROSS JOIN bounds b
        GROUP BY mv.location_id, mv.product_sku, mv.size
     ),
     keys AS (
       SELECT location_id, product_sku, size FROM agg
       UNION
       SELECT location_id, product_sku, size FROM bms_inventory
         WHERE tenant_id = $1 AND ($4::uuid IS NULL OR location_id = $4::uuid)
           AND ($5::uuid[] IS NULL OR location_id = ANY($5::uuid[]))
     )
     SELECT k.location_id, l.branch_code, k.product_sku, k.size,
            COALESCE(p.name, k.product_sku) AS product_name,
            COALESCE(
              (SELECT pk.unit_name FROM bms_product_packs pk
                WHERE pk.tenant_id = $1 AND pk.product_sku = k.product_sku AND pk.is_base AND pk.active
                  AND (pk.size = k.size OR pk.size IS NULL)
                ORDER BY (pk.size = k.size) DESC NULLS LAST LIMIT 1),
              sp.display_unit, sp.base_unit
            ) AS unit,
            p.cost_price,
            COALESCE(i.current_stock, 0) AS current_stock,
            COALESCE(a.all_time, 0) AS all_time, COALESCE(a.before_from, 0) AS before_from,
            COALESCE(a.after_to, 0) AS after_to,
            COALESCE(a.purchased, 0) AS purchased, COALESCE(a.adjusted_in, 0) AS adjusted_in,
            COALESCE(a.returned, 0) AS returned, COALESCE(a.transferred_in, 0) AS transferred_in,
            COALESCE(a.counted_up, 0) AS counted_up, COALESCE(a.sold, 0) AS sold,
            COALESCE(a.adjusted_out, 0) AS adjusted_out, COALESCE(a.transferred_out, 0) AS transferred_out,
            COALESCE(a.wasted, 0) AS wasted, COALESCE(a.counted_down, 0) AS counted_down,
            COALESCE(a.unknown_count, 0) AS unknown_count
       FROM keys k
       JOIN bms_locations l ON l.tenant_id = $1 AND l.id = k.location_id
       LEFT JOIN agg a ON a.location_id = k.location_id AND a.product_sku = k.product_sku AND a.size = k.size
       LEFT JOIN bms_inventory i ON i.tenant_id = $1 AND i.location_id = k.location_id
                                AND i.product_sku = k.product_sku AND i.size = k.size
       LEFT JOIN bms_products p ON p.tenant_id = $1 AND p.sku = k.product_sku
       LEFT JOIN bms_product_stock_policies sp ON sp.tenant_id = $1 AND sp.product_sku = k.product_sku
      ORDER BY l.is_head_office DESC, l.branch_code, k.product_sku, k.size`,
    [tenantId, from, to, locationId, allowedLocationIds]
  );

  const rows: StockLedgerRow[] = [];
  let unrecordedCount = 0;
  let unknownDirectionCount = 0;
  let missingCostCount = 0;
  let totalValue = 0;

  for (const r of res.rows) {
    const n = (v: unknown) => Number(v ?? 0);
    const unrecorded = n(r.current_stock) - n(r.all_time);
    const openingRecorded = n(r.before_from);
    const opening = openingRecorded + unrecorded;
    const totalIn = n(r.purchased) + n(r.adjusted_in) + n(r.returned) + n(r.transferred_in) + n(r.counted_up);
    const totalOut = n(r.sold) + n(r.adjusted_out) + n(r.transferred_out) + n(r.wasted) + n(r.counted_down);
    const closing = opening + totalIn - totalOut;
    // แถวที่ไม่มีอะไรเลยในทุกช่อง (เช่นเมนูสูตรที่สต็อกตัวเองเป็น 0 ตามดีไซน์) ไม่ต้องรก
    if (opening === 0 && totalIn === 0 && totalOut === 0 && closing === 0 && n(r.unknown_count) === 0) continue;

    const unitCost = r.cost_price == null ? null : Number(r.cost_price);
    const closingValue = unitCost == null ? null : round2(unitCost * closing);
    if (unrecorded !== 0) unrecordedCount += 1;
    if (n(r.unknown_count) > 0) unknownDirectionCount += 1;
    if (unitCost == null && closing !== 0) missingCostCount += 1;
    if (closingValue != null) totalValue += closingValue;

    rows.push({
      locationId: r.location_id,
      branchCode: r.branch_code,
      sku: r.product_sku,
      size: r.size,
      productName: r.product_name,
      unit: r.unit ?? "หน่วย",
      openingRecorded,
      openingUnrecorded: unrecorded,
      opening,
      purchased: n(r.purchased),
      adjustedIn: n(r.adjusted_in),
      returned: n(r.returned),
      transferredIn: n(r.transferred_in),
      countedUp: n(r.counted_up),
      totalIn,
      sold: n(r.sold),
      adjustedOut: n(r.adjusted_out),
      transferredOut: n(r.transferred_out),
      wasted: n(r.wasted),
      countedDown: n(r.counted_down),
      totalOut,
      closing,
      unknownCountAdjust: n(r.unknown_count),
      unitCost,
      closingValue,
    });
  }

  return {
    period: { from, to },
    establishments: locRes.rows.map((l: any) => ({
      locationId: l.id, code: l.code, name: l.name, branchCode: l.branch_code, isHeadOffice: Boolean(l.is_head_office),
    })),
    rows,
    unrecordedCount,
    unknownDirectionCount,
    missingCostCount,
    totalClosingValue: missingCostCount > 0 ? null : round2(totalValue),
  };
}
