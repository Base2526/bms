import {
  createIdempotencyKey,
  graphqlErrorCode,
  isDecidedRejection,
  isStaleOperationConflict,
  runWithOperationTimeout,
} from '../src/lib/operation';

/**
 * คีย์กันรายการซ้ำถูกเก็บไว้กดใหม่ได้เฉพาะตอน "ไม่รู้ผล" เท่านั้น
 *
 * ถ้าเก็บไว้ตอนที่เซิร์ฟเวอร์ตัดสินแล้ว คนหน้าเครื่องจะแก้ข้อมูลตามที่ error บอก กดใหม่
 * แล้วไปชนคีย์เดิมด้วยข้อมูลคนละชุด → เซิร์ฟเวอร์ตอบ CONFLICT ทุกครั้งและไปต่อไม่ได้เลย
 */
describe('operation keys and server verdicts', () => {
  const withCode = (code: string) => ({
    graphQLErrors: [{ extensions: { code } }],
  });

  test('reads the first code the server attached, and nothing from a bare network failure', () => {
    expect(graphqlErrorCode(withCode('CONFLICT'))).toBe('CONFLICT');
    expect(graphqlErrorCode(new Error('Network request failed'))).toBeNull();
    expect(
      graphqlErrorCode({ graphQLErrors: [{ extensions: null }] }),
    ).toBeNull();
    expect(
      graphqlErrorCode({ graphQLErrors: [{ extensions: { code: '  ' } }] }),
    ).toBeNull();
  });

  test('CONFLICT means the key belongs to a finished request — refetch, never blind-retry', () => {
    expect(isStaleOperationConflict(withCode('CONFLICT'))).toBe(true);
    expect(isStaleOperationConflict(withCode('INTERNAL_SERVER_ERROR'))).toBe(
      false,
    );
    expect(isStaleOperationConflict(new Error('timeout'))).toBe(false);
  });

  test('only an unknown outcome keeps the key: 500 and a dropped connection', () => {
    for (const code of [
      'BAD_USER_INPUT',
      'FORBIDDEN',
      'NOT_FOUND',
      'UNAUTHENTICATED',
      'CONFLICT',
      'GRAPHQL_VALIDATION_FAILED',
    ]) {
      expect(isDecidedRejection(withCode(code))).toBe(true);
    }
    expect(isDecidedRejection(withCode('INTERNAL_SERVER_ERROR'))).toBe(false);
    expect(isDecidedRejection(new Error('Network request failed'))).toBe(false);
  });

  test('a fresh intent gets a fresh key', () => {
    expect(createIdempotencyKey('inventory-create-transfer')).not.toBe(
      createIdempotencyKey('inventory-create-transfer'),
    );
    expect(createIdempotencyKey('x').length).toBeGreaterThanOrEqual(8);
  });

  test('bounds a dropped operation and leaves the outcome unknown', async () => {
    await expect(
      runWithOperationTimeout(
        signal =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('abort')));
          }),
        5,
      ),
    ).rejects.toThrow('เซิร์ฟเวอร์ไม่ตอบภายใน 1 วินาที');
  });
});
