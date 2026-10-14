import React from 'react';
import {
  Alert,
  Dimensions,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useQuery } from '@apollo/client';
import QRCode from 'react-native-qrcode-svg';
import { Button } from '../src/components/Button';
import { ReceiptPaper } from '../src/components/ReceiptPaper';
import { ReceiptDelivery } from '../src/components/ReceiptDelivery';
import ReceiptScreen from '../src/screens/sell/ReceiptScreen';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import type { MobilePosReceiptFieldsFragment } from '../src/graphql/generated';

const mockSendReceipt = jest.fn();
const mockPrinter = {
  state: { status: 'disconnected', message: 'ยังไม่ได้เชื่อมต่อเครื่องพิมพ์' },
  print: jest.fn(),
};
jest.mock('../src/state/PrinterContext', () => ({
  usePrinter: () => mockPrinter,
}));
jest.mock('../src/lib/captureReceipt', () => ({ captureReceipt: jest.fn() }));
jest.mock('@apollo/client', () => ({
  useQuery: jest.fn(),
  useMutation: () => [mockSendReceipt],
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({
    session: { credentials: { cashierUserId: 'cashier-test', pin: '000000' } },
  }),
}));
jest.mock('react-native-qrcode-svg', () => 'QRCode');

const receipt: MobilePosReceiptFieldsFragment = {
  orderId: 'test-order',
  receiptNo: 'TEST-0001',
  billNo: 'TEST-0001',
  taxRequestUrl: 'https://example.test/tax-request/test',
  soldAt: '2026-10-11T10:00:00Z',
  offlineTenderedAt: null,
  offlineSyncedAt: null,
  total: 107,
  orderStatus: 'COMPLETED',
  locationName: 'ร้านทดสอบ',
  branchCode: '00000',
  posLabel: 'POS-01',
  cashierName: 'แคชเชียร์ทดสอบ',
  memberName: null,
  memberNo: null,
  sourceChannel: 'POS',
  restaurantServiceMode: null,
  paymentMethod: 'CASH',
  paymentRef: null,
  cashTendered: 120,
  cashChange: 13,
  returnEligible: true,
  returnBlockedReason: null,
  voidedAt: null,
  roundingAmount: 0,
  lines: [
    {
      orderItemId: 1,
      sku: 'TEST',
      size: 'M',
      receiptName: 'สินค้าทดสอบ',
      packCode: 'PIECE',
      unitName: 'ชิ้น',
      packQty: 3,
      packPrice: 33.33,
      baseQty: 1,
      lineTotal: 100,
      refundablePackQty: 3,
      returnedPackQty: 0,
    },
  ],
  payments: [
    {
      id: 'payment',
      method: 'CASH',
      amount: 107,
      ref: null,
      cashTendered: 120,
      cashChange: 13,
    },
  ],
  refunds: [],
  returnEvents: [],
  discountLines: [{ label: 'ส่วนลดทดสอบ', amount: 3 }],
  extraLines: [{ label: 'ค่าบริการทดสอบ', qty: 1, unitAmount: 10, amount: 10 }],
  promotionNotes: ['โปรโมชันทดสอบ'],
  boardGameTimeNotes: [],
  vat: {
    rate: 7,
    taxableAmount: 107,
    exemptAmount: 0,
    netBeforeVat: 100,
    vatAmount: 7,
    roundingAmount: 0,
  },
};

let renderer: ReactTestRenderer.ReactTestRenderer;
let alertSpy: jest.SpyInstance;

async function render(node: React.ReactNode) {
  await act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 24, bottom: 24, left: 0, right: 0 },
        }}
      >
        <ThemeProvider>{node}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
}

function text() {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');
}

function button(label: string) {
  return renderer.root
    .findAllByType(Button)
    .find(node => node.props.label === label)!;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrinter.state.status = 'disconnected';
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockSendReceipt.mockResolvedValue({
    data: { bmsPosSendReceipt: { status: 'SENT' } },
  });
  jest.mocked(useQuery).mockReturnValue({
    data: { bmsPosRecentSales: { sales: [receipt] } },
    loading: false,
    refetch: jest.fn().mockResolvedValue({}),
  } as never);
});

afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  alertSpy.mockRestore();
});

test('reveals the focused recipient inside the resized keyboard viewport and removes its listener', async () => {
  const remove = jest.fn();
  const listener = jest
    .spyOn(Keyboard, 'addListener')
    .mockReturnValue({ remove });
  const visible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
  const metrics = jest.spyOn(Keyboard, 'metrics').mockReturnValue({
    screenX: 0,
    screenY: 420,
    width: 390,
    height: 424,
  });
  const input = {
    isFocused: jest.fn(() => true),
    measureLayout: jest.fn((_content, measured) => measured(0, 700, 300, 48)),
  };
  const content = {};
  const scroll = {
    measureInWindow: jest.fn(measured => measured(0, 120, 390, 700)),
    getInnerViewRef: jest.fn(() => content),
    scrollTo: jest.fn(),
  };
  try {
    await render(
      <ReceiptDelivery
        orderId="test-order"
        scrollRef={{
          current: scroll as unknown as React.ComponentRef<typeof ScrollView>,
        }}
      />,
    );
    Object.assign(renderer.root.findByType(TextInput).instance, input);
    const onShow = listener.mock.calls.find(
      ([event]) => event === 'keyboardDidShow',
    )![1];
    await act(() => {
      onShow({} as never);
    });
    expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 464, animated: true });
    scroll.scrollTo.mockClear();
    input.isFocused.mockReturnValue(false);
    await act(() => {
      onShow({} as never);
    });
    expect(scroll.scrollTo).not.toHaveBeenCalled();
    await act(() => renderer.unmount());
    expect(remove).toHaveBeenCalled();
  } finally {
    listener.mockRestore();
    visible.mockRestore();
    metrics.mockRestore();
  }
});

describe('Receipt paper', () => {
  test('uses returned line totals, VAT, discounts, charges and cash change without recomputing prices', async () => {
    await render(<ReceiptPaper receipt={receipt} />);
    expect(text()).toContain('TEST-0001');
    expect(text()).toContain('฿100.00');
    expect(text()).not.toContain('฿99.99');
    expect(text()).toContain('฿107.00');
    expect(text()).toContain('−฿3.00');
    expect(text()).toContain('ค่าบริการทดสอบ');
    expect(text()).toContain('VAT 7%');
    expect(text()).toContain('฿7.00');
    expect(text()).toContain('เงินทอน');
    expect(text()).toContain('฿13.00');
    expect(renderer.root.findByType(QRCode).props.value).toBe(
      receipt.taxRequestUrl,
    );
  });

  test('does not invent VAT, receipt numbers or a tax-request QR', async () => {
    await render(
      <ReceiptPaper
        receipt={{
          ...receipt,
          receiptNo: null,
          billNo: null,
          vat: null,
          taxRequestUrl: null,
        }}
      />,
    );
    expect(text()).toContain('เลขอ้างอิงรายการ test-order');
    expect(text()).not.toContain('VAT');
    expect(renderer.root.findAllByType(QRCode)).toHaveLength(0);
  });

  test.each(['void', 'return'])(
    'marks %s history and suppresses a stale tax QR',
    async kind => {
      await render(
        <ReceiptPaper
          receipt={{
            ...receipt,
            voidedAt: kind === 'void' ? receipt.soldAt : null,
            orderStatus: kind === 'return' ? 'RETURNED' : 'COMPLETED',
          }}
        />,
      );
      expect(text()).toContain(
        kind === 'void' ? 'ยกเลิกบิลแล้ว' : 'บิลนี้มีรายการคืนสินค้า',
      );
      expect(renderer.root.findAllByType(QRCode)).toHaveLength(0);
    },
  );

  test('keeps service-only and split-tender bills visible', async () => {
    await render(
      <ReceiptPaper
        receipt={{
          ...receipt,
          lines: [],
          extraLines: [
            { label: 'ค่าเวลาเล่น', qty: 1, unitAmount: 107, amount: 107 },
          ],
          discountLines: [],
          payments: [
            {
              ...receipt.payments[0],
              amount: 50,
              cashTendered: 60,
              cashChange: 10,
            },
            {
              id: 'card',
              method: 'CARD',
              amount: 57,
              cashTendered: null,
              cashChange: null,
              ref: null,
            },
          ],
        }}
      />,
    );
    expect(text()).toContain('ค่าเวลาเล่น');
    expect(text()).toContain('฿50.00');
    expect(text()).toContain('บัตร');
    expect(text()).toContain('฿57.00');
    expect(text()).toContain('฿10.00');
  });
});

