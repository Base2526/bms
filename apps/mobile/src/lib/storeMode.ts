import { posText } from '../i18n/catalog';
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
    get label() { return posText("ร้านทั่วไป"); },
    get description() { return posText("ขายสินค้าและจัดการกะ"); },
  },
  {
    value: 'pharmacy',
    get label() { return posText("ร้านขายยา"); },
    get description() { return posText("หน้าขายแบบร้านยาตามกฎจากเซิร์ฟเวอร์"); },
  },
  {
    value: 'restaurant',
    get label() { return posText("ร้านอาหาร"); },
    get description() { return posText("เมนู ผังโต๊ะ ครัว และกะ"); },
  },
  {
    value: 'board_game_cafe',
    get label() { return posText("ร้านบอร์ดเกม"); },
    get description() { return posText("ขายสินค้า จับเวลา โต๊ะ เกม และกะ"); },
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
