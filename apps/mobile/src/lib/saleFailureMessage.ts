interface SaleFailure {
  status?: string | null;
  reason?: string | null;
}

/**
 * แปลงผลปฏิเสธของ sale mutation ให้เป็นข้อความที่พนักงานทำต่อได้
 *
 * GraphQL ส่ง business rejection กลับมาใน data ตามสัญญา จึงไม่ผ่านตัวแปล GraphQL error
 * และบางสถานะ (เช่น SHIFT_NOT_OPEN) ตั้งใจไม่มี reason หากเอา status ไปแสดงตรง ๆ
 * คนหน้าเครื่องจะเห็นรหัสภายในแทนคำแนะนำ
 */
export function describeMobileSaleFailure(
  failure: SaleFailure | null | undefined,
  fallback = 'บันทึกการขายไม่สำเร็จ',
): string {
  switch (failure?.status) {
    case 'SHIFT_NOT_OPEN':
      return 'ยังไม่ได้เปิดกะของเครื่องนี้ กรุณาเปิดกะก่อนขาย';
    case 'PAYMENT_MISMATCH':
      return (
        failure.reason?.trim() ||
        'ยอดเงินที่รับไม่ตรงกับราคาที่ Server ตรวจได้ กรุณาให้ผู้จัดการกระทบยอด และห้ามรับเงินซ้ำ'
      );
    case 'LOT_EXPIRED_OR_SHORT':
      return (
        failure.reason?.trim() ||
        'สต็อกพร้อมขายไม่พอหรือ Lot หมดอายุ กรุณาตรวจสต็อกก่อนลองซิงก์อีกครั้ง'
      );
    default: {
      const reason = failure?.reason?.trim();
      if (reason) return reason;
      return failure?.status ? `${fallback} (${failure.status})` : fallback;
    }
  }
}
