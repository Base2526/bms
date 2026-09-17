import {
  columnsForWidth,
  padGrid,
  supportsTabletLayout,
} from '../src/theme/useResponsive';

describe('responsive layout', () => {
  test('does not turn a rotated phone into a tablet layout', () => {
    expect(supportsTabletLayout(915, 412)).toBe(false);
    expect(supportsTabletLayout(800, 360, 760)).toBe(false);
  });

  test('uses tablet layouts only when both axes have enough room', () => {
    expect(supportsTabletLayout(1024, 768)).toBe(true);
    expect(supportsTabletLayout(800, 600, 760)).toBe(true);
    expect(supportsTabletLayout(700, 600, 760)).toBe(false);
  });

  test('keeps grid density tied to the actual content width', () => {
    expect(columnsForWidth(699)).toBe(2);
    expect(columnsForWidth(700)).toBe(3);
    expect(columnsForWidth(1000)).toBe(4);
  });

  test('pads only the incomplete final row', () => {
    expect(padGrid([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3, 4, 5, null]);
    expect(padGrid([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(padGrid([], 3)).toEqual([]);
  });
});
