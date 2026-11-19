import { auditPharmacyWriteInTx, withPharmacyWriteTx } from "./writeTx";

/** Administrator-only caller must verify its role before invoking this service. */
export async function setPharmacistLicense(input: {
  tenantId: string;
  actorId: string;
  userId: string;
  isLicensedPharmacist: boolean;
  licenseNo: string | null;
  confirmed: boolean;
}): Promise<void> {
  if (input.confirmed !== true) throw new Error("ต้องยืนยันการเปลี่ยนสถานะใบประกอบวิชาชีพ");
  if (typeof input.isLicensedPharmacist !== "boolean") throw new Error("สถานะเภสัชกรไม่ถูกต้อง");
  const licenseNo = input.licenseNo?.trim() || null;
  if (licenseNo && licenseNo.length > 100) throw new Error("เลขใบประกอบวิชาชีพยาวเกิน 100 ตัวอักษร");
  await withPharmacyWriteTx(input.tenantId, input.actorId, async (client) => {
    const updated = await client.query<{ changed: boolean }>(
      `SELECT public.bms_set_pharmacist_license($1, $2, $3, $4) AS changed`,
      [input.tenantId, input.userId, input.isLicensedPharmacist, licenseNo]
    );
    if (updated.rows[0]?.changed !== true) throw new Error("ไม่พบผู้ใช้นี้ในร้านนี้");
    await auditPharmacyWriteInTx(client, input.tenantId, input.actorId,
      "pharmacy.pharmacist_license_set", input.userId,
      { isLicensedPharmacist: input.isLicensedPharmacist });
  });
}
