import { Vibration } from 'react-native';
import {
  __resetOrderAlertStateForTest,
  acknowledgeOrderAlerts,
  fireOrderAlert,
  getOrderAlertSnapshot,
  updateOrderAlertSettings,
} from '../src/state/OrderAlertContext';
import {
  hasOrderAlertSoundPlayer,
  registerOrderAlertSoundPlayer,
} from '../src/lib/orderAlertSound';

// สอดส่อง Vibration ตัวจริงของ RN แทนการ mock ด้วย path ภายใน (path ย้ายได้ทุกเวอร์ชัน
// แล้วเทสจะพังด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่กำลังตรึง)
const vibrateSpy = jest
  .spyOn(Vibration, 'vibrate')
  .mockImplementation(() => {});
const cancelSpy = jest.spyOn(Vibration, 'cancel').mockImplementation(() => {});

describe('เส้นทางแจ้งเตือนจริง', () => {
  beforeEach(() => {
    __resetOrderAlertStateForTest();
    registerOrderAlertSoundPlayer(null);
    vibrateSpy.mockClear();
    cancelSpy.mockClear();
  });

  afterAll(() => {
    registerOrderAlertSoundPlayer(null);
    vibrateSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('ค่าปริยายสั่นจริงเมื่อมีออร์เดอร์เข้า', () => {
    const outcome = fireOrderAlert('incoming_order');
    expect(vibrateSpy).toHaveBeenCalledTimes(1);
    expect(outcome.vibration).toBe('played');
  });

  /**
   * ⚠️ เทสตัวสำคัญที่สุดของไฟล์นี้
   * ยังไม่มีโมดูลเสียงติดตั้ง → ต้องรายงานว่า `unavailable` ห้ามรายงานว่าเล่นแล้ว
   * (บั๊กเดิมของฝั่งเว็บอยู่ได้เป็นเดือนเพราะระบบรายงานว่าดังทั้งที่เงียบสนิท)
   */
  it('ไม่มีโมดูลเสียง = รายงานว่าเล่นไม่ได้ ไม่ใช่รายงานว่าสำเร็จ', () => {
    expect(hasOrderAlertSoundPlayer()).toBe(false);
    const outcome = fireOrderAlert('incoming_order');
    expect(outcome.sound).toBe('unavailable');
  });

  it('ตัวเล่นเสียงที่บอกว่าเล่นไม่ได้ ต้องไม่ถูกนับว่าเล่นแล้ว', () => {
    registerOrderAlertSoundPlayer({ play: () => false });
    expect(fireOrderAlert('incoming_order').sound).toBe('unavailable');

    registerOrderAlertSoundPlayer({ play: () => true });
    expect(fireOrderAlert('incoming_order').sound).toBe('played');
  });

  it('ตัวเล่นเสียงที่ throw ต้องไม่ล้มการแจ้งเตือนทั้งก้อน', () => {
    registerOrderAlertSoundPlayer({
      play: () => {
        throw new Error('native module พัง');
      },
    });
    const outcome = fireOrderAlert('incoming_order');
    expect(outcome.sound).toBe('unavailable');
    // การสั่นยังต้องทำงานต่อ
    expect(outcome.vibration).toBe('played');
  });

  it('ปิดสวิตช์ใหญ่แล้วเงียบทุกช่องทาง', () => {
    updateOrderAlertSettings({ enabled: false });
    const outcome = fireOrderAlert('incoming_order');
    expect(vibrateSpy).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sound: 'skipped', vibration: 'skipped' });
  });

  it('ปิดเฉพาะชนิดเหตุการณ์ได้ โดยชนิดอื่นยังเตือน', () => {
    updateOrderAlertSettings({
      kinds: { incoming_order: true, kitchen_ticket: false },
    });
    expect(fireOrderAlert('kitchen_ticket').vibration).toBe('skipped');
    expect(fireOrderAlert('incoming_order').vibration).toBe('played');
  });

  it('ปิดการสั่นแล้วไม่เรียก Vibration เลย', () => {
    updateOrderAlertSettings({ vibrate: false });
    fireOrderAlert('incoming_order');
    expect(vibrateSpy).not.toHaveBeenCalled();
  });

  it('การแจ้งเตือนรอบใหม่ล้างสถานะ "รับทราบ" ของรอบก่อน', () => {
    fireOrderAlert('incoming_order');
    acknowledgeOrderAlerts();
    expect(getOrderAlertSnapshot().acknowledged).toBe(true);
    expect(cancelSpy).toHaveBeenCalled();

    fireOrderAlert('incoming_order');
    // ⚠️ ถ้าไม่ล้าง ใบที่เข้ามาใหม่หลังกดรับทราบจะไม่มีวันย้ำอีกเลยตลอดกะ
    expect(getOrderAlertSnapshot().acknowledged).toBe(false);
  });

  it('บันทึกเวลาที่เตือนล่าสุดไว้ให้ตัวย้ำใช้', () => {
    expect(getOrderAlertSnapshot().lastAlertAtMs).toBeNull();
    fireOrderAlert('incoming_order', 1_700_000);
    expect(getOrderAlertSnapshot().lastAlertAtMs).toBe(1_700_000);
    expect(getOrderAlertSnapshot().lastKind).toBe('incoming_order');
  });

  it('ไม่มีเสียงแต่สั่นได้ ต้องขึ้นข้อความบอกว่าเสียงใช้ไม่ได้', () => {
    fireOrderAlert('incoming_order');
    expect(getOrderAlertSnapshot().blockedNotice).toMatch(/โมดูลเสียง/);
  });
});
