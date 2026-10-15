import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Button } from '../src/components/Button';
import { ProductOptionsModal } from '../src/components/ProductOptionsModal';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import type { PosMenuItem } from '../src/types/pos';

const catalogItem: PosMenuItem = {
  sku: 'TEA-001',
  name: 'ชาไทย',
  price: 50,
  category: 'เครื่องดื่ม',
  station: 'บาร์',
  sellable: true,
  size: 'M',
  packCode: '',
  unitName: '',
  baseQty: 1,
};

describe('ProductOptionsModal', () => {
  it('resolves the complete pricing snapshot before adding a catalog item', async () => {
    const resolvedItem: PosMenuItem = {
      ...catalogItem,
      basePrice: 50,
      packBasePrice: 50,
      modifierUnitPrice: 0,
      priceTiers: [{ minQty: 3, unitPrice: 45 }],
      promotion: null,
      modifiers: [],
      packs: [],
    };
    const resolveVariant = jest.fn().mockResolvedValue(resolvedItem);
    const onConfirm = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider>
          <ProductOptionsModal
            item={catalogItem}
            resolveVariant={resolveVariant}
            onClose={jest.fn()}
            onConfirm={onConfirm}
          />
        </ThemeProvider>,
      );
      await Promise.resolve();
    });

    expect(resolveVariant).toHaveBeenCalledWith('TEA-001', 'M', null);
    const addButton = renderer.root
      .findAllByType(Button)
      .find(button => button.props.label === 'เพิ่มรายการ');
    expect(addButton).toBeDefined();

    await ReactTestRenderer.act(() => addButton!.props.onPress());
    expect(onConfirm).toHaveBeenCalledWith({
      item: expect.objectContaining({
        basePrice: 50,
        packBasePrice: 50,
        priceTiers: [{ minQty: 3, unitPrice: 45 }],
      }),
      modifierCodes: [],
      kitchenNote: null,
    });
  });
});


test.each([false, true])('zero-stock size follows scan stockTracked=%s', async stockTracked => {
  const resolvedItem: PosMenuItem = {
    ...catalogItem, stockTracked, basePrice: 50, packBasePrice: 50,
    priceTiers: [], promotion: null, modifiers: [], packs: [],
    availableSizes: [{ size: 'M', available: 0 }, { size: 'L', available: 0 }],
  };
  const resolveVariant = jest.fn().mockResolvedValue({ ...resolvedItem, size: 'L' });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(
    <ThemeProvider><ProductOptionsModal item={resolvedItem} resolveVariant={resolveVariant} onClose={jest.fn()} onConfirm={jest.fn()} /></ThemeProvider>,
  ); });
  const large = tree.root.findAllByType(Button).find(b => b.props.label === 'L')!;
  expect(large.props.disabled).toBe(stockTracked);
  if (!stockTracked) {
    await ReactTestRenderer.act(async () => large.props.onPress());
    expect(resolveVariant).toHaveBeenCalledWith('TEA-001', 'L', null);
  }
  await ReactTestRenderer.act(async () => tree.unmount());
});
