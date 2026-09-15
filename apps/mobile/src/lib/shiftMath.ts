// คณิตศาสตร์ของลิ้นชัก — โมดูลนี้ตั้งใจไม่ import อะไรเลย (เทสได้โดยไม่ต้องมี React/Native)
//
// ⚠️ กฎข้อเดียวของไฟล์นี้: "เงินที่ควรมีในลิ้นชัก" ต้องมีสูตรเดียวคือ `drawerExpectedFrom()`
// ห้ามให้หน้าจอหรือ mock ถือตัวเลขสำเร็จรูปของตัวเอง — ก่อนหน้านี้ `mocks/shift.ts` ประกาศ
// `expectedCash: 6560` ไว้ตายตัวขณะที่รายการเงินเข้า/ออกบนจอเดียวกันบวกได้ 6860
// จอที่ขัดกันเองคือจอที่คนเลิกเชื่อทั้งจอ (บทเรียนเดียวกับฝั่งเว็บ)

export type CashMovementType = 'IN' | 'OUT';

export interface DrawerMovementInput {
  type: CashMovementType;
  amount: number;
}

/** รูปทรงของบิลเท่าที่ลิ้นชักสนใจ — ไม่ผูกกับ MockSaleSnapshot เพื่อให้โมดูลนี้ยังไม่ import อะไร */
export interface DrawerSaleInput {
  createdAt: string;
  payments: Array<{ method: string; amount: number }>;
  returns: Array<{
    createdAt: string;
    allocations: Array<{ method: string; amount: number; status: string }>;
  }>;
}

/**
 * เกิดหลังกะนี้เปิดหรือยัง
 *
 * ⚠️ จำเป็นเพราะ ledger ของการขายไม่ถูกล้างตอนเปิดกะใหม่ ถ้าไม่ตัดด้วยเวลา เงินของกะที่ปิดไปแล้ว
 * จะถูกนับเข้าลิ้นชักของกะใหม่อีกรอบ · `sinceMs = 0` แปลว่านับทั้งหมด (กะแรกของรอบที่เปิดแอป)
 * เวลาที่อ่านไม่ออกให้ถือว่าอยู่ในกะนี้ ดีกว่าเงินหายไปจากลิ้นชักเงียบ ๆ
 */
function isInShift(createdAt: string, sinceMs: number): boolean {
  if (sinceMs <= 0) return true;
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return true;
  return at >= sinceMs;
}

export interface DrawerCashComponents {
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  movementIn: number;
  movementOut: number;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function summarizeMovements(movements: DrawerMovementInput[]): {
  movementIn: number;
  movementOut: number;
} {
  let movementIn = 0;
  let movementOut = 0;
  for (const movement of movements) {
    const amount = Math.max(0, movement.amount);
    if (movement.type === 'IN') movementIn += amount;
    else movementOut += amount;
  }
  return {
    movementIn: roundMoney(movementIn),
    movementOut: roundMoney(movementOut),
  };
}

/** เงินสดที่เข้าลิ้นชักจากการขาย — นับเฉพาะช่องทางเงินสด (QR/บัตรไม่เคยอยู่ในลิ้นชัก) */
export function cashSalesOf(sales: DrawerSaleInput[], sinceMs = 0): number {
  let total = 0;
  for (const sale of sales) {
    if (!isInShift(sale.createdAt, sinceMs)) continue;
    for (const payment of sale.payments) {
      if (payment.method === 'cash') total += Math.max(0, payment.amount);
    }
  }
  return roundMoney(total);
}

/**
 * เงินสดที่จ่ายคืนออกไปจริง
 *
 * ⚠️ นับเฉพาะ allocation ที่ `COMPLETED` — การคืนทาง QR/บัตรเป็น "รอยืนยันการคืนเงิน"
 * เงินยังไม่ออกจากลิ้นชัก การนับรวมจะทำให้นับเงินปิดกะแล้วเกินทุกครั้งที่มีการคืนแบบไม่ใช่เงินสด
 *
 * บิลที่ถูก void ไม่ต้องกรองทิ้งจากขาเข้า เพราะ void เขียน allocation ขาออกไว้แล้ว
 * ทั้งสองขาจึงหักล้างกันเอง (กรองทิ้งด้วยจะกลายเป็นหักสองรอบ)
 */
export function cashRefundsOf(sales: DrawerSaleInput[], sinceMs = 0): number {
  let total = 0;
  for (const sale of sales) {
    for (const record of sale.returns) {
      // ⚠️ ตัดด้วยเวลาของ "ใบคืน" ไม่ใช่ของบิลต้นทาง — เงินออกจากลิ้นชักของกะที่จ่ายคืน
      // ไม่ใช่กะที่ขาย (กฎเดียวกับ completed_shift_id ของฝั่งเว็บ)
      if (!isInShift(record.createdAt, sinceMs)) continue;
      for (const allocation of record.allocations) {
        if (allocation.method === 'cash' && allocation.status === 'COMPLETED') {
          total += Math.max(0, allocation.amount);
        }
      }
    }
  }
  return roundMoney(total);
}

/** สูตรเดียวของ "เงินที่ควรมีในลิ้นชัก" — ผู้เรียกทุกตัวต้องผ่านทางนี้ ห้ามคิดเอง */
export function drawerExpectedFrom(components: DrawerCashComponents): number {
  return roundMoney(
    components.openingFloat +
      components.cashSales -
      components.cashRefunds +
      components.movementIn -
      components.movementOut,
  );
}

/** ผลต่างของการนับปิดกะ — บวก = เกิน, ลบ = ขาด */
export function cashVariance(
  countedCash: number,
  expectedCash: number,
): number {
  return roundMoney(countedCash - expectedCash);
}

export interface ParsedAmount {
  ok: boolean;
  amount: number;
  error?: string;
}

/** แปลงตัวเลขที่คนพิมพ์เป็นยอดเงิน — ปฏิเสธค่าที่อ่านไม่ออกแทนที่จะปัดเป็น 0 เงียบ ๆ */
export function parseAmountInput(text: string): ParsedAmount {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, amount: 0, error: 'กรอกจำนวนเงิน' };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, amount: 0, error: 'จำนวนเงินต้องเป็นตัวเลข' };
  }
  if (value <= 0) {
    return { ok: false, amount: 0, error: 'จำนวนเงินต้องมากกว่า 0' };
  }
  return { ok: true, amount: roundMoney(value) };
}

/**
 * ตรวจก่อนนำเงินออกจากลิ้นชัก — ห้ามเบิกเกินเงินที่มีอยู่จริง
 * (ฝั่งเว็บใช้ยอดที่ควรมีเป็นเพดานของการเบิกด้วยเหตุผลเดียวกัน)
 */
export function validateCashOut(
  amount: number,
  expectedCash: number,
): string | null {
  if (amount > expectedCash) {
    return `เบิกได้ไม่เกินเงินที่มีในลิ้นชัก ฿${expectedCash.toFixed(2)}`;
  }
  return null;
}
