export const POS_PIN_MIN_LENGTH = 4;
export const POS_PIN_MAX_LENGTH = 8;

export function normalizePosPinInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, POS_PIN_MAX_LENGTH);
}

export function isPosPinLengthValid(pin: string): boolean {
  return pin.length >= POS_PIN_MIN_LENGTH && pin.length <= POS_PIN_MAX_LENGTH;
}

export function isPosPinValid(pin: string): boolean {
  return isPosPinLengthValid(pin) && /^\d+$/.test(pin);
}

export function visiblePosPinSlots(pin: string): number {
  return Math.max(POS_PIN_MIN_LENGTH, Math.min(pin.length, POS_PIN_MAX_LENGTH));
}
