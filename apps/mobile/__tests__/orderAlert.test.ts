import {
  DEFAULT_ORDER_ALERT_SETTINGS,
  ORDER_ALERT_VIBRATION,
  alertBlockedNotice,
  alertReachedSomeone,
  describeAgo,
  newAlertIds,
  normalizeOrderAlertSettings,
  shouldRepeatAlert,
  type AlertOutcome,
} from '../src/lib/orderAlert';

describe('orderAlert', () => {
  /**
   * ⚠️ ค่าปริยายต้องเป็น "เปิด" — ฝั่งเว็บเคยตั้งเป็นปิด แล้วแท็บเล็ตเครื่องใหม่ทุกเครื่อง
   * เริ่มต้นแบบเงียบ ซึ่งพนักงานอ่านไม่ต่างจาก "ระบบนี้ไม่มีเสียงเตือน"
   */
  it('ค่าปริยายเปิดการแจ้งเตือนไว้ทุกช่องทาง', () => {
    expect(DEFAULT_ORDER_ALERT_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_ORDER_ALERT_SETTINGS.sound).toBe(true);
    expect(DEFAULT_ORDER_ALERT_SETTINGS.vibrate).toBe(true);
    expect(DEFAULT_ORDER_ALERT_SETTINGS.kinds.incoming_order).toBe(true);
    expect(DEFAULT_ORDER_ALERT_SETTINGS.repeatSeconds).toBeGreaterThan(0);
  });

  it('patch เปลี่ยนเฉพาะที่ส่งมา ไม่ล้างค่าที่เหลือ', () => {
    const next = normalizeOrderAlertSettings({ sound: false });
    expect(next.sound).toBe(false);
    expect(next.vibrate).toBe(true);
    expect(next.kinds.kitchen_ticket).toBe(true);
  });

  it('ค่าย้ำที่อ่านไม่ออกตกกลับค่าปริยาย ไม่ใช่กลายเป็น 0 (เลิกย้ำ) เงียบ ๆ', () => {
    expect(
      normalizeOrderAlertSettings({ repeatSeconds: NaN }).repeatSeconds,
    ).toBe(DEFAULT_ORDER_ALERT_SETTINGS.repeatSeconds);
    expect(
      normalizeOrderAlertSettings({ repeatSeconds: -5 }).repeatSeconds,
    ).toBe(DEFAULT_ORDER_ALERT_SETTINGS.repeatSeconds);
    // 0 = ผู้ใช้ตั้งใจปิดการย้ำ ต้องเคารพ
    expect(
      normalizeOrderAlertSettings({ repeatSeconds: 0 }).repeatSeconds,
    ).toBe(0);
    // ค่าสุดโต่งถูกบีบเข้ากรอบ ไม่ใช่ย้ำทุก 1 วินาที
    expect(
      normalizeOrderAlertSettings({ repeatSeconds: 1 }).repeatSeconds,
    ).toBe(10);
    expect(
      normalizeOrderAlertSettings({ repeatSeconds: 9999 }).repeatSeconds,
    ).toBe(300);
  });

  it('เตือนเฉพาะ id ที่เพิ่งโผล่ ไม่ใช่ทุกใบที่ยังค้างอยู่', () => {
    const seen = new Set(['a', 'b']);
    expect(newAlertIds(seen, ['a', 'b'])).toEqual([]);
    expect(newAlertIds(seen, ['a', 'b', 'c'])).toEqual(['c']);
    // ใบที่หายไปแล้วกลับมาถือว่าใหม่ (ผู้เรียกล้าง set ทุกอบ)
    expect(newAlertIds(new Set(), ['a'])).toEqual(['a']);
  });

  it('"รับทราบ" หยุดการย้ำได้จริง', () => {
    const base = {
      pendingCount: 3,
      lastAlertAtMs: 0,
      nowMs: 999_999,
      repeatSeconds: 30,
    };
    expect(shouldRepeatAlert({ ...base, acknowledged: false })).toBe(true);
    // ⚠️ ถ้าหยุดไม่ได้ คนหน้าร้านจะปิดสวิตช์ใหญ่ทิ้ง แล้วออร์เดอร์จริงใบถัดไปเงียบไปด้วย
    expect(shouldRepeatAlert({ ...base, acknowledged: true })).toBe(false);
  });

  it('ไม่ย้ำเมื่อไม่มีใบค้าง หรือผู้ใช้ปิดการย้ำ', () => {
    const base = { lastAlertAtMs: 0, nowMs: 999_999, acknowledged: false };
    expect(
      shouldRepeatAlert({ ...base, pendingCount: 0, repeatSeconds: 30 }),
    ).toBe(false);
    expect(
      shouldRepeatAlert({ ...base, pendingCount: 3, repeatSeconds: 0 }),
    ).toBe(false);
  });

  it('ย้ำต่อเมื่อครบรอบเวลาแล้วจริง', () => {
    const base = {
      pendingCount: 1,
      repeatSeconds: 30,
      acknowledged: false,
      lastAlertAtMs: 1_000_000,
    };
    expect(shouldRepeatAlert({ ...base, nowMs: 1_020_000 })).toBe(false);
    expect(shouldRepeatAlert({ ...base, nowMs: 1_030_000 })).toBe(true);
    // ยังไม่เคยเตือนเลย = เตือนได้ทันที
    expect(shouldRepeatAlert({ ...base, lastAlertAtMs: null, nowMs: 1 })).toBe(
      true,
    );
  });

  it('รูปแบบการสั่นของออร์เดอร์เข้ากับตั๋วครัวต้องแยกจากกัน', () => {
    expect(ORDER_ALERT_VIBRATION.incoming_order).not.toEqual(
      ORDER_ALERT_VIBRATION.kitchen_ticket,
    );
    // จังหวะแรกต้องเป็น 0 เสมอ (RN อ่านช่องแรกเป็น "หน่วงก่อนเริ่ม")
    expect(ORDER_ALERT_VIBRATION.incoming_order[0]).toBe(0);
    expect(ORDER_ALERT_VIBRATION.kitchen_ticket[0]).toBe(0);
  });

  /**
   * ⚠️ หัวใจของไฟล์นี้: ต้องแยก "เตือนแล้ว" ออกจาก "เตือนถึงคนจริง"
   * บั๊กเดิมของฝั่งเว็บคือปุ่มโชว์ว่าเปิดเสียงอยู่แต่เงียบสนิท แล้วไม่มีอะไรบอก
   */
  it('เตือนไม่ถึงใครเลยต้องตรวจจับได้ ไม่ใช่รายงานว่าสำเร็จ', () => {
    const nothing: AlertOutcome = {
      sound: 'unavailable',
      vibration: 'unavailable',
    };
    expect(alertReachedSomeone(nothing)).toBe(false);
    expect(alertBlockedNotice(nothing)).toMatch(/ไม่ถึง/);

    const vibratedOnly: AlertOutcome = {
      sound: 'unavailable',
      vibration: 'played',
    };
    expect(alertReachedSomeone(vibratedOnly)).toBe(true);
    expect(alertBlockedNotice(vibratedOnly)).toMatch(/โมดูลเสียง/);

    const fine: AlertOutcome = { sound: 'played', vibration: 'played' };
    expect(alertBlockedNotice(fine)).toBeNull();
  });

  it('ปิดช่องทางไว้เองไม่นับว่าเตือนไม่ถึง แต่ก็ไม่นับว่าถึง', () => {
    const allSkipped: AlertOutcome = { sound: 'skipped', vibration: 'skipped' };
    expect(alertReachedSomeone(allSkipped)).toBe(false);
  });

  it('describeAgo อ่านรู้เรื่องและไม่คืน NaN', () => {
    expect(describeAgo(30_000)).toBe('เมื่อครู่');
    expect(describeAgo(5 * 60_000)).toBe('5 นาทีที่แล้ว');
    expect(describeAgo(90 * 60_000)).toBe('1 ชม. 30 น. ที่แล้ว');
    expect(describeAgo(NaN)).toBe('เมื่อครู่');
    expect(describeAgo(-1)).toBe('เมื่อครู่');
  });
});
