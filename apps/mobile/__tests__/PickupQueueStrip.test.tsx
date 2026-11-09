import React from 'react';
import { Alert, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PickupQueueRetryBanner, PickupQueueStrip } from '../src/components/PickupQueueStrip';
import { ThemeProvider } from '../src/theme/ThemeProvider';

const mockMutate = jest.fn(async () => ({ data: {} }));
const mockRefetch = jest.fn(async () => ({}));
let mockRows: Array<Record<string, unknown>> = [];
let mockLoading = false;
let mockError: Error | null = null;
jest.mock('@apollo/client', () => ({
  useQuery: () => ({
    data: mockLoading ? undefined : { bmsPosPickupQueue: mockRows },
    loading: mockLoading,
    error: mockError,
    refetch: mockRefetch,
  }),
  useMutation: () => [mockMutate],
}));
jest.mock('../src/lib/pickupQueuePreference', () => ({ usePickupQueueEnabled: () => true }));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({ session: { credentials: { cashierUserId: 'FAKE-cashier', pin: '0000' } } }),
}));

let renderer: ReactTestRenderer.ReactTestRenderer;
async function render(node: React.ReactNode) {
  await act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
        <ThemeProvider>{node}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
}
const text = () => renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join('')).join(' ');
const press = async (label: string) => {
  const target = renderer.root.findAll(node => node.props.accessibilityLabel === label || (node.props.onPress && [node.props.children].flat().join('').includes(label)))[0]
    ?? renderer.root.findAll(node => typeof node.props.onPress === 'function' && node.findAllByType(Text).some(t => [t.props.children].flat().join('').includes(label)))[0];
  await act(async () => { await target.props.onPress(); });
};

const row = (id: string, label: string, status: string) => ({ id, label, status, readySource: null, createdAt: '2026-11-08T05:00:00Z', readyAt: null, calledAt: null });

beforeEach(() => {
  mockRows = [];
  mockLoading = false;
  mockError = null;
  mockMutate.mockClear();
  mockMutate.mockResolvedValue({ data: {} });
  mockRefetch.mockClear();
  mockRefetch.mockResolvedValue({});
});

test('a ready number offers recall, collect, undo and a confirmed cancel', async () => {
  mockRows = [row('p1', '041', 'PREPARING'), row('r1', '039', 'READY')];
  await render(<PickupQueueStrip />);
  expect(text()).toContain('กำลังเตรียม 1');
  await press('คิว 039 พร้อมรับ');
  expect(text()).toContain('เรียกซ้ำ 039');
  expect(text()).toContain('ย้อน');
  await press('เรียกซ้ำ 039');
  expect(mockMutate).toHaveBeenLastCalledWith({ variables: { input: expect.objectContaining({ action: 'call', entryId: 'r1', orderId: null }) } });

  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await press('คิว 039 พร้อมรับ');
  await press('ยกเลิกคิว');
  expect(mockMutate).toHaveBeenCalledTimes(1);
  const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { await buttons.find(b => b.text === 'ยืนยันยกเลิก')!.onPress!(); });
  expect(mockMutate).toHaveBeenLastCalledWith({ variables: { input: expect.objectContaining({ action: 'cancel', entryId: 'r1' }) } });
  alert.mockRestore();
});

test('a preparing number has no undo; the strip stays visible when empty', async () => {
  mockRows = [row('p1', '041', 'PREPARING')];
  await render(<PickupQueueStrip />);
  await press('คิว 041 กำลังเตรียม');
  expect(text()).toContain('เรียกคิว 041');
  expect(text()).not.toContain('ย้อน');
  mockRows = [];
  await render(<PickupQueueStrip />);
  expect(text()).toContain('ยังไม่มีคิวที่รออยู่');
});

test('a failed queue read is never presented as an empty queue and pauses stale actions', async () => {
  mockRows = [row('r1', '039', 'READY')];
  mockError = new Error('HTTP 502');
  await render(<PickupQueueStrip />);
  expect(text()).toContain('ตรวจสถานะล่าสุดไม่ได้');
  expect(text()).not.toContain('ยังไม่มีคิวที่รออยู่');
  expect(text()).toContain('ปุ่มจัดการคิวถูกพักไว้');
  expect(
    renderer.root.findByProps({ accessibilityLabel: 'คิว 039 พร้อมรับ' }).props
      .accessibilityState,
  ).toEqual(expect.objectContaining({ disabled: true }));
  await press('ลองโหลดคิวใหม่');
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});

test('a committed queue action stays successful when its follow-up refresh fails', async () => {
  mockRows = [row('r1', '039', 'READY')];
  mockRefetch.mockRejectedValueOnce(new Error('offline'));
  await render(<PickupQueueStrip />);
  await press('คิว 039 พร้อมรับ');
  await press('เรียกซ้ำ 039');
  expect(mockMutate).toHaveBeenCalledTimes(1);
  expect(text()).toContain('เรียกคิว 039 แล้ว');
  expect(text()).toContain('โหลดสถานะล่าสุดไม่สำเร็จ');
  expect(text()).not.toContain('ทำรายการคิวไม่สำเร็จ');
});

test('the receipt retry asks the server to issue for the same bill', async () => {
  const onIssued = jest.fn();
  await render(<PickupQueueRetryBanner orderId="FAKE-order" reason="ออกเลขคิวไม่สำเร็จ" onIssued={onIssued} />);
  await press('ออกเลขคิวใหม่');
  expect(mockMutate).toHaveBeenLastCalledWith({ variables: { input: expect.objectContaining({ action: 'issue', orderId: 'FAKE-order', entryId: null }) } });
  expect(onIssued).toHaveBeenCalled();
});
