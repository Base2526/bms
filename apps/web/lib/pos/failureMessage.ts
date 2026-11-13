import { createPosTranslator, type PosTranslator } from "@/i18n/posClient";
import { getLangCookie } from "@/lib/lang";

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

export function describePosFailure(data: any, posText: PosTranslator = createPosTranslator(getLangCookie() ?? "th")): string {
  switch (data?.status) {
    case "SHIFT_NOT_OPEN":
      return posText("กะปิดไปแล้ว — เปิดกะใหม่ก่อน");
    case "PAYMENT_MISMATCH":
      return data.subtotal != null && data.discount != null
        ? posText("ยอดไม่ตรง: ระบบคิดสินค้า ฿{v0} − ส่วนลดรวม ฿{v1} = ต้องรับ ฿{v2} แต่จอส่ง ฿{v3}{v4} — ระบบล้างยอดรับเงินให้แล้ว กรุณาตรวจราคาและรับเงินใหม่", { v0: baht(data.subtotal), v1: baht(data.discount), v2: baht(data.expected), v3: baht(data.received), v4: Number(data.pointsUsed) > 0 ? posText(" (ใช้ {v0} แต้มแล้ว)", { v0: Number(data.pointsUsed).toLocaleString() }) : "" })
        : posText("ยอดไม่ตรง: ระบบคิด ฿{v0} แต่จอส่ง ฿{v1} — ระบบล้างยอดรับเงินให้แล้ว กรุณารีเฟรชราคาและรับเงินใหม่", { v0: baht(data.expected), v1: baht(data.received) });
    case "LOT_EXPIRED_OR_SHORT":
      return posText("{v0}: ของที่ยังไม่หมดอายุเหลือ {v1} ต้องการ {v2} — หยิบกล่องใหม่", { v0: data.sku, v1: data.sellable, v2: data.requested });
    case "INSUFFICIENT":
      return posText("{v0}{v1} เหลือ {v2} ต้องการ {v3}", { v0: data.sku, v1: data.size && data.size !== "-" ? ` (${data.size})` : "", v2: data.available, v3: data.requested });
    case "NOT_FOUND":
      return posText("ไม่พบสินค้า {v0}", { v0: data.sku ?? "" });
    // สามตัวนี้มาจาก createOrderInTx โดยตรง เส้นทางเดียวที่ใช้คือการส่งครัวของบิลโต๊ะ
    // (บิลค้าปลีกกรองรายการที่ขายไม่ได้ทิ้งไปก่อนถึง server แล้ว)
    case "PACK_NOT_FOUND":
      return posText("{v0}: ไม่พบหน่วยขาย {v1} — ลบรายการแล้วค้นเมนูใหม่", { v0: data.sku, v1: data.packCode || posText("ที่เลือก") });
    case "BUNDLE_INCOMPLETE":
      return posText("{v0}: เป็นสินค้าชุดที่ยังไม่ได้ใส่ส่วนประกอบ — ตั้งส่วนประกอบที่หน้าแอดมินก่อนถึงจะขายได้", { v0: data.sku });
    case "INVALID_ITEM":
      return posText("รายการที่ {v0} ใช้ไม่ได้: {v1}", { v0: Number(data.index) + 1, v1: data.reason });
    case "EMPTY":
      return posText("ยังไม่มีรายการที่ส่งครัวได้ — เพิ่มเมนูก่อน");
    // เมนูที่ถูกตั้งว่า "หมดวันนี้" (9.55) — เดิมตกไปที่ default แล้วโชว์
    // "ขายไม่สำเร็จ (SOLD_OUT_TODAY)" ซึ่งไม่บอกว่าของตัวไหนและปลดที่ไหน
    case "SOLD_OUT_TODAY":
      return posText("{v0}{v1}: ถูกตั้งว่าหมดวันนี้ — เปิดขายอีกครั้งที่แท็บครัว หรือเอารายการนี้ออกจากบิล", { v0: data.sku, v1: data.size && data.size !== "-" ? ` (${data.size})` : "" });
    case "INVALID_PACK":
      return posText("{v0}: ไม่พบหน่วยขาย {v1} — โหลดสินค้าใหม่แล้วลองอีกครั้ง", { v0: data.sku, v1: data.packCode || posText("ที่เลือก") });
    case "PHARMACY_POLICY_UNKNOWN":
      return posText("{v0}: ยังไม่มีนโยบายการขายที่อนุมัติไว้ — ให้เภสัชกรกด PIN อนุมัติที่เครื่องเพื่อจ่ายครั้งนี้", { v0: data.sku });
    case "PHARMACY_PRESCRIPTION_REQUIRED":
      return posText("{v0}: ต้องมีใบสั่งแพทย์ — เภสัชกรตรวจใบสั่งแล้วกด PIN อนุมัติที่เครื่อง หรือส่งเคสเข้าคิวให้เภสัชกรอนุมัติก็ได้", { v0: data.sku });
    case "PHARMACY_ONLINE_SALE_PROHIBITED":
      return posText("{v0}: ห้ามขายออนไลน์ — ขายหน้าร้านได้เมื่อเภสัชกรกด PIN อนุมัติ", { v0: data.sku });
    case "PHARMACY_REVIEW_REQUIRED":
    case "PHARMACY_SAFETY_CHECK_REQUIRED":
      return posText("{v0}: ต้องให้เภสัชกรอนุมัติก่อน — ให้เภสัชกรกด PIN ที่เครื่อง หรือส่งเคสเข้าคิวถ้าต้องซักประวัติยาว", { v0: data.sku });
    // เพดานจำนวนต่อครั้งเป็นค่าที่ร้านตั้งเอง PIN เภสัชกรปลดไม่ได้ (9.29) — ต้องไปแก้ policy
    case "PHARMACY_QUANTITY_LIMIT_EXCEEDED":
      return posText("{v0}: เกินจำนวนสูงสุดต่อครั้ง ({v1}) — ลดจำนวน หรือแก้นโยบายที่หน้าแอดมิน", { v0: data.sku, v1: data.maxQuantity });
    // ขายเชื่อ (9.30) — reason จาก server บอกวงเงิน/ยอดค้างมาแล้ว ไม่ต้องแต่งซ้ำ
    case "AR_NOT_ALLOWED":
      return data.code === "NO_CUSTOMER"
        ? posText("ขายเชื่อต้องเลือกลูกค้าก่อน — ค้นสมาชิกที่ช่องลูกค้าด้านบน")
        : data.code === "NO_ACCOUNT"
          ? posText("ลูกค้ารายนี้ยังไม่มีบัญชีเครดิต — เปิดบัญชีและตั้งวงเงินที่หน้าลูกหนี้การค้าก่อน")
          : posText("ขายเชื่อไม่ได้: {v0}", { v0: data.reason });
    case "COUPON_INVALID":
      return posText("คูปองใช้ไม่ได้: {v0}", { v0: data.reason });
    // สองตัวนี้เดิมตกไปที่ default แล้วโชว์ "ขายไม่สำเร็จ (POINTS_INVALID)" ซึ่งบอก
    // แคชเชียร์ไม่ได้ว่าต้องทำอะไรต่อ ทั้งที่ server ส่ง reason ที่อ่านรู้เรื่องมาให้แล้ว
    case "POINTS_INVALID":
      return posText("แลกแต้มไม่ได้: {v0}", { v0: data.reason });
    case "DISCOUNT_UNAPPROVED":
      return posText("ส่วนลดหน้าร้านใช้ไม่ได้: {v0} — ให้หัวหน้าอนุมัติใหม่", { v0: data.reason });
    case "SERIAL_REQUIRED":
      return posText("{v0}: ต้องระบุเลขเครื่องให้ครบ {v1} เลข (ใส่แล้ว {v2})", { v0: data.sku, v1: data.expected, v2: data.received });
    case "SERIAL_ALREADY_SOLD":
      return posText("เลขเครื่อง {v0} เคยขายไปแล้ว — หยิบกล่องผิดใบหรือยิงซ้ำ", { v0: data.serial });
    case "PAYMENT_FAILED":
      return posText("บันทึกการชำระเงินไม่สำเร็จ: {v0}", { v0: data.reason });
    // เซิร์ฟเวอร์พังกลางคำขอ — บิลอาจถูกสร้างไปแล้ว ห้ามบอกให้ "ยิงใหม่" ลอย ๆ
    case "SERVER_ERROR":
      return posText("เซิร์ฟเวอร์ผิดพลาด ({v0}) — กดชำระเงินอีกครั้ง ระบบจะใช้คีย์เดิมและไม่สร้างบิลซ้ำ", { v0: data.error ?? posText("ไม่ทราบสาเหตุ") });
    default:
      return data?.error ?? posText("ขายไม่สำเร็จ ({v0})", { v0: data?.status ?? posText("ไม่ทราบสาเหตุ") });
  }
}

