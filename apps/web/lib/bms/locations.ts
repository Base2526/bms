// =============================================================
// BMS Locations — สาขา/จุดเก็บสต็อก (migration 7.84)
// -------------------------------------------------------------
// สต็อก ออร์เดอร์ และ movement ทุกแถวผูกกับสาขาแล้ว ตั้งแต่ 7.84
// ตอนนี้ทุกร้านมีสาขาเดียว (code = 'MAIN') → call site ที่ยังไม่รู้จักสาขา
// เรียก resolveDefaultLocationId* เพื่อได้สาขานั้น พฤติกรรมจึงเหมือนเดิมทุกประการ
//
// ⚠️ ก่อนเปิดสาขาที่ 2 ของร้านไหนก็ตาม: ทุก call site ที่ยัง fallback มาที่นี่
// ต้องถูกแก้ให้ส่งสาขาจริงเข้ามาก่อน ไม่งั้นจะตัดสต็อกผิดสาขาแบบเงียบ ๆ
// หา call site ได้จาก: grep -rn "resolveDefaultLocationId" apps/web/lib
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";

export const DEFAULT_LOCATION_CODE = "MAIN";

export type BmsLocation = {
  id: string;
  code: string;
  name: string;
  branchCode: string;
  isHeadOffice: boolean;
  vatCode: string | null;
  address: string | null;
  phone: string | null;
  pharmacyLicenseNo: string | null;
  pharmacistName: string | null;
  pharmacistLicenseNo: string | null;
  active: boolean;
};

function mapRow(r: any): BmsLocation {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    branchCode: r.branch_code,
    isHeadOffice: r.is_head_office,
    vatCode: r.vat_code ?? null,
    address: r.address ?? null,
    phone: r.phone ?? null,
    pharmacyLicenseNo: r.pharmacy_license_no ?? null,
    pharmacistName: r.pharmacist_name ?? null,
    pharmacistLicenseNo: r.pharmacist_license_no ?? null,
    active: r.active,
  };
}

/**
 * สาขาเริ่มต้นของร้าน — MAIN ก่อน ถ้าไม่มีก็สำนักงานใหญ่ ถ้าไม่มีอีกก็สาขาที่เก่าสุด
 * throw เมื่อร้านไม่มีสาขาเลย เพราะเขียนสต็อกต่อไม่ได้ (7.84 seed ให้ทุกร้านแล้ว
 * — ถ้าเจอ error นี้แปลว่าร้านถูกสร้างหลัง migration โดยไม่ได้สร้างสาขาให้)
 */
export async function resolveDefaultLocationIdInTx(
  client: PoolClient,
  tenantId: string
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM bms_locations
      WHERE tenant_id = $1 AND active
      ORDER BY (code = $2) DESC, is_head_office DESC, created_at
      LIMIT 1`,
    [tenantId, DEFAULT_LOCATION_CODE]
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`ร้านนี้ยังไม่มีสาขา (tenant ${tenantId}) — สร้างสาขาก่อนจึงจะบันทึกสต็อกได้`);
  return id;
}

export async function resolveDefaultLocationId(tenantId: string): Promise<string> {
  const client = await getClient();
  try {
    return await resolveDefaultLocationIdInTx(client, tenantId);
  } finally {
    client.release();
  }
}

export async function listLocations(tenantId: string): Promise<BmsLocation[]> {
  const res = await query(
    `SELECT * FROM bms_locations WHERE tenant_id = $1 ORDER BY is_head_office DESC, code`,
    [tenantId]
  );
  return res.rows.map(mapRow);
}

export async function getLocation(tenantId: string, locationId: string): Promise<BmsLocation | null> {
  const res = await query(
    `SELECT * FROM bms_locations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, locationId]
  );
  return res.rowCount ? mapRow(res.rows[0]) : null;
}

/** จำนวนสาขาที่ยังใช้งาน — ใช้เป็น guard ของ call site ที่ยังไม่รองรับหลายสาขา */
export async function countActiveLocations(tenantId: string): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT count(*) AS n FROM bms_locations WHERE tenant_id = $1 AND active`,
    [tenantId]
  );
  return Number(res.rows[0]?.n ?? 0);
}
