import React from 'react';
import { TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { PurchaseReceiving } from '../src/screens/operations/PurchaseReceiving';
import { Button } from '../src/components/Button';
import { ThemeProvider } from '../src/theme/ThemeProvider';

const mockReceive = jest.fn(),
  mockRefresh = jest.fn();
let mockSaved: any = null;
const mockSave = jest.fn(async (_scope: string, value: any) => {
  mockSaved = JSON.parse(JSON.stringify(value));
});
const mockClear = jest.fn(async () => {
  mockSaved = null;
});
jest.mock('@apollo/client', () => ({ useMutation: () => [mockReceive] }));
jest.mock('../src/state/DeviceContext', () => ({
  useDevice: () => ({ target: { serverUrl: 'https://shop.example' } }),
}));
jest.mock('../src/lib/pendingPurchaseReceipt', () => ({
  purchaseReceiptScope: (server: string, device: string) => server + device,
  loadPendingPurchaseReceipt: async () => mockSaved,
  savePendingPurchaseReceipt: (...args: any[]) =>
    mockSave(...(args as [string, any])),
  clearPendingPurchaseReceipt: () => mockClear(),
}));
const session: any = {
  deviceId: 'device',
  branch: { id: 'branch' },
  cashier: { id: 'cashier' },
  credentials: { cashierUserId: 'cashier', pin: '1234' },
};
const order: any = {
  id: 'po',
  status: 'OPEN',
  qtyReceived: 0,
  qtyOrdered: 3,
  supplier: { name: 'Supplier' },
  items: [{ sku: 'SKU', size: 'BASE', qtyOrdered: 3, qtyReceived: 0 }],
};
let tree: Renderer.ReactTestRenderer;
let props: any;
const render = () => (
  <ThemeProvider>
    <PurchaseReceiving {...props} />
  </ThemeProvider>
);
const button = (label: string) =>
  tree.root.findAllByType(Button).find(n => n.props.label === label)!;
const press = async (label: string) => {
  await act(async () => {
    await button(label).props.onPress();
  });
};
const text = () => JSON.stringify(tree.toJSON());
const confirm = 'ยืนยันรับสินค้าตามจำนวนที่ระบุ',
  retry = 'ตรวจรายการเดิมอีกครั้ง',
  reload = 'โหลดใบสั่งซื้อค้างรับใหม่';
beforeEach(async () => {
  jest.clearAllMocks();
  mockSaved = null;
  mockRefresh.mockResolvedValue({});
  props = { session, orders: [order], refresh: mockRefresh, loading: false };
  await act(async () => {
    tree = Renderer.create(render());
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
});
test('receipt forwards entered quantity and lot evidence and shows plain status', async () => {
  mockReceive.mockResolvedValue({
    data: { bmsPosReceivePurchase: { status: 'PARTIAL' } },
  });
  for (const [label, value] of [
    ['จำนวนรับ SKU BASE', '1'],
    ['เลขล็อต SKU BASE', 'LOT-A'],
    ['วันหมดอายุ SKU BASE', '2027-01-01'],
  ]) {
    await act(async () =>
      tree.root
        .findAllByType(TextInput)
        .find(n => n.props.accessibilityLabel === label)!
        .props.onChangeText(value),
    );
  }
  expect(text()).toContain('รอรับของ');
  expect(text()).not.toContain('· OPEN');
  await press(confirm);
  expect(mockReceive.mock.calls[0][0].variables.input.items).toEqual([
    {
      sku: 'SKU',
      size: 'BASE',
      qty: 1,
      lotNo: 'LOT-A',
      expiryDate: '2027-01-01',
    },
  ]);
  expect(mockSaved).toBeNull();
  expect(text()).toContain('บันทึกรับสินค้าแล้ว');
});
test('lost response survives remount, changed PO and auth rejection with the original payload/key', async () => {
  mockReceive.mockRejectedValue(new Error('network'));
  await press(confirm);
  const original = mockReceive.mock.calls[0][0].variables;
  expect(mockSaved).not.toHaveProperty('pin');
  await act(async () => tree.unmount());
  props.orders = [];
  await act(async () => {
    tree = Renderer.create(render());
  });
  mockReceive.mockRejectedValue({
    graphQLErrors: [{ extensions: { code: 'FORBIDDEN' } }],
  });
  await press(retry);
  expect(mockClear).not.toHaveBeenCalled();
  mockReceive.mockResolvedValue({
    data: { bmsPosReceivePurchase: { status: 'PARTIAL' } },
  });
  mockRefresh.mockRejectedValueOnce(new Error('read failed'));
  await press(retry);
  expect(mockReceive.mock.calls.map(c => c[0].variables)).toEqual([
    original,
    original,
    original,
  ]);
  expect(text()).toContain('บันทึกรับสินค้าแล้ว แต่โหลดข้อมูลล่าสุดไม่ได้');
  await act(async () => {
    props.orders = [order];
    tree.update(render());
  });
  expect(button(confirm).props.disabled).toBe(true);
  await press(reload);
  expect(button(confirm).props.disabled).toBe(false);
});
test('two taps before rendering issue one request', async () => {
  let finish: any;
  mockReceive.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const tap = button(confirm).props.onPress;
  let first: any, second: any;
  await act(async () => {
    first = tap();
    second = tap();
  });
  expect(mockReceive).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ data: { bmsPosReceivePurchase: { status: 'RECEIVED' } } });
    await Promise.all([first, second]);
  });
});
test('storage failure cannot send stock mutation', async () => {
  mockSave.mockRejectedValueOnce(new Error('locked'));
  await press(confirm);
  expect(mockReceive).not.toHaveBeenCalled();
  expect(button(confirm).props.disabled).toBe(true);
});
test('rejected receipt explains backend reason and requires fresh progress before editing', async () => {
  mockReceive.mockResolvedValue({
    data: {
      bmsPosReceivePurchase: {
        status: 'INVALID_INPUT',
        message: 'ต้องระบุเลขล็อต',
      },
    },
  });
  await press(confirm);
  expect(mockSaved).toBeNull();
  expect(text()).toContain('ต้องระบุเลขล็อต');
  expect(button(confirm).props.disabled).toBe(true);
  await press(reload);
  expect(button(confirm).props.disabled).toBe(false);
});
test('an unresolved receipt stays bound to its original cashier', async () => {
  mockReceive.mockRejectedValue(new Error('offline'));
  await press(confirm);
  mockReceive.mockClear();
  await act(async () => {
    props.session = {
      ...session,
      credentials: { cashierUserId: 'other', pin: '2222' },
    };
    tree.update(render());
  });
  await press(retry);
  expect(mockReceive).not.toHaveBeenCalled();
  expect(mockSaved).not.toBeNull();
  expect(text()).toContain('ผู้รับและสาขาเดิม');
});
