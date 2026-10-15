import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { CartProvider, useCart } from '../src/state/CartContext';
import type { PosMenuItem } from '../src/types/pos';

const mockResolveVariant = jest.fn();
jest.mock('../src/state/CatalogContext', () => ({ useCatalog: () => ({ resolveVariant: mockResolveVariant }) }));
jest.mock('../src/state/SessionContext', () => ({ useSession: () => ({ session: null }) }));
jest.mock('../src/state/ShiftContext', () => ({ useShift: () => ({ isOpen: true }) }));
jest.mock('@apollo/client', () => ({
  useQuery: () => ({ data: undefined, loading: false }),
  useMutation: () => [jest.fn()],
}));
const item: PosMenuItem = {
  sku: 'MENU', name: 'Menu', size: 'S', packCode: 'BASE', baseQty: 1,
  unitName: 'dish', price: 100, basePrice: 100, packBasePrice: 100,
  category: 'Food', station: 'Kitchen', sellable: true, priceTiers: [], promotion: null,
};
let cart: ReturnType<typeof useCart>;
function Probe() { cart = useCart(); return null; }
let tree: Renderer.ReactTestRenderer;
beforeEach(async () => {
  mockResolveVariant.mockReset();
  await act(async () => { tree = Renderer.create(<CartProvider><Probe /></CartProvider>); });
});
afterEach(async () => { await act(async () => tree.unmount()); });

test('rescanning the same variant replaces branch prices without losing serial selections', async () => {
  await act(async () => cart.addItem(item));
  await act(async () => cart.updateLine(cart.lines[0].key, { serials: ['SERIAL-1'] }));
  await act(async () => cart.addItem({ ...item, price: 130, basePrice: 130, packBasePrice: 130 }));
  expect(cart.lines).toHaveLength(1);
  expect(cart.lines[0]).toMatchObject({ qty: 2, unitPrice: 130, serials: ['SERIAL-1'] });
  expect(cart.subtotal).toBe(260);
});

test('refreshing a scheduled size-specific offer updates the whole cart and requires review', async () => {
  await act(async () => { cart.addItem(item); cart.addItem(item); cart.addItem({ ...item, size: 'L' }); });
  const promotion = { kind: 'N_FOR_PRICE' as const, buyQty: 2, bundlePrice: 150, buySize: 'S' };
  mockResolveVariant.mockImplementation(async (_sku, size) => ({ ...item, size, promotion }));
  let result: unknown;
  await act(async () => { result = await cart.refreshPricing(); });
  expect(result).toEqual({ changed: true, error: null });
  expect(cart.subtotal).toBe(250);
  await act(async () => { result = await cart.refreshPricing(); });
  expect(result).toEqual({ changed: false, error: null });
  mockResolveVariant.mockImplementation(async (_sku, size) => ({ ...item, size, promotion: null }));
  await act(async () => { result = await cart.refreshPricing(); });
  expect(result).toEqual({ changed: true, error: null });
  expect(cart.subtotal).toBe(300);
});

test('a failed refresh keeps every line intact and prevents payment', async () => {
  await act(async () => { cart.addItem(item); cart.addItem({ ...item, sku: 'OTHER' }); });
  mockResolveVariant.mockImplementation(async (sku) => {
    if (sku === 'OTHER') throw new Error('Unavailable');
    return { ...item, basePrice: 150, price: 150, packBasePrice: 150 };
  });
  let result: unknown;
  await act(async () => { result = await cart.refreshPricing(); });
  expect(result).toEqual({ changed: false, error: 'Unavailable' });
  expect(cart.subtotal).toBe(200);
});


test('pack conversion changes require re-adding the line even when its price is unchanged', async () => {
  const pack = { ...item, packCode: 'BOX', baseQty: 6, packBasePrice: 500, price: 500 };
  await act(async () => cart.addItem(pack));
  mockResolveVariant.mockResolvedValue({ ...pack, baseQty: 12 });
  let result: Awaited<ReturnType<typeof cart.refreshPricing>> | undefined;
  await act(async () => { result = await cart.refreshPricing(); });
  expect(result?.error).toMatch(/หน่วยขาย.*เปลี่ยน/);
  expect(cart.lines[0].baseQty).toBe(6);
  expect(cart.subtotal).toBe(500);
});
