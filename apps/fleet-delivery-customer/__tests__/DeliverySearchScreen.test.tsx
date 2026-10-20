import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Button } from '../src/components/Ui';
import { DeliverySearchScreen } from '../src/screens/DeliverySearchScreen';

const mockStatus = jest.fn();
const mockQuote = jest.fn();
const mockCreate = jest.fn();
const mockSession = { apiBaseUrl: 'http://127.0.0.1:4100', accessToken: 'a'.repeat(43),
  expiresAt: '2099-01-01T00:00:00.000Z', syntheticOnly: true };

jest.mock('../src/state/CustomerSessionContext', () => ({
  useCustomerSession: () => ({ state: { kind: 'ACTIVE', session: mockSession }, clear: jest.fn() }),
}));
jest.mock('@bms/fleet-delivery-customer-core', () => ({
  CustomerDeliveryClient: jest.fn().mockImplementation(() => ({
    getDeliveryStatus: () => mockStatus(), quote: (...args: unknown[]) => mockQuote(...args),
    createDelivery: (...args: unknown[]) => mockCreate(...args),
  })),
}));

test('search waits for recovery, locks inputs in flight and ignores duplicate confirmation taps', async () => {
  let resolveStatus!: (value: unknown) => void;
  mockStatus.mockImplementationOnce(() => new Promise(resolve => { resolveStatus = resolve; }));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<DeliverySearchScreen />); });
  const button = (label: string) => renderer.root.findAllByType(Button).find(item => item.props.label === label)!;
  expect(button('ค้นหาราคา').props.disabled).toBe(true);
  await act(async () => { resolveStatus({ delivery: null }); });
  expect(button('ค้นหาราคา').props.disabled).toBe(false);

  let resolveQuote!: (value: unknown) => void;
  mockQuote.mockImplementationOnce(() => new Promise(resolve => { resolveQuote = resolve; }));
  let search!: Promise<void>;
  await act(async () => { search = button('ค้นหาราคา').props.onPress(); });
  expect(renderer.root.findByType(TextInput).props.editable).toBe(false);
  await act(async () => {
    resolveQuote({ quoteId: 'synthetic-quote', customerContributionSatang: 2400,
      grossDeliveryFeeSatang: 2900, merchantSubsidySatang: 500, startedKilometres: 2,
      expiresAt: '2099-01-01T00:00:00.000Z' });
    await search;
  });

  let resolveCreate!: (value: unknown) => void;
  mockCreate.mockImplementationOnce(() => new Promise(resolve => { resolveCreate = resolve; }));
  const confirm = button('ยืนยันใช้บริการ').props.onPress;
  let first!: Promise<void>;
  await act(async () => { first = confirm(); await confirm(); });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  const delivery = { deliveryId: 'synthetic-delivery', state: 'AWAITING_PAYMENT', version: 1,
    matchStage: 'PAYMENT_REQUIRED', customerContributionSatang: 2400, updatedAt: '2099-01-01T00:00:00.000Z' };
  mockStatus.mockResolvedValueOnce({ delivery });
  await act(async () => { resolveCreate(delivery); await first; });
  expect(renderer.root.findAllByType(Button).some(item => item.props.label === 'ยืนยันใช้บริการ')).toBe(false);
  expect(renderer.root.findByType(TextInput).props.editable).toBe(false);
  await act(async () => { renderer.unmount(); });
});
