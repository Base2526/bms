/**
 * แพ็กเกจสมาชิกจ่ายค่าเวลาแทนลูกค้าเท่าไร (`9.92`)
 *
 * แยกเป็นไฟล์ของตัวเองและ **ไม่ import อะไรเลย** ด้วยเหตุผลเดียวกับ `loyaltyMath.ts`:
 * นี่คือเลขที่ลูกค้าจ่ายจริง เทสมันต้องรันได้โดยไม่ต้องมีฐานข้อมูล และ `gate.yml` รันเฉพาะ
 * ชุด pure — สูตรเงินที่ทดสอบได้เฉพาะตอนมี Postgres คือสูตรที่ CI ไม่เคยตรวจ
 *
 * กติกาที่ต้องอ่านก่อนแก้:
 *   * **สองก้อนต้องบวกกลับเป็นยอดเต็มเสมอ** (`amount + coveredAmount = grossAmount`) · ยอดที่ลูกค้า
 *     จ่ายจึงเป็น "ยอดเต็มลบส่วนที่แพ็กเกจจ่าย" ไม่ใช่ "คิดใหม่จากนาทีที่เหลือ" — สองทางนี้ต่างกัน
 *     หนึ่งสตางค์เมื่อการปัดของสองก้อนไม่ลงตัวพร้อมกัน (เช่น 10 นาที ฿70/ชม. ครอบ 5 นาที)
 *     และบิลที่บวกแล้วไม่เท่ายอดคือบิลที่แคชเชียร์อธิบายไม่ได้
 *   * **บรรทัดที่ไม่มีค่าใช้จ่ายห้ามกินโควตา** — ผู้ชมที่ไม่คิดเงินหรืออัตรา 0 จะเผานาที
 *     ของสมาชิกทิ้งโดยไม่มีใครได้อะไร
 *   * **โควตาเดินข้ามบรรทัด** — คนเดิมกลับเข้าโต๊ะรอบสองเป็นผู้เล่นอีกแถวได้ สองแถวนั้น
 *     ต้องแบ่งโควตาใบเดียวกัน ไม่ใช่ได้คนละเต็มจำนวน
 */

export type BoardGamePassKind = "UNLIMITED" | "MINUTES";

export type BoardGamePassBudget = {
  id: string;
  kind: BoardGamePassKind;
  /** นาทีคงเหลือของแพ็กเกจแบบโควตา · NULL = ไม่อั้น (ไม่ใช่ "ใช้หมดแล้ว") */
  remainingMinutes: number | null;
};

export type BoardGamePassCoverageLine = {
  customerId: string | null;
  billableMinutes: number;
  hourlyRate: number;
};

export type BoardGamePassCoverageResult = {
  /** ค่าเวลาก่อนแพ็กเกจช่วยจ่าย */
  grossAmount: number;
  passId: string | null;
  coveredMinutes: number;
  coveredAmount: number;
  /** ยอดที่ลูกค้าต้องจ่ายจริงหลังแพ็กเกจ */
  amount: number;
};

const money = (value: number) => Math.round(value * 100) / 100;

const chargeOf = (minutes: number, hourlyRate: number) =>
  money((Math.max(0, minutes) / 60) * Math.max(0, hourlyRate));

/**
 * คิดความคุ้มครองทีละบรรทัดตามลำดับที่ส่งมา โดยหักโควตาของแพ็กเกจแต่ละใบไปเรื่อย ๆ
 *
 * ลำดับมีความหมาย: โควตาที่เหลือไม่พอจะตกกับบรรทัดท้าย ๆ · ผู้เรียกส่งบรรทัดตามลำดับ
 * ที่ผู้เล่นเข้าโต๊ะ ซึ่งเป็นลำดับที่อธิบายให้ลูกค้าฟังได้
 */
export function applyBoardGamePassCoverage(
  lines: readonly BoardGamePassCoverageLine[],
  passesByCustomerId: ReadonlyMap<string, BoardGamePassBudget>
): BoardGamePassCoverageResult[] {
  const budget = new Map<string, number>();
  return lines.map((line) => {
    const grossAmount = chargeOf(line.billableMinutes, line.hourlyRate);
    const pass = line.customerId ? passesByCustomerId.get(line.customerId) : undefined;
    const none: BoardGamePassCoverageResult = {
      grossAmount,
      passId: null,
      coveredMinutes: 0,
      coveredAmount: 0,
      amount: grossAmount,
    };
    // ไม่มีแพ็กเกจ หรือบรรทัดนี้ไม่มีค่าใช้จ่ายให้ช่วยจ่าย — อย่าแตะโควตา
    if (!pass || grossAmount <= 0 || line.billableMinutes <= 0) return none;

    if (pass.kind === "UNLIMITED") {
      return {
        grossAmount,
        passId: pass.id,
        coveredMinutes: line.billableMinutes,
        coveredAmount: grossAmount,
        amount: 0,
      };
    }

    if (!budget.has(pass.id)) budget.set(pass.id, Math.max(0, pass.remainingMinutes ?? 0));
    const left = budget.get(pass.id) ?? 0;
    if (left <= 0) return none;

    const coveredMinutes = Math.min(line.billableMinutes, left);
    const coveredAmount = Math.min(grossAmount, chargeOf(coveredMinutes, line.hourlyRate));
    budget.set(pass.id, left - coveredMinutes);
    return {
      grossAmount,
      passId: pass.id,
      coveredMinutes,
      coveredAmount,
      amount: money(Math.max(0, grossAmount - coveredAmount)),
    };
  });
}

/** วันหมดอายุของสัญญาที่ซื้อวันนี้ — คิดจากจำนวนวันของแพ็กเกจ ไม่ใช่ "สิ้นเดือน" */
export function boardGamePassExpiry(startsAt: Date, durationDays: number): Date {
  const days = Math.max(1, Math.trunc(durationDays));
  return new Date(startsAt.getTime() + days * 86_400_000);
}
