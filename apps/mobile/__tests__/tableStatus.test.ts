import { tableStatusFor } from '../src/lib/tableStatus';

describe('tableStatusFor', () => {
  it('โต๊ะที่มีรายการคือโต๊ะที่มีลูกค้า ไม่ว่า mock จะ seed ไว้ว่าอะไร', () => {
    expect(tableStatusFor(3, 'EMPTY')).toBe('OCCUPIED');
    expect(tableStatusFor(1, undefined)).toBe('OCCUPIED');
  });

  it('โต๊ะที่ seed เป็น CLOSING ยังขึ้นว่ากำลังคิดเงินตราบใดที่บิลยังมีรายการ', () => {
    expect(tableStatusFor(2, 'CLOSING')).toBe('CLOSING');
  });

  /**
   * ⚠️ เทสตัวสำคัญของไฟล์นี้
   * ของเดิมเช็ค CLOSING ก่อน โต๊ะ T04 ที่ seed ไว้เป็น CLOSING จึงค้างที่ "กำลังคิดเงิน"
   * ตลอดไปหลังคิดเงินจบ — ผังโต๊ะบอกว่าโต๊ะไม่ว่างทั้งที่บิลว่างเปล่า
   */
  it('คิดเงินจบแล้วบิลว่าง โต๊ะต้องกลับมาว่าง แม้ mock จะ seed เป็น CLOSING', () => {
    expect(tableStatusFor(0, 'CLOSING')).toBe('EMPTY');
    expect(tableStatusFor(0, 'OCCUPIED')).toBe('EMPTY');
    expect(tableStatusFor(0, 'EMPTY')).toBe('EMPTY');
  });
});
