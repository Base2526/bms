/**
 * คีย์กันรายการซ้ำถูกใช้ไปแล้วกับ "ข้อมูลคนละชุด" — เป็นการปฏิเสธตามกติกา ไม่ใช่เซิร์ฟเวอร์พัง
 *
 * ทำไมต้องมีคลาสของตัวเอง: `inventoryIdempotency.ts` และ `boardGameCafe.ts` ปฏิเสธเคสนี้ด้วย
 * `throw new Error(...)` ซึ่งตกไปถึง `formatError` แล้วกลายเป็น `INTERNAL_SERVER_ERROR`
 * · เอกสารสัญญาของไคลเอนต์ (`react-native-graphql-client.md`) สั่งไว้ตรงตัวว่า
 * `INTERNAL_SERVER_ERROR` ให้ **ลองใหม่ด้วยคีย์เดิม** → คำขอที่คีย์ซ้ำแต่เนื้อในเปลี่ยนจะวน
 * ล้มแบบเดิมตลอดไป และเครื่องขายไปต่อไม่ได้จนกว่าจะปิดแอป
 *
 * รหัสที่ถูกคือ `CONFLICT` = "สถานะจริงตอนนี้ไม่ให้ทำคำสั่งนี้แล้ว → ดึงข้อมูลใหม่ ห้ามยิงซ้ำทื่อ ๆ"
 * ซึ่งตรงกับความจริง: คำขอแรกที่ถือคีย์นี้ **สำเร็จไปแล้ว** สิ่งที่ต้องทำคือดูของจริงก่อน
 *
 * โมดูลนี้ตั้งใจเป็น leaf — ไม่ import อะไรเลย เพื่อให้ทั้งฝั่ง service และตัวแปลง error
 * ของ GraphQL ใช้คลาสเดียวกันได้โดยไม่ลากฐานข้อมูลหรือ schema เข้ามา
 */
export class IdempotencyConflictError extends Error {
  constructor(
    message: string,
    /** ชื่อคำสั่งที่ชนกัน — ไว้ไล่ต้นตอใน log ไม่ได้ส่งให้ลูกค้า */
    readonly action: string,
  ) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export function isIdempotencyConflictError(
  error: unknown,
): error is IdempotencyConflictError {
  return error instanceof IdempotencyConflictError;
}

/** ข้อความเดียวกันทุกจุด — คนหน้าเครื่องต้องอ่านแล้วรู้ว่าต้องทำอะไรต่อ ไม่ใช่เห็นคำว่า key */
export const IDEMPOTENCY_CONFLICT_MESSAGE =
  "คำขอนี้ถูกส่งไปแล้วด้วยข้อมูลคนละชุด — ดึงข้อมูลล่าสุดแล้วทำรายการใหม่";
