import {
  BOTTOM_TAB_CONTENT_HEIGHT,
  bottomTabBarLayout,
} from '../src/navigation/tabBarLayout';

describe('bottom tab bar layout', () => {
  test('keeps the full tab content above a three-button navigation inset', () => {
    const layout = bottomTabBarLayout(48);

    expect(layout).toEqual({ height: 110, paddingBottom: 48 });
    expect(layout.height - layout.paddingBottom).toBe(
      BOTTOM_TAB_CONTENT_HEIGHT,
    );
  });

  test('does not allow an invalid negative inset to shrink the tab bar', () => {
    expect(bottomTabBarLayout(-12)).toEqual({
      height: BOTTOM_TAB_CONTENT_HEIGHT,
      paddingBottom: 0,
    });
  });
});
