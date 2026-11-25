import { applyPosLanguage, posText } from '../src/i18n/catalog';
import { isPermissionDeniedError } from '../src/lib/permissionError';

// 2026-11-24 recheck: InventoryScreen matched posText("ไม่มีสิทธิ์") against Thai server text,
// so English mode never showed the permission-denied panel.
afterEach(() => applyPosLanguage('th'));

test('a FORBIDDEN GraphQL error is a permission denial in either language', () => {
  const forbidden = {
    message: 'ไม่มีสิทธิ์ inventory.count',
    graphQLErrors: [{ message: 'ไม่มีสิทธิ์ inventory.count', extensions: { code: 'FORBIDDEN' } }],
  };
  applyPosLanguage('en');
  expect(posText('ไม่มีสิทธิ์')).toBe('No permission');
  expect(isPermissionDeniedError(forbidden)).toBe(true);
  applyPosLanguage('th');
  expect(isPermissionDeniedError(forbidden)).toBe(true);
});

test('older servers without a code are still recognised by their Thai wording', () => {
  applyPosLanguage('en');
  expect(isPermissionDeniedError({ message: 'ไม่มีสิทธิ์ใช้งานสต็อก', graphQLErrors: [] })).toBe(true);
});

test('network and other server errors are not permission denials', () => {
  expect(isPermissionDeniedError(undefined)).toBe(false);
  expect(isPermissionDeniedError({ message: 'เซิร์ฟเวอร์ไม่ตอบ', graphQLErrors: [] })).toBe(false);
  expect(isPermissionDeniedError({ message: 'x', graphQLErrors: [{ extensions: { code: 'BAD_USER_INPUT' } }] })).toBe(false);
});