/**
 * ความล้มเหลว "ระดับการเชื่อมต่อ" ที่ยังไม่ถึง service — reverse proxy ตอบ 502/503/504
 * หรือเน็ตร้านหลุด · ต่างจาก describePosFailure() ที่แปลสถานะซึ่ง server ตั้งใจตอบมา
 *
 * เคสจริงที่เจอ: Caddy ตอบ 502 เป็น **HTML** ไม่ใช่ JSON → `response.json()` พัง →
 * body ว่าง → ไม่มีทั้ง `status` และ `error` → หน้าจอโชว์ "HTTP 502" ดิบ ๆ ซึ่งเป็น
 * ปัญหาเดียวกับที่เคยแก้ให้ 409 ไปแล้ว (พนักงานอ่านแล้วทำอะไรต่อไม่ได้)
 *
 * **คำสั่งเขียนเท่านั้น** ที่ต้องบอกว่า "ยังไม่รู้ว่าถูกบันทึกหรือไม่" สำหรับ 502/504 —
 * คำขออาจถึง server และ commit ไปแล้วก่อน proxy จะหมดเวลารอ การชวนให้กดซ้ำทันทีจึง
 * เสี่ยงทำงานซ้ำ (เช่น ส่งครัวสองรอบ) ส่วน GET เป็น read-only: มันโหลดข้อมูลล่าสุดไม่ได้
 * แต่ไม่มีผลการเขียนให้ต้องตาม จึงต้องบอกให้รีเฟรชโดยไม่ทำให้พนักงานเข้าใจว่ามีบิลค้างผล
 */
