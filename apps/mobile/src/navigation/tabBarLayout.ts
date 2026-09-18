export const BOTTOM_TAB_CONTENT_HEIGHT = 62;

export function bottomTabBarLayout(bottomInset: number) {
  const safeBottomInset = Math.max(0, bottomInset);

  return {
    height: BOTTOM_TAB_CONTENT_HEIGHT + safeBottomInset,
    paddingBottom: safeBottomInset,
  } as const;
}
