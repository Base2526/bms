import { permitsSyntheticDriverSession } from '../src/state/DriverSessionContext';

describe('driver session build policy', () => {
  test('allows the synthetic activation path in development builds', () => {
    expect(permitsSyntheticDriverSession(true)).toBe(true);
  });

  test('keeps release builds non-activatable without touching stored credentials', () => {
    expect(permitsSyntheticDriverSession(false)).toBe(false);
  });
});
