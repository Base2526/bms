import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import { DeviceProvider, useDevice } from '../src/state/DeviceContext';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

const TARGET = {
  serverUrl: 'https://shop.example.com',
  token: `pos_${'a'.repeat(32)}`,
};

describe('DeviceProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('verifies the newly paired target instead of the previous React state', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          device: { code: 'POS-01', name: 'Front' },
          location: { name: 'Main', branchCode: 'MAIN' },
          surface: 'restaurant',
          businessArchetype: 'restaurant',
          shift: { id: 'shift-1' },
          cashiers: [{ id: 'cashier-1' }],
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
      'https://shop.example.com/api/pos/session',
      expect.objectContaining({
        headers: { 'x-pos-device-token': TARGET.token },
      }),
    );
    expect(device!.verify).toEqual({
      kind: 'OK',
      info: {
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
});
