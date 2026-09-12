import React from 'react';
import { Vibration } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { OrderAlertEffects } from '../src/components/OrderAlertWatcher';
import {
  __resetOrderAlertStateForTest,
  getOrderAlertSnapshot,
} from '../src/state/OrderAlertContext';
import { registerOrderAlertSoundPlayer } from '../src/lib/orderAlertSound';

const vibrateSpy = jest
  .spyOn(Vibration, 'vibrate')
  .mockImplementation(() => {});
jest.spyOn(Vibration, 'cancel').mockImplementation(() => {});

/**
 * เทสเส้นทางจริง: "มีออร์เดอร์เข้า → เครื่องแจ้งเตือน"
 *
 * ⚠️ เทสระดับ pure บอกได้แค่ว่ากติกาถูก แต่บอกไม่ได้ว่าใครเรียกมันจริงไหม
 * ตัวนี้จึงประกอบ provider จริงแล้วสั่งให้ออร์เดอร์เข้ามา
 */
function harness() {
  let order = 0;
  let ticket = 0;
  const render = () => (
    <OrderAlertEffects
      pendingIds={Array.from({ length: order }, (_, index) => `order-${index}`)}
      pendingCount={order}
      tickets={Array.from({ length: ticket }, (_, index) => ({
        id: `ticket-${index}`,
        status: 'NEW',
      }))}
    />
  );
  return {
    render,
    arrive: () => {
      order += 1;
    },
    sendTicket: () => {
      ticket += 1;
    },
  };
}

describe('OrderAlertWatcher', () => {
  let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    __resetOrderAlertStateForTest();
    registerOrderAlertSoundPlayer(null);
    vibrateSpy.mockClear();
  });

  // ⚠️ ต้อง unmount ทุกเทส — ตัวย้ำซ้ำตั้ง setInterval ไว้ ถ้าปล่อยค้าง มันจะเดินต่อหลัง jest
  // ปิด environment แล้วโยน "import after teardown" ซึ่งอ่านเหมือนเทสพังทั้งที่ผ่าน
  afterEach(async () => {
    if (mounted) {
      const renderer = mounted;
      mounted = null;
      await ReactTestRenderer.act(() => {
        renderer.unmount();
      });
    }
  });

  const mount = async (tree: React.ReactElement) => {
    await ReactTestRenderer.act(() => {
      mounted = ReactTestRenderer.create(tree);
    });
  };

  it('เปิดแอปมาเจอของค้างอยู่แล้ว ต้องไม่เตือนรัวตั้งแต่แรก', async () => {
    const test = harness();
    await mount(test.render());
    expect(vibrateSpy).not.toHaveBeenCalled();
    expect(getOrderAlertSnapshot().lastAlertAtMs).toBeNull();
  });

  it('ออร์เดอร์เข้าใหม่หนึ่งใบ = แจ้งเตือนหนึ่งครั้ง', async () => {
    const test = harness();
    await mount(test.render());
    test.arrive();
    await ReactTestRenderer.act(() => {
      mounted?.update(test.render());
    });
    expect(vibrateSpy).toHaveBeenCalledTimes(1);
    expect(getOrderAlertSnapshot().lastKind).toBe('incoming_order');
  });

  it('ตั๋วครัวใบใหม่ก็แจ้งเตือน และแยกชนิดออกจากออร์เดอร์เข้า', async () => {
    const test = harness();
    await mount(test.render());
    test.sendTicket();
    await ReactTestRenderer.act(() => {
      mounted?.update(test.render());
    });
    expect(vibrateSpy).toHaveBeenCalledTimes(1);
    expect(getOrderAlertSnapshot().lastKind).toBe('kitchen_ticket');
  });

  it('ออร์เดอร์เข้าสองใบติดกันเตือนสองครั้ง ไม่ใช่ครั้งเดียว', async () => {
    const test = harness();
    await mount(test.render());
    test.arrive();
    await ReactTestRenderer.act(() => {
      mounted?.update(test.render());
    });
    test.arrive();
    await ReactTestRenderer.act(() => {
      mounted?.update(test.render());
    });
    expect(vibrateSpy).toHaveBeenCalledTimes(2);
  });
});
