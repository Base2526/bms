import {
  isPosPinValid,
  isPosPinLengthValid,
  normalizePosPinInput,
  POS_PIN_MAX_LENGTH,
  visiblePosPinSlots,
} from '../src/lib/posPin';

describe('POS PIN presentation', () => {
  test('accepts the same 4-8 digit length range as the server', () => {
    expect(isPosPinLengthValid('123')).toBe(false);
    expect(isPosPinLengthValid('1234')).toBe(true);
    expect(isPosPinLengthValid('12345678')).toBe(true);
    expect(isPosPinLengthValid('123456789')).toBe(false);
  });

  test('starts with four slots without preventing longer configured PINs', () => {
    expect(visiblePosPinSlots('')).toBe(4);
    expect(visiblePosPinSlots('1234')).toBe(4);
    expect(visiblePosPinSlots('123456')).toBe(6);
    expect(visiblePosPinSlots('1'.repeat(POS_PIN_MAX_LENGTH + 1))).toBe(8);
  });

  test('normalizes every POS surface to numeric input capped at eight digits', () => {
    expect(normalizePosPinInput('01a23-456789')).toBe('01234567');
    expect(isPosPinValid('0123')).toBe(true);
    expect(isPosPinValid('12345678')).toBe(true);
    expect(isPosPinValid('123a')).toBe(false);
  });
});
