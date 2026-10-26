import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useLazyQuery, useQuery } from '@apollo/client';
import { CatalogProvider, useCatalog } from '../src/state/CatalogContext';

let mockHealthStatus: 'checking' | 'online' | 'offline' = 'online';

jest.mock('../src/state/StoreModeContext', () => ({
  useStoreMode: () => ({ mode: 'general' }),
}));
jest.mock('../src/state/DeviceContext', () => ({
  useDevice: () => ({
    target: {
      serverUrl: 'https://shop.example.com',
      token: `pos_${'a'.repeat(32)}`,
    },
  }),
}));
jest.mock('../src/state/ServerHealthContext', () => ({
  useServerHealth: () => ({ status: mockHealthStatus }),
}));
jest.mock('@apollo/client', () => ({
  useQuery: jest.fn(),
  useLazyQuery: jest.fn(),
}));

const scanResult = {
  sku: 'SKU-1',
  productName: 'Product one',
  receiptName: 'Product one',
  packPrice: 100,
  basePrice: 100,
  priceTiers: [],
  promotion: null,
  available: 5,
  stockTracked: true,
  imageUrl: null,
  size: 'STD',
  packCode: 'PIECE',
  unitName: 'piece',
  baseQty: 1,
  serialTracked: false,
  scaleBarcode: null,
  modifiers: [],
  packs: [{ code: 'PIECE', unitName: 'piece', baseQty: 1, price: 100 }],
};

describe('CatalogProvider offline snapshots', () => {
  beforeEach(() => {
    mockHealthStatus = 'online';
    jest.clearAllMocks();
    (useQuery as jest.Mock).mockImplementation((document: any) => {
      const name = document?.definitions?.[0]?.name?.value;
      return name === 'MobileRestaurantMenu'
        ? { data: undefined, loading: false, error: null, refetch: jest.fn() }
        : {
            data: {
              bmsPosCatalogSearch: {
                items: [
                  {
                    sku: 'SKU-1',
                    name: 'Product one',
                    price: 100,
                    availableTotal: 5,
                    availability: 'AVAILABLE',
                    availableSizes: [{ size: 'STD', available: 5, price: 100 }],
                    imageUrl: null,
                  },
                ],
              },
            },
            loading: false,
            error: null,
            refetch: jest.fn(),
          };
    });
  });

  test.each([
    [0, 1, true, false],
    [3, 5, true, false],
    [3, 1, true, true],
    [0, 1, false, true],
  ])('scan respects usable quantity %s and pack quantity %s (tracked %s)', async (available, baseQty, stockTracked, sellable) => {
    const scan = jest.fn().mockResolvedValue({
      data: { bmsPosScan: { ...scanResult, available, baseQty, stockTracked } },
    });
    (useLazyQuery as jest.Mock).mockReturnValue([scan]);
    let catalog: ReturnType<typeof useCatalog> | undefined;
    function Probe() { catalog = useCatalog(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<CatalogProvider><Probe /></CatalogProvider>); });
    await act(async () => {
      const resolved = await catalog!.resolveVariant('SKU-1', 'STD', null);
      expect(resolved.sellable).toBe(sellable);
      expect(resolved.stockTracked).toBe(stockTracked);
    });
    await act(async () => tree.unmount());
  });

  test('reuses a resolved price snapshot for repeated sales after connectivity drops', async () => {
    const scan = jest.fn().mockResolvedValue({
      data: { bmsPosScan: scanResult },
    });
    (useLazyQuery as jest.Mock).mockReturnValue([scan]);

    let catalog: ReturnType<typeof useCatalog> | undefined;
    function Probe() {
      catalog = useCatalog();
      return null;
    }

    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <CatalogProvider>
          <Probe />
        </CatalogProvider>,
      );
    });

    await act(async () => {
      await catalog!.resolveVariant('SKU-1', 'STD', null);
    });
    expect(scan).toHaveBeenCalledTimes(1);

    mockHealthStatus = 'offline';
    await act(async () => {
      tree!.update(
        <CatalogProvider>
          <Probe />
        </CatalogProvider>,
      );
    });

    await expect(
      catalog!.resolveVariant('SKU-1', 'STD', null),
    ).resolves.toMatchObject({ sku: 'SKU-1', price: 100 });
    expect(scan).toHaveBeenCalledTimes(1);
    expect(catalog!.catalog.items).toEqual([
      expect.objectContaining({ sku: 'SKU-1', basePrice: 100 }),
    ]);

    await act(async () => tree!.unmount());
  });
  test.each([
    ['AVAILABLE', true],
    ['OUT_OF_STOCK', false],
    ['SOLD_OUT_TODAY', false],
  ])('zero own stock respects server availability %s', async (availability, sellable) => {
    (useQuery as jest.Mock).mockReturnValue({ data: { bmsPosRestaurantMenu: { items: [] }, bmsPosCatalogSearch: { items: [{
      sku: 'RECIPE', name: 'Recipe set', price: 150, availableTotal: 0,
      availability, availableSizes: [{ size: 'STD', available: 0, price: 150 }], imageUrl: null,
    }] } }, loading: false, refetch: jest.fn() });
    (useLazyQuery as jest.Mock).mockReturnValue([jest.fn()]);
    let catalog: ReturnType<typeof useCatalog> | undefined;
    function Probe() { catalog = useCatalog(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<CatalogProvider><Probe /></CatalogProvider>); });
    expect(catalog!.catalog.items[0].sellable).toBe(sellable);
    await act(async () => tree.unmount());
  });

});
