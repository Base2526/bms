/** Display only: use the frozen group charge, never today's rates or a new time calculation. */
export function boardGameReceiptNotes(snapshot: unknown): string[] {
  if (!Array.isArray(snapshot)) return [];
  const number = (value: unknown): number | null => {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
  return snapshot.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const amount = number(raw.amount);
    if (amount === null) return [];
    const name = text(raw.displayName) || `ผู้เล่น / Player ${index + 1}`;
    const notes = [`ค่าเวลา / Play time: ${name} = ${amount.toFixed(2)}`];
    const rate = number(raw.hourlyRate);
    const minutes = number(raw.billableMinutes);
    const actual = number(raw.actualMinutes);
    const rateDetails = [text(raw.rateName) || text(raw.rateCode)];
    if (rate !== null) rateDetails.push(`${rate.toFixed(2)} บาท/ชม. (THB/h)`);
    if (minutes !== null) rateDetails.push(`เวลาก่อนสิทธิ์ / Billed before benefits ${minutes} นาที/min`);
    if (rateDetails.some(Boolean)) notes.push(rateDetails.filter(Boolean).join(" · "));
    if (actual !== null) notes.push(`เล่นจริง / Actual ${actual} นาที/min`);
    const paidMinutes = number(raw.offerPaidMinutes);
    const freeMinutes = number(raw.offerFreeMinutes);
    if (paidMinutes !== null && freeMinutes !== null) {
      notes.push(`ตามโปร / Time offer: จ่าย / Paid ${paidMinutes} นาที/min · ฟรี / Free ${freeMinutes} นาที/min`);
    }
    const covered = number(raw.coveredAmount);
    if (covered !== null && covered > 0) notes.push(`สิทธิ์แพ็กเกจ / Pass coverage ${covered.toFixed(2)}`);
    const discount = number(raw.offerDiscountAmount);
    if (discount !== null && discount > 0) {
      notes.push(`โปรโมชัน / Offer: ${text(raw.offerName) || text(raw.offerCode)} -${discount.toFixed(2)}`);
    }
    return notes;
  });
}
