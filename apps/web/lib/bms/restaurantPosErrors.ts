/**
 * ความล้มเหลวของบิลโต๊ะที่ **ตั้งใจปฏิเสธ** ไม่ใช่เซิร์ฟเวอร์พัง
 *
 * ทำไมต้องมีคลาสของตัวเอง: `restaurantPos.ts` ปฏิเสธด้วย `throw new Error("...")` ทุกจุด
 * แล้ว route ปล่อยให้ตกไปที่ `withRouteErrorLog` → ตอบ 500 ซึ่งบน production
 * `errorResponse()` **ลบข้อความจริงทิ้ง** เหลือ `"เซิร์ฟเวอร์ผิดพลาด"` (routeError.ts)
 * พนักงานหน้าร้านจึงเห็น "เซิร์ฟเวอร์ผิดพลาด (เซิร์ฟเวอร์ผิดพลาด) — กดชำระเงินอีกครั้ง"
 * ทั้งที่ server รู้เหตุผลอยู่แล้วและกดซ้ำกี่ครั้งก็ไม่ผ่าน
 *
 * เส้นทางค้าปลีกตอบเป็น "สถานะ" ให้ `describePosFailure()` แปลมาตลอด — คลาสนี้คืน
 * การันตีเดียวกันให้บิลโต๊ะ โดยไม่ต้องแปลง 35 จุดให้เป็น status code ทีละตัว
 */
export class RestaurantCheckError extends Error {
  constructor(message: string, readonly code: string = "CHECK_REJECTED") {
    super(message);
    this.name = "RestaurantCheckError";
  }
}

/**
 * ใบจองสต็อกของโต๊ะหายไป (ถูกยกเลิกโดยอย่างอื่นนอกเส้นทางนี้)
 *
 * แยกรหัสออกมาเพราะเป็นเคสเดียวที่ **หน้าจอต้องพาไปทำอย่างอื่นต่อ** ไม่ใช่แค่บอกว่าล้ม —
 * กดส่งครัวอีกครั้งจะจองใหม่ให้ทั้งบิลแล้วคิดเงินได้ตามปกติ
 */
export const RESERVATION_LOST = "RESERVATION_LOST";

export function isRestaurantCheckError(error: unknown): error is RestaurantCheckError {
  return error instanceof RestaurantCheckError;
}
