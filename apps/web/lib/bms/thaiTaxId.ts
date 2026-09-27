/** ตรวจเลขประจำตัวผู้เสียภาษีไทย 13 หลักด้วย checksum มาตรฐาน */
export function isValidThaiTaxId(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(value[index]) * (13 - index);
  }
  return (11 - (sum % 11)) % 10 === Number(value[12]);
}
