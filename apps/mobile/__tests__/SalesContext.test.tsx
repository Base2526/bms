import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useQuery } from '@apollo/client';
import { SalesProvider, useSales } from '../src/state/SalesContext';

jest.mock('@apollo/client', () => ({ useQuery: jest.fn() }));
jest.mock('../src/state/SessionContext', () => ({ useSession: () => ({ session: { cashier: { id: 'cashier' } } }) }));

test('history searches the server beyond the latest 50 and keeps barcode matches without local text filtering', async () => {
  const oldReceipt = {
    orderId: 'old-sale', receiptNo: 'RECEIPT-OLD', soldAt: '2026-01-01T00:00:00Z',
    lines: [], payments: [], returnEvents: [], discountLines: [], total: 100, roundingAmount: 0,
  };
  const refetch = jest.fn().mockResolvedValue(undefined);
  (useQuery as jest.Mock).mockImplementation((_document, options) => ({
    data: { bmsPosRecentSales: { sales: options.variables.q === '8850000000000' ? [oldReceipt] : [] } },
    loading: false, refetch,
  }));
  let sales!: ReturnType<typeof useSales>;
  function Probe() { sales = useSales(); return null; }
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { tree = ReactTestRenderer.create(<SalesProvider><Probe /></SalesProvider>); });
  expect(sales.sales).toEqual([]);
  await act(async () => { sales.setSearch(' 8850000000000 '); });
  expect(useQuery).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
    variables: { q: '8850000000000', limit: 50 },
  }));
  expect(sales.findSale('old-sale')?.receiptNo).toBe('RECEIPT-OLD');
  await act(async () => { await sales.refresh(); });
  expect(refetch).toHaveBeenCalledTimes(1);
  await act(async () => { sales.setSearch(''); });
  expect(useQuery).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
    variables: { q: null, limit: 50 },
  }));
  await act(async () => tree.unmount());
});
