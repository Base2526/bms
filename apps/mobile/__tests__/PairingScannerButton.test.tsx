import React from 'react';
import { Alert, Platform } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { PairingScannerButton } from '../src/components/PairingScannerButton';
import { Button } from '../src/components/Button';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { buildPairingQr } from '../../../packages/pos-client-core/src/pairingQr';
import type { PairingTarget } from '../src/lib/pairing';

let mockBlur: (() => void) | undefined;
let mockFocus: (() => () => void) | undefined;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => () => void) => {
    require('react').useEffect(() => {
      mockFocus = callback;
      mockBlur = callback();
      return mockBlur;
    }, [callback]);
  },
}));
const mockScan = jest.fn();
jest.mock('react-native-data-scanner', () => ({
  DataScanner: { scanBarcode: (...args: unknown[]) => mockScan(...args) },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const target = {
  serverUrl: 'https://shop.example.test',
  token: `pos_${'a'.repeat(43)}`,
};
const old = { ...target, token: `pos_${'b'.repeat(43)}` };
let alert: jest.SpyInstance;
const originalOS = Platform.OS;
beforeEach(() => {
  mockScan.mockReset().mockResolvedValue({ value: buildPairingQr(target) });
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  alert.mockRestore();
  Platform.OS = originalOS;
});

async function mount(previous: PairingTarget | null = null) {
  let props = {
    target: previous,
    disabled: false,
    pair: jest.fn().mockResolvedValue(undefined),
    onPaired: jest.fn(),
    onBusyChange: jest.fn(),
  };
  let tree!: Renderer.ReactTestRenderer;
  const element = () => (
    <ThemeProvider>
      <PairingScannerButton {...props} />
    </ThemeProvider>
  );
  await act(async () => {
    tree = Renderer.create(element());
  });
  return {
    props,
    busy: () => tree.root.findByType(Button).props.loading,
    press: async (twice = false) =>
      act(async () => {
        const press = tree.root.findByType(Button).props.onPress;
        press();
        if (twice) press();
      }),
    update: async (next: Partial<typeof props>) =>
      act(async () => {
        props = { ...props, ...next };
        tree.update(element());
      }),
    unmount: async () => act(async () => tree.unmount()),
  };
}

test.each(['ios', 'android'] as const)(
  '%s scans QR only and verifies/saves automatically once',
  async os => {
    Platform.OS = os;
    const h = await mount();
    await h.press(true);
    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(mockScan.mock.calls[0][0].targetFormats).toEqual(['qr']);
    expect(h.props.pair).toHaveBeenCalledWith(target);
    expect(h.props.pair).toHaveBeenCalledTimes(1);
    expect(h.props.onPaired).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(alert.mock.calls)).not.toContain(target.token);
    await h.unmount();
  },
);

test.each([false, true])(
  'replacement requires confirmation: %s',
  async confirm => {
    const h = await mount(old);
    await h.press();
    expect(h.props.pair).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2];
    await act(async () => buttons[confirm ? 1 : 0].onPress());
    expect(h.props.pair).toHaveBeenCalledTimes(confirm ? 1 : 0);
    expect(JSON.stringify(alert.mock.calls)).not.toContain(old.token);
    await h.unmount();
  },
);

test('same credential is verified without a replacement prompt', async () => {
  const h = await mount(target);
  await h.press();
  expect(h.props.pair).toHaveBeenCalledWith(target);
  expect(alert.mock.calls.map(c => c[0])).toEqual(['จับคู่สำเร็จ']);
  await h.unmount();
});

test.each(['unmount', 'blur', 'target', 'disabled'])(
  'late camera result is ignored after %s',
  async event => {
    let finish!: (result: { value: string }) => void;
    mockScan.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    const h = await mount();
    await h.press();
    if (event === 'unmount') await h.unmount();
    if (event === 'blur') mockBlur!();
    if (event === 'target') await h.update({ target: old });
    if (event === 'disabled') await h.update({ disabled: true });
    await act(async () => finish({ value: buildPairingQr(target)! }));
    expect(h.props.pair).not.toHaveBeenCalled();
    if (event !== 'unmount') await h.unmount();
  },
);

test('confirmation from an old screen cannot replace a changed target', async () => {
  const h = await mount(old);
  await h.press();
  const confirm = alert.mock.calls[0][2][1].onPress;
  await h.update({ target: null });
  await act(async () => confirm());
  expect(h.props.pair).not.toHaveBeenCalled();
  await h.unmount();
});

test('leaving a pending confirmation releases the action without waiting for the native alert callback', async () => {
  const h = await mount(old);
  await h.press();
  const staleConfirm = alert.mock.calls[0][2][1].onPress;
  expect(h.busy()).toBe(true);
  await act(async () => {
    mockBlur!();
  });
  expect(h.busy()).toBe(false);
  expect(h.props.onBusyChange).toHaveBeenLastCalledWith(false);
  await act(async () => {
    mockBlur = mockFocus!();
  });
  await h.press();
  expect(mockScan).toHaveBeenCalledTimes(2);
  await act(async () => staleConfirm());
  expect(h.props.pair).not.toHaveBeenCalled();
  expect(h.busy()).toBe(true);
  await act(async () => alert.mock.calls[1][2][1].onPress());
  expect(h.props.pair).toHaveBeenCalledTimes(1);
  expect(h.busy()).toBe(false);
  await h.unmount();
});

test.each(['target', 'disabled'])(
  'a %s change and reversal still invalidates the pending camera result',
  async change => {
    let finish!: (result: { value: string }) => void;
    mockScan.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    const h = await mount(old);
    await h.press();
    if (change === 'target') {
      await h.update({ target });
      await h.update({ target: old });
    } else {
      await h.update({ disabled: true });
      await h.update({ disabled: false });
    }
    await act(async () => finish({ value: buildPairingQr(target)! }));
    expect(alert).not.toHaveBeenCalled();
    expect(h.props.pair).not.toHaveBeenCalled();
    expect(h.busy()).toBe(false);
    await h.unmount();
  },
);

test('unmount releases the parent busy state once; a late camera result cannot change it again', async () => {
  let finish!: (result: { value: string }) => void;
  mockScan.mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const h = await mount();
  await h.press();
  h.props.onBusyChange.mockClear();
  await h.unmount();
  expect(h.props.onBusyChange.mock.calls).toEqual([[false]]);
  await act(async () => finish({ value: buildPairingQr(target)! }));
  expect(h.props.onBusyChange.mock.calls).toEqual([[false]]);
  expect(h.props.pair).not.toHaveBeenCalled();
});

test.each(['invalid', 'cancel', 'unavailable', 'pair failure'])(
  '%s preserves pairing and never reports success',
  async reason => {
    const h = await mount();
    if (reason === 'invalid')
      mockScan.mockResolvedValue({ value: target.token });
    if (reason === 'cancel')
      mockScan.mockRejectedValue(new Error('Scanner cancelled'));
    if (reason === 'unavailable')
      mockScan.mockRejectedValue(
        new Error(`Native module unavailable ${target.token}`),
      );
    if (reason === 'pair failure')
      h.props.pair.mockRejectedValue(
        new Error(`Pending offline cash ${target.token}`),
      );
    await h.press();
    expect(h.props.onPaired).not.toHaveBeenCalled();
    expect(h.props.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(h.props.pair).toHaveBeenCalledTimes(
      reason === 'pair failure' ? 1 : 0,
    );
    expect(JSON.stringify(alert.mock.calls)).not.toContain(target.token);
    if (reason === 'cancel') expect(alert).not.toHaveBeenCalled();
    await h.unmount();
  },
);
