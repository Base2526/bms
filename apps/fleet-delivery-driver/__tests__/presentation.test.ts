import { formatDistance, offerRemainingSeconds } from '../src/lib/presentation';

describe('driver presentation helpers', () => {
  test('formats bounded pickup distance', () => {
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1_250)).toBe('1.3 km');
    expect(formatDistance(12_500)).toBe('13 km');
  });

  test('uses elapsed time from a server clock snapshot', () => {
    expect(offerRemainingSeconds(
      '2026-10-18T00:00:00.000Z',
      '2026-10-18T00:00:30.000Z',
      1_000,
      11_001,
    )).toBe(20);
  });

  test('never displays negative remaining time', () => {
    expect(offerRemainingSeconds(
      '2026-10-18T00:00:00.000Z',
      '2026-10-18T00:00:01.000Z',
      1_000,
      5_000,
    )).toBe(0);
  });
});
