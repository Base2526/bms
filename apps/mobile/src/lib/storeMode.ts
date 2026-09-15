/** Client rendering mode derived from the paired device's server bootstrap. */
export type PreviewStoreMode =
  | 'general'
  | 'pharmacy'
  | 'restaurant'
  | 'board_game_cafe';

export const PREVIEW_STORE_MODES: ReadonlyArray<{
  value: PreviewStoreMode;
  label: string;
  description: string;
}> = [
  {
    value: 'general',
    label: 'ร้านทั่วไป',
    description: 'ขายสินค้าและจัดการกะ',
  },
  {
    value: 'pharmacy',
    label: 'ร้านขายยา',
    description: 'หน้าขายแบบร้านยาตามกฎจากเซิร์ฟเวอร์',
  },
  {
    value: 'restaurant',
    label: 'ร้านอาหาร',
    description: 'เมนู ผังโต๊ะ ครัว และกะ',
  },
  {
    value: 'board_game_cafe',
    label: 'ร้านบอร์ดเกม',
    description: 'ขายสินค้า จับเวลา โต๊ะ เกม และกะ',
  },
];

export function isPreviewStoreMode(value: unknown): value is PreviewStoreMode {
  return (
    value === 'general' ||
    value === 'pharmacy' ||
    value === 'restaurant' ||
    value === 'board_game_cafe'
  );
}
