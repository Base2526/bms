import React from 'react';
import { AppState } from 'react-native';
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
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
    (loadOfflineSales as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([undefined, null, '', ' ', {}, []])('rejects a bootstrap device without a usable ID: %j', async id => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: { bmsPosSession: { device: { id }, cashiers: [] } } }),
    } as Response);
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
    await act(async () => { await expect(device.pair(TARGET)).rejects.toThrow(); });
    expect(pairingWriteCount()).toBe(0);
    expect(device.target).toBeNull();
    expect(device.verify.kind).toBe('SERVER_ERROR');
    await act(async () => tree.unmount());
  });

  test.each(['graphql', 'network'])('redacts credentials from %s errors before UI and diagnostics', async source => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      if (!String(url).endsWith('/api/graphql')) return { ok: true, status: 200 } as Response;
      if (source === 'network') throw new Error(`Unable to connect with ${TARGET.token}`);
      return { ok: true, status: 200, json: async () => ({ errors: [{ message: `Invalid ${TARGET.token}`, extensions: { code: TARGET.token } }] }) } as Response;
    });
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
    await act(async () => {
      await expect(device.pair(TARGET)).rejects.not.toThrow(TARGET.token);
    });
    expect(JSON.stringify(device.verify)).not.toContain(TARGET.token);
    const savedDiagnostics = (Keychain.setGenericPassword as jest.Mock).mock.calls.filter(([, , options]) => options.service === 'com.bms.pos.diagnostics').map(([, body]) => body);
    const sentDiagnostics = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/diagnostics/events')).map(([, init]) => init?.body);
    expect(savedDiagnostics.length + sentDiagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify([...savedDiagnostics, ...sentDiagnostics])).not.toContain(TARGET.token);
    expect(pairingWriteCount()).toBe(0);
    await act(async () => tree.unmount());
  });

  test.each([
    { errors: 'invalid' }, { errors: [null] }, { errors: [{ message: {}, extensions: { code: [] } }] },
    { data: { bmsPosSession: { device: { id: 'device-1' }, cashiers: null } } },
  ])('malformed server payload is a server error, not offline or a valid pairing: %j', async body => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response);
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
    await act(async () => { await expect(device.pair(TARGET)).rejects.toThrow(); });
    expect(device.verify.kind).toBe('SERVER_ERROR');
    expect(pairingWriteCount()).toBe(0);
    await act(async () => tree.unmount());
  });

  test.each([401, 403, 503])('HTTP %s never persists a new pairing and only 401 means rejected auth', async status => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status } as Response);
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
    await act(async () => { await expect(device.pair(TARGET)).rejects.toThrow(); });
    expect(device.verify.kind).toBe(status === 401 ? 'REJECTED' : 'SERVER_ERROR');
    expect(pairingWriteCount()).toBe(0);
    await act(async () => tree.unmount());
  });

  test.each(['401', '403', 'network', 'storage'])('failed replacement preserves the previous pairing and verification: %s', async failure => {
    const next = { ...TARGET, token: `pos_${'b'.repeat(43)}` };
    (Keychain.getGenericPassword as jest.Mock).mockImplementation(async options => options.service === 'com.bms.pos.device' ? { username: TARGET.serverUrl, password: TARGET.token } : false);
    (Keychain.setGenericPassword as jest.Mock).mockImplementation(async (_user, _value, options) => options.service !== 'com.bms.pos.device' || failure !== 'storage');
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const candidate = String(url).endsWith('/api/graphql') && (init?.headers as Record<string, string>)?.['x-pos-device-token'] === next.token;
      if (candidate && failure === 'network') throw new Error('Network unavailable');
      const status = candidate && (failure === '401' || failure === '403') ? Number(failure) : 200;
      return { ok: status === 200, status, json: async () => ({ data: { bmsPosSession: { device: { id: 'device-1' }, cashiers: [] } } }) } as Response;
    });
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
    const previousVerification = device.verify;
    expect(previousVerification.kind).toBe('OK');
    await act(async () => { await expect(device.pair(next)).rejects.toThrow(); });
    expect(device.target).toEqual(TARGET);
    expect(device.status).toBe('PAIRED');
    expect(device.verify).toEqual(previousVerification);
    expect(pairingWriteCount()).toBe(failure === 'storage' ? 1 : 0);
    await act(async () => tree.unmount());
  });

  test('restores the original token after secure storage is unlocked and the app returns to foreground', async () => {
    const listener = jest.spyOn(AppState, 'addEventListener');
    (Keychain.getGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: { bmsPosSession: {
        device: { id: 'device-1', code: 'POS-01' }, cashiers: [],
      } } }),
    } as Response);
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
    expect(device.status).toBe('UNAVAILABLE');
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({ username: TARGET.serverUrl, password: TARGET.token });
    await act(async () => { listener.mock.calls[0][1]('active'); });
    expect(device.status).toBe('PAIRED');
    expect(device.target).toEqual(TARGET);
    expect(device.storeError).toBeNull();
    expect(device.verify.kind).toBe('OK');
    expect(pairingWriteCount()).toBe(0);
    await act(async () => tree.unmount());
  });

  test('a delayed secure-storage retry cannot restore an explicitly removed pairing', async () => {
    const listener = jest.spyOn(AppState, 'addEventListener');
    (Keychain.getGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
    let finishRead!: (value: unknown) => void;
    (Keychain.getGenericPassword as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    await act(async () => { listener.mock.calls[0][1]('active'); });
    await act(async () => { await device.unpair(); });
    await act(async () => { finishRead({ username: TARGET.serverUrl, password: TARGET.token }); });
    expect(device.status).toBe('UNPAIRED');
    expect(device.target).toBeNull();
    expect(device.verify.kind).toBe('IDLE');
    await act(async () => tree.unmount());
  });

  test('a delayed bootstrap body cannot undo an authoritative auth rejection', async () => {
    let resolveBody!: (body: unknown) => void;
    const body = new Promise(resolve => { resolveBody = resolve; });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: () => body,
    } as Response);
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>);
    });
    let pending!: Promise<void>;
    await act(async () => { pending = device.pair(TARGET); });
    await act(async () => { device.markAuthenticationRejected(); });
    await act(async () => {
      resolveBody({ data: { bmsPosSession: {
        device: { id: 'device-1', code: 'POS-01' }, cashiers: [],
      } } });
      await expect(pending).rejects.toThrow('ถูกยกเลิก');
    });
    expect(device.verify.kind).toBe('REJECTED');
    expect(pairingWriteCount()).toBe(0);
    await act(async () => tree.unmount());
  });

  test.each(['different-device', 'different-server', 'legacy', 'read-error'])(
    'pairing rechecks cash queued during verification: %s', async scenario => {
      (loadOfflineSales as jest.Mock).mockResolvedValueOnce([]);
      if (scenario === 'read-error') {
        (loadOfflineSales as jest.Mock).mockRejectedValueOnce(new Error('queue unavailable'));
      } else {
        (loadOfflineSales as jest.Mock).mockResolvedValueOnce([{
          serverUrl: scenario === 'different-server' ? 'https://other.example.com' : TARGET.serverUrl,
          deviceId: scenario === 'legacy' ? null : scenario === 'different-device' ? 'device-2' : 'device-1',
        }]);
      }
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, status: 200, json: async () => ({ data: { bmsPosSession: {
          device: { id: 'device-1', code: 'POS-01' }, cashiers: [],
        } } }),
      } as Response);
      let device!: ReturnType<typeof useDevice>;
      function Probe() { device = useDevice(); return null; }
      let tree!: ReactTestRenderer.ReactTestRenderer;
      await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
      await act(async () => { await expect(device.pair(TARGET)).rejects.toThrow(); });
      expect(pairingWriteCount()).toBe(0);
      expect(device.status).toBe('UNPAIRED');
      await act(async () => tree.unmount());
    },
  );

  test('unpair rechecks unresolved cash and fails closed when the queue cannot be read', async () => {
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>);
    });
    (loadOfflineSales as jest.Mock).mockResolvedValueOnce([{ id: 'accepted-cash' }]);
    await expect(device.unpair()).rejects.toThrow('ออฟไลน์ค้าง');
    (loadOfflineSales as jest.Mock).mockRejectedValueOnce(new Error('Keychain unavailable'));
    await expect(device.unpair()).rejects.toThrow('Keychain unavailable');
    expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a delayed queue recheck cannot persist a pairing after authentication rejection', async () => {
    let finishRead!: (value: unknown) => void;
    (loadOfflineSales as jest.Mock).mockResolvedValueOnce([]).mockImplementationOnce(
      () => new Promise(resolve => { finishRead = resolve; }),
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: { bmsPosSession: {
        device: { id: 'device-1', code: 'POS-01' }, cashiers: [],
      } } }),
    } as Response);
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
    let pending!: Promise<void>;
    await act(async () => { pending = device.pair(TARGET); });
    await act(async () => { device.markAuthenticationRejected(); });
    await act(async () => {
      finishRead([]);
      await expect(pending).rejects.toThrow('ถูกยกเลิก');
    });
    expect(pairingWriteCount()).toBe(0);
    expect(device.verify.kind).toBe('REJECTED');
    await act(async () => tree.unmount());
  });

  test('pair and unpair cannot race an unfinished secure-storage write', async () => {
    let finishWrite!: (value: boolean) => void;
    (Keychain.setGenericPassword as jest.Mock).mockImplementation((_, __, options) =>
      options.service === 'com.bms.pos.device'
        ? new Promise(resolve => { finishWrite = resolve; }) : Promise.resolve(true),
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: { bmsPosSession: {
        device: { id: 'device-1', code: 'POS-01' }, cashiers: [],
      } } }),
    } as Response);
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
    let pending!: Promise<void>;
    await act(async () => { pending = device.pair(TARGET); });
    await expect(device.unpair()).rejects.toThrow('กำลังเปลี่ยนข้อมูลจับคู่');
    await expect(device.pair(TARGET)).rejects.toThrow('กำลังเปลี่ยนข้อมูลจับคู่');
    expect((Keychain.resetGenericPassword as jest.Mock).mock.calls.filter(
      ([options]) => options.service === 'com.bms.pos.device',
    )).toHaveLength(0);
    await act(async () => { finishWrite(true); await pending; });
    expect(device.target).toEqual(TARGET);
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
    await act(async () => { await device.unpair(); });
    expect(device.status).toBe('UNPAIRED');
    await act(async () => tree.unmount());
  });

  test('a rejection during a secure-storage write is rechecked instead of overwritten by old success', async () => {
    let finishWrite!: (value: boolean) => void;
    (Keychain.setGenericPassword as jest.Mock).mockImplementation((_, __, options) =>
      options.service === 'com.bms.pos.device'
        ? new Promise(resolve => { finishWrite = resolve; }) : Promise.resolve(true),
    );
    let revoked = false;
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: !revoked, status: revoked ? 401 : 200,
      json: async () => ({ data: { bmsPosSession: {
        device: { id: 'device-1', code: 'POS-01' }, cashiers: [],
      } } }),
    } as Response));
    let device!: ReturnType<typeof useDevice>;
    function Probe() { device = useDevice(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<DeviceProvider><Probe /></DeviceProvider>); });
    let pending!: Promise<void>;
    await act(async () => { pending = device.pair(TARGET); });
    await act(async () => { revoked = true; device.markAuthenticationRejected(); });
    await act(async () => {
      finishWrite(true);
      await expect(pending).rejects.toThrow('เซิร์ฟเวอร์ไม่รับ token');
    });
    expect(device.verify.kind).toBe('REJECTED');
    expect(device.target).toEqual(TARGET);
    expect(pairingWriteCount()).toBe(1);
    await act(async () => tree.unmount());
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
