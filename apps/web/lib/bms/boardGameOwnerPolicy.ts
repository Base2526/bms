/** Non-clinical, read-only capability boundary. Context can restrict an answer, never grant access. */
export const BOARD_GAME_OWNER_LIMITS = "Board-game tools do NOT calculate shop net profit after overhead, game-box ROI/payback/depreciation, causal promotion lift, price-change effects, future attendance/staffing or recommended game purchase quantities, nor session-based customer churn. Generic SKU forecasting/PROFIT/retention tools are not substitutes. Say unsupported and identify missing evidence; do not invent numbers, infer causes from correlation, or silently combine more than 92 days as an annual board-game report. UNPLAYED means no recorded branch loan, never proof nobody physically played. All list truncation/nextOffset and quality issues must be disclosed. Read both explicit periods with identical scope before descriptive comparison; no unsupported explanation of why.";

export function boardGameUnsupportedOwnerReply(message: string, currentPath: string | null | undefined, locale: "th" | "en" = "th", previousUserMessages: string[] = []): string | null {
  const board = /บอร์ดเกม|บอร์ดเกมส์|board[ -]?games?|เกมกล่อง|กล่องเกม|คลังเกม/i;
  const context = board.test(message) || /^\/admin\/board-game(?:\/|$|\?)/.test(currentPath ?? "") || previousUserMessages.slice(-3).some(m => board.test(m));
  if (!context) return null;
  const rules = [
    { pattern: /กำไรสุทธิ|net\s+profit|หลังหัก.*(?:ค่าเช่า|เงินเดือน|ค่าไฟ|ค่าเสื่อม)/i,
      th: "กำไรสุทธิของร้านหลังค่าเช่า เงินเดือน ค่าสาธารณูปโภคและค่าเสื่อม", en: "shop net profit after rent, payroll, utilities and depreciation" },
    { pattern: /คืนทุน|\bROI\b|payback|break[ -]?even|ค่าเสื่อม.*เกม|depreciation/i,
      th: "จุดคุ้มทุน ผลตอบแทน หรือค่าเสื่อมรายกล่องเกม", en: "game-box return on investment, payback or depreciation" },
    { pattern: /(?:ควร|แนะนำ).*(?:ซื้อ|เพิ่ม).*(?:เกม|กล่อง)|ต้องซื้อ.*(?:เกม|กล่อง).*(?:กี่|เท่าไร|เท่าไหร่)|(?:เกม|กล่อง).*(?:ควรซื้อ|ซื้อเพิ่ม)|which games?.*(?:buy|purchase)|(?:buy|purchase).*how many|how many.*(?:copies|boxes).*(?:buy|purchase)/i,
      th: "เกมที่ควรซื้อเพิ่มและจำนวนกล่องที่เหมาะสมจากความต้องการในอนาคต", en: "which games or how many copies to buy based on future demand" },
    { pattern: /(?:จัด|ต้องใช้|ควรมี|ใช้).*(?:พนักงาน|คน).*กี่|พนักงานกี่|staffing|how many.*staff|(?:forecast|predict).*(?:attendance|visitors)|(?:พยากรณ์|คาดการณ์).*(?:คน|ผู้เล่น|ลูกค้า)|(?:พรุ่งนี้|สัปดาห์หน้า|เสาร์หน้า|อาทิตย์หน้า).*(?:ลูกค้า|ผู้เล่น|คน).*(?:กี่|เท่าไร|เท่าไหร่)|how many.*(?:visitors|players|customers).*(?:tomorrow|next week|next month)/i,
      th: "จำนวนผู้มาเล่นในอนาคตหรือกำลังพนักงานที่ต้องจัด", en: "future attendance or required staffing" },
    { pattern: /(?:ขึ้นราคา|ลดราคา|เปลี่ยนราคา).*(?:รายได้|ยอดขาย|กำไร|ลูกค้า)|(?:price|pricing).*(?:elasticity|effect|impact)|(?:raise|increase|lower).*price/i,
      th: "ผลของการเปลี่ยนราคาต่อรายได้หรือจำนวนลูกค้า", en: "the effect of price changes on revenue or attendance" },
    { pattern: /(?:โปร|โปรโมชั่น|โปรโมชัน).*(?:ทำให้|เพิ่มจริง|คุ้มไหม|คุ้มหรือ|ได้ผล)|(?:promotion|offer).*(?:caus|incremental|lift|worth|effective)/i,
      th: "กำไรหรือยอดลูกค้าที่เพิ่มขึ้นเพราะโปรโมชันโดยเฉพาะ", en: "incremental profit or customers caused by a promotion" },
    { pattern: /(?:ลูกค้า|สมาชิก).*(?:หายไป|ไม่กลับมา|เลิกมา)|(?:churn|lapsed|returning).*players?|players?.*(?:churn|lapsed|stopped)/i,
      th: "ลูกค้าที่เลิกกลับมาเล่นจากประวัติ session โดยเฉพาะ", en: "session-based player churn" },
    { pattern: /(?:รายงาน|สรุป|ยอดขาย|รายได้|การใช้โต๊ะ).*(?:ทั้งปี|รายปี)|(?:annual|yearly|full.year).*(?:report|revenue|utilization)|(?:report|revenue|utilization).*full.year/i,
      th: "รายงานบอร์ดเกมทั้งปี (รองรับช่วงละ 1–92 วันเท่านั้น)", en: "annual board-game reports (supported ranges are 1–92 days only)" },
  ];
  const match = rules.find(r => r.pattern.test(message));
  if (!match) return null;
  return locale === "en"
    ? `The board-game system does not yet support ${match.en}. I cannot provide a verified figure or recommendation for that, and will not substitute product forecasts or gross profit. Available reads cover historical revenue/utilization, recorded game loans, queues, offers, passes and permission-gated product gross profit. These facts do not prove future demand or causation.`
    : `ระบบบอร์ดเกมยังไม่รองรับการคำนวณ${match.th} จึงยังให้ตัวเลขหรือข้อสรุปที่ยืนยันไม่ได้ และจะไม่ใช้ยอดขายสินค้า/กำไรขั้นต้นแทน คำถามที่อ่านข้อมูลจริงได้คือรายได้และการใช้โต๊ะย้อนหลัง ประวัติยืมเกม คิว โปร แพ็กเกจ และกำไรขั้นต้นสินค้าตามสิทธิ์ แต่ข้อมูลเหล่านี้ไม่ยืนยันความต้องการในอนาคตหรือสาเหตุของผลลัพธ์ครับ`;
}
