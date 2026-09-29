import type { PosMenuItem } from '../types/pos';

export function containsThaiCharacters(value: string): boolean {
  return /[\u0E00-\u0E7F]/u.test(value);
}

export function scannedItemNeedsOptions(
  item: Pick<PosMenuItem, 'modifiers' | 'packs'>,
): boolean {
  return Boolean(item.modifiers?.length || (item.packs?.length ?? 0) > 1);
}
