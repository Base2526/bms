/**
 * แปลสถานะที่ server ปฏิเสธให้เป็นภาษาที่คนหน้าเคาน์เตอร์ทำอะไรต่อได้
 *
 * อยู่ที่นี่เพราะ **สอง** หน้าขายใช้คำตอบชุดเดียวกัน: หน้าค้าปลีก (`/pos`) และหน้า
 * ร้านอาหาร (`/pos/restaurant` ตอนส่งครัวและตอนคิดเงิน ซึ่งเดินผ่าน createOrderInTx
 * และ recordPosSale ตัวเดียวกัน) · ก่อนหน้านี้อยู่ในไฟล์หน้าค้าปลีกไฟล์เดียว หน้าร้าน
 * อาหารจึงโชว์ได้แค่ "HTTP 409" ตอนสต็อกไม่พอ ซึ่งบอกพนักงานไม่ได้ว่าต้องทำอะไรต่อ
 * · เขียนสองชุดก็ได้ แต่วันที่ข้อความหนึ่งถูกแก้ อีกหน้าจะเริ่มโกหกเงียบ ๆ
 */
function baht(n: number) {
  return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function describePosFailure(data: any): string {
  switch (data?.status) {
    case "SHIFT_NOT_OPEN":
      return "กะปิดไปแล้ว — เปิดกะใหม่ก่อน";
    case "PAYMENT_MISMATCH":
      return data.subtotal != null && data.discount != null
        ? `ยอดไม่ตรง: ระบบคิดสินค้า ฿${baht(data.subtotal)} − ส่วนลดรวม ฿${baht(data.discount)} = ต้องรับ ฿${baht(data.expected)} แต่จอส่ง ฿${baht(data.received)}${Number(data.pointsUsed) > 0 ? ` (ใช้ ${Number(data.pointsUsed).toLocaleString()} แต้มแล้ว)` : ""} — ระบบล้างยอดรับเงินให้แล้ว กรุณาตรวจราคาและรับเงินใหม่`
        : `ยอดไม่ตรง: ระบบคิด ฿${baht(data.expected)} แต่จอส่ง ฿${baht(data.received)} — ระบบล้างยอดรับเงินให้แล้ว กรุณารีเฟรชราคาและรับเงินใหม่`;
    case "LOT_EXPIRED_OR_SHORT":
      return `${data.sku}: ของที่ยังไม่หมดอายุเหลือ ${data.sellable} ต้องการ ${data.requested} — หยิบกล่องใหม่`;
    case "INSUFFICIENT":
      return `${data.sku}${data.size && data.size !== "-" ? ` (${data.size})` : ""} เหลือ ${data.available} ต้องการ ${data.requested}`;
    case "NOT_FOUND":
      return `ไม่พบสินค้า ${data.sku ?? ""}`;
    // สามตัวนี้มาจาก createOrderInTx โดยตรง เส้นทางเดียวที่ใช้คือการส่งครัวของบิลโต๊ะ
    // (บิลค้าปลีกกรองรายการที่ขายไม่ได้ทิ้งไปก่อนถึง server แล้ว)
    case "PACK_NOT_FOUND":
      return `${data.sku}: ไม่พบหน่วยขาย ${data.packCode || "ที่เลือก"} — ลบรายการแล้วค้นเมนูใหม่`;
    case "BUNDLE_INCOMPLETE":
      return `${data.sku}: เป็นสินค้าชุดที่ยังไม่ได้ใส่ส่วนประกอบ — ตั้งส่วนประกอบที่หน้าแอดมินก่อนถึงจะขายได้`;
    case "INVALID_ITEM":
      return `รายการที่ ${Number(data.index) + 1} ใช้ไม่ได้: ${data.reason}`;
    case "EMPTY":
      return "ยังไม่มีรายการที่ส่งครัวได้ — เพิ่มเมนูก่อน";
    case "INVALID_PACK":
      return `${data.sku}: ไม่พบหน่วยขาย ${data.packCode || "ที่เลือก"} — โหลดสินค้าใหม่แล้วลองอีกครั้ง`;
    case "PHARMACY_POLICY_UNKNOWN":
      return `${data.sku}: ยังไม่มีนโยบายการขายที่อนุมัติไว้ — ให้เภสัชกรกด PIN อนุมัติที่เครื่องเพื่อจ่ายครั้งนี้`;
    case "PHARMACY_PRESCRIPTION_REQUIRED":
      return `${data.sku}: ต้องมีใบสั่งแพทย์ — เภสัชกรตรวจใบสั่งแล้วกด PIN อนุมัติที่เครื่อง หรือส่งเคสเข้าคิวให้เภสัชกรอนุมัติก็ได้`;
    case "PHARMACY_ONLINE_SALE_PROHIBITED":
      return `${data.sku}: ห้ามขายออนไลน์ — ขายหน้าร้านได้เมื่อเภสัชกรกด PIN อนุมัติ`;
    case "PHARMACY_REVIEW_REQUIRED":
    case "PHARMACY_SAFETY_CHECK_REQUIRED":
      return `${data.sku}: ต้องให้เภสัชกรอนุมัติก่อน — ให้เภสัชกรกด PIN ที่เครื่อง หรือส่งเคสเข้าคิวถ้าต้องซักประวัติยาว`;
    // เพดานจำนวนต่อครั้งเป็นค่าที่ร้านตั้งเอง PIN เภสัชกรปลดไม่ได้ (9.29) — ต้องไปแก้ policy
    case "PHARMACY_QUANTITY_LIMIT_EXCEEDED":
      return `${data.sku}: เกินจำนวนสูงสุดต่อครั้ง (${data.maxQuantity}) — ลดจำนวน หรือแก้นโยบายที่หน้าแอดมิน`;
    // ขายเชื่อ (9.30) — reason จาก server บอกวงเงิน/ยอดค้างมาแล้ว ไม่ต้องแต่งซ้ำ
    case "AR_NOT_ALLOWED":
      return data.code === "NO_CUSTOMER"
        ? "ขายเชื่อต้องเลือกลูกค้าก่อน — ค้นสมาชิกที่ช่องลูกค้าด้านบน"
        : data.code === "NO_ACCOUNT"
          ? "ลูกค้ารายนี้ยังไม่มีบัญชีเครดิต — เปิดบัญชีและตั้งวงเงินที่หน้าลูกหนี้การค้าก่อน"
          : `ขายเชื่อไม่ได้: ${data.reason}`;
    case "COUPON_INVALID":
      return `คูปองใช้ไม่ได้: ${data.reason}`;
    // สองตัวนี้เดิมตกไปที่ default แล้วโชว์ "ขายไม่สำเร็จ (POINTS_INVALID)" ซึ่งบอก
    // แคชเชียร์ไม่ได้ว่าต้องทำอะไรต่อ ทั้งที่ server ส่ง reason ที่อ่านรู้เรื่องมาให้แล้ว
    case "POINTS_INVALID":
      return `แลกแต้มไม่ได้: ${data.reason}`;
    case "DISCOUNT_UNAPPROVED":
      return `ส่วนลดหน้าร้านใช้ไม่ได้: ${data.reason} — ให้หัวหน้าอนุมัติใหม่`;
    case "SERIAL_REQUIRED":
      return `${data.sku}: ต้องระบุเลขเครื่องให้ครบ ${data.expected} เลข (ใส่แล้ว ${data.received})`;
    case "SERIAL_ALREADY_SOLD":
      return `เลขเครื่อง ${data.serial} เคยขายไปแล้ว — หยิบกล่องผิดใบหรือยิงซ้ำ`;
    case "PAYMENT_FAILED":
      return `บันทึกการชำระเงินไม่สำเร็จ: ${data.reason}`;
    // เซิร์ฟเวอร์พังกลางคำขอ — บิลอาจถูกสร้างไปแล้ว ห้ามบอกให้ "ยิงใหม่" ลอย ๆ
    case "SERVER_ERROR":
      return `เซิร์ฟเวอร์ผิดพลาด (${data.error ?? "ไม่ทราบสาเหตุ"}) — กดชำระเงินอีกครั้ง ระบบจะใช้คีย์เดิมและไม่สร้างบิลซ้ำ`;
    default:
      return data?.error ?? `ขายไม่สำเร็จ (${data?.status ?? "ไม่ทราบสาเหตุ"})`;
  }
}
