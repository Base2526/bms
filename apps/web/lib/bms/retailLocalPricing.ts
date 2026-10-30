/** Proposed pilot terms, pending owner approval. Never an entitlement/transaction gate. */
export const retailLocalPricing = {
  approved: false,
  freeDevices: 1,
  plus: 2990,
  pilotPlus: 1990,
  pilotShops: 20,
  supportMonths: 12,
  annualSupport: 990,
  pilotAnnualSupportAlternative: 690,
  extraDevice: 990,
  backupSetup: 500,
  onsiteFrom: 1500,
  vatPercent: 7,
  leadOffer: {
    th: "รับคู่มือติดตั้ง + ช่วยติดตั้งฟรีทาง LINE 14 วัน",
    en: "Get the installation guide + 14 days of free installation help on LINE",
  },
} as const;

export function retailLocalPrice(value: number, locale: "th" | "en" = "th") {
  return `${value.toLocaleString(locale === "th" ? "th-TH" : "en-GB")} ${locale === "th" ? "บาท" : "THB"}`;
}

export function retailLocalPricingSummary(locale: "th" | "en") {
  const p = retailLocalPricing;
  const price = (n: number) => retailLocalPrice(n, locale);
  return locale === "th"
    ? `ข้อเสนอรุ่นนำร่อง รอเจ้าของอนุมัติ: ฟรี ${p.freeDevices} เครื่อง ไม่มีวันหมดอายุ ไม่ต้องลงทะเบียนหรือใช้ License; Local Plus ซื้อขาด ${price(p.plus)} (นำร่อง ${p.pilotShops} ร้านแรก ${price(p.pilotPlus)}) พร้อมซัพพอร์ต ${p.supportMonths} เดือนและย้าย License เมื่อเครื่องเสีย หลังจากนั้นใช้รุ่นที่ติดตั้งไว้ต่อได้ หรือต่อซัพพอร์ต Local Plus ${price(p.annualSupport)}/ปี (ไม่บังคับ); เครื่องเพิ่ม ${price(p.extraDevice)}/เครื่อง; ตั้ง backup USB/NAS และทดสอบ restore ${price(p.backupSetup)} ครั้งเดียว; ติดตั้งถึงร้านเริ่ม ${price(p.onsiteFrom)}. ราคายังไม่รวม VAT ${p.vatPercent}%. ไม่ซื้อก็ใช้งานต่อได้ BMS ไม่ host backup และยังย้ายข้อมูล Local ไป Cloud ไม่ได้`
    : `Pilot proposal, pending owner approval: ${p.freeDevices} device free without expiry, no registration or license; Local Plus ${price(p.plus)} once (${price(p.pilotPlus)} for the first ${p.pilotShops} pilot shops), including ${p.supportMonths} months of support and license transfer after host failure; afterwards keep the installed version or optionally renew Local Plus support for ${price(p.annualSupport)}/year; extra device ${price(p.extraDevice)}; USB/NAS backup setup and restore test ${price(p.backupSetup)} once; onsite installation from ${price(p.onsiteFrom)}. Prices exclude ${p.vatPercent}% VAT. Shops keep operating without purchase. BMS does not host backups; Local-to-Cloud data migration is unavailable.`;
}
