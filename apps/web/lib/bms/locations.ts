// =============================================================
// BMS Locations — สาขา/จุดเก็บสต็อก (migration 7.84)
// -------------------------------------------------------------
// สต็อก ออร์เดอร์ และ movement ทุกแถวผูกกับสาขาแล้ว ตั้งแต่ 7.84
// ร้านที่มีสาขาเดียวไม่ได้รับผลกระทบอะไร — call site ที่ยังไม่รู้จักสาขา
// เรียก resolveDefaultLocationId* เพื่อได้สาขานั้น พฤติกรรมจึงเหมือนเดิมทุกประการ
//
// การโอนย้ายสต็อกข้ามสาขา + นับสต็อกแยกสาขา ต่อเข้ากับของจริงแล้วที่ 7.98
// (ดู checklist ก่อนเปิดสาขาที่สองของร้านไหนก็ตามที่
// docs/business/inventory.md § Go-live checklist multi-branch)
//
// การ "สร้างสาขาใหม่" เอง (upsertLocation) มาเปิดที่ 9.1 — ก่อนหน้านี้ตาราง
// พร้อมมาตั้งแต่ 7.84 แต่ไม่มีทางสร้างจากแอปเลยสักจุด มีแต่ query อ่านอย่างเดียว
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

export type UpsertLocationInput = {
  id?: string | null;
  code: string;
  name: string;
  branchCode: string;
  address?: string | null;
  phone?: string | null;
  active?: boolean | null;
};

const HEAD_OFFICE_BRANCH_CODE = "00000";

/**
 * สร้าง/แก้สาขา — รหัส (code) แก้ไม่ได้หลังสร้าง เหมือน upsertPosDevice
 * (ฝั่งฟอร์ม disable ช่องนี้ตอนแก้ไข) เพราะ ON CONFLICT ใช้ (tenant_id, code)
 * เป็น key จับคู่แถวเดิม เปลี่ยน code กลางทางจะกลายเป็นสร้างแถวใหม่แทนแก้ของเดิม
 *
 * ⚠️ is_head_office เป็น FALSE เสมอสำหรับแถวที่สร้างผ่านทางนี้ — คอลัมน์นี้
 * default เป็น TRUE ในตาราง (ออกแบบไว้ตอนร้านมีสาขาเดียว) ถ้าไม่บังคับเป็น FALSE
 * ตรงนี้ สาขาที่สองจะกลายเป็นสำนักงานใหญ่คู่ขนานไปด้วยเงียบ ๆ — แถวสำนักงานใหญ่จริง
 * มีอยู่แล้วจาก seed ตอน 7.84 หน้านี้ไม่มีทางเปลี่ยนธงนี้ได้ (ต้องแก้ตรง DB เท่านั้น)
 */
export async function upsertLocation(tenantId: string, input: UpsertLocationInput): Promise<BmsLocation> {
  const code = input.code.trim();
  const name = input.name.trim();
  const branchCode = input.branchCode.trim();
  if (!code) throw new Error("ต้องระบุรหัสสาขา");
  if (!name) throw new Error("ต้องระบุชื่อสาขา");
  if (!branchCode) throw new Error("ต้องระบุเลขที่สาขา (branch code)");
  if (branchCode === HEAD_OFFICE_BRANCH_CODE && !input.id) {
    throw new Error(`เลขที่สาขา ${HEAD_OFFICE_BRANCH_CODE} สงวนไว้สำหรับสำนักงานใหญ่เท่านั้น — ตั้งเลขอื่นให้สาขาใหม่`);
  }

  try {
    const res = await query<any>(
      `INSERT INTO bms_locations (id, tenant_id, code, name, branch_code, address, phone, active, is_head_office)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE), FALSE)
       ON CONFLICT (tenant_id, code)
       DO UPDATE SET name = EXCLUDED.name,
                     branch_code = EXCLUDED.branch_code,
                     address = EXCLUDED.address,
                     phone = EXCLUDED.phone,
                     active = EXCLUDED.active,
                     updated_at = now()
       RETURNING *`,
      [input.id ?? null, tenantId, code, name, branchCode, input.address ?? null, input.phone ?? null, input.active ?? null]
    );
    return mapRow(res.rows[0]);
  } catch (e: any) {
    if (e?.code === "23505") {
      if (String(e.constraint ?? "").includes("branch_code")) {
        throw new Error(`เลขที่สาขา ${branchCode} ถูกใช้ไปแล้วในร้านนี้`);
      }
      throw new Error(`รหัสสาขา "${code}" ถูกใช้ไปแล้ว`);
    }
    throw e;
  }
}
