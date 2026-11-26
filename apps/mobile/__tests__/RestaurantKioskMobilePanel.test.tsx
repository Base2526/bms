import React from 'react';
import { Alert } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { Button } from '../src/components/Button';
import { RestaurantKioskMobilePanel } from '../src/screens/operations/RestaurantKioskMobilePanel';
import { ThemeProvider } from '../src/theme/ThemeProvider';

const mockPreview = jest.fn();
const mockAccept = jest.fn();
const mockReject = jest.fn();
const mockLookup = jest.fn();
jest.mock('@apollo/client', () => ({
  useLazyQuery: () => [mockLookup],
  useMutation: (document: any) => {
    const name = document.definitions[0].name.value;
    return [name === 'MobileRestaurantKioskPreview' ? mockPreview
      : name === 'MobileRestaurantKioskAccept' ? mockAccept : mockReject];
  },
}));

const dineId = 'aaaaaaaa-0000-4000-8000-000000000001';
const checkA = 'bbbbbbbb-0000-4000-8000-000000000002';
const checkB = 'cccccccc-0000-4000-8000-000000000003';
const submission = {
  id: dineId, serviceMode: 'DINE_IN', status: 'PENDING', checkId: null,
  checkStatus: null, orderId: null, submittedAt: new Date().toISOString(),
  reviewedAt: null, rejectionReason: null, tableCode: null, tableName: null,
  areaName: null, splitGroupNo: null,
  items: [{ sku: 'FAKE-FOOD', productName: 'ข้าวผัด', size: 'L', packQty: 1,
    modifierCodes: ['EXTRA'], kitchenNote: null }],
};
const floor = {
  areas: [{ id: 'area', name: 'หน้าร้าน' }], takeawayChecks: [],
  tables: [{ id: 'table', areaId: 'area', code: 'T1', name: 'โต๊ะหนึ่ง',
    checks: [checkA, checkB].map((id, index) => ({ id, status: 'OPEN',
      serviceMode: 'DINE_IN', splitGroupNo: index + 1 })) }],
};
const quote = {
  submissionId: dineId, serviceMode: 'DINE_IN', priceChanged: true,
  submittedLines: [{ unitPrice: 50, lineAmount: 50 }],
  quote: { fingerprint: 'a'.repeat(64), total: 70,
    lines: [{ sku: 'FAKE-FOOD', productName: 'ข้าวผัด', size: 'L',
      packQty: 1, unitPrice: 70, lineAmount: 70, modifiers: [] }] },
  check: { id: checkB, version: 3, tableId: 'table', tableCode: 'T1',
    tableName: 'โต๊ะหนึ่ง', areaName: 'หน้าร้าน', splitGroupNo: 2,
    openedAt: '2026-11-26T01:00:00.000Z' },
};

let tree: Renderer.ReactTestRenderer;
const refresh = jest.fn(async () => undefined);
const openCheck = jest.fn();
const button = (label: string) => tree.root.findAllByType(Button).find(node => node.props.label === label)!;

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockPreview.mockResolvedValue({ data: { bmsPosRestaurantKioskPreview: quote } });
  mockAccept.mockResolvedValue({ data: { bmsPosRestaurantKioskAccept: { status: 'ACCEPTED', check: { id: checkB } } } });
  await act(async () => {
    tree = Renderer.create(<ThemeProvider><RestaurantKioskMobilePanel
      submissions={[submission] as any} floor={floor as any}
      credentials={{ cashierUserId: 'cashier', pin: '1234' }}
      refresh={refresh} openCheck={openCheck}
    /></ThemeProvider>);
  });
});
afterEach(async () => { await act(async () => tree.unmount()); jest.restoreAllMocks(); });

test('split-table acceptance waits for latest server quote and explicit table/price confirmations', async () => {
  await act(async () => button('รับและส่งครัว').props.onPress());
  expect(mockAccept).not.toHaveBeenCalled();
  const radios = tree.root.findAll(node => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function');
  expect(radios).toHaveLength(2);
  const split = radios[1];
  await act(async () => split.props.onPress());
  await act(async () => button('ตรวจราคาและบิลล่าสุด').props.onPress());
  expect(mockPreview).toHaveBeenCalledWith({ variables: { input: {
    cashierUserId: 'cashier', pin: '1234', submissionId: dineId, checkId: checkB,
  } } });
  await act(async () => button('รับและส่งครัว').props.onPress());
  expect(mockAccept).not.toHaveBeenCalled();
  for (const checkbox of tree.root.findAll(node => node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function')) {
    await act(async () => checkbox.props.onPress());
  }
  await act(async () => button('รับและส่งครัว').props.onPress());
  expect(mockAccept).toHaveBeenCalledWith({ variables: { input: expect.objectContaining({
    submissionId: dineId, checkId: checkB, quoteFingerprint: 'a'.repeat(64),
    confirmedTable: true, confirmedPriceChange: true,
    expectedCheckVersion: 3, expectedTableId: 'table',
    expectedCheckOpenedAt: '2026-11-26T01:00:00.000Z',
  }) } });
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('two takeaway request codes open their own linked checks', async () => {
  const rows = [checkA, checkB].map((checkId, index) => ({
    ...submission, id: index ? 'dddddddd-0000-4000-8000-000000000004' : dineId,
    serviceMode: 'TAKEAWAY', status: 'ACCEPTED', checkId, checkStatus: 'OPEN',
  }));
  await act(async () => tree.update(<ThemeProvider><RestaurantKioskMobilePanel
    submissions={rows as any} floor={floor as any}
    credentials={{ cashierUserId: 'cashier', pin: '1234' }}
    refresh={refresh} openCheck={openCheck}
  /></ThemeProvider>));
  const openButtons = tree.root.findAllByType(Button).filter(node => node.props.label === 'เปิดบิลที่ผูก');
  expect(openButtons).toHaveLength(2);
  await act(async () => openButtons[0].props.onPress());
  await act(async () => openButtons[1].props.onPress());
  expect(openCheck.mock.calls).toEqual([[checkA, 'TAKEAWAY', undefined], [checkB, 'TAKEAWAY', undefined]]);
});

test('poll failure shows stale-data warning instead of an empty inbox claim', async () => {
  await act(async () => tree.update(<ThemeProvider><RestaurantKioskMobilePanel
    submissions={[]} error="network offline" floor={floor as any}
    credentials={{ cashierUserId: 'cashier', pin: '1234' }}
    refresh={refresh} openCheck={openCheck}
  /></ThemeProvider>));
  const warning = tree.root.findAll(node => node.props.accessibilityRole === 'alert');
  expect(JSON.stringify(warning[0].props.children)).toContain('ข้อมูลที่เห็นอาจเก่า');
  expect(JSON.stringify(tree.toJSON())).not.toContain('ไม่มีคำขอจากจอ');
});
