/**
 * โหมดนี้มีไว้ preview หน้าจอระหว่างที่ backend contract ยังไม่นิ่งเท่านั้น
 * ไม่ใช่ business_archetype, tenant authority หรือสิทธิ์ขายยา
 */
export type PreviewStoreMode = 'general' | 'pharmacy' | 'restaurant';

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
    description: 'หน้าขายแบบร้านยา (กฎเภสัชยังเป็น mock)',
  },
  {
    value: 'restaurant',
    label: 'ร้านอาหาร',
    description: 'เมนู ผังโต๊ะ ครัว และกะ',
  },
];

export function isPreviewStoreMode(value: unknown): value is PreviewStoreMode {
  return value === 'general' || value === 'pharmacy' || value === 'restaurant';
}
