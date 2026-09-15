import { isPreviewStoreMode, PREVIEW_STORE_MODES } from '../src/lib/storeMode';

describe('preview store mode', () => {
  test('offers every supported POS archetype', () => {
    expect(PREVIEW_STORE_MODES.map(option => option.value)).toEqual([
      'general',
      'pharmacy',
      'restaurant',
      'board_game_cafe',
    ]);
  });

  test('accepts only known preview values', () => {
    expect(isPreviewStoreMode('general')).toBe(true);
    expect(isPreviewStoreMode('pharmacy')).toBe(true);
    expect(isPreviewStoreMode('restaurant')).toBe(true);
    expect(isPreviewStoreMode('board_game_cafe')).toBe(true);
    expect(isPreviewStoreMode('admin')).toBe(false);
    expect(isPreviewStoreMode(null)).toBe(false);
  });
});
