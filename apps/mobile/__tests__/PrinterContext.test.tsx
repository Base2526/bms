import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { NetworkPrinter } from '../src/lib/networkPrinter';
import { PrinterProvider, usePrinter } from '../src/state/PrinterContext';

jest.mock('react-native-tcp-socket', () => ({ Socket: jest.fn() }));
jest.mock('../src/state/DeviceContext', () => ({
  useDevice: () => ({ target: null }),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

const config = { host: '192.168.1.10', port: 9100, paperWidth: 80 as const };
let value: ReturnType<typeof usePrinter>;
let tree: ReactTestRenderer.ReactTestRenderer;
function Probe() {
  value = usePrinter();
  return null;
}
async function mount() {
  await act(async () => {
    tree = ReactTestRenderer.create(
      <PrinterProvider>
        <Probe />
      </PrinterProvider>,
    );
  });
}
beforeEach(() => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
  jest.mocked(Keychain.setGenericPassword).mockResolvedValue(false);
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test('loads only printer preferences and never connects automatically', async () => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue({
    username: 'printer',
    password: JSON.stringify(config),
    service: 'printer',
    storage: 'KeystoreAESGCM_NoAuth' as Keychain.STORAGE_TYPE,
  });
  const connect = jest
    .spyOn(NetworkPrinter.prototype, 'connect')
    .mockResolvedValue();
  await mount();
  expect(value.saved).toEqual(config);
  expect(value.state.status).toBe('disconnected');
  expect(connect).not.toHaveBeenCalled();
});

test('a preference write failure does not fail a successful connection', async () => {
  jest.spyOn(NetworkPrinter.prototype, 'connect').mockResolvedValue();
  jest
    .mocked(Keychain.setGenericPassword)
    .mockRejectedValue(new Error('keystore unavailable'));
  await mount();
  await act(async () => {
    await value.connect(config);
  });
  expect(value.saved).toEqual(config);
  expect(value.storageWarning).toContain('บันทึกค่าลงเครื่องไม่ได้');
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    'printer',
    JSON.stringify(config),
    expect.objectContaining({ service: 'com.bms.pos.network-printer.v1' }),
  );
});

test('failed connection does not save preferences', async () => {
  jest
    .spyOn(NetworkPrinter.prototype, 'connect')
    .mockRejectedValue(new Error('offline'));
  await mount();
  await act(async () => {
    await expect(value.connect(config)).rejects.toThrow('offline');
  });
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
});

test('backgrounding disconnects and returning never reconnects', async () => {
  let changed: (state: 'background' | 'active') => void = () => {};
  const remove = jest.fn();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      changed = callback;
      return { remove };
    });
  const connect = jest
    .spyOn(NetworkPrinter.prototype, 'connect')
    .mockResolvedValue();
  await mount();
  await act(async () => changed('background'));
  expect(value.state.message).toContain('แอปพักการเชื่อมต่อ');
  expect(value.state.status).toBe('disconnected');
  await act(async () => changed('active'));
  expect(connect).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
  expect(remove).toHaveBeenCalled();
});
