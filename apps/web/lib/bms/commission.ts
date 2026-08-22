// =============================================================
// BMS — ค่าคอมมิชชันพนักงานขาย (8.5)
// -------------------------------------------------------------
// ระบบรู้อยู่แล้วว่าใครขายบิลไหน (bms_orders.cashier_user_id) ที่ขาดคืออัตราคอม
//
// สองเรื่องที่โมดูลนี้ตั้งใจทำให้ถูกตั้งแต่ต้น เพราะแก้ทีหลังแทบไม่ได้:
//
// 1. **อัตราต้องเป็นของ "วันที่ขาย" ไม่ใช่ "วันนี้"**
//    ร้านขึ้นอัตราจาก 2% เป็น 3% แล้วเปิดรายงานเดือนที่แล้ว ต้องได้ 2% เหมือนเดิม
//    ไม่ใช่ 3% · ถ้าเลขในระบบไม่ตรงกับสลิปที่จ่ายไปแล้ว รายงานนั้นใช้ตรวจอะไรไม่ได้
//
// 2. **ของที่ถูกคืนต้องหักคอมออก**
//    ไม่หัก = ขายแล้วให้ลูกค้าคืนวันถัดไปกลายเป็นวิธีปั๊มคอมฟรี ซึ่งเป็นการทุจริต
//    ที่ตรวจยากที่สุดแบบหนึ่ง เพราะทุกขั้นดูถูกต้องหมด · บิลที่ void ก็ไม่นับด้วย
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type CommissionScope = "DEFAULT" | "PRODUCT" | "CATEGORY";

export type CommissionRule = {
  id: number;
  scope: CommissionScope;
  ref: string | null;
  percent: number;
  effectiveFrom: string;
  note: string | null;
};

/**
 * ให้ Postgres แปลง DATE เป็นข้อความเอง แล้วอ่านตรง ๆ
 *
 * ห้ามรับ Date จาก pg มาทำ .toISOString().slice(0,10) — pg คืน DATE เป็น Date ที่
 * เที่ยงคืน "เวลาท้องถิ่น" แล้ว toISOString แปลงเป็น UTC ซึ่งในโซนไทย (UTC+7)
 * ถอยไปเป็นวันก่อนหน้าทุกครั้ง · วันเริ่มใช้ที่เลื่อนไป 1 วันแปลว่ารายงานคอมของ
 * วันแรกที่ขึ้นอัตราใช้อัตราผิด (เจอตอนเขียนเทสชุดนี้)
 */
const asDateText = (v: unknown): string => String(v ?? "").slice(0, 10);

export async function listCommissionRules(tenantId: string): Promise<CommissionRule[]> {
  const res = await query<any>(
    `SELECT id, scope, ref, percent, effective_from::text AS effective_from, note
       FROM bms_commission_rules
      WHERE tenant_id = $1
      ORDER BY scope, ref NULLS FIRST, effective_from DESC`,
    [tenantId]
  );
  return res.rows.map((r: any) => ({
    id: Number(r.id),
    scope: r.scope,
    ref: r.ref ?? null,
    percent: Number(r.percent),
    effectiveFrom: asDateText(r.effective_from),
    note: r.note ?? null,
  }));
}

export type UpsertRuleResult =
  | { status: "SAVED"; id: number }
  | { status: "INVALID"; reason: string };

/**
 * ตั้ง/แก้อัตรา — แก้อัตราคือ "เพิ่มแถวใหม่ที่วันเริ่มใช้ใหม่" ไม่ใช่ทับแถวเดิม
 * ทับแถวเดิมได้เฉพาะกรณีตั้งซ้ำวันเดียวกัน (แก้ที่พิมพ์ผิดในวันนั้น)
 */
