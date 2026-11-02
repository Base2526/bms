import React from 'react';
import { Alert, Modal, TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SaleDetailScreen from '../src/screens/sell/SaleDetailScreen';
import { Button } from '../src/components/Button';
import { QtyStepper } from '../src/components/QtyStepper';
import { ThemeProvider } from '../src/theme/ThemeProvider';

const mockReturn = jest.fn();
const mockVoid = jest.fn();
const mockRefresh = jest.fn();
const mockReplace = jest.fn();
const mockResolve = jest.fn();
const mockSale = {
  id: 'sale', receiptNo: 'TEST-1', createdAt: '2026-11-02T00:00:00Z', total: 100,
  returnEligible: true, voided: false, returns: [],
  payments: [{ id: 'payment', method: 'cash', amount: 100 }],
  lines: [{ orderItemId: 1, sku: 'SKU', name: 'Product', qty: 2, unitPrice: 50,
    refundablePackQty: 2, size: 'BASE', packCode: 'BASE', baseQty: 1, unitName: 'piece' }],
};
jest.mock('@apollo/client', () => ({
  useMutation: (document: any) => [document.definitions[0].name.value === 'MobilePosVoid' ? mockVoid : mockReturn],
  useLazyQuery: () => [jest.fn()],
  useQuery: () => ({ data: { bmsPosSession: { approvers: [{ id: 'manager', name: 'Manager', hasPin: true, approvals: ['pos.void'] }] } } }),
}));
jest.mock('../src/state/SalesContext', () => ({ useSales: () => ({ findSale: () => mockSale, refresh: mockRefresh, loading: false }) }));
jest.mock('../src/state/CartContext', () => ({ useCart: () => ({ lines: [], replaceForExchange: mockReplace }) }));
jest.mock('../src/state/CatalogContext', () => ({ useCatalog: () => ({ resolveVariant: mockResolve }) }));
jest.mock('../src/state/SessionContext', () => ({ useSession: () => ({ session: {
  cashier: { id: 'cashier' }, credentials: { cashierUserId: 'cashier', pin: '1234' },
} }) }));
jest.mock('../src/components/ReceiptDelivery', () => ({ ReceiptDelivery: () => null }));

let renderer: ReactTestRenderer.ReactTestRenderer;
const navigation = { goBack: jest.fn(), navigate: jest.fn(), popToTop: jest.fn() };
const button = (label: string) => renderer.root.findAllByType(Button).find(node => node.props.label === label)!;
const input = (placeholder: string) => renderer.root.findAllByType(TextInput).find(node => node.props.placeholder === placeholder)!;

beforeEach(async () => {
  jest.clearAllMocks();
  mockRefresh.mockResolvedValue(undefined);
  mockResolve.mockRejectedValue(new Error('offline catalog'));
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    buttons?.find(item => item.text === 'ยืนยัน')?.onPress?.();
  });
  await act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
        <ThemeProvider><SaleDetailScreen route={{ params: { saleId: 'sale' } } as any} navigation={navigation as any} /></ThemeProvider>
      </SafeAreaProvider>,
    );
  });
});
afterEach(async () => { await act(() => renderer.unmount()); jest.restoreAllMocks(); });

async function openAction(label: string) {
  await act(() => button(label).props.onPress());
  await act(() => input('เหตุผล').props.onChangeText('Stock check'));
  if (label === 'คืนบางรายการ' || label === 'เปลี่ยนสินค้า') {
    await act(() => renderer.root.findByType(QtyStepper).props.onIncrement());
  }
}

test.each([
  ['คืนทั้งบิล', 'FULL', 'RETURNED'],
  ['คืนบางรายการ', 'PARTIAL', 'PARTIAL_RETURNED'],
  ['เปลี่ยนสินค้า', 'PARTIAL', 'PARTIAL_RETURNED'],
])('%s accepts the server success status and refreshes once', async (label, mode, status) => {
  mockReturn.mockResolvedValue({ data: { bmsPosReturn: { status, refundAmount: 50,
    returnedItems: [{ orderItemId: 1, packQty: 1, refundAmount: 50 }] } } });
  await openAction(label);
  await act(async () => { await button(label === 'เปลี่ยนสินค้า' ? 'รับคืนและเปิดบิลใหม่' : 'ยืนยัน').props.onPress(); });
  expect(mockReturn).toHaveBeenCalledTimes(1);
  expect(mockReturn.mock.calls[0][0].variables.input.mode).toBe(mode);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(Modal).props.visible).toBe(false);
  if (label === 'เปลี่ยนสินค้า') {
    expect(mockReplace).toHaveBeenCalledWith([expect.objectContaining({ sku: 'SKU', qty: 1 })], null);
    expect(navigation.popToTop).toHaveBeenCalledTimes(1);
  } else expect(Alert.alert).toHaveBeenCalledWith('คืนสินค้าสำเร็จ', expect.any(String));
});

test('VOIDED closes the void action after an approved mutation', async () => {
  mockVoid.mockResolvedValue({ data: { bmsPosVoid: { status: 'VOIDED', refundAmount: 100 } } });
  await openAction('Void ทั้งบิล');
  await act(() => button('Manager').props.onPress());
  await act(() => input('PIN ผู้อนุมัติ').props.onChangeText('5678'));
  await act(async () => { await button('ยืนยัน').props.onPress(); });
  expect(mockVoid).toHaveBeenCalledTimes(1);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledWith('Void สำเร็จ', expect.any(String));
  expect(renderer.root.findByType(Modal).props.visible).toBe(false);
});

test('stock rejection keeps the return form open and displays the server reason', async () => {
  mockReturn.mockResolvedValue({ data: { bmsPosReturn: { status: 'STOCK_REVIEW_REQUIRED', reason: 'Reconcile lot quantities' } } });
  await openAction('คืนบางรายการ');
  await act(async () => { await button('ยืนยัน').props.onPress(); });
  expect(Alert.alert).toHaveBeenCalledWith('คืนสินค้าไม่สำเร็จ', 'Reconcile lot quantities');
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(renderer.root.findByType(Modal).props.visible).toBe(true);
});
