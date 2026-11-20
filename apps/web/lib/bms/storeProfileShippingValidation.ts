/** Validate rates before they can become part of an order total. */
export function validateStoreProfileShippingFields(input: {
  shippingFlatRate?: number | null;
  shippingFreeThreshold?: number | null;
  shippingEstDaysMin?: number | null;
  shippingEstDaysMax?: number | null;
}, current: {
  shippingEstDaysMin: number | null;
  shippingEstDaysMax: number | null;
}): void {
  for (const [key, label] of [
    ["shippingFlatRate", "ค่าส่งเหมา"],
    ["shippingFreeThreshold", "ยอดขั้นต่ำส่งฟรี"],
  ] as const) {
    const value = input[key];
    if (value == null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0
      || value > 9_999_999_999.99
      || Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) {
      throw new Error(`${label} ต้องเป็นจำนวนตั้งแต่ 0 ขึ้นไป และมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
  }
  for (const [key, label] of [
    ["shippingEstDaysMin", "จำนวนวันส่งขั้นต่ำ"],
    ["shippingEstDaysMax", "จำนวนวันส่งสูงสุด"],
  ] as const) {
    const value = input[key];
    if (value != null && (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)) {
      throw new Error(`${label} ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป`);
    }
  }
  if (input.shippingEstDaysMin === undefined && input.shippingEstDaysMax === undefined) return;
  const min = input.shippingEstDaysMin === undefined ? current.shippingEstDaysMin : input.shippingEstDaysMin;
  const max = input.shippingEstDaysMax === undefined ? current.shippingEstDaysMax : input.shippingEstDaysMax;
  if (min != null && max != null && min > max) {
    throw new Error("จำนวนวันส่งขั้นต่ำต้องไม่เกินจำนวนวันส่งสูงสุด");
  }
}
