export const POS_PIN_MIN_LENGTH = 4;
export const POS_PIN_MAX_LENGTH = 8;

export function isPosPinLengthValid(pin: string): boolean {
  return pin.length >= POS_PIN_MIN_LENGTH && pin.length <= POS_PIN_MAX_LENGTH;
}

export function visiblePosPinSlots(pin: string): number {
  return Math.max(POS_PIN_MIN_LENGTH, Math.min(pin.length, POS_PIN_MAX_LENGTH));
}
