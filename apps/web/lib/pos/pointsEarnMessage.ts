export function pointsEarnMessage(block: string | null | undefined): string {
  switch (block) {
    case "PROGRAM_DISABLED": return "ร้านยังไม่เปิดใช้แต้มสะสม";
    case "BELOW_MIN_SPEND": return "ยอดบิลยังไม่ถึงขั้นต่ำสำหรับสะสมแต้ม";
    case "RATE_TOO_LOW": return "ยอดบิลนี้คำนวณตามอัตราของร้านแล้วได้ไม่ถึง 1 แต้ม";
    case "NO_VISIT_POINTS": return "ร้านตั้งแต้มต่อการซื้อไว้ 0 แต้ม";
    default: return "บิลนี้ไม่ได้รับแต้มสะสมตามเงื่อนไขของร้าน";
  }
}
