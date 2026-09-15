import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button } from '../src/components/Button';
import { SaleConfirmationModal } from '../src/components/SaleConfirmationModal';
import { ThemeProvider } from '../src/theme/ThemeProvider';

describe('SaleConfirmationModal', () => {
  test('shows the sale summary and keeps confirm separate from cancel', async () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 1024, height: 1366 },
            insets: { top: 24, right: 0, bottom: 20, left: 0 },
          }}
        >
          <ThemeProvider>
            <SaleConfirmationModal
              visible
              subtotal={160}
              discountTotal={20}
              total={140}
              itemCount={4}
              payments={[
                { id: 'cash', method: 'cash', amount: 140, tendered: 150 },
              ]}
              onCancel={onCancel}
              onConfirm={onConfirm}
            />
          </ThemeProvider>
        </SafeAreaProvider>,
      );
    });

    const text = renderer!.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .flat(Infinity)
      .join(' ');
    expect(text).toContain('฿140.00');
    expect(text).toContain('−฿20.00');
    expect(text).toContain('เงินสด');
    expect(text).toContain('4 รายการ');
    expect(text).toContain('หากต้องแก้ไขต้องทำรายการคืน');

    const buttons = renderer!.root.findAllByType(Button);
    await ReactTestRenderer.act(() => buttons[0].props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await ReactTestRenderer.act(() => buttons[1].props.onPress());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
