import React from 'react';
import { Platform, TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { BarcodeScannerModal } from '../src/components/BarcodeScannerModal';
import { Button } from '../src/components/Button';
import { ThemeProvider } from '../src/theme/ThemeProvider';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/lib/scannerPreference', () => ({
  loadScannerInputMode: jest.fn().mockResolvedValue('hardware'),
  saveScannerInputMode: jest.fn().mockResolvedValue(undefined),
}));

const originalOS = Platform.OS;
afterEach(() => {
  Platform.OS = originalOS;
});

async function mount(purpose: 'lookup' | 'sale') {
  const resolveCode = jest
    .fn()
    .mockResolvedValue({ name: 'FAKE item', sellable: true });
  const onScanned = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeProvider>
        <BarcodeScannerModal
          purpose={purpose}
          visible
          onCancel={jest.fn()}
          resolveCode={resolveCode}
          onScanned={onScanned}
          completedHardwareScan={null}
        />
      </ThemeProvider>,
    );
  });
  const submit = async (code: string) => {
    await ReactTestRenderer.act(() =>
      renderer.root.findByType(TextInput).props.onChangeText(code),
    );
    const button = renderer.root
      .findAllByType(Button)
      .find(
        node =>
          node.props.label ===
          (purpose === 'lookup' ? 'ค้นหาสต็อกจากรหัส' : 'เพิ่มสินค้าจากรหัส'),
      );
    expect(button).toBeDefined();
    await ReactTestRenderer.act(async () => {
      button!.props.onPress();
    });
  };
  const unmount = () => ReactTestRenderer.act(() => renderer.unmount());
  return { renderer, submit, resolveCode, onScanned, unmount };
}

test.each(['ios', 'android'] as const)(
  '%s stock lookup scans without presenting an add-to-sale action',
  async os => {
    Platform.OS = os;
    const h = await mount('lookup');
    expect(JSON.stringify(h.renderer.toJSON())).not.toContain(
      'เพิ่มสินค้าจากรหัส',
    );
    await h.submit('FAKE-001');
    expect(h.resolveCode).toHaveBeenCalledWith('FAKE-001');
    expect(h.onScanned).toHaveBeenCalledWith(
      { name: 'FAKE item', sellable: true },
      'hardware',
    );
    await h.unmount();
  },
);

test.each(['ios', 'android'] as const)(
  '%s rejects Thai HID input with platform-appropriate recovery guidance',
  async os => {
    Platform.OS = os;
    const h = await mount('lookup');
    await h.submit('ทดสอบ');
    expect(h.resolveCode).not.toHaveBeenCalled();
    expect(h.onScanned).not.toHaveBeenCalled();
    const text = JSON.stringify(h.renderer.toJSON());
    expect(text).toContain('English (US)');
    if (os === 'android') expect(text).not.toContain('ทั่วไป > คีย์บอร์ด');
    else expect(text).toContain('ทั่วไป > คีย์บอร์ด');
    await h.unmount();
  },
);

test('sale callers retain their existing scan action', async () => {
  const h = await mount('sale');
  await h.submit('FAKE-002');
  expect(h.onScanned).toHaveBeenCalledTimes(1);
  await h.unmount();
});

test.each([
  ['ios', 'sale'], ['ios', 'lookup'], ['android', 'sale'], ['android', 'lookup'],
] as const)('%s %s rejects pairing credentials before product resolution and clears the input', async (os, purpose) => {
  Platform.OS = os;
  const token = `pos_${'a'.repeat(43)}`;
  const h = await mount(purpose);
  for (const code of [token, `bmspos://pair?t=${token}&h=https%3A%2F%2Fshop.example.test`, `bmspos://pair?t=${token}`, `https://shop.example.test/pos?t=${token}`]) {
    await h.submit(code);
    expect(h.resolveCode).not.toHaveBeenCalled();
    expect(h.onScanned).not.toHaveBeenCalled();
    const rendered = JSON.stringify(h.renderer.toJSON());
    expect(rendered).toContain('ตั้งค่าเครื่อง');
    expect(rendered).not.toContain(token);
  }
  await h.submit('FAKE-003');
  expect(h.resolveCode).toHaveBeenCalledWith('FAKE-003');
  await h.submit('pos_ordinary_product');
  expect(h.resolveCode).toHaveBeenCalledWith('pos_ordinary_product');
  await h.unmount();
});
