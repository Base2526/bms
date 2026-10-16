import type { PoolClient } from "pg";

export type ThaiAddressCodes = {
  provinceCode?: string | null;
  districtCode?: string | null;
  subdistrictCode?: string | null;
  postcode?: string | null;
};

export type ResolvedThaiAddress = {
  provinceCode: string;
  districtCode: string;
  subdistrictCode: string;
  province: string;
  district: string;
  subdistrict: string;
  postcode: string;
};

const clean = (value: unknown) => String(value ?? "").trim() || null;

export async function resolveThaiAddressCodesInTx(
  client: PoolClient,
  input: ThaiAddressCodes,
): Promise<ResolvedThaiAddress | null> {
  const provinceCode = clean(input.provinceCode);
  const districtCode = clean(input.districtCode);
  const subdistrictCode = clean(input.subdistrictCode);
  const suppliedPostcode = clean(input.postcode);
  if (!provinceCode && !districtCode && !subdistrictCode) {
    if (suppliedPostcode && !/^\d{5}$/.test(suppliedPostcode)) throw new Error("รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก");
    return null;
  }
  if (!provinceCode || !districtCode || !subdistrictCode) {
    throw new Error("กรุณาเลือกจังหวัด อำเภอ และตำบลให้ครบ หรือเว้นว่างทั้งหมด");
  }
  const result = await client.query<{
    province_code: string; district_code: string; subdistrict_code: string;
    province: string; district: string; subdistrict: string; postcode: string;
  }>(
    `SELECT p.code province_code,d.code district_code,s.code subdistrict_code,
            p.name_th province,d.name_th district,s.name_th subdistrict,s.postcode
       FROM bms_master_th_subdistricts s
       JOIN bms_master_th_districts d ON d.code=s.district_code AND d.province_code=s.province_code
       JOIN bms_master_th_provinces p ON p.code=s.province_code
      WHERE p.code=$1 AND d.code=$2 AND s.code=$3 AND p.active AND d.active AND s.active`,
    [provinceCode, districtCode, subdistrictCode],
  );
  if (!result.rowCount) throw new Error("ไม่พบลำดับจังหวัด อำเภอ และตำบลในข้อมูลกลาง");
  const row = result.rows[0];
  if (suppliedPostcode && suppliedPostcode !== row.postcode) {
    throw new Error(`รหัสไปรษณีย์ไม่ตรงกับตำบลที่เลือก (ควรเป็น ${row.postcode})`);
  }
  return { provinceCode:row.province_code,districtCode:row.district_code,subdistrictCode:row.subdistrict_code,
    province:row.province,district:row.district,subdistrict:row.subdistrict,postcode:row.postcode };
}

/** Resolve customer-typed text without guessing. Multiple matching subdistricts must be clarified. */
export async function resolveThaiAddressTextInTx(
  client: PoolClient,
  address: string,
  hints: { province?: string | null; postcode?: string | null } = {},
): Promise<ResolvedThaiAddress> {
  const text = address.trim();
  const province = clean(hints.province);
  const postcode = clean(hints.postcode);
  if (postcode && !/^\d{5}$/.test(postcode)) throw new Error("รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก");
  const result = await client.query(
    `SELECT p.code province_code,d.code district_code,s.code subdistrict_code,
            p.name_th province,d.name_th district,s.name_th subdistrict,s.postcode
       FROM bms_master_th_subdistricts s
       JOIN bms_master_th_districts d ON d.code=s.district_code AND d.province_code=s.province_code
       JOIN bms_master_th_provinces p ON p.code=s.province_code
      WHERE p.active AND d.active AND s.active
        AND (POSITION(lower(s.name_th) IN lower($1))>0 OR POSITION(lower(s.name_en) IN lower($1))>0)
        AND ($2::text IS NULL OR p.name_th=$2 OR lower(p.name_en)=lower($2))
        AND ($3::text IS NULL OR s.postcode=$3)
      ORDER BY p.code,d.code,s.code LIMIT 3`,
    [text, province, postcode],
  );
  if (result.rows.length === 0) {
    throw new Error("กรุณาระบุจังหวัด อำเภอ ตำบล และรหัสไปรษณีย์ให้ตรงกับข้อมูลที่อยู่ไทย");
  }
  if (result.rows.length !== 1) {
    throw new Error("ชื่อตำบลนี้มีได้มากกว่าหนึ่งจังหวัด กรุณาระบุจังหวัดและรหัสไปรษณีย์เพิ่มเติม");
  }
  const row=result.rows[0];
  return { provinceCode:row.province_code,districtCode:row.district_code,subdistrictCode:row.subdistrict_code,
    province:row.province,district:row.district,subdistrict:row.subdistrict,postcode:row.postcode };
}

export function structuredAddressSnapshot(line: string, resolved: ResolvedThaiAddress): string {
  return [line.trim(), resolved.subdistrict, resolved.district, resolved.province, resolved.postcode]
    .filter(Boolean).join("\n");
}