export function describeTransportFailure(status: number, online = true, method = "POST", posText: PosTranslator = createPosTranslator(getLangCookie() ?? "th")): string {
  const readOnly = method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD";
  if (!online) return readOnly
    ? posText("เน็ตหลุด — โหลดข้อมูลล่าสุดไม่ได้ ต่อเน็ตแล้วกดรีเฟรชอีกครั้ง")
    : posText("เน็ตหลุด — ยังไม่รู้ว่ารายการถูกบันทึกหรือไม่ ต่อเน็ตแล้วตรวจประวัติหรือสถานะจริงก่อน อย่ากดซ้ำหรือรับเงินซ้ำ");
  switch (status) {
    // fetch() ใช้ status 0 ในชั้น UI เมื่อไม่มี HTTP response เลย (DNS/TLS/socket/abort)
    // ต่างจาก 502 ที่ proxy ยังตอบกลับมาได้ แต่สำหรับพนักงานทั้งคู่คือยังยืนยันผลไม่ได้
    case 0:
      return readOnly
        ? posText("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — โหลดข้อมูลล่าสุดไม่ได้ กดรีเฟรชอีกครั้ง ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบ")
        : posText("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ยังไม่รู้ว่ารายการถูกบันทึกหรือไม่ กดรีเฟรชเพื่อดูสถานะจริงก่อน อย่ากดซ้ำทันที");
    case 502:
    case 503:
    case 504:
      return readOnly
        ? posText("เซิร์ฟเวอร์ไม่ตอบ ({v0}) — โหลดข้อมูลล่าสุดไม่ได้ กดรีเฟรชอีกครั้ง ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบ", { v0: status })
        : posText("เซิร์ฟเวอร์ไม่ตอบ ({v0}) — ยังไม่รู้ว่ารายการถูกบันทึกหรือไม่ กดรีเฟรชเพื่อดูสถานะจริงก่อน อย่ากดซ้ำทันที ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบ", { v0: status });
    case 401:
      return posText("เครื่องนี้ไม่ได้จับคู่แล้ว — จับคู่เครื่อง POS ใหม่จากหลังบ้าน");
    case 403:
      return posText("บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ — ให้คนที่มีสิทธิ์กด PIN");
    case 404:
      return posText("ไม่พบเส้นทางนี้บนเซิร์ฟเวอร์ — เวอร์ชันหน้าจอกับเซิร์ฟเวอร์อาจไม่ตรง ให้โหลดหน้าใหม่");
    case 429:
      return posText("ยิงคำขอถี่เกินไป — รอสักครู่แล้วลองอีกครั้ง");
    default:
      return status >= 500
        ? readOnly
          ? posText("เซิร์ฟเวอร์ผิดพลาด ({v0}) — โหลดข้อมูลล่าสุดไม่ได้ กดรีเฟรชอีกครั้ง", { v0: status })
          : posText("เซิร์ฟเวอร์ผิดพลาด ({v0}) — ยังไม่รู้ว่ารายการถูกบันทึกหรือไม่ กดรีเฟรชเพื่อดูสถานะจริงก่อนลองใหม่", { v0: status })
        : readOnly
          ? posText("โหลดข้อมูลไม่สำเร็จ ({v0}) — โหลดหน้าใหม่แล้วลองอีกครั้ง", { v0: status })
          : posText("ทำรายการไม่สำเร็จ ({v0}) — โหลดหน้าใหม่แล้วลองอีกครั้ง", { v0: status });
  }
}