export async function upsertCommissionRule(input: {
  tenantId: string;
  scope: CommissionScope;
  ref?: string | null;
  percent: number;
  effectiveFrom: string;
  note?: string | null;
  createdBy?: string | null;
}): Promise<UpsertRuleResult> {
  const percent = Math.round(Number(input.percent) * 1000) / 1000;
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { status: "INVALID", reason: "อัตราต้องอยู่ระหว่าง 0–100" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    return { status: "INVALID", reason: "วันเริ่มใช้ต้องเป็นรูปแบบ YYYY-MM-DD" };
  }
  const ref = input.scope === "DEFAULT" ? null : (input.ref ?? "").trim();
  if (input.scope !== "DEFAULT" && !ref) {
    return { status: "INVALID", reason: "ต้องระบุสินค้า/หมวดเมื่อไม่ใช่อัตราเริ่มต้น" };
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.createdBy });
    const res = await client.query<{ id: number }>(
      `INSERT INTO bms_commission_rules (tenant_id, scope, ref, percent, effective_from, note, created_by)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7)
       ON CONFLICT (tenant_id, scope, ref, effective_from) DO UPDATE
         SET percent = EXCLUDED.percent, note = EXCLUDED.note
       RETURNING id`,
      [input.tenantId, input.scope, ref, percent, input.effectiveFrom, input.note ?? null, input.createdBy ?? null]
    );
    await client.query("COMMIT");
    return { status: "SAVED", id: Number(res.rows[0].id) };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteCommissionRule(tenantId: string, id: number): Promise<boolean> {
  const res = await query(
    `DELETE FROM bms_commission_rules WHERE tenant_id = $1 AND id = $2`, [tenantId, id]
  );
  return (res.rowCount ?? 0) > 0;
}

export type CommissionRow = {
  staffId: string;
  staffName: string;
  /** ยอดขายที่นับคอม = ขายจริง − ของที่ถูกคืน (ไม่รวมบิลที่ยกเลิก) */
  eligibleSales: number;
  grossSales: number;
  returnedSales: number;
  commission: number;
  billCount: number;
};

export type CommissionReport = {
  from: string;
  to: string;
  rows: CommissionRow[];
  totalCommission: number;
  /** true = ร้านยังไม่ได้ตั้งอัตราเริ่มต้นไว้เลย ทุกตัวเลขจึงเป็น 0 */
  noRulesConfigured: boolean;
};

/**
 * รายงานคอมต่อพนักงานในช่วงเวลา
 *
 * คิดจากรายการในบิล (bms_order_items) ไม่ใช่ยอดหัวบิล เพราะอัตราคอมขึ้นกับสินค้า
 * และหมวด · ส่วนลดทั้งบิลถูกเกลี่ยตามสัดส่วนมูลค่ารายการ ไม่งั้นบิลที่ใช้คูปองใหญ่
 * จะจ่ายคอมบนยอดที่ร้านไม่ได้รับจริง
 *
 * อัตราที่ใช้คือกฎที่มีผล ณ วันที่ของบิลนั้น (LATERAL ต่อรายการ) — ตัวเลขย้อนหลัง
 * จึงไม่ขยับเมื่อร้านแก้อัตราวันนี้
 */
