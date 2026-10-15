import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { CartLineAmount } from '../src/components/CartLineAmount';
import { ThemeProvider } from '../src/theme/ThemeProvider';

test.each([
  [200, 150, ['ก่อนโปร ฿200.00', 'หลังโปร ฿150.00']],
  [100, 0, ['ก่อนโปร ฿100.00', 'หลังโปร ฿0.00']],
  [100, 100, ['฿100.00']],
])('renders shelf %s and payable %s without hiding a free item', async (listAmount, amount, expected) => {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => { tree = Renderer.create(<ThemeProvider><CartLineAmount listAmount={listAmount} amount={amount} /></ThemeProvider>); });
  expect(tree.root.findAllByType(Text).map(node => node.props.children.flat().join(''))).toEqual(expected);
  await act(async () => tree.unmount());
});
