import { resolveDefaultLocationId } from "./locations";
import { issuePosDeviceToken, upsertPosDevice } from "./pos";

export async function seedFakePosDevices(
  tenantId: string,
  count: number,
  generatedBy?: string | number
) {
  const locationId = await resolveDefaultLocationId(tenantId);
  const devices = [];
  for (let i = 0; i < count; i++) {
    const number = i + 1;
    const device = await upsertPosDevice(tenantId, {
      locationId,
      code: `POS-${String(number).padStart(2, "0")}`,
      name: number === 1 ? "เคาน์เตอร์หลัก" : `เคาน์เตอร์ ${number}`,
      registeredPosNo: String(number).padStart(5, "0"),
      receiptPrefix: `R${String(number).padStart(2, "0")}`,
      scannerMode: "PREFIX",
      scannerPrefixKey: `F${Math.min(8 + number, 24)}`,
      scannerSuffixKey: "Enter",
      scannerMaxGapMs: 80,
      active: true,
    }, {
      editorId: generatedBy,
      auditActor: generatedBy == null ? null : String(generatedBy),
    });
    await issuePosDeviceToken(tenantId, device.id);
    devices.push(device);
  }
  return {
    created: devices,
    summary: { posDevices: devices.length, pairedPosDevices: devices.length },
  };
}
