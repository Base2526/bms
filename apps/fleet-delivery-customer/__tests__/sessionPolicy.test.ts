import { permitsSyntheticCustomerSession } from '../src/state/CustomerSessionContext';

test('synthetic customer activation is debug-only', () => {
  expect(permitsSyntheticCustomerSession(true)).toBe(true);
  expect(permitsSyntheticCustomerSession(false)).toBe(false);
});
