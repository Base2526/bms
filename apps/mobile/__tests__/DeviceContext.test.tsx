import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import { DeviceProvider, useDevice } from '../src/state/DeviceContext';
import { loadOfflineSales } from '../src/lib/offlineSales';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/lib/offlineSales', () => ({
  loadOfflineSales: jest.fn().mockResolvedValue([]),
}));

const TARGET = {
  serverUrl: 'https://shop.example.com',
  token: `pos_${'a'.repeat(32)}`,
};

const pairingWriteCount = () =>
  (Keychain.setGenericPassword as jest.Mock).mock.calls.filter(
    ([, , options]) => options?.service === 'com.bms.pos.device',
  ).length;

describe('DeviceProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (loadOfflineSales as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('verifies the newly paired target instead of the previous React state', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            bmsPosSession: {
              device: { id: 'device-1', code: 'POS-01', name: 'Front' },
              location: { name: 'Main', branchCode: 'MAIN' },
              surface: 'restaurant',
              businessArchetype: 'restaurant',
              shift: { id: 'shift-1' },
              cashiers: [{ id: 'cashier-1' }],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    let device: ReturnType<typeof useDevice> | undefined;
    function Probe() {
      device = useDevice();
      return null;
    }

    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <DeviceProvider>
          <Probe />
        </DeviceProvider>,
      );
    });

    await act(async () => {
      await device!.pair(TARGET);
    });

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      TARGET.serverUrl,
      TARGET.token,
      expect.objectContaining({ service: 'com.bms.pos.device' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://shop.example.com/api/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: `Bearer ${TARGET.token}`,
          'x-pos-device-token': TARGET.token,
          'x-scope': 'pos',
        }),
      }),
    );
    expect(device!.verify).toEqual({
      kind: 'OK',
      info: {
        deviceId: 'device-1',
        deviceCode: 'POS-01',
        deviceName: 'Front',
        branchName: 'Main',
        branchCode: 'MAIN',
        surface: 'restaurant',
        businessArchetype: 'restaurant',
        shiftOpen: true,
        cashierCount: 1,
      },
    });

    await act(async () => {
      tree!.unmount();
    });
  });

  /**
   * ปุ่ม "ทดสอบการเชื่อมต่อ" ที่กดแล้วผ่าน จะคืนการ์ดผลที่หน้าตาเหมือนเดิมทุกตัวอักษร
   * ผู้ใช้จึงอ่านว่าปุ่มเสีย (รายงานจากไอแพดหน้าร้าน 2026-09-14) · เวลาที่คำตอบกลับมาถึงเครื่อง
   * คือสิ่งเดียวที่เปลี่ยนจริงในรอบที่ผ่าน — และเป็นตัวเดียวที่แยก "คำตอบสด" ออกจาก
   * "คำตอบค้างจอจากตอนเปิดแอป" ด้วย
   */
  test('every settled verify stamps when the answer arrived, so a passing retest is visible', async () => {
    // Response อ่าน body ได้ครั้งเดียว — รอบนี้ยิงสองครั้ง จึงต้องสร้างใหม่ทุกคำขอ
    // (mockResolvedValue คืนอ็อบเจ็กต์เดิม แล้วรอบสองจะกลายเป็น SERVER_ERROR ปลอม ๆ)
    const sessionResponse = () =>
      new Response(
        JSON.stringify({
          data: {
            bmsPosSession: {
              device: { id: 'device-1', code: 'POS-01', name: 'Front' },
              location: { name: 'Main', branchCode: 'MAIN' },
              surface: 'retail',
              businessArchetype: 'general',
              shift: null,
              cashiers: [],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(sessionResponse()));

    let device: ReturnType<typeof useDevice> | undefined;
    function Probe() {
      device = useDevice();
      return null;
    }

    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <DeviceProvider>
          <Probe />
        </DeviceProvider>,
      );
    });
    expect(device!.lastCheckedAt).toBeNull();

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    await act(async () => {
      await device!.pair(TARGET);
    });
    expect(device!.verify.kind).toBe('OK');
    expect(device!.lastCheckedAt).toBe(1_000);

    // กดทดสอบอีกครั้งแล้วผ่านเหมือนเดิม — การ์ดเหมือนเดิม แต่เวลาต้องขยับ
    nowSpy.mockReturnValue(2_000);
    await act(async () => {
      await device!.runVerify();
    });
    expect(device!.verify.kind).toBe('OK');
    expect(device!.lastCheckedAt).toBe(2_000);

    // เลิกจับคู่แล้วเวลาเก่าต้องหายไปด้วย ไม่งั้นจอเครื่องที่ยังไม่จับคู่โชว์ว่าเพิ่งตรวจผ่าน
    await act(async () => {
      await device!.unpair();
    });
    expect(device!.lastCheckedAt).toBeNull();

    nowSpy.mockRestore();
    await act(async () => {
      tree!.unmount();
    });
  });

  test('a failed check is stamped too, so pressing again is not silent either', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network request failed'));
    jest.spyOn(Date, 'now').mockReturnValue(5_000);

    let device: ReturnType<typeof useDevice> | undefined;
    function Probe() {
      device = useDevice();
      return null;
    }

    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <DeviceProvider>
          <Probe />
        </DeviceProvider>,
      );
    });
    let pairError: unknown;
    await act(async () => {
      try {
        await device!.pair(TARGET);
      } catch (error) {
        pairError = error;
      }
    });
    expect(pairError).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('ต่อเซิร์ฟเวอร์ไม่ได้'),
      }),
    );

    expect(device!.verify.kind).toBe('OFFLINE');
    expect(device!.lastCheckedAt).toBe(5_000);
    expect(pairingWriteCount()).toBe(0);

    await act(async () => {
      tree!.unmount();
    });
  });

  test('treats a GraphQL UNAUTHENTICATED error as a revoked device token', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [
            {
              message: 'token rejected',
              extensions: { code: 'UNAUTHENTICATED' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    let device: ReturnType<typeof useDevice> | undefined;
    function Probe() {
      device = useDevice();
      return null;
    }

    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <DeviceProvider>
          <Probe />
        </DeviceProvider>,
      );
    });
    let pairError: unknown;
    await act(async () => {
      try {
        await device!.pair(TARGET);
      } catch (error) {
        pairError = error;
      }
    });
    expect(pairError).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('เซิร์ฟเวอร์ไม่รับ token'),
      }),
    );

    expect(device!.verify.kind).toBe('REJECTED');
    expect(pairingWriteCount()).toBe(0);

    await act(async () => {
      tree!.unmount();
    });
  });

  test('cannot replace a pairing with a different server or device while accepted cash is queued', async () => {
    const queued = {
      serverUrl: TARGET.serverUrl,
      deviceId: 'device-1',
    };
    (loadOfflineSales as jest.Mock).mockResolvedValue([queued]);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            bmsPosSession: {
              device: { id: 'device-2', code: 'POS-02', name: 'Back' },
              location: { name: 'Main', branchCode: 'MAIN' },
              surface: 'retail',
              businessArchetype: 'general',
              shift: null,
              cashiers: [],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    let device: ReturnType<typeof useDevice> | undefined;
    function Probe() {
      device = useDevice();
      return null;
    }

    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <DeviceProvider>
          <Probe />
        </DeviceProvider>,
      );
    });

    let serverError: unknown;
    await act(async () => {
      try {
        await device!.pair({
          ...TARGET,
          serverUrl: 'https://other.example.com',
        });
      } catch (error) {
        serverError = error;
      }
    });
    expect(serverError).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('เซิร์ฟเวอร์เดิม'),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    let deviceError: unknown;
    await act(async () => {
      try {
        await device!.pair(TARGET);
      } catch (error) {
        deviceError = error;
      }
    });
    expect(deviceError).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('คนละเครื่อง'),
      }),
    );
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/graphql'),
      ),
    ).toHaveLength(1);
    expect(pairingWriteCount()).toBe(0);

    await act(async () => {
      tree!.unmount();
    });
  });

  test('records an authoritative auth rejection without verifying the token again', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            bmsPosSession: {
              device: { id: 'device-1', code: 'POS-01', name: 'Front' },
              location: { name: 'Main', branchCode: 'MAIN' },
              surface: 'retail',
              businessArchetype: 'general',
              shift: null,
              cashiers: [],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    let device: ReturnType<typeof useDevice> | undefined;
    function Probe() {
      device = useDevice();
      return null;
    }

    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <DeviceProvider>
          <Probe />
        </DeviceProvider>,
      );
    });
    await act(async () => {
      await device!.pair(TARGET);
    });
    const graphqlCallCount = () =>
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/graphql'),
      ).length;
    expect(graphqlCallCount()).toBe(1);

    await act(async () => {
      device!.markAuthenticationRejected();
      device!.markAuthenticationRejected();
    });

    expect(device!.verify.kind).toBe('REJECTED');
    expect(graphqlCallCount()).toBe(1);

    await act(async () => {
      tree!.unmount();
    });
  });
});