describe('Receipt navigation and recovery', () => {
  const navigation = {
    goBack: jest.fn(),
    canGoBack: () => true,
    reset: jest.fn(),
    navigate: jest.fn(),
  };
  async function screen(
    params: Partial<
      React.ComponentProps<typeof ReceiptScreen>['route']['params']
    > = {},
  ) {
    await render(
      <ReceiptScreen
        navigation={navigation as never}
        route={{
          key: 'receipt',
          name: 'Receipt',
          params: { saleId: receipt.orderId, source: 'retail', ...params },
        }}
      />,
    );
  }

  // The test renderer never runs Yoga, so these pin the layout rule instead of pixels. RN's default
  // jest window (750x1334) already counts as a tablet, which is why every other test here passed
  // while Android 7"/10" tablets drew a dialog with a 0-height receipt pane.
  function withWindow(width: number, height: number) {
    return jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width, height, scale: 2, fontScale: 1 });
  }
  function byTestId(testID: string) {
    return renderer.root.findAll(node => node.props.testID === testID)[0];
  }
  function textIn(node: ReactTestRenderer.ReactTestInstance) {
    return node
      .findAllByType(Text)
      .map(child => child.props.children)
      .flat(Infinity)
      .join(' ');
  }

  test.each([
    ['7-inch tablet landscape', 1024, 600],
    ['10-inch tablet landscape', 1280, 800],
    ['10-inch tablet portrait', 800, 1280],
  ])(
    'keeps the receipt pane content-sized on a %s',
    async (_label, width, height) => {
      const dims = withWindow(width, height);
      try {
        await screen();
        const panes = byTestId('receipt-panes');
        expect(panes).toBeDefined();
        const style = StyleSheet.flatten(panes.props.style);
        // flex:1 means flexBasis 0, which collapses to 0px inside the maxHeight-only dialog.
        expect(style.flex).toBeUndefined();
        expect(style.flexBasis).toBeUndefined();
        expect(style.flexGrow ?? 0).toBe(0);
        expect(style.flexShrink).toBe(1);
        expect(panes.findAllByType(ReceiptPaper)).toHaveLength(1);
        const sidebar = byTestId('receipt-sidebar');
        expect(textIn(sidebar)).toContain('เลขที่ใบเสร็จ');
        // The 300px column cannot fit a UUID fallback unless the value may shrink and wrap.
        const receiptNo = sidebar
          .findAllByType(Text)
          .find(node => node.props.children === receipt.receiptNo)!;
        expect(StyleSheet.flatten(receiptNo.props.style).flexShrink).toBe(1);
        expect(
          sidebar
            .findAllByType(Button)
            .some(node => node.props.label === 'พิมพ์ใบเสร็จ'),
        ).toBe(true);
      } finally {
        dims.mockRestore();
      }
    },
  );

  test('keeps the phone receipt as one scroll under the paid summary', async () => {
    const dims = withWindow(390, 844);
    try {
      await screen();
      expect(byTestId('receipt-panes')).toBeUndefined();
      expect(renderer.root.findAllByType(ReceiptPaper)).toHaveLength(1);
      expect(text()).toContain('เลขที่ใบเสร็จ');
    } finally {
      dims.mockRestore();
    }
  });

  test('keeps the confirmed paper and delivery form mounted during background refresh', async () => {
    jest.mocked(useQuery).mockReturnValue({
      loading: true,
      data: { bmsPosRecentSales: { sales: [receipt] } },
      refetch: jest.fn(),
    } as never);
    await screen({ mode: 'preview' });
    expect(renderer.root.findAllByType(ReceiptPaper)).toHaveLength(1);
    expect(renderer.root.findAllByType(ReceiptDelivery)).toHaveLength(1);
  });

  test('disables print without a connection and opens printer setup', async () => {
    await screen();
    expect(button('พิมพ์ใบเสร็จ').props.disabled).toBe(true);
    expect(text()).toContain('ยังไม่ได้เชื่อมต่อเครื่องพิมพ์');
    await act(() => button('เชื่อมต่อเครื่องพิมพ์').props.onPress());
    expect(navigation.navigate).toHaveBeenCalledWith('PrinterSettings');
    await act(() => button('พิมพ์ใบเสร็จ').props.onPress());
    expect(mockPrinter.print).not.toHaveBeenCalled();
  });

  test('enables print only after paper layout and connection, and blocks duplicate taps', async () => {
    mockPrinter.state.status = 'ready';
    await screen();
    expect(button('พิมพ์ใบเสร็จ').props.disabled).toBe(true);
    await act(() =>
      renderer.root
        .findByProps({ testID: 'receipt-print-surface' })
        .props.onLayout({
          nativeEvent: { layout: { x: 0, y: 0, width: 350, height: 700 } },
        }),
    );
    expect(button('พิมพ์ใบเสร็จ').props.disabled).toBe(false);
    let finish!: () => void;
    mockPrinter.print.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve;
      }),
    );
    let job!: Promise<void>;
    await act(() => {
      job = button('พิมพ์ใบเสร็จ').props.onPress();
      button('พิมพ์ใบเสร็จ').props.onPress();
    });
    expect(mockPrinter.print).toHaveBeenCalledTimes(1);
    expect(button('พิมพ์ใบเสร็จ').props.disabled).toBe(true);
    await act(async () => {
      finish();
      await job;
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'ส่งงานพิมพ์แล้ว',
      expect.any(String),
    );
  });

  test('loads the requested order independently of the recent-sales cache and closes history preview with Back', async () => {
    await screen({ mode: 'preview' });
    expect(useQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        variables: { orderId: receipt.orderId },
        fetchPolicy: 'network-only',
      }),
    );
    expect(text()).toContain('ตัวอย่างใบเสร็จ');
    expect(text()).not.toContain('ขายสำเร็จ');
    await act(() => button('ปิดตัวอย่าง').props.onPress());
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(navigation.reset).not.toHaveBeenCalled();
  });

  test.each(['retail', 'restaurant', 'board_game'] as const)(
    'preserves the post-sale exit for %s',
    async source => {
      await screen({ source });
      const label =
        source === 'retail'
          ? 'ขายรายการใหม่'
          : source === 'restaurant'
          ? 'กลับผังโต๊ะ'
          : 'กลับรายละเอียดโต๊ะ';
      await act(() => button(label).props.onPress());
      if (source === 'board_game') expect(navigation.goBack).toHaveBeenCalled();
      else
        expect(navigation.reset).toHaveBeenCalledWith({
          index: 0,
          routes: [
            {
              name: 'Tabs',
              params: {
                screen: source === 'restaurant' ? 'FloorTab' : 'SellTab',
              },
            },
          ],
        });
    },
  );

  test('shows loading, errors, retry and missing data without another order leaking into the preview', async () => {
    const refetch = jest.fn().mockRejectedValue(new Error('offline'));
    jest.mocked(useQuery).mockReturnValue({ loading: true, refetch } as never);
    await screen();
    expect(text()).toContain('กำลังโหลดใบเสร็จ');
    expect(renderer.root.findAllByType(ReceiptPaper)).toHaveLength(0);
    await act(() => renderer.unmount());
    jest.mocked(useQuery).mockReturnValue({
      loading: false,
      error: new Error('offline'),
      data: { bmsPosRecentSales: { sales: [receipt] } },
      refetch,
    } as never);
    await screen();
    expect(text()).toContain('โหลดใบเสร็จไม่สำเร็จ');
    expect(renderer.root.findAllByType(ReceiptDelivery)).toHaveLength(0);
    await act(() => button('ลองใหม่').props.onPress());
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(() => renderer.unmount());
    jest.mocked(useQuery).mockReturnValue({
      loading: false,
      data: {
        bmsPosRecentSales: {
          sales: [{ ...receipt, orderId: 'different-order' }],
        },
      },
      refetch,
    } as never);
    await screen();
    expect(text()).toContain('ไม่พบใบเสร็จ');
    expect(renderer.root.findAllByType(ReceiptPaper)).toHaveLength(0);
  });
});