export async function getCommissionReport(
  tenantId: string, from: string, to: string
): Promise<CommissionReport> {
  const rules = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_commission_rules WHERE tenant_id = $1`, [tenantId]
  );
  const noRulesConfigured = Number(rules.rows[0]?.n ?? 0) === 0;

  const res = await query<any>(
    `WITH sold AS (
       SELECT o.id                AS order_id,
              o.cashier_user_id   AS staff_id,
              o.created_at::date  AS sold_on,
              oi.id               AS item_id,
              oi.product_sku,
              oi.qty,
              oi.unit_price,
              p.category,
              -- มูลค่ารายการหลังเกลี่ยส่วนลดทั้งบิลตามสัดส่วน
              (oi.unit_price * oi.qty)
                * CASE WHEN SUM(oi.unit_price * oi.qty) OVER (PARTITION BY o.id) > 0
                       THEN 1 - (o.discount_amount / SUM(oi.unit_price * oi.qty) OVER (PARTITION BY o.id))
                       ELSE 1 END                                        AS net_line,
              -- จำนวนที่ถูกคืนของรายการนี้
              COALESCE((
                SELECT SUM(ri.pack_qty)
                  FROM bms_pos_return_items ri
                  JOIN bms_pos_returns r ON r.id = ri.pos_return_id AND r.tenant_id = ri.tenant_id
                 WHERE ri.tenant_id = o.tenant_id AND ri.order_item_id = oi.id
                   AND r.is_void = FALSE
              ), 0)                                                       AS returned_qty
         FROM bms_orders o
         JOIN bms_order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
         LEFT JOIN bms_products p ON p.tenant_id = o.tenant_id AND p.sku = oi.product_sku
        WHERE o.tenant_id = $1
          AND o.cashier_user_id IS NOT NULL
          AND o.voided_at IS NULL
          AND o.status IN ('COMPLETED','RETURNED')
          AND o.created_at >= $2::date
          AND o.created_at < $3::date + interval '1 day'
     ),
     priced AS (
       SELECT s.*,
              -- กฎที่เจาะจงกว่าชนะ และต้องเป็นกฎที่มีผล ณ วันที่ขาย
              COALESCE(
                (SELECT cr.percent FROM bms_commission_rules cr
                  WHERE cr.tenant_id = $1 AND cr.scope = 'PRODUCT' AND cr.ref = s.product_sku
                    AND cr.effective_from <= s.sold_on
                  ORDER BY cr.effective_from DESC LIMIT 1),
                (SELECT cr.percent FROM bms_commission_rules cr
                  WHERE cr.tenant_id = $1 AND cr.scope = 'CATEGORY' AND cr.ref = s.category
                    AND cr.effective_from <= s.sold_on
                  ORDER BY cr.effective_from DESC LIMIT 1),
                (SELECT cr.percent FROM bms_commission_rules cr
                  WHERE cr.tenant_id = $1 AND cr.scope = 'DEFAULT'
                    AND cr.effective_from <= s.sold_on
                  ORDER BY cr.effective_from DESC LIMIT 1),
                0
              ) AS percent
         FROM sold s
     )
     SELECT staff_id,
            COALESCE(u.name, u.email, staff_id::text) AS staff_name,
            COUNT(DISTINCT order_id)::int             AS bill_count,
            COALESCE(SUM(net_line), 0)                AS gross_sales,
            -- มูลค่าที่ถูกคืน คิดตามสัดส่วนจำนวนที่คืนของรายการนั้น
            COALESCE(SUM(CASE WHEN qty > 0
                              THEN net_line * (LEAST(returned_qty, qty)::numeric / qty)
                              ELSE 0 END), 0)         AS returned_sales,
            COALESCE(SUM(
              (net_line - CASE WHEN qty > 0
                               THEN net_line * (LEAST(returned_qty, qty)::numeric / qty)
                               ELSE 0 END) * percent / 100
            ), 0)                                     AS commission
       FROM priced
       LEFT JOIN users u ON u.id = priced.staff_id
      GROUP BY staff_id, u.name, u.email
      ORDER BY commission DESC`,
    [tenantId, from, to]
  );

  const rows: CommissionRow[] = res.rows.map((r: any) => {
    const gross = Math.round(Number(r.gross_sales) * 100) / 100;
    const returned = Math.round(Number(r.returned_sales) * 100) / 100;
    return {
      staffId: String(r.staff_id),
      staffName: String(r.staff_name ?? "ไม่ทราบ"),
      grossSales: gross,
      returnedSales: returned,
      eligibleSales: Math.round((gross - returned) * 100) / 100,
      commission: Math.round(Number(r.commission) * 100) / 100,
      billCount: Number(r.bill_count ?? 0),
    };
  });

  return {
    from,
    to,
    rows,
    totalCommission: Math.round(rows.reduce((sum, r) => sum + r.commission, 0) * 100) / 100,
    noRulesConfigured,
  };
}