describe('Receipt delivery', () => {
  test('requires confirmation, allows cancellation and sends the reviewed email once', async () => {
    await render(<ReceiptDelivery orderId={receipt.orderId} />);
    await act(() =>
      renderer.root
        .findByType(TextInput)
        .props.onChangeText(' test@example.test '),
    );
    await act(() => button('ส่งอีเมล').props.onPress());
    expect(mockSendReceipt).not.toHaveBeenCalled();
    expect(alertSpy.mock.calls[0][1]).toContain('test@example.test');
    await act(() => alertSpy.mock.calls[0][2][0].onPress());
    expect(mockSendReceipt).not.toHaveBeenCalled();
    await act(() => {
      button('ส่งอีเมล').props.onPress();
      button('ส่งอีเมล').props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledTimes(2);
    await act(async () => alertSpy.mock.calls[1][2][1].onPress());
    expect(mockSendReceipt).toHaveBeenCalledTimes(1);
    expect(mockSendReceipt).toHaveBeenCalledWith({
      variables: {
        input: {
          orderId: receipt.orderId,
          channel: 'email',
          to: 'test@example.test',
          cashierUserId: 'cashier-test',
          pin: '000000',
        },
      },
    });
  });

  test('LINE uses the linked member and never forwards the email field', async () => {
    await render(<ReceiptDelivery orderId={receipt.orderId} />);
    await act(() =>
      renderer.root
        .findByType(TextInput)
        .props.onChangeText('test@example.test'),
    );
    await act(() => button('ส่ง LINE สมาชิก').props.onPress());
    await act(async () => alertSpy.mock.calls[0][2][1].onPress());
    expect(mockSendReceipt).toHaveBeenCalledWith({
      variables: {
        input: expect.objectContaining({ channel: 'line', to: null }),
      },
    });
  });

  test('rejects invalid email and reports server failures with an enabled retry', async () => {
    await render(<ReceiptDelivery orderId={receipt.orderId} />);
    await act(() =>
      renderer.root.findByType(TextInput).props.onChangeText('invalid'),
    );
    await act(() => button('ส่งอีเมล').props.onPress());
    expect(alertSpy.mock.calls[0][0]).toBe('อีเมลไม่ถูกต้อง');
    expect(mockSendReceipt).not.toHaveBeenCalled();
    await act(() => renderer.root.findByType(TextInput).props.onChangeText(''));
    mockSendReceipt.mockResolvedValueOnce({
      data: { bmsPosSendReceipt: { status: 'FAILED', reason: 'NO_RECIPIENT' } },
    });
    await act(() => button('ส่งอีเมล').props.onPress());
    await act(async () => alertSpy.mock.calls[1][2][1].onPress());
    expect(alertSpy).toHaveBeenLastCalledWith(
      'ส่งใบเสร็จไม่สำเร็จ',
      'NO_RECIPIENT',
    );
    expect(button('ส่งอีเมล').props.disabled).toBe(false);
  });

  test('disabled historical documents cannot be sent', async () => {
    await render(<ReceiptDelivery orderId={receipt.orderId} disabled />);
    await act(() => button('ส่งอีเมล').props.onPress());
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockSendReceipt).not.toHaveBeenCalled();
  });
});
